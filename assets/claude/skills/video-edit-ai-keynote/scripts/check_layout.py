#!/usr/bin/env python3
"""
check_layout.py — Soi storyboard TRƯỚC khi render (rẻ hơn render hỏng rất nhiều).

    python3 check_layout.py storyboard.json

Đo kích thước thật của từng khối đồ hoạ bằng Chromium rồi báo lỗi:
  · đồ hoạ đè lên thẻ video
  · đồ hoạ đè lên dải phụ đề
  · hai khối đồ hoạ đè nhau
  · đồ hoạ tràn ra ngoài lề an toàn
  · nhịp phụ đề quá dài / quá ngắn, chồng thời gian, hở thời gian
"""
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from render import PRESETS, FONTS, W, H, probe  # noqa: E402

CAP_BAND = (1010, 1105)   # dải phụ đề chiếm chỗ
MARGIN = 56               # lề an toàn trái/phải
TOP_SAFE, BOT_SAFE = 24, 1180


def overlap(a, b):
    x = min(a[2], b[2]) - max(a[0], b[0])
    y = min(a[3], b[3]) - max(a[1], b[1])
    return x > 6 and y > 6


def cards_during(framing, a, b, dur):
    """Mọi thẻ video xuất hiện trong khoảng [a,b) — đồ hoạ tồn tại lâu phải né tất cả."""
    out = []
    for i, f in enumerate(framing):
        t0 = float(f["t"])
        t1 = float(framing[i + 1]["t"]) if i + 1 < len(framing) else dur
        if t0 < b and t1 > a:
            if "preset" in f:
                x, y, w, h, _ = PRESETS[f["preset"]]
            else:
                x, y, w, h = f["x"], f["y"], f["w"], f["h"]
            out.append(((x, y, x + w, y + h), f.get("preset", "custom"), t0))
    return out


