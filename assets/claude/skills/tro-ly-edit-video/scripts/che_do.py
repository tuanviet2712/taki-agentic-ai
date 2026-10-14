#!/usr/bin/env python3
"""Thông số theo sức máy. Máy yếu vẫn chạy được, chỉ chậm hơn hoặc nhẹ hơn."""
import os, subprocess as sp
import config

BANG = {
    # chế độ:   (model nhận dạng,          preset x264, crf, lọc nặng, tỉ lệ dựng)
    "nhanh": ("mlx-community/whisper-small-mlx",           "veryfast", 24, False, 1),
    "chuan": ("mlx-community/whisper-large-v3-turbo",      "medium",   20, True,  1),
    "ky":    ("mlx-community/whisper-large-v3-turbo",      "slow",     18, True,  2),
}


def suc_may():
    """Đọc chip và RAM để gợi ý chế độ."""
    try:
        chip = sp.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                      capture_output=True, text=True).stdout.strip()
        ram = int(sp.run(["sysctl", "-n", "hw.memsize"],
                         capture_output=True, text=True).stdout.strip()) // (1024 ** 3)
        loi = int(sp.run(["sysctl", "-n", "hw.ncpu"],
                         capture_output=True, text=True).stdout.strip())
    except Exception:
        return {"chip": "?", "ram": 0, "loi": 0, "goi_y": "nhanh"}
    apple = "Apple" in chip
    if not apple or ram <= 8:
        goi_y = "nhanh"
    elif ram >= 32:
        goi_y = "ky"
    else:
        goi_y = "chuan"
    return {"chip": chip, "ram": ram, "loi": loi, "apple": apple, "goi_y": goi_y}


def hien_tai():
    cd = config.lay("may", "che_do", mac_dinh="chuan")
    if cd not in BANG:
        cd = "chuan"
    m, preset, crf, nang, _ = BANG[cd]
    return {"che_do": cd, "model": m, "preset": preset, "crf": crf, "loc_nang": nang}


def tham_so_xuat():
    """Cờ ffmpeg cho lần xuất cuối."""
    t = hien_tai()
    return ["-c:v", "libx264", "-preset", t["preset"], "-crf", str(t["crf"]),
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart"]


if __name__ == "__main__":
    m = suc_may()
    t = hien_tai()
    print(f"Máy      : {m['chip']}  ·  {m['ram']} GB RAM  ·  {m['loi']} lõi")
    print(f"Gợi ý    : {m['goi_y']}")
    print(f"Đang đặt : {t['che_do']}")
    print(f"  nhận dạng : {t['model'].split('/')[-1]}")
    print(f"  xuất      : preset {t['preset']}, crf {t['crf']}")
    print(f"  lọc nặng  : {'có' if t['loc_nang'] else 'không'}")
    if m["goi_y"] != t["che_do"]:
        print(f"\n→ Nên đổi may.che_do thành \"{m['goi_y']}\" trong cau-hinh.json")
