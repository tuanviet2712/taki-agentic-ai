#!/usr/bin/env python3
"""Đọc cau-hinh.json. Thiếu khoá nào thì lấy mặc định, không nổ."""
import json, os, functools

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(os.path.dirname(HERE), "cau-hinh.json")

MAC_DINH = {
    "kenh": {"ten": "", "seri": "", "ngon_ngu": "vi"},
    "kho": {"duong_dan": "~/Movies/VideoKit"},
    "chu": {"phu_de": "BeVietnamPro-Black.ttf", "title_to": "Anton-Regular.ttf",
            "bia": "BarlowCondensed-Black.ttf", "than": "BeVietnamPro-Bold.ttf",
            "serif": "Lora-Italic-Var.ttf"},
    "mau": {"nhan": "#FFD200", "chu_chinh": "#FFFFFF",
            "nen_card": "#0E0E12", "vien": "#000000"},
    "logo": {"duong_dan": ""},
    "quay": {"may": "", "profile_mau": "thuong"},
    "dung": {"toc_do": 1.1, "giu_nghi": 0.20, "giu_nghi_dai": 0.28,
             "nguong_lang": 0.33, "khung_hinh": 30, "kich_thuoc": [1080, 1920]},
    "am_thanh": {"giong": -16, "nhac": -34, "nhan": -27, "chuyen_canh": -30,
                 "giao_dien": -29, "dich_cuoi": -15.5, "dinh_that": -2.0},
    "bia": {"kieu": "hai-dong", "cat_tiktok": [240, 1680], "le_duoi": 100,
            "mo_tu_y": 880},
    "ban_giao": {"thu_muc": "~/Downloads", "moi_video_mot_thu_muc": True},
}


@functools.lru_cache(maxsize=1)
def tai():
    cfg = {k: dict(v) if isinstance(v, dict) else v for k, v in MAC_DINH.items()}
    if os.path.exists(FILE):
        try:
            nguoi_dung = json.load(open(FILE, encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise SystemExit(f"cau-hinh.json hỏng ở dòng {e.lineno}: {e.msg}")
        for k, v in nguoi_dung.items():
            if k.startswith("_"):
                continue
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update({a: b for a, b in v.items() if not a.startswith("_")})
            else:
                cfg[k] = v
    return cfg


def lay(*duong, mac_dinh=None):
    """lay('am_thanh','giong') -> -16"""
    o = tai()
    for d in duong:
        if not isinstance(o, dict) or d not in o:
            return mac_dinh
        o = o[d]
    return o


def dung_lut():
    return lay("quay", "profile_mau") == "dlog"


if __name__ == "__main__":
    c = tai()
    print(f"Kênh   : {c['kenh']['ten'] or '(chưa đặt)'}")
    print(f"Kho    : {c['kho']['duong_dan']}")
    print(f"Phụ đề : {c['chu']['phu_de']}")
    print(f"Màu    : {c['mau']['nhan']}")
    print(f"LUT    : {'có' if dung_lut() else 'không (quay profile thường)'}")
