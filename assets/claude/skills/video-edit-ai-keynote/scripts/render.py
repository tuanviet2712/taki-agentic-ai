#!/usr/bin/env python3
"""
render.py — Dựng video theo phong cách "AI Dark Keynote" từ một storyboard JSON.

    python3 render.py storyboard.json

Quy trình:
  1. Vẽ canvas nền (đen ấm + lưới mờ + quầng sáng vàng)
  2. Cắt clip gốc thành các đoạn theo khung hình (framing), lồng vào thẻ bo góc
  3. Sinh lớp đồ hoạ + phụ đề bằng HTML, chụp từng frame qua Chromium
  4. Ghép tất cả bằng ffmpeg, giữ nguyên tiếng gốc
"""
import json, math, os, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / "assets" / "fonts"
W, H = 720, 1280

# Khung hình dựng sẵn: (x, y, w, h, radius)
PRESETS = {
    "full":        (0,   0,    720, 1280, 0),
    "hero":        (68,  80,   584, 584,  40),   # vuông trên, chừa chỗ đồ hoạ bên dưới
    "hero-low":    (68,  330,  584, 584,  40),   # vuông giữa, chừa chỗ đồ hoạ bên trên
    "tall":        (68,  150,  584, 880,  44),   # dọc lớn, ít đồ hoạ
    "tall-low":    (68,  300,  584, 760,  44),
    "mid":         (170, 430,  380, 470,  34),   # vừa, nhiều đồ hoạ
    "mini-left":   (68,  560,  210, 280,  26),   # nhỏ, đồ hoạ chiếm phần lớn khung
    "mini-center": (255, 560,  210, 280,  26),
    "mini-right":  (442, 560,  210, 280,  26),
}


def sh(cmd, **kw):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)
    if r.returncode:
        sys.stderr.write((r.stderr or "")[-3000:])
        raise SystemExit(f"Lệnh thất bại: {cmd if isinstance(cmd,str) else ' '.join(cmd)}")
    return r.stdout


def probe(path, stream="v"):
    out = sh(["ffprobe", "-v", "error", "-select_streams", stream + ":0",
              "-show_entries", "stream=width,height,duration",
              "-show_entries", "format=duration", "-of", "json", str(path)])
    j = json.loads(out)
    st = (j.get("streams") or [{}])[0]
    dur = float(st.get("duration") or j["format"]["duration"])
    return st.get("width"), st.get("height"), dur


# ----------------------------------------------------------------- canvas nền
def make_canvas(out, theme):
    from PIL import Image, ImageDraw, ImageFilter
    bg = tuple(theme.get("bg_rgb", (15, 14, 12)))
    im = Image.new("RGB", (W, H), bg)

    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for cx, cy, r, a in theme.get("glows", [(0.28, 0.20, 0.55, 74), (0.86, 0.78, 0.45, 40)]):
        gd.ellipse([cx * W - r * W, cy * H - r * W, cx * W + r * W, cy * H + r * W], fill=a)
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    gold = Image.new("RGB", (W, H), tuple(theme.get("glow_rgb", (150, 132, 40))))
    im = Image.composite(gold, im, glow.point(lambda v: int(v * 0.85)))

    grid = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(grid)
    step = theme.get("grid", 90)
    if step:
        for x in range(0, W + 1, step):
            gd.line([(x, 0), (x, H)], fill=26)
        for y in range(0, H + 1, step):
            gd.line([(0, y), (W, y)], fill=26)
        lines = Image.new("RGB", (W, H), (150, 145, 120))
        im = Image.composite(lines, im, grid)

    im.save(out)


def make_mask(w, h, r, out):
    from PIL import Image, ImageDraw
    S = 4  # vẽ lớn rồi thu nhỏ cho bo góc mượt
    m = Image.new("L", (w * S, h * S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * S - 1, h * S - 1], radius=r * S, fill=255)
    m.resize((w, h), Image.LANCZOS).save(out)


# --------------------------------------------------------------- lớp video nền
def build_base(src, canvas, framing, dur, fps, tmp):
    """Cắt clip gốc theo từng đoạn khung hình rồi nối lại."""
    segs, listfile = [], tmp / "segs.txt"
    for i, f in enumerate(framing):
        t0 = float(f["t"])
        t1 = float(framing[i + 1]["t"]) if i + 1 < len(framing) else dur
        if t1 - t0 < 0.05:
            continue
        x, y, w, h, r = PRESETS[f.get("preset", "hero")] if "preset" in f else \
            (f["x"], f["y"], f["w"], f["h"], f.get("r", 40))
        w, h = w - w % 2, h - h % 2
        zoom = float(f.get("zoom", 1.0))
        px, py = float(f.get("pan_x", 0.5)), float(f.get("pan_y", 0.42))

        mask = tmp / f"mask_{i}.png"
        make_mask(w, h, r, mask)
        seg = tmp / f"seg_{i:03d}.mp4"

        # scale=cover -> crop theo tâm ngắm -> bo góc -> đặt lên canvas
        vf = (
            f"[1:v]scale={int(w*zoom)}:{int(h*zoom)}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}:'(iw-{w})*{px}':'(ih-{h})*{py}',setsar=1[c];"
            f"[2:v]format=gray,scale={w}:{h}[m];"
            f"[c][m]alphamerge[cm];"
            f"[0:v][cm]overlay={x}:{y}:format=auto,format=yuv420p[v]"
        )
        sh(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-loop", "1", "-i", str(canvas),
            "-ss", f"{t0}", "-t", f"{t1-t0}", "-i", str(src),
            "-i", str(mask),
            "-filter_complex", vf, "-map", "[v]",
            "-t", f"{t1-t0}", "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
            "-pix_fmt", "yuv420p", str(seg)])
        segs.append(seg)

    listfile.write_text("".join(f"file '{s}'\n" for s in segs))
    base = tmp / "base.mp4"
    sh(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat",
        "-safe", "0", "-i", str(listfile), "-c", "copy", str(base)])
    return base


