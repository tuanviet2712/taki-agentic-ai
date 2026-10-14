import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, byId, closeDb, insert, openDb, q, type Row } from "@dotaka/db";
import { SKILLS_DIR, TEAM, syncSkills } from "@dotaka/skills";
import {
  DATA_DIR, FLOW_TOOLS, FLOW_TOOL_URL_RE, NO_TOOL_ACCESS_MSG, UPLOAD_DIR, assertMediaInputPath, completeVideoJob, engineOf, environmentInstructions,
  friendlyFlowError, savedClips, startVideoJob, toolUrlFor,
} from "./creative.ts";
import { chromeBusy } from "./browser-publish.ts";

type FlowSettings = Parameters<typeof toolUrlFor>[0];

/**
 * Video Flow bị lặp "làm đi làm lại mà không xuất video": agent đã tạo/lưu clip nhưng không ghép xong.
 * Hệ thống phải TỰ GHÉP clip trong clips/ thành final.mp4 và đưa video về app (mục Duyệt) — không bỏ công sức + tín dụng Flow.
 * Chỉ với job Flow: "AI tự edit" (edit-source) cũng ghi clips/ nhưng không được tự nối.
 */
const venvPy = resolve(process.cwd(), "tools/video/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const canFinish = hasFfmpeg && existsSync(venvPy);

describe("hệ thống tự ghép video Flow", () => {
  let B: string;
  const tmp = mkdtempSync(join(tmpdir(), "autofinish-"));
  beforeAll(() => {
    process.env.DB_PATH = ":memory:";
    openDb(":memory:");
    B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    insert("agent_config", { biz_id: B, agent_key: "creative", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1, token_budget_day: 1, limits: {} });
  });
  afterAll(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); });

  const clip = (dir: string, name: string) => {
    const out = join(dir, name);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);
    return out;
  };
  const job = (name: string, tool = "review-gia-dung") => {
    const workdir = join(tmp, name);
    mkdirSync(join(workdir, "clips"), { recursive: true });
    const cj = insert("creative_job", { biz_id: B, tool, title: "Khăn giấy", status: "running", log: [], workdir,
      input: { tool, title: "Khăn giấy Top Gia", brief: "abcde", images: [], channels: ["facebook"], brand: "other", hookTitle: "19.000đ một lô", cta: "Bấm link mua ngay" } });
    return { id: cj.id as string, workdir };
  };
  const base = { durationSec: 0, redoneScenes: [], caption: "", notes: "" };

  it("clips/ sắp theo số thứ tự cảnh (scene_2 trước scene_10), bỏ tệp rỗng / không phải mp4", () => {
    const { workdir } = job("order");
    const dir = join(workdir, "clips");
    for (const f of ["scene_10.mp4", "scene_2.mp4", "scene_1.mp4"]) writeFileSync(join(dir, f), "x");
    writeFileSync(join(dir, "empty.mp4"), "");
    writeFileSync(join(dir, "note.txt"), "x");
    expect(savedClips(workdir).map((p) => basename(p))).toEqual(["scene_1.mp4", "scene_2.mp4", "scene_10.mp4"]);
  });

  it("agent dừng giữa chừng mà mới có 1/5 clip → KHÔNG ghép video cụt, báo lỗi như cũ", async () => {
    const { id, workdir } = job("partial");
    writeFileSync(join(workdir, "clips", "scene_01.mp4"), "x");
    await completeVideoJob(id, { ...base, status: "failed", finalPath: "", scenes: 5, script: [], notes: "Mất phiên Tool" });
    expect(byId<Row>("creative_job", id)).toMatchObject({ status: "failed" });
    expect(existsSync(join(workdir, "final.mp4"))).toBe(false);
  });

  it("agent báo 'blocked' (chính sách / hết tín dụng) khi chưa đủ số cảnh → không ghép video cụt, giữ nguyên lý do", async () => {
    const { id, workdir } = job("blocked-partial");
    for (const f of ["scene_01.mp4", "scene_02.mp4"]) writeFileSync(join(workdir, "clips", f), "x");
    await completeVideoJob(id, { ...base, status: "blocked", finalPath: "", scenes: 0, script: [], notes: "Lỗi chính sách nội dung ở cảnh 3" });
    const j = byId<Row>("creative_job", id)!;
    expect(j).toMatchObject({ status: "blocked", error: "Lỗi chính sách nội dung ở cảnh 3" });
    expect(existsSync(join(workdir, "final.mp4"))).toBe(false);
  });

  it("NO_TOOL_ACCESS do agent ghi → trạng thái 'blocked' + câu báo rõ cho Sếp (không in nguyên văn marker)", async () => {
    const { id } = job("no-access");
    await completeVideoJob(id, { ...base, status: "blocked", finalPath: "", scenes: 0, script: [], notes: "NO_TOOL_ACCESS: trang báo You need access" });
    expect(byId<Row>("creative_job", id)).toMatchObject({ status: "blocked", error: NO_TOOL_ACCESS_MSG });
  });

  it.skipIf(!canFinish)("agent báo xong nhưng không có final.mp4 → hệ thống tự ghép clip, video về mục Duyệt", async () => {
    const { id, workdir } = job("done-no-final");
    clip(join(workdir, "clips"), "scene_01.mp4");
    clip(join(workdir, "clips"), "scene_02.mp4");
    await completeVideoJob(id, { ...base, status: "done", finalPath: "", scenes: 2, script: [], caption: "Khăn giấy dai #topgia" });
    const j = byId<Row>("creative_job", id)!;
    expect(j.status).not.toBe("failed");
    expect(existsSync(join(workdir, "final.mp4"))).toBe(true);
    const asset = byId<Row>("creative_asset", j.asset_id)!;
    expect(asset.path).toBe(join(workdir, "final.mp4"));
    expect(asset.duration).toBeGreaterThan(1.5); // 2 clip × 1 giây đã được nối
    expect([asset.width, asset.height]).toEqual([1080, 1920]);
    expect(q.get("SELECT id FROM approval WHERE subject_type = 'creative_job' AND subject_id = ?", id)).toBeTruthy();
    expect(String((j.result as Row).notes)).toMatch(/Hệ thống tự ghép 2 clip/);
    expect(q.get("SELECT id FROM audit_log WHERE event = 'creative.auto_finished' AND ref_id = ?", id)).toBeTruthy();
  }, 120_000);

  it.skipIf(!canFinish)("agent dừng (failed) nhưng đã lưu đủ clip → vẫn tự ghép, lấy lời thoại từ script.json agent đã ghi", async () => {
    const { id, workdir } = job("failed-full");
    clip(join(workdir, "clips"), "scene_01.mp4");
    clip(join(workdir, "clips"), "scene_02.mp4");
    writeFileSync(join(workdir, "script.json"), JSON.stringify([{ canh: 1, loi_thoai: "" }, { canh: 2, loi_thoai: "" }]));
    await completeVideoJob(id, { ...base, status: "failed", finalPath: "", scenes: 0, script: [], notes: "Hết giờ" });
    expect(byId<Row>("creative_job", id)!.status).not.toBe("failed");
    expect(existsSync(join(workdir, "final.mp4"))).toBe(true);
  }, 120_000);

  it.skipIf(!canFinish)("'AI tự edit' (edit-source) có clip trong clips/ mà không có final.mp4 → KHÔNG tự nối (các đoạn cắt do agent dựng)", async () => {
    const { id, workdir } = job("edit-source", "edit-source");
    clip(join(workdir, "clips"), "scene_01.mp4");
    clip(join(workdir, "clips"), "scene_02.mp4");
    await completeVideoJob(id, { ...base, status: "done", finalPath: "", scenes: 2, script: [] });
    expect(byId<Row>("creative_job", id)).toMatchObject({ status: "failed" });
    expect(existsSync(join(workdir, "final.mp4"))).toBe(false);
    expect(q.get("SELECT id FROM audit_log WHERE event = 'creative.auto_finished' AND ref_id = ?", id)).toBeUndefined();
  }, 60_000);
});

