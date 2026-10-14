#!/usr/bin/env python3
"""Post-production for Flow clips: normalise -> concat -> burn Vietnamese subtitles, hook title and CTA.

The local ffmpeg build has no libass/drawtext, so text is rendered to transparent PNGs with Pillow and
composited with ffmpeg's `overlay` filter (always available).

Usage:
  finish.py --clips s01.mp4 s02.mp4 ... --script script.json --out final.mp4 [--title "..."] [--cta "..."] [--timing whisper|even]
script.json: [{"canh": 1, "loi_thoai": "..."}, ...]  (one entry per clip, same order)
Prints a JSON report on stdout.

Phụ đề khớp giọng nói (--timing whisper, mặc định): faster-whisper lấy mốc thời gian TỪNG TỪ trong clip, nhưng chữ
hiển thị vẫn là lời thoại trong script (AI nghe tiếng Việt dễ sai dấu) — chỉ mượn thời gian. Không có faster-whisper
hoặc clip không có tiếng nói → chia đều theo số từ như cũ.
"""
import argparse, json, os, subprocess, sys, tempfile

# Windows: stdout mặc định là cp1252 → in báo cáo JSON có tiếng Việt bị UnicodeEncodeError, lệnh thoát mã 1 dù final.mp4 ĐÃ ghép xong
# (agent tưởng hậu kỳ hỏng → làm lại video từ đầu). Luôn in UTF-8.
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1080, 1920, 30
# Font đóng gói kèm repo đứng đầu → phụ đề giống hệt trên mọi máy (macOS/Linux/Windows).
FONT_CANDIDATES = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts", "BeVietnamPro-Bold.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise SystemExit(json.dumps({"ok": False, "error": r.stderr[-1500:], "cmd": " ".join(cmd[:6])}))
    return r.stdout


def probe(path):
    j = json.loads(run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path]))
    streams = j.get("streams", [])
    return {
        "duration": float(j["format"]["duration"]),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "width": next((s.get("width") for s in streams if s.get("codec_type") == "video"), None),
        "height": next((s.get("height") for s in streams if s.get("codec_type") == "video"), None),
    }


def font(size):
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if draw.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def text_png(path, text, size, y_frac, box=False, color=(255, 255, 255)):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fnt = font(size)
    lines = wrap(d, text, fnt, W - 140)[:3]
    lh = int(size * 1.25)
    top = int(H * y_frac) - (lh * len(lines)) // 2
    if box:
        bw = max(d.textlength(l, font=fnt) for l in lines) + 60
        d.rounded_rectangle([(W - bw) / 2, top - 24, (W + bw) / 2, top + lh * len(lines) + 12], radius=24, fill=(0, 0, 0, 150))
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=fnt)
        d.text(((W - tw) / 2, top + i * lh), line, font=fnt, fill=color + (255,), stroke_width=0 if box else 6, stroke_fill=(0, 0, 0, 255))
    img.save(path)


def chunks(text, max_words=8):
    words = text.split()
    out, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) >= max_words or w.endswith((".", "!", "?", ",")) and len(cur) >= 4:
            out.append(" ".join(cur)); cur = []
    if cur:
        out.append(" ".join(cur))
    return out


_WHISPER = None  # None = chưa tải model · False = không dùng được (khỏi thử lại cho từng cảnh) · còn lại = model


def _load_audio(path):
    """Giải mã âm thanh bằng chính ffmpeg (giống tools/video/stt.py), không qua PyAV: faster-whisper 1.2.x truyền tuỳ chọn
    mà PyAV mới (av 19) đã bỏ, nên phiên âm trực tiếp từ đường dẫn lỗi và âm thầm rơi về chia đều."""
    import numpy as np
    pcm = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def speech_words(clip):
    """[(start, end)] của từng từ nói trong clip (faster-whisper, CPU int8). None nếu không dùng được."""
    global _WHISPER
    if _WHISPER is False:
        return None
    try:
        from faster_whisper import WhisperModel
        import numpy  # noqa: F401
    except ImportError:
        _WHISPER = False
        return None
    # Lỗi bất kỳ (không tải được model khi mất mạng, thiếu RAM, tên model sai…) → chia đều như cũ,
    # tuyệt đối không làm hỏng bước hậu kỳ của video Flow đã tốn tín dụng.
    try:
        if _WHISPER is None:
            _WHISPER = WhisperModel(os.environ.get("TAKI_WHISPER_MODEL", "small"), device="cpu", compute_type="int8")
    except Exception as e:  # noqa: BLE001
        print(f"whisper bỏ qua: {e}", file=sys.stderr)
        _WHISPER = False
        return None
    try:
        audio = _load_audio(clip)
        if not len(audio):
            return None
        segs, _ = _WHISPER.transcribe(audio, language="vi", vad_filter=True, word_timestamps=True)
        words = [(w.start, w.end) for s in segs for w in (s.words or []) if w.end > w.start]
    except Exception as e:  # noqa: BLE001
        print(f"whisper bỏ qua ({os.path.basename(clip)}): {e}", file=sys.stderr)
        return None
    return words or None


