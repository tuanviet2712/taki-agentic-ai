import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter, parseNote, safeName, safePath, stringifyFrontmatter } from "./brain.ts";
import { isoWeek, toMd } from "./brain-auto.ts";

describe("Bộ não — parsing", () => {
  it("reads front matter (scalars, inline and block lists)", () => {
    const { meta, body } = parseFrontmatter(`---\ntype: daily\ndone: false\nscore: 82\ntags: [ads, "sản phẩm"]\naliases:\n  - A\n  - B\n---\n# Hi\n`);
    expect(meta).toEqual({ type: "daily", done: false, score: 82, tags: ["ads", "sản phẩm"], aliases: ["A", "B"] });
    expect(body).toBe("# Hi\n");
  });
  it("round-trips its own front matter", () => {
    const meta = { type: "reminder", due: "2026-10-02T09:00:00+07:00", done: false, tags: ["a", "b c"] };
    expect(parseFrontmatter(`${stringifyFrontmatter(meta)}x`).meta).toEqual(meta);
  });
  it("finds title, [[links]] (aliases, headings, embeds), md links and #tags — not inside code", () => {
    const n = parseNote("---\ntitle: Kế hoạch\n---\n# Khác\nXem [[Content Agent]], [[03 - Work/Tết|Tết]], [[Wiki#Phần]] và ![[logo.png]].\n[ghi chú](05%20-%20Knowledge/FAQ.md) #ads #ý-tưởng\n```\n[[KhôngTính]] #khong\n```\n", "a/b.md");
    expect(n.title).toBe("Kế hoạch");
    expect(n.links.sort()).toEqual(["03 - Work/Tết", "05 - Knowledge/FAQ", "Content Agent", "Wiki", "logo.png"].sort());
    expect(n.tags.sort()).toEqual(["ads", "ý-tưởng"]);
  });
  it("falls back to H1, then file name", () => {
    expect(parseNote("# Tiêu đề\nabc", "x/y.md").title).toBe("Tiêu đề");
    expect(parseNote("abc", "x/Tên file.md").title).toBe("Tên file");
  });
});

describe("Bộ não — safety", () => {
  const root = resolve("/tmp/vault"); // "/tmp/vault" on POSIX, "<drive>:\tmp\vault" on Windows
  const v = { path: root };
  it("keeps every path inside the vault", () => {
    expect(safePath(v, "01 - Inbox/a.md")).toBe(join(root, "01 - Inbox", "a.md"));
    for (const bad of ["../x.md", "a/../../x.md", "", "a//b.md"]) expect(() => safePath(v, bad)).toThrow();
    expect(safePath(v, "/etc/passwd")).toBe(join(root, "etc", "passwd")); // leading slash = vault root, never the disk root
  });
  it("accepts a vault written with the other slash direction", () => {
    expect(safePath({ path: root.replace(/\\/g, "/") }, "a/b.md")).toBe(join(root, "a", "b.md"));
  });
  it("makes file-system-safe names", () => {
    expect(safeName('Ý tưởng: "A/B" #1?')).toBe("Ý tưởng A B 1");
    expect(safeName("   ")).toBe("Không tên");
  });
});

describe("Bộ não — logs", () => {
  it("ISO weeks", () => {
    expect(isoWeek("2026-10-01")).toBe("2026-W40");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-05")).toBe("2026-W02");
  });
  it("renders agent JSON as Markdown and skips empty fields", () => {
    const md = toMd({ "Tóm tắt": "ok", "Trống": "", "Ý": ["a", "b"], "Chi tiết": { x: 1 } });
    expect(md).toContain("## Tóm tắt: ok");
    expect(md).not.toContain("Trống");
    expect(md).toContain("- a\n- b");
    expect(md).toContain("**x**: 1");
  });
});
