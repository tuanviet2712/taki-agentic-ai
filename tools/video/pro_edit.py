#!/usr/bin/env python3
"""Dựng video chuyên nghiệp từ VIDEO THÔ theo một kế hoạch dựng (plan.json) đã được tính sẵn bằng mã.

Không phụ thuộc libass/drawtext: chữ động được vẽ bằng Pillow thành chuỗi ảnh PNG có mốc thời gian rồi ghép bằng `overlay`;
hiệu ứng zoom bằng `zoompan` (nguồn phóng 2x cho mượt), chuyển cảnh bằng `xfade`, âm thanh bằng amix + sidechaincompress
(nhạc nền tự hạ khi có giọng) + loudnorm -14 LUFS; hiệu ứng âm thanh (whoosh, pop, ding, impact, click, riser) được tổng hợp
bằng aevalsrc nên không cần tải tệp âm thanh nào.

Lệnh:
  pro_edit.py analyze <out_dir> <video...>         -> JSON: thông tin, danh sách phân cảnh, ảnh tổng hợp (contact sheet)
  pro_edit.py words <out.json> <audio/video...>    -> JSON: lời + mốc thời gian từng từ (faster-whisper)
  pro_edit.py render <plan.json>                   -> dựng video (in tiến độ "STEP ..." và 1 dòng JSON kết quả cuối)
  pro_edit.py sheet <video> <out.png> [n]          -> ảnh tổng hợp n khung hình đều nhau để kiểm tra bằng mắt
"""
import json, math, os, re, subprocess, sys, tempfile

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_BOLD = [os.path.join(HERE, "fonts", "BeVietnamPro-Bold.ttf"), r"C:\Windows\Fonts\arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")


_T0 = None


def say(msg):
    import time
    global _T0
    now = time.time()
    _T0 = _T0 or now
    print(f"STEP {msg} [{now - _T0:.0f}s]", flush=True)


def run(cmd, check=True, timeout=None):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(str(c) for c in cmd[:3])} lỗi: {r.stderr[-1200:]}")
    return r


