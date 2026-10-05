// Template phụ đề karaoke — copy vào src/<slug>/ và chỉnh 3 chỗ đánh dấu TODO.
// Cơ chế: mỗi chunk 2-3 từ đứng yên, highlight quét từng từ theo tiến độ chunk.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
// TODO 1: đổi import cho khớp file chunks + font của bạn
import { chunks } from "./chunks";

const FONT = "Roboto"; // load bằng @remotion/google-fonts, subset "vietnamese"

// Hệ NĂNG ĐỘNG: trắng + highlight màu brand + viền đen giả
const STYLE_ENERGETIC = {
  fontSize: 68,
  base: "#FFFFFF",
  highlight: "#8CC63F", // TODO 2: màu brand của site
  shadow: (() => {
    const s: string[] = [];
    for (let dx = -5; dx <= 5; dx += 2.5)
      for (let dy = -5; dy <= 5; dy += 2.5)
        if (dx || dy) s.push(`${dx}px ${dy}px 0 #252525`);
    s.push("0px 8px 8px rgba(0,0,0,0.4)");
    return s.join(", ");
  })(),
};

// Hệ TƯỞNG NIỆM: kem + highlight vàng, shadow mềm (thay vào dưới nếu cần)
// { fontSize: 56, base: "#EAE3D2", highlight: "#E3C466",
//   shadow: "0 4px 18px rgba(0,0,0,0.85), 0 2px 4px rgba(0,0,0,0.9)" }

const S = STYLE_ENERGETIC;

// TODO 3: các khoảng ẩn phụ đề (cảnh có chữ trên hình trùng lời thoại)
const HIDDEN: { from: number; to: number }[] = [
  // { from: 0, to: 4.5 },
];

export const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (HIDDEN.some((h) => t >= h.from && t < h.to)) return null;
  const chunk = chunks.find((c) => t >= c.start && t < c.end);
  if (!chunk) return null;

  const n = chunk.words.length;
  const hi = Math.min(n - 1, Math.floor(((t - chunk.start) / (chunk.end - chunk.start)) * n));
  const localF = (t - chunk.start) * fps;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: "80%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        gap: 22,
        scale: String(0.9 + 0.1 * Math.min(1, localF / 3)),
        pointerEvents: "none",
      }}
    >
      {chunk.words.map((w, i) => (
        <span
          key={i}
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: S.fontSize,
            color: i === hi ? S.highlight : S.base,
            textShadow: S.shadow,
            whiteSpace: "nowrap",
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
};