describe("công cụ Flow: lỗi thiếu quyền, link bản sao, lời dặn cho agent", () => {
  it("thiếu quyền mở Tool → câu báo rõ cho Sếp; lỗi khác giữ nguyên", () => {
    expect(friendlyFlowError("NO_TOOL_ACCESS: trang báo You need access")).toBe(NO_TOOL_ACCESS_MSG);
    expect(friendlyFlowError("Trang hiện 'Request access' khi mở Tool")).toBe(NO_TOOL_ACCESS_MSG);
    expect(friendlyFlowError("Hết tín dụng Flow")).toBe("Hết tín dụng Flow");
    expect(NO_TOOL_ACCESS_MSG).toMatch(/Tài khoản Google chưa có quyền mở Tool này — nhờ người chia sẻ Tool hoặc dùng bản sao/);
  });

  it("link bản sao thay link mặc định; link lạ bị từ chối", () => {
    const copy = "https://flow.google.com/project/abc/tool/xyz";
    expect(toolUrlFor({ toolUrls: { "nhan-hieu": copy } } as FlowSettings, "nhan-hieu")).toBe(copy);
    expect(toolUrlFor({ toolUrls: {} } as FlowSettings, "nhan-hieu")).toBe(FLOW_TOOLS["nhan-hieu"].toolUrl);
    expect(toolUrlFor({ toolUrls: {} } as FlowSettings, "cinematic")).toBeNull();
    expect(FLOW_TOOL_URL_RE.test(copy)).toBe(true);
    expect(FLOW_TOOL_URL_RE.test("https://evil.example/project/a/tool/b")).toBe(false);
    expect(FLOW_TOOL_URL_RE.test("http://flow.google.com/project/a/tool/b")).toBe(false);
  });

  const dflt = FLOW_TOOLS["nhan-hieu"].toolUrl!;
  const env = (toolUrl: string | null, defaultToolUrl: string | null = dflt, generator = false) =>
    environmentInstructions({ toolLabel: "BRANDUP STUDIO", toolUrl, defaultToolUrl, uiMap: ["Bước 1"], email: "a@b.c", workdir: "/w/job", rawDir: "/w/job/raw", generator }).join("\n");

  it("lời dặn: link mặc định đòi đúng tiêu đề; link bản sao (Remix) cho phép đổi tên và cấm ?mode=EDIT", () => {
    const std = env(dflt);
    expect(std).toContain(`browser_navigate ${dflt}`);
    expect(std).toContain('tiêu đề trên cùng phải là "BRANDUP STUDIO"');
    expect(std).not.toContain("BẢN SAO (Remix)");
    const own = "https://flow.google.com/project/own1/tool/t1";
    const copy = env(own);
    expect(copy).toContain(`browser_navigate ${own}`);
    expect(copy).toContain("BẢN SAO (Remix)");
    expect(copy).toContain("ĐÃ ĐỔI TÊN");
    expect(copy).toContain("KHÔNG thêm ?mode=EDIT");
    expect(copy).not.toContain("tiêu đề trên cùng phải là");
  });

  it("lời dặn: dấu NO_TOOL_ACCESS (ghi result.json blocked) + luật lỗi chính sách; không có Tool riêng thì không có dòng quyền Tool", () => {
    const std = env(dflt);
    expect(std).toContain('notes bắt đầu bằng "NO_TOOL_ACCESS:"');
    expect(std).toContain('ghi result.json status "blocked"');
    expect(std).toContain("Lỗi chính sách nội dung của Flow");
    expect(std).toContain("chỉ người lớn sử dụng");
    expect(std).toContain("taki-flow-save"); // cách lấy clip của engine Chrome Flow vẫn nguyên
    expect(std).toContain("taki-flow-wait");
    const gen = env(null, null, true);
    expect(gen).not.toContain("NO_TOOL_ACCESS");
    expect(gen).toContain("Lỗi chính sách nội dung của Flow");
  });

  it("skill của mọi công cụ dùng skill có trên đĩa, có trong danh sách nạp của Creative và nạp được vào DB", () => {
    openDb(":memory:");
    try {
      const B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
      const listed = TEAM.find((t) => t.agents.includes("creative"))!.extraSkills!;
      const skills = [...new Set(Object.values(FLOW_TOOLS).map((t) => t.skill).filter(Boolean))];
      expect(skills.length).toBeGreaterThan(8);
      for (const s of skills) {
        expect(existsSync(join(SKILLS_DIR, s, "SKILL.md")), s).toBe(true);
        expect(listed, s).toContain(s);
      }
      const r = syncSkills(B, "test");
      for (const s of skills) expect(r.missing, s).not.toContain(s);
      for (const s of skills) expect(q.get<Row>("SELECT status FROM skill WHERE biz_id = ? AND key = ?", B, s)?.status, s).toBe("active");
    } finally { closeDb(); }
  });
});

