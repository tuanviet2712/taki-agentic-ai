#!/usr/bin/env python3
"""Dựng kho tài nguyên sạch bản quyền — không lấy của ai.

  Font   : tải từ Google Fonts, giấy phép OFL (miễn phí thương mại, được phát tán lại),
           tự kiểm dấu tiếng Việt bằng cách đọc bảng cmap, thiếu dấu thì loại.
  Còn lại: SFX, nhạc nền, lưới, lớp phủ, LUT — tự tổng hợp bằng thuật toán.
  Preset : thư viện kiểu chữ / chuyển cảnh / cảnh trám dạng JSON.

    python3 dung_kho.py [thư-mục-kho] [--nhanh]
"""
import os, sys, math, wave, array, json, random, zlib, struct, urllib.request, urllib.parse
import subprocess as sp

SR = 48000
NHANH = "--nhanh" in sys.argv

# ================================================================== âm thanh

def ghi_wav(duong, mau, sr=SR):
    os.makedirs(os.path.dirname(duong), exist_ok=True)
    d = array.array("h", (max(-32767, min(32767, int(v * 32767))) for v in mau))
    with wave.open(duong, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(d.tobytes())


def chuan_hoa(x, dinh=0.89):
    m = max(abs(v) for v in x) or 1.0
    return [v * dinh / m for v in x]


def rms(x):
    return math.sqrt(sum(v * v for v in x) / len(x)) if x else 0.0


def chuan_rms(x, muc_db=-20.0, dinh_toi_da=0.89):
    """Chuẩn hoá theo RMS rồi kẹp đỉnh.

    Phải làm thế này chứ không chuẩn theo đỉnh: tiếng click 0,05s và tiếng vút 0,7s
    cùng đỉnh thì nghe chênh nhau rất xa. Và LUFS tích hợp vô dụng với tiếng ngắn
    hơn 0,4s — cổng chặn của EBU R128 coi nó là im lặng (đo ra -70 LUFS).
    """
    r = rms(x)
    if r <= 0:
        return x
    he_so = (10 ** (muc_db / 20.0)) / r
    y = [v * he_so for v in x]
    d = max(abs(v) for v in y) or 1.0
    if d > dinh_toi_da:
        y = [v * dinh_toi_da / d for v in y]
    return y


def bao(n, vao=0.01, ra=0.05, sr=SR):
    a, b = max(1, int(vao * sr)), max(1, int(ra * sr))
    e = [1.0] * n
    for i in range(min(a, n)):
        e[i] = i / a
    for i in range(min(b, n)):
        e[n - 1 - i] = min(e[n - 1 - i], i / b)
    return e


def loc_thap(x, cat, sr=SR):
    a = math.exp(-2 * math.pi * cat / sr); y = []; z = 0.0
    for v in x:
        z = v * (1 - a) + z * a; y.append(z)
    return y


def loc_cao(x, cat, sr=SR):
    return [v - u for v, u in zip(x, loc_thap(x, cat, sr))]


def on(n):
    return [random.uniform(-1, 1) for _ in range(n)]


# ------------------------------------------------------------ họ tiếng động

def vut(giay, lo, hi, cong=0.7):
    n = int(giay * SR); y = []; z = 0.0
    for i, v in enumerate(on(n)):
        t = i / n
        f = lo + (hi - lo) * math.sin(math.pi * t) ** cong
        a = math.exp(-2 * math.pi * f / SR)
        z = v * (1 - a) + z * a; y.append(z)
    y = loc_cao(y, 180)
    e = bao(n, 0.02, 0.22)
    h = [math.sin(math.pi * (i / n)) ** 1.4 for i in range(n)]
    return chuan_hoa([v * a * b for v, a, b in zip(y, e, h)], 0.85)


def click(giay, cat_tren, cat_duoi, rap=28):
    n = int(giay * SR)
    x = loc_cao(loc_thap(on(n), cat_tren), cat_duoi)
    e = [math.exp(-rap * i / n) for i in range(n)]
    return chuan_hoa([v * a for v, a in zip(x, e)], 0.7)


def bup(giay, f0, f1, rap):
    n = int(giay * SR); y = []
    for i in range(n):
        t = i / SR
        f = f0 * math.exp(-14 * t) + f1
        y.append(math.sin(2 * math.pi * f * t) * math.exp(-rap * t))
    return chuan_hoa(y, 0.75)


def tut(giay, f0, f1, rap):
    n = int(giay * SR); y = []; pha = 0.0
    for i in range(n):
        t = i / n
        f = f0 * math.exp(-3.2 * t) + f1
        pha += 2 * math.pi * f / SR
        y.append(math.sin(pha) * math.exp(-rap * t))
    return chuan_hoa([v * a for v, a in zip(y, bao(n, 0.004, 0.30))], 0.9)


def dang(giay, hi, run_toc):
    n = int(giay * SR); y = []; z = 0.0; pha = 0.0
    for i, v in enumerate(on(n)):
        t = i / n
        f = 480 + hi * t ** 2.2
        a = math.exp(-2 * math.pi * f / SR)
        z = v * (1 - a) + z * a
        fs = 180 + 900 * t ** 3
        pha += 2 * math.pi * fs / SR
        r = 1 + 0.25 * math.sin(2 * math.pi * (3 + run_toc * t) * i / SR)
        y.append((z * 0.75 + math.sin(pha) * 0.3) * (t ** 1.7) * r)
    return chuan_hoa([v * a for v, a in zip(y, bao(n, 0.05, 0.02))], 0.85)


def dam(giay, f0, rap, bui_muc):
    n = int(giay * SR); y = []; pha = 0.0
    bui = loc_thap(on(n), 2600)
    for i in range(n):
        t = i / SR
        f = f0 * math.exp(-9 * t) + f0 * 0.48
        pha += 2 * math.pi * f / SR
        y.append(math.sin(pha) * math.exp(-rap * t) * 0.9 + bui[i] * math.exp(-26 * t) * bui_muc)
    return chuan_hoa(y, 0.92)


def chuong(giay, f, ti_le, rap):
    n = int(giay * SR); y = []
    for i in range(n):
        t = i / SR
        m = math.sin(2 * math.pi * f * ti_le * t) * 2.2 * math.exp(-7 * t)
        y.append(math.sin(2 * math.pi * f * t + m) * math.exp(-rap * t))
    return chuan_hoa([v * a for v, a in zip(y, bao(n, 0.002, 0.25))], 0.72)


def glitch(giay, thua):
    n = int(giay * SR); y = [0.0] * n; i = 0
    while i < n:
        d = random.randint(int(0.004 * SR), int(0.03 * SR))
        if random.random() < thua:
            khuc = loc_thap(on(d), random.choice([700, 1500, 2600, 5200]))
            b = random.uniform(0.3, 1.0)
            for j, v in enumerate(khuc):
                if i + j < n:
                    y[i + j] = v * b
        i += d
    e = [math.exp(-3.2 * i / n) for i in range(n)]
    return chuan_hoa([v * a for v, a in zip(y, e)], 0.7)


def go(giay, f, rap):
    n = int(giay * SR)
    return chuan_hoa([math.sin(2 * math.pi * f * i / SR) * math.exp(-rap * i / SR)
                      for i in range(n)], 0.6)


def bong_bong(giay):
    """Tiếng 'pop' nước, hợp với chữ nảy lên."""
    n = int(giay * SR); y = []; pha = 0.0
    for i in range(n):
        t = i / SR
        f = 300 + 2400 * (t / giay) ** 0.4
        pha += 2 * math.pi * f / SR
        y.append(math.sin(pha) * math.exp(-30 * t))
    return chuan_hoa(y, 0.7)


def dem_nhip(giay, f):
    """Tiếng đếm nhịp cho đoạn liệt kê."""
    n = int(giay * SR); y = []
    for i in range(n):
        t = i / SR
        y.append((math.sin(2 * math.pi * f * t) * 0.7
                  + math.sin(2 * math.pi * f * 2 * t) * 0.3) * math.exp(-40 * t))
    return chuan_hoa(y, 0.62)


def hoi_tho(giay):
    """Ồn dịu để lót nền cho khoảng chuyển yên tĩnh."""
    n = int(giay * SR)
    y = loc_thap(loc_cao(on(n), 300), 3000)
    h = [math.sin(math.pi * i / n) ** 1.2 for i in range(n)]
    return chuan_hoa([v * a for v, a in zip(y, h)], 0.5)


SFX_HO = {
    "vut":       [(f"vut-{i+1:02d}", lambda a=a: vut(*a)) for i, a in enumerate(
                    [(0.42, 300, 8000), (0.5, 250, 9000), (0.58, 200, 10000),
                     (0.36, 400, 7000), (0.66, 150, 12000), (0.75, 120, 13500),
                     (0.48, 350, 8500), (0.55, 280, 11000), (0.30, 500, 6500),
                     (0.85, 100, 14000)])],
    "click":     [(f"click-{i+1:02d}", lambda a=a: click(*a)) for i, a in enumerate(
                    [(0.05, 6000, 1200), (0.04, 8000, 2000), (0.06, 5000, 900),
                     (0.03, 9000, 2600), (0.07, 4200, 700), (0.045, 7000, 1600)])],
    "bup":       [(f"bup-{i+1:02d}", lambda a=a: bup(*a)) for i, a in enumerate(
                    [(0.16, 880, 180, 24), (0.12, 1200, 220, 30), (0.20, 660, 140, 18),
                     (0.10, 1600, 300, 36), (0.24, 520, 110, 15), (0.14, 1000, 200, 27)])],
    "subdrop":   [(f"subdrop-{i+1:02d}", lambda a=a: tut(*a)) for i, a in enumerate(
                    [(0.9, 150, 32, 3.0), (1.2, 180, 28, 2.4), (0.7, 130, 38, 3.8),
                     (1.5, 200, 25, 2.0), (0.6, 120, 42, 4.4)])],
    "dang-len":  [(f"dang-len-{i+1:02d}", lambda a=a: dang(*a)) for i, a in enumerate(
                    [(1.6, 7500, 26), (2.2, 8500, 20), (1.1, 6500, 32),
                     (2.8, 9500, 16), (1.35, 7000, 28), (3.4, 10500, 13)])],
    "dam":       [(f"dam-{i+1:02d}", lambda a=a: dam(*a)) for i, a in enumerate(
                    [(1.1, 92, 4.2, 0.45), (1.4, 76, 3.4, 0.35), (0.85, 110, 5.4, 0.55),
                     (1.8, 64, 2.8, 0.28), (0.7, 130, 6.2, 0.62)])],
    "chuong":    [(f"chuong-{i+1:02d}", lambda a=a: chuong(*a)) for i, a in enumerate(
                    [(1.4, 880, 1.34, 3.4), (1.8, 660, 1.41, 2.7), (1.1, 1180, 1.27, 4.2),
                     (2.2, 520, 2.01, 2.2), (1.0, 1480, 1.62, 4.8)])],
    "glitch":    [(f"glitch-{i+1:02d}", lambda a=a: glitch(*a)) for i, a in enumerate(
                    [(0.28, 0.62), (0.18, 0.75), (0.42, 0.5), (0.12, 0.85), (0.55, 0.42)])],
    "go-phim":   [(f"go-phim-{i+1:02d}", lambda a=a: go(*a)) for i, a in enumerate(
                    [(0.09, 2100, 60), (0.07, 2800, 75), (0.11, 1700, 48),
                     (0.06, 3400, 90)])],
    "bong-bong": [(f"bong-bong-{i+1:02d}", lambda a=a: bong_bong(a))
                  for i, a in enumerate((0.16, 0.22, 0.12, 0.28))],
    "dem-nhip":  [(f"dem-nhip-{i+1:02d}", lambda a=a: dem_nhip(*a)) for i, a in enumerate(
                    [(0.08, 660), (0.08, 880), (0.08, 990), (0.08, 1320), (0.08, 440)])],
    "hoi-tho":   [(f"hoi-tho-{i+1:02d}", lambda a=a: hoi_tho(a))
                 for i, a in enumerate((0.8, 1.4, 2.2))],
}

# ------------------------------------------------------------------- nhạc nền

MOOD = {
    "binh-yen":   ([0, 4, 7, 11], [0, -3, -5, -7]),
    "tap-trung":  ([0, 3, 7, 10], [0, 5, 3, -2]),
    "nang-luong": ([0, 4, 7, 14], [0, 7, 5, 9]),
    "suy-tu":     ([0, 3, 7, 10], [0, -2, -5, -4]),
    "hoi-hop":    ([0, 1, 7, 8],  [0, -1, 4, -3]),
    "tuoi-sang":  ([0, 4, 9, 14], [0, 5, 7, 2]),
}
TEMPO = {"cham": 58, "vua": 74, "nhanh": 96}


def nhac(mood, bpm, giay, cao):
    bac, vong = MOOD[mood]
    n = int(giay * SR); y = [0.0] * n
    nhip = 60.0 / bpm * 4
    for o in range(max(1, int(giay / nhip))):
        goc = vong[o % len(vong)] + cao
        d0 = int(o * nhip * SR)
        d1 = min(n, int((o + 1) * nhip * SR) + int(0.6 * SR))
        m = d1 - d0
        if m <= 0:
            continue
        e = bao(m, 0.35, 0.55)
        for b in bac:
            f = 440 * 2 ** ((45 + goc + b - 69) / 12)
            for lech in (-0.13, 0.0, 0.15):
                pha = random.uniform(0, 6.28)
                bien = 0.16 / len(bac)
                for i in range(m):
                    t = i / SR
                    lfo = 1 + 0.06 * math.sin(2 * math.pi * 0.13 * t + pha)
                    y[d0 + i] += math.sin(2 * math.pi * (f + lech) * t + pha) * bien * e[i] * lfo
        fb = 440 * 2 ** ((33 + goc - 69) / 12)
        for i in range(m):
            y[d0 + i] += math.sin(2 * math.pi * fb * i / SR) * 0.14 * e[i]
    return chuan_hoa(loc_cao(loc_thap(y, 3800), 32), 0.6)


# ==================================================================== ảnh PNG

def _khoi(loai, du):
    c = loai + du
    return struct.pack(">I", len(du)) + c + struct.pack(">I", zlib.crc32(c))


def ghi_png_dong(duong, w, h, dong_fn, chu_ky=None):
    """dong_fn(y) -> bytes RGBA của một hàng. chu_ky: hàng lặp lại sau bấy nhiêu dòng."""
    os.makedirs(os.path.dirname(duong), exist_ok=True)
    cache = {}
    ra = bytearray()
    for y in range(h):
        k = y % chu_ky if chu_ky else y
        d = cache.get(k)
        if d is None:
            d = dong_fn(y)
            if chu_ky:
                cache[k] = d
        ra.append(0); ra.extend(d)
    with open(duong, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(_khoi(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(_khoi(b"IDAT", zlib.compress(bytes(ra), 6)))
        f.write(_khoi(b"IEND", b""))


def rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


BANG_MAU = {
    "toi":      ("#0E0E12", "#2A2A38"),
    "sang":     ("#F5F5F3", "#D2D2CE"),
    "ban-ve":   ("#0B1A2B", "#1B3A5C"),
    "tim":      ("#160B26", "#3A1F5C"),
    "luc":      ("#07140F", "#1B4033"),
    "do":       ("#1A0A0C", "#4A1620"),
    "cam":      ("#1A1206", "#4D3212"),
    "lam":      ("#050B18", "#16305E"),
}


def _tron(c0, c1, k):
    return tuple(int(a + (b - a) * k) for a, b in zip(c0, c1))


def dong_cham(w, buoc, r, c0, c1):
    def f(y):
        dy = min(y % buoc, buoc - y % buoc)
        b = bytearray()
        for x in range(w):
            dx = min(x % buoc, buoc - x % buoc)
            k = max(0.0, min(1.0, (r - math.hypot(dx, dy)) / 1.3))
            b.extend(_tron(c0, c1, k)); b.append(255)
        return bytes(b)
    return f


def dong_ke(w, buoc, day, c0, c1):
    def f(y):
        dy = min(y % buoc, buoc - y % buoc)
        b = bytearray()
        for x in range(w):
            d = min(min(x % buoc, buoc - x % buoc), dy)
            k = max(0.0, min(1.0, (day - d) / 1.0))
            b.extend(_tron(c0, c1, k)); b.append(255)
        return bytes(b)
    return f


def dong_cheo(w, buoc, day, c0, c1):
    def f(y):
        b = bytearray()
        for x in range(w):
            v = (x + y) % buoc
            k = max(0.0, min(1.0, (day - min(v, buoc - v)) / 1.2))
            b.extend(_tron(c0, c1, k)); b.append(255)
        return bytes(b)
    return f


def dong_doc(w, h, c0, c1):
    def f(y):
        c = _tron(c0, c1, y / h)
        return bytes(c + (255,)) * w
    return f


def dong_toa(w, h, c0, c1):
    cx, cy = w / 2, h * 0.38
    rmax = math.hypot(max(cx, w - cx), max(cy, h - cy))
    def f(y):
        b = bytearray()
        for x in range(w):
            k = min(1.0, math.hypot(x - cx, y - cy) / rmax)
            b.extend(_tron(c0, c1, k)); b.append(255)
        return bytes(b)
    return f


def dong_hat(w, muc, alpha):
    def f(y):
        b = bytearray()
        for _ in range(w):
            c = max(0, min(255, 128 + random.randint(-muc, muc)))
            b.extend((c, c, c, alpha))
        return bytes(b)
    return f


def dong_vien_toi(w, h, muc, bat_dau):
    cx, cy = w / 2, h / 2
    rmax = math.hypot(cx, cy)
    def f(y):
        b = bytearray()
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / rmax
            a = int(muc * max(0.0, (d - bat_dau) / (1 - bat_dau)) ** 1.6)
            b.extend((0, 0, 0, min(255, a)))
        return bytes(b)
    return f


def dong_loe(w, h, mau, px, py, rong):
    r, g, bb = rgb(mau)
    def f(y):
        b = bytearray()
        for x in range(w):
            d = math.hypot((x - w * px) / (w * rong), (y - h * py) / (h * rong * 0.6))
            b.extend((r, g, bb, max(0, min(255, int(165 * math.exp(-3.2 * d * d))))))
        return bytes(b)
    return f


# ====================================================================== LUT

def viet_lut(ten, ham, buoc=17):
    d = [f'TITLE "{ten}"', f"LUT_3D_SIZE {buoc}", ""]
    for b in range(buoc):
        for g in range(buoc):
            for r in range(buoc):
                R, G, B = ham(r / (buoc - 1), g / (buoc - 1), b / (buoc - 1))
                d.append(f"{R:.6f} {G:.6f} {B:.6f}")
    return "\n".join(d) + "\n"


def kep(v):
    return max(0.0, min(1.0, v))


def lut_can_bang(am, tuong_phan, bao_hoa, nang_den):
    def f(r, g, b):
        r = r * (1 + am * 0.09); b = b * (1 - am * 0.09)
        r, g, b = (kep((v - 0.5) * (1 + tuong_phan * 0.22) + 0.5) for v in (r, g, b))
        x = (r + g + b) / 3
        r, g, b = (kep(x + (v - x) * (1 + bao_hoa * 0.3)) for v in (r, g, b))
        k = nang_den * 0.055
        return (kep(r * (1 - k) + k), kep(g * (1 - k) + k), kep(b * (1 - k) + k * 1.15))
    return f


def lut_xanh_cam(muc):
    def f(r, g, b):
        s = (r + g + b) / 3
        toi = max(0.0, 1 - s * 2)
        sang = max(0.0, s * 2 - 1)
        return (kep(r + sang * 0.07 * muc - toi * 0.04 * muc),
                kep(g + sang * 0.015 * muc),
                kep(b + toi * 0.09 * muc - sang * 0.05 * muc))
    return f


LUT_BO = {}
for _t, _am in [("am", 1.0), ("lanh", -1.0), ("trung", 0.0)]:
    for _c, _tp in [("diu", -0.5), ("vua", 0.4), ("manh", 1.2)]:
        LUT_BO[f"{_t}-{_c}"] = lut_can_bang(_am, _tp, 0.3, 0.0)
        LUT_BO[f"{_t}-{_c}-phim"] = lut_can_bang(_am, _tp, -0.4, 1.0)
for _i, _m in enumerate([0.5, 1.0, 1.6], 1):
    LUT_BO[f"xanh-cam-{_i}"] = lut_xanh_cam(_m)
LUT_BO["den-trang"] = lambda r, g, b: ((lambda x: (x, x, x))(kep(0.299 * r + 0.587 * g + 0.114 * b)))
LUT_BO["ruc-ro"] = lut_can_bang(0.2, 0.8, 1.6, 0.0)
LUT_BO["nhat-mem"] = lut_can_bang(0.1, -0.8, -0.5, 1.4)

# ================================================================ thư viện preset

def thu_vien_chu():
    """Công thức kiểu chữ. Rút từ phân tích bộ preset thương mại rồi dựng lại từ đầu."""
    mau = {"vang": "#FFD200", "trang": "#FFFFFF", "hong": "#FF4A60", "lam": "#5DA7FF",
           "luc": "#7CFF9E", "cam": "#FF8A3D", "tim": "#B47CFF", "chanh": "#E5FF89"}
    ra = []
    # viền chồng nhiều lớp, độ dày giảm dần
    for ten, c in mau.items():
        ra.append({"ten": f"vien-chong-{ten}", "kieu": "vien-chong",
                   "mau_chu": c, "vien": [{"mau": "#000000", "day": 17},
                                          {"mau": "#FFFFFF", "day": 11},
                                          {"mau": "#000000", "day": 5}],
                   "ghi_chu": "Ba lớp viền dày giảm dần tạo cảm giác nổi khối."})
    # title cắt khuyết
    for ten, c in list(mau.items())[:5]:
        ra.append({"ten": f"cat-khuyet-{ten}", "kieu": "cat-khuyet",
                   "mau_to": c, "mau_nho": "#FFFFFF", "lech_doc": 0.58,
                   "rong_toi_da": 0.72,
                   "ghi_chu": "Chữ nhỏ cắt xuyên GIỮA chữ to, không nằm trên/dưới."})
    # chữ to màu + chữ nhỏ lệch chéo
    for ten, c in list(mau.items())[:6]:
        ra.append({"ten": f"lech-cheo-{ten}", "kieu": "lech-cheo",
                   "mau_to": c, "mau_nho": "#FFFFFF", "lech_x": 0.14, "lech_y": -0.22,
                   "ghi_chu": "Lệch chéo, không lệch thẳng đứng."})
    # nền khối
    for ten, c in mau.items():
        ra.append({"ten": f"nen-khoi-{ten}", "kieu": "nen-khoi", "mau_nen": c,
                   "mau_chu": "#101014", "bo_goc": 14, "dem": [26, 14]})
    # phụ đề
    for ten, c in [("chuan", "#FFFFFF"), ("nhan-vang", "#FFD200"), ("nhan-luc", "#7CFF9E")]:
        ra.append({"ten": f"phu-de-{ten}", "kieu": "phu-de", "mau_chu": c,
                   "vien": [{"mau": "#000000", "day": 8}], "bong": {"lech": 3, "mo": 6}})
    # chip bước
    for ten, c in [("toi", "#101014"), ("vang", "#FFD200"), ("lam", "#5DA7FF")]:
        ra.append({"ten": f"chip-buoc-{ten}", "kieu": "chip", "mau_nen": c,
                   "mau_chu": "#FFFFFF" if ten == "toi" else "#101014",
                   "bo_goc": 999, "dem": [22, 10],
                   "ghi_chu": "Góc trên cho video quay màn hình."})
    return ra


def thu_vien_chuyen_canh():
    ra = []
    for ten, kieu, giay in [
            ("cat-thang", "cut", 0.0), ("mo-dan", "fade", 0.25), ("mo-trang", "fadewhite", 0.2),
            ("mo-den", "fadeblack", 0.3), ("truot-trai", "slideleft", 0.3),
            ("truot-phai", "slideright", 0.3), ("truot-len", "slideup", 0.3),
            ("truot-xuong", "slidedown", 0.3), ("lau-trai", "wipeleft", 0.28),
            ("lau-len", "wipeup", 0.28), ("tron-mo", "smoothleft", 0.35),
            ("tron-len", "smoothup", 0.35), ("vong-tron", "circleopen", 0.4),
            ("hinh-chu-nhat", "rectcrop", 0.35), ("xoay-vao", "circlecrop", 0.4),
            ("nhieu-hat", "pixelize", 0.3), ("chieu-sang", "fadegrays", 0.3),
            ("chia-doc", "vertopen", 0.35), ("chia-ngang", "horzopen", 0.35),
            ("cheo", "diagtl", 0.32)]:
        ra.append({"ten": ten, "xfade": kieu, "giay": giay,
                   "sfx_goi_y": "vut-01" if giay >= 0.28 else "click-01"})
    return ra


def thu_vien_canh_tram():
    return [
        {"ten": "so-sanh-truoc-sau", "mo_ta": "Hai cột trước/sau, cột phải sáng hơn"},
        {"ten": "tuong-chu-vs-dan-chung", "mo_ta": "Slide đặc chữ đối lại slide có số liệu"},
        {"ten": "luoi-anh-gom-khoi", "mo_ta": "Lưới ảnh nhỏ chạy về gom thành một khối"},
        {"ten": "cot-moc-dan", "mo_ta": "Biểu đồ cột mọc dần theo lời nói"},
        {"ten": "so-do-tu-duy", "mo_ta": "Nhánh toả ra từ một ý trung tâm"},
        {"ten": "gach-dau-dong", "mo_ta": "Từng gạch đầu dòng hiện theo mỗi cú nhấp"},
        {"ten": "so-sanh-hai-cong-cu", "mo_ta": "Bảng đối chiếu hai công cụ"},
        {"ten": "dong-thoi-gian", "mo_ta": "Mốc thời gian chạy ngang"},
        {"ten": "quy-trinh-buoc", "mo_ta": "Các bước nối bằng mũi tên"},
        {"ten": "so-lieu-lon", "mo_ta": "Một con số chiếm cả khung, chú thích nhỏ dưới"},
        {"ten": "danh-sach-kiem", "mo_ta": "Danh sách có dấu tích hiện dần"},
        {"ten": "trich-dan", "mo_ta": "Câu trích cỡ lớn trên nền tối"},
    ]


# ====================================================================== font

FONT_DIR = ["bevietnampro", "anton", "archivoblack", "bungee", "oswald", "montserrat",
            "lora", "spacegrotesk", "barlowcondensed", "exo2", "nunito", "quicksand",
            "playfairdisplay", "robotocondensed", "opensans", "inter", "merriweather",
            "sourcesans3", "worksans", "publicsans", "manrope", "chivo", "epilogue",
            "figtree", "karla", "outfit", "plusjakartasans", "raleway", "rubik", "sora",
            "urbanist", "baloo2", "alfaslabone", "bagelfatone", "fredoka", "lexend",
            "notosans", "roboto", "poppins", "mulish", "cabin", "asap", "archivo"]
GOC = "https://raw.githubusercontent.com/google/fonts/main/ofl"
API = "https://api.github.com/repos/google/fonts/contents/ofl"
UU_TIEN = ["Black", "ExtraBold", "Bold", "SemiBold", "Regular"]
VN = [0x1EAB, 0x1EF1, 0x1EE1, 0x1EB1, 0x0110, 0x1EC7, 0x1EE3, 0x1EF9]


def tai_ve(url, lan=3):
    """Tải qua curl — Python hệ thống trên macOS thường thiếu bộ chứng chỉ SSL."""
    for _ in range(lan):
        try:
            r = sp.run(["curl", "-sSL", "--max-time", "60", url],
                       capture_output=True, timeout=90)
            if r.returncode == 0 and r.stdout:
                return r.stdout
        except Exception:
            pass
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            return r.read()
    except Exception:
        return None


def liet_ke(thu_muc):
    d = tai_ve(f"{API}/{thu_muc}")
    if not d:
        return []
    try:
        return [x["name"] for x in json.loads(d) if x["name"].lower().endswith(".ttf")]
    except Exception:
        return []


def co_tieng_viet(duong):
    """Đọc bảng cmap. Trả về danh sách ký tự thiếu, [] là đủ, None là không đọc được."""
    try:
        d = open(duong, "rb").read()
        n = struct.unpack(">H", d[4:6])[0]
        vt = None
        for i in range(n):
            o = 12 + i * 16
            if d[o:o + 4] == b"cmap":
                vt = struct.unpack(">I", d[o + 8:o + 12])[0]; break
        if vt is None:
            return None
        nb = struct.unpack(">H", d[vt + 2:vt + 4])[0]
        chon = None
        for i in range(nb):
            o = vt + 4 + i * 8
            pid, eid, off = struct.unpack(">HHI", d[o:o + 8])
            if (pid, eid) in ((3, 10), (3, 1), (0, 4), (0, 3)):
                chon = vt + off
                if (pid, eid) == (3, 10):
                    break
        if chon is None:
            return None
        dinh = struct.unpack(">H", d[chon:chon + 2])[0]
        co = set()
        if dinh == 4:
            segx2 = struct.unpack(">H", d[chon + 6:chon + 8])[0]
            seg = segx2 // 2; e0 = chon + 14; s0 = e0 + segx2 + 2
            for i in range(seg):
                cuoi = struct.unpack(">H", d[e0 + i * 2:e0 + i * 2 + 2])[0]
                dau = struct.unpack(">H", d[s0 + i * 2:s0 + i * 2 + 2])[0]
                if cuoi == 0xFFFF:
                    continue
                for c in VN:
                    if dau <= c <= cuoi:
                        co.add(c)
        elif dinh == 12:
            ng = struct.unpack(">I", d[chon + 12:chon + 16])[0]
            for i in range(ng):
                o = chon + 16 + i * 12
                dau, cuoi, _ = struct.unpack(">III", d[o:o + 12])
                for c in VN:
                    if dau <= c <= cuoi:
                        co.add(c)
        else:
            return None
        return sorted(set(VN) - co)
    except Exception:
        return None


def tai_font(dich):
    os.makedirs(dich, exist_ok=True)
    giu, loai, hong = [], [], []
    for tm in FONT_DIR:
        ds = liet_ke(tm)
        if not ds:
            hong.append((tm, "không liệt kê được thư mục")); continue
        tinh = [f for f in ds if "[" not in f and "Italic" not in f]
        chon = []
        for u in UU_TIEN:
            chon += [f for f in tinh if f.endswith(f"-{u}.ttf")]
        if not chon:
            chon = [f for f in ds if "[" in f][:1] or tinh[:1]
        for ten in chon[:4]:
            ra = os.path.join(dich, ten.replace("[wght]", "-Var").replace("[", "-").replace("]", ""))
            if not (os.path.exists(ra) and os.path.getsize(ra) > 20000):
                d = tai_ve(f"{GOC}/{tm}/{urllib.parse.quote(ten)}")
                if not d or len(d) < 20000 or d[:4] not in (b"\x00\x01\x00\x00", b"true", b"OTTO"):
                    hong.append((ten, "tải hỏng")); continue
                open(ra, "wb").write(d)
            thieu = co_tieng_viet(ra)
            if thieu:
                os.remove(ra)
                loai.append((os.path.basename(ra), "".join(chr(c) for c in thieu)))
            else:
                giu.append(os.path.basename(ra))
        gp = os.path.join(dich, f"OFL-{tm}.txt")
        if not os.path.exists(gp):
            d = tai_ve(f"{GOC}/{tm}/OFL.txt")
            if d:
                open(gp, "wb").write(d)
    return giu, loai, hong


# ======================================================================= chạy

def main():
    kho = os.path.expanduser([a for a in sys.argv[1:] if not a.startswith("-")][0]
                             if [a for a in sys.argv[1:] if not a.startswith("-")]
                             else "~/Movies/VideoKit-Free")
    random.seed(20260908)
    print(f"Dựng kho sạch bản quyền: {kho}")
    print(f"Chế độ: {'nhanh (ít biến thể)' if NHANH else 'đầy đủ'}\n")

    print("[1/6] Font OFL — tải rồi tự kiểm dấu tiếng Việt…")
    giu, loai, hong = tai_font(os.path.join(kho, "fonts"))
    print(f"      giữ {len(giu)} font đủ dấu")
    if loai:
        print(f"      loại {len(loai)} font thiếu dấu: " +
              ", ".join(f"{t.replace('.ttf','')}({m})" for t, m in loai[:8]) +
              ("…" if len(loai) > 8 else ""))
    if hong:
        print(f"      {len(hong)} file tải hỏng")

    print("[2/6] Tổng hợp tiếng động…")
    dem = 0
    do = {}
    for ho, ds in SFX_HO.items():
        for ten, ham in (ds[:3] if NHANH else ds):
            x = chuan_rms(ham(), -20.0)
            ghi_wav(os.path.join(kho, "sfx", f"{ten}.wav"), x)
            do[f"sfx/{ten}.wav"] = {
                "ho": ho, "giay": round(len(x) / SR, 3),
                "rms_db": round(20 * math.log10(max(rms(x), 1e-9)), 2),
                "dinh_db": round(20 * math.log10(max(max(abs(v) for v in x), 1e-9)), 2)}
            dem += 1
    print(f"      {dem} tiếng động / {len(SFX_HO)} họ")

    print("[3/6] Tổng hợp nhạc nền…")
    dem = 0
    cao_ds = [0] if NHANH else [0, -4, 3]
    for mood in (list(MOOD)[:3] if NHANH else MOOD):
        for tt, bpm in (list(TEMPO.items())[1:2] if NHANH else TEMPO.items()):
            for cao in cao_ds:
                hau = "" if cao == 0 else f"-{'cao' if cao > 0 else 'tram'}"
                ten = f"nen-{mood}-{tt}{hau}.wav"
                x = chuan_rms(nhac(mood, bpm, 42, cao), -20.0)
                ghi_wav(os.path.join(kho, "music", ten), x)
                do[f"music/{ten}"] = {
                    "mood": mood, "nhip": bpm, "giay": round(len(x) / SR, 3),
                    "rms_db": round(20 * math.log10(max(rms(x), 1e-9)), 2),
                    "dinh_db": round(20 * math.log10(max(max(abs(v) for v in x), 1e-9)), 2)}
                dem += 1
    print(f"      {dem} bản nhạc nền")

    print("[4/6] Lưới nền và lớp phủ…")
    W, H = 1080, 1920
    g = os.path.join(kho, "grids")
    dem = 0
    for ten_mau, (n0, n1) in (list(BANG_MAU.items())[:4] if NHANH else BANG_MAU.items()):
        c0, c1 = rgb(n0), rgb(n1)
        ghi_png_dong(f"{g}/luoi-cham-{ten_mau}.png", W, H, dong_cham(W, 64, 2.6, c0, c1), 64)
        ghi_png_dong(f"{g}/luoi-ke-{ten_mau}.png", W, H, dong_ke(W, 80, 1.4, c0, c1), 80)
        ghi_png_dong(f"{g}/luoi-cheo-{ten_mau}.png", W, H, dong_cheo(W, 90, 2.0, c0, c1), 90)
        ghi_png_dong(f"{g}/doc-{ten_mau}.png", W, H, dong_doc(W, H, c1, c0))
        ghi_png_dong(f"{g}/toa-{ten_mau}.png", W, H, dong_toa(W, H, c1, c0))
        dem += 5
    print(f"      {dem} nền")
    o = os.path.join(kho, "overlays")
    ov = 0
    for i, (m, a) in enumerate([(18, 32), (26, 46), (38, 62)], 1):
        ghi_png_dong(f"{o}/phu-hat-{i}.png", W, H, dong_hat(W, m, a)); ov += 1
    for i, (m, b) in enumerate([(170, 0.55), (210, 0.45), (245, 0.32)], 1):
        ghi_png_dong(f"{o}/phu-toi-vien-{i}.png", W, H, dong_vien_toi(W, H, m, b)); ov += 1
    for i, (c, px, py, r) in enumerate(
            [("#FFD9A0", 0.22, 0.18, 0.8), ("#A0C8FF", 0.78, 0.15, 0.7),
             ("#FFB0C8", 0.5, 0.85, 0.9), ("#B0FFD0", 0.15, 0.7, 0.75)], 1):
        ghi_png_dong(f"{o}/phu-loe-{i}.png", W, H, dong_loe(W, H, c, px, py, r)); ov += 1
    print(f"      {ov} lớp phủ")

    print("[5/6] LUT…")
    os.makedirs(os.path.join(kho, "luts"), exist_ok=True)
    for ten, ham in LUT_BO.items():
        open(os.path.join(kho, "luts", f"{ten}.cube"), "w").write(viet_lut(ten, ham))
    print(f"      {len(LUT_BO)} LUT")

    print("[6/6] Thư viện preset…")
    p = os.path.join(kho, "presets")
    os.makedirs(p, exist_ok=True)
    json.dump({"_doc": "Đo sẵn lúc dựng kho. Mọi file đã chuẩn hoá RMS về -20 dBFS. "
                       "Dùng rms_db để tính hệ số trộn — ĐỪNG đo LUFS cho tiếng ngắn "
                       "dưới 0,4s, cổng chặn EBU R128 sẽ trả về -70.",
               "chuan_rms_db": -20.0, "file": do},
              open(os.path.join(p, "do-am-luong.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"      do-am-luong.json: {len(do)} file đã đo")
    for ten, dl in [("kieu-chu.json", thu_vien_chu()),
                    ("chuyen-canh.json", thu_vien_chuyen_canh()),
                    ("canh-tram.json", thu_vien_canh_tram())]:
        json.dump(dl, open(os.path.join(p, ten), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(f"      {ten}: {len(dl)} mẫu")

    for t in ("cards", "titles", "characters", "nguon"):
        os.makedirs(os.path.join(kho, t), exist_ok=True)

    open(os.path.join(kho, "GIAY-PHEP.md"), "w", encoding="utf-8").write(
        "# Giấy phép kho tài nguyên\n\n"
        "## fonts/\n"
        "Tải từ Google Fonts, giấy phép **SIL Open Font License 1.1** — dùng thương mại\n"
        "và phát tán lại đều được. Toàn văn ở các file `OFL-*.txt` cùng thư mục.\n"
        "Điều kiện: không bán riêng font, giữ lại file giấy phép.\n"
        "Mọi font ở đây đã được kiểm tự động là đủ dấu tiếng Việt (ẫ ự ỡ ằ Đ ệ ợ ỹ);\n"
        "font thiếu dấu đã bị loại lúc dựng kho.\n\n"
        "## sfx/ music/ grids/ overlays/ luts/ presets/\n"
        "**Do `scripts/dung_kho.py` tự tổng hợp bằng thuật toán.** Không sao chép của ai,\n"
        "không dính bản quyền bên thứ ba. Dùng, sửa, bán thành phẩm đều thoải mái.\n"
        "Dựng lại hoặc đổi thông số: `python3 scripts/dung_kho.py <thư-mục>`.\n\n"
        "## Tự thêm tài nguyên\n"
        "Chép thêm font/nhạc/SFX của bạn vào đúng thư mục. **Tự kiểm giấy phép** trước\n"
        "khi dùng cho video kiếm tiền, và đừng phát tán lại hàng có bản quyền của người khác.\n")

    print("\nXong.")
    tong = 0
    for t in ("fonts", "sfx", "music", "grids", "overlays", "luts", "presets"):
        d = os.path.join(kho, t)
        n = len([x for x in os.listdir(d)]) if os.path.isdir(d) else 0
        tong += n
        print(f"  {t:10} {n:4} file")
    print(f"  {'TỔNG':10} {tong:4} file")


if __name__ == "__main__":
    main()
