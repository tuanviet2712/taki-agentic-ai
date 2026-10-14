# TAKI Agentic AI — Cài đặt trên máy Windows mới

Gói này chứa **toàn bộ hệ thống**: mã nguồn, cơ sở dữ liệu (`data/dotaka.db`), dữ liệu ZL-CRM (kèm PostgreSQL đóng gói sẵn),
kho kiến thức/brain, nội dung đã tạo, skill, cấu hình `.env`, và mã + trọng số của công cụ video AI (LivePortrait, MoneyPrinterTurbo, Remotion).

## Yêu cầu máy

- Windows 10/11 64-bit, còn trống **≥ 15 GB**, **có Internet** trong lúc cài (tải PyTorch, thư viện Node, Python).
- Quyền Admin (để `winget` cài Node.js, Git, uv, ffmpeg, Chrome). Máy cần có `winget` (Windows 11 có sẵn; Windows 10: cài "App Installer" từ Microsoft Store).

## Cài đặt (3 bước)

1. **Giải nén** file zip vào thư mục **ngắn, không dấu**, ví dụ `C:\TAKI` (tránh lỗi "đường dẫn quá dài" của Windows).
2. Nhấp đúp **`INSTALL.cmd`** — tự cài Node.js 24, Git, uv, ffmpeg, pnpm, Claude Code CLI, Codex CLI, dựng lại thư viện + môi trường Python video AI,
   chép skill vào `~\.claude`, kiểm tra PostgreSQL của ZL-CRM và chạy kiểm tra mã nguồn. Mất 15–40 phút lần đầu. Chạy lại bao nhiêu lần cũng an toàn.
3. Mở cửa sổ mới, gõ `claude`, đăng nhập tài khoản Claude (lệnh `/login`) — đăng nhập **không thể** mang theo trong file zip.

Chạy hệ thống: nhấp đúp **`start-taki.cmd`** (hoặc lối tắt "TAKI Agentic AI" trên Desktop) → mở http://localhost:5173

| Dịch vụ | Địa chỉ |
| --- | --- |
| Giao diện | http://localhost:5173 |
| API | http://127.0.0.1:8787 |
| ZL-CRM (Zalo) | http://localhost:5174 (backend 3000, PostgreSQL riêng cổng 5433) |

## Trong gói có gì / không có gì

**Có (dùng ngay, không mất):** toàn bộ mã nguồn và lịch sử git; cơ sở dữ liệu chính (doanh nghiệp, DNA, kênh, bài, tác vụ, agent, skill…);
`data/brain`, `data/creative`, `data/uploads`, `data/publishing`; ZL-CRM (code + dữ liệu PostgreSQL + file đính kèm); `.env` (có khóa mã hóa token — **giữ file zip kín**);
trọng số LivePortrait/MediaPipe; cấu hình `config.toml` của MoneyPrinterTurbo; PostgreSQL 17 đóng gói sẵn (không cần cài PostgreSQL).

**Không có vì không chuyển máy được (cài đặt tự dựng lại hoặc cần làm 1 lần):**

| Mục | Lý do | Cách có lại |
| --- | --- | --- |
| `node_modules` gốc, Python `.venv` | Gắn cứng đường dẫn máy cũ | `INSTALL.cmd` tự dựng lại theo lockfile (đúng phiên bản) |
| Đăng nhập Claude | Nằm ngoài dự án (`~\.claude`), gắn với tài khoản | Gõ `claude` → `/login` |
| Đăng nhập tài khoản Codex (`data/ai-accounts`) | Token đăng nhập, gắn với máy | Đăng nhập lại trong trang Kết nối AI |
| Hồ sơ Chrome Flow (`data/flow-chrome`, ~4.7 GB) | Cookie Chrome được mã hóa theo máy/người dùng Windows | Trang "Sản xuất video Flow": chọn hồ sơ Chrome, đăng nhập Google Flow 1 lần |
| Ảnh chụp QA, nhật ký chạy (`*.log`) | Chỉ là rác tạm | — |

## Khi có lỗi

- Xem **`install.log`** trong thư mục cài. Nguyên nhân thường gặp nhất là mất Internet giữa chừng → chạy lại `INSTALL.cmd`.
- Chỉ muốn bản nhẹ không có video AI tại máy: `powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -SkipVideoAi`.
- Cổng 5173/8787/3000/5174/5433 đang bị chương trình khác dùng → tắt chương trình đó.
- SmartScreen cảnh báo khi chạy `.cmd`: chọn *More info → Run anyway*.
- Lấy lại bản mới nhất sau khi sửa code: chạy `python scripts\package-release.py` trên máy gốc.
