#!/usr/bin/env python3
"""Đóng gói skill thành một file zip đem bán/bàn giao được.

    python3 dong_goi.py [thư-mục-ra] [--kem-kho]

Mặc định KHÔNG kèm kho tài nguyên — người mua tự dựng bằng dung_kho.py (kho sạch
bản quyền, tự sinh). --kem-kho thì đóng cả kho vào, chỉ dùng khi kho đó do
dung_kho.py sinh ra; kho có font/nhạc mua ngoài thì KHÔNG được đóng kèm.
"""
import os, sys, zipfile, json, hashlib, shutil

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BO_QUA = {".venv", "__pycache__", ".DS_Store", ".git", "node_modules"}
BO_DUOI = {".pyc", ".log"}


def nen_duoc(duong):
    p = duong.split(os.sep)
    if any(x in BO_QUA for x in p):
        return False
    return os.path.splitext(duong)[1] not in BO_DUOI


def gom(goc, tien_to, z, dem):
    for r, ds, fs in os.walk(goc):
        ds[:] = [d for d in ds if d not in BO_QUA]
        for f in fs:
            p = os.path.join(r, f)
            rel = os.path.relpath(p, goc)
            if not nen_duoc(rel):
                continue
            z.write(p, os.path.join(tien_to, rel))
            dem[0] += 1
            dem[1] += os.path.getsize(p)


def kiem_truoc_khi_goi():
    """Chặn đóng gói khi thiếu file hoặc lỡ nhét hàng có bản quyền."""
    loi = []
    for f in ("SKILL.md", "CAI-DAT.md", "BAT-DAU.md", "cau-hinh.json"):
        if not os.path.exists(os.path.join(SKILL, f)):
            loi.append(f"thiếu {f}")
    for f in ("kit.py", "config.py", "che_do.py", "dung_kho.py", "plan.py",
              "build.py", "check.py", "thumb.py"):
        if not os.path.exists(os.path.join(SKILL, "scripts", f)):
            loi.append(f"thiếu scripts/{f}")
    if not os.path.isdir(os.path.join(SKILL, "reference")) or \
       not os.listdir(os.path.join(SKILL, "reference")):
        loi.append("reference/ rỗng")
    # không được lẫn tài nguyên vào trong skill
    for r, ds, fs in os.walk(SKILL):
        ds[:] = [d for d in ds if d not in BO_QUA]
        for f in fs:
            if os.path.splitext(f)[1].lower() in (".otf", ".ttf", ".mp3", ".wav",
                                                  ".m4a", ".mp4", ".mov", ".cube"):
                loi.append(f"tài nguyên lẫn trong skill: {os.path.relpath(os.path.join(r, f), SKILL)}")
    try:
        json.load(open(os.path.join(SKILL, "cau-hinh.json"), encoding="utf-8"))
    except Exception as e:
        loi.append(f"cau-hinh.json hỏng: {e}")
    return loi


def main():
    ra_ds = [a for a in sys.argv[1:] if not a.startswith("-")]
    ra = os.path.expanduser(ra_ds[0] if ra_ds else "~/Downloads")
    kem = "--kem-kho" in sys.argv
    os.makedirs(ra, exist_ok=True)

    loi = kiem_truoc_khi_goi()
    if loi:
        print("KHÔNG đóng gói được:")
        for l in loi:
            print("  -", l)
        return 1

    ten = "tro-ly-edit-video"
    zip_ra = os.path.join(ra, f"{ten}{'-kem-kho' if kem else ''}.zip")
    dem = [0, 0]
    with zipfile.ZipFile(zip_ra, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        gom(SKILL, ten, z, dem)
        if kem:
            import config
            kho = os.path.expanduser(config.lay("kho", "duong_dan"))
            gp = os.path.join(kho, "GIAY-PHEP.md")
            if not os.path.exists(gp):
                print(f"KHÔNG kèm kho: {kho} không có GIAY-PHEP.md — "
                      "chỉ được đóng kèm kho do dung_kho.py sinh ra.")
                return 1
            gom(kho, f"{ten}/kho", z, dem)

    mb = dem[1] / 1024 / 1024
    bam = hashlib.sha256(open(zip_ra, "rb").read()).hexdigest()[:16]
    print(f"Đã đóng gói: {zip_ra}")
    print(f"  {dem[0]} file · {mb:.1f} MB chưa nén · "
          f"{os.path.getsize(zip_ra)/1024/1024:.1f} MB sau nén")
    print(f"  sha256: {bam}")
    print(f"  kho tài nguyên: {'có kèm' if kem else 'không kèm (người mua tự dựng)'}")
    print("\nNgười mua giải nén vào ~/.claude/skills/ rồi đọc BAT-DAU.md")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    sys.exit(main())
