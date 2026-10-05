#!/usr/bin/env python3
"""Do word-timestamp cua file voice bang faster-whisper.

Cach dung:
    python3 transcribe.py voice.mp3 [words.json]

Xuat:
- words.json: [[start, end, "tu"], ...]
- In ra stdout: tong so tu, toc do noi, va cac khoang nghi >= 0.4s (ranh gioi cau)
"""
import json
import subprocess
import sys
import numpy as np

from faster_whisper import WhisperModel


def main() -> None:
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "words.json"

    # Giai ma bang ffmpeg ra mang float32 16k mono (KHONG dua duong dan file cho whisper):
    # faster-whisper 1.2.x doc file qua PyAV, ma PyAV 19 bo tham so no truyen vao -> loi metadata_errors.
    pcm = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", src, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        check=True, capture_output=True,
    ).stdout
    audio = np.frombuffer(pcm, dtype=np.float32)

    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(audio, language="vi", word_timestamps=True, vad_filter=True)

    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append((round(w.start, 2), round(w.end, 2), w.word.strip()))

    with open(out, "w", encoding="utf-8") as fh:
        json.dump(words, fh, ensure_ascii=False)

    dur = words[-1][1] - words[0][0]
    print(f"{len(words)} tu | {dur:.1f}s | {len(words)/dur:.2f} tu/s | ket thuc: {words[-1][1]}s")
    print("\n--- Khoang nghi >= 0.4s (ranh gioi cau) ---")
    for i in range(1, len(words)):
        gap = words[i][0] - words[i - 1][1]
        if gap >= 0.4:
            print(f"{words[i-1][1]:7.2f}s  nghi {gap:.2f}s | ...{words[i-1][2]} || {words[i][2]}...")
    print("\n--- Transcript (doi chieu voi script goc de sua loi chinh ta) ---")
    print(" ".join(w[2] for w in words))


if __name__ == "__main__":
    main()
