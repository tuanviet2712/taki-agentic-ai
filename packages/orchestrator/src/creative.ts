import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { FLOW_URL, listChromeProfiles } from "./chrome-profiles.ts";
import { browserPublish, browserReady, chromeLock, draftRoute, publishChannelFor, routeReason } from "./browser-publish.ts";
import { blockNotConnected, browserFailedBeforePosting, markNeedsCheck, permanentIfFinal, publishText, requeueLater } from "./publishing.ts";
import { approvalExpiresAt } from "./runtime.ts";
import { queueAutoApprove } from "./auto-approve-hook.ts";
import { parseVideoScript } from "./script-video.ts";
import { brandOfDna } from "./dna-intake.ts";
import { connectorForChannel } from "./connections.ts";
import { FLOW_COLLECT, NEWS_SKILL_DIR, REMOTION_NEWS, ensureVideoBins, finishMaterialJob, runAutoVideo, runPortrait, videoAiStatus } from "./video-ai.ts";
import { ensureFlowBrowser, flowAccounts, flowMcpConfig, flowSource, openFlowLogin, openInFlowChrome, syncFlowProfile } from "./flow-browser.ts";
import { claudeChromeEnvironment, claudeChromePreflight, flowEngine, friendlyChromeNote } from "./claude-chrome.ts";
import { approvedScript, scenesFor, manualFlowEnvironment, manualProjectUrl, manualTimeoutMin, planFile, planManualVideo, readManualPlan, type ManualPlan } from "./flow-manual.ts";
import { basename, delimiter, dirname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { activeDna, audit, bizSettings, byId, emit, insert, q, update, type Row } from "@dotaka/db";
import { ConnectorError, connector, platformForChannel } from "@dotaka/connectors";
import { effectiveProvider, followClaudeRun, modelFor, permissionPath, runClaudeInTerminal } from "@dotaka/llm-gateway";
import { agentPlaybook } from "@dotaka/skills";
import { AppError, logger, nowIso } from "@dotaka/shared";
import { PermanentError, enqueue } from "./queue.ts";
import { reviewOutput } from "./review.ts";
import { runProEdit } from "./pro-edit.ts";

/**
 * Creative Agent: produces finished videos on Google Flow by running the Marketing department's Flow skills
 * — inside the skill's own Flow Tool — through headless Claude Code + Playwright MCP attached to "Chrome Flow"
 * (flow-browser.ts; reaches into the Tool's sandboxed iframe), then post-produces locally (ffmpeg +
 * taki-video-finish), registers the asset, reviews it, and after approval uploads it to channels as a DRAFT.
 * Each run consumes Flow credits and drives the user's browser, so jobs are started explicitly and run
 * one at a time (lock "flow-chrome").
 */
/** Luồng "Làm thủ công trên Flow" (flow-manual.ts) — khai báo ở đây vì FLOW_TOOLS dùng ngay khi nạp module (tránh vòng import). */
export const MANUAL_TOOL = "flow-thu-cong";
export const MANUAL_FACE_ROLE = "Khuôn mặt nhân vật";
export const FLOW_TOOLS = {
  // Không dùng Tool: agent tự làm từng bước như người dựng (flow-manual.ts) — concept, ảnh storyboard, video Veo từng cảnh.
  [MANUAL_TOOL]: {
    skill: "", manual: true, label: "Làm thủ công trên Flow · Veo 3 (theo kịch bản)", minutes: 60,
    hint: "Kịch bản video đã duyệt (từ Sản xuất nội dung) + ảnh khuôn mặt nhân vật → AI tự nghĩ concept, chia cảnh 8 giây theo nhịp 10 giây ≈ 32–35 chữ, tạo ảnh storyboard rồi video Veo 3 từng cảnh, hệ thống tự ghép + phụ đề",
    toolUrl: null, uiMap: [],
    slots: [{ role: MANUAL_FACE_ROLE, label: "Ảnh nhân vật tham chiếu (khuôn mặt)", hint: "Chính diện, rõ mặt, 1 người — giữ đúng gương mặt này ở mọi cảnh", required: true }],
  },
  "review-do-an-vat": {
    skill: "flow-review-do-an-vat", label: "Review Đồ Ăn Vặt AI V6", minutes: 40,
    hint: "Ảnh bao bì sản phẩm + ảnh nhân vật review (Tool bắt buộc 2 ảnh này; thiếu thì AI tự tạo ảnh trên Flow), tên sản phẩm, giọng, ưu đãi/CTA",
    toolUrl: "https://flow.google.com/project/af2cb6c3-2519-40b3-ad29-58156bf9e264/tool/906532d8-6672-4f21-8bc4-55e5bd9cac91",
    slots: [
      { role: "Nhân vật / người review", label: "Người review (nhân vật chính)", hint: "Ô A trong Tool · ảnh rõ mặt, nửa người — thiếu thì AI tự tạo" },
      { role: "Bao bì / sản phẩm", label: "Ảnh sản phẩm / bao bì", hint: "Ô B trong Tool · ảnh thật của sản phẩm — thiếu thì AI tự tạo" },
      { role: "Bên trong sản phẩm", label: "Bên trong / miếng ăn", hint: "Ô I · tuỳ chọn" },
      { role: "Bối cảnh / góc bếp", label: "Bối cảnh", hint: "Ô E · tuỳ chọn" },
    ],
    // What the Tool (V6) actually shows — read live from the Tool on 2026-10-01; differs from the skill text on images.
    uiMap: [
      "Thanh tiến trình 5 bước: 1 CẤU HÌNH · 2 KHUNG CHỦ · 3 KỊCH BẢN · 4 STORYBOARD · 5 SẢN XUẤT (bấm số để quay lại bước).",
      "Bước 1 CẤU HÌNH: 4 ô ảnh A NHÂN VẬT (BẮT BUỘC) · B BAO BÌ (BẮT BUỘC) · I BÊN TRONG (ruột/miếng ăn, tuỳ chọn) · E BỐI CẢNH (tuỳ chọn); ô \"Tên sản phẩm *\" + nút XÁC NHẬN HỒ SƠ AI; MIỀN BẮC/MIỀN NAM; NỮ/NAM; thanh \"TỐC ĐỘ NÓI\" (slider); ô XƯNG HÔ; dòng \"Cần: …\" liệt kê thứ còn thiếu; TIẾP TỤC chỉ chạy khi đủ.",
      "Bấm một ô ảnh → Flow mở hộp \"Select media\" (NGOÀI iframe, trong trang chính) gồm Images / Uploads / \"Upload media\" / Recent. Tải ảnh mới: bấm \"Upload media\" rồi browser_file_upload đúng đường dẫn; hoặc chọn ảnh đã có trong Images.",
      "Gán ảnh đầu vào theo vai trò: \"Nhân vật\" → A; \"Bao bì\"/\"Sản phẩm\" → B; \"Bên trong\" → I; \"Bối cảnh\" → E.",
      "Thiếu ảnh A hoặc B: KHÔNG dừng. Về trang project (nút ← góc trên trái), tạo ẢNH bằng trình tạo gốc (chip cài đặt cạnh ô \"What do you want to create?\" → Image, 9:16, x1): A = chân dung người review Việt Nam phù hợp giới tính/miền, cầm đồ ăn, ánh sáng tự nhiên, nhìn camera; B = ảnh bao bì sản phẩm theo mô tả trong brief, nền sạch. Rồi quay lại Tool, chọn ảnh vừa tạo trong Images. Ghi vào notes là ảnh do AI tạo.",
      "\"NHẬT KÝ HỆ THỐNG (n)\" ở chân Tool: mở ra để đọc lỗi khi một bước không chạy; thu gọn lại nếu nó che nút TIẾP TỤC.",
      "Giọng: nút đang chọn có nền cam. Sau khi bấm MIỀN/GIỚI TÍNH, sang bước 3 kiểm tra dòng \"GIỌNG: …\" trên BẢNG KỊCH BẢN cho đúng.",
    ],
  },
  "review-thoi-trang": {
    skill: "flow-review-thoi-trang", label: "KOC FASHION – AI VIDEO STUDIO", modelNote: "", minutes: 45,
    hint: "Ảnh người mẫu/KOC + ảnh sản phẩm thời trang (thiếu thì AI tự tạo trên Flow), tên – chất liệu – màu, giá/ưu đãi, CTA",
    toolUrl: "https://flow.google.com/project/af2cb6c3-2519-40b3-ad29-58156bf9e264/tool/160aa62c-4027-46a9-a46a-7e5edb523c05",
    slots: [
      { role: "Người mẫu / KOC", label: "Người mẫu / KOC (nhân vật chính)", hint: "Bước 1 NHÂN VẬT · rõ mặt, nửa người/toàn thân — thiếu thì AI tự tạo" },
      { role: "Sản phẩm thời trang", label: "Ảnh sản phẩm (mặt trước)", hint: "Bước 2 · ảnh thật, rõ màu/logo — ảnh tham chiếu chính" },
      { role: "Chi tiết sản phẩm", label: "Mặt sau / chi tiết vải", hint: "Bước 2 · tuỳ chọn" },
      { role: "Bối cảnh (tham khảo)", label: "Bối cảnh tham khảo", hint: "Tuỳ chọn · Tool tự tạo ảnh bối cảnh, ảnh này để AI mô tả lại" },
    ],
    // Read from the Tool's own source on 2026-10-02 (shared tool 160aa62c, added to the review-do-an-vat project).
    uiMap: [
      "Màn chào \"KOC FASHION / AI VIDEO STUDIO\" → bấm \"Bắt đầu\" (bỏ qua nút logo). Tool KHÔNG lưu phiên: tải lại trang là về màn chào, mất hết dữ liệu — tránh reload giữa chừng.",
      "Thanh bước: NHÂN VẬT · SẢN PHẨM · CẤU HÌNH · KỊCH BẢN · XUẤT VIDEO (không bấm để nhảy bước; đi bằng nút Tiếp tục).",
      "NHÂN VẬT: nút \"THÊM ẢNH\" (tối đa 3 ảnh) + ô \"MÔ TẢ ĐẶC ĐIỂM NHÂN VẬT\" (>10 ký tự) → \"Khoá nhân vật & Tiếp tục\" → \"Tiếp tục\".",
      "Bấm ô thêm ảnh → Flow mở hộp \"Select media\" (NGOÀI iframe, trong trang chính): tải ảnh mới bằng \"Upload media\" + browser_file_upload đúng đường dẫn, hoặc chọn ảnh đã có trong Images; xác nhận lựa chọn trong hộp.",
      "Gán ảnh đầu vào theo vai trò: \"Người mẫu / KOC\" → THÊM ẢNH ở bước NHÂN VẬT; \"Sản phẩm thời trang\" → ô \"Ảnh sản phẩm\" đầu tiên; \"Chi tiết sản phẩm\" → các ô ảnh sản phẩm tiếp theo; \"Bối cảnh (tham khảo)\" KHÔNG tải lên được — xem ảnh (Read) rồi chọn preset gần nhất + viết vào ô mô tả bối cảnh.",
      "SẢN PHẨM: ô ảnh \"Ảnh sản phẩm\" (+), ô \"Tên sản phẩm\", 2 ô Chất liệu (vd \"Vải Tweed\") + Màu (vd \"Be kem\"), ô \"AI Phân tích chi tiết\" (tự viết, hoặc \"⚡ Tự động phân tích\"); select bối cảnh 6 preset + ô mô tả; \"Tạo ảnh bối cảnh chuẩn\" (Nano Banana Pro) → \"Thử đồ AI\" (cần ảnh nhân vật + sản phẩm + bối cảnh) → chụp màn hình soát đúng mặt + đúng sản phẩm → \"Khoá sản phẩm\" → \"Tiếp tục cấu hình\".",
      "CẤU HÌNH: Số lượng cảnh (nút remove/add, 1–12), Tỷ lệ 9:16 / 1:1 / 16:9 (clip chỉ ra 9:16 hoặc 16:9), 3 công tắc không ảnh hưởng clip → \"Tiếp tục viết kịch bản\".",
      "KỊCH BẢN: chế độ \"AI Soạn thảo\" KHÔNG có nút viết khi chưa có cảnh → bấm \"Tự dán kịch bản\", dán mỗi dòng 1 cảnh, \"Áp dụng cho N cảnh\". Mỗi cảnh: textarea \"Lời thoại AI\", input \"Mô tả hình ảnh\" (sửa thành pose + góc máy + chuyển động vải), select \"Thời lượng\" (chọn 8 giây; bộ đếm \"x/20 từ\" xanh là vừa). KHÔNG bấm \"Viết lại toàn bộ kịch bản\" (ghi đè lời thoại). \"Tạo tất cả ảnh mẫu\" → hộp \"Bắt đầu tạo N ảnh\" → chờ ảnh khung đầu → \"Tiến hành tạo Video\".",
      "XUẤT VIDEO: \"Tạo tất cả video\" (quay lần lượt, Veo 3.1 Lite 8s/cảnh, tự kiểm tra mặt + tự quay lại ≤2 lần). Tiến độ ở thanh nổi dưới cùng \"Tiến độ hoàn tất x/N\". Nhãn \"Nhân vật chưa khớp\" → xem clip rồi \"Tạo lại cảnh\" (≤1 lần) hoặc \"Bỏ qua lỗi\". Cảnh lỗi → \"Bắt đầu quay\". Nút \"Ghép & Tải Video\": KHÔNG bấm — dùng taki-flow-save.",
    ],
  },
  "nguoi-que-so-sanh": {
    skill: "flow-nguoi-que-so-sanh", label: "Người que so sánh sản phẩm", toolTitle: "Storyboard Studio VN", modelNote: "", minutes: 40,
    hint: "Sản phẩm A vs B + tiêu chí so sánh (giá, chất lượng, tiện lợi…), ảnh 2 sản phẩm, ảnh người que mẫu (thiếu thì AI tự tạo), giọng, CTA",
    toolUrl: "https://flow.google.com/project/af2cb6c3-2519-40b3-ad29-58156bf9e264/tool/7bf9f78b-cd78-4a29-9dc6-dc1ff72d1732",
    slots: [
      { role: "Nhân vật người que", label: "Người que mẫu (nhân vật chính)", hint: "Quyết định nét vẽ cả video — thiếu thì AI tạo người que trên Flow" },
      { role: "Sản phẩm A", label: "Sản phẩm A (của mình)", hint: "Ảnh rõ sản phẩm / bao bì" },
      { role: "Sản phẩm B", label: "Sản phẩm B (đối chứng)", hint: "Tuỳ chọn" },
    ],
    // Read from the Tool's own source on 2026-10-02 (shared tool 7bf9f78b "Storyboard Studio VN", added to the review-do-an-vat project).
    uiMap: [
      "Tiêu đề trong Tool là \"STORYBOARD STUDIO VN\" (tiêu đề trang Flow là tên project). Thanh bước: 1 Đầu vào · 2 Kịch bản · 3 Storyboard · 4 Video · 5 Hoàn thiện. Nút chính nằm ở THANH DƯỚI CÙNG hoặc cuối danh sách cảnh.",
      "Tool LƯU NHÁP trong trình duyệt: nếu mở ra đã có tham chiếu/kịch bản/bước > 1 của video trước → bấm \"Làm mới\" 2 lần (lần 1 đổi chữ thành \"Xóa dữ liệu?\", lần 2 xác nhận) — chỉ xóa nháp của Tool, được phép. Công tắc \"DEBUG PROMPT\" phải TẮT (bật thì không tạo gì).",
      "Bước 1: \"1. THAM CHIẾU (n/4)\" nút \"THÊM ẢNH\" (mỗi lần 1 ảnh) → hộp \"Select media\" của Flow (NGOÀI iframe): \"Upload media\" + browser_file_upload, hoặc chọn ảnh có sẵn. Ảnh 1 tự nhận vai NHÂN VẬT, ảnh sau là SẢN PHẨM; bấm nhãn vai dưới ảnh để đổi vòng Nhân vật→Sản phẩm→Bối cảnh→Khác. Mỗi khung chỉ dùng 3 tham chiếu đầu (Nhân vật + 2 cái khác).",
      "Gán ảnh đầu vào: \"Nhân vật người que\" → ảnh 1 (NHÂN VẬT); \"Sản phẩm A\" → ảnh 2; \"Sản phẩm B\" → ảnh 3 (SẢN PHẨM). Thiếu người que: về trang project tạo 1 ảnh người que (Image, 9:16, x1) rồi chọn trong Images.",
      "Bước 1 tiếp: ô \"2. PHONG CÁCH BỔ SUNG\" (tiếng Anh), \"3. TỶ LỆ KHUNG HÌNH\" 16:9/9:16/1:1, \"4. GIỌNG AI (VOICE LOCK)\" textarea + 3 nút Nam miền Bắc / Nữ miền Bắc / Nữ miền Nam; textarea lớn \"DÁN KỊCH BẢN TIẾNG VIỆT\" → \"Phân tích kịch bản\" (cần ≥1 tham chiếu) → tự sang bước 2.",
      "Bước 2 mỗi thẻ cảnh: ô tiêu đề, nút thời lượng 4s/6s/8s/10s, textarea \"MÔ TẢ HÌNH ẢNH (EN)\", textarea \"LỜI THOẠI (VN)\" với bộ đếm \"x/y từ\" (y = 2 từ/giây; đỏ = quá), Chuyển động static/push-in/action, checkbox \"Có thoại\", chế độ voice over/on camera (chọn voice over). \"Thêm cảnh\" ở đầu, \"Gỡ cảnh\" (bấm 2 lần). Cuối trang: \"Duyệt kịch bản → Sang Storyboard\".",
      "Bước 3: thanh dưới \"Tạo Scene 1 làm neo\" → xem ảnh → \"Duyệt Neo & Tạo phần còn lại\". Mỗi thẻ: \"Tạo lại\" và nút mỏ neo (anchor = tạo lại bám tham chiếu chặt hơn). Cuối lưới: \"Chuyển sang Video\".",
      "Bước 4: thanh dưới \"Tạo tất cả video chưa có\" (Omni 1.1 Flash, 2 clip song song); tiến độ \"x / N clip video\" ở thanh dưới; cảnh lỗi có \"Thử lại\"/\"Chi tiết\". Khi đủ N/N, Ở NGAY BƯỚC 4 (lưới video theo đúng thứ tự cảnh) chạy taki-flow-save. KHÔNG sang bước 5 bấm Ghép phim / Lưu video / Tải clip gốc.",
    ],
  },
  "nhan-hieu": {
    skill: "flow-video-nhan-hieu", label: "Video nhân hiệu · BrandUp", toolTitle: "BRANDUP STUDIO", minutes: 45,
    modelNote: "VIDEO MODEL trong Tool: giữ \"Gemini Omni 1.1\" (KHÔNG chọn Google Veo 3.1). Chỉ khi Omni báo \"usage limit\" ở mọi cảnh mới thử Veo 3.1 một lần.",
    hint: "Ảnh chân dung rõ mặt của chính người xây nhân hiệu (bắt buộc) + chủ đề/quan điểm/câu chuyện thật, giọng (nam/nữ), bối cảnh, CTA",
    toolUrl: "https://flow.google.com/project/af2cb6c3-2519-40b3-ad29-58156bf9e264/tool/505263ff-28b6-4c01-a5df-8dc66a5da221",
    slots: [
      { role: "Chân dung nhân hiệu", label: "Chân dung người xây nhân hiệu", hint: "Rõ mặt, chính diện — bắt buộc (đúng người đứng tên nhân hiệu)", required: true },
      { role: "Ảnh khác của nhân vật", label: "Ảnh khác của cùng người", hint: "Góc khác / nửa người / trang phục muốn giữ · tuỳ chọn" },
      { role: "Ảnh nền", label: "Ảnh nền (văn phòng, studio…)", hint: "Master Background · tuỳ chọn" },
    ],
    // Read from the Tool's own source on 2026-10-03 (shared tool 505263ff "BRANDUP STUDIO", added to the review-do-an-vat project).
    uiMap: [
      "Thanh trên Flow ghi tên Tool \"Remix of BRANDUP VIDEO TOOL - NGUYEN TAT KIEM\"; trong Tool là \"BRANDUP STUDIO\". 6 bước: 1 THIẾT LẬP · 2 NHÂN VẬT · 3 BỐI CẢNH · 4 TẠO MẪU · 5 KỊCH BẢN · 6 TẠO VIDEO. Đi bước bằng \"TIẾP TỤC\" / \"QUAY LẠI\" ở thanh dưới (không kiểm tra điều kiện); bước 5 là nút \"SẢN XUẤT\". Tool KHÔNG lưu phiên; nút \"RESET\" = tải lại trang, mất hết.",
      "Dropdown của Tool là nút tự vẽ (bấm nút có chữ giá trị hiện tại → bấm dòng lựa chọn), không phải <select>. Công tắc \"TỰ DO\"/\"KHÓA\" là 2 nút.",
      "Bước 1: ô \"GIỌNG AI CHUẨN (GEMINI)\" mở hộp chọn giọng — CHỈ hiển thị, KHÔNG được gửi khi tạo video. Khóa giọng thật sự = \"ÂM THANH THAM CHIẾU\" → \"CHỌN MẪU AUDIO\" → hộp chọn âm thanh của Flow (NGOÀI iframe). Hộp này KHÔNG nhận tệp .mp3 tải lên (đã thử 2026-10-03): dùng chức năng tạo GIỌNG TÙY CHỈNH trong hộp, mô tả bằng lời (vd \"giọng nam miền Bắc Việt Nam, khoảng 35 tuổi, điềm tĩnh, tự tin\"), chọn giọng vừa tạo làm âm thanh tham chiếu; ghi notes là giọng do Gemini tạo. Không cần taki-tts cho Tool này.",
      "Bước 1 tiếp: \"NGÔN NGỮ KỊCH BẢN\" = Tiếng Việt (Việt Nam); \"VIDEO MODEL\" = Gemini Omni 1.1 (giữ mặc định; Veo 3.1 cắt cảnh 10s về 8s); \"KÍCH THƯỚC VIDEO\" 9:16/16:9/1:1.",
      "Gán ảnh đầu vào: \"Chân dung nhân hiệu\" + \"Ảnh khác của nhân vật\" → bước 2 nút \"ẢNH THAM KHẢO\" (chọn nhiều, tối đa 5), rồi bấm ảnh chân dung để đặt làm ảnh chính (viền xanh + ✓); \"Ảnh nền\" → bước 3 \"Master Background\" nút \"Tải nền\". KHÔNG có ảnh chân dung thật → dừng, status \"blocked\" (không tự tạo người giả).",
      "Bước 2: Giới tính, Độ tuổi (ô số), \"Khóa gương mặt\" = KHÓA (ô mô tả mặt bị khóa), Kiểu tóc, Màu tóc; \"Mẫu trang phục\" + \"Khóa trang phục\" (KHÓA = giữ đồ trong ảnh); \"Phụ kiện\" mặc định \"Kính gọng đen\" — xóa nếu người trong ảnh không đeo kính.",
      "Bước 3: tab \"Cấu hình có sẵn\" (Địa điểm chính, Master Background, Thời điểm, Mood, Ánh sáng, Nhiệt độ màu, DoF, Thời tiết, Chuyển động môi trường) hoặc \"Cấu hình tự điền\"; khối \"Camera & Chuyển động\": Cách quay, Chuyển động NV, Cỡ cảnh, Chuyển động máy, ô \"Tính cách / Phong thái nhân vật\".",
      "Bước 4: \"TẠO MẪU MASTER REFERENCE\" (1 ảnh) → ảnh mới thành ảnh chính; chụp màn hình so mặt với ảnh gốc.",
      "Bước 5: textarea \"Dán kịch bản của bạn vào đây...\" → \"SẢN XUẤT\" (Tool tự chia cảnh theo câu, ≤30 từ/cảnh, 3 từ/giây). Bước 6 \"Bàn dựng phân cảnh\": mỗi cảnh có lời thoại, textarea \"AI Visualization Prompt\", nhãn \"x từ • ys\", nút \"TẠO VIDEO\"/\"TẠO LẠI\"; trên cùng \"SỬA KỊCH BẢN\" và \"TẠO TẤT CẢ\" (tạo lần lượt). Đủ video mọi cảnh → taki-flow-save ngay tại bước 6 (Tool không có nút ghép).",
    ],
  },
  // Skill video-nhan-hieu-google-flow: KHÔNG có Tool — dùng trình tạo video thường của Flow (Thành phần + ảnh nhân vật).
  "nhan-hieu-dao-ly": {
    skill: "video-nhan-hieu-google-flow", generator: true, label: "Video nhân hiệu · đi bộ nói đạo lý", minutes: 35,
    modelNote: "Trình tạo video THƯỜNG của Flow (không có Tool): Video · Thành phần (Ingredients) · 9:16 · Omni 1.1 Flash · 720p · 8 giây (10 giây khi lời 36–45 âm tiết) · x1. KHÔNG dùng 4K. ~12 tín dụng / cảnh 8s.",
    hint: "Ảnh chân dung nhân vật (bắt buộc) + chủ đề đạo lý (gia đình, hôn nhân, cha mẹ – con cái…) hoặc kịch bản có sẵn → nhân vật vừa đi bộ vừa nói, góc selfie, 4–5 cảnh ~30–40 giây, ghép + phụ đề",
    toolUrl: null,
    slots: [
      { role: "Nhân vật nói", label: "Ảnh nhân vật (người nói)", hint: "Rõ mặt, nửa người — bắt buộc; giữ đúng gương mặt ở mọi cảnh", required: true },
    ],
    uiMap: [
      "Trang dự án Flow: ô \"What do you want to create?\" / \"Bạn muốn tạo gì?\" ở cuối trang + chip cài đặt bên cạnh (loại nội dung, chế độ, tỉ lệ, model, độ phân giải, thời lượng, số lượng).",
      "Cài đặt cho MỌI cảnh: Video · Thành phần (Ingredients / Components) · 9:16 · Omni 1.1 Flash · 720p · 8 giây (10 giây nếu lời 36–45 âm tiết) · x1.",
      "Ảnh nhân vật: nút + / Tải nội dung lên (Upload media) → browser_file_upload đúng đường dẫn ảnh của Sếp; rồi chọn ảnh → \"Thêm vào câu lệnh\" (Add to prompt) cho từng cảnh.",
      "Gửi lần lượt các cảnh (không cần chờ cảnh trước xong). Thẻ video hiện % khi đang tạo; xong thì bấm vào thẻ để mở trình phát.",
      "Cảnh lỗi (sai lời / méo mặt): mở thẻ → \"Sử dụng lại câu lệnh\" (Reuse prompt) để tạo lại — tối đa 2 lần/cảnh.",
    ],
  },
  "koc-thoi-trang-nu": {
    skill: "flow-koc-thoi-trang-nu", label: "KOC thời trang nữ · Studio v3", toolTitle: "KOC Fashion Studio v3", minutes: 45,
    hint: "Ảnh sản phẩm thời trang nữ (bắt buộc, 1–3 món) + ảnh KOC và bối cảnh (thiếu thì AI tạo), tên – điểm nổi bật – giá/ưu đãi",
    toolUrl: "https://flow.google.com/project/b8bbfcb1-c140-4d8f-955b-008d1138bb7f/tool/91a76ef9-7703-42d5-a264-7031a9b6a5f6",
    slots: [
      { role: "Sản phẩm SP1", label: "Sản phẩm chính (SP1)", hint: "Ô SP1 · ảnh thật rõ màu, hoạ tiết — bắt buộc", required: true },
      { role: "KOC nữ", label: "KOC / người mẫu nữ", hint: "Ô KOC (mặt, tóc, dáng) · thiếu thì AI tạo người mẫu" },
      { role: "Sản phẩm SP2", label: "Món phối thêm (SP2)", hint: "Ô SP2 · tuỳ chọn" },
      { role: "Bối cảnh", label: "Background (bối cảnh)", hint: "Ô Background · thiếu thì AI tạo phòng/bối cảnh" },
    ],
    // Read from the Tool's own source on 2026-10-03 (shared tool 91a76ef9 "KOC Fashion Studio v3", account tuan0931579009).
    uiMap: [
      "Màn chào \"KOC FASHION / AI VIDEO STUDIO\" → \"Bắt đầu\". Tool KHÔNG lưu phiên (tải lại trang là mất hết). Cột trái: \"Model video\" (Veo 3.1 - Fast/Lite/Quality, Omni 1.1 Flash), \"Tỷ lệ khung hình (ảnh + video)\" 9:16/16:9, \"Âm thanh (áp cho tất cả cảnh)\"; các dropdown là nút tự vẽ (bấm giá trị hiện tại → bấm dòng chọn).",
      "KHÔNG bấm \"Tạo full video 1 click\" (chạy liền không dừng soát ảnh, và tự ghép thêm một video thừa vào trang) và KHÔNG bấm \"Bắt đầu lại\". Chạy từng bước bằng các nút trong vùng làm việc.",
      "Tải ảnh: 5 ô \"KOC (mặt / tóc / dáng)\", \"Sản phẩm SP1/SP2/SP3\", \"Background (bối cảnh)\" là <input type=file> TRONG iframe: browser_click ô → browser_file_upload đúng đường dẫn (không qua hộp Select media của Flow). Gán: \"Sản phẩm SP1\" → SP1, \"Sản phẩm SP2\" → SP2, \"KOC nữ\" → KOC, \"Bối cảnh\" → Background. Thiếu KOC/Background: về trang project tạo ảnh bằng trình tạo gốc của Flow (Image, 9:16, x1), khi ảnh hiện ra chạy taki-flow-save --images 4 --out <workdir>/inputs --prefix koc_ (hoặc bg_) — lưu tối đa 4 ảnh lớn đang hiện trên trang (trên → dưới, có cả ảnh trang trí) — Read từng tệp để chọn đúng ảnh vừa tạo, rồi quay lại Tool và browser_file_upload tệp đó vào ô; ghi notes là ảnh do AI tạo.",
      "Ba ô chữ: \"Tên SP…\", \"Điểm nổi bật…\", \"Giá / ưu đãi…\". Nút theo thứ tự: tạo ảnh KOC gốc (cảnh 1) → tạo 5 ảnh selfie (cảnh 2–6) → viết kịch bản → tạo tất cả video. Mỗi thẻ cảnh: nút tạo lại ảnh, nút \"Dùng ảnh có sẵn\" (ảnh 9:16), textarea \"Prompt chuyển động (tiếng Anh)...\", nút bật/tắt thoại, textarea \"Câu thoại tiếng Việt (tối đa 16 từ)...\", nút tạo/tạo lại video.",
      "Video: tối đa 2 cảnh song song, 8s/cảnh; Tool tự thử lại 5s/15s/30s → đổi model Veo dự phòng → bỏ thoại → rút gọn prompt (mỗi lần tốn tín dụng). Bảng \"Nhật ký tạo video\" cuối trang ghi model/kết quả từng lần. Đủ 6 cảnh có video → taki-flow-save NGAY (trước khi bấm \"Ghép full video\" — video ghép sẽ thành clip thừa).",
      "Tool dùng hộp thoại alert/confirm của trình duyệt: khi có dialog, đọc nội dung bằng snapshot rồi browser_handle_dialog — accept với thông báo, dismiss với \"Xoá toàn bộ…\".",
    ],
  },
  "review-gia-dung": {
    skill: "flow-review-gia-dung", label: "Review đồ gia dụng", toolTitle: "TOOL REVIEW GIA DỤNG", minutes: 35,
    hint: "Ảnh đồ gia dụng (bắt buộc, 1–3 ảnh) + công dụng, thông số, giá/ưu đãi, tên thương hiệu/shop; ảnh KOC nếu có (thiếu thì AI tự sinh)",
    toolUrl: "https://flow.google.com/project/b8bbfcb1-c140-4d8f-955b-008d1138bb7f/tool/c126d178-1bd0-49e8-bc27-c6b53870a42b",
    slots: [
      { role: "Sản phẩm 1", label: "Sản phẩm (ảnh tổng thể)", hint: "Ô 1 · ảnh thật rõ dáng, màu — bắt buộc", required: true },
      { role: "Sản phẩm 2", label: "Chi tiết / đang dùng", hint: "Ô 2 · tuỳ chọn" },
      { role: "Sản phẩm 3", label: "Phụ kiện / màu khác", hint: "Ô 3 · tuỳ chọn" },
      { role: "KOC mẫu", label: "KOC / người review", hint: "\"Dùng KOC Mẫu\" — thiếu thì AI tự sinh" },
    ],
    // Read from the Tool's own source on 2026-10-05 (shared tool c126d178 "TOOL REVIEW GIA DỤNG", account tuan0931579009).
    uiMap: [
      "Màn chào \"TOOL REVIEW GIA DỤNG\" → \"Bắt đầu sản xuất\". Tool KHÔNG lưu phiên. Cột trái \"AI STUDIO\" từ trên xuống: 1. Hình ảnh Sản phẩm (3 ô +) · 2. Thông tin sản phẩm (textarea \"Mô tả công dụng, tính năng, ưu đãi...\") · 3. Nhân vật KOC (2 nút \"AI Tự Sinh\" / \"Dùng KOC Mẫu\", chọn Dùng KOC Mẫu mới hiện ô \"Tải ảnh KOC mẫu\") · 4. Thiết lập AI (\"Tên Thương Hiệu\" mặc định GIA DỤNG VIỆT, dropdown \"Model Video\") · nút \"TẠO SHOWROOM GỐC\" · 5. Xuất bản: \"LÊN KỊCH BẢN KOC\", \"SẢN XUẤT TOÀN BỘ CLIPS\", \"TẢI GÓI ZIP\" (không bấm).",
      "Bấm ô ảnh sản phẩm / ô KOC → Flow mở hộp \"Select media\" (NGOÀI iframe, trong trang chính): tải ảnh mới bằng \"Upload media\" + browser_file_upload, hoặc chọn ảnh có sẵn. Gán: \"Sản phẩm 1/2/3\" → ô 1/2/3; \"KOC mẫu\" → bấm \"Dùng KOC Mẫu\" rồi ô \"Tải ảnh KOC mẫu\"; không có ảnh KOC → để \"AI Tự Sinh\".",
      "LUÔN sửa \"Tên Thương Hiệu\" (tên này đi vào lời thoại): thương hiệu/shop trong brief, không có thì tên sản phẩm. Ô Thông tin sản phẩm là nguồn DUY NHẤT của kịch bản và kịch bản KHÔNG sửa tay được trong Tool: viết đủ công dụng, thông số, giá/ưu đãi có trong brief, không thêm số liệu không có.",
      "\"TẠO SHOWROOM GỐC\" (1 ảnh 9:16) — cả 5 clip dùng ảnh này làm khung đầu. Chụp màn hình soát CÓ NGƯỜI REVIEW (bị chặn chính sách thì Tool tự tạo ảnh chỉ có sản phẩm mà vẫn báo xong) và đúng sản phẩm; hộp đỏ \"Lỗi Policy\" → bỏ từ nhạy cảm khỏi ô thông tin rồi tạo lại.",
      "\"LÊN KỊCH BẢN KOC\" → đọc 5 dòng \"Kịch bản:\" dưới 5 ô clip (sai thương hiệu/giá/số liệu → bấm lại, ≤ 2 lần). \"SẢN XUẤT TOÀN BỘ CLIPS\" chạy 5 clip cùng lúc; Tool KHÔNG tự thử lại — ô nào hết vòng tiến độ mà vẫn trống (nút \"TẠO CLIP\") là lỗi → bấm \"TẠO CLIP\" ở ô đó; clip sai → \"LÀM LẠI\". Đủ 5 clip → taki-flow-save (5 clip theo thứ tự ô 01→05).",
    ],
  },
  "review-nha-hang": {
    skill: "flow-review-nha-hang-shop", label: "Review nhà hàng · quán · shop", toolTitle: "TOOL TẠO VIDEO REVIEW NHÀ HÀNG - QUÁN XÁ", minutes: 40,
    hint: "Ảnh thật mặt tiền + không gian (bắt buộc), tên, địa chỉ, loại hình, món/dịch vụ nổi bật, giá, giờ mở cửa, ưu đãi; ảnh người review nếu có (không có thì AI tạo nhân vật ảo)",
    toolUrl: "https://flow.google.com/project/b8bbfcb1-c140-4d8f-955b-008d1138bb7f/tool/159cfd94-4f1a-481a-bd77-9e297bd1ae24",
    slots: [
      { role: "Mặt tiền", label: "Mặt tiền (ngoài quán)", hint: "Ô MẶT TIỀN · cảnh 1 · ảnh thật thấy biển hiệu — bắt buộc", required: true },
      { role: "Không gian", label: "Không gian bên trong", hint: "Ô KHÔNG GIAN · cảnh 2 trở đi · ảnh thật — bắt buộc", required: true },
      { role: "Người review", label: "Người review (KOC)", hint: "Ô ẢNH NHÂN VẬT THAM CHIẾU — thiếu thì tạo nhân vật ảo" },
    ],
    // Read from the Tool's own source on 2026-10-05 (shared tool 159cfd94 "TOOL TẠO VIDEO REVIEW NHÀ HÀNG - QUÁN XÁ", account tuan0931579009).
    uiMap: [
      "3 cột: trái \"Thiết lập Review\" · giữa 3 tab \"Kịch bản\" / \"Ảnh (9:16)\" / \"Video (9:16)\" · phải \"Quy trình Sản xuất\" với 3 nút theo thứ tự \"Tạo kịch bản\" → \"Tạo N ảnh (…)\" → \"Tạo N clip (…)\". Tool KHÔNG lưu phiên. Dropdown là nút tự vẽ (bấm giá trị hiện tại → bấm dòng chọn).",
      "Cột trái: \"Tên cửa hàng/quán\", \"Địa chỉ cụ thể\", \"Ý tưởng kịch bản\" (BẮT BUỘC — trống thì alert; là ô duy nhất mang nội dung vào kịch bản: viết món/dịch vụ, giá, giờ, ưu đãi có trong brief, không thêm gì), \"Tổng thời lượng\" 8s…64s (số đoạn = ÷8; theo thời lượng job, làm tròn bội 8), \"Khung hình\", \"Model Ảnh\", \"Model Video\" (Omni Flash / Veo 3.1 Lite / Fast / Quality), 3 ô ảnh, \"Loại hình kinh doanh\", \"Giọng văn / Phong cách\", thanh \"Mức độ đánh giá\" (chỉ hiển thị).",
      "Ô ảnh mở hộp \"Select media\" của Flow (NGOÀI iframe): \"Upload media\" + browser_file_upload, hoặc chọn ảnh có sẵn. Gán: \"Mặt tiền\" → ô MẶT TIỀN (cảnh 1), \"Không gian\" → ô KHÔNG GIAN (cảnh 2+), \"Người review\" → ô ẢNH NHÂN VẬT THAM CHIẾU; không có ảnh người review → nút \"Tạo Nhân vật ảo (FREE)\". Thiếu ảnh mặt tiền/không gian THẬT → dừng, status \"blocked\" (không để AI vẽ quán không có thật).",
      "Tab Kịch bản: thẻ \"Đoạn n (8s)\", nút bút (sửa) mở textarea; sửa mỗi đoạn thành câu nói 16–22 từ, bỏ mô tả cảnh/chú thích. KHÔNG bấm nút micro (ghi âm từ micro máy). Tab Ảnh: nhãn NGOÀI QUÁN / TRONG QUÁN, nút tạo lại từng ảnh. Tab Video: nút \"Thử lại\" khi lỗi, nút refresh để làm lại; taki-flow-save CHỈ khi đang mở tab Video (tab khác không có thẻ video). Hộp thoại alert (\"Vui lòng nhập ý tưởng…\", \"Vui lòng sản xuất ảnh mẫu trước!\") → browser_handle_dialog accept rồi bổ sung bước thiếu.",
    ],
  },
  "cooking-director": {
    skill: "flow-cooking-director-video", label: "Flow Cooking Director v2", minutes: 45, hint: "3 ảnh (chân dung người dẫn, món ăn, bao bì/góc bếp) + tên, giá, điểm nổi bật", toolUrl: null, uiMap: [],
    slots: [
      { role: "Nhân vật / người dẫn", label: "Người dẫn (nhân vật chính)", hint: "Chân dung rõ mặt" },
      { role: "Sản phẩm / món ăn", label: "Món ăn / sản phẩm", hint: "Ảnh thật của món / sản phẩm" },
      { role: "Bao bì / góc bếp", label: "Bao bì / góc bếp", hint: "Tuỳ chọn" },
    ],
  },
  "cinematic": {
    skill: "flow-cinematic-short-film", label: "Cinematic Short Film Studio", minutes: 50, hint: "Ảnh nhân vật/bối cảnh/đạo cụ + chủ đề, thông điệp, thời lượng 30/60/90s", toolUrl: null, uiMap: [],
    slots: [
      { role: "Nhân vật chính", label: "Nhân vật chính", hint: "Người / nhân vật xuất hiện xuyên suốt phim" },
      { role: "Sản phẩm / đạo cụ", label: "Sản phẩm / đạo cụ", hint: "Tuỳ chọn" },
      { role: "Bối cảnh", label: "Bối cảnh", hint: "Tuỳ chọn" },
    ],
  },
  // Local video AI (services/video-ai) — no Flow credits, no browser
  "auto-video": { engine: "moneyprinter", skill: "", label: "Video tự động · cảnh + giọng đọc", minutes: 4, hint: "Chủ đề hoặc kịch bản có sẵn → Claude CLI viết lời đọc, MoneyPrinterTurbo ghép cảnh (Pexels/Pixabay hoặc clip của Sếp / clip Flow), giọng Việt Edge TTS, phụ đề tự động", toolUrl: null, uiMap: [] },
  // Claude CLI + Remotion on this Mac (skill news-to-video): article link → voice, word timing, karaoke subtitles, motion graphics.
  "news-video": {
    engine: "news", skill: "news-to-video", label: "Video tin tức từ link bài báo", minutes: 15,
    hint: "Dán link bài báo (kèm ghi chú nếu cần: giọng nam/nữ, nhấn mạnh ý nào) → Claude CLI đọc bài, viết lời đọc, giọng Việt, phụ đề karaoke, đồ hoạ Remotion, chuẩn âm thanh -14 LUFS",
    toolUrl: null, uiMap: [],
  },
  // Claude CLI + ffmpeg + whisper on this Mac: the CEO's own raw footage → edited short video (no Flow credits).
  "edit-source": {
    engine: "edit", skill: "", label: "AI tự edit từ video gốc", minutes: 20,
    hint: "Tải video thô (cảnh quay, livestream, bài giảng, quay sản phẩm…) + ghi yêu cầu → AI xem và chọn đoạn đẹp nhất, dựng thành video hoàn chỉnh: cắt cảnh, chuyển cảnh, zoom in/out, chữ động, phụ đề từng từ, hiệu ứng âm thanh, nhạc nền. Có lời nói thì giữ nguyên lời; không có thì AI viết lời đọc",
    toolUrl: null, uiMap: [],
  },
  "portrait": {
    engine: "liveportrait", skill: "", label: "Ảnh chân dung cử động", minutes: 5, hint: "1 ảnh chân dung rõ mặt + video biểu cảm mẫu (có sẵn hoặc tải lên) → LivePortrait làm ảnh cử động; có thể lồng giọng đọc", toolUrl: null, uiMap: [],
    slots: [{ role: "Nhân vật", label: "Ảnh chân dung", hint: "Chính diện, rõ mặt, 1 người", required: true }],
  },
} as { [k: string]: { engine?: "flow" | "moneyprinter" | "liveportrait" | "news" | "edit"; /** Flow không có Tool: dùng trình tạo video thường trên trang dự án. */ generator?: boolean; /** Luồng làm thủ công theo kịch bản đã duyệt (flow-manual.ts), chỉ chạy bằng Claude in Chrome. */ manual?: boolean; skill: string; label: string; /** Name the Tool itself shows, when the card label differs. */ toolTitle?: string; /** Replaces the "use Veo model X" line when the skill fixes the model ("" = no line). */ modelNote?: string; minutes: number; hint: string; toolUrl: string | null; uiMap: string[]; slots?: { role: string; label: string; hint: string; required?: boolean }[] } };
export type FlowToolKey = typeof MANUAL_TOOL | "review-do-an-vat" | "review-thoi-trang" | "nguoi-que-so-sanh" | "nhan-hieu" | "koc-thoi-trang-nu" | "review-gia-dung" | "review-nha-hang" | "cooking-director" | "cinematic" | "auto-video" | "news-video" | "edit-source" | "portrait" | "nhan-hieu-dao-ly";
export const engineOf = (tool: string) => FLOW_TOOLS[tool]?.engine ?? "flow";

/** Model video trên Flow (tên hiển thị trong ô chọn model của Flow). Omni 1.1 Flash: rẻ, nhanh, clip 8–10 giây. */
export const VIDEO_MODELS = ["Veo 3.1 - Lite", "Veo 3.1 - Fast", "Veo 3.1 - Quality", "Omni 1.1 Flash"] as const;
export const CreativeInput = z.object({
  tool: z.enum(Object.keys(FLOW_TOOLS) as [FlowToolKey, ...FlowToolKey[]]),
  title: z.string().min(2).max(120),
  brief: z.string().min(5).max(6000), // product info / topic / script
  product: z.string().max(200).optional(),
  durationSec: z.number().int().min(15).max(120).optional(),
  voice: z.string().max(200).optional(),
  hookTitle: z.string().max(120).optional(),
  cta: z.string().max(160).optional(),
  images: z.array(z.object({ path: z.string(), role: z.string() })).max(8).default([]),
  channels: z.array(z.string()).min(1).default(["tiktok"]),
  brand: z.enum(["taki", "other"]).default("other"), // "taki" = the installing business's own brand (its DNA applies); "other" = affiliate/client channel, DNA NOT applied
  sourceContentId: z.string().optional(),
  /** Kịch bản đã duyệt (từ Nội dung → Tạo video): lời đọc + hình ảnh gợi ý + chữ màn hình từng cảnh, cho bộ dựng từ video thô. */
  script: z.object({
    scenes: z.array(z.object({ from: z.number(), to: z.number(), voice: z.string().max(600), visual: z.string().max(600).default(""), onScreen: z.string().max(120).default("") })).min(1).max(24),
  }).optional(),
  /** Veo model, used only if the Tool offers a model choice (the Tool otherwise decides). */
  veoModel: z.enum(VIDEO_MODELS).default("Veo 3.1 - Fast"),
  /** Làm thủ công trên Flow: phân cảnh Sếp tự chỉnh (lời mỗi cảnh, nguyên văn kịch bản đã duyệt); trống = chia tự động. */
  manualScenes: z.array(z.string().max(600)).max(24).optional(),
  /** Options for the local engines (auto-video / portrait). */
  video: z.object({
    source: z.enum(["pexels", "pixabay", "local", "flow"]).optional(), materials: z.array(z.string()).max(30).optional(), flowJobId: z.string().optional(),
    /** Dựng từ video thô: style = phong cách dựng; music "none" = không nhạc nền. */ style: z.enum(["dynamic", "smooth", "clean"]).optional(), music: z.enum(["auto", "none"]).optional(),
    scriptReady: z.boolean().optional(), terms: z.string().max(400).optional(), aspect: z.enum(["9:16", "16:9", "1:1"]).optional(), clipDuration: z.number().int().min(2).max(10).optional(),
    voiceName: z.string().max(60).optional(), voiceRate: z.number().min(0.6).max(1.6).optional(), bgm: z.enum(["random", "none"]).optional(),
    driving: z.string().max(60).optional(), drivingPath: z.string().optional(), voiceText: z.string().max(2000).optional(), seconds: z.number().int().min(3).max(20).optional(),
  }).optional(),
});
export type CreativeInput = z.infer<typeof CreativeInput>;

export const FlowResult = z.object({
  status: z.enum(["done", "blocked", "failed"]),
  finalPath: z.string(),
  durationSec: z.number(),
  scenes: z.number(),
  redoneScenes: z.array(z.object({ scene: z.number(), reason: z.string() })),
  script: z.array(z.object({ canh: z.number(), loi_thoai: z.string() })),
  caption: z.string(),
  notes: z.string(),
});

export const DATA_DIR = resolve(process.cwd(), "data");
/** Fixed, pre-trusted working folder for unattended Claude browser runs (job files live in per-job workdirs). */
const RUN_DIR = join(DATA_DIR, "creative");

/** macOS notification centre (the only interruption the CEO gets: when a video is finished or failed). */
export function notifyDesktop(title: string, message: string) {
  if (process.platform !== "darwin") return;
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 220);
  try { execFileSync("osascript", ["-e", `display notification "${esc(message)}" with title "TAKI Agentic AI" subtitle "${esc(title)}" sound name "Glass"`], { timeout: 5000 }); } catch { /* notifications are best-effort */ }
}
export const UPLOAD_DIR = join(DATA_DIR, "uploads");

