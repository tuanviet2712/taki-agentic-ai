#!/usr/bin/env python3
"""
srt_to_captions.py — Đổi file .srt (xuất từ CapCut, YouTube, Whisper…) thành mảng
`captions` đúng nhịp của phong cách này.

    python3 srt_to_captions.py phude.srt > captions.json

Việc chính là CHIA LẠI: file .srt thường cho dòng dài 3–5 giây, còn phong cách này
chạy 0.8–1.3 giây một dòng, 3–6 từ. Script chia đều thời lượng theo số ký tự.

Script không tự tô vàng từ khoá — đó là việc cần đầu người. Sau khi chạy xong,
mở file ra và bọc từ khoá của mỗi dòng trong dấu |…|.
"""
import json, re, sys
from pathlib import Path

MAXW = 6          # tối đa số từ một dòng
TARGET = 1.05     # thời lượng mong muốn một dòng


def parse(txt):
    out = []
    for blk in re.split(r"\n\s*\n", txt.strip()):
        lines = [l for l in blk.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        m = re.search(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)",
                      " ".join(lines[:2]))
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        a = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        b = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        body = " ".join(l for l in lines if "-->" not in l and not re.fullmatch(r"\d+", l.strip()))
        body = re.sub(r"<[^>]+>", "", body).strip()
        if body:
            out.append((a, b, body))
    return out


def chunk(words, n):
    """Chia danh sách từ thành n cụm cân bằng, ưu tiên ngắt sau dấu phẩy."""
    if n <= 1:
        return [words]
    size = len(words) / n
    cuts, acc = [], 0.0
    for i in range(1, n):
        acc = size * i
        j = int(round(acc))
        j = max(1, min(len(words) - (n - i), j))
        # nhích về phía dấu phẩy gần nhất
        for k in (0, -1, 1):
            if 0 < j + k < len(words) and words[j + k - 1].endswith((",", ".", ":", ";")):
                j = j + k
                break
        cuts.append(j)
    cuts = sorted(set(cuts))
    res, prev = [], 0
    for c in cuts + [len(words)]:
        if c > prev:
            res.append(words[prev:c]); prev = c
    return res


def main():
    src = Path(sys.argv[1]).read_text(encoding="utf-8-sig")
    caps = []
    for a, b, body in parse(src):
        w = body.split()
        span = max(0.3, b - a)
        n = max(1, min(-(-len(w) // MAXW) if len(w) > MAXW else 1,
                       len(w)))
        n = max(round(span / TARGET), -(-len(w) // MAXW), 1)
        n = min(n, len(w))
        for part in chunk(w, n):
            frac = len(" ".join(part)) / max(1, len(body))
            d = round(span * frac, 2)
            caps.append({"t": round(a, 2), "d": max(0.5, d), "text": " ".join(part)})
            a += d
    # dồn khít, không hở không chồng
    for i in range(len(caps) - 1):
        caps[i]["d"] = round(max(0.5, caps[i + 1]["t"] - caps[i]["t"]), 2)

    avg = sum(c["d"] for c in caps) / max(1, len(caps))
    sys.stderr.write(f"{len(caps)} dòng · trung bình {avg:.2f}s/dòng\n"
                     "Nhớ bọc từ khoá trong |…| cho khoảng 60–80% số dòng.\n")
    print(json.dumps(caps, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
