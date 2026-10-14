#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: inspect_video.sh <video-file> [output-directory]" >&2
  exit 2
fi

input="$1"
output_dir="${2:-video-inspection}"

if [ ! -f "$input" ]; then
  echo "Video not found: $input" >&2
  exit 2
fi

mkdir -p "$output_dir"

ffprobe -v error \
  -show_entries format=filename,duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels \
  -of json "$input" > "$output_dir/metadata.json"

ffmpeg -loglevel error -y -i "$input" \
  -vf "fps=1/5,scale=270:-1,tile=4x4" -frames:v 1 \
  "$output_dir/contact-sheet.jpg"

ffmpeg -loglevel error -y -i "$input" -vn -ac 1 -ar 16000 \
  "$output_dir/audio.wav"

echo "Created metadata.json, contact-sheet.jpg, and audio.wav in $output_dir"
