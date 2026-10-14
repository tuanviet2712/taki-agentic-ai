# TAKI Agentic AI

Hệ thống AI Agent vận hành marketing & bán hàng cho **TAKI Group / TAKI Academy** theo **Đặc tả kỹ thuật tổng hợp Agentic AI & ads-chat-orchestrator**. Agent dùng **tài khoản Claude (Claude Code CLI)** hoặc **hồ sơ tài khoản ChatGPT (Codex CLI)** do người dùng chọn, theo **DNA TAKI + skill của Phòng Marketing**, với **Jev (TypeSafe System One)** làm lớp phán đoán nhanh.

> Tên thư mục/gói (`dotaka-agentic`, `@dotaka/*`) là tên kỹ thuật từ bản đầu, không ảnh hưởng thương hiệu hiển thị.

## Cài trên máy mới (giữ nguyên giao diện & chức năng)

Yêu cầu: **Node.js 24+** (`.nvmrc`), **Git**, **Claude Code CLI** đã đăng nhập (`claude`). Tuỳ chọn: **PostgreSQL** (để chạy ZL-CRM/Zalo), **Google Chrome + Python 3 + ffmpeg** (video Flow). Đã thử trên macOS; Linux tương tự.

**Máy Mac mới tinh** — cài công cụ nền (1 lần, mở Terminal):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # Homebrew
brew install node@24 git postgresql@17 ffmpeg python && brew link --overwrite node@24
brew services start postgresql@17
npm i -g @anthropic-ai/claude-code && claude    # đăng nhập tài khoản Claude
```

Cài hệ thống:

```bash
git clone https://github.com/tuanlinh3003-a11y/taki-agentic-ai.git
cd taki-agentic-ai
node scripts/bootstrap.mjs      # cài 1 lần: thư viện, .env, skill, công cụ video, ZL-CRM, tự kiểm tra
pnpm dev                        # chạy: http://localhost:5173  (ZL-CRM: http://localhost:5174)
```

Vì sao máy khác chạy **giống hệt** máy gốc:
- **Phiên bản khoá cứng**: `pnpm-lock.yaml` + `pnpm install --frozen-lockfile` (pnpm 12.8.1 khoá trong `packageManager`), ZL-CRM dùng `package-lock.json` + `npm ci`, thư viện Python ghim phiên bản trong `tools/video/requirements*.txt`.
- **Skill Phòng Marketing đóng gói trong repo** (`assets/claude`: 40 skill + DNA + 8 nhân viên). Hệ thống đọc bản này, không phụ thuộc `~/.claude` của từng máy. Sửa skill ở `~/.claude` xong chạy `pnpm skills:export` rồi commit.
- **ZL-CRM đóng gói trong `services/zl-crm`** (kèm bản vá, xem `services/zl-crm/UPSTREAM.md`), tự tạo database và tự nối vào Agentic AI khi `pnpm dev`.
- **Cấu hình workspace đóng gói** (`config/taki-workspace.json`): DNA, cài đặt, mức tự chủ + model từng agent, mẫu quảng cáo, luồng tự động, tri thức tự thêm. Máy mới tự nạp khi khởi tạo. Sau khi chỉnh trên giao diện: `pnpm workspace:export` rồi commit.
- **Font phụ đề video đóng gói** (`tools/video/fonts`, Be Vietnam Pro) → video xuất ra giống nhau trên mọi máy.
- **CI trên GitHub** (`.github/workflows/ci.yml`) cài lại từ đầu, typecheck, test, build giao diện và chạy thử API mỗi lần đẩy code. `pnpm verify` chạy cùng bộ kiểm tra trên máy.

Không nằm trong repo (sinh riêng cho từng máy, không bao giờ đẩy lên GitHub): `.env` (khoá mã hoá, API key), `data/` (database, video, file tải lên), `services/zl-crm/backend/.env` (mật khẩu ZL-CRM), token Facebook/TikTok/Zalo — kết nối lại trong **Trung tâm tích hợp** sau khi cài.

| Lệnh | Việc làm |
|---|---|
| `pnpm bootstrap` | Cài đặt máy mới (chạy lại an toàn) |
| `pnpm dev` | API (cổng 8787) + giao diện (cổng 5173) + ZL-CRM (3000/5174) |
| `pnpm verify` | Typecheck + test + build giao diện |
| `pnpm skills:export` | Đóng gói lại skill từ `~/.claude` vào repo |
| `pnpm zlcrm:connect` | Nối lại ZL-CRM vào Agentic AI |
| `pnpm workspace:export` | Xuất cấu hình hiện tại (DNA, agent, luồng…) vào repo |
| `pnpm seed` | Xóa và tạo lại dữ liệu mẫu |
| `pnpm test` | Test Rule Engine (gồm test "không bao giờ vượt trần ngân sách") và chấm điểm bài |
| `pnpm eval` | Chấm Chat Agent trên bộ tình huống chuẩn (ngưỡng 80%) |
| `pnpm mcp` | MCP Server cho Claude Desktop (cần `MCP_KEY`) |
| `pnpm start` | Build giao diện và chạy một cổng duy nhất 8787 |

## Kết nối ChatGPT qua Codex CLI · nhiều hồ sơ tài khoản

Hệ thống hỗ trợ thêm `codex_cli` bên cạnh `claude_cli` và `sandbox`. Ngân Nguyệt, chat khách (kể cả xem ảnh), agent nội dung/SEO/kịch bản, nghiên cứu/chiến lược qua LLM Gateway dùng kết nối AI đã chọn. Điều khiển Chrome/Flow và Claude in Chrome tiếp tục dùng luồng Claude hiện có.

1. Cài **Codex CLI >= 0.148.0** trên máy chạy hệ thống: `npm install -g @openai/codex`.
2. Mở **Trung tâm tích hợp → AI** (`/ads/integrations?p=ai`) hoặc **Cài đặt → Model AI**.
3. **Thêm hồ sơ**, đặt tên theo người dùng hoặc tài khoản công ty. Bấm **Đăng nhập ChatGPT** và tự chọn tài khoản trong trang OpenAI. Khi cần có thể dùng **Đăng nhập bằng mã** (tài khoản/workspace phải cho phép device login).
4. Hoàn tất đăng nhập, bấm **Dùng hồ sơ này**, sau đó **Thử** model. Thêm nhiều hồ sơ để chuyển tài khoản; mỗi doanh nghiệp lưu lựa chọn riêng. Có thể ngắt kết nối, đăng nhập lại bằng tài khoản khác hoặc xóa hồ sơ.

`default` dùng model mặc định của CLI theo quyền tài khoản; có thể nhập ID model GPT được hỗ trợ. Chuyển Claude ↔ ChatGPT giữ riêng cấu hình model theo nhà cung cấp. Model Claude cũ ở từng agent không được gửi nhầm sang Codex.

Không tự dùng tài khoản `~/.codex` của máy và không sao chép token giữa hồ sơ. Mỗi hồ sơ có `CODEX_HOME` riêng dưới `data/ai-accounts/`, nằm trong `.gitignore`; token do CLI quản lý, không trả qua API và không ghi trong audit. `CODEX_CLI_PATH` tùy chọn trỏ tới binary hoặc launcher `.js`; Windows tự tìm launcher npm để không cần mở terminal. Tác vụ giữ hồ sơ tại thời điểm bắt đầu; không tự chuyển tài khoản khi lỗi/hết hạn mức. Đăng nhập lại/ngắt kết nối bị chặn khi hồ sơ còn tác vụ.

Các lượt gọi tính vào hạn mức Codex của tài khoản ChatGPT. Kiểm tra phiên xác nhận trạng thái CLI; **Thử model** mới xác nhận tài khoản thực sự gọi AI được. Số token do CLI cung cấp được lưu, chi phí tiền của gói ChatGPT không được CLI báo nên không suy ra giá tiền từ token.

Luồng xác thực và tự động hóa dựa trên [tài liệu đăng nhập OpenAI](https://learn.chatgpt.com/docs/auth) và [Codex chạy không tương tác](https://learn.chatgpt.com/docs/non-interactive-mode). Bản localhost hiện vận hành theo một chủ máy; hồ sơ doanh nghiệp là lựa chọn vận hành, không thay cho đăng nhập/phân quyền người dùng của một bản triển khai nhiều người dùng trên Internet.

## Cài trên Windows 11

Chạy được đủ chức năng (agent Claude, Ngân Nguyệt, ZL-CRM, video AI, hậu kỳ video, Chrome Flow). Khác macOS/Linux:

- **Claude CLI**: Node không gọi được shim `claude.cmd`, nên đặt trong `.env` đường dẫn thẳng tới file chạy:
  `CLAUDE_CLI_PATH=C:/Users/<tên>/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`.
- **Prompt dài** (DNA + skill) và cấu hình MCP được đưa cho CLI qua **file** (`--system-prompt-file`, `--mcp-config <file>`), vì dòng lệnh Windows giới hạn ~32 KB.
- **ZL-CRM** dùng PostgreSQL **riêng** ở cổng **5433** (`services/zl-crm/data/pgdata`, tạo bằng binary PostgreSQL đã cài) — không đụng PostgreSQL hệ thống ở 5432. `pnpm dev` tự bật; dừng: `node scripts/zlcrm-pg.mjs stop`.
- **Video AI** (`pnpm video-ai:install`) chạy bằng **CPU** (không có GPU Apple): LivePortrait chậm, vài phút cho mỗi giây clip. `albucore` được ghim `0.0.13` để không cần trình biên dịch C++.
- **Chrome Flow**: copy đăng nhập Google từ profile Chrome thường có thể không được (Chrome mã hóa cookie theo máy/ứng dụng) — khi đó cửa sổ Chrome Flow mở trang đăng nhập, đăng nhập 1 lần.
- Lệnh agent (`taki-video-finish`, `unzip`…) là script `sh` trong `data/bin`, chạy qua **Git Bash** (cần cài Git for Windows). PowerShell bị chặn để agent luôn dùng Bash.
- Chạy nhanh: bấm đôi `start-taki.cmd`.

## Chế độ chạy — điền `.env` để bật dần

### Chọn Chrome Flow hoặc Claude in Chrome

Trang **Sản xuất video** và **Kênh đăng** có mục **Cơ chế trình duyệt**:

- **Chrome Flow** là mặc định: cửa sổ Chrome riêng + Playwright như trước.
- **Claude in Chrome**: bấm **Dùng Claude in Chrome**, đọc phần xác nhận, chọn profile **Google Chrome có tiện ích Claude**, mở profile, rồi bấm **Ghép Chrome đã chọn**. Nếu CLI yêu cầu thao tác trực tiếp, mở Claude Code → `/chrome` → chọn đúng trình duyệt, sau đó kiểm tra kết nối lại trên giao diện.
- Ở **Kênh đăng**, bấm **Kiểm tra đăng nhập** lại sau khi đổi cơ chế. Kết quả kiểm tra của cơ chế cũ không cho phép đăng ở cơ chế mới. Các tác vụ nghiên cứu vẫn dùng Chrome Flow.
- Quyền Chrome được xét bởi `chrome-approver.mjs` theo công cụ, địa chỉ, thiết bị và tệp được phép. Nhật ký nằm trong thư mục tác vụ (`approver.jsonl`). Không mở quyền đọc toàn bộ thư mục Downloads; clip tải về được chép vào thư mục video trước khi xử lý.
- Dừng quyền Chrome tự động bằng `ALLOW_CHROME_AUTOAPPROVE=0` khi khởi động, hoặc tạo tệp `data/chrome-autoapprove.off` để chặn cả các lượt đang chạy. Xóa tệp này để cho phép lại. Chrome Flow không dùng bộ duyệt đó.
- **Đổi tài khoản Claude**: tiện ích Claude trong profile Chrome phải đăng nhập đúng tài khoản Claude mà Claude Code trên máy đang dùng; nếu không, Claude Code không thấy Chrome đó. Hệ thống sẽ báo rõ (kèm các bước: mở profile → biểu tượng Claude → Đăng xuất → Đăng nhập tài khoản mới → Connect → Kiểm tra kết nối → Ghép Chrome đã chọn) và không tự sửa `~/.claude.json` hay dữ liệu Chrome.
- Biến tùy chọn: `TAKI_DOWNLOADS_DIR` (thư mục Tải xuống nếu không phải mặc định), `ALLOW_REMOTE_BROWSER=1` (không khuyến nghị: bỏ kiểm tra Chrome ở máy khác).
- Mỗi tác vụ video có mục **Nhật ký quyền Chrome** (cho phép/từ chối từng lượt).

Bản ghi tiếp quản và kết quả kiểm tra: [HANDOFF.md](HANDOFF.md).

Sao chép `.env.example` → `.env`.

| Thành phần | Không có key | Có key |
|---|---|---|
| **Jev** (`TYPESAFE_API_KEY`) | heuristic cùng định dạng câu trả lời, gắn nhãn "Jev·heuristic" | Jev thật (`jev-latest`) |
| **Claude / ChatGPT** | Agent nội dung, chat và Ngân Nguyệt dùng Claude CLI hoặc hồ sơ ChatGPT/Codex CLI đã chọn; Chrome/Flow dùng Claude CLI. Không dùng API key nhà cung cấp. Có chế độ sandbox để thử quy trình | Chọn model theo tầng và riêng từng agent; ChatGPT mặc định theo model khả dụng của CLI/tài khoản |
| **Meta / TikTok / Google Ads / Pancake / Zalo** | connector sandbox (số liệu mô phỏng) | cần làm connector thật + duyệt ứng dụng từng nền tảng |
| **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) | ghi log | gửi cảnh báo/báo cáo sáng thật |

### Instagram · TikTok · đăng nhập bằng nút · link dưới bình luận

- **Facebook Login** (Kênh đăng → Cách 1): đặt `FACEBOOK_APP_ID/SECRET` trong `.env` (hoặc nhập ở trang Kênh đăng, được mã hoá), dán Redirect URI `http://localhost:8787/v1/oauth/facebook/callback` vào app (chế độ Development, Sếp là Quản trị viên của app). **Không cần tunnel.** Fanpage + tài khoản Instagram Business gắn kèm tự hiện thành kênh. Quyền quảng cáo là tuỳ chọn (mặc định tắt). Cần `TOKEN_ENCRYPTION_KEY` thật (64 hex) — chưa có thì hệ thống KHÔNG lưu token đăng nhập / App Secret; đặt khoá rồi khởi động lại, các kết nối cũ tự được chuyển sang khoá mới.
- **Instagram** đăng ảnh / Reels qua API; Instagram chỉ nhận link media công khai nên cần **cổng công khai** (bên dưới). Chưa có thì đăng qua Chrome như trước. Instagram không có bản nháp qua API.
- **TikTok** (Kênh đăng → Kết nối TikTok): bản nháp video vào hộp thư TikTok qua API (app chưa duyệt vẫn dùng được); **đăng công khai** qua API chỉ khi Sếp bật "App đã được TikTok duyệt" ở thẻ kênh (chưa duyệt thì dùng Chrome — hệ thống không đăng riêng tư âm thầm). Redirect URI của TikTok phải https → cần cổng công khai, chỉ một lần lúc kết nối.
- **Cổng công khai** (mặc định TẮT): đặt `PUBLIC_PORT=8788` rồi chạy tunnel CHỈ về cổng đó (`cloudflared tunnel --url http://localhost:8788`), `PUBLIC_BASE_URL=https://…`. Cổng này chỉ phục vụ `/r/<mã>` (đo click), `/m/<token>` (media đã duyệt, ký sẵn, hết hạn 3 giờ), callback OAuth và `/healthz`. **Không bao giờ trỏ tunnel về cổng chính 8787** — API chính không có đăng nhập (lớp chặn Host lạ trả 421; `ALLOWED_HOSTS` để thêm tên miền riêng).
- **Link dưới bình luận**: sản phẩm và link lấy ở Mục tiêu & DNA → Sản phẩm (`Link sản phẩm`, tuỳ chọn `Link gắn dưới bình luận` + `Câu bình luận`). Chọn "Sản phẩm của chiến dịch" ở trang Kế hoạch thì bài Facebook của chiến dịch tự gắn link sau 30–60 giây; gắn tay / gắn lại ở trang Đăng bài. Không có địa chỉ công khai ổn định → link sản phẩm + UTM (không có `/r/`; không dùng tunnel nhanh `*.trycloudflare.com` cho `/r/`).