describe("tệp đầu vào của job video chỉ nằm trong data/uploads | data/creative", () => {
  const ok = [join(UPLOAD_DIR, "abc_anh.jpg"), join(DATA_DIR, "creative", "job1", "clips", "scene_01.mp4")];
  it("nhận tệp trong thư mục tải lên / thư mục job", () => {
    for (const p of ok) expect(assertMediaInputPath(p)).toBe(resolve(p));
  });
  it("từ chối tệp ngoài, '..' thoát thư mục, thư mục trùng tiền tố", () => {
    const bad = [
      process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd",
      join(UPLOAD_DIR, "..", "..", "package.json"),
      join(UPLOAD_DIR, "..", "dotaka.db"),
      `${UPLOAD_DIR}-evil${process.platform === "win32" ? "\\" : "/"}x.jpg`,
      join(tmpdir(), "x.jpg"),
    ];
    for (const p of bad) expect(() => assertMediaInputPath(p), p).toThrow(/ngoài thư mục tải lên/);
    try { assertMediaInputPath(bad[0]!); } catch (e: any) { expect(e.code).toBe("PATH_NOT_ALLOWED"); }
  });
  it.skipIf(process.platform !== "win32")("Windows: không phân biệt hoa/thường và dùng được dấu /", () => {
    expect(() => assertMediaInputPath(UPLOAD_DIR.toUpperCase() + "\\A.JPG")).not.toThrow();
    expect(() => assertMediaInputPath(UPLOAD_DIR.replace(/\\/g, "/") + "/a.jpg")).not.toThrow();
  });
  it("khớp với isolation của engine: engineOf phân biệt Flow và máy chạy tại chỗ", () => {
    expect(engineOf("review-gia-dung")).toBe("flow");
    expect(engineOf("nhan-hieu-dao-ly")).toBe("flow");
    expect(["edit-source", "auto-video", "news-video", "portrait"].map(engineOf)).toEqual(["edit", "moneyprinter", "news", "liveportrait"]);
  });
});

