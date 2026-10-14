#!/usr/bin/env python3
"""Tự kiểm cả gói skill trước khi bàn giao. Ba lượt: tài liệu · mã nguồn · kho.

    python3 tu_kiem.py [--kho <thư-mục>]

Trả mã thoát 1 nếu còn lỗi nặng.
"""
import os, sys, json, ast, struct, wave, zlib, re
import subprocess as sp

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(SKILL, "scripts")
sys.path.insert(0, SCRIPTS)

LOI, CANH = [], []


def loi(l, m):
    LOI.append(f"[{l}] {m}")


def canh(l, m):
    CANH.append(f"[{l}] {m}")


def muc(t):
    print(f"\n{t}")
    print("─" * len(t))


# ------------------------------------------------------------- lượt 1: tài liệu

def luot1():
    muc("LƯỢT 1 — Tài liệu và cấu hình")
    can = ["SKILL.md", "BAT-DAU.md", "CAI-DAT.md", "cau-hinh.json"]
    for f in can:
        p = os.path.join(SKILL, f)
        if not os.path.exists(p):
            loi("tài liệu", f"thiếu {f}")
        elif os.path.getsize(p) < 200:
            loi("tài liệu", f"{f} quá ngắn ({os.path.getsize(p)} byte)")
    print(f"  file gốc      : {sum(os.path.exists(os.path.join(SKILL, f)) for f in can)}/{len(can)}")

    # frontmatter của SKILL.md
    p = os.path.join(SKILL, "SKILL.md")
    if os.path.exists(p):
        s = open(p, encoding="utf-8").read()
        if not s.startswith("---\n"):
            loi("SKILL.md", "thiếu frontmatter YAML")
        else:
            fm = s.split("---", 2)[1]
            for k in ("name:", "description:"):
                if k not in fm:
                    loi("SKILL.md", f"frontmatter thiếu {k}")
            m = re.search(r"^description:\s*(.+?)(?=\n\w+:|\Z)", fm, re.S | re.M)
            if m:
                d = " ".join(m.group(1).split())
                print(f"  mô tả skill   : {len(d)} ký tự")
                if len(d) < 60:
                    canh("SKILL.md", "mô tả quá ngắn, Claude khó biết khi nào dùng")
                if len(d) > 1024:
                    loi("SKILL.md", f"mô tả dài quá ({len(d)} > 1024)")
            m = re.search(r"^name:\s*(\S+)", fm, re.M)
            if m and m.group(1) != os.path.basename(SKILL):
                loi("SKILL.md", f"name '{m.group(1)}' khác tên thư mục '{os.path.basename(SKILL)}'")

    # reference đủ và được trỏ tới
    ref = os.path.join(SKILL, "reference")
    ds = sorted(f for f in os.listdir(ref)) if os.path.isdir(ref) else []
    print(f"  reference/    : {len(ds)} tài liệu")
    if not ds:
        loi("reference", "rỗng")
    van = "\n".join(open(os.path.join(SKILL, f), encoding="utf-8").read()
                    for f in can if os.path.exists(os.path.join(SKILL, f)))
    for f in ds:
        if f not in van and f not in "".join(
                open(os.path.join(ref, x), encoding="utf-8").read() for x in ds):
            canh("reference", f"{f} không được tài liệu nào trỏ tới")

    # cấu hình
    try:
        c = json.load(open(os.path.join(SKILL, "cau-hinh.json"), encoding="utf-8"))
        import config
        cfg = config.tai()
        thieu = [k for k in config.MAC_DINH if k not in cfg]
        if thieu:
            loi("cấu hình", f"thiếu nhóm: {thieu}")
        print(f"  cau-hinh.json : {len(c)} nhóm, đọc được")
    except Exception as e:
        loi("cấu hình", f"không đọc được: {e}")


# ------------------------------------------------------------- lượt 2: mã nguồn