Thời gian đăng bài / đo số liệu là giờ thật (khung đăng 8h · 11h30 · 20h giờ VN). Chỉ khi chạy thử mới nén thời gian bằng `TIME_SCALE_SECONDS` (vd. 60 → 1 giờ nền tảng ≈ 1 phút).

## Skill Phòng Marketing trong hệ thống

Nguồn: `~/.claude/skills` (skill) và `~/.claude/agents/mkt-*.md` (nhân viên). Trang **Skill & Nhân viên MKT** để xem, bật/tắt, "Đồng bộ lại" (lên phiên bản mới khi skill đổi).

| Nhân viên (persona) | Agent trong hệ thống | Skill nạp kèm |
|---|---|---|
| mkt-nghien-cuu | Research | marketing-research, competitor-alternatives, marketing-psychology |
| mkt-chien-luoc | Brief, Strategy | marketing-plan, digital-plan-dao-tao, chien-luoc-content-doanh-nghiep, content-marketing-planner, kpi-okr-master, mkt-workflow |
| mkt-content | Content | ceo-ai-fb-post, ai-content-planner, social-content, copywriting, humanizer |
| mkt-video | Video | fb-reels-topic-generator, viral-ai-script, hook-3-kenh-ai, phan-tich-video-viral |
| mkt-seo | SEO | ntk-seo-writer, taki-seo-workflow, seo-content-evaluator, seo-blog-workflow |
| mkt-ads | Ads (báo cáo & đề xuất tuần) | facebook-ads-expert, toiuuquangcao, copywriting |
| mkt-phan-tich | Analytics | lead-scoring-system, business-dashboard, fb-post-stats |
| mkt-kiem-duyet | Review (lớp chấm thứ 3) | content-scorer-social, ai-script-scorer, viral-content-scorer, humanizer, remove-ai-marks |
| (bán hàng ABS) | Chat | abs-sales-agent, objection-handler-ai-sales, lead-qualifier-taki |
| (chăm sóc lead) | Follow-up | follow-up-sequence-abs |

