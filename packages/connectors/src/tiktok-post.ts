import { closeSync, openSync, readSync, statSync } from "node:fs";
import { sleep } from "@dotaka/shared";
import { ConnectorError } from "./errors.ts";
import type { Connector } from "./index.ts";

/**
 * TikTok Content Posting API (open.tiktokapis.com/v2) — gửi video vào HỘP THƯ nháp của creator, hoặc đăng công khai (Direct Post).
 * Token = OAuth Login Kit (scope user.info.basic, video.upload, video.publish, video.list). Access token sống 24 giờ:
 * `getToken` luôn trả token còn hạn (bên gọi tự gia hạn bằng refresh_token).
 *  - Tải video bằng FILE_UPLOAD (chunk PUT từ tệp trên máy): không cần địa chỉ công khai / xác minh tên miền.
 *  - Bản nháp (inbox/video/init): chỉ cần scope video.upload, dùng được với app CHƯA được TikTok duyệt.
 *  - Đăng công khai (video/init): CHỈ khi Sếp đánh dấu app "đã được TikTok duyệt" (opts.audited). App chưa duyệt chỉ đăng được
 *    ở chế độ riêng tư — hệ thống KHÔNG đăng riêng tư âm thầm: không audited → NeedsBrowser (Chrome / bản nháp).
 *  - Chống đăng trùng: publish_id lưu qua onPending ngay sau khi tải xong → lần thử lại chỉ hỏi trạng thái.
 *  - Số liệu: chỉ khi biết id video (số); không bịa số 0.
 */
const TTO = "https://open.tiktokapis.com/v2";
const TIMEOUT = 25_000;
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const notSent = (e: unknown) => { const c = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code; return Boolean(c && NOT_SENT.has(c)); };

/** Lỗi TikTok Content Posting API theo error.code → loại lỗi + lời nhắn. */
export function tiktokError(code: string, message: string): ConnectorError {
  const M: Record<string, [ConnectorError["kind"], string]> = {
    access_token_invalid: ["AuthError", "TikTok: phiên đăng nhập hết hạn — bấm Kết nối lại TikTok"],
    scope_not_authorized: ["AuthError", "TikTok: thiếu quyền (video.upload / video.publish) — kết nối lại và tick đủ quyền"],
    scope_permission_missed: ["AuthError", "TikTok: thiếu quyền — kết nối lại và tick đủ quyền"],
    unaudited_client_can_only_post_to_private_accounts: ["PolicyRejected", "TikTok: app chưa được TikTok duyệt nên chỉ đăng được khi tài khoản để Riêng tư — dùng bản nháp hoặc đăng qua Chrome"],
    privacy_level_option_mismatch: ["InvalidRequest", "TikTok: chế độ riêng tư không hợp lệ với tài khoản này"],
    url_ownership_unverified: ["PolicyRejected", "TikTok: tên miền chứa video chưa được xác minh trong app TikTok"],
    spam_risk_too_many_posts: ["RateLimited", "TikTok: đã đăng quá nhiều video hôm nay — để mai đăng tiếp"],
    spam_risk_user_banned_from_posting: ["PolicyRejected", "TikTok: tài khoản đang bị hạn chế đăng bài"],
    spam_risk_too_many_pending_share: ["RateLimited", "TikTok: còn quá nhiều video đang chờ trong hộp thư — đăng/xoá bớt rồi thử lại"],
    reached_active_user_cap: ["AuthError", "TikTok: app đã chạm giới hạn người dùng — cần app khác hoặc chờ TikTok duyệt"],
    rate_limit_exceeded: ["RateLimited", "TikTok: gọi quá nhanh, hệ thống thử lại sau"],
    file_format_check_failed: ["InvalidRequest", "TikTok: định dạng video không hợp lệ (MP4/WebM/MOV)"],
    duration_check_failed: ["InvalidRequest", "TikTok: thời lượng video vượt giới hạn của tài khoản"],
    frame_rate_check_failed: ["InvalidRequest", "TikTok: tốc độ khung hình video không hợp lệ"],
    picture_size_check_failed: ["InvalidRequest", "TikTok: kích thước video/ảnh không hợp lệ"],
  };
  const hit = M[code];
  return hit ? new ConnectorError(hit[0], hit[1]) : new ConnectorError("InvalidRequest", `TikTok: ${message || code}`);
}