def timed_parts(parts, words, offset, duration):
    """Gán mốc thời gian cho từng cụm phụ đề: từ thứ i của script ↔ từ thứ i*nW/nS mà whisper nghe được."""
    n_script = sum(len(p.split()) for p in parts) or 1
    n_heard = len(words)
    out, i = [], 0
    for k, part in enumerate(parts):
        a = min(n_heard - 1, int(i * n_heard / n_script))
        i += len(part.split())
        b = min(n_heard - 1, max(a, int(i * n_heard / n_script) - 1))
        start = words[a][0]
        end = words[b][1] if k < len(parts) - 1 else max(words[b][1], words[-1][1])
        out.append((part, offset + start, offset + min(duration, end + 0.15)))
    # nối liền các cụm để chữ không nhấp nháy giữa hai câu sát nhau
    for k in range(len(out) - 1):
        if out[k + 1][1] - out[k][2] < 0.35:
            out[k] = (out[k][0], out[k][1], out[k + 1][1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", nargs="+", required=True)
    ap.add_argument("--script", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", default="")
    ap.add_argument("--cta", default="")
    ap.add_argument("--timing", choices=["whisper", "even"], default="whisper")
    a = ap.parse_args()

    script = json.load(open(a.script, encoding="utf-8"))
    tmp = tempfile.mkdtemp(prefix="finish_")
    info = [probe(c) for c in a.clips]

    # 1) normalise every clip (size/fps/audio) so concat is safe
    norm = []
    for i, (c, p) in enumerate(zip(a.clips, info)):
        o = os.path.join(tmp, f"n{i:02d}.mp4")
        vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps={FPS},setsar=1"
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", c]
        if not p["has_audio"]:
            cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest"]
        # veryfast (không phải medium): cùng CRF nên chất lượng như nhau, nhưng ~3× nhanh — đo trên máy 4 nhân: 5,9s thay vì 16s / clip 10s.
        cmd += ["-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", o]
        run(cmd)
        norm.append(o)

    # 2) concat
    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w", encoding="utf-8") as f:
        f.writelines("file '" + n.replace(os.sep, "/") + "'\n" for n in norm)
    merged = os.path.join(tmp, "merged.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", merged])

    # 3) text overlays: subtitles per scene (split evenly by words), hook title 0-3s, CTA on last scene
    overlays, t0, timed_scenes = [], 0.0, 0
    for i, p in enumerate(info):
        line = (script[i]["loi_thoai"] if i < len(script) else "").strip()
        parts = chunks(line) if line else []
        words = speech_words(norm[i]) if parts and a.timing == "whisper" and p["has_audio"] else None
        if words:
            timed_scenes += 1
            spans = timed_parts(parts, words, t0, p["duration"])
        else:
            total_words = sum(len(x.split()) for x in parts) or 1
            spans, t = [], t0
            for part in parts:
                dur = p["duration"] * len(part.split()) / total_words
                spans.append((part, t, t + dur))
                t += dur
        for k, (part, s, e) in enumerate(spans):
            png = os.path.join(tmp, f"s{i:02d}_{k:02d}.png")
            text_png(png, part, 64, 0.72)
            overlays.append((png, s, e))
        t0 += p["duration"]
    if a.title:
        png = os.path.join(tmp, "title.png"); text_png(png, a.title, 70, 0.14, box=True, color=(255, 214, 0))
        overlays.append((png, 0, min(3.0, t0)))
    if a.cta and info:
        png = os.path.join(tmp, "cta.png"); text_png(png, a.cta, 66, 0.14, box=True)
        overlays.append((png, t0 - info[-1]["duration"], t0))

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", merged]
    for png, _, _ in overlays:
        cmd += ["-i", png]
    graph, last = [], "[0:v]"
    for idx, (_, s, e) in enumerate(overlays, start=1):
        out = f"[v{idx}]"
        graph.append(f"{last}[{idx}:v]overlay=0:0:enable='between(t,{s:.2f},{e:.2f})'{out}")
        last = out
    if graph:
        cmd += ["-filter_complex", ";".join(graph), "-map", last, "-map", "0:a"]
    cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "copy", "-movflags", "+faststart", a.out]
    run(cmd)

    final = probe(a.out)
    print(json.dumps({"ok": True, "out": a.out, "duration": round(final["duration"], 2), "width": final["width"], "height": final["height"],
                      "has_audio": final["has_audio"], "scenes": len(a.clips), "overlays": len(overlays), "subtitle_timing": f"whisper {timed_scenes}/{len(a.clips)} cảnh" if a.timing == "whisper" else "even"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
