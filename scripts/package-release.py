#!/usr/bin/env python3
"""Đóng gói TAKI Agentic AI thành MỘT file zip cài được trên máy Windows khác.

  python scripts/package-release.py [--out D:\\TAKI-Release] [--pg-home "C:\\Program Files\\PostgreSQL\\17"] [--no-pg-restart]

Gói gồm: mã nguồn + .git, data/ (DB SQLite chụp nhất quán, brain, creative, uploads...), ZL-CRM (code + node_modules + PostgreSQL data),
mã + trọng số video AI, và PostgreSQL 17 đóng gói sẵn (runtime/pgsql) để máy mới không cần cài PostgreSQL.
Không gói (không chuyển máy được, INSTALL.cmd dựng lại): node_modules gốc của pnpm, Python .venv, hồ sơ Chrome, đăng nhập tài khoản AI.

Khi chụp PostgreSQL của ZL-CRM, script tắt nó vài giây (shutdown sạch) rồi bật lại ngay — đây là cách duy nhất bảo đảm dữ liệu nhất quán.
Sau khi nén, script đọc lại toàn bộ zip kiểm CRC và ghi file .sha256.
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOP = "TAKI-Agentic-AI"  # thư mục gốc bên trong zip
PG_PORT = 5433

# Thư mục/tệp KHÔNG đưa vào gói (đường dẫn tương đối, dấu /)
EXCLUDE_PATHS = {
    "data/flow-chrome",            # hồ sơ Chrome (cookie mã hóa theo máy) — đăng nhập lại Flow trên máy mới
    "data/ai-accounts",            # token đăng nhập tài khoản Codex — đăng nhập lại
    "data/bin",                    # lệnh taki-* trỏ đường dẫn máy cũ — hệ thống tự sinh lại khi chạy
    "data/ai-connections-qa", "data/chat-qa", "data/qa-tools", "data/takeover-qa", "data/ui-qa",  # ảnh chụp/QA tạm
    "data/dotaka.db", "data/dotaka.db-shm", "data/dotaka.db-wal",  # thay bằng bản chụp nhất quán
    "services/zl-crm/data/pgdata",  # thay bằng bản chụp sau shutdown sạch
    "runtime",                     # thay bằng PostgreSQL đóng gói
    "install.log",
}
EXCLUDE_DIR_NAMES = {".venv", "__pycache__", ".pytest_cache", ".mypy_cache"}
EXCLUDE_FILE_SUFFIX = (".log", ".pyc", ".tsbuildinfo")
EXCLUDE_FILE_NAMES = {"Thumbs.db", ".DS_Store", "postmaster.pid", "index.lock"}
# node_modules chỉ giữ ở các chỗ npm (di chuyển được); pnpm dùng junction tuyệt đối nên dựng lại bằng INSTALL.cmd
NODE_MODULES_KEEP = ("services/zl-crm/backend/", "services/zl-crm/frontend/", "services/video-ai/remotion-news/")
STORED_SUFFIX = (".mp4", ".mov", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".zip", ".gz", ".whl", ".mp3", ".woff2", ".7z")
WIN_LONG = chr(92) * 2 + "?" + chr(92)  # tiền tố đường dẫn dài của Windows
LONG_REL = 200  # đường dẫn tương đối dài hơn mức này được lưu dạng tên ngắn
TEXT_CRLF = {"INSTALL.cmd", "start-taki.cmd"}
TEXT_BOM_CRLF = {"scripts/install-windows.ps1"}


def excluded(rel: str, is_dir: bool) -> bool:
    if rel in EXCLUDE_PATHS:
        return True
    parts = rel.split("/")
    name = parts[-1]
    in_nm = "node_modules" in parts[:-1]
    if is_dir:
        if name == "node_modules":
            return False if in_nm else not rel.startswith(NODE_MODULES_KEEP)
        if name in EXCLUDE_DIR_NAMES:
            return True
        return name == "dist" and not in_nm
    if in_nm:  # trong node_modules giữ nguyên mọi tệp
        return False
    return name in EXCLUDE_FILE_NAMES or name.endswith(EXCLUDE_FILE_SUFFIX)


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def snapshot_sqlite(src: Path, dst: Path) -> dict:
    s = sqlite3.connect(f"file:{src.as_posix()}?mode=ro", uri=True)
    d = sqlite3.connect(str(dst))
    s.backup(d)
    check = d.execute("PRAGMA integrity_check").fetchone()[0]
    tables = [r[0] for r in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    rows = {t: d.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    d.close(); s.close()
    if check != "ok":
        sys.exit(f"Bản chụp SQLite lỗi toàn vẹn: {check}")
    return {"tables": len(tables), "rows": sum(rows.values())}


def pg_ctl_path(pg_home: Path) -> Path:
    p = pg_home / "bin" / "pg_ctl.exe"
    if not p.exists():
        sys.exit(f"Không thấy {p} — dùng --pg-home trỏ tới thư mục PostgreSQL 17")
    return p


def snapshot_pgdata(pg_home: Path, dst: Path, restart: bool) -> None:
    data = ROOT / "services/zl-crm/data/pgdata"
    if not (data / "PG_VERSION").exists():
        print("  (không có pgdata của ZL-CRM — bỏ qua)")
        return
    ctl = str(pg_ctl_path(pg_home))
    running = port_open(PG_PORT)
    ignore = shutil.ignore_patterns("postmaster.pid", "postmaster.opts")
    try:
        if running:
            print("  tắt PostgreSQL ZL-CRM (shutdown sạch)...")
            subprocess.run([ctl, "-D", str(data), "-m", "fast", "-w", "-t", "60", "stop"], check=True, stdout=subprocess.DEVNULL)
        shutil.copytree(data, dst, ignore=ignore)
    finally:
        if running and restart:
            log = ROOT / "services/zl-crm/data/postgres.log"
            subprocess.Popen(
                [ctl, "-D", str(data), "-l", str(log), "-o", f"-p {PG_PORT} -c listen_addresses=127.0.0.1", "-w", "-t", "60", "start"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            )
            for _ in range(70):
                if port_open(PG_PORT):
                    print("  PostgreSQL ZL-CRM đã bật lại")
                    break
                time.sleep(1)
            else:
                print("  !! PostgreSQL ZL-CRM CHƯA bật lại — chạy: node scripts/zlcrm-pg.mjs start")


def normalized(rel: str, path: Path) -> bytes | None:
    if rel in TEXT_CRLF or rel in TEXT_BOM_CRLF:
        text = path.read_bytes().decode("utf-8-sig").replace("\r\n", "\n").replace("\n", "\r\n")
        return (b"\xef\xbb\xbf" if rel in TEXT_BOM_CRLF else b"") + text.encode("utf-8")
    return None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # console Windows mặc định cp1252 không in được tiếng Việt
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=r"D:\TAKI-Release")
    ap.add_argument("--pg-home", default=r"C:\Program Files\PostgreSQL\17")
    ap.add_argument("--no-pg-restart", action="store_true")
    a = ap.parse_args()
    pg_home = Path(a.pg_home)
    out_dir = Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    zip_path = out_dir / f"TAKI-Agentic-AI-Windows-{stamp}.zip"
    part = zip_path.with_suffix(".zip.part")
    tmp = Path(tempfile.mkdtemp(prefix="taki-pack-"))
    skipped: list[str] = []
    count = size = 0

    try:
        print("1/5 Chụp DB SQLite nhất quán...")
        db_snap = tmp / "dotaka.db"
        db_info = snapshot_sqlite(ROOT / "data/dotaka.db", db_snap)
        print(f"  {db_info['tables']} bảng, {db_info['rows']} dòng, integrity_check = ok")

        print("2/5 Chụp PostgreSQL ZL-CRM...")
        pg_snap = tmp / "pgdata"
        snapshot_pgdata(pg_home, pg_snap, restart=not a.no_pg_restart)

        print(f"3/5 Nén vào {zip_path.name} ...")
        t0 = time.time()
        with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True, strict_timestamps=False) as zf:
            long_files: list[dict] = []
            long_dirs: list[str] = []

            def add(path: Path, rel: str) -> None:
                nonlocal count, size
                # Tên có ký tự ngoài ASCII (tiếng Việt) hoặc đường dẫn quá dài (> LONG_REL) làm một số công cụ giải nén (tar, Windows cũ)
                # bỏ qua/lỗi: lưu tên ngắn ASCII + bảng ánh xạ, INSTALL.cmd khôi phục đúng tên/đường dẫn gốc.
                src = Path(WIN_LONG + str(path)) if len(str(path)) >= 240 else path
                arc_rel = rel
                if len(rel) > LONG_REL or not rel.isascii():
                    sfx = path.suffix if path.suffix.isascii() else ""
                    arc_rel = f"_restore/{len(long_files) + 1:05d}{sfx}"
                    long_files.append({"stored": arc_rel, "restoreTo": rel})
                arc = f"{TOP}/{arc_rel}"
                comp = zipfile.ZIP_STORED if path.suffix.lower() in STORED_SUFFIX else zipfile.ZIP_DEFLATED
                try:
                    data = normalized(rel, path)
                    if data is not None:
                        zi = zipfile.ZipInfo.from_file(src, arc)
                        zi.compress_type = comp
                        zf.writestr(zi, data)
                    else:
                        zf.write(src, arc, compress_type=comp)
                    count += 1
                    size += src.stat().st_size
                except (OSError, PermissionError) as e:
                    if arc_rel != rel:
                        long_files.pop()
                    skipped.append(f"{rel}: {e}")

            def add_tree(base: Path, rel_prefix: str, filt=None) -> None:
                zf.mkdir(f"{TOP}/{rel_prefix}".rstrip("/"))
                for dp, dns, fns in os.walk(base):
                    d = Path(dp)
                    rel_dir = rel_prefix if d == base else f"{rel_prefix}/{d.relative_to(base).as_posix()}"
                    keep = []
                    for dn in dns:
                        rel = f"{rel_dir}/{dn}".strip("/")
                        if filt is not None:
                            if filt(rel, True):
                                continue
                        keep.append(dn)
                        if rel.isascii():
                            zf.mkdir(f"{TOP}/{rel}")
                        else:
                            long_dirs.append(rel)
                    dns[:] = keep
                    for fn in fns:
                        rel = f"{rel_dir}/{fn}".strip("/")
                        if filt is not None and filt(rel, False):
                            continue
                        add(d / fn, rel)

            # 3a) cây dự án (có lọc)
            for entry in sorted(ROOT.iterdir(), key=lambda p: p.name):
                rel = entry.name
                if excluded(rel, entry.is_dir()) or (entry.is_dir() and rel == "node_modules"):
                    continue
                if entry.is_dir():
                    add_tree(entry, rel, excluded)
                else:
                    add(entry, rel)
            # 3b) dữ liệu chụp
            add(db_snap, "data/dotaka.db")
            if pg_snap.exists():
                add_tree(pg_snap, "services/zl-crm/data/pgdata")
            # 3c) PostgreSQL đóng gói sẵn + runtime Visual C++ (app-local)
            if (pg_home / "bin").exists():
                def pg_filter(rel: str, is_dir: bool) -> bool:
                    n = rel.rsplit("/", 1)[-1].lower()
                    return (not is_dir) and (n.startswith(("wx",)) or n.endswith(".pdb"))
                for sub in ("bin", "lib", "share"):
                    add_tree(pg_home / sub, f"runtime/pgsql/{sub}", pg_filter)
                for dll in ("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"):
                    p = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / dll
                    if p.exists():
                        add(p, f"runtime/pgsql/bin/{dll}")
            # 3d) thông tin gói
            try:
                commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
                dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
            except OSError:
                commit, dirty = "", None
            info = {"createdAt": datetime.now().isoformat(timespec="seconds"), "gitCommit": commit, "workingTreeDirty": dirty,
                    "files": count, "bytesUncompressed": size, "sqlite": db_info, "requires": "Windows 10/11 x64, Internet khi cài, winget"}
            if long_files:
                zf.writestr(f"{TOP}/_restore/manifest.json", json.dumps({"files": long_files, "dirs": long_dirs}, ensure_ascii=True, indent=1))
            zf.writestr(f"{TOP}/PACKAGE-INFO.json", json.dumps(info, ensure_ascii=False, indent=2))
        print(f"  {count} tệp, {size / 1e9:.2f} GB gốc, {time.time() - t0:.0f}s")

        print("4/5 Kiểm tra CRC toàn bộ zip...")
        with zipfile.ZipFile(part) as zf:
            bad = zf.testzip()
            names = set(zf.namelist())
        if bad:
            sys.exit(f"ZIP LỖI tại {bad}")
        required = ["INSTALL.cmd", "start-taki.cmd", "CAI-DAT.md", "_restore/manifest.json", "package.json", "pnpm-lock.yaml", ".env", "data/dotaka.db",
                    "scripts/install-windows.ps1", "scripts/bootstrap.mjs", "runtime/pgsql/bin/pg_ctl.exe", "runtime/pgsql/bin/postgres.exe",
                    "services/zl-crm/data/pgdata/PG_VERSION", "services/zl-crm/backend/.env", "services/zl-crm/backend/node_modules/.package-lock.json",
                    "services/video-ai/LivePortrait/pretrained_weights/liveportrait/landmark.onnx",
                    "services/video-ai/LivePortrait/pretrained_weights/mediapipe/face_landmarker.task",
                    "services/video-ai/MoneyPrinterTurbo/config.toml", "services/video-ai/remotion-news/package.json"]
        missing = [r for r in required if f"{TOP}/{r}" not in names]
        if missing:
            sys.exit("THIẾU trong gói: " + ", ".join(missing))
        part.replace(zip_path)

        print("5/5 SHA-256...")
        h = hashlib.sha256()
        with open(zip_path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        (out_dir / (zip_path.name + ".sha256")).write_text(f"{h.hexdigest()} *{zip_path.name}\n")
        print(f"\nXONG: {zip_path}  ({zip_path.stat().st_size / 1e9:.2f} GB)\nSHA-256: {h.hexdigest()}")
        if skipped:
            print(f"\n!! {len(skipped)} tệp không đọc được (bị khóa/không có quyền):")
            for s in skipped[:30]:
                print("  -", s)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if part.exists():
            part.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