async function ttoRaw(token: string, path: string, body: unknown = {}): Promise<{ data: any; text: string }> {
  let res: Response;
  try {
    res = await fetch(`${TTO}/${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw Object.assign(new ConnectorError("Transient", `TikTok: không kết nối được (${e instanceof Error ? e.message : e})`), notSent(e) ? { requestNotSent: true } : { outcomeUnknown: true });
  }
  const text = await res.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { /* non-JSON */ }
  if (res.status >= 500) throw new ConnectorError("Transient", `TikTok: lỗi máy chủ ${res.status}`);
  const code = j?.error?.code;
  if ((code && code !== "ok") || !res.ok) throw tiktokError(code ?? (res.status === 401 ? "access_token_invalid" : res.status === 429 ? "rate_limit_exceeded" : `http_${res.status}`), j?.error?.message ?? "");
  return { data: j.data ?? {}, text };
}

async function ttUpload(token: string, initPath: string, extra: Record<string, unknown>, videoPath: string): Promise<string> {
  const size = statSync(videoPath).size;
  const MB = 1024 * 1024;
  const chunk = size <= 64 * MB ? size : 10 * MB;
  const count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
  const { data: init } = await ttoRaw(token, initPath, { ...extra, source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count } });
  if (!init.upload_url || !init.publish_id) throw new ConnectorError("InvalidRequest", "TikTok: không nhận được địa chỉ tải video");
  const fd = openSync(videoPath, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? size - 1 : start + chunk - 1;
      const buf = Buffer.alloc(end - start + 1);
      readSync(fd, buf, 0, buf.length, start);
      let res: Response;
      try {
        res = await fetch(init.upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(buf.length) }, body: buf, signal: AbortSignal.timeout(10 * 60_000) });
      } catch (e) {
        // Mất kết nối giữa lúc tải: không biết TikTok đã nhận hay chưa → Sếp kiểm tra TikTok Studio trước khi đăng lại.
        throw Object.assign(new ConnectorError("InvalidRequest", `TikTok: mất kết nối khi tải video (${e instanceof Error ? e.message : e}) — kiểm tra TikTok Studio xem đã có video chưa trước khi đăng lại`), { outcomeUnknown: true });
      }
      if (!res.ok) throw new ConnectorError("Transient", `TikTok: tải video lỗi ${res.status}`);
    }
  } finally {
    closeSync(fd);
  }
  return String(init.publish_id);
}

/** Hỏi trạng thái publish; ID video là số 64-bit nên lấy bằng regex từ chữ gốc (JSON.parse làm tròn sai). */
async function ttStatus(token: string, publishId: string) {
  const { data, text } = await ttoRaw(token, "post/publish/status/fetch/", { publish_id: publishId });
  const vid = text.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/)?.[1];
  return { status: String(data.status ?? ""), failReason: data.fail_reason as string | undefined, videoId: vid };
}

export async function tiktokPostTest(c: { access_token: string }) {
  let res: Response;
  try {
    res = await fetch(`${TTO}/user/info/?fields=open_id,display_name`, { headers: { authorization: `Bearer ${c.access_token}` }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new ConnectorError("Transient", `TikTok: không kết nối được (${e instanceof Error ? e.message : e})`);
  }
  const r: any = await res.json().catch(() => ({}));
  if (r?.error?.code && r.error.code !== "ok") throw tiktokError(r.error.code, r.error.message);
  if (!res.ok) throw tiktokError(res.status === 401 ? "access_token_invalid" : `http_${res.status}`, "");
  const u = r.data?.user ?? {};
  return { openId: String(u.open_id ?? "tiktok"), name: String(u.display_name ?? "TikTok") };
}

export const PUBLIC_PRIVACY = "PUBLIC_TO_EVERYONE";
export function tiktokPostConnector(getToken: () => Promise<string>, opts: { audited?: boolean; pollMs?: number; maxPolls?: number } = {}): Connector {
  const pollMs = opts.pollMs ?? 5000;
  const maxPolls = opts.maxPolls ?? 60;
  return {
    platform: "tiktok", mode: "live", limits: { requestsPerMinute: 6, concurrency: 1 },
    async health() {
      const u = await tiktokPostTest({ access_token: await getToken() });
      return { ok: true, detail: `TikTok ${u.name}` };
    },
    async publishPost(spec) {
      if (!opts.audited) throw new ConnectorError("NeedsBrowser", "TikTok: app chưa được đánh dấu 'đã được TikTok duyệt' nên không đăng công khai qua API (bản đăng sẽ ở chế độ riêng tư) — đăng công khai qua Chrome, hoặc dùng bản nháp");
      const token = await getToken();
      let publishId = (spec.resume as { publishId?: string } | undefined)?.publishId;
      let note: string | undefined;
      if (!publishId) {
        if (!spec.media?.mime.startsWith("video/")) throw new ConnectorError("InvalidRequest", "TikTok chỉ đăng video — bài này chưa có video (làm video ở Video Flow trước)");
        const { data: info } = await ttoRaw(token, "post/publish/creator_info/query/");
        const options: string[] = info.privacy_level_options ?? ["SELF_ONLY"];
        const privacy = [PUBLIC_PRIVACY, "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].find((x) => options.includes(x)) ?? options[0];
        if (privacy !== PUBLIC_PRIVACY) note = `Đăng ở chế độ ${privacy === "SELF_ONLY" ? "RIÊNG TƯ (chỉ mình Sếp thấy)" : privacy} — TikTok không cho đăng công khai với tài khoản/app này. Mở TikTok chuyển sang công khai nếu muốn.`;
        publishId = await ttUpload(token, "post/publish/video/init/", {
          post_info: { title: spec.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true },
        }, spec.media.path);
        spec.onPending?.({ publishId, ...(note ? { note } : {}) });
      } else note = (spec.resume as { note?: string } | undefined)?.note;
      for (let i = 0; i < maxPolls; i++) {
        await sleep(pollMs);
        let st: Awaited<ReturnType<typeof ttStatus>>;
        try { st = await ttStatus(token, publishId); } catch (e) {
          if (e instanceof ConnectorError && e.kind === "Transient") continue; // lỗi tạm khi hỏi trạng thái → hỏi lại
          throw e;
        }
        if (st.status === "PUBLISH_COMPLETE") return { externalId: st.videoId ?? publishId, permalink: st.videoId ? `https://www.tiktok.com/video/${st.videoId}` : "https://www.tiktok.com/tiktokstudio/content", ...(note ? { note } : {}) };
        if (st.status === "SEND_TO_USER_INBOX") return { externalId: publishId, permalink: "https://www.tiktok.com/tiktokstudio/content", note: note ?? "Video nằm trong hộp thư TikTok của Sếp — mở TikTok để đăng." };
        if (st.status === "FAILED") throw tiktokError(st.failReason ?? "", `video bị từ chối: ${st.failReason ?? "không rõ"}`);
      }
      // publish_id đã lưu: hỏi lại sau, KHÔNG tải / đăng lại.
      throw Object.assign(new ConnectorError("Transient", "TikTok xử lý video quá lâu — hệ thống sẽ kiểm tra lại (không đăng lại)"), { resumable: true });
    },
    async verifyPost() {
      return true; // trạng thái PUBLISH_COMPLETE đã được TikTok xác nhận ở publishPost
    },
    async uploadDraft(spec) {
      // Gửi vào hộp thư TikTok của creator (chưa đăng): mở app TikTok → thông báo → chỉnh & đăng. Chỉ cần scope video.upload.
      const publishId = await ttUpload(await getToken(), "post/publish/inbox/video/init/", {}, spec.videoPath);
      return { externalId: publishId, draftUrl: "https://www.tiktok.com/tiktokstudio/content" };
    },
    async fetchPostMetrics(post) {
      // Chỉ bài có id video thật (số). Bài đăng qua hộp thư / Chrome không có id → NotFound (không ghi số 0 giả vào điểm bài).
      if (!/^\d{10,}$/.test(post.externalId)) throw new ConnectorError("NotFound", "TikTok: bài này chưa có mã video công khai — không đo được số liệu");
      const { data } = await ttoRaw(await getToken(), "video/query/?fields=id,view_count,like_count,comment_count,share_count", { filters: { video_ids: [post.externalId] } });
      const v = data.videos?.[0];
      if (!v) throw new ConnectorError("NotFound", "TikTok: không thấy video này (đã xoá hoặc không thuộc tài khoản)");
      return { reach: Number(v.view_count ?? 0), reactions: Number(v.like_count ?? 0), comments: Number(v.comment_count ?? 0), shares: Number(v.share_count ?? 0), saves: 0 };
    },
  };
}