// ---------------- Hệ thống tự ghép (không phụ thuộc agent) ----------------
const VIDEO_TOOLS = resolve(process.cwd(), "tools/video");
const FINISH_PY = join(VIDEO_TOOLS, "finish.py");
/** Python của tools/video/.venv (cùng đường dẫn với `py()` trong video-ai.ts: Scripts/python.exe trên Windows, bin/python nơi khác). */
const VENV_PY = join(VIDEO_TOOLS, ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
const execFileAsync = promisify(execFile);

/** Clip đã lưu trong <workdir>/clips (scene_01.mp4, scene_02.mp4… — sắp theo số thứ tự cảnh). */
export function savedClips(workdir: string): string[] {
  const dir = join(workdir, "clips");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.mp4$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => join(dir, f))
    .filter((p) => statSync(p).size > 0);
}

/**
 * Hệ thống TỰ GHÉP các clip đã có trong clips/ thành final.mp4 (chuẩn hoá 9:16 → nối → phụ đề + tiêu đề hook + CTA) bằng
 * tools/video/finish.py — dùng khi agent đã lấy được clip nhưng không tự ghép xong (lỗi, hết giờ, trả sai định dạng, mất phiên).
 * Chạy bất đồng bộ (ghép + soát lời mất vài phút) để không treo máy chủ. Lời thoại: theo kết quả agent, không có thì đọc
 * script.json agent đã ghi, không có nữa thì để trống (vẫn ghép được, chỉ thiếu phụ đề).
 */