def luot2():
    muc("LƯỢT 2 — Mã nguồn")
    ds = sorted(f for f in os.listdir(SCRIPTS) if f.endswith(".py"))
    print(f"  script        : {len(ds)}")

    for f in ds:
        p = os.path.join(SCRIPTS, f)
        s = open(p, encoding="utf-8").read()
        try:
            t = ast.parse(s)
        except SyntaxError as e:
            loi("cú pháp", f"{f} dòng {e.lineno}: {e.msg}")
            continue
        # đường dẫn ghi cứng
        for m in re.finditer(r'["\'](~?/(?:Users|Movies|Volumes)/[^"\']*)["\']', s):
            d = m.group(1)
            if "VideoKit" in d and f in ("kit.py", "config.py", "tu_kiem.py", "dung_kho.py"):
                continue
            loi("đường dẫn", f"{f} ghi cứng: {d}")
        # chạy việc ngay khi import
        if f in ("tu_kiem.py",):
            continue
        co_main = any(isinstance(n, ast.If) and ast.dump(n.test).find("__main__") >= 0
                      for n in t.body)
        thi_hanh = [n for n in t.body
                    if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                    and not (isinstance(n.value.func, ast.Attribute)
                             and n.value.func.attr in ("insert", "append"))]
        if thi_hanh and not co_main:
            loi("tác dụng phụ", f"{f} chạy việc ngay khi import (dòng {thi_hanh[0].lineno})")

    # nạp thật
    for f in ds:
        if f == "tu_kiem.py":
            continue
        r = sp.run([sys.executable, "-c",
                    f"import sys;sys.path.insert(0,{SCRIPTS!r});"
                    f"import importlib.util as u;"
                    f"sp=u.spec_from_file_location('m',{os.path.join(SCRIPTS,f)!r});"
                    f"m=u.module_from_spec(sp);sp.loader.exec_module(m)"],
                   capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            loi("nạp", f"{f}: {r.stderr.strip().splitlines()[-1][:90]}")
        elif r.stdout.strip():
            loi("tác dụng phụ", f"{f} in ra màn hình khi import: {r.stdout.strip()[:60]}")
    print(f"  nạp sạch      : {len(ds) - 1 - sum('nạp' in x or 'tác dụng phụ' in x for x in LOI)}/{len(ds)-1}")

    # công cụ ngoài
    for cc in ("ffmpeg", "ffprobe"):
        if sp.run(["which", cc], capture_output=True).returncode != 0:
            loi("phụ thuộc", f"thiếu {cc}")
    print(f"  ffmpeg        : {'có' if not any('ffmpeg' in x for x in LOI) else 'THIẾU'}")


# ------------------------------------------------------------- lượt 3: kho

VN = [0x1EAB, 0x1EF1, 0x1EE1, 0x1EB1, 0x0110, 0x1EC7, 0x1EE3, 0x1EF9]


def luot3(kho=None):
    muc("LƯỢT 3 — Kho tài nguyên")
    import kit, config
    k = os.path.expanduser(kho or kit.kho())
    print(f"  kho           : {k}")
    if not os.path.isdir(k):
        loi("kho", f"không có: {k}")
        return

    # font
    import dung_kho
    fd = os.path.join(k, "fonts")
    fs = [f for f in os.listdir(fd) if f.lower().endswith((".ttf", ".otf"))] \
        if os.path.isdir(fd) else []
    xau = []
    for f in fs:
        t = dung_kho.co_tieng_viet(os.path.join(fd, f))
        if t:
            xau.append((f, "".join(chr(c) for c in t)))
        elif t is None:
            canh("font", f"{f}: không đọc được cmap")
    print(f"  font          : {len(fs)}  ·  thiếu dấu: {len(xau)}")
    for f, m in xau:
        loi("font", f"{f} thiếu dấu tiếng Việt: {m}")
    if not os.path.exists(os.path.join(fd, "OFL-anton.txt")) and fs:
        canh("font", "không thấy file giấy phép OFL-*.txt")

    # font trong cấu hình phải tồn tại
    for vai in ("phu_de", "title_to", "bia"):
        try:
            kit.font(vai)
        except Exception as e:
            loi("cấu hình", f"font '{vai}': {str(e).splitlines()[0][:80]}")

    # âm thanh
    for t, nho_nhat in (("sfx", 1000), ("music", 100000)):
        d = os.path.join(k, t)
        if not os.path.isdir(d):
            loi("kho", f"thiếu {t}/")
            continue
        fs = [f for f in os.listdir(d) if f.endswith((".wav", ".m4a", ".mp3"))]
        hong = 0
        for f in fs:
            p = os.path.join(d, f)
            if os.path.getsize(p) < nho_nhat:
                loi(t, f"{f} quá nhỏ ({os.path.getsize(p)} byte)"); hong += 1; continue
            if f.endswith(".wav"):
                try:
                    with wave.open(p) as w:
                        if w.getnframes() == 0:
                            loi(t, f"{f} không có mẫu nào"); hong += 1
                except Exception as e:
                    loi(t, f"{f} hỏng: {e}"); hong += 1
        print(f"  {t:14}: {len(fs)}  ·  hỏng: {hong}")
        if not fs:
            loi("kho", f"{t}/ rỗng")

    # ảnh PNG
    for t in ("grids", "overlays"):
        d = os.path.join(k, t)
        fs = [f for f in os.listdir(d) if f.endswith(".png")] if os.path.isdir(d) else []
        hong = 0
        for f in fs:
            b = open(os.path.join(d, f), "rb").read(33)
            if b[:8] != b"\x89PNG\r\n\x1a\n":
                loi(t, f"{f} không phải PNG"); hong += 1; continue
            w, h = struct.unpack(">II", b[16:24])
            if (w, h) != (1080, 1920):
                loi(t, f"{f} sai kích thước {w}×{h}, phải 1080×1920"); hong += 1
        print(f"  {t:14}: {len(fs)}  ·  hỏng: {hong}")
        if not fs:
            loi("kho", f"{t}/ rỗng")

    # LUT
    d = os.path.join(k, "luts")
    fs = [f for f in os.listdir(d) if f.endswith(".cube")] if os.path.isdir(d) else []
    hong = 0
    for f in fs:
        dong = [l for l in open(os.path.join(d, f)) if l.strip()]
        cs = [l for l in dong if l.startswith("LUT_3D_SIZE")]
        if not cs:
            loi("lut", f"{f} thiếu LUT_3D_SIZE"); hong += 1; continue
        n = int(cs[0].split()[1])
        so = [l for l in dong if re.match(r"^[\d.]+\s", l)]
        if len(so) != n ** 3:
            loi("lut", f"{f} có {len(so)} dòng, phải {n**3}"); hong += 1
    print(f"  luts          : {len(fs)}  ·  hỏng: {hong}")

    # preset
    d = os.path.join(k, "presets")
    fs = [f for f in os.listdir(d) if f.endswith(".json")] if os.path.isdir(d) else []
    tong = 0
    do_file = 0
    for f in fs:
        try:
            dl = json.load(open(os.path.join(d, f), encoding="utf-8"))
        except Exception as e:
            loi("preset", f"{f} hỏng: {e}"); continue
        if isinstance(dl, list):
            tong += len(dl)
            thieu = [i for i, x in enumerate(dl) if not isinstance(x, dict) or "ten" not in x]
            if thieu:
                loi("preset", f"{f} có {len(thieu)} mục thiếu khoá 'ten'")
            ten = [x["ten"] for x in dl if isinstance(x, dict) and "ten" in x]
            if len(ten) != len(set(ten)):
                loi("preset", f"{f} có tên trùng")
        elif isinstance(dl, dict) and "file" in dl:
            # bảng đo âm lượng
            do_file = len(dl["file"])
            xau = [k for k, v in dl["file"].items()
                   if not all(x in v for x in ("giay", "rms_db", "dinh_db"))]
            if xau:
                loi("preset", f"{f}: {len(xau)} mục thiếu số đo")
            qua_to = [k for k, v in dl["file"].items() if v.get("dinh_db", -99) > -0.5]
            if qua_to:
                loi("preset", f"{f}: {len(qua_to)} file đỉnh sát 0 dBFS, dễ vỡ tiếng")
            lech = [k for k, v in dl["file"].items()
                    if abs(v.get("rms_db", -20) - dl.get("chuan_rms_db", -20)) > 5.0]
            if lech:
                canh("preset", f"{f}: {len(lech)} file lệch RMS quá 5 dB — "
                     "tiếng gõ ngắn bị kẹp đỉnh thì thấp hơn là đúng, "
                     "bảng đo ghi số thật nên lúc trộn tự bù")
        else:
            loi("preset", f"{f}: cấu trúc lạ, không phải danh sách mẫu hay bảng đo")
    print(f"  presets       : {len(fs)} file  ·  {tong} mẫu"
          + (f"  ·  {do_file} file đã đo" if do_file else ""))

    # giấy phép
    if not os.path.exists(os.path.join(k, "GIAY-PHEP.md")):
        loi("kho", "thiếu GIAY-PHEP.md — không đóng gói phát tán được")

    tong_b = sum(os.path.getsize(os.path.join(r, f))
                 for r, _, fs2 in os.walk(k) for f in fs2)
    dem = sum(len(fs2) for _, _, fs2 in os.walk(k))
    print(f"  TỔNG          : {dem} file  ·  {tong_b/1024/1024:.0f} MB")


def main():
    kho = None
    if "--kho" in sys.argv:
        kho = sys.argv[sys.argv.index("--kho") + 1]
    print(f"Tự kiểm gói: {SKILL}")
    luot1(); luot2(); luot3(kho)
    muc("KẾT QUẢ")
    if LOI:
        print(f"  {len(LOI)} LỖI:")
        for x in LOI:
            print("   ✗", x)
    if CANH:
        print(f"  {len(CANH)} cảnh báo:")
        for x in CANH:
            print("   !", x)
    if not LOI:
        print("  Không lỗi — đóng gói được." if not CANH
              else "  Không lỗi nặng — đóng gói được.")
    return 1 if LOI else 0


if __name__ == "__main__":
    sys.exit(main())