Skill phụ gắn thêm (khai báo `extraSkills` trong `packages/skills`, bê từ kho skill TAKI): Content (`taki-landing-builder`, `prompt-card-carousel`), Video (`ecom-ai-video-creator`, `autovis-script`, `news-to-video`, `fape-video-script`, `hon-nhan-dao-ly-script`, `video-viral-dao-ly-trung-quoc`, `content-creator-dao-ly`, `facebook-viral-script-factory`, `nguoi-que-ai-prompt`, `kich-ban-card-ai`), Review (`cham-diem-noi-dung`), Chat (`telesales-ai-chu-doanh-nghiep`, `lead-hunter-qualifier`), Creative (các skill Flow + prompt Veo3 theo kênh + dựng/hậu kỳ video). Chạy "Đồng bộ lại" để nạp vào DB. Mỗi agent chỉ nhận skill trong giới hạn ngữ cảnh của nó — skill đứng sau cùng có thể bị rút gọn / bỏ qua (xem "Xem prompt").

Mọi agent gọi Claude đều nhận lớp **DNA** (`taki-dna` + references, hồ sơ `phong-marketing`). Skill viết cho phiên tương tác nên hệ thống giữ phương pháp/tiêu chí, bỏ các bước hỏi lại, ghi file, gọi tool. Mỗi lần chạy ghi lại phiên bản skill đã dùng (`task_run.skills`).

