#!/usr/bin/env python3
"""
prep.py — Làm sạch clip talking-head trước khi dựng.

    python3 prep.py raw.mp4 clean.mp4 [--pad 0.10] [--min 0.30] [--keep 0.06]

Cắt bỏ các khoảng im lặng giữa câu (jump cut) để lời nói liền mạch, rồi chuẩn hoá
âm lượng. Nhịp dồn này chính là thứ tạo cảm giác "biên tập chặt" của phong cách.

Chạy bước này TRƯỚC khi làm phụ đề — vì cắt xong thì mốc thời gian đổi hết.
"""
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path


def sh(c):
    r = subprocess.run(c, capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-2500:])
        raise SystemExit("ffmpeg lỗi")
    return r.stdout + r.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--db", type=float, default=-30.0, help="ngưỡng coi là im lặng")
    ap.add_argument("--min", type=float, default=0.30, help="im lặng ngắn hơn mức này thì bỏ qua")
    ap.add_argument("--keep", type=float, default=0.06, help="chừa lại chút hơi thở mỗi đầu cắt")
    a = ap.parse_args()
    src = Path(a.src).resolve(); dst = Path(a.dst).resolve()

    dur = float(json.loads(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                               "-of", "json", str(src)]))["format"]["duration"])
    log = sh(["ffmpeg", "-hide_banner", "-i", str(src),
              "-af", f"silencedetect=n={a.db}dB:d={a.min}", "-f", "null", "-"])

    sil = []
    cur = None
    for m in re.finditer(r"silence_(start|end): (-?[\d.]+)", log):
        k, v = m.group(1), float(m.group(2))
        if k == "start":
            cur = v
        elif cur is not None:
            sil.append((cur, v)); cur = None
    if cur is not None:
        sil.append((cur, dur))

    # đảo ngược thành các đoạn CÓ tiếng
    keep, t = [], 0.0
    for s, e in sil:
        s, e = s + a.keep, e - a.keep
        if e - s <= 0.05:
            continue
        if s - t > 0.12:
            keep.append((t, s))
        t = e
    if dur - t > 0.12:
        keep.append((t, dur))
    if not keep:
        keep = [(0.0, dur)]

    new = sum(e - s for s, e in keep)
    print(f"Gốc {dur:.1f}s → còn {new:.1f}s (cắt {dur-new:.1f}s im lặng, {len(keep)} đoạn)")

    tmp = Path(tempfile.mkdtemp())
    parts = []
    for i, (s, e) in enumerate(keep):
        p = tmp / f"p{i:04d}.mp4"
        sh(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{s}", "-to", f"{e}",
            "-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
            "-c:a", "aac", "-b:a", "192k", "-avoid_negative_ts", "make_zero", str(p)])
        parts.append(p)
    lst = tmp / "l.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    sh(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(lst), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-c:a", "aac", "-b:a", "192k", str(dst)])
    print(f"Xong: {dst}")
    print("Bước tiếp: tạo phụ đề TỪ FILE NÀY (mốc thời gian đã đổi so với bản gốc).")


if __name__ == "__main__":
    main()