def main():
    sb = Path(sys.argv[1]).resolve()
    story = json.loads(sb.read_text(encoding="utf-8"))
    src = (sb.parent / story["source"]).resolve()
    _, _, sdur = probe(src)
    dur = float(story.get("duration") or sdur)
    framing = sorted(story.get("framing") or [{"t": 0, "preset": "hero"}],
                     key=lambda f: float(f["t"]))
    gfx = story.get("graphics", [])
    caps = story.get("captions", [])
    warn, err = [], []

    # ---------- đo kích thước thật của từng khối ----------
    html = (HERE / "overlay_engine.html").read_text()
    for k, f in [("FONT_MEDIUM", "Medium"), ("FONT_SEMIBOLD", "SemiBold"),
                 ("FONT_BOLD", "Bold"), ("FONT_EXTRABOLD", "ExtraBold")]:
        html = html.replace(k, (FONTS / f"BeVietnamPro-{f}.ttf").as_uri())
    blob = json.dumps({"els": gfx, "caps": caps}, ensure_ascii=False)
    html = html.replace("<script>", f"<script>window.STORY={blob};</script>\n<script>", 1)
    tmp = sb.parent / ".layout_probe.html"
    tmp.write_text(html, encoding="utf-8")

    rects = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": W, "height": H})
        pg.goto(tmp.as_uri())
        pg.wait_for_selector("body[data-ready='1']")
        pg.wait_for_timeout(400)
        for i, g in enumerate(gfx):
            settle = float(g["t"]) + 0.35 + 0.6 * max(0, len(g.get("items", [])) - 1) * \
                g.get("stagger", 0.55) / max(0.55, g.get("stagger", 0.55))
            settle = float(g["t"]) + 0.35 + max(0, len(g.get("items", [])) - 1) * g.get("stagger", 0.55)
            pg.evaluate(f"setT({settle:.3f})")
            r = pg.evaluate(f"(()=>{{const n=document.querySelectorAll('#stage .el')[{i}];"
                            "const b=n.getBoundingClientRect();"
                            "return [b.left,b.top,b.right,b.bottom];})()")
            rects.append(tuple(round(v) for v in r))
        b.close()
    tmp.unlink(missing_ok=True)

    # ---------- kiểm tra ----------
    for i, (g, r) in enumerate(zip(gfx, rects)):
        lbl = g.get('text') or g.get('label') or g.get('big') or g.get('l3')
        if not lbl:
            it = (g.get('items') or [''])[0]
            lbl = it.get('text', '') if isinstance(it, dict) else it
        name = f"[{i}] {g.get('module')} \"{str(lbl)[:22]}\""
        g_in, g_out = float(g["t"]), float(g.get("out") or dur)

        if r[0] < MARGIN - 2 or r[2] > W - MARGIN + 2:
            warn.append(f"{name}: tràn lề an toàn (x {r[0]}→{r[2]}, nên nằm trong {MARGIN}→{W-MARGIN})")
        if r[1] < TOP_SAFE or r[3] > BOT_SAFE:
            warn.append(f"{name}: sát mép trên/dưới (y {r[1]}→{r[3]})")

        for card, pname, ct in cards_during(framing, g_in, g_out, dur):
            if pname != "full" and overlap(r, card):
                err.append(f"{name}: ĐÈ LÊN THẺ VIDEO tại {max(ct,g_in):.1f}s "
                           f"(khối y {r[1]}→{r[3]} vs thẻ '{pname}' y {card[1]}→{card[3]})")

        if overlap(r, (0, CAP_BAND[0], W, CAP_BAND[1])):
            act = any(float(c["t"]) < g_out and
                      float(c["t"]) + float(c.get("d", 1)) > g_in for c in caps)
            (err if act else warn).append(
                f"{name}: ĐÈ LÊN DẢI PHỤ ĐỀ (y {r[1]}→{r[3]}, dải {CAP_BAND[0]}→{CAP_BAND[1]})")

        for j in range(i + 1, len(gfx)):
            h = gfx[j]
            if float(h["t"]) < g_out and (h.get("out") or dur) > g_in:
                if overlap(r, rects[j]):
                    err.append(f"{name} ĐÈ LÊN [{j}] {h.get('module')} (cùng hiển thị, y {r[1]}→{r[3]} vs {rects[j][1]}→{rects[j][3]})")

    # ---------- nhịp phụ đề ----------
    if caps:
        ds, prev_end = [], None
        for c in sorted(caps, key=lambda c: float(c["t"])):
            t0, d = float(c["t"]), float(c.get("d", 1.0))
            ds.append(d)
            nw = len(c["text"].replace("|", "").split())
            if d > 1.9:
                warn.append(f"Phụ đề {t0:.1f}s giữ {d:.1f}s — quá lâu, nên cắt nhỏ (chuẩn 0.8–1.3s)")
            if d < 0.45:
                warn.append(f"Phụ đề {t0:.1f}s chỉ {d:.2f}s — quá nhanh, người xem không kịp đọc")
            if nw > 7:
                warn.append(f"Phụ đề {t0:.1f}s có {nw} từ — nên tối đa 6 từ một dòng")
            if "|" not in c["text"]:
                pass
            if prev_end is not None:
                gap = t0 - prev_end
                if gap < -0.02:
                    err.append(f"Phụ đề {t0:.1f}s chồng thời gian với dòng trước")
                elif gap > 0.6:
                    warn.append(f"Hở {gap:.1f}s trước phụ đề {t0:.1f}s — màn hình trống chữ")
            prev_end = t0 + d
        avg = sum(ds) / len(ds)
        gold = sum(1 for c in caps if "|" in c["text"]) / len(caps)
        print(f"Phụ đề: {len(caps)} dòng · trung bình {avg:.2f}s/dòng · "
              f"{gold*100:.0f}% số dòng có từ khoá vàng")
        if not 0.75 <= avg <= 1.35:
            warn.append(f"Nhịp phụ đề trung bình {avg:.2f}s lệch chuẩn 0.8–1.3s của phong cách này")
        if gold < 0.5:
            warn.append(f"Chỉ {gold*100:.0f}% dòng có từ khoá bôi vàng — phong cách này cần khoảng 60–80%")

    shots = len(framing)
    print(f"Khung hình: {shots} lần đổi trên {dur:.0f}s "
          f"(trung bình {dur/max(1,shots):.1f}s một khung)")
    if dur / max(1, shots) > 12:
        warn.append("Đổi khung hình quá thưa — phong cách này đổi khoảng 5–8 giây một lần")

    print()
    for m in err:
        print("LỖI   " + m)
    for m in warn:
        print("LƯU Ý " + m)
    if not err and not warn:
        print("Không phát hiện vấn đề. Chạy render.py được rồi.")
    print()
    print(f"Tổng: {len(err)} lỗi, {len(warn)} lưu ý")
    sys.exit(1 if err else 0)


if __name__ == "__main__":
    main()