def probe(path):
    j = json.loads(run([FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate:stream_tags=rotate:stream_side_data=rotation", "-of", "json", path]).stdout)
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    w, h = v.get("width"), v.get("height")
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        rot = int(sd.get("rotation", rot) or 0)
    rot = rot or int((v.get("tags") or {}).get("rotate", 0) or 0)
    if abs(rot) in (90, 270):
        w, h = h, w  # ffmpeg tự xoay theo metadata khi giải mã
    fr = (v.get("r_frame_rate") or "30/1").split("/")
    try:
        fps = float(fr[0]) / float(fr[1]) if float(fr[1]) else 30.0
    except Exception:  # noqa: BLE001
        fps = 30.0
    return {"duration": float(j.get("format", {}).get("duration", 0) or 0), "width": w, "height": h, "fps": round(fps, 2), "hasAudio": any(s.get("codec_type") == "audio" for s in j.get("streams", []))}


def font(size):
    from PIL import ImageFont
    for f in FONT_BOLD:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


# ------------------------------------------------------------------ analyze
def detect_shots(path, duration):
    """Mốc đổi cảnh bằng bộ lọc scene của ffmpeg (chạy trên bản thu nhỏ cho nhanh)."""
    r = run([FFMPEG, "-nostdin", "-hide_banner", "-i", path, "-an", "-vf", "scale=320:-2,select='gt(scene,0.30)',showinfo", "-f", "null", "-"], check=False, timeout=900)
    cuts = sorted({round(float(m), 2) for m in re.findall(r"pts_time:([0-9.]+)", r.stderr)})
    bounds = [0.0] + [c for c in cuts if 0.4 < c < duration - 0.4] + [round(duration, 2)]
    shots = [[bounds[i], bounds[i + 1]] for i in range(len(bounds) - 1) if bounds[i + 1] - bounds[i] > 0.05]
    # gộp cảnh quá ngắn (< 1s) vào cảnh trước; chia cảnh quá dài (> 8s) thành đoạn ≤ 6s
    merged = []
    for s in shots:
        if merged and s[1] - s[0] < 1.0:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    out = []
    for a, b in merged:
        n = max(1, math.ceil((b - a) / 6.0)) if b - a > 8.0 else 1
        step = (b - a) / n
        out += [[round(a + k * step, 2), round(a + (k + 1) * step, 2)] for k in range(n)]
    while len(out) > 60:  # quá nhiều → gộp các cặp ngắn nhất
        i = min(range(len(out) - 1), key=lambda k: out[k + 1][1] - out[k][0])
        out[i][1] = out[i + 1][1]
        del out[i + 1]
    return out


def analyze(out_dir, files):
    from PIL import Image, ImageDraw
    os.makedirs(out_dir, exist_ok=True)
    sources, tiles = [], []
    for si, f in enumerate(files):
        say(f"Phân tích video {si + 1}/{len(files)}")
        info = probe(f)
        if info["duration"] < 0.5 or not info["width"]:
            raise RuntimeError(f"Video hỏng hoặc quá ngắn: {os.path.basename(f)}")
        shots = detect_shots(f, info["duration"])
        sources.append({"index": si, "path": f, **info, "shots": [{"id": f"{si}.{k}", "start": a, "end": b} for k, (a, b) in enumerate(shots)]})
        for k, (a, b) in enumerate(shots):
            thumb = os.path.join(out_dir, f"t_{si}_{k}.jpg")
            run([FFMPEG, "-nostdin", "-v", "error", "-y", "-ss", f"{(a + b) / 2:.2f}", "-i", f, "-frames:v", "1", "-vf", "scale=-2:330,format=yuvj420p", "-q:v", "4", thumb], check=False)
            if os.path.exists(thumb):
                tiles.append((f"{si}.{k}", a, b, thumb))
    sheets = []
    cols, rows = 4, 3
    for sheet_i in range(0, min(len(tiles), cols * rows * 5), cols * rows):
        chunk = tiles[sheet_i:sheet_i + cols * rows]
        ims = [Image.open(t[3]).convert("RGB") for t in chunk]
        cw = max(i.width for i in ims)
        ch = max(i.height for i in ims)
        sheet = Image.new("RGB", (cols * (cw + 8) + 8, rows * (ch + 8) + 8), (24, 24, 28))
        d = ImageDraw.Draw(sheet)
        lf = font(26)
        for n, (t, im) in enumerate(zip(chunk, ims)):
            x, y = 8 + (n % cols) * (cw + 8), 8 + (n // cols) * (ch + 8)
            sheet.paste(im, (x + (cw - im.width) // 2, y))
            label = f"{t[0]}  {t[1]:.1f}-{t[2]:.1f}s"
            tw = d.textlength(label, font=lf)
            d.rectangle([x, y, x + tw + 14, y + 34], fill=(0, 0, 0))
            d.text((x + 7, y + 2), label, font=lf, fill=(255, 235, 59))
        p = os.path.join(out_dir, f"sheet_{len(sheets) + 1}.png")
        sheet.save(p)
        sheets.append(p)
    return {"sources": sources, "sheets": sheets}


# ------------------------------------------------------------------ words (whisper)
def load_audio(path):
    import numpy as np
    pcm = subprocess.run([FFMPEG, "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], check=True, capture_output=True).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def words_of(files, out_json):
    from faster_whisper import WhisperModel
    model = WhisperModel(os.environ.get("TAKI_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    res = []
    for f in files:
        say(f"Nghe lời nói: {os.path.basename(f)}")
        try:
            audio = load_audio(f)
        except Exception:  # noqa: BLE001  (không có luồng âm thanh)
            res.append({"file": f, "text": "", "words": []})
            continue
        segs, _ = model.transcribe(audio, language="vi", vad_filter=True, word_timestamps=True)
        words = []
        for s in segs:
            for w in (s.words or []):
                if w.end > w.start:
                    words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
        res.append({"file": f, "text": " ".join(w["w"] for w in words), "words": words})
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False)
    return res


# ------------------------------------------------------------------ sfx (tổng hợp)
SFX = {
    "whoosh": ("aevalsrc='(random(0)*2-1)*0.9*pow(sin(PI*t/0.7),2)':s=48000:d=0.7", "highpass=f=350,lowpass=f=7000,volume=0.9", 0.55),
    "pop": ("aevalsrc='sin(2*PI*(420+1800*t)*t)*exp(-38*t)':s=48000:d=0.2", "volume=0.9", 0.5),
    "ding": ("aevalsrc='(0.55*sin(2*PI*1318*t)+0.25*sin(2*PI*1976*t)+0.12*sin(2*PI*2637*t))*exp(-4.5*t)':s=48000:d=1.1", "volume=0.9", 0.4),
    "impact": ("aevalsrc='0.9*sin(2*PI*58*t)*exp(-7*t)+0.35*(random(1)*2-1)*exp(-40*t)':s=48000:d=0.9", "lowpass=f=4000,volume=0.9", 0.7),
    "click": ("aevalsrc='(random(2)*2-1)*exp(-260*t)':s=48000:d=0.06", "lowpass=f=5000,volume=0.8", 0.45),
    "riser": ("aevalsrc='(random(3)*2-1)*pow(t/0.9,2)':s=48000:d=0.9", "highpass=f=500,lowpass=f=9000,volume=0.8", 0.4),
}


def sfx_file(kind, cache):
    if kind not in SFX:
        return None, 0
    path = os.path.join(cache, f"{kind}.wav")
    if not os.path.exists(path):
        src, flt, _ = SFX[kind]
        run([FFMPEG, "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", src, "-af", flt, "-ac", "2", path])
    return path, SFX[kind][2]


# ------------------------------------------------------------------ text track (Pillow)
STYLES = {
    # accent = màu nhấn (từ đang đọc, thanh tiêu đề); hook = nền tiêu đề mở đầu; grade = bộ lọc chỉnh màu
    "dynamic": {"accent": (255, 214, 10), "hook": (255, 59, 92), "zoom": 0.16, "grade": "eq=contrast=1.08:saturation=1.18:brightness=0.01,unsharp=5:5:0.5", "vignette": False},
    "smooth": {"accent": (255, 226, 160), "hook": (20, 20, 24), "zoom": 0.09, "grade": "eq=contrast=1.04:saturation=1.05", "vignette": True},
    "clean": {"accent": (64, 220, 255), "hook": (0, 120, 220), "zoom": 0.07, "grade": "eq=contrast=1.03:saturation=1.03,unsharp=5:5:0.35", "vignette": False},
}


def ease_out_back(p):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2


def ease_out(p):
    return 1 - (1 - p) ** 3


def wrap_words(draw, words, fnt, max_w):
    lines, cur, cur_w = [], [], 0
    space = draw.textlength(" ", font=fnt)
    for i, w in enumerate(words):
        ww = draw.textlength(w, font=fnt)
        add = ww if not cur else cur_w + space + ww
        if cur and add > max_w:
            lines.append(cur)
            cur, cur_w = [i], ww
        else:
            cur.append(i)
            cur_w = add
    if cur:
        lines.append(cur)
    return lines


class Layer:
    def __init__(self, kind, t0, t1, payload, in_d=0.0, out_d=0.0):
        self.kind, self.t0, self.t1, self.payload, self.in_d, self.out_d = kind, t0, t1, payload, in_d, out_d

    def state(self, t, fps):
        """Trạng thái hiển thị tại thời điểm t: (tiến độ vào, tiến độ ra, từ đang đọc)."""
        pin = 1.0 if self.in_d <= 0 else min(1.0, max(0.0, (t - self.t0) / self.in_d))
        pout = 1.0 if self.out_d <= 0 else min(1.0, max(0.0, (self.t1 - t) / self.out_d))
        active = None
        if self.kind == "caption":
            for k, w in enumerate(self.payload["words"]):
                if w["t0"] <= t < w["t1"] + 0.02:
                    active = k
                    break
        # lượng tử hoá để các khung giống nhau dùng chung 1 ảnh
        return (round(pin * 12) / 12, round(pout * 12) / 12, active)


def draw_layer(img, layer, st, W, H, style):
    from PIL import Image, ImageDraw
    pin, pout, active = st
    acc = style["accent"]
    base = min(W, H) / 1080.0
    p = layer.payload
    tmp = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    anchor_y = 0.5
    mode = "pop"
    if layer.kind == "caption":
        fs = int(72 * base)
        fnt = font(fs)
        words = [w["text"] for w in p["words"]]
        lines = wrap_words(d, words, fnt, W - int(150 * base))[:3]
        lh = int(fs * 1.28)
        total_h = lh * len(lines)
        y0 = int(H * p.get("y", 0.68)) - total_h // 2
        space = d.textlength(" ", font=fnt)
        for li, idxs in enumerate(lines):
            lw = sum(d.textlength(words[i], font=fnt) for i in idxs) + space * (len(idxs) - 1)
            x = (W - lw) / 2
            for i in idxs:
                col = acc if i == active else (255, 255, 255)
                d.text((x, y0 + li * lh), words[i], font=fnt, fill=col + (255,), stroke_width=int(7 * base), stroke_fill=(0, 0, 0, 255))
                x += d.textlength(words[i], font=fnt) + space
        anchor_y = (y0 + total_h / 2) / H
        mode = "pop_small"
    elif layer.kind == "headline":
        fs = int(86 * base)
        fnt = font(fs)
        words = p["text"].split()
        lines = wrap_words(d, words, fnt, W - int(170 * base))[:3]
        lh = int(fs * 1.22)
        y0 = int(H * p.get("y", 0.27)) - lh * len(lines) // 2
        for li, idxs in enumerate(lines):
            txt = " ".join(words[i] for i in idxs)
            tw = d.textlength(txt, font=fnt)
            x = (W - tw) / 2
            d.text((x, y0 + li * lh), txt, font=fnt, fill=(255, 255, 255, 255), stroke_width=int(9 * base), stroke_fill=(0, 0, 0, 255))
        # vạch nhấn dưới tiêu đề
        bw = int(min(W - 300 * base, 380 * base))
        yb = y0 + lh * len(lines) + int(14 * base)
        d.rounded_rectangle([(W - bw) / 2, yb, (W + bw) / 2, yb + int(10 * base)], radius=int(5 * base), fill=acc + (255,))
        anchor_y = (y0 + lh * len(lines) / 2) / H
        mode = "slide"
    elif layer.kind == "hook":
        fs = int(78 * base)
        fnt = font(fs)
        words = p["text"].split()
        lines = wrap_words(d, words, fnt, W - int(220 * base))[:2]
        lh = int(fs * 1.2)
        pad = int(34 * base)
        bw = max(sum(d.textlength(words[i], font=fnt) for i in idxs) + d.textlength(" ", font=fnt) * (len(idxs) - 1) for idxs in lines) + pad * 2
        bh = lh * len(lines) + pad
        cx, top = W / 2, int(H * 0.12)
        d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, top + bh], radius=int(30 * base), fill=style["hook"] + (240,))
        for li, idxs in enumerate(lines):
            txt = " ".join(words[i] for i in idxs)
            tw = d.textlength(txt, font=fnt)
            d.text((cx - tw / 2, top + pad // 2 + li * lh), txt, font=fnt, fill=(255, 255, 255, 255))
        anchor_y = (top + bh / 2) / H
        mode = "pop"
    elif layer.kind == "cta":
        fs = int(66 * base)
        fnt = font(fs)
        txt = p["text"]
        lines = wrap_words(d, txt.split(), fnt, W - int(260 * base))[:2]
        words = txt.split()
        lh = int(fs * 1.2)
        pad = int(38 * base)
        bw = max(d.textlength(" ".join(words[i] for i in idxs), font=fnt) for idxs in lines) + pad * 2
        bh = lh * len(lines) + pad
        cx, top = W / 2, int(H * 0.82)
        d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, top + bh], radius=int(bh / 2.4), fill=acc + (255,))
        for li, idxs in enumerate(lines):
            line = " ".join(words[i] for i in idxs)
            tw = d.textlength(line, font=fnt)
            d.text((cx - tw / 2, top + pad // 2 + li * lh), line, font=fnt, fill=(20, 20, 20, 255))
        anchor_y = (top + bh / 2) / H
        mode = "pop"
    # hoạt hoạ vào / ra — chỉ xử lý vùng chữ (bbox), không biến đổi cả khung 1080x1920 (nhanh gấp ~10 lần)
    bb = tmp.getbbox()
    if not bb:
        return
    pad = int(24 * base)
    bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W, bb[2] + pad), min(H, bb[3] + pad))
    sprite = tmp.crop(bb)
    x, y = bb[0], bb[1]
    a = min(1.0, pin * 1.6) * min(1.0, pout * 2.2)
    if mode == "slide":
        y += int((1 - ease_out(pin)) * 60 * base) + int((1 - pout) * 30 * base)
        s = 1.0
    elif mode == "pop_small":
        s = (0.86 + 0.14 * ease_out_back(pin)) if pin < 1 else 1.0
        s *= 1.0 - 0.06 * (1 - pout)
    else:
        s = (0.55 + 0.45 * ease_out_back(pin)) if pin < 1 else 1.0
        s *= 1.0 - 0.1 * (1 - pout)
    if abs(s - 1.0) > 0.003:
        cx, cy = W / 2, anchor_y * H
        nw, nh = max(1, int(sprite.width * s)), max(1, int(sprite.height * s))
        sprite = sprite.resize((nw, nh), Image.BILINEAR)
        x, y = int(cx + (x - cx) * s), int(cy + (y - cy) * s)
    if a < 0.999:
        sprite.putalpha(sprite.getchannel("A").point(lambda v: int(v * max(0.0, a))))
    # dán có cắt phần ngoài khung
    sx, sy = max(0, -x), max(0, -y)
    ex, ey = min(sprite.width, W - x), min(sprite.height, H - y)
    if ex > sx and ey > sy:
        img.alpha_composite(sprite.crop((sx, sy, ex, ey)), (max(0, x), max(0, y)))


def build_text_track(plan, work, W, H, fps, total):
    from PIL import Image
    style = STYLES.get(plan.get("style"), STYLES["dynamic"])
    layers = []
    hook = plan.get("hook")
    if hook and hook.get("text"):
        layers.append(Layer("hook", hook["t0"], hook["t1"], hook, in_d=0.35, out_d=0.3))
    for sc in plan["scenes"]:
        if sc.get("onScreen"):
            t0 = sc["start"] + 0.1
            t1 = min(total, sc["start"] + sc["content"] - 0.1)
            if t1 - t0 > 0.8:
                layers.append(Layer("headline", t0, t1, {"text": sc["onScreen"], "y": plan.get("headlineY", 0.27)}, in_d=0.35, out_d=0.3))
    for ch in plan.get("captions", []):
        if ch["words"]:
            layers.append(Layer("caption", ch["t0"], ch["t1"], {"words": ch["words"], "y": plan.get("captionY", 0.68)}, in_d=0.14, out_d=0.08))
    cta = plan.get("cta")
    if cta and cta.get("text"):
        layers.append(Layer("cta", cta["t0"], cta["t1"], cta, in_d=0.4, out_d=0.0))
    step = 1.0 / fps
    pts = {0.0, round(total, 3)}
    for L in layers:
        pts.update([round(L.t0, 3), round(min(L.t1, total), 3)])
        if L.kind == "caption":
            for w in L.payload["words"]:
                pts.add(round(max(L.t0, min(w["t0"], L.t1)), 3))
        for dur, base in ((L.in_d, L.t0), (L.out_d, L.t1 - L.out_d)):
            n = int(dur / step)
            pts.update(round(base + k * step, 3) for k in range(n + 1) if 0 <= base + k * step <= total)
    times = sorted(t for t in pts if 0 <= t <= total)
    frames_dir = os.path.join(work, "text")
    os.makedirs(frames_dir, exist_ok=True)
    cache, entries, blank = {}, [], None
    for i, t in enumerate(times[:-1]):
        t1 = times[i + 1]
        if t1 - t < 1e-3:
            continue
        mid = t + 1e-4
        active = [L for L in layers if L.t0 <= mid < L.t1]
        sig = tuple((id(L), L.state(mid, fps)) for L in active)
        if not active:
            if blank is None:
                blank = os.path.join(frames_dir, "blank.png")
                Image.new("RGBA", (W, H), (0, 0, 0, 0)).save(blank, compress_level=1)
            entries.append((blank, t1 - t))
            continue
        if sig not in cache:
            img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            for L in active:
                draw_layer(img, L, L.state(mid, fps), W, H, style)
            path = os.path.join(frames_dir, f"f{len(cache):05d}.png")
            img.save(path, compress_level=1)
            cache[sig] = path
        entries.append((cache[sig], t1 - t))
    lst = os.path.join(work, "text.txt")
    with open(lst, "w", encoding="utf-8") as fh:
        for path, dur in entries:
            fh.write(f"file '{path.replace(os.sep, '/')}'\nduration {dur:.4f}\n")
        if entries:
            fh.write(f"file '{entries[-1][0].replace(os.sep, '/')}'\n")
    return lst


# ------------------------------------------------------------------ video segments
def zoom_expr(kind, n, amt, fps):
    N = max(1, n)
    p = f"(on/{N})"
    smooth = f"({p}*{p}*(3-2*{p}))"
    if kind == "in":
        return f"1+{amt}*{smooth}", "(iw-iw/zoom)/2", "(ih-ih/zoom)*0.4"
    if kind == "out":
        return f"1+{amt}*(1-{smooth})", "(iw-iw/zoom)/2", "(ih-ih/zoom)*0.4"
    if kind == "punch":
        return f"1+{amt}*min(1,on/{max(1, int(0.28 * fps))})*(1-0.15*min(1,on/{max(1, int(0.28 * fps))}))+0.02*{p}", "(iw-iw/zoom)/2", "(ih-ih/zoom)*0.4"
    if kind == "pan_left":
        return f"1+{amt}*0.8", f"(iw-iw/zoom)*(1-{smooth})", "(ih-ih/zoom)*0.4"
    if kind == "pan_right":
        return f"1+{amt}*0.8", f"(iw-iw/zoom)*{smooth}", "(ih-ih/zoom)*0.4"
    return "1.0", "(iw-iw/zoom)/2", "(ih-ih/zoom)/2"


def build_segment(i, sc, plan, work, W, H, fps):
    style = STYLES.get(plan.get("style"), STYLES["dynamic"])
    seg_len = sc["segLen"]
    out = os.path.join(work, f"seg_{i:02d}.mp4")
    inputs, chains = [], []
    cuts = sc["cuts"]
    ss = 1 if sc.get("zoom", "none") == "none" else 2  # nguồn phóng 2x để zoom mượt (không zoom thì khỏi tốn)
    for k, c in enumerate(cuts):
        src_len = max(0.3, c["end"] - c["start"])
        inputs += ["-ss", f"{c['start']:.3f}", "-t", f"{src_len + 0.05:.3f}", "-i", plan["sources"][c["src"]]]
        factor = c["target"] / src_len
        factor = min(max(factor, 0.55), 1.7)
        chains.append(
            f"[{k}:v]setpts=(PTS-STARTPTS)*{factor:.4f},fps={fps},scale={ss * W}:{ss * H}:force_original_aspect_ratio=increase,crop={ss * W}:{ss * H},setsar=1,"
            f"trim=duration={c['target']:.3f},tpad=stop_mode=clone:stop_duration={max(0.0, c['target']):.3f},trim=duration={c['target']:.3f},setpts=PTS-STARTPTS[v{k}]")
    cat = "".join(f"[v{k}]" for k in range(len(cuts)))
    base = f"{cat}concat=n={len(cuts)}:v=1:a=0[cat]" if len(cuts) > 1 else "[v0]null[cat]"
    n_frames = int(seg_len * fps)
    z, x, y = zoom_expr(sc.get("zoom", "none"), n_frames, style["zoom"], fps)
    tail = f"[cat]tpad=stop_mode=clone:stop_duration={seg_len:.3f},trim=duration={seg_len:.3f},zoompan=z='{z}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={fps},{style['grade']}"
    if style.get("vignette"):
        tail += ",vignette=PI/5.5"
    tail += ",format=yuv420p[out]"
    fc = ";".join(chains + [base, tail])
    run([FFMPEG, "-nostdin", "-v", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(fps), out], timeout=1200)
    return out


def chain_transitions(segs, plan, work, fps):
    """Ghép các đoạn bằng xfade: đoạn k vào lúc (start_k - d_k) theo trục thời gian tuyệt đối."""
    if len(segs) == 1:
        return segs[0]
    inputs, parts, prev = [], [], "[0:v]"
    for s in segs:
        inputs += ["-i", s]
    for k in range(1, len(segs)):
        sc = plan["scenes"][k]
        tr = sc.get("trans") or {"type": "fade", "dur": 0.05}
        d = max(0.05, float(tr["dur"]))
        offset = max(0.0, sc["start"] - d)
        label = f"[x{k}]"
        parts.append(f"{prev}[{k}:v]xfade=transition={tr['type']}:duration={d:.3f}:offset={offset:.3f}{label}")
        prev = label
    out = os.path.join(work, "base.mp4")
    run([FFMPEG, "-nostdin", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(parts), "-map", prev, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-r", str(fps), out], timeout=1800)
    return out


# ------------------------------------------------------------------ audio
def build_audio(plan, work, total):
    """Trả về (danh sách đầu vào ffmpeg, filter_complex, nhãn đầu ra)."""
    cache = os.path.join(work, "sfx")
    os.makedirs(cache, exist_ok=True)
    inputs, fparts, voice_labels, other_labels = [], [], [], []
    n = 0

    def add_input(*args):
        nonlocal n
        inputs.extend(args)
        n += 1
        return n - 1

    # giọng đọc (voice-over) từng cảnh
    for sc in plan["scenes"]:
        a = sc.get("audio") or {}
        if a.get("voice"):
            k = add_input("-i", a["voice"])
            ms = int(max(0, a["voiceAt"]) * 1000)
            fparts.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume={a.get('voiceVolume', 1.0)},adelay={ms}|{ms}[v{k}]")
            voice_labels.append(f"[v{k}]")
        if a.get("source"):  # tiếng gốc của video (lời người nói / âm thanh hiện trường)
            idx = []
            for c in sc["cuts"]:
                k = add_input("-ss", f"{c['start']:.3f}", "-t", f"{max(0.2, c['end'] - c['start']):.3f}", "-i", plan["sources"][c["src"]])
                fparts.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[s{k}]")
                idx.append(k)
            ms = int(max(0, a.get("sourceAt", sc["start"])) * 1000)
            vol = a.get("sourceVolume", 1.0)
            cat = "".join(f"[s{k}]" for k in idx)
            lab = f"[src{sc['index']}]"
            if len(idx) > 1:
                fparts.append(f"{cat}concat=n={len(idx)}:v=0:a=1,volume={vol},adelay={ms}|{ms}{lab}")
            else:
                fparts.append(f"[s{idx[0]}]volume={vol},adelay={ms}|{ms}{lab}")
            (voice_labels if a.get("sourceIsVoice") else other_labels).append(lab)
    # hiệu ứng âm thanh
    for sc in plan["scenes"]:
        for fx in sc.get("sfx", []):
            path, vol = sfx_file(fx["type"], cache)
            if not path:
                continue
            k = add_input("-i", path)
            ms = int(max(0, sc["start"] + fx.get("at", 0.0)) * 1000)
            fparts.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol * fx.get('volume', 1.0):.3f},adelay={ms}|{ms}[fx{k}]")
            other_labels.append(f"[fx{k}]")
    # nhạc nền (tự hạ khi có giọng)
    music = plan.get("music")
    mus_label = None
    if music and music.get("file") and os.path.exists(music["file"]):
        k = add_input("-stream_loop", "-1", "-i", music["file"])
        fparts.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration={total:.3f},volume={music.get('volume', 0.16)},afade=t=in:d=0.8,afade=t=out:st={max(0, total - 1.6):.3f}:d=1.6[mus{k}]")
        mus_label = f"[mus{k}]"
    mix_inputs = []
    if voice_labels:
        if len(voice_labels) > 1:
            fparts.append(f"{''.join(voice_labels)}amix=inputs={len(voice_labels)}:normalize=0:duration=longest[voice]")
        else:
            fparts.append(f"{voice_labels[0]}anull[voice]")
        if mus_label:
            fparts.append("[voice]asplit=2[voice_a][voice_sc]")
            fparts.append(f"{mus_label}[voice_sc]sidechaincompress=threshold=0.02:ratio=9:attack=15:release=450:makeup=1[musduck]")
            mix_inputs += ["[voice_a]", "[musduck]"]
        else:
            mix_inputs.append("[voice]")
    elif mus_label:
        mix_inputs.append(mus_label)
    mix_inputs += other_labels
    if not mix_inputs:
        return inputs, None, None
    fparts.append(f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:normalize=0:duration=longest,apad,atrim=duration={total:.3f},loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.15,afade=t=out:st={max(0, total - 0.5):.3f}:d=0.5[aout]")
    return inputs, ";".join(fparts), "[aout]"


# ------------------------------------------------------------------ render
def render(plan_path):
    plan = json.load(open(plan_path, encoding="utf-8"))
    W, H, fps = int(plan["width"]), int(plan["height"]), int(plan.get("fps", 30))
    work = plan["workdir"]
    os.makedirs(work, exist_ok=True)
    total = float(plan["total"])
    for i, sc in enumerate(plan["scenes"]):
        sc["index"] = i
    segs = []
    for i, sc in enumerate(plan["scenes"]):
        say(f"Dựng cảnh {i + 1}/{len(plan['scenes'])}")
        segs.append(build_segment(i, sc, plan, work, W, H, fps))
    say("Ghép cảnh + chuyển cảnh")
    base = chain_transitions(segs, plan, work, fps)
    say("Vẽ chữ động (tiêu đề, phụ đề từng từ, CTA)")
    text_list = build_text_track(plan, work, W, H, fps, total)
    say("Trộn âm thanh + hiệu ứng + nhạc nền")
    a_inputs, a_fc, a_label = build_audio(plan, work, total)
    out = plan["out"]
    cmd = [FFMPEG, "-nostdin", "-v", "error", "-y", "-i", base, "-f", "concat", "-safe", "0", "-i", text_list, *a_inputs]
    fc = f"[1:v]fps={fps},format=rgba[txt];[0:v]fade=t=in:d=0.2,fade=t=out:st={max(0, total - 0.4):.3f}:d=0.4[bv];[bv][txt]overlay=format=auto:eof_action=pass,format=yuv420p[vout]"
    if a_fc:
        # đầu vào âm thanh bắt đầu từ chỉ số 2 → dời chỉ số trong filter (-i base=0, text=1)
        def shift(m):
            return f"[{int(m.group(1)) + 2}:a]"
        a_fc = re.sub(r"\[(\d+):a\]", shift, a_fc)
        fc += ";" + a_fc
    cmd += ["-filter_complex", fc, "-map", "[vout]"]
    cmd += ["-map", a_label, "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] if a_label else ["-an"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", f"{total:.3f}", out]
    say("Xuất video cuối")
    run(cmd, timeout=3600)
    info = probe(out)
    vd = float(run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=duration", "-of", "csv=p=0", out]).stdout.strip() or 0)
    if vd < total - 0.6:
        raise RuntimeError(f"Video dựng ra ngắn hơn kế hoạch ({vd:.1f}s / {total:.1f}s) — chuỗi chuyển cảnh bị cắt")
    return {"ok": True, "out": out, "duration": info["duration"], "width": info["width"], "height": info["height"], "hasAudio": info["hasAudio"]}


def sheet(video, out_png, n=6):
    from PIL import Image, ImageDraw
    info = probe(video)
    d = info["duration"]
    frames = []
    for k in range(n):
        t = max(0.1, min(d - 0.1, d * (k + 0.5) / n))
        p = f"{out_png}.{k}.jpg"
        run([FFMPEG, "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=-2:560,format=yuvj420p", "-q:v", "3", p], check=False)
        if os.path.exists(p):
            frames.append((t, Image.open(p).convert("RGB")))
    if not frames:
        raise RuntimeError("Không trích được khung hình")
    cols = min(3, len(frames))
    rows = math.ceil(len(frames) / cols)
    cw, ch = max(f.width for _, f in frames), max(f.height for _, f in frames)
    sh = Image.new("RGB", (cols * (cw + 8) + 8, rows * (ch + 8) + 8), (20, 20, 24))
    dr = ImageDraw.Draw(sh)
    for k, (t, f) in enumerate(frames):
        x, y = 8 + (k % cols) * (cw + 8), 8 + (k // cols) * (ch + 8)
        sh.paste(f, (x, y))
        dr.text((x + 8, y + 6), f"{t:.1f}s", fill=(255, 235, 59), font=font(26))
    sh.save(out_png)
    for k in range(n):
        try:
            os.remove(f"{out_png}.{k}.jpg")
        except OSError:
            pass
    return out_png


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return 2
    try:
        if a[0] == "analyze":
            print(json.dumps(analyze(a[1], a[2:]), ensure_ascii=False))
        elif a[0] == "words":
            words_of(a[2:], a[1])
            print(json.dumps({"ok": True, "out": a[1]}))
        elif a[0] == "render":
            print(json.dumps(render(a[1]), ensure_ascii=False))
        elif a[0] == "sheet":
            print(json.dumps({"ok": True, "out": sheet(a[1], a[2], int(a[3]) if len(a) > 3 else 6)}))
        else:
            print(__doc__)
            return 2
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e)[-1500:]}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
