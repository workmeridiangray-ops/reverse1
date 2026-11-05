"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { audit, queueEmail, tx, UserError } from "@/lib/server/db";
import { checkPasswordStrength, hashPassword, newToken, requireUser, sha256, verifyPassword } from "@/lib/server/auth";
import { type FormState, str, toState } from "@/lib/server/actions";

async function userAction(fn: (userId: string, sessionId: string, email: string, name: string, fd: FormData) => Promise<string>, fd: FormData): Promise<FormState> {
  try { const a = await requireUser(); return { ok: true, message: await fn(a.user.id, a.sessionId, a.user.email, a.user.name, fd) }; } catch (e) { return toState(e); }
}
export async function updateProfile(_p: FormState, fd: FormData) {
  return userAction(async (uid, _s, _e, _n, f) => {
    const name = z.string().trim().min(2, "Enter your name").max(120).parse(str(f, "name"));
    await tx({ userId: uid }, (db) => db.exec("UPDATE users SET name=$2, notify_email=$3 WHERE id=$1", [uid, name, str(f, "notify_email") === "on"]));
    return "Profile saved.";
  }, fd);
}
export async function changePassword(_p: FormState, fd: FormData) {
  return userAction(async (uid, sid, _e, _n, f) => {
    const cur = String(f.get("current") ?? ""), next = String(f.get("password") ?? "");
    checkPasswordStrength(next);
    await tx({ userId: uid }, async (db) => {
      const u = await db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [uid]);
      if (!(await verifyPassword(cur, u.password_hash))) throw new UserError("Your current password is incorrect.", "current");
      await db.exec("UPDATE users SET password_hash=$2 WHERE id=$1", [uid, await hashPassword(next)]);
      await db.exec("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id <> $2 AND revoked_at IS NULL", [uid, sid]);
      await audit(db, uid, null, "auth.password_changed", "user", uid);
    });
    return "Password changed. Other devices were signed out.";
  }, fd);
}
export async function revokeSession(_p: FormState, fd: FormData) {
  return userAction(async (uid, _s, _e, _n, f) => {
    const n = await tx({ userId: uid }, (db) => db.exec("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [z.string().uuid().parse(str(f, "session_id")), uid]));
    if (!n) throw new UserError("Session not found or already ended.");
    return "Session signed out.";
  }, fd);
}
export async function resendVerification(_p: FormState) {
  return userAction(async (uid, _s, email) => {
    const token = newToken();
    await tx({ userId: uid }, async (db) => {
      await db.exec("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES ($1,'verify',$2, now() + interval '3 days')", [uid, sha256(token)]);
      await queueEmail(db, null, email, "Verify your email", `Verify your email: ${process.env.APP_URL ?? "http://localhost:3000"}/verify?token=${token}`);
    });
    return "Verification email queued.";
  }, new FormData());
}
void redirect;
