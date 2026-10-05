#!/usr/bin/env python3
"""Tao voice bang Vbee AIVoice API (thay the edge-tts o Buoc 4).

Chuan bi (1 lan):
1. Dang ky tai khoan tai https://studio.vbee.vn (AIVoice Studio)
2. Vao Dashboard > API (hoac lien he Vbee kich hoat goi API) de lay:
   - APP ID
   - API TOKEN (Bearer)
3. export VBEE_APP_ID="..." ; export VBEE_TOKEN="..."

Cach dung:
    python3 vbee_tts.py script.txt voice.mp3 --voice hn_female_ngochuyen_full_48k-fhg --speed 1.0

Voice code tieng Viet pho bien (xem danh sach day du trong dashboard):
    hn_female_ngochuyen_full_48k-fhg   nu Ha Noi (doc bao, pho bien nhat)
    hn_male_phuthang_stor80dt_48k-fhg  nam Ha Noi tram (hop tuong niem/thoi su)
    sg_female_thaotrinh_full_48k-fhg   nu Sai Gon
    sg_male_minhhoang_full_48k-fhg     nam Sai Gon
    hue_female_huong_full_48k-fhg      nu Hue

Luu y: endpoint/tham so duoi day theo tai lieu API v1 cua Vbee; neu tai khoan
cua ban dung phien ban khac, doi BASE cho khop tai lieu trong dashboard.
"""
import argparse
import json
import os
import sys
import time
import urllib.request

BASE = "https://vbee.vn/api/v1/tts"


def call(url: str, payload: dict | None, token: str):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("script_file")
    ap.add_argument("out_mp3")
    ap.add_argument("--voice", default="hn_female_ngochuyen_full_48k-fhg")
    ap.add_argument("--speed", type=float, default=1.0, help="0.5-2.0; tin nhanh ~1.05, tuong niem ~0.92")
    ap.add_argument("--bitrate", type=int, default=128)
    args = ap.parse_args()

    app_id = os.environ.get("VBEE_APP_ID")
    token = os.environ.get("VBEE_TOKEN")
    if not app_id or not token:
        sys.exit("Thieu VBEE_APP_ID / VBEE_TOKEN trong env")

    text = open(args.script_file, encoding="utf-8").read().strip()

    # 1) submit — khong dung callback, se poll
    payload = {
        "app_id": app_id,
        "input_text": text,
        "voice_code": args.voice,
        "audio_type": "mp3",
        "bitrate": args.bitrate,
        "speed_rate": str(args.speed),
        "response_type": "direct",  # neu goi ho tro tra truc tiep; fallback polling ben duoi
    }
    res = call(BASE, payload, token)
    print("submit:", json.dumps(res, ensure_ascii=False)[:300])

    result = res.get("result") or {}
    audio_url = result.get("audio_link") or res.get("audio_link")
    request_id = result.get("request_id") or res.get("request_id")

    # 2) poll neu chua co link
    if not audio_url and request_id:
        for i in range(60):
            time.sleep(3)
            st = call(f"{BASE}/{request_id}", None, token)
            r2 = st.get("result") or {}
            if r2.get("status") in ("SUCCESS", "success") or r2.get("audio_link"):
                audio_url = r2.get("audio_link")
                break
            print(f"  cho... ({i+1})")
    if not audio_url:
        sys.exit("Khong nhan duoc audio_link — kiem tra goi API/tai lieu trong dashboard")

    # 3) tai file
    urllib.request.urlretrieve(audio_url, args.out_mp3)
    print(f"OK -> {args.out_mp3}")


if __name__ == "__main__":
    main()
