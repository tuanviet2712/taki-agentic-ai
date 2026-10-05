import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, byId, insert, ownerProfile, q, setAppSetting, update, type Row } from "@dotaka/db";
import { AppError, sha256 } from "@dotaka/shared";
import { routes } from "../http.ts";

/** Ảnh đại diện: ảnh nhỏ dạng data URL (web tự thu về 256px trước khi gửi). */
const AVATAR = z.string().max(400_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Ảnh đại diện phải là PNG/JPEG/WebP");
/** Tên / chức danh / cách gọi đi vào system prompt của trợ lý → 1 dòng, bỏ xuống dòng & dấu nháy (chống chèn "Quy tắc: …"). */
export const oneLine = (s: string) => s.replace(/[\r\n\t\v\f\p{Zl}\p{Zp}"'`“”‘’]+/gu, " ").replace(/\s+/g, " ").trim();
const line = (max: number, min = 0, msg?: string) => z.string().max(max * 2).transform(oneLine).pipe(z.string().min(min, msg).max(max));
const ProfilePatch = z.object({
  name: line(80),
  title: line(80),
  email: z.union([z.literal(""), z.string().trim().email("Email chưa đúng").max(120)]),
  phone: z.string().trim().max(20).regex(/^[0-9+ .()-]*$/, "Số điện thoại chỉ gồm chữ số"),
  addressAs: line(30, 1, "Cần cách gọi (vd: Sếp, Anh, Chị)"),
  avatar: AVATAR.nullable(),
}).partial();

/** Phiên bản ảnh đại diện (đổi ảnh → đổi số) để web gắn ?v= và trình duyệt cache được. */
const avatarVersion = (avatar: string | null) => (avatar ? sha256(avatar).slice(0, 12) : null);

/** Hồ sơ gọn cho /v1/system (web gọi lại rất thường): không kèm ảnh, email, SĐT. */
export function publicProfile() {
  const p = ownerProfile();
  return { name: p.name, title: p.title, addressAs: p.addressAs, hasAvatar: Boolean(p.avatar), avatarVersion: avatarVersion(p.avatar) };
}

const ROLES = ["owner", "buyer", "sales", "viewer"] as const;
const UserBody = z.object({
  name: z.string().trim().min(1, "Cần tên").max(80),
  email: z.string().trim().email("Email chưa đúng").max(120),
  role: z.enum(ROLES),
  status: z.enum(["active", "disabled"]).optional(),
});

/** Tài khoản của tôi (dùng chung mọi doanh nghiệp) + người dùng & phân quyền của từng doanh nghiệp. */
export function accountRoutes(app: FastifyInstance) {
  const r = routes(app);

  r.get("/v1/account", () => ownerProfile());
  // Ảnh đại diện dạng tệp ảnh (thẻ <img src="/v1/account/avatar?v=…">) — tránh nhét data URL vào /v1/system.
  app.get("/v1/account/avatar", async (req, reply) => {
    const avatar = ownerProfile().avatar;
    const m = avatar?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!avatar || !m) return reply.status(404).send({ code: "NOT_FOUND", message: "Chưa có ảnh đại diện" });
    const etag = `"${avatarVersion(avatar)}"`;
    reply.header("cache-control", "private, max-age=300").header("etag", etag);
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return reply.type(m[1]).header("x-content-type-options", "nosniff").send(Buffer.from(m[2], "base64"));
  });
  r.put("/v1/account", ({ bizId, body, actor }) => {
    const p = ProfilePatch.parse(body);
    const next = { ...ownerProfile(), ...p };
    setAppSetting("profile", next);
    audit(bizId, actor, "account.profile_changed", { type: "account", id: "owner" }, { changed: Object.keys(p).filter((k) => k !== "avatar").concat("avatar" in p ? ["avatar"] : []) });
    return ownerProfile();
  });

  r.get("/v1/users", ({ bizId }) => q.all("SELECT id, name, email, role, status, last_active_at FROM user_account WHERE biz_id = ? ORDER BY created_at", bizId));
  r.post("/v1/users", ({ bizId, body, actor }) => {
    const u = UserBody.parse(body);
    if (q.get("SELECT id FROM user_account WHERE biz_id = ? AND lower(email) = lower(?)", bizId, u.email)) throw new AppError("CONFLICT", "Email này đã có trong danh sách", 409);
    const row = insert("user_account", { biz_id: bizId, name: u.name, email: u.email, role: u.role, status: u.status ?? "active" });
    audit(bizId, actor, "user.added", { type: "user", id: row.id }, { role: u.role });
    return row;
  });
  r.put("/v1/users/:id", ({ bizId, params, body, actor }) => {
    const cur = byId<Row>("user_account", params.id);
    if (!cur || cur.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy người dùng", 404);
    const p = UserBody.partial().parse(body);
    if (p.email && q.get("SELECT id FROM user_account WHERE biz_id = ? AND lower(email) = lower(?) AND id != ?", bizId, p.email, cur.id)) throw new AppError("CONFLICT", "Email này đã có trong danh sách", 409);
    if (isActiveOwner(cur) && ((p.role && p.role !== "owner") || p.status === "disabled") && lastOwner(bizId, cur.id)) throw new AppError("VALIDATION", "Cần giữ ít nhất 1 Chủ sở hữu", 400);
    update("user_account", cur.id, p);
    audit(bizId, actor, "user.updated", { type: "user", id: cur.id }, { changed: Object.keys(p) });
    return byId("user_account", cur.id);
  });
  r.del("/v1/users/:id", ({ bizId, params, actor }) => {
    const cur = byId<Row>("user_account", params.id);
    if (!cur || cur.biz_id !== bizId) throw new AppError("NOT_FOUND", "Không thấy người dùng", 404);
    if (isActiveOwner(cur) && lastOwner(bizId, cur.id)) throw new AppError("VALIDATION", "Cần giữ ít nhất 1 Chủ sở hữu", 400);
    q.run("DELETE FROM user_account WHERE id = ?", cur.id);
    audit(bizId, actor, "user.removed", { type: "user", id: cur.id }, { role: cur.role });
    return { ok: true };
  });
}

/** Chỉ chặn khi thay đổi làm mất Chủ sở hữu ĐANG HOẠT ĐỘNG cuối cùng — xoá/hạ quyền chủ đã khoá không làm giảm số đó. */
const isActiveOwner = (u: Row) => u.role === "owner" && (u.status ?? "active") === "active";
function lastOwner(bizId: string, exceptId: string): boolean {
  return !q.scalar<number>("SELECT COUNT(*) FROM user_account WHERE biz_id = ? AND role = 'owner' AND status = 'active' AND id != ?", bizId, exceptId);
}