## Agentic Brain (trí nhớ chung của Sếp và đội AI)

Trang **Agentic Brain** (`/brain`): kho ghi chú Markdown thật trên máy (`data/brain/<tên>`, mở được bằng **Obsidian**). 20 ngăn đi theo đúng vòng vận hành Agentic AI — **DNA → thị trường → chiến dịch → nội dung / video → review → đăng & quảng cáo → bán hàng → số liệu → feedback loop**:

`1. Tổng quan · 2. Hộp thư · 3. Nhật ký vận hành (Ngày/Tuần/Tháng) · 4. Mục tiêu & kế hoạch (Nhắc việc) · 5. Thương hiệu & DNA · 6. Khách hàng & thị trường (Chân dung khách hàng/Đối thủ/Nghiên cứu) · 7. Chiến dịch · 8. Nội dung (Bài viết/SEO/Thư viện bài thắng) · 9. Video (Kịch bản/Video Flow/Kho hook/Thư viện video thắng) · 10. Quảng cáo (Báo cáo/Quyết định) · 11. Bán hàng & chăm sóc · 12. Review & kiểm duyệt (Bị chặn) · 13. Feedback loop (Bài học/Sếp từ chối/Đề xuất thay đổi/Thử nghiệm) · 14. Số liệu & báo cáo · 15. Tri thức · 16. Sổ tay quy trình (Kỹ năng/Mẫu ghi chú) · 17. Đội AI · 18. Ý tưởng & hội thoại · 19. Lưu trữ · 20. Tệp & hình ảnh`