# ----------------------------------------------------------------- lớp đồ hoạ
def build_overlay(story, framing, dur, fps, tmp):
    els = list(story.get("graphics", []))
    # tự thêm viền + quầng sáng quanh thẻ video cho mỗi đoạn khung hình
    for i, f in enumerate(framing):
        t0 = float(f["t"])
        t1 = float(framing[i + 1]["t"]) if i + 1 < len(framing) else dur
        p = f.get("preset", "hero")
        if p == "full" or f.get("no_frame"):
            continue
        x, y, w, h, r = PRESETS[p] if "preset" in f else (f["x"], f["y"], f["w"], f["h"], f.get("r", 40))
        els.append({"module": "cardframe", "t": t0, "out": t1 - 0.03,
                    "x": x, "y": y, "w": w, "h": h, "r": r, "dur_in": 0.18})

    html = (HERE / "overlay_engine.html").read_text()
    for k, f in [("FONT_MEDIUM", "Medium"), ("FONT_SEMIBOLD", "SemiBold"),
                 ("FONT_BOLD", "Bold"), ("FONT_EXTRABOLD", "ExtraBold")]:
        html = html.replace(k, (FONTS / f"BeVietnamPro-{f}.ttf").as_uri())
    blob = json.dumps({"els": els, "caps": story.get("captions", [])}, ensure_ascii=False)
    html = html.replace("<script>", f"<script>window.STORY={blob};</script>\n<script>", 1)
    page = tmp / "overlay.html"
    page.write_text(html, encoding="utf-8")

    frames = tmp / "ov"
    frames.mkdir(exist_ok=True)
    n = int(math.ceil(dur * fps))
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb", "--font-render-hinting=none"])
        pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        pg.goto(page.as_uri())
        pg.wait_for_selector("body[data-ready='1']")
        pg.wait_for_timeout(400)  # chờ font nạp xong
        for i in range(n):
            pg.evaluate(f"setT({i/fps:.4f})")
            pg.screenshot(path=str(frames / f"{i:05d}.png"), omit_background=True)
            if i % 300 == 0:
                print(f"   … khung {i}/{n}", flush=True)
        b.close()
    return frames, n


# --------------------------------------------------------------------- ghép
def compose(base, frames, src, out, fps, dur, audio):
    af = audio.get("filter", "loudnorm=I=-14:TP=-1.5:LRA=11")
    sh(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(base),
        "-framerate", str(fps), "-i", str(frames / "%05d.png"),
        "-i", str(src),
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v];"
                           f"[2:a]{af}[a]",
        "-map", "[v]", "-map", "[a]", "-t", f"{dur}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-profile:v", "high", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(out)])


def main():
    sb = Path(sys.argv[1]).resolve()
    story = json.loads(sb.read_text(encoding="utf-8"))
    root = sb.parent
    src = (root / story["source"]).resolve()
    out = Path(story.get("output", "final.mp4"))
    if not out.is_absolute():
        out = root / out
    fps = int(story.get("fps", 30))

    _, _, sdur = probe(src)
    dur = float(story.get("duration") or sdur)
    framing = story.get("framing") or [{"t": 0, "preset": "hero"}]
    framing = sorted(framing, key=lambda f: float(f["t"]))

    tmp = Path(tempfile.mkdtemp(prefix="aikn_"))
    try:
        print("1/4  Vẽ canvas nền…", flush=True)
        canvas = tmp / "canvas.png"
        make_canvas(canvas, story.get("theme", {}))

        print("2/4  Dựng lớp video theo khung hình…", flush=True)
        base = build_base(src, canvas, framing, dur, fps, tmp)

        print("3/4  Kết xuất đồ hoạ + phụ đề…", flush=True)
        frames, n = build_overlay(story, framing, dur, fps, tmp)

        print("4/4  Ghép và mã hoá…", flush=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        compose(base, frames, src, out, fps, dur, story.get("audio", {}))
        print(f"Xong: {out}  ({dur:.1f}s, {n} khung)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
