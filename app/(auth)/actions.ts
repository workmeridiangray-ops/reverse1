"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { pubAction, str } from "@/lib/server/action";
import * as acc from "@/lib/server/accounts";
import { createSession, destroySession, getAuth } from "@/lib/server/auth";
import { plat, UserError } from "@/lib/server/db";
import { sendEmail } from "@/lib/server/mail";
import { auditPlat } from "@/lib/server/audit";
import { changePassword } from "@/lib/server/accounts";
import { newTotpSecret, totpValid } from "@/lib/server/crypto";

const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") ? n : "/app");

export const signupAction = pubAction(async (fd) => {
  if (str(fd, "website")) return { redirect: "/login" };   // honeypot
  if (str(fd, "terms") !== "on") throw new UserError("Please accept the terms to continue.");
  const r = await acc.signup({ name: str(fd, "name"), email: str(fd, "email"), password: String(fd.get("password") ?? ""), company: str(fd, "company") });
  await createSession(r.userId, true);
  return { redirect: "/app/onboarding" };
});
export const loginAction = pubAction(async (fd) => {
  const r = await acc.login(str(fd, "email"), String(fd.get("password") ?? ""));
  await createSession(r.userId, !r.needsMfa);
  return { redirect: r.needsMfa ? "/login/2fa?next=" + encodeURIComponent(safeNext(str(fd, "next"))) : safeNext(str(fd, "next")) };
});
export const mfaAction = pubAction(async (fd) => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Your sign-in expired. Start again.", "expired");
  await acc.checkMfa(a.user.id, str(fd, "code"));
  await plat("update sessions set mfa_ok=true where id=$1", [a.session.id]);
  return { redirect: safeNext(str(fd, "next")) };
});
export const forgotAction = pubAction(async (fd) => { await acc.requestReset(str(fd, "email")); return "If that email has an account, a reset link is on its way. It expires in 1 hour."; });
export const resetAction = pubAction(async (fd) => {
  if (String(fd.get("password")) !== String(fd.get("confirm"))) throw new UserError("The two passwords do not match.");
  await acc.resetPassword(str(fd, "token"), String(fd.get("password") ?? "")); return { redirect: "/login?reset=1" };
});
export const resendVerifyAction = pubAction(async () => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in first.");
  if (a.user.verified) return "Your email is already verified.";
  await acc.sendVerification(a.user.id, a.user.email); return "Verification email sent.";
});
export const acceptInviteAction = pubAction(async (fd) => {
  const a = await getAuth(); const uid = a && !("expired" in a) ? a.user.id : null;
  const r = await acc.acceptInvitation(str(fd, "token"), uid, { name: str(fd, "name"), password: String(fd.get("password") ?? "") });
  if (!uid) await createSession(r.userId, true);
  else await plat("update sessions set company_id=$2 where id=$1", [(a as any).session.id, r.companyId]);
  const role = (await plat("select role from memberships where user_id=$1 and company_id=$2", [r.userId, r.companyId])).rows[0].role;
  if (uid) await plat("update sessions set company_id=$2 where user_id=$1 and revoked_at is null and id=$3", [r.userId, r.companyId, (a as any).session.id]);
  else await plat("update sessions set company_id=$2 where user_id=$1 and revoked_at is null", [r.userId, r.companyId]);
  return { redirect: role === "customer" || role === "supplier" ? "/portal" : "/app" };
});
export async function logoutAction() { await destroySession(); redirect("/login?out=1"); }
export async function switchWorkspaceAction(fd: FormData) {
  const a = await getAuth(); if (!a || "expired" in a) redirect("/login");
  try { await acc.switchWorkspace(a.session.id, a.user.id, String(fd.get("company"))); } catch { redirect("/workspaces?error=1"); }
  const role = (await plat("select role from memberships where user_id=$1 and company_id=$2", [a.user.id, String(fd.get("company"))])).rows[0]?.role;
  redirect(role === "customer" || role === "supplier" ? "/portal" : "/app");
}
export const leadAction = pubAction(async (fd) => {
  if (str(fd, "website")) return "Thanks — we’ll be in touch.";   // honeypot: pretend success
  const kind = str(fd, "kind") as "demo" | "contact"; const email = str(fd, "email").toLowerCase();
  if (!["demo", "contact"].includes(kind)) throw new UserError("Invalid request.");
  acc.checkEmail(email);
  if (str(fd, "name").length < 2) throw new UserError("Enter your name.");
  if (kind === "contact" && str(fd, "message").length < 10) throw new UserError("Tell us a little more (at least 10 characters).");
  const recent = await plat("select count(*)::int n from leads where lower(email)=$1 and created_at > now()-interval '1 hour'", [email]);
  if (recent.rows[0].n >= 3) throw new UserError("You’ve sent several requests already. We’ll reply shortly.");
  await plat("insert into leads(kind,name,email,company,message) values ($1,$2,$3,$4,$5)", [kind, str(fd, "name"), email, str(fd, "company") || null, str(fd, "message").slice(0, 3000) || null]);
  const to = (await plat("select value from platform_settings where key='support_email'")).rows[0]?.value;
  if (to) await sendEmail(String(to), `New ${kind} request: ${str(fd, "name")}`, `${str(fd, "name")} <${email}> ${str(fd, "company")}\n\n${str(fd, "message")}`);
  await sendEmail(email, "We received your request", "Thanks for getting in touch. Our team will reply within one business day.");
  return kind === "demo" ? "Demo request received. We’ll email you within one business day." : "Message sent. We’ll reply within one business day.";
});
// ---- profile & security (signed-in, not tenant-bound) ----
export const changePasswordAction = pubAction(async (fd) => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in again.");
  if (String(fd.get("next")) !== String(fd.get("confirm"))) throw new UserError("The new passwords do not match.");
  await changePassword(a.user.id, String(fd.get("current")), String(fd.get("next"))); return "Password updated.";
});
export const updateProfileAction = pubAction(async (fd) => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in again.");
  if (str(fd, "name").length < 2) throw new UserError("Enter your name.");
  await plat("update users set name=$2, notif_prefs=$3 where id=$1", [a.user.id, str(fd, "name"), JSON.stringify({ email: fd.get("email_n") === "on", inapp: fd.get("inapp_n") === "on" })]);
  return "Profile saved.";
});
export const startTotpAction = pubAction(async () => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in again.");
  await plat("update users set totp_secret=$2, totp_enabled=false where id=$1", [a.user.id, newTotpSecret()]); return "Scan or enter the secret below, then confirm with a code.";
});
export const confirmTotpAction = pubAction(async (fd) => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in again.");
  const u = (await plat("select totp_secret from users where id=$1", [a.user.id])).rows[0];
  if (!u?.totp_secret || !totpValid(u.totp_secret, str(fd, "code"))) throw new UserError("That code is incorrect. Check your authenticator’s clock and try again.");
  await plat("update users set totp_enabled=true where id=$1", [a.user.id]); await plat("update sessions set mfa_ok=true where id=$1", [a.session.id]);
  await auditPlat({ userId: a.user.id }, "account.2fa_enabled"); return "Two-factor authentication is on.";
});
export const disableTotpAction = pubAction(async (fd) => {
  const a = await getAuth(); if (!a || "expired" in a) throw new UserError("Sign in again.");
  const u = (await plat("select totp_secret from users where id=$1", [a.user.id])).rows[0];
  if (!u?.totp_secret || !totpValid(u.totp_secret, str(fd, "code"))) throw new UserError("Enter a current code to turn off two-factor authentication.");
  await plat("update users set totp_enabled=false, totp_secret=null where id=$1", [a.user.id]); await auditPlat({ userId: a.user.id }, "account.2fa_disabled"); return "Two-factor authentication is off.";
});
export async function revokeSessionAction(fd: FormData) {
  const a = await getAuth(); if (!a || "expired" in a) redirect("/login");
  await plat("update sessions set revoked_at=now() where id=$1 and user_id=$2", [String(fd.get("id")), a.user.id]); redirect("/app/profile");
}
void cookies;