Tên ngăn định nghĩa một chỗ (`F` trong `packages/orchestrator/src/brain.ts`); kho tạo theo bố cục cũ được tự chuyển, giữ nguyên ghi chú.

- **Giao diện**: *Ngăn trí nhớ* (cây thư mục + tìm Theo tiêu đề / Toàn văn, không dấu vẫn tìm được — FTS5), *Mạng trí nhớ* (mỗi chấm một ghi chú, đường cong = `[[liên kết]]`, nhãn vùng ở giữa từng cụm, bật "Tên vùng" / "Mới 48 giờ", cuộn để phóng to, bấm chấm để mở), *Vùng trí nhớ* (tỷ lệ từng vùng, bấm để làm nổi), đọc/sửa ghi chú (tự lưu, "Ghi chú trỏ về đây", đổi tên tự sửa liên kết, xóa = vào `.trash`), *Vừa cập nhật*, *Hôm nay*, *Đồng bộ*, thả/dán/đính kèm file vào Hộp thư, thanh lệnh **Giao** cho Ngân Nguyệt (gõ hoặc nói bằng micro tiếng Việt). Có thể thêm nhiều kho hoặc **nối thư mục Obsidian có sẵn**.
- **Tự vận hành** (`brain.tick` mỗi 5 phút + sự kiện): nhật ký ngày/tuần/tháng (Ngân Nguyệt tóm tắt qua Claude CLI), Bảng điều hành + **tiến độ mục tiêu năm**, chân dung khách hàng & **hồ sơ đối thủ** (từ DNA), bài viết / SEO / **kịch bản video** / **video Flow** / **kho hook** / **thư viện bài & video thắng**, báo cáo & **quyết định quảng cáo**, **lead nóng & follow-up Zalo**, **Review** (lỗi hay gặp, bộ tiêu chí, mục bị chặn & lý do), **Feedback loop** (bài học đang áp dụng, lý do Sếp từ chối, đề xuất thay đổi, góp ý cho Ngân Nguyệt), **Chỉ số KPI** & phễu, hồ sơ từng agent, kỹ năng từng skill, 7 **mẫu ghi chú** (brief, kịch bản video, phân tích đối thủ, chân dung khách, thử nghiệm A-B, kịch bản chốt, biên bản họp — chọn khi tạo ghi chú mới). Việc agent làm xong / video / hội thoại với Ngân Nguyệt được lưu ngay vào đúng ngăn. Phần hệ thống ghi nằm giữa `<!-- taki:auto -->` nên chữ Sếp viết thêm không bị ghi đè.
- **Agent dùng Agentic Brain**: ghi chú trong `15. Tri thức` vào kho tri thức mà Chat/Content Agent tra cứu; Ngân Nguyệt tìm/đọc/ghi (`brain_tim`, `brain_doc`, `brain_ghi`, `brain_them`, `brain_nhat_ky`), đặt **nhắc việc** (`4. Mục tiêu & kế hoạch/Nhắc việc`, đến giờ báo trên máy + trong app).
- Dữ liệu nằm trong `data/` (không lên Git). Máy mới: Agentic Brain tự tạo lại từ DNA, skill, agent khi chạy lần đầu.

## Trợ lý Ngân Nguyệt (tổng điều phối)

Nút **Ngân Nguyệt** ở góc phải mọi trang mở khung chat điều hành: Sếp ra lệnh bằng lời, Ngân Nguyệt làm ngay.

