"use server";
import { z } from "zod";
import { audit, queueEmail, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { newToken, sha256 } from "@/lib/server/auth";
import { tenantLimits } from "@/lib/server/queries";
import { isRole, ROLES } from "@/lib/rules/permissions";

export const invite = mutation("users.manage", "invite", async (c, db, fd) => {
  const d = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email").max(200), role: z.enum(ROLES) }).parse({ email: str(fd, "email"), role: str(fd, "role") });
  const projects = fd.getAll("project_ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if ((d.role === "client" || d.role === "consultant") && projects.length === 0) throw new UserError("Choose at least one project for a client or consultant.", "project_ids");
  if (d.role === "owner" && c.role !== "owner") throw new UserError("Only an owner can invite another owner.");
  const lim = await tenantLimits(db, c.tenant.id);
  if (lim.users >= lim.max_users) throw new UserError(`Your ${lim.plan} plan allows ${lim.max_users} users (including pending invitations). Upgrade in Settings.`);
  if (await db.maybe("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE lower(u.email)=$1 AND m.status='active'", [d.email])) throw new UserError("That person is already a member.", "email");
  const valid = projects.length ? (await db.q<{ id: string }>("SELECT id FROM projects WHERE id = ANY($1::uuid[])", [projects])).map((r) => r.id) : [];
  await db.exec("UPDATE invitations SET revoked_at=now() WHERE lower(email)=$1 AND accepted_at IS NULL AND revoked_at IS NULL", [d.email]);
  const token = newToken();
  await db.exec("INSERT INTO invitations(tenant_id,email,role,project_ids,token_hash,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')", [c.tenant.id, d.email, d.role, valid, sha256(token), c.user.id]);
  await queueEmail(db, c.tenant.id, d.email, `${c.user.name} invited you to ${c.tenant.name}`, `Join ${c.tenant.name} on SiteLedger: ${process.env.APP_URL ?? "http://localhost:3000"}/invite/${token}\n\nThe link expires in 7 days.`);
  await audit(db, c.user.id, c.tenant.id, "invitation.sent", "invitation", undefined, { email: d.email, role: d.role });
  return `Invitation sent to ${d.email}. The link expires in 7 days.`;
});

export const revokeInvite = mutation("users.manage", "revokeInvite", async (c, db, fd) => {
  const n = await db.exec("UPDATE invitations SET revoked_at=now() WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL", [z.string().uuid().parse(str(fd, "invitation_id"))]);
  if (!n) throw new UserError("Invitation not found or already used.");
  await audit(db, c.user.id, c.tenant.id, "invitation.revoked", "invitation", str(fd, "invitation_id"));
  return "Invitation revoked; its link no longer works.";
});

async function lastOwnerGuard(db: import("@/lib/server/db").Db, membershipId: string) {
  const m = await db.one<{ role: string }>("SELECT role FROM memberships WHERE id=$1", [membershipId]);
  if (m.role === "owner") {
    const n = await db.one<{ n: number }>("SELECT count(*)::int n FROM memberships WHERE role='owner' AND status='active'");
    if (n.n <= 1) throw new UserError("A business must keep at least one active owner.");
  }
}

export const changeRole = mutation("users.manage", "changeRole", async (c, db, fd) => {
  const id = z.string().uuid().parse(str(fd, "membership_id")); const role = str(fd, "role");
  if (!isRole(role)) throw new UserError("Choose a role.");
  if (role !== "owner") await lastOwnerGuard(db, id);
  await db.exec("UPDATE memberships SET role=$2 WHERE id=$1", [id, role]);
  await audit(db, c.user.id, c.tenant.id, "membership.role_changed", "membership", id, { role });
  return "Role updated. It applies on the person's next request.";
});

export const setMemberStatus = mutation("users.manage", "setMemberStatus", async (c, db, fd) => {
  const id = z.string().uuid().parse(str(fd, "membership_id")); const suspend = str(fd, "status") === "suspended";
  if (suspend) await lastOwnerGuard(db, id);
  const m = await db.one<{ user_id: string }>("UPDATE memberships SET status=$2 WHERE id=$1 RETURNING user_id", [id, suspend ? "suspended" : "active"]);
  if (m.user_id === c.user.id) throw new UserError("You cannot suspend yourself.");
  await audit(db, c.user.id, c.tenant.id, suspend ? "membership.suspended" : "membership.reactivated", "membership", id);
  return suspend ? "Access suspended immediately." : "Access restored.";
});