describe("startVideoJob: kiểm tra đầu vào trước khi tạo job", () => {
  let B: string;
  beforeAll(() => {
    process.env.DB_PATH = ":memory:";
    openDb(":memory:");
    B = insert("biz", { name: "Shop", settings: { ...DEFAULT_SETTINGS, llm: { provider: "sandbox" } } }).id;
    insert("agent_config", { biz_id: B, agent_key: "creative", autonomy: "L1", enabled: 1, tools: [], token_budget_run: 1, token_budget_day: 1, limits: {} });
  });
  afterAll(() => closeDb());
  const jobs = () => q.scalar<number>("SELECT COUNT(*) FROM creative_job") ?? 0;
  const outside = join(tmpdir(), "khong-co-tep.jpg");
  const evil = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";

  it("thiếu ảnh bắt buộc → 'Cần ảnh:' và không tạo job", () => {
    const before = jobs();
    expect(() => startVideoJob(B, { tool: "review-gia-dung", title: "Nồi chiên", brief: "Nồi chiên 6L" }, "test")).toThrow(/Cần ảnh: Sản phẩm \(ảnh tổng thể\)/);
    expect(() => startVideoJob(B, { tool: "portrait", title: "Chào khách", brief: "Mỉm cười chào khách" }, "test")).toThrow(/Cần 1 ảnh chân dung/);
    expect(jobs()).toBe(before);
  });

  it("job Flow: ảnh ngoài data/uploads | data/creative → PATH_NOT_ALLOWED (agent tải ảnh lên web từ trình duyệt)", () => {
    const before = jobs();
    for (const path of [evil, outside]) {
      expect(() => startVideoJob(B, { tool: "review-gia-dung", title: "Nồi chiên", brief: "Nồi chiên 6L", images: [{ path, role: "Sản phẩm 1" }] }, "test")).toThrow(/ngoài thư mục tải lên/);
    }
    expect(jobs()).toBe(before);
  });

  it("engine chạy tại máy: video gốc / video mẫu ngoài thư mục tải lên bị chặn; ảnh chân dung (kể cả từ Agentic Brain) chỉ cần tồn tại", () => {
    const before = jobs();
    expect(() => startVideoJob(B, { tool: "edit-source", title: "Cắt", brief: "Cắt video", video: { materials: [evil.replace(/\.ini$/, ".mp4")] } }, "test")).toThrow(/ngoài thư mục tải lên/);
    expect(() => startVideoJob(B, { tool: "portrait", title: "Chào", brief: "Chào khách", images: [], video: { drivingPath: evil } }, "test")).toThrow(/ngoài thư mục tải lên/);
    // Ảnh chân dung ngoài root không bị path-guard (chỉ kiểm tra có tồn tại) → lỗi là NO_FILE chứ không phải PATH_NOT_ALLOWED.
    expect(() => startVideoJob(B, { tool: "portrait", title: "Chào", brief: "Chào khách", images: [{ path: outside, role: "Nhân vật" }] }, "test")).toThrow(/Không thấy ảnh/);
    expect(jobs()).toBe(before);
  });

  it("Chrome Flow bận chỉ khi có job engine Flow đang chạy (edit-source / video máy không chặn đăng qua Chrome)", () => {
    const run = (tool: string) => insert("creative_job", { biz_id: B, tool, title: "Đang chạy", status: "running", log: [], input: { tool } });
    const edit = run("edit-source");
    const local = run("auto-video");
    expect(chromeBusy(B)).toBeNull();
    const flow = run("review-gia-dung");
    expect(chromeBusy(B)).toMatch(/Chrome Flow đang làm video/);
    for (const j of [edit, local, flow]) q.run("DELETE FROM creative_job WHERE id = ?", j.id);
    expect(chromeBusy(B)).toBeNull();
  });
});