- 6 tab: **Trò chuyện** (micro tiếng Việt), **Việc giao**, **Phát hiện**, **Phản hồi** (👍/👎 + góp ý — Ngân Nguyệt áp dụng từ tin sau, lưu vào Agentic Brain), **Lịch sử**, **Lịch & nhắc**. Nút "Mở như app" trên thanh trên cài hệ thống thành ứng dụng riêng (Chrome/Edge).
- **Trò chuyện**: giao việc tức thì cho các agent (Content / Video / SEO, chuỗi chiến dịch brief → nghiên cứu → chiến lược → nội dung, báo cáo Ads, video Flow…), xem và can thiệp mọi tác vụ, báo cáo bằng số liệu thật. Chữ hiện dần, kèm các bước công cụ đã gọi.
- **Việc giao**: những việc Ngân Nguyệt đã giao + trạng thái trực tiếp. **Phát hiện**: lỗi/kẹt/chờ duyệt cần chú ý, bấm "Nhờ Ngân Nguyệt xử lý". **Lịch sử**: các cuộc trò chuyện (mỗi cuộc giữ ngữ cảnh riêng).
- Cách chạy: **Claude Code CLI** — mỗi tin nhắn là `claude -p` bằng tài khoản Claude đã đăng nhập (gói Pro/Max, không dùng API key Anthropic; biến ANTHROPIC_API_KEY bị gỡ khỏi môi trường), nối tiếp phiên của cuộc trò chuyện. Công cụ duy nhất là `packages/orchestrator/bin/taki-mcp.mjs` (MCP) gọi API nội bộ của hệ thống trên máy (localhost:8787), ký tên "Ngân Nguyệt" trong nhật ký.
- An toàn: đọc + giao việc (vẫn qua Review/Duyệt) chạy ngay; thao tác nhạy cảm (duyệt đăng, trả lời khách, đổi quảng cáo, tốn tín dụng Flow, bật/tắt luồng/agent, kill switch, mọi lệnh ghi qua `goi_api`) thành **thẻ xác nhận** Sếp bấm — trừ khi Sếp bật "Tự thực hiện". Công cụ không tự xác nhận được thẻ, không đụng khóa MCP / model / thông tin kết nối.

## Bài SEO luôn đi kèm ảnh

Agent SEO → trang Nội dung / Duyệt: cứ 1000 chữ tối thiểu 4 ảnh (`ceil(chữ × 4 / 1000)`, tối thiểu 4, tối đa 16), tạo ngay sau vòng chấm điểm và chèn thẳng vào thân bài (`![alt](/v1/media/<id>)`). Vị trí tối ưu SEO: 1 ảnh đầu bài ngay sau đoạn mở đầu, các ảnh còn lại chia đều theo số chữ, mỗi ảnh nằm sau đoạn văn đầu của một mục H2/H3 (không giữa danh sách/bảng, không liền nhau, không ở cuối bài). Alt ≤ 125 ký tự (ảnh đầu bài chứa từ khoá chính), tên tệp theo từ khoá không dấu, khung 16:9 1200×675. Thiếu ảnh → bài không tự duyệt, bấm "Tạo ảnh còn thiếu" (chạy nền). "Tải bài + ảnh (.zip)" xuất html chuẩn SEO + markdown + `images/` để đưa lên website. Mã: `packages/orchestrator/src/seo-images.ts`, `seo-export.ts`.

## Tự động phê duyệt (trang Duyệt & Phê duyệt)

Công tắc Sếp bật tay, mặc định TẮT. Khi bật, Sếp đặt ngưỡng điểm (70–100, mặc định 85): bài viết, kịch bản video, bài SEO và video Flow **mới** vào hộp Duyệt mà review "Đạt", không có lỗi nghiêm trọng và điểm ≥ ngưỡng thì được duyệt luôn và đi xuống phần Đăng bài (bài lên lịch đăng theo giờ yên lặng / giới hạn bài mỗi ngày; video đăng nháp lên kênh). Bài SEO phải đủ ảnh, video phải qua kiểm tra kỹ thuật, kill switch đăng bài tắt. **Không bao giờ tự duyệt:** quảng cáo / ngân sách, tin gửi khách (Zalo, chăm khách từ bình luận), đơn hàng, đề xuất học, kế hoạch. Bật công tắc không đụng tới mục đang chờ từ trước; nút "Duyệt ngay N mục" duyệt các mục chờ đã đạt ngưỡng (có hộp xác nhận). Nhật ký ghi "Tự động duyệt" kèm điểm và ngưỡng. Mã: `packages/orchestrator/src/auto-approve.ts`, API `/v1/auto-approve`.

## Sản xuất video Google Flow (Creative Agent)

Trang **Sản xuất video Flow** chạy 3 skill Flow của phòng MKT (`flow-review-do-an-vat`, `flow-cooking-director-video`, `flow-cinematic-short-film`) **bên trong đúng Tool Flow của skill** (vd. "Review Đồ Ăn Vặt AI V6"), hoàn toàn tự động:

- **Chrome Flow**: một cửa sổ Chrome riêng (`data/flow-chrome`, cổng DevTools 9333, cất ở mép phải màn hình) mang sẵn đăng nhập Google của profile Sếp chọn — chép từ profile đó, không đụng tới Chrome đang dùng. Nếu Google không nhận bản sao, Chrome Flow mở trang đăng nhập để đăng nhập 1 lần.
- **Agent**: `claude -p` + **Playwright MCP** (`@playwright/mcp`, gắn vào Chrome Flow qua CDP). Playwright thao tác được bên trong iframe sandbox của Tool Flow (Claude in Chrome thì không), chạy ngầm không hỏi quyền, sống sót khi API khởi động lại (tự nối lại nhật ký + kết quả).

