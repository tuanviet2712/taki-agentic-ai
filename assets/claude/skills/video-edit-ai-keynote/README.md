# video-edit-ai-keynote

Skill dựng và render video talking-head dọc 9:16 theo phong cách "AI Dark Keynote".

Đọc `SKILL.md` trước. Tài liệu tra cứu nằm trong `references/`, mẫu trong `examples/`.

Chuỗi lệnh đầy đủ:

```bash
python3 scripts/prep.py raw.mp4 clean.mp4          # cắt im lặng, chuẩn hoá tiếng
python3 scripts/srt_to_captions.py phude.srt       # đổi .srt sang phụ đề đúng nhịp
python3 scripts/check_layout.py storyboard.json    # soi bố cục, phải về 0 lỗi
python3 scripts/render.py storyboard.json          # xuất file MP4
```

Cần `ffmpeg`, `python3`, `playwright` kèm Chromium, `Pillow`.
Font Be Vietnam Pro đã đóng gói trong `assets/fonts` (giấy phép SIL Open Font License).