export async function autoFinishVideo(workdir: string, opts: { script?: { canh: number; loi_thoai: string }[]; title?: string; cta?: string; /** Chỉ ghép đúng các clip này (mặc định: mọi clip trong clips/). */ clips?: string[] } = {}): Promise<{ path: string; clips: number } | null> {
  const clips = opts.clips ?? savedClips(workdir);
  if (!clips.length) return null;
  if (!existsSync(VENV_PY) || !existsSync(FINISH_PY)) throw new AppError("FINISH_MISSING", "Chưa cài công cụ hậu kỳ video (Python) — chạy lại: pnpm bootstrap");
  let script = opts.script?.length ? opts.script : [];
  const agentScript = join(workdir, "script.json");
  if (!script.length && existsSync(agentScript)) { try { script = JSON.parse(readFileSync(agentScript, "utf8")); } catch { script = []; } }
  const scriptPath = join(workdir, "script.auto.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const out = join(workdir, "final.mp4");
  await execFileAsync(VENV_PY, [FINISH_PY, "--clips", ...clips, "--script", scriptPath, "--out", out,
    ...(opts.title ? ["--title", opts.title] : []), ...(opts.cta ? ["--cta", opts.cta] : [])],
    // Windows: stdout mặc định là cp1252 — ép UTF-8 như các lệnh taki-video-* (ensureVideoBins).
    { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  return existsSync(out) && statSync(out).size > 0 ? { path: out, clips: clips.length } : null;
}

/** Lỗi khi tài khoản Google đang dùng không mở được Tool dùng chung. */
export const NO_TOOL_ACCESS_MSG = "Tài khoản Google chưa có quyền mở Tool này — nhờ người chia sẻ Tool hoặc dùng bản sao (dán link bản sao ở trang Sản xuất video)";
/** Đổi lý do dừng của agent Flow thành câu dễ hiểu cho Sếp (nhận ra lỗi không có quyền mở Tool). */
export function friendlyFlowError(notes: string): string {
  const t = notes ?? "";
  // Dấu NO_TOOL_ACCESS do agent ghi (theo hướng dẫn), hoặc chữ Flow/Google hiện khi tài khoản không được chia sẻ.
  if (/NO_TOOL_ACCESS|chưa có quyền (mở|truy cập)|không có quyền truy cập|yêu cầu quyền truy cập|request access|you need (permission|access)|(don'?t|do not) have (permission|access) to (this|the) tool/i.test(t)) return NO_TOOL_ACCESS_MSG;
  if (PLATFORM_RISK_RE.test(t)) return PLATFORM_RISK_MSG;
  return t;
}

/** Google Flow chặn bước TẠO VIDEO bằng hệ thống chống tự động hoá ("We noticed some unusual activity"). Không phải lỗi nội dung / hết lượt. */
export const PLATFORM_RISK_RE = /PLATFORM_RISK|unusual activity|browser extensions that modify the page|hoạt động bất thường/i;
export const PLATFORM_RISK_MSG = "Google Flow đang CHẶN bước tạo video tự động (báo \"unusual activity\" — hệ thống chống tự động hoá của Google, không phải lỗi prompt hay hết lượt). Ảnh storyboard đã tạo xong và còn trong dự án Flow. Cách tiếp tục: bấm \"Mở dự án Flow\", tự bấm tạo video cho từng cảnh (thao tác của người thật thì Flow cho qua), rồi bấm \"Tôi đã bấm tạo — tự chờ & ghép\": hệ thống tự tải clip, ghép, phụ đề rồi gửi vào hộp Duyệt";

/** Ảnh/clip đầu vào chỉ được nằm trong data/uploads (tải lên qua web) hoặc thư mục job video (data/creative/…):
 *  agent chạy trong Chrome có quyền tải tệp lên web, nên không cho trỏ tới tệp tùy ý trên máy. */
export function assertMediaInputPath(path: string): string {
  const roots = [UPLOAD_DIR, join(DATA_DIR, "creative")].map((r) => resolve(r));
  const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const abs = norm(real(resolve(path)));
  const ok = roots.some((r) => { const root = norm(existsSync(r) ? real(r) : r); return abs.startsWith(root.endsWith(sep) ? root : root + sep); });
  if (!ok) throw new AppError("PATH_NOT_ALLOWED", `Tệp ${basename(path)} nằm ngoài thư mục tải lên — hãy tải ảnh/clip lên qua trang Sản xuất video (data/uploads)`);
  return resolve(path);
}

export function flowSettings(bizId: string) {
  return {
    engine: "chrome-flow" as "chrome-flow" | "claude-in-chrome", chromeAutoApprove: false,
    browserDeviceId: null as string | null, browserLabel: null as string | null, timeoutMin: 75,
    // Chrome profile chosen by the CEO (the one logged into Flow). Preferred over a bare deviceId.
    chromeChannel: null as string | null, chromeProfileDir: null as string | null, chromeProfileName: null as string | null, chromeProfileEmail: null as string | null,
    /** Per-tool Flow Tool link override (defaults to the link in FLOW_TOOLS / the skill). */
    toolUrls: {} as Record<string, string>,
    ...((bizSettings(bizId) as any).flow ?? {}),
  };
}

export const toolUrlFor = (fs: ReturnType<typeof flowSettings>, key: string) => fs.toolUrls?.[key] || FLOW_TOOLS[key]?.toolUrl || null;
/** Link Tool Flow hợp lệ (Sếp dán link bản sao của Tool trong project của mình). */
export const FLOW_TOOL_URL_RE = /^https:\/\/(flow\.google\.com|labs\.google)\/\S*\/tool\/[\w-]+/;

/** How this machine runs the skill: Playwright tools on Chrome Flow, local folders, no human in the loop. */
export function environmentInstructions(o: { toolLabel: string; toolUrl: string | null; /** Link mặc định của Tool (FLOW_TOOLS) — khác toolUrl nghĩa là Sếp đang dùng bản sao (Remix) của mình. */ defaultToolUrl?: string | null; uiMap: string[]; email: string | null; workdir: string; rawDir: string; generator?: boolean }) {
  const isCopy = !!o.toolUrl && !!o.defaultToolUrl && o.toolUrl !== o.defaultToolUrl;
  return [
    "# MÔI TRƯỜNG CHẠY (máy Mac của doanh nghiệp, chạy tự động, KHÔNG có người theo dõi) — áp cho skill ở trên",
    `- Trình duyệt = các tool mcp__flow__browser_* (Playwright) đã gắn sẵn vào "Chrome Flow"${o.email ? `, đăng nhập Google ${o.email}` : ""}. Đây là thay thế cho Claude in Chrome trong skill: bỏ qua bước đọc skill chrome-browser / ToolSearch / tabs_context_mcp.`,
    "- Playwright nhìn thấy và thao tác được BÊN TRONG iframe của Tool. Cách làm chuẩn: browser_snapshot → lấy ref của nút/ô theo chữ → browser_click / browser_type / browser_select_option / browser_file_upload theo ref → snapshot lại để xác nhận.",
    "- TỐC ĐỘ (quan trọng — mỗi lượt gọi tool là 1 lượt AI đọc lại toàn bộ ngữ cảnh): CHỜ Flow tạo ảnh/khung/video thì dùng ĐÚNG 1 lệnh Bash `taki-flow-wait` (chờ tối đa 8 phút/lần, tự dừng khi xong hoặc khi trang báo lỗi/hết tín dụng), đặt timeout 600000 cho lệnh Bash: `taki-flow-wait --videos <N>` (đủ N video trên trang), `--images <N>`, `--text \"4 / 4\"`, `--gone \"Đang tạo\"`. Chưa xong (done:false) thì gọi lại. KHÔNG lặp browser_wait_for(time) + snapshot / take_screenshot / evaluate / find để theo dõi tiến độ.",
    "- Snapshot dài: chỉ đọc phần cần. browser_take_screenshot CHỈ khi cần NHÌN ảnh/khung hình để chấm (khung chủ, storyboard) — không chụp để xem tiến độ (mỗi ảnh làm ngữ cảnh phình to, các lượt sau chậm dần). Gộp nhiều thao tác chắc chắn vào ít lượt; không dùng TaskCreate/TaskUpdate/TodoWrite.",
    "- Dùng 1 tab duy nhất (browser_tabs: đóng tab thừa). Không tắt trình duyệt.",
    "- Giao diện Flow (ngoài Tool) có thể là tiếng Anh hoặc tiếng Việt tuỳ tài khoản: nhận nút theo nghĩa (vd \"Select media\" = hộp chọn nội dung nghe nhìn, \"Upload media\" = Tải lên, \"Open\" = Mở, \"Done\" = Xong, Images = Hình ảnh).",
    // 08/10: showroom bị "LỖI POLICY" 3 lần với kịch bản có "mẹ bỉm lau mặt cho con" — bỏ "test"/"siêu" không đủ; cùng ảnh + ô thông tin
    // không nhắc trẻ em thì tạo được. Ô thông tin sản phẩm là nguồn của ảnh + kịch bản trong Tool → giữ nó ngắn, chỉ người lớn.
    "- Ô thông tin / mô tả gửi vào Tool: viết NGẮN (tên, công dụng, giá, ưu đãi có trong brief), chỉ người lớn sử dụng. KHÔNG đưa vào: trẻ em/em bé/con nhỏ/mẹ bỉm/học sinh, "
      + "cơ thể/da/mặt/vệ sinh cá nhân, y tế/sức khoẻ/chữa/an toàn cho bé, so sánh/chê đối thủ, cam kết tuyệt đối — dù kịch bản có các cảnh đó (đổi thành người lớn dùng ở nhà/văn phòng).",
    "- Lỗi chính sách nội dung của Flow (policy / \"vi phạm chính sách\"): lần 1 → bỏ mọi yếu tố ở dòng trên + từ phóng đại (\"siêu\", \"test\", \"nhất\", \"100%\") rồi tạo lại; "
      + "vẫn lỗi → rút ô thông tin còn TỐI GIẢN đúng 1 câu \"<tên sản phẩm> — <công dụng chính cho người lớn>. Giá <giá>. <ưu đãi>.\" rồi tạo lại; vẫn lỗi → dừng, ghi result.json status \"blocked\", "
      + "ghi rõ bước + nguyên văn ô thông tin đã thử. Chưa tạo clip thì chưa tốn tín dụng clip — không thử quá 3 lần.",
    ...(o.generator ? [
      `- KHÔNG có Tool: làm trên trình tạo video thường của Flow. browser_navigate ${FLOW_URL} → tạo dự án mới (New project / Dự án mới) đặt tên theo tên video. KHÔNG mở mục Tools.`,
      ...(o.uiMap.length ? ["- Bản đồ giao diện (ưu tiên hơn mô tả trong skill nếu khác):", ...o.uiMap.map((l) => `  • ${l}`)] : []),
      "- Bước 1 kịch bản (KHÔNG có người chọn): brief đã có kịch bản → dùng NGUYÊN VĂN; chỉ có chủ đề → tự viết 3 kịch bản đúng công thức của skill, chọn bản mạnh nhất, ghi 2 bản còn lại vào notes.",
      "- Bước 2–3: chia cảnh + câu lệnh đúng mẫu của skill (giữ nguyên mẫu, chỉ thay lời thoại).",
      "- Chưa đăng nhập / hết tín dụng → dừng ngay, ghi result.json status \"blocked\" kèm lý do. KHÔNG đăng nhập hộ, KHÔNG nhập mật khẩu, KHÔNG đổi cài đặt tài khoản, KHÔNG xóa gì, KHÔNG mua thêm tín dụng.",
      "- KHÔNG có người để hỏi: bỏ qua AskUserQuestion / SendUserMessage / SendUserFile và mọi bước \"gửi cho người dùng chọn / chờ duyệt\"; thiếu thông tin thì tự giả định hợp lý và ghi vào notes.",
      "- Đây KHÔNG phải cloud: bỏ qua device_request_folder_access / device_stage_files / device_commit_files / /mnt/user-data.",
      `- LẤY CLIP (thay bước \"Tải về\" của skill — KHÔNG bấm Tải xuống): xong cảnh k thì bấm vào thẻ cảnh k để mở trình phát rồi chạy: taki-flow-save --one ${join(o.workdir, "clips")}/scene_0k.mp4 (k = 1, 2, 3… đúng THỨ TỰ LỜI THOẠI, không theo thứ tự trên lưới). Đóng trình phát, làm tiếp cảnh sau. Đủ file cho mọi cảnh mới hậu kỳ.`,
    ] : [
    o.toolUrl
        ? (isCopy
          // Link bản sao (Remix) của Sếp: có thể đã ĐỔI TÊN Tool — không đòi đúng tiêu đề gốc, không vào chế độ Edit.
          ? `- Mở THẲNG Tool: browser_navigate ${o.toolUrl} (KHÔNG thêm ?mode=EDIT — chế độ Edit mở trình soạn Tool). Đây là BẢN SAO (Remix) Tool "${o.toolLabel}" trong project của chính Sếp, có thể ĐÃ ĐỔI TÊN: tiêu đề khác "${o.toolLabel}" vẫn ĐÚNG Tool — nhận theo giao diện (bản đồ giao diện dưới đây), không coi là sai Tool. Đang ở chế độ Edit / thấy "Tool Builder" → bấm "Tool" (hoặc "Done") để về chế độ chạy. Công cụ đang ở bước cũ → bấm bước 1 trên thanh tiến trình để làm sản phẩm mới.`
          : `- Mở THẲNG Tool "${o.toolLabel}": browser_navigate ${o.toolUrl} — tiêu đề trên cùng phải là "${o.toolLabel}". Công cụ đang ở bước cũ → bấm bước 1 trên thanh tiến trình để làm sản phẩm mới.`)
        : `- Mở Tool "${o.toolLabel}" theo đúng skill (sidebar Tools / "Công cụ của tôi" / "Công cụ được chia sẻ với tôi").`,
      ...(o.toolUrl ? [`- KHÔNG MỞ ĐƯỢC TOOL vì quyền (trang báo "You need access" / "Request access" / "Bạn cần quyền truy cập" / "Yêu cầu quyền truy cập", không tìm thấy project/Tool, hoặc bị đẩy về trang chủ Flow): KHÔNG bấm "Request access", KHÔNG thử đường khác. Dừng ngay, ghi result.json status "blocked", notes bắt đầu bằng "NO_TOOL_ACCESS:" kèm chữ trang hiển thị.`] : []),
      `- BẮT BUỘC chạy hết các bước BÊN TRONG Tool "${o.toolLabel}" (không tự viết prompt Veo ngoài Tool, không dùng công cụ khác).`,
      ...(o.uiMap.length ? ["- Bản đồ giao diện Tool (đọc trực tiếp từ Tool, ưu tiên hơn mô tả trong skill nếu khác):", ...o.uiMap.map((l) => `  • ${l}`)] : []),
      "- Chưa đăng nhập / hết tín dụng / không mở được Tool → dừng ngay, ghi result.json status \"blocked\" kèm lý do. KHÔNG đăng nhập hộ, KHÔNG nhập mật khẩu, KHÔNG đổi cài đặt tài khoản, KHÔNG xóa gì, KHÔNG mua thêm tín dụng.",
      "- KHÔNG có người để hỏi: bỏ qua AskUserQuestion / SendUserMessage / SendUserFile và mọi bước \"chờ người dùng duyệt\"; thiếu thông tin thì tự giả định hợp lý theo mặc định trong skill và ghi vào notes.",
      "- Đây KHÔNG phải cloud: bỏ qua device_request_folder_access / device_stage_files / device_commit_files / /mnt/user-data.",
      `- LẤY CLIP: nút TẢI VỀ / TẢI TẤT CẢ CLIP trong Tool bị Chrome chặn (iframe sandbox không cho tải) — ĐỪNG bấm. Khi bước SẢN XUẤT đã có video ở MỌI cảnh, chạy: taki-flow-save --out ${join(o.workdir, "clips")} → lưu thẳng từ trang thành scene_01.mp4, scene_02.mp4… đúng thứ tự cảnh, in JSON số clip. Số clip phải bằng số cảnh; thiếu thì chờ cảnh đó xong / LÀM LẠI CLIP rồi chạy lại.`,
    ]),
    "- Kiểm tra clip bằng ffprobe; soát lời thoại bằng: taki-video-stt <file1> <file2>… (JSON ngôn ngữ + văn bản).",
    `- HẬU KỲ (thay mục 7.2–7.3 của skill): ffmpeg máy này KHÔNG có libass/drawtext nên KHÔNG dùng filter ass/subtitles/drawtext. Ghi lời thoại cuối vào ${join(o.workdir, "script.json")} dạng [{"canh":1,"loi_thoai":"..."}] rồi chạy:`,
    `  taki-video-finish --clips <scene_01.mp4 …> --script ${join(o.workdir, "script.json")} --title "<tiêu đề hook>" --cta "<CTA>" --out ${join(o.workdir, "final.mp4")}`,
    "  (ghép đúng thứ tự + phụ đề + hook + CTA, in JSON thời lượng/độ phân giải/âm thanh). Rồi trích 2–3 khung hình bằng ffmpeg -ss <t> -frames:v 1 và Read để xem chữ không che mặt/sản phẩm (mục 7.4).",
    `- Cảnh lỗi: làm lại ${o.generator ? "bằng \"Sử dụng lại câu lệnh\"" : "trong Tool"} tối đa 2 lần/cảnh (tốn tín dụng). CHỈ làm lại khi đã xác minh lỗi thật bằng taki-video-stt / xem khung hình trên đúng file clips/scene_NN.mp4 vừa lưu bằng taki-flow-save (không so với file nào khác). Không sửa kịch bản/vai trò/thời lượng chỉ để \"phá cache\".`,
    o.generator
      ? "- Không tự giải mã base64 / tự ghi file video từ trang: chỉ dùng taki-flow-save --one. Làm lại cảnh k xong thì mở thẻ bản MỚI của cảnh k và chạy lại taki-flow-save --one cho đúng file scene_0k.mp4."
      : "- Không tự giải mã base64 / tự ghi file video từ trang: chỉ dùng taki-flow-save. Sau khi làm lại 1 cảnh thì chạy lại taki-flow-save (ghi đè cả bộ theo thứ tự).",
  ];
}

// ---------------- Start ----------------
export function startVideoJob(bizId: string, raw: unknown, actor: string) {
  const input = CreativeInput.parse(raw);
  const engine = engineOf(input.tool);
  // Agent Flow tải ảnh lên web từ trình duyệt → ảnh phải nằm trong data/uploads | data/creative. Engine chạy tại máy (LivePortrait…)
  // không đưa ảnh ra ngoài nên vẫn nhận ảnh từ Agentic Brain như MCP "anh_cu_dong" mô tả.
  for (const img of input.images) {
    if (engine === "flow") img.path = assertMediaInputPath(img.path);
    if (!existsSync(img.path)) throw new AppError("NO_FILE", `Không thấy ảnh ${img.path}`);
  }
  const cfg = q.get<Row>("SELECT enabled FROM agent_config WHERE biz_id = ? AND agent_key = 'creative'", bizId);
  if (!cfg?.enabled) throw new AppError("AGENT_DISABLED", "Creative Agent đang tắt (Agent & Tác vụ)");
  if (input.video) {
    if (input.video.materials) input.video.materials = input.video.materials.map((p) => assertMediaInputPath(p));
    if (input.video.drivingPath) input.video.drivingPath = assertMediaInputPath(input.video.drivingPath);
  }
  for (const p of [...(input.video?.materials ?? []), input.video?.drivingPath].filter(Boolean) as string[]) if (!existsSync(p)) throw new AppError("NO_FILE", `Không thấy tệp ${p}`);
  if (engine === "liveportrait" && !input.images.length) throw new AppError("NO_IMAGE", "Cần 1 ảnh chân dung rõ mặt");
  if (engine === "news" && !/https?:\/\/\S+/.test(input.brief)) throw new AppError("NO_URL", "Cần dán link bài báo (http…) vào ô nội dung");
  if (engine === "edit" && !(input.video?.materials ?? []).some((m) => /\.(mp4|mov|m4v|webm|mkv|avi|mp3|m4a|wav)$/i.test(m))) throw new AppError("NO_MATERIALS", "Cần tải lên ít nhất 1 video gốc (mp4/mov/webm…)");
  if (engine === "flow") {
    const missing = (FLOW_TOOLS[input.tool].slots ?? []).filter((s) => s.required && !input.images.some((i) => i.role === s.role));
    if (missing.length) throw new AppError("NO_IMAGE", `Cần ảnh: ${missing.map((s) => s.label).join(", ")} (tải ở trang Sản xuất video)`);
  }
  if (FLOW_TOOLS[input.tool].manual) {
    // Lời thoại lấy từ kịch bản đã duyệt (không phải ô nội dung) → kiểm ngay lúc bấm, không đợi tới lượt chạy.
    scenesFor(approvedScript(bizId, input.sourceContentId).parsed, input.veoModel, input.manualScenes);
    if (!flowSettings(bizId).chromeProfileDir) throw new AppError("NO_BROWSER", MANUAL_NEEDS_CHROME);
  }
  const job = insert("creative_job", { biz_id: bizId, tool: input.tool, title: input.title, input, status: "queued", step: engine === "flow" ? "Chờ trình duyệt rảnh" : "Chờ máy rảnh", log: [], source_content_id: input.sourceContentId ?? null });
  const workdir = join(DATA_DIR, "creative", job.id);
  mkdirSync(join(workdir, "clips"), { recursive: true });
  update("creative_job", job.id, { workdir });
  // One job per resource at a time: Flow shares the CEO's Chrome + credits; local video AI shares 8 GB of RAM.
  if (engine === "flow") enqueue("media", "creative.flow", { jobId: job.id }, { bizId, idempotencyKey: `flow:${job.id}`, lockKey: "flow-chrome", maxAttempts: 1 });
  else enqueue("media", "creative.local", { jobId: job.id }, { bizId, idempotencyKey: `flow:${job.id}`, lockKey: "video-ai", maxAttempts: 1 });
  audit(bizId, actor, "creative.job_started", { type: "creative_job", id: job.id }, { tool: input.tool, title: input.title });
  emit(bizId, "creative.updated", { jobId: job.id, status: "queued" });
  return byId("creative_job", job.id);
}

// ---------------- Run (queue worker) ----------------
/** Persist the live agent log at most every 2s, with a trailing write so a burst of steps is never left unsaved. */
function logFlusher(bizId: string, jobId: string, log: Row[]) {
  let last = 0;
  let timer: NodeJS.Timeout | null = null;
  const write = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    last = Date.now();
    if (byId<Row>("creative_job", jobId)?.status !== "running") return;
    update("creative_job", jobId, { log: log.slice(-150), step: log.at(-1)?.text ?? null });
    emit(bizId, "creative.updated", { jobId, status: "running" });
  };
  return (force = false) => {
    if (force || Date.now() - last >= 2000) write();
    else timer ??= setTimeout(write, 2000 - (Date.now() - last));
  };
}

const running = new Map<string, AbortController>();
export function cancelVideoJob(bizId: string, jobId: string, actor: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
  running.get(jobId)?.abort();
  if (["queued", "running"].includes(job.status)) update("creative_job", jobId, { status: "cancelled", step: "Đã hủy", ended_at: nowIso() });
  q.run("UPDATE job SET status = 'dead', last_error = 'cancelled' WHERE idempotency_key = ? AND status = 'queued'", `flow:${jobId}`);
  audit(bizId, actor, "creative.job_cancelled", { type: "creative_job", id: jobId });
  emit(bizId, "creative.updated", { jobId, status: "cancelled" });
}

/** Local engines (MoneyPrinterTurbo / LivePortrait): same job life-cycle as Flow — log, cancel, notify, review & approval. */
export async function runLocalVideoJob(jobId: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.status !== "queued") return;
  const bizId = job.biz_id as string;
  const log: Row[] = [];
  const flush = logFlusher(bizId, jobId, log);
  const ctrl = new AbortController();
  running.set(jobId, ctrl);
  update("creative_job", jobId, { status: "running", started_at: nowIso(), step: "Khởi động" });
  emit(bizId, "creative.updated", { jobId, status: "running" });
  const say = (text: string, kind: "text" | "tool" = "text") => { log.push({ at: nowIso(), kind, text }); flush(); };
  try {
    if (engineOf(job.tool) === "edit") {
      const res = await runProEdit({ job, log: say, signal: ctrl.signal });
      flush(true);
      update("creative_job", jobId, { model: modelFor(bizId, "creative", "medium") });
      await completeVideoJob(jobId, res);
    } else if (engineOf(job.tool) === "news") {
      const res = await runNewsVideo({ job, log: say, signal: ctrl.signal });
      flush(true);
      update("creative_job", jobId, { model: modelFor(bizId, "creative", "medium") });
      await completeVideoJob(jobId, res);
    } else if (engineOf(job.tool) === "liveportrait") {
      const res = await runPortrait({ job, log: say, signal: ctrl.signal });
      flush(true);
      finishMaterialJob(jobId, res);
      notifyDesktop(`Ảnh cử động "${job.title}" đã xong`, `Clip ${Math.round(res.durationSec)} giây đã vào thư viện video.`);
    } else {
      const res = await runAutoVideo({ job, log: say, signal: ctrl.signal });
      flush(true);
      update("creative_job", jobId, { model: "moneyprinter+claude-cli" });
      await completeVideoJob(jobId, res);
    }
  } catch (e) {
    flush(true);
    if (byId<Row>("creative_job", jobId)?.status === "cancelled") return;
    const error = e instanceof Error ? e.message : String(e);
    update("creative_job", jobId, { status: /NO_STOCK_KEY|NOT_INSTALLED|NO_IMAGE|NO_MATERIALS|NO_CLIPS|NO_SKILL|NEED_CLI|NO_URL/.test((e as any)?.code ?? "") ? "blocked" : "failed", error, step: null, ended_at: nowIso() });
    emit(bizId, "creative.updated", { jobId, status: "failed" });
    notifyDesktop(`Video "${job.title}" chưa tạo được`, error);
  } finally {
    running.delete(jobId);
  }
}

/**
 * News-to-video (skill news-to-video, Remotion): headless Claude CLI on this Mac — no browser, no Flow credits.
 * The agent fetches the article, writes the voice-over, makes the voice (Edge TTS / Vbee), measures word timing with
 * whisper, builds karaoke captions + motion graphics in the shared Remotion project, renders and masters to -14 LUFS.
 */
async function runNewsVideo({ job, log, signal }: { job: Row; log: (text: string, kind?: "text" | "tool") => void; signal: AbortSignal }) {
  const bizId = job.biz_id as string;
  const input = job.input as CreativeInput;
  const tool = FLOW_TOOLS[input.tool];
  if (effectiveProvider(bizId).provider !== "claude_cli") throw new AppError("NEED_CLI", "Cần chế độ Tài khoản Claude (Claude Code CLI) để dựng video tin tức");
  if (!videoAiStatus().remotion.installed) throw new AppError("NOT_INSTALLED", "Remotion chưa cài (pnpm video-ai:install)");
  const skill = q.get<Row>("SELECT body, version FROM skill WHERE biz_id = ? AND key = ? AND status = 'active'", bizId, tool.skill);
  if (!skill) throw new AppError("NO_SKILL", `Chưa nạp skill ${tool.skill} (Skill & Nhân viên MKT → Đồng bộ lại)`);
  const workdir = job.workdir as string;
  const short = String(job.id).replace(/-/g, "").slice(-8);
  const slug = `news${short}`, comp = `News${short}`;
  const P = REMOTION_NEWS;
  const resultFile = join(workdir, "result.json");
  const system = [
    `# SKILL ĐANG CHẠY: ${tool.skill} (v${skill.version})`,
    skill.body,
    "",
    "# MÔI TRƯỜNG CHẠY (máy Mac của doanh nghiệp, chạy tự động, KHÔNG có người theo dõi) — áp cho skill ở trên, ưu tiên hơn phần 'YÊU CẦU MÔI TRƯỜNG' của skill",
    "- Mọi công cụ đã cài sẵn: KHÔNG pip install, KHÔNG npm install, KHÔNG npx create-video.",
    "- Lệnh Bash được phép chỉ là các lệnh nêu dưới đây (+ cd, ls, mkdir, cp, mv, file, grep, head, wc, cat). Gõ thẳng đường dẫn tuyệt đối trong ngoặc kép; KHÔNG gán biến shell (JOB=…), KHÔNG python3/node/heredoc — sẽ bị chặn. Tạo/sửa file bằng Write/Edit.",
    `- Thư mục làm việc của job: ${workdir} (bài viết, script, voice, words.json, ảnh kiểm tra, kết quả). Thư mục skill (script, template): ${NEWS_SKILL_DIR}.`,
    `- Bước 1 fetch: CHẠY taki-news-fetch "<URL>" ${workdir} --images-dir ${join(P, "public", slug)} → ${join(workdir, "article.json")} (title, site, paragraphs theo thứ tự, images[{file,caption,width,height}] đã tải + đổi webp→jpg, ogImage, colors = hex lặp nhiều trong CSS của site, textColor, logos, fonts). Read article.json rồi Read TỪNG ảnh trước khi gán vào cảnh (ảnh cuối "(ảnh bìa og:image)" là ảnh bìa). Thiếu đoạn văn / sai vùng bài → WebFetch URL ("liệt kê TOÀN BỘ đoạn văn theo thứ tự, không tóm tắt") hoặc Grep trong article.html. KHÔNG có python3/node để tự bóc HTML — dùng các lệnh này. Ảnh thêm (logo…) tải bằng curl -o.`,
    `- Bước 4 giọng: taki-tts --voice vi-VN-NamMinhNeural|vi-VN-HoaiMyNeural --rate=<RATE> --file ${join(workdir, "script.txt")} --write-media ${join(workdir, "voice.mp3")} (lệnh này = python3 -m edge_tts, đã tự thử lại 3 lần). Vbee chỉ khi \`taki-vbee-tts --check\` báo có cấu hình: taki-vbee-tts <script.txt> <voice.mp3> --voice <code> --speed <x>. KHÔNG đọc/hiển thị token Vbee.`,
    `- Bước 5: taki-news-transcribe ${join(workdir, "voice.mp3")} ${join(workdir, "words.json")}`,
    `- Bước 6: ghi danh sách câu [[start, end, "TEXT ĐÃ SỬA"], …] vào ${join(workdir, "sents.json")} rồi chạy: taki-news-chunks ${join(workdir, "sents.json")} ${slug}Chunks ${join(P, "src", slug, `${slug}Chunks.ts`)}`,
    `- Bước 7 Remotion: project DÙNG CHUNG đã có sẵn tại ${P} (React 19, @remotion/media, @remotion/google-fonts). Copy voice.mp3 vào ${join(P, "public", slug, "voice.mp3")} và dùng staticFile("${slug}/voice.mp3"), ảnh = staticFile("${slug}/<tên>"). Code của video này CHỈ nằm trong ${join(P, "src", slug)}/ (Chunks.ts, Graphics.tsx, Main.tsx, Captions.tsx chép từ template). Đăng ký thêm đúng 1 <Composition id="${comp}" …/> (1080x1920, 30fps) trong ${join(P, "src", "Root.tsx")} — GIỮ NGUYÊN các composition đã có. Không sửa file nào khác của project.`,
    `- Kiểm tra: cd "${P}" && npx tsc --noEmit ; cd "${P}" && npx remotion still ${comp} --scale=0.3 --frame=<N> ${join(workdir, "check_<N>.png")} (4–5 khung, Read từng ảnh).`,
    `- Bước 8: cd "${P}" && npx remotion render ${comp} ${join(workdir, "render.mp4")} --codec=h264 ; đo + master loudness bằng ffmpeg như skill → file cuối ${join(workdir, "final.mp4")}. Trích 3–5 khung từ final.mp4 bằng ffmpeg -ss <t> -frames:v 1 rồi Read để QC.`,
    "- KHÔNG có người để hỏi: bỏ qua AskUserQuestion; thiếu thông tin thì tự quyết theo skill và ghi vào notes. Link không mở được / bài bị chặn / không đủ nội dung → ghi result.json status \"blocked\" kèm lý do.",
    "- Nguồn bài và ảnh phải ghi đúng (chip ảnh + credit cuối video), không bịa số liệu — như quy tắc bất biến của skill.",
    `- KẾT THÚC: dùng Write ghi ${resultFile} đúng schema: ${JSON.stringify(Object.fromEntries(Object.entries(z.toJSONSchema(FlowResult, { target: "draft-7" }) as Row).filter(([k]) => k !== "$schema")))}`,
    `  finalPath = ${join(workdir, "final.mp4")}; scenes = số cảnh; script = lời đọc theo từng câu/cảnh [{canh, loi_thoai}]; caption = caption đăng kênh (≤ 300 ký tự, có "Nguồn: <tên báo>", 3–5 hashtag); notes = tên báo, hệ phong cách đã chọn, giọng, thời lượng, LUFS đo được. Lỗi giữa chừng cũng PHẢI ghi result.json với status "failed"/"blocked".`,
  ].join("\n");
  const prompt = [
    `Video tin tức: ${input.title}`,
    `Link + ghi chú:\n${input.brief}`,
    input.durationSec ? `Thời lượng mong muốn: khoảng ${input.durationSec} giây (skill: 50–95 giây).` : "",
    input.voice ? `Giọng: ${input.voice}` : "",
    input.hookTitle ? `Gợi ý câu hook: ${input.hookTitle}` : "",
    input.cta ? `Câu kết / CTA: ${input.cta}` : "",
    `Kênh sẽ đăng: ${input.channels.join(", ")} (dọc 9:16).`,
    `Chạy đủ 8 bước của skill news-to-video đến khi có ${join(workdir, "final.mp4")} đã master âm thanh, rồi ghi result.json.`,
  ].filter(Boolean).join("\n\n");
  log(`Claude CLI dựng video tin tức (Remotion, composition ${comp})`);
  const structured = await runClaudeInTerminal({
    title: `Video tin tức: ${job.title}`, prompt, system, model: modelFor(bizId, "creative", "medium"), cwd: RUN_DIR, signal, resultFile,
    timeoutMs: 45 * 60_000,
    mcpConfig: { mcpServers: {} }, // headless `claude -p`, no browser tools
    env: { PATH: `${ensureVideoBins()}${delimiter}${process.env.PATH ?? ""}` },
    allowedTools: [
      "Read", "Write", "Edit", "Glob", "Grep", "WebFetch",
      "Bash(taki-news-fetch:*)", "Bash(curl:*)", "Bash(ffmpeg:*)", "Bash(ffprobe:*)", "Bash(taki-tts:*)", "Bash(taki-vbee-tts:*)", "Bash(taki-news-transcribe:*)", "Bash(taki-news-chunks:*)",
      "Bash(grep:*)", "Bash(head:*)", "Bash(wc:*)", "Bash(cat:*)",
      "Bash(npx tsc:*)", "Bash(npx remotion:*)", "Bash(cd:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(file:*)",
    ],
    addDirs: [workdir, P, NEWS_SKILL_DIR],
    onStep: (st) => log(st.text, st.kind),
  });
  const out = FlowResult.safeParse(structured);
  if (!out.success) throw new AppError("BAD_RESULT", "Agent không trả kết quả đúng định dạng");
  return out.data;
}

export async function runVideoJob(jobId: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.status !== "queued") return;
  const bizId = job.biz_id as string;
  const input = job.input as CreativeInput;
  const tool = FLOW_TOOLS[input.tool];
  if (tool.manual) return runManualFlowJob(jobId);
  const fs = flowSettings(bizId);
  const fail = (status: "failed" | "blocked", error: string) => failJob(job, status, error);
  if (effectiveProvider(bizId).provider !== "claude_cli") return fail("blocked", "Cần chế độ Tài khoản Claude (Claude Code CLI) để chạy agent Flow");
  if (!fs.chromeProfileDir) return fail("blocked", "Chưa chọn profile Chrome có tài khoản Flow (Sản xuất video Flow → Chọn profile Chrome)");
  // Chrome Flow: dedicated Chrome parked at the screen edge, holding the chosen profile's Google login; checked before spending anything.
  const useChrome = flowEngine(bizId) === "claude-in-chrome";
  update("creative_job", jobId, { step: useChrome ? "Kiểm tra Chrome đã chọn" : "Mở Chrome Flow (chạy ngầm)" });
  let email: string | null = null;
  let chrome: Awaited<ReturnType<typeof claudeChromePreflight>> | null = null;
  try {
    if (useChrome) {
      chrome = await claudeChromePreflight(bizId);
      email = fs.chromeProfileEmail;
    } else email = await chromeFlowAccount(fs);
  } catch (e) {
    return fail("blocked", useChrome ? friendlyChromeNote(e instanceof Error ? e.message : String(e)) : chromeFlowError(e));
  }
  const skill = q.get<Row>("SELECT body, version FROM skill WHERE biz_id = ? AND key = ? AND status = 'active'", bizId, tool.skill);
  if (!skill) return fail("blocked", `Chưa nạp skill ${tool.skill} (Skill & Nhân viên MKT → Đồng bộ lại)`);

  const workdir = job.workdir as string;
  const rawDir = join(workdir, "raw");
  mkdirSync(rawDir, { recursive: true });
  const log: Row[] = [];
  const flush = logFlusher(bizId, jobId, log);
  update("creative_job", jobId, { status: "running", started_at: nowIso(), step: `Khởi động agent Flow (${email})` });
  emit(bizId, "creative.updated", { jobId, status: "running" });

  const dna = input.brand === "taki" ? agentPlaybook(bizId, "content").text.split("<persona")[0] : "";
  const system = [
    `# SKILL ĐANG CHẠY: ${tool.skill} (v${skill.version})`,
    skill.body,
    "",
    ...(chrome ? claudeChromeEnvironment({ toolLabel: tool.toolTitle ?? tool.label, toolUrl: toolUrlFor(fs, input.tool), defaultToolUrl: tool.toolUrl, uiMap: tool.uiMap, email, workdir, generator: tool.generator, deviceId: chrome.deviceId, label: chrome.label }) : environmentInstructions({ toolLabel: tool.toolTitle ?? tool.label, toolUrl: toolUrlFor(fs, input.tool), defaultToolUrl: tool.toolUrl, uiMap: tool.uiMap, email, workdir, rawDir, generator: tool.generator })),
    `- KẾT THÚC: dùng Write ghi kết quả JSON vào ${join(workdir, "result.json")} đúng schema sau rồi in "XONG — có thể đóng cửa sổ". Schema: ${JSON.stringify(Object.fromEntries(Object.entries(z.toJSONSchema(FlowResult, { target: "draft-7" }) as Row).filter(([k]) => k !== "$schema")))}`,
    `- Bị chặn/lỗi giữa chừng cũng PHẢI ghi result.json với status "blocked"/"failed" và lý do trong notes. finalPath = ${join(workdir, "final.mp4")} khi thành công. caption = caption đăng kênh (tiếng Việt, ≤ 300 ký tự, 3-5 hashtag). script = lời thoại từng cảnh.`,
    ...(dna ? ["", `# THƯƠNG HIỆU: ${brandOfDna(bizId)} (áp dụng DNA dưới đây cho lời thoại, caption, claim)`, dna] : ["", `# THƯƠNG HIỆU: kênh khác/khách hàng. KHÔNG dùng giọng hay tên ${brandOfDna(bizId)}; theo thông tin trong brief.`]),
  ].join("\n");
  const prompt = [
    `Công cụ Flow: ${tool.label}`,
    `Tên video: ${input.title}`,
    input.product ? `Sản phẩm: ${input.product}` : "",
    `Thông tin / chủ đề / kịch bản:\n${input.brief}`,
    input.durationSec ? `Thời lượng mong muốn: ${input.durationSec}s` : "",
    input.voice ? `Giọng: ${input.voice}` : "",
    input.hookTitle ? `Tiêu đề hook trên video: ${input.hookTitle}` : "",
    input.cta ? `CTA trên video: ${input.cta}` : "",
    input.images.length
      ? `ẢNH CỦA SẾP (ưu tiên dùng — KHÔNG tự tạo ảnh thay cho vai trò đã có; tải lên ${tool.generator ? "Flow (Tải nội dung lên) rồi \"Thêm vào câu lệnh\" cho mọi cảnh" : "đúng ô của Tool"} bằng browser_file_upload):\n${input.images.map((i) => `- ${i.role}: ${i.path}`).join("\n")}${input.images.some((i) => /nhân vật|người/i.test(i.role)) ? "\nNgười trong ảnh nhân vật là NHÂN VẬT CHÍNH: giữ đúng khuôn mặt/trang phục này ở mọi cảnh." : ""}`
      : "Không có ảnh đầu vào (ảnh bắt buộc của Tool thì tự tạo trên Flow như hướng dẫn).",
    tool.modelNote ?? `Nếu Tool có chọn model Veo: ${input.veoModel}.`,
    `Kênh sẽ đăng: ${input.channels.join(", ")} (dọc 9:16).`,
    tool.generator
      ? `Hãy chạy toàn bộ skill "${tool.label}" trên trình tạo video thường của Flow (không có Tool) đến khi có final.mp4 đã ghép + chèn chữ, rồi ghi result.json.`
      : `Hãy chạy toàn bộ skill trong Tool "${tool.label}" đến khi có final.mp4 đã ghép + chèn chữ, rồi ghi result.json.`,
  ].filter(Boolean).join("\n\n");

  const ctrl = new AbortController();
  running.set(jobId, ctrl);
  const model = modelFor(bizId, "creative", "medium");
  let structured: unknown;
  const t0 = Date.now();
  try {
    structured = await runClaudeInTerminal({
      title: `Video Flow: ${job.title}`, prompt, system, model, cwd: RUN_DIR, signal: ctrl.signal,
      resultFile: join(workdir, "result.json"),
      timeoutMs: (fs.timeoutMin ?? tool.minutes + 30) * 60_000,
      mcpConfig: useChrome ? { mcpServers: {} } : flowMcpConfig(rawDir),
      ...(useChrome ? { chrome: true, approver: { deviceId: chrome!.deviceId, fileRoots: [workdir, UPLOAD_DIR], hosts: ["flow.google.com", "labs.google", "accounts.google.com"], logFile: join(workdir, "approver.jsonl"), js: true, killFile: join(DATA_DIR, "chrome-autoapprove.off") } } : {}),
      // taki-video-* of THIS repo; Bash được chờ tới 10 phút cho taki-flow-wait (mặc định Claude Code cắt ở 2 phút).
      env: { PATH: `${ensureVideoBins()}${delimiter}${process.env.PATH ?? ""}`, BASH_DEFAULT_TIMEOUT_MS: "600000", BASH_MAX_TIMEOUT_MS: "600000" },
      disallowedTools: ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoWrite"],
      allowedTools: [
        ...(useChrome ? ["mcp__claude-in-chrome", ...[workdir, UPLOAD_DIR].map((p) => `Read(${permissionPath(p)}/**)`), `Write(${permissionPath(workdir)}/**)`, `Glob(${permissionPath(workdir)}/**)`] : ["mcp__flow", "Read", "Write", "Glob"]),
        "Bash(ffmpeg:*)", "Bash(ffprobe:*)", "Bash(taki-video-finish:*)", "Bash(taki-video-stt:*)",
        ...(!useChrome ? ["Bash(taki-flow-save:*)", "Bash(taki-flow-wait:*)"] : []), "Bash(taki-tts:*)", "Bash(cp:*)", "Bash(mv:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(unzip:*)", "Bash(stat:*)",
      ],
      addDirs: [workdir, UPLOAD_DIR],
      onStep: (s) => { log.push(s); flush(); },
    });
  } catch (e) {
    running.delete(jobId);
    flush(true);
    if (byId<Row>("creative_job", jobId)?.status === "cancelled") return;
    const friendly = friendlyFlowError(e instanceof Error ? e.message : String(e));
    // Agent dừng (hết giờ, rớt kết nối…) nhưng đã lưu clip → hệ thống tự ghép thay vì bỏ hết công sức + tín dụng Flow.
    if (canSalvage(input, workdir)) return completeVideoJob(jobId, salvageResult(input, `Agent dừng giữa chừng: ${friendly}`));
    return fail(friendly === NO_TOOL_ACCESS_MSG ? "blocked" : "failed", friendly);
  }
  running.delete(jobId);
  flush(true);
  insert("model_usage", { biz_id: bizId, agent_key: "creative", provider: "claude_cli", model, tokens_in: 0, tokens_out: 0, tokens_cached: 0, cost_micros: 0, latency_ms: Date.now() - t0, at: nowIso() });
  const r = { structured, model, costMicros: 0 };

  const out = FlowResult.safeParse(r.structured);
  if (!out.success) {
    if (canSalvage(input, workdir)) return completeVideoJob(jobId, salvageResult(input, "Agent không trả kết quả đúng định dạng"));
    return fail("failed", "Agent không trả kết quả đúng định dạng");
  }
  update("creative_job", jobId, { model: r.model, cost_micros: r.costMicros });
  await completeVideoJob(jobId, out.data);
}

/**
 * Chrome Flow (Chrome riêng, Playwright) sẵn sàng + đăng nhập Google → email tài khoản Flow. Chưa đăng nhập thì mở cửa sổ
 * đăng nhập và ném FLOW_NOT_LOGGED_IN (Sếp đăng nhập 1 lần rồi chạy lại).
 */
export async function chromeFlowAccount(fs: ReturnType<typeof flowSettings>): Promise<string> {
  const src = flowSource();
  if (src && (src.channel !== fs.chromeChannel || src.dir !== fs.chromeProfileDir)) await syncFlowProfile(fs.chromeChannel!, fs.chromeProfileDir!);
  await ensureFlowBrowser({ channel: fs.chromeChannel, dir: fs.chromeProfileDir });
  let accounts = await flowAccounts();
  // Login lost (cookies rotated) → re-copy once from the everyday profile, which stays logged in.
  // (Windows: chép không mang được đăng nhập và syncFlowProfile giữ nguyên Chrome Flow đã đăng nhập tay — xem copyCarriesLogin.)
  if (!accounts.length || (fs.chromeProfileEmail && !accounts.includes(fs.chromeProfileEmail))) {
    await syncFlowProfile(fs.chromeChannel!, fs.chromeProfileDir!);
    await ensureFlowBrowser({});
    accounts = await flowAccounts();
  }
  if (!accounts.length) {
    await openFlowLogin({}).catch(() => {});
    throw new AppError("FLOW_NOT_LOGGED_IN", "Chrome Flow chưa đăng nhập Google. Cửa sổ Chrome Flow đã mở — Sếp đăng nhập tài khoản có Flow 1 lần rồi chạy lại (Chrome trên Windows không cho chép đăng nhập từ Chrome thường; đăng nhập 1 lần ở cửa sổ này là được lưu lại, các lần sau không hỏi nữa).");
  }
  return fs.chromeProfileEmail && accounts.includes(fs.chromeProfileEmail) ? fs.chromeProfileEmail : accounts[0]!;
}
const chromeFlowError = (e: unknown) => (e instanceof AppError && e.code === "FLOW_NOT_LOGGED_IN" ? e.message : `Không mở được Chrome Flow: ${e instanceof Error ? e.message : e}`);

function failJob(job: Row, status: "failed" | "blocked", error: string, result?: unknown) {
  update("creative_job", job.id, { status, error, step: null, ended_at: nowIso(), ...(result ? { result } : {}) });
  emit(job.biz_id, "creative.updated", { jobId: job.id, status });
  emit(job.biz_id, "alert.raised", { level: "warning", text: `Video "${job.title}": ${error}` });
  notifyDesktop(`Video "${job.title}" chưa tạo được`, error);
}

export const MANUAL_NEEDS_CHROME = "Chưa chọn profile Chrome có tài khoản Flow — vào Sản xuất video › Trình duyệt & tài khoản AI › Chọn profile Chrome";
const sceneClip = (workdir: string, n: number) => join(workdir, "clips", `scene_${String(n).padStart(2, "0")}.mp4`);

/**
 * "Làm thủ công trên Flow · Veo 3" (flow-manual.ts): kiểm Chrome → Claude lập concept + prompt từng cảnh (plan.json, chưa tốn
 * tín dụng Flow) → agent Claude in Chrome tạo ảnh storyboard + video từng cảnh trong một dự án Flow mới và tải clip về → hệ thống
 * tự ghép (finishManualFlowJob). Job giữ "queued" tới khi agent trình duyệt khởi động: máy chủ khởi động lại lúc đang lập kế hoạch
 * thì hàng đợi chạy lại từ đầu, plan.json đã có thì dùng lại (không gọi AI lần nữa).
 */
async function runManualFlowJob(jobId: string) {
  const job = byId<Row>("creative_job", jobId)!;
  dropPendingRiskRetries(jobId);
  const bizId = job.biz_id as string;
  const input = job.input as CreativeInput;
  const fs = flowSettings(bizId);
  const workdir = job.workdir as string;
  const fail = (status: "failed" | "blocked", error: string) => failJob(job, status, error);
  const cancelled = () => byId<Row>("creative_job", jobId)?.status === "cancelled";
  const step = (text: string) => { update("creative_job", jobId, { step: text }); emit(bizId, "creative.updated", { jobId, status: "queued" }); };
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  if (effectiveProvider(bizId).provider !== "claude_cli") return fail("blocked", "Cần chế độ Tài khoản Claude (Claude Code CLI) để chạy agent Flow");
  if (!fs.chromeProfileDir) return fail("blocked", MANUAL_NEEDS_CHROME);
  const face = input.images.find((i) => i.role === MANUAL_FACE_ROLE);
  if (!face || !existsSync(face.path)) return fail("blocked", "Thiếu ảnh nhân vật tham chiếu (khuôn mặt) — tải ảnh ở trang Sản xuất video");
  let script: ReturnType<typeof approvedScript>;
  try { script = approvedScript(bizId, input.sourceContentId); } catch (e) { return fail("blocked", msg(e)); }

  // Cùng trình duyệt với luồng làm bằng Tool: Claude in Chrome nếu đã bật, không thì Chrome Flow (Chrome riêng, chạy ngầm).
  const useChrome = flowEngine(bizId) === "claude-in-chrome";
  step(useChrome ? "Kiểm tra Chrome đã chọn" : "Mở Chrome Flow (chạy ngầm)");
  let chrome: Awaited<ReturnType<typeof claudeChromePreflight>> | null = null;
  let email: string | null = fs.chromeProfileEmail;
  try {
    if (useChrome) chrome = await claudeChromePreflight(bizId);
    else email = await chromeFlowAccount(fs);
  } catch (e) { return fail("blocked", useChrome ? friendlyChromeNote(msg(e)) : chromeFlowError(e)); }
  if (cancelled()) return;

  let plan: ManualPlan | null = readManualPlan(workdir);
  if (!plan) {
    step("Claude đang nghĩ concept và chia cảnh theo kịch bản (chưa tốn tín dụng Flow)");
    try {
      plan = await planManualVideo({ bizId, title: input.title, parsed: script.parsed, facePath: face.path, veoModel: input.veoModel, brand: input.brand, voiceHint: input.voice, product: input.product, customScenes: input.manualScenes });
    } catch (e) {
      if (cancelled()) return;
      return fail("failed", `Chưa lập được kế hoạch phân cảnh: ${msg(e)}`);
    }
    if (cancelled()) return;
    writeFileSync(planFile(workdir), JSON.stringify(plan, null, 2));
    audit(bizId, "creative_agent", "creative.manual_planned", { type: "creative_job", id: jobId }, { scenes: plan.scenes.length, concept: plan.concept.name });
  }
  const n = plan.scenes.length;
  const log: Row[] = [{ at: nowIso(), kind: "text", text: `Concept "${plan.concept.name}" · ${n} cảnh · ${plan.durationSec} giây — ${plan.concept.why}`.slice(0, 300) }];
  const flush = logFlusher(bizId, jobId, log);
  update("creative_job", jobId, { status: "running", started_at: nowIso(), step: `Mở dự án Flow mới bằng ${useChrome ? "Claude in Chrome" : "Chrome Flow"} (${n} cảnh)`, log });
  emit(bizId, "creative.updated", { jobId, status: "running" });
  const rawDir = join(workdir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const system = [
    ...manualFlowEnvironment({ plan, workdir, email, careful: PLATFORM_RISK_RE.test(String((job.result as Row | null)?.notes ?? "")), ...(chrome ? { engine: "claude-in-chrome" as const, deviceId: chrome.deviceId, label: chrome.label } : { engine: "chrome-flow" as const }) }),
    `- KẾT THÚC: dùng Write ghi ${join(workdir, "result.json")} đúng schema: ${JSON.stringify(Object.fromEntries(Object.entries(z.toJSONSchema(FlowResult, { target: "draft-7" }) as Row).filter(([k]) => k !== "$schema")))}`,
    `- status "done" khi đủ ${n} clip scene_01…scene_${String(n).padStart(2, "0")}.mp4 trong ${join(workdir, "clips")}; finalPath = "" (hệ thống tự ghép); scenes = ${n}; script = lời từng cảnh theo plan.json [{"canh":1,"loi_thoai":"..."}]; caption = caption trong plan.json; redoneScenes = cảnh đã tạo lại + lý do; notes = projectUrl + chế độ/model đã dùng + điều đã chỉnh. Bị chặn/lỗi giữa chừng cũng PHẢI ghi result.json với status "blocked"/"failed" và lý do.`,
  ].join("\n");
  const prompt = [
    `Video: ${input.title}`,
    `Concept đã chọn: ${plan.concept.name} — ${plan.concept.why}`,
    `Làm đủ ${n} cảnh theo ${planFile(workdir)}: dự án Flow mới → tải ảnh khuôn mặt → ảnh storyboard từng cảnh → video Veo từng cảnh từ ảnh đó → tải clip về ${join(workdir, "clips")} → ghi result.json.`,
  ].join("\n\n");

  try { rmSync(join(workdir, "result.json"), { force: true }); } catch { /* chưa có */ } // kết quả của lượt trước (bị chặn) không được đọc nhầm là của lượt này
  const ctrl = new AbortController();
  running.set(jobId, ctrl);
  const model = modelFor(bizId, "creative", "medium");
  const t0 = Date.now();
  let structured: unknown;
  try {
    structured = await runClaudeInTerminal({
      title: `Video Flow thủ công: ${job.title}`, prompt, system, model, cwd: RUN_DIR, signal: ctrl.signal,
      resultFile: join(workdir, "result.json"),
      timeoutMs: Math.max(fs.timeoutMin ?? 0, manualTimeoutMin(n)) * 60_000,
      ...(chrome
        ? { mcpConfig: { mcpServers: {} }, chrome: true, approver: { deviceId: chrome.deviceId, fileRoots: [workdir, UPLOAD_DIR], hosts: ["flow.google.com", "labs.google", "accounts.google.com"], logFile: join(workdir, "approver.jsonl"), js: true, killFile: join(DATA_DIR, "chrome-autoapprove.off") } }
        : { mcpConfig: flowMcpConfig(rawDir) }),
      env: { PATH: `${ensureVideoBins()}${delimiter}${process.env.PATH ?? ""}`, BASH_DEFAULT_TIMEOUT_MS: "600000", BASH_MAX_TIMEOUT_MS: "600000" },
      disallowedTools: ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoWrite"],
      allowedTools: [
        ...(chrome
          ? ["mcp__claude-in-chrome", ...[workdir, UPLOAD_DIR].map((p) => `Read(${permissionPath(p)}/**)`), `Write(${permissionPath(workdir)}/**)`, `Glob(${permissionPath(workdir)}/**)`]
          : ["mcp__flow", "Read", "Write", "Glob", "Bash(taki-flow-collect:*)", "Bash(taki-flow-wait:*)"]),
        "Bash(ffprobe:*)", "Bash(taki-video-stt:*)", "Bash(cp:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(stat:*)",
      ],
      addDirs: [workdir, UPLOAD_DIR],
      onStep: (s) => { log.push(s); flush(); },
    });
  } catch (e) {
    running.delete(jobId);
    flush(true);
    if (cancelled()) return;
    return finishManualFlowJob(jobId, salvageResult(input, `Agent dừng giữa chừng: ${friendlyFlowError(msg(e))}`));
  }
  running.delete(jobId);
  flush(true);
  insert("model_usage", { biz_id: bizId, agent_key: "creative", provider: "claude_cli", model, tokens_in: 0, tokens_out: 0, tokens_cached: 0, cost_micros: 0, latency_ms: Date.now() - t0, at: nowIso() });
  update("creative_job", jobId, { model });
  const out = FlowResult.safeParse(structured);
  return finishManualFlowJob(jobId, out.success ? out.data : salvageResult(input, "Agent không trả kết quả đúng định dạng"));
}

/**
 * Nửa sau của luồng thủ công: CHỈ ghép khi đủ clip của MỌI cảnh (thiếu cảnh là thiếu lời của kịch bản đã duyệt → không ghép
 * video hụt), bằng công cụ edit của hệ thống (tools/video/finish.py: chuẩn 9:16, nối, phụ đề khớp giọng, hook, CTA), rồi
 * Review → hộp Duyệt như mọi video khác (completeVideoJob).
 */
export async function finishManualFlowJob(jobId: string, res: z.infer<typeof FlowResult>) {
  const job = byId<Row>("creative_job", jobId)!;
  const input = job.input as CreativeInput;
  const workdir = job.workdir as string;
  const plan = readManualPlan(workdir);
  if (!plan) return failJob(job, "failed", "Không thấy kế hoạch phân cảnh (plan.json) của video này", res);
  const n = plan.scenes.length;
  const clips = plan.scenes.map((s) => sceneClip(workdir, s.n));
  const missingNow = () => plan.scenes.filter((s, i) => !existsSync(clips[i]) || statSync(clips[i]).size === 0).map((s) => s.n);
  let missing = missingNow();
  const script = plan.scenes.map((s) => ({ canh: s.n, loi_thoai: s.voice }));
  // Agent dừng / không lưu được clip nhưng video đã nằm trong dự án Flow → HỆ THỐNG tự tải (taki-flow-collect), không cần AI.
  const projectUrl = manualProjectUrl(workdir, res.notes);
  if (missing.length && projectUrl && flowEngine(job.biz_id) === "chrome-flow") {
    update("creative_job", jobId, { step: `Hệ thống đang tự tải ${missing.length} clip từ dự án Flow` });
    emit(job.biz_id, "creative.updated", { jobId, status: "running" });
    try {
      await chromeFlowAccount(flowSettings(job.biz_id));
      await execFileAsync(process.execPath, [FLOW_COLLECT, "--project", projectUrl, "--plan", planFile(workdir), "--out", join(workdir, "clips"), "--only", missing.join(",")],
        { timeout: 20 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }).catch((e) => logger.warn("creative.manual_collect_partial", { jobId, error: String(e?.stdout ?? e).slice(0, 400) }));
    } catch (e) {
      logger.warn("creative.manual_collect_failed", { jobId, error: e instanceof Error ? e.message : String(e) });
    }
    missing = missingNow();
    if (!missing.length) audit(job.biz_id, "creative_agent", "creative.manual_collected", { type: "creative_job", id: jobId }, { clips: n, projectUrl });
  }
  // Flow chặn tạo video tự động: KHÔNG dồn dập thử lại — nghỉ rồi tự thử lại nhẹ nhàng (từng cảnh một), vài lần; hết lần mới nhờ Sếp bấm tay.
  if (missing.length && res.status !== "done" && PLATFORM_RISK_RE.test(res.notes ?? "") && scheduleRiskRetry(job, res, n - missing.length, n)) return;
  if (missing.length) {
    const why = res.status !== "done" && res.notes ? friendlyFlowError(res.notes) : `Agent báo xong nhưng mới có ${n - missing.length}/${n} clip`;
    return failJob(job, res.status === "blocked" || why === NO_TOOL_ACCESS_MSG ? "blocked" : "failed",
      `${why} — thiếu clip cảnh ${missing.join(", ")} (cảnh đã tạo vẫn nằm trong dự án Flow; chưa ghép video thiếu lời)`, { ...res, script });
  }
  update("creative_job", jobId, { step: `Hệ thống đang ghép ${n} clip + phụ đề + hook + CTA` });
  emit(job.biz_id, "creative.updated", { jobId, status: "running" });
  let finished: Awaited<ReturnType<typeof autoFinishVideo>>;
  try {
    finished = await autoFinishVideo(workdir, { clips, script, title: input.hookTitle, cta: input.cta });
  } catch (e) {
    return failJob(job, "failed", `Đã có đủ ${n} clip nhưng ghép video lỗi: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, { ...res, script });
  }
  if (!finished) return failJob(job, "failed", "Ghép video không ra tệp thành phẩm", { ...res, script });
  audit(job.biz_id, "creative_agent", "creative.manual_finished", { type: "creative_job", id: jobId }, { clips: n, agentStatus: res.status });
  return completeVideoJob(jobId, {
    ...res, status: "done", finalPath: finished.path, scenes: n, script, durationSec: plan.durationSec, caption: res.caption || plan.caption,
    notes: `${res.notes ? `${res.notes}\n` : ""}[Concept: ${plan.concept.name} · hệ thống ghép ${n} clip + phụ đề]`,
  });
}

/**
 * Sếp bấm "Tải clip từ Flow & ghép lại" trên job làm thủ công bị dừng: không tạo lại video (không tốn tín dụng) — hệ thống tải
 * clip đã có trong dự án Flow rồi ghép, như bước kết thúc bình thường. Chạy nền; trạng thái theo dõi ở trang Sản xuất video.
 */
export function retryManualFinish(bizId: string, jobId: string, actor: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
  if (!FLOW_TOOLS[job.tool]?.manual) throw new AppError("NOT_MANUAL", "Chỉ dùng cho video làm thủ công trên Flow");
  if (!["failed", "blocked"].includes(job.status)) throw new AppError("BAD_STATUS", "Video này không ở trạng thái lỗi/bị chặn");
  if (!readManualPlan(job.workdir)) throw new AppError("NO_PLAN", "Video này chưa có kế hoạch phân cảnh — tạo video mới");
  const prior = FlowResult.safeParse(job.result);
  update("creative_job", jobId, { status: "running", error: null, ended_at: null, step: "Tải clip từ dự án Flow & ghép lại" });
  emit(bizId, "creative.updated", { jobId, status: "running" });
  audit(bizId, actor, "creative.manual_retry_finish", { type: "creative_job", id: jobId });
  void finishManualFlowJob(jobId, prior.success ? prior.data : salvageResult(job.input as CreativeInput, "Sếp yêu cầu tải clip & ghép lại"))
    .catch((e) => failJob(byId<Row>("creative_job", jobId)!, "failed", e instanceof Error ? e.message : String(e)));
  return byId("creative_job", jobId);
}

/** Nghỉ bao nhiêu phút trước mỗi lần tự thử lại khi Flow chặn tạo video tự động (lần 1, 2, 3). */
export const RISK_RETRY_MIN = [40, 120, 300];
const clock = (d: Date) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/** Huỷ các lần tự thử lại đang chờ giờ của job này (đã có lần chạy / lịch mới thay thế) — không để lịch cũ chạy sớm hơn thời gian nghỉ đã định. */
function dropPendingRiskRetries(jobId: string) {
  q.run("UPDATE job SET status = 'dead', last_error = 'Đã có lần chạy / lịch mới thay thế' WHERE name = 'creative.flow' AND status = 'queued' AND idempotency_key LIKE ?", `flow-risk:${jobId}:%`);
}

/**
 * Xếp lần thử lại sau khi nghỉ. Mỗi lượt chạy làm được thêm cảnh nào thì coi là CÓ TIẾN TRIỂN → bộ đếm thất bại về 0 (Flow chặn sau vài cảnh
 * là chuyện thường, cứ nghỉ rồi làm tiếp từng đợt). Chỉ khi {RISK_RETRY_MIN.length} lượt liên tiếp không thêm được cảnh nào mới dừng và nhờ Sếp bấm tay.
 * `have` = số cảnh đã có clip. Trả false khi hết lần.
 */
function scheduleRiskRetry(job: Row, res: z.infer<typeof FlowResult>, have: number, total: number): boolean {
  const past = q.all<Row>("SELECT data FROM audit_log WHERE event = 'creative.risk_retry_scheduled' AND ref_id = ? ORDER BY at DESC", job.id);
  let stalled = 0;
  for (const r of past) { if (Number(r.data?.have) === have) stalled++; else break; } // các lần gần nhất không thêm được cảnh nào
  if (stalled >= RISK_RETRY_MIN.length || past.length >= 12) return false;
  const at = new Date(Date.now() + RISK_RETRY_MIN[stalled] * 60_000);
  dropPendingRiskRetries(job.id);
  update("creative_job", job.id, { status: "queued", error: null, ended_at: null, result: res, step: `Flow đang chặn tạo video tự động (đã có ${have}/${total} cảnh) — hệ thống nghỉ rồi tự làm tiếp lúc ${clock(at)}${stalled ? ` (lần ${stalled + 1}/${RISK_RETRY_MIN.length} không tiến triển)` : ""}, từng cảnh một` });
  enqueue("media", "creative.flow", { jobId: job.id }, { bizId: job.biz_id, runAt: at, idempotencyKey: `flow-risk:${job.id}:${past.length + 1}`, lockKey: "flow-chrome", maxAttempts: 1 });
  audit(job.biz_id, "creative_agent", "creative.risk_retry_scheduled", { type: "creative_job", id: job.id }, { attempt: past.length + 1, stalled, have, at: at.toISOString() });
  emit(job.biz_id, "creative.updated", { jobId: job.id, status: "queued" });
  emit(job.biz_id, "alert.raised", { level: "info", text: `Video "${job.title}": đã có ${have}/${total} cảnh, Flow đang chặn — hệ thống tự làm tiếp lúc ${clock(at)}.`, category: "video", key: `flow-risk:${job.id}`, href: "/video-flow" });
  return true;
}

/** Sếp bấm "Thử tự động lại": chạy lại bước tạo video ngay (dự án + ảnh storyboard giữ nguyên, agent làm TIẾP, từng cảnh một). */
export function resumeManualFlow(bizId: string, jobId: string, actor: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
  if (!FLOW_TOOLS[job.tool]?.manual) throw new AppError("NOT_MANUAL", "Chỉ dùng cho video làm thủ công trên Flow");
  // "running" chỉ nhận lại khi là vòng "tự chờ Sếp bấm tạo" (kể cả vòng đã mất vì máy chủ khởi động lại) — không đụng việc agent đang chạy thật.
  const idleWait = job.status === "running" && (waitingManual.has(jobId) || String(job.step ?? "").startsWith("Chờ Sếp bấm"));
  if (!["failed", "blocked", "queued"].includes(job.status) && !idleWait) throw new AppError("BAD_STATUS", "Video này đang chạy — chờ xong hoặc dừng trước");
  if (!readManualPlan(job.workdir)) throw new AppError("NO_PLAN", "Video này chưa có kế hoạch phân cảnh — tạo video mới");
  if (idleWait) update("creative_job", jobId, { status: "cancelled" }); // dừng vòng "tự chờ" đang chạy để chạy lại tự động
  dropPendingRiskRetries(jobId);
  update("creative_job", jobId, { status: "queued", error: null, ended_at: null, step: "Chờ trình duyệt rảnh" });
  enqueue("media", "creative.flow", { jobId }, { bizId, idempotencyKey: `flow-resume:${jobId}:${Date.now()}`, lockKey: "flow-chrome", maxAttempts: 1 });
  audit(bizId, actor, "creative.manual_resume", { type: "creative_job", id: jobId });
  emit(bizId, "creative.updated", { jobId, status: "queued" });
  return byId("creative_job", jobId);
}

/** Việc làm thủ công đang tự chờ video (Sếp bấm tạo trong dự án Flow) — mỗi job chỉ 1 vòng chờ. */
const waitingManual = new Set<string>();
const FLOW_WAIT = resolve("packages/orchestrator/bin/flow-wait.mjs");
const MANUAL_WAIT_MAX_MIN = 120;

/**
 * Flow chặn tạo video tự động → Sếp tự bấm tạo video trong dự án Flow (người thật), hệ thống TỰ CHỜ đủ video (đọc trang, không bấm gì,
 * không tốn tín dụng) → tải clip (taki-flow-collect) → ghép + phụ đề + hook + CTA → hộp Duyệt. Chạy nền, tối đa 2 giờ.
 */
export function waitAndFinishManual(bizId: string, jobId: string, actor: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
  if (!FLOW_TOOLS[job.tool]?.manual) throw new AppError("NOT_MANUAL", "Chỉ dùng cho video làm thủ công trên Flow");
  if (!["failed", "blocked"].includes(job.status)) throw new AppError("BAD_STATUS", "Video này không ở trạng thái lỗi/bị chặn");
  const plan = readManualPlan(job.workdir);
  if (!plan) throw new AppError("NO_PLAN", "Video này chưa có kế hoạch phân cảnh — tạo video mới");
  const prior = FlowResult.safeParse(job.result);
  const projectUrl = manualProjectUrl(job.workdir, prior.success ? prior.data.notes : null);
  if (!projectUrl) throw new AppError("NO_PROJECT", "Chưa có dự án Flow của video này (agent chưa kịp tạo dự án)");
  if (waitingManual.has(jobId)) throw new AppError("BUSY", "Đang chờ video của việc này rồi");
  const n = plan.scenes.length;
  const fs = flowSettings(bizId);
  const setStep = (text: string) => { update("creative_job", jobId, { step: text }); emit(bizId, "creative.updated", { jobId, status: "running" }); };
  update("creative_job", jobId, { status: "running", error: null, ended_at: null, step: `Chờ Sếp bấm tạo video trong dự án Flow (0/${n})` });
  emit(bizId, "creative.updated", { jobId, status: "running" });
  audit(bizId, actor, "creative.manual_wait_started", { type: "creative_job", id: jobId }, { projectUrl, scenes: n });
  waitingManual.add(jobId);
  void (async () => {
    const deadline = Date.now() + MANUAL_WAIT_MAX_MIN * 60_000;
    const cancelled = () => byId<Row>("creative_job", jobId)?.status === "cancelled";
    try {
      await chromeFlowAccount(fs);
      await openInFlowChrome(projectUrl, { channel: fs.chromeChannel, dir: fs.chromeProfileDir });
      let done = false;
      let lastErr = "";
      while (!done && Date.now() < deadline) {
        if (cancelled()) return;
        const out = await execFileAsync(process.execPath, [FLOW_WAIT, "--videos", String(n), "--max", "8"], { timeout: 10 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024 })
          .then((x) => String(x.stdout), (e) => String(e?.stdout ?? ""));
        let r: { done?: boolean; videos?: number; error?: string | null } = {};
        try { r = JSON.parse(out.trim().split("\n").filter(Boolean).at(-1) ?? "{}"); } catch { /* chưa có số liệu */ }
        done = Boolean(r.done);
        lastErr = r.error ?? "";
        if (!done) {
          setStep(`Chờ Sếp bấm tạo video trong dự án Flow (${r.videos ?? 0}/${n})${lastErr ? ` — Flow báo: ${lastErr.slice(0, 120)}` : ""}`);
          if (!out.trim()) await openInFlowChrome(projectUrl, { channel: fs.chromeChannel, dir: fs.chromeProfileDir }).catch(() => {}); // mất tab Flow → mở lại dự án
          await new Promise((r2) => setTimeout(r2, 20_000));
        }
      }
      if (cancelled()) return;
      if (!done) return failJob(byId<Row>("creative_job", jobId)!, "blocked", `Đã chờ ${MANUAL_WAIT_MAX_MIN} phút nhưng dự án Flow chưa đủ ${n} video${lastErr ? ` (Flow báo: ${lastErr})` : ""} — bấm tạo video cho các cảnh còn thiếu rồi chạy lại`);
      setStep(`Đủ ${n} video — hệ thống đang tải clip`);
      await finishManualFlowJob(jobId, prior.success ? prior.data : salvageResult(job.input as CreativeInput, "Sếp tạo video trong dự án Flow, hệ thống tải clip & ghép"));
    } catch (e) {
      failJob(byId<Row>("creative_job", jobId)!, "failed", e instanceof Error ? e.message : String(e));
    } finally { waitingManual.delete(jobId); }
  })();
  return byId("creative_job", jobId);
}

/** Mở dự án Flow của video này trong Chrome Flow (đã đăng nhập sẵn), đưa cửa sổ lên màn hình để Sếp bấm tạo video. */
export async function openManualProject(bizId: string, jobId: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job || job.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy job", 404);
  const prior = FlowResult.safeParse(job.result);
  const projectUrl = manualProjectUrl(job.workdir, prior.success ? prior.data.notes : null);
  if (!projectUrl) throw new AppError("NO_PROJECT", "Chưa có dự án Flow của video này");
  const fs = flowSettings(bizId);
  await chromeFlowAccount(fs);
  await openInFlowChrome(projectUrl, { channel: fs.chromeChannel, dir: fs.chromeProfileDir });
  return { projectUrl };
}

/** Agent chết / hết giờ / trả sai định dạng nhưng job Flow đã lưu ≥ 2 clip → để hệ thống tự ghép (không áp cho edit-source, news…). */
function canSalvage(input: CreativeInput, workdir: string | null | undefined) {
  return engineOf(input.tool) === "flow" && !!workdir && savedClips(workdir).length >= 2;
}

/** Kết quả thay thế khi agent không trả được JSON nhưng đã lưu clip: để completeVideoJob tự ghép (lời thoại lấy từ script.json nếu có). */
function salvageResult(input: CreativeInput, why: string): z.infer<typeof FlowResult> {
  return { status: "failed", finalPath: "", durationSec: 0, scenes: 0, redoneScenes: [], script: [], caption: input.hookTitle || input.title, notes: why };
}

/** After an API restart: the detached agent keeps running — keep its live log flowing and wait for its result. */
export async function reattachVideoJob(jobId: string) {
  const job = byId<Row>("creative_job", jobId);
  if (!job?.workdir) return;
  const fs = flowSettings(job.biz_id);
  const input = job.input as CreativeInput;
  const tool = FLOW_TOOLS[input.tool];
  const manualScenes = tool.manual ? readManualPlan(job.workdir)?.scenes.length ?? 0 : 0;
  const timeoutMin = tool.manual ? Math.max(fs.timeoutMin ?? 0, manualTimeoutMin(manualScenes)) : (fs.timeoutMin ?? tool.minutes + 30);
  const deadline = new Date(job.started_at ?? job.created_at).getTime() + timeoutMin * 60_000;
  const log: Row[] = [...(job.log ?? [])];
  const stored = log.filter((s) => !s.reattach).length - 1; // first entry is the runner's own "đang chạy ngầm" line
  log.push({ at: nowIso(), kind: "text", text: "Máy chủ vừa khởi động lại — agent vẫn chạy ngầm, theo dõi tiếp", reattach: true });
  const flush = logFlusher(job.biz_id, jobId, log);
  flush(true);
  let res: unknown;
  try {
    res = await followClaudeRun({
      resultFile: join(job.workdir, "result.json"), deadline, skipSteps: Math.max(0, stored),
      onStep: (s) => { log.push(s); flush(); },
      isActive: () => byId<Row>("creative_job", jobId)?.status === "running",
    });
  } catch (e) {
    flush(true);
    if (byId<Row>("creative_job", jobId)?.status !== "running") return;
    const error = friendlyFlowError(e instanceof Error ? e.message : String(e));
    if (tool.manual) return finishManualFlowJob(jobId, salvageResult(input, `Agent dừng giữa chừng: ${error}`));
    if (canSalvage(input, job.workdir)) return completeVideoJob(jobId, salvageResult(input, `Agent dừng giữa chừng: ${error}`));
    update("creative_job", jobId, { status: error === NO_TOOL_ACCESS_MSG ? "blocked" : "failed", error, step: null, ended_at: nowIso() });
    emit(job.biz_id, "creative.updated", { jobId, status: "failed" });
    notifyDesktop(`Video "${job.title}" chưa tạo được`, error);
    return;
  }
  flush(true);
  if (res == null) return;
  const out = FlowResult.safeParse(res);
  if (tool.manual) return finishManualFlowJob(jobId, out.success ? out.data : salvageResult(input, "Agent không trả kết quả đúng định dạng"));
  if (!out.success) {
    if (canSalvage(input, job.workdir)) return completeVideoJob(jobId, salvageResult(input, "Agent không trả kết quả đúng định dạng"));
    update("creative_job", jobId, { status: "failed", error: "Agent không trả kết quả đúng định dạng", step: null, ended_at: nowIso() });
    emit(job.biz_id, "creative.updated", { jobId, status: "failed" });
    return;
  }
  return completeVideoJob(jobId, out.data);
}

/** Post-render half of a job: verify the file, register the asset, review, open the approval. */
export async function completeVideoJob(jobId: string, agentRes: z.infer<typeof FlowResult>) {
  const job = byId<Row>("creative_job", jobId)!;
  const bizId = job.biz_id as string;
  const input = job.input as CreativeInput;
  const tool = FLOW_TOOLS[input.tool];
  const workdir = job.workdir as string;
  let res = agentRes;
  // Hệ thống tự ghép: agent đã lưu clip vào clips/ nhưng KHÔNG có final.mp4 (chưa kịp hậu kỳ, hậu kỳ lỗi, dừng giữa chừng)
  // → ghép tại máy chủ thay vì bỏ cả video. CHỈ với job Flow: "AI tự edit" (edit-source) cũng ghi clip vào clips/ nhưng đó là
  // các đoạn cắt do chính agent dựng, không được tự nối. Agent báo "failed" thì ghép khi có ≥ 2 clip (đủ số cảnh nếu agent
  // khai); báo "blocked" (hết tín dụng, chính sách, không có quyền…) thì chỉ ghép khi agent khai số cảnh và clip đã đủ.
  if (engineOf(input.tool) === "flow" && workdir) {
    const clipCount = savedClips(workdir).length;
    const hasFinal = Boolean(res.finalPath) && existsSync(res.finalPath);
    const enough = res.status === "done" ? clipCount > 0
      : res.status === "blocked" ? res.scenes > 0 && clipCount >= res.scenes
      : clipCount >= Math.max(2, res.scenes || 0);
    if (!hasFinal && clipCount && enough) {
      update("creative_job", jobId, { step: `Hệ thống đang tự ghép ${clipCount} clip thành video hoàn chỉnh` });
      emit(bizId, "creative.updated", { jobId, status: "running" });
      try {
        const f = await autoFinishVideo(workdir, { script: res.script, title: input.hookTitle, cta: input.cta });
        if (f) {
          res = { ...res, status: "done", finalPath: f.path, scenes: res.scenes || f.clips, caption: res.caption || input.hookTitle || input.title,
            notes: `${res.notes ? `${res.notes}\n` : ""}[Hệ thống tự ghép ${f.clips} clip thành final.mp4]` };
          audit(bizId, "creative_agent", "creative.auto_finished", { type: "creative_job", id: jobId }, { clips: f.clips, agentStatus: agentRes.status });
        }
      } catch (e) {
        logger.warn("creative.auto_finish_failed", { jobId, error: e instanceof Error ? e.message.slice(0, 400) : String(e) });
      }
    }
  }
  const skill = q.get<Row>("SELECT version FROM skill WHERE biz_id = ? AND key = ?", bizId, tool.skill);
  const fail = (status: "failed" | "blocked", error: string) => {
    update("creative_job", jobId, { status, error, step: null, ended_at: nowIso() });
    emit(bizId, "creative.updated", { jobId, status });
    emit(bizId, "alert.raised", { level: "warning", text: `Video "${job.title}": ${error}` });
    notifyDesktop(`Video "${job.title}" chưa tạo được`, error);
  };
  update("creative_job", jobId, { result: res });
  if (res.status !== "done") {
    const msg = friendlyFlowError(res.notes || "Agent dừng giữa chừng");
    return fail(msg === NO_TOOL_ACCESS_MSG ? "blocked" : res.status, msg);
  }

  // Verify the file in code; never trust the model's claim that it exists.
  let finalPath = res.finalPath;
  if (!existsSync(finalPath)) return fail("failed", `Không thấy file thành phẩm ${finalPath}`);
  if (!finalPath.startsWith(workdir)) {
    const dest = join(workdir, basename(finalPath));
    copyFileSync(finalPath, dest);
    finalPath = dest;
  }
  const meta = probeVideo(finalPath);
  const asset = insert("creative_asset", {
    biz_id: bizId, job_id: jobId, kind: "video", path: finalPath, mime: "video/mp4", duration: meta.duration, width: meta.width, height: meta.height,
    size: statSync(finalPath).size, meta: { tool: input.tool, skill: tool.manual ? "làm thủ công (flow-manual)" : `${tool.skill} v${skill?.version ?? "?"}`, scenes: res.scenes, redone: res.redoneScenes },
  });
  const scriptText = res.script.map((s) => `[Cảnh ${s.canh}] ${s.loi_thoai}`).join("\n");
  // Video làm từ kịch bản đã duyệt (Nội dung → Tạo video): dùng Caption ĐÃ DUYỆT của kịch bản, gắn ngược về kịch bản gốc.
  const source = job.source_content_id ? byId<Row>("content_item", job.source_content_id) : undefined;
  const approvedCaption = source?.kind === "video_script" ? parseVideoScript(source.body)?.caption : undefined;
  const caption = approvedCaption || res.caption;
  const ci = insert("content_item", {
    biz_id: bizId, agent_key: "creative", kind: "video", channel: input.channels[0], title: input.title, goal_id: source?.goal_id ?? null,
    body: `${caption}\n\n---\nLời thoại:\n${scriptText}`, status: "in_review", asset_id: asset.id,
  });
  if (source) update("content_item", source.id, { status: "video_made", asset_id: asset.id });
  update("creative_job", jobId, { status: "done", step: "Đã xong, chờ duyệt", asset_id: asset.id, content_item_id: ci.id, ended_at: nowIso() });

  // Review: technical checks in code + script/caption through the normal Review Agent (Jev + MKT QA)
  const tech = [
    { check: "Có file MP4 hợp lệ", passed: meta.duration > 0, severity: "fatal" as const, detail: `${meta.duration.toFixed(1)}s` },
    { check: "Có âm thanh", passed: meta.hasAudio, severity: "major" as const },
    { check: "Khung dọc 9:16", passed: !!meta.width && !!meta.height && Math.abs(meta.width / meta.height - 9 / 16) < 0.02, severity: "minor" as const, detail: `${meta.width}x${meta.height}` },
  ];
  // LUÔN chấm Review + Compliance khi có DNA (kể cả video kênh khách/affiliate, brand "other" — trước đây bỏ qua nên video
  // lên hộp Duyệt không có điểm và không qua soát tuyên bố cấm). Kênh không phải TAKI: chấm theo dữ kiện của SẢN PHẨM.
  const dnaData = activeDna(bizId)?.data;
  const rv = dnaData ? reviewDnaFor(input, dnaData) : null;
  const review = rv
    ? await reviewOutput({
      bizId, subjectType: "content_item", subjectId: ci.id, rubricKey: "video_final", output: { caption: res.caption, script: res.script, facts: rv.facts }, dna: rv.dna,
      contentView: { title: input.title, hook: res.script[0]?.loi_thoai ?? "", body: res.script.map((s) => s.loi_thoai).join("\n"), cta: res.script.at(-1)?.loi_thoai ?? "", channel: input.channels[0] },
      extraChecks: tech,
    })
    : null;
  if (review) update("content_item", ci.id, { review_score_id: review.id });
  update("content_item", ci.id, { status: "awaiting_approval" });
  const approval = insert("approval", {
    biz_id: bizId, subject_type: "creative_job", subject_id: jobId, agent_key: "creative", title: `Video: ${input.title}`,
    risk: tech.some((t) => !t.passed) || review?.verdict === "revise" ? "medium" : "low", status: "pending", review_score_id: review?.id ?? null,
    expires_at: approvalExpiresAt(bizId), // hạn duyệt theo cài đặt — quá hạn thì Sếp bấm "Mở lại" (approvals.ts)
    preview: { assetId: asset.id, duration: meta.duration, channels: input.channels, caption: res.caption, tool: tool.label, tech, notes: res.notes, redone: res.redoneScenes },
  });
  audit(bizId, "creative_agent", "creative.video_ready", { type: "creative_job", id: jobId }, { assetId: asset.id, duration: meta.duration });
  emit(bizId, "creative.updated", { jobId, status: "done" });
  emit(bizId, "approval.created", { approvalId: approval.id, title: approval.title });
  queueAutoApprove(bizId, approval.id); // Sếp đang bật "Tự động phê duyệt" → đăng nháp luôn nếu video đạt ngưỡng điểm (auto-approve.ts)
  notifyDesktop(`Video "${job.title}" đã xong`, `Đã ghép + chèn phụ đề (${Math.round(meta.duration ?? res.durationSec)} giây). Mở "Duyệt & Phê duyệt" để xem và duyệt đăng nháp.`);
}

/**
 * DNA dùng để chấm video thành phẩm. Kênh TAKI (brand "taki") → DNA thương hiệu như cũ. Kênh khách/affiliate (brand "other")
 * → KHÔNG áp giọng/ký tự riêng của TAKI; tên + đối tượng + dữ kiện lấy từ SẢN PHẨM của video (DNA › products), vẫn giữ danh
 * sách tuyên bố cấm (Compliance).
 */
export function reviewDnaFor(input: CreativeInput, dna: Row): { dna: any; facts: { statement: string }[] } {
  if (input.brand === "taki") return { dna, facts: [] };
  const products = (dna.products ?? []) as Row[];
  const product = input.product ? products.find((p) => p.name === input.product) : undefined;
  const points: string[] = product
    ? (Array.isArray(product.sellingPoints) ? product.sellingPoints.map(String) : String(product.summary ?? "").split(/\s*;\s*/)).filter(Boolean)
    : [];
  const facts = [
    ...(product?.price != null ? [`Giá ${product.name}: ${product.price}đ`] : []),
    ...(product?.offer ? [`Ưu đãi: ${product.offer}`] : []),
    ...points,
  ].map((statement) => ({ statement }));
  const name = String(product?.name ?? input.product ?? input.title);
  return {
    dna: {
      ...dna,
      company: { ...(dna.company ?? {}), name, brand: name },
      audience: product?.audience ? [{ name: String(product.audience), pains: [], goals: [] }] : (dna.audience ?? []),
      voice: { style: ["tự nhiên", "gần gũi"], do: [], dont: [], sample: "" },
      bannedChars: [], // ký tự cấm là quy ước riêng của TAKI
      forbiddenClaims: dna.forbiddenClaims ?? [],
      products: product ? [product] : products,
    },
    facts,
  };
}

export function probeVideo(path: string) {
  try {
    const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], { encoding: "utf8" }));
    const v = (j.streams ?? []).find((s: Row) => s.codec_type === "video");
    return { duration: Number(j.format?.duration ?? 0), width: v?.width ?? null, height: v?.height ?? null, hasAudio: (j.streams ?? []).some((s: Row) => s.codec_type === "audio") };
  } catch (e) {
    logger.warn("ffprobe.failed", { path, error: String(e) });
    return { duration: 0, width: null, height: null, hasAudio: false };
  }
}

// ---------------- Draft upload to channels (after approval) ----------------
export function scheduleDrafts(bizId: string, jobId: string, actor: string) {
  const job = byId<Row>("creative_job", jobId)!;
  const input = job.input as CreativeInput;
  const created: string[] = [];
  for (const ch of input.channels) {
    const channel = publishChannelFor(bizId, ch); // ưu tiên "kênh đăng chính"
    if (!channel) continue;
    const pj = insert("publish_job", {
      biz_id: bizId, content_item_id: job.content_item_id, channel_id: channel.id, scheduled_at: nowIso(), status: "scheduled",
      idempotency_key: `draft:${job.id}:${channel.id}`, mode: "draft", asset_id: job.asset_id,
    });
    enqueue("publish", "publish.draft", { publishJobId: pj.id }, { bizId, idempotencyKey: `draftrun:${pj.id}`, lockKey: chromeLock(channel, "draft") });
    created.push(pj.id);
  }
  // Không ghi đè bài đã sang luồng khác (đã lên lịch / đã đăng): chỉ đưa bài đang chờ duyệt về "đã duyệt".
  q.run("UPDATE content_item SET status = 'approved' WHERE id = ? AND status IN ('in_review','awaiting_approval')", job.content_item_id);
  update("creative_job", jobId, { status: "approved", step: created.length ? "Đã duyệt, đang đăng nháp" : "Đã duyệt — chưa có kênh để đăng nháp" });
  audit(bizId, actor, "creative.drafts_scheduled", { type: "creative_job", id: jobId }, { channels: input.channels });
  return created;
}

export async function runDraftUpload(publishJobId: string) {
  const pj = byId<Row>("publish_job", publishJobId);
  if (!pj || pj.status === "draft_uploaded" || pj.status === "needs_check") return;
  // Lần trước dừng giữa lúc tải nháp (sập / Chrome treo) → nháp CÓ THỂ đã lên kênh: không tải lần 2.
  if (pj.status === "posting") {
    markNeedsCheck(pj, "lần tải nháp trước bị gián đoạn");
    return;
  }
  const asset = byId<Row>("creative_asset", pj.asset_id);
  const ci = byId<Row>("content_item", pj.content_item_id)!;
  const channel = byId<Row>("channel", pj.channel_id)!;
  if (!asset || !existsSync(asset.path)) throw new PermanentError("Không thấy file video để đăng nháp");
  // Real or nothing (Kênh đăng): Page API draft (unpublished video) → Chrome Flow agent "Lưu bản nháp" → "chờ kết nối kênh".
  const route = draftRoute(channel); // đường của BẢN NHÁP (TikTok: hộp thư qua API dù chưa được duyệt đăng công khai)
  const api = connectorForChannel(channel);
  const noApiDraft = route === "api" && !api.uploadDraft;
  if (route === "none" || (noApiDraft && !browserReady(channel).ok)) {
    if (route === "none") blockNotConnected(pj, ci, channel, "video (bản nháp)");
    else {
      const error = `${channel.name} (${channel.platform}): API kênh này chưa hỗ trợ bản nháp và chưa thiết lập đăng qua Chrome — video CHƯA lên kênh`;
      update("publish_job", pj.id, { status: "needs_setup", error });
      emit(pj.biz_id, "alert.raised", { level: "warning", text: `Video "${ci.title}": ${error}`, category: "publish", key: `publish:${pj.id}`, href: "/channels" });
    }
    const error = String(byId<Row>("publish_job", pj.id)!.error ?? "");
    q.run("UPDATE creative_job SET step = ? WHERE content_item_id = ?", `Đã duyệt — chưa lên nháp: ${error}`, ci.id);
    emit(pj.biz_id, "creative.updated", { status: "approved" });
    return;
  }
  const pt = publishText(ci, true);
  if ("error" in pt) {
    update("publish_job", pj.id, { status: "failed", error: `${pt.error} — video CHƯA lên kênh` });
    emit(pj.biz_id, "alert.raised", { level: "warning", text: `Video "${ci.title}": ${pt.error}`, category: "publish", key: `publish:${pj.id}`, href: "/publish" });
    return;
  }
  update("publish_job", pj.id, { status: "posting", error: null });
  const caption = pt.text;
  let draftUrl: string;
  let via: "api" | "browser" = route === "api" && !noApiDraft ? "api" : "browser";
  const viaBrowser = async () => {
    try {
      return (await browserPublish(channel, { text: caption, mediaPath: asset.path, mode: "draft", tag: `draft-${pj.id}` })).permalink;
    } catch (e) {
      if (browserFailedBeforePosting(e)) throw e; // chắc chắn chưa lưu nháp
      throw markNeedsCheck(pj, e instanceof Error ? e.message : String(e)); // agent dừng giữa chừng: nháp có thể đã lưu
    }
  };
  try {
    if (via === "api") {
      try {
        draftUrl = (await api.uploadDraft!({ channelExternalId: channel.external_id, videoPath: asset.path, caption }, pj.idempotency_key)).draftUrl;
      } catch (e) {
        // API không làm được (connector báo NeedsBrowser) → lưu nháp qua Chrome nếu kênh đã thiết lập.
        if (!(e instanceof ConnectorError && e.kind === "NeedsBrowser" && browserReady(channel).ok)) throw e;
        via = "browser";
        draftUrl = await viaBrowser();
      }
    } else draftUrl = await viaBrowser();
  } catch (e) {
    const cur = byId<Row>("publish_job", pj.id) ?? pj;
    if (cur.status === "needs_check") throw e; // markNeedsCheck đã ghi trạng thái + báo
    // Chrome Flow đang dựng video / Facebook giới hạn tần suất: chưa gửi gì → xếp lại vài phút sau.
    if (e instanceof AppError && e.code === "CHROME_BUSY" && requeueLater(cur, channel, "chrome_busy", e.message, 2 * 60_000)) return;
    if (e instanceof ConnectorError && e.kind === "RateLimited" && requeueLater(cur, channel, "rate_limited", e.message, 10 * 60_000)) return;
    // Mạng/timeout/5xx sau khi đã gửi lệnh tải: nháp CÓ THỂ đã lên kênh → Sếp kiểm tra, không tự tải lại.
    if (e instanceof ConnectorError && (e.kind === "Transient" || (e as { outcomeUnknown?: boolean }).outcomeUnknown)) throw markNeedsCheck(pj, e.message);
    const final = permanentIfFinal(e, channel);
    const error = final instanceof Error ? final.message : String(final);
    update("publish_job", pj.id, { status: "failed", error });
    q.run("UPDATE creative_job SET step = ? WHERE content_item_id = ?", `Đã duyệt — chưa lên nháp: ${error}`, ci.id);
    emit(pj.biz_id, "alert.raised", { level: "warning", text: `Video "${ci.title}" chưa lên nháp ${channel.name}: ${error}`, category: "publish", key: `publish:${pj.id}`, href: "/publish" });
    emit(pj.biz_id, "creative.updated", { status: "approved" });
    throw new PermanentError(error);
  }
  update("publish_job", pj.id, { status: "draft_uploaded", draft_url: draftUrl, simulated: 0, error: null });
  const left = q.scalar<number>("SELECT COUNT(*) FROM publish_job WHERE content_item_id = ? AND mode = 'draft' AND status != 'draft_uploaded'", ci.id);
  if (!left) {
    // Không ghi đè trạng thái của luồng khác (đã lên lịch / đã đăng công khai): chỉ bài đang "đã duyệt".
    q.run("UPDATE content_item SET status = 'draft_on_channel' WHERE id = ? AND status = 'approved'", ci.id);
    q.run("UPDATE creative_job SET status = 'drafted', step = 'Đã lên nháp kênh' WHERE content_item_id = ?", ci.id);
    emit(pj.biz_id, "creative.updated", { status: "drafted" });
  }
  audit(pj.biz_id, "publishing", "post.draft_uploaded", { type: "publish_job", id: pj.id }, { channel: channel.name, draftUrl, via });
  emit(pj.biz_id, "post.published", { title: `Nháp trên ${channel.name}: ${ci.title}`, channel: channel.name, simulated: false, via });
}

// ---------------- Chrome Flow ← chosen profile ----------------
/**
 * Copy the chosen everyday profile's login into Chrome Flow and report which Google accounts it now has.
 * Runs in seconds, no AI and no clicks. If the copy did not carry the login, Chrome Flow opens on Google sign-in.
 */
export async function connectFlowProfile(bizId: string, channel: string, dir: string) {
  const profile = listChromeProfiles().find((p) => p.channel === channel && p.dir === dir);
  if (!profile) throw new AppError("NO_PROFILE", "Không thấy profile Chrome này trên máy");
  await syncFlowProfile(channel, dir);
  await ensureFlowBrowser({});
  const accounts = await flowAccounts().catch(() => [] as string[]);
  const found = profile.email ? accounts.includes(profile.email) : accounts.length > 0;
  if (!found) await openFlowLogin({}).catch(() => {});
  audit(bizId, "system", "creative.flow_profile_connected", undefined, { dir, found, accounts });
  return { found, accountEmail: found ? (profile.email ?? accounts[0]) : "", accounts, error: found ? "" : "Chưa có đăng nhập Google trong Chrome Flow — cửa sổ đăng nhập đã mở" };
}