1. Chọn công cụ + điền thông tin + ảnh (Tool review cần ảnh bao bì + ảnh người review; thiếu thì agent tự tạo ảnh trên Flow) → xác nhận (tốn tín dụng Flow, ~35–50 phút, mỗi lần 1 job).
2. Agent mở thẳng link Tool (cấu hình trong `FLOW_TOOLS` / `settings.flow.toolUrls`), chạy đủ các bước của Tool, tải clip vào thư mục job, soát lời thoại (`taki-video-stt`, faster-whisper), hậu kỳ bằng `taki-video-finish` (ffmpeg + Pillow vì ffmpeg máy không có libass).
3. Hệ thống tự kiểm file (ffprobe), đăng ký video, Review (thương hiệu TAKI: Jev + Kiểm duyệt MKT) → hộp **Duyệt**; thông báo macOS khi xong/lỗi.
4. Duyệt → đăng **bản nháp** lên kênh đã chọn (hiện connector sandbox; bản thật: TikTok inbox draft, Facebook video chưa công khai).

Quyền của agent chỉ gồm công cụ trình duyệt Playwright (Chrome Flow), đọc/ghi file trong thư mục job + ảnh tải lên, và các lệnh `ffmpeg`, `ffprobe`, `taki-flow-save` (lưu clip từ trang Tool — nút tải của Tool bị Chrome chặn), `taki-video-finish`, `taki-video-stt`, `cp/mv/ls/mkdir/unzip/stat`. Không đăng nhập hộ, không nhập mật khẩu, không mua tín dụng. Kênh "khác/khách hàng" không nạp DNA TAKI.

## Video AI chạy trên máy (không tốn tín dụng Flow)

Cài một lần: `pnpm video-ai:install` (bootstrap tự gọi; ~3 GB, khóa phiên bản theo commit; mã nguồn tải về `services/video-ai/`, không lên Git). Trang **Sản xuất video** có thêm 2 công cụ bên cạnh Google Flow + thẻ **Công cụ video AI trên máy**:

