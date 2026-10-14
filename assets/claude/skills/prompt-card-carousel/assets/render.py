#!/usr/bin/env python3
"""
Render carousel slides (cover + prompt cards) to PNG images.

Usage:
    python render.py --data slides.json --out ./out
    python render.py --data slides.json --out ./out --template ./template.html --scale 2

slides.json schema:
{
  "config": { "width":1080, "height":1350, "scale":2,
              "theme":"ntk", "brand_name":"...", "brand_tagline":"..." },
  "slides": [ {cover...}, {card...}, ... ]
}

Output: out/slide_01.png, slide_02.png, ... (final size = width x height).
Requires: playwright (chromium) + Pillow. Internet is used to load Google Fonts.
"""
import argparse, json, os, sys, tempfile
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="path to slides.json")
    ap.add_argument("--out", required=True, help="output directory for PNGs")
    ap.add_argument("--template", default=str(Path(__file__).with_name("template.html")))
    ap.add_argument("--scale", type=int, default=0, help="supersample factor (default: from config or 2)")
    ap.add_argument("--prefix", default="slide_")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    cfg = data.get("config", {})
    W = int(cfg.get("width", 1080))
    H = int(cfg.get("height", 1350))
    scale = args.scale or int(cfg.get("scale", 2))
    scale = max(1, min(scale, 3))

    tpl = Path(args.template).read_text(encoding="utf-8")
    font_dir = Path(args.template).resolve().parent / "fonts"
    tpl = tpl.replace("__FONTDIR__", font_dir.as_uri())
    inject = "<script>window.__DATA__ = " + json.dumps(data, ensure_ascii=False) + ";</script>"
    html = tpl.replace("<!--DATA_INJECTION-->", inject)

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    tmp_html = out / "_render.html"
    tmp_html.write_text(html, encoding="utf-8")

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sys.exit("playwright is required: pip install playwright && playwright install chromium")
    try:
        from PIL import Image
    except Exception:
        sys.exit("Pillow is required: pip install pillow")

    files = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb", "--font-render-hinting=none"])
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=scale)
        page.goto(tmp_html.resolve().as_uri())
        # wait for fonts + layout/shrink JS
        try:
            page.wait_for_function("window.__READY__ === true", timeout=15000)
        except Exception:
            pass
        try:
            page.evaluate("document.fonts && document.fonts.ready")
            page.wait_for_function("document.fonts ? document.fonts.status === 'loaded' : true", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(600)

        slides = page.query_selector_all(".slide")
        n = len(slides)
        for i, s in enumerate(slides, 1):
            raw = out / f"{args.prefix}{i:02d}_raw.png"
            s.screenshot(path=str(raw))
            # downscale supersampled capture to exact target size, crisp
            img = Image.open(raw).convert("RGB")
            if img.size != (W, H):
                img = img.resize((W, H), Image.LANCZOS)
            final = out / f"{args.prefix}{i:02d}.png"
            img.save(final, "PNG")
            raw.unlink(missing_ok=True)
            files.append(str(final))
            print(f"  [{i}/{n}] {final.name}  ({W}x{H})")
        browser.close()

    tmp_html.unlink(missing_ok=True)
    print(json.dumps({"count": len(files), "files": files}, ensure_ascii=False))

if __name__ == "__main__":
    main()
