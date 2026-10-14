#!/usr/bin/env python3
"""Tra đường dẫn tài nguyên trong kho. Kho ở đâu do cau-hinh.json quyết định,
biến môi trường VIDEOKIT ghi đè được."""
import os, functools
import config

SUB = ["", "fonts", "sfx", "music", "grids", "overlays", "luts",
       "characters", "titles", "cards", "nguon", "presets"]


KEM_THEO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "kho")


def kho():
    """Thứ tự tìm: biến môi trường VIDEOKIT → cau-hinh.json → kho đi kèm trong gói.

    Bản bán kèm kho giải nén ra `<skill>/kho`. Nếu đường dẫn trong cấu hình chưa có
    mà kho đi kèm thì có, dùng luôn kho đi kèm — người mua chạy được ngay, không
    phải sửa gì.
    """
    mt = os.environ.get("VIDEOKIT")
    if mt:
        return os.path.expanduser(mt)
    d = os.path.expanduser(config.lay("kho", "duong_dan",
                                      mac_dinh="~/Movies/VideoKit-Free"))
    if not os.path.isdir(d) and os.path.isdir(KEM_THEO):
        return KEM_THEO
    return d


@functools.lru_cache(maxsize=None)
def find(ten):
    """Tìm theo tên file. Không thấy thì báo rõ đã tìm ở đâu."""
    k = kho()
    for s in SUB:
        p = os.path.join(k, s, ten)
        if os.path.exists(p):
            return p
    if not os.path.isdir(k):
        raise FileNotFoundError(
            f"Chưa có kho tài nguyên ở {k}.\n"
            f"Dựng kho: python3 scripts/dung_kho.py ~/Movies/VideoKit-Free\n"
            f"Hoặc sửa 'kho.duong_dan' trong cau-hinh.json cho trỏ đúng chỗ.")
    raise FileNotFoundError(f"Không thấy '{ten}' trong {k} (đã tìm: {', '.join(s or '.' for s in SUB[1:])})")


def font(vai_tro):
    """font('phu_de') -> đường dẫn font phụ đề trong cau-hinh.json"""
    ten = config.lay("chu", vai_tro)
    if not ten:
        raise KeyError(f"cau-hinh.json chưa khai font cho vai trò '{vai_tro}'")
    return find(ten)


VAI_FONT = ("phu_de", "title_to", "bia", "than", "serif")


def ten_font(vai_tro):
    """ten_font('bia') -> 'BarlowCondensed-Black.ttf' — tên tệp nằm trong <kho>/fonts,
    dùng cho drawtext của ffmpeg. Báo lỗi rõ nếu tệp không nằm trong fonts/."""
    p = font(vai_tro)
    if os.path.basename(os.path.dirname(p)) != "fonts":
        raise FileNotFoundError(f"Font '{os.path.basename(p)}' phải nằm trong {kho()}/fonts")
    return os.path.basename(p)


@functools.lru_cache(maxsize=None)
def ten_ass(vai_tro):
    """ten_ass('phu_de') -> 'Be Vietnam Pro Black' — tên đầy đủ đọc từ bảng name của font,
    để phụ đề ASS (libass) tìm đúng font trong fontsdir. Không cần cài thêm thư viện."""
    import struct
    d = open(font(vai_tro), "rb").read()
    n = struct.unpack(">H", d[4:6])[0]
    for i in range(n):
        o = 12 + i * 16
        if d[o:o + 4] == b"name":
            vt = struct.unpack(">I", d[o + 8:o + 12])[0]
            break
    else:
        raise ValueError("font không có bảng name")
    dem, kho_chu = struct.unpack(">HH", d[vt + 2:vt + 6])
    ten = {}
    for i in range(dem):
        pid, eid, lid, nid, dai, off = struct.unpack(">HHHHHH", d[vt + 6 + i * 12:vt + 18 + i * 12])
        if nid in (1, 4) and pid == 3 and lid == 0x409:
            ten[nid] = d[vt + kho_chu + off:vt + kho_chu + off + dai].decode("utf-16-be")
    if not ten:
        raise ValueError("font không có tên tiếng Anh (Windows)")
    return ten.get(4) or ten[1]


def preset(loai):
    """preset('kieu-chu') -> danh sách mẫu trong presets/kieu-chu.json"""
    import json
    return json.load(open(find(f"{loai}.json"), encoding="utf-8"))


def kiem_tra():
    """Soát kho trước khi dựng. Trả về danh sách thiếu."""
    thieu = []
    k = kho()
    if not os.path.isdir(k):
        return [f"không có thư mục kho: {k}"]
    for vai in VAI_FONT:
        try:
            font(vai)
        except (FileNotFoundError, KeyError) as e:
            thieu.append(f"font {vai}: {e}")
    for s in ("fonts", "sfx", "music", "grids", "overlays", "presets"):
        d = os.path.join(k, s)
        if not os.path.isdir(d) or not os.listdir(d):
            thieu.append(f"thư mục rỗng hoặc thiếu: {s}/")
    for f in ("kieu-chu.json", "chuyen-canh.json", "canh-tram.json",
              "do-am-luong.json"):
        if not os.path.exists(os.path.join(k, "presets", f)):
            thieu.append(f"thiếu presets/{f}")
    return thieu


if __name__ == "__main__":
    print("Kho:", kho())
    t = kiem_tra()
    if t:
        print("\nTHIẾU:")
        for x in t:
            print("  -", x)
    else:
        print("kho đủ dùng")
        for s in SUB[1:]:
            d = os.path.join(kho(), s)
            if os.path.isdir(d):
                print(f"  {s:12} {len(os.listdir(d)):4} file")