| Repo | Dùng cho | Ghi chú |
|---|---|---|
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT) | **Video tự động**: Claude CLI viết lời đọc + từ khóa cảnh → ghép cảnh (clip video Flow đã làm, clip/ảnh của Sếp, hoặc kho Pexels/Pixabay miễn phí) + giọng Việt + phụ đề Be Vietnam Pro + nhạc nền → Review → Duyệt | Chạy qua CLI với kịch bản của mình nên không gọi LLM nào khác; khóa Pexels/Pixabay nhập trên giao diện, chỉ lưu trong `config.toml` trên máy |
| [LivePortrait](https://github.com/KlingAIResearch/LivePortrait) (MIT) | **Ảnh chân dung cử động** theo video biểu cảm mẫu (12 mẫu có sẵn hoặc video của Sếp), có thể lồng giọng → thư viện video | TAKI thay dò mặt InsightFace (mô hình chỉ cho nghiên cứu phi thương mại) bằng **MediaPipe** (Apache-2.0) — bản vá ở `services/video-ai-patches/liveportrait`. Trên M2 ~1 phút cho mỗi giây clip |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT) | Soát lời thoại video Flow, **tạo phụ đề .srt** từ video/âm thanh | `tools/video/stt.py`, giải mã âm thanh bằng ffmpeg (tránh lỗi tương thích PyAV) |
| [fish-speech](https://github.com/fishaudio/fish-speech) | — **không cài** | Bản S2-Pro (4B) cần GPU/RAM lớn; giấy phép Fish Audio cấm dùng thương mại (kể cả nội bộ) nếu không mua license → dùng **Edge TTS** (giọng Hoài My / Nam Minh) |

Mỗi lần chỉ chạy 1 job video trên máy (khóa hàng đợi `video-ai`, máy 8 GB RAM). Ngân Nguyệt có công cụ `tao_video_tu_dong`, `anh_cu_dong`, `long_tieng`, `trang_thai_video_ai`. Các lệnh video của agent Flow (`taki-video-finish`, `taki-video-stt`, `taki-flow-save`) được tạo trong `data/bin` trỏ về chính repo này.

## Jev làm gì trong hệ thống

Jev trả lời câu hỏi có kiểu (Có/Không, Chọn một, Chấm điểm) kèm xác suất. **Code giữ chính sách**: ngưỡng → hành động nằm trong `packages/jev/src/questions.ts` (`decideChat`, `decideGuard`…).

| Chỗ dùng | Câu hỏi Jev | Code quyết định |
|---|---|---|
| Mỗi tin nhắn khách (1 request, 9 câu) | ý định, nhiệt độ lead, đòi gặp người, khiếu nại, mặc cả, chèn lệnh, opt-out, nguồn biết đến, sản phẩm | chuyển sales khi lead nóng, chuyển người khi khiếu nại/mặc cả, trả lời an toàn khi chèn lệnh, ngừng nhắn khi opt-out, ghi attribution |
| RAG | độ hữu ích từng đoạn tri thức + đủ thông tin chưa | chỉ đoạn đủ tốt mới tới Claude; thiếu thì chuyển người, không đoán |
| Guardrail trước khi gửi | cam kết kết quả, dữ kiện không có nguồn, lộ nội bộ, trả lời đúng câu hỏi, giọng điệu | chặn và chuyển người (sau lớp kiểm giá tất định) |
| Review Agent | đúng chân dung CEO/SME, hook, giá trị cụ thể, giọng, CTA, hứa hẹn tài chính, rủi ro chính sách QC | pass / sửa / chặn / escalate theo rubric có phiên bản |
| Quét bài | phân loại bình luận, độ khớp bài–mục tiêu | thành phần `intent` và `fit` của điểm bài → đề xuất chạy ads |
| Feedback loop | phân loại lý do CEO từ chối | gom thành bài học / đề xuất thay đổi |

Nhật ký mọi phán đoán (câu trả lời, xác suất, quyết định, độ trễ, chi phí) ở trang **Jev · System One**.

## Kiến trúc (theo đặc tả)

```
apps/api          REST /v1 + SSE realtime + webhook có chữ ký (/hooks/:platform)
apps/web          Giao diện CEO (13 màn hình)
apps/mcp-server   MCP Server (key có quyền, xem trước + xác nhận cho lệnh ghi)
packages/contracts   Zod schema: hợp đồng giữa các agent
packages/jev         Lớp phán đoán Jev + heuristic dự phòng + nhật ký
packages/llm-gateway Nơi DUY NHẤT gọi Claude: Claude CLI (tài khoản) / API / sandbox, model theo tầng & theo agent, trần token, chi phí
packages/orchestrator Hàng đợi, scheduler, máy trạng thái task, Agent Runtime, Review, ads, đăng bài, học
packages/rule-engine  Rule tất định: minData, cooldown, budgetGuard, dry-run (có test thuộc tính)
packages/scoring      Điểm bài tất định, lý do sinh từ số liệu
packages/chat-engine  Máy trạng thái hội thoại, RAG, guardrail, chuyển người, follow-up
packages/connectors   Interface chung + connector sandbox + Telegram + chữ ký webhook
packages/agents       Định nghĩa agent, prompt, danh mục & mức tự chủ mặc định
packages/db           Schema (mọi bảng có biz_id), outbox, audit log
evals/                Bộ tình huống chuẩn + runner
```

## Khác biệt so với đặc tả (có chủ đích, để chạy được ngay trên máy)

- **CSDL**: SQLite tích hợp trong Node thay PostgreSQL + pgvector; schema giữ nguyên tên bảng/cột để chuyển sang Postgres. RAG đang dùng tìm kiếm từ khóa + Jev chấm lại thay cho vector.
- **Hàng đợi**: lưu trong DB (retry lũy thừa, idempotency, khóa theo đối tượng, dead-letter) thay Redis/BullMQ; cùng interface `enqueue/startWorkers`.
- **Đăng nhập**: chưa có (M0). Server chỉ nghe `127.0.0.1`. Không mở ra Internet trước khi có đăng nhập + 2FA.
- **Connector nền tảng**: sandbox. Connector thật cần duyệt ứng dụng Meta/TikTok/Google/Zalo — nên nộp hồ sơ ngay.

## Việc cần Sếp làm

1. Chốt các mục ⚠️ trong DNA (định vị, bộ số công bố, giá các khóa đang "liên hệ", Autovis/Remin/Diaflow, đối thủ). Sửa trong skill `taki-dna` rồi bấm Đồng bộ, hoặc sửa trực tiếp ở **Mục tiêu & DNA**.
2. Vào **Kho tri thức** → thêm lịch khai giảng thật (bot không tự đưa ngày khi chưa có).
3. Giữ máy đăng nhập Claude Code (`claude` → `/login`). Chọn model trong **Cài đặt → Model Claude** hoặc từng agent ở **Agent & Tác vụ**.
4. Chuẩn bị tài khoản & quyền API: Meta Business, TikTok for Business, Google Ads developer token, Pancake, Zalo OA.

## ZL-CRM (Zalo nhiều nick) chạy kèm trên local

- Mã nguồn: `services/zl-crm` (clone từ github.com/nguyentatkiem/ZL-CRM, nhánh `feat/public-api-conversation-account`).
- `pnpm dev` tự chạy thêm ZL-CRM: backend http://localhost:3000, giao diện http://localhost:5174 (log ở `services/zl-crm/data/`).
- Không cần Docker: dùng PostgreSQL local (database `zalocrm`, user `zlcrm`), Redis ở chế độ in-memory. Chưa cài MinIO nên gửi/nhận **ảnh/video** trong ZL-CRM chưa hoạt động; tin chữ hoạt động bình thường.
- Cấu hình + tài khoản quản trị ZL-CRM: `services/zl-crm/backend/.env` (`BOOTSTRAP_ADMIN_PHONE` / `BOOTSTRAP_ADMIN_PASSWORD`, đổi mật khẩu sau khi đăng nhập).
- Khi đổi schema ZL-CRM: `cd services/zl-crm/backend && npx prisma db push`.
- Agentic AI nối ZL-CRM qua Public API key (Trung tâm tích hợp › ZL-CRM) → trang **Follow-up Zalo**.
