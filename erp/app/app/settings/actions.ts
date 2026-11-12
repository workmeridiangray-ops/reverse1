"use server";
import { randomBytes } from "node:crypto";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError, AccessDenied } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { sha256, newToken } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/session";
import { queueEmail } from "@/lib/email";
import { assertEntitled, planChangeInvoice, cancelSubscription, resumeSubscription } from "@/lib/billing";
import { env } from "@/lib/env";
import { ALL_PERMS } from "@/lib/perms";
import { assertPublicUrl } from "@/lib/webhooks";
import { parseMoney } from "@/lib/money";

// ---------- business ----------
export async function saveBusinessAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("settings.manage", form, async (ctx, db) => {
    const f = formObj(form);
    if (f.legal_name.length < 2) throw new UserError("Enter the legal name.", { legal_name: "Required" });
    if (f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase())) throw new UserError("That GSTIN is not in the valid 15-character format.", { gstin: "Invalid GSTIN" });
    await db.query("update tenants set name=$2, legal_name=$3, gstin=$4, pan=$5, address=$6, phone=$7, branding=$8 where id=$1", [ctx.tenant.id, f.name || f.legal_name, f.legal_name, f.gstin?.toUpperCase() || null, f.pan?.toUpperCase() || null, f.address || null, f.phone || null, JSON.stringify({ footer: f.footer ?? "" })]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "settings.business_updated", entityType: "tenant", entityId: ctx.tenant.id });
    return { ok: true, message: "Business details saved." };
  });
}
export async function markSetupAction(step: string): Promise<ActionResult> {
  return tenantAction("settings.manage", null, async (ctx, db) => {
    await db.query("update tenants set setup = setup || jsonb_build_object($2::text, true) where id=$1", [ctx.tenant.id, step]); return { ok: true };
  }, { allowReadOnly: true });
}

// ---------- team ----------
export async function inviteAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("users.manage", form, async (ctx, db) => {
    const f = formObj(form); const email = (f.email ?? "").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new UserError("Enter a valid email address.", { email: "Invalid email" });
    const role = (await db.query("select * from roles where id=$1 and tenant_id=$2", [f.role_id, ctx.tenant.id])).rows[0];
    if (!role) throw new UserError("Choose a role.", { role_id: "Required" });
    if (role.key === "customer") throw new UserError("Customer portal access is invited from the customer’s record.");
    for (const p of role.permissions) if (!ctx.perms.has(p)) throw new AccessDenied("You can’t grant a role that has permissions you don’t hold yourself.");
    await assertEntitled(db, ctx.tenant.id, "users");
    if ((await db.query("select 1 from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and lower(u.email)=$2 and m.status='active'", [ctx.tenant.id, email])).rowCount) throw new UserError("That person is already a member.", { email: "Already a member" });
    await db.query("update invitations set status='revoked' where tenant_id=$1 and lower(email)=$2 and status='pending'", [ctx.tenant.id, email]);
    const branches = (form.getAll("branch_ids") as string[]).filter(Boolean);
    const tok = newToken();
    await db.query("insert into invitations(tenant_id,email,role_id,branch_ids,token_hash,invited_by,expires_at) values ($1,$2,$3,$4,$5,$6, now() + interval '7 days')", [ctx.tenant.id, email, role.id, branches.length ? branches : null, sha256(tok), ctx.user.id]);
    await queueEmail(db, { to: email, tenantId: ctx.tenant.id, subject: `${ctx.user.name} invited you to ${ctx.tenant.name} on Ledgerline`, text: `You were invited as ${role.name}.\nAccept within 7 days: ${env.appUrl}/invite/${tok}` });
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "invitation.sent", entityType: "invitation", detail: { email, role: role.key } });
    return { ok: true, message: `Invitation sent to ${email}.` };
  });
}
export async function revokeInviteAction(id: string): Promise<ActionResult> {
  return tenantAction("users.manage", null, async (ctx, db) => {
    const r = await db.query("update invitations set status='revoked' where id=$1 and tenant_id=$2 and status='pending'", [id, ctx.tenant.id]);
    if (!r.rowCount) throw new UserError("That invitation is no longer pending.");
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "invitation.revoked", entityType: "invitation", entityId: id });
    return { ok: true, message: "Invitation withdrawn. The link no longer works." };
  });
}
async function ownerCount(db: any, tenantId: string, excludeMembership: string) {
  return Number((await db.query("select count(*) c from memberships m join roles r on r.id=m.role_id where m.tenant_id=$1 and m.status='active' and r.key='owner' and m.id <> $2", [tenantId, excludeMembership])).rows[0].c);
}
export async function changeMemberAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("users.manage", form, async (ctx, db) => {
    const f = formObj(form);
    const m = (await db.query("select m.*, r.key from memberships m join roles r on r.id=m.role_id where m.id=$1 and m.tenant_id=$2", [id, ctx.tenant.id])).rows[0];
    if (!m) throw new UserError("Member not found");
    const role = (await db.query("select * from roles where id=$1 and tenant_id=$2", [f.role_id, ctx.tenant.id])).rows[0]; if (!role) throw new UserError("Choose a role.");
    for (const p of role.permissions) if (!ctx.perms.has(p)) throw new AccessDenied("You can’t assign permissions you don’t hold yourself.");
    if (m.key === "owner" && role.key !== "owner" && (await ownerCount(db, ctx.tenant.id, id)) === 0) throw new UserError("A company needs at least one owner.");
    const branches = (form.getAll("branch_ids") as string[]).filter(Boolean);
    await db.query("update memberships set role_id=$2, branch_ids=$3 where id=$1", [id, role.id, branches.length ? branches : null]);
    await revokeUserSessions(db, m.user_id, ctx.tenant.id);   // permissions changed: force a fresh session
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "member.role_changed", entityType: "membership", entityId: id, detail: { role: role.key, branches: branches.length || "all" } });
    return { ok: true, message: "Access updated. Their active sessions were ended so the change applies immediately." };
  });
}
export async function setMemberStatusAction(id: string, status: "active" | "suspended" | "removed"): Promise<ActionResult> {
  return tenantAction("users.manage", null, async (ctx, db) => {
    const m = (await db.query("select m.*, r.key from memberships m join roles r on r.id=m.role_id where m.id=$1 and m.tenant_id=$2", [id, ctx.tenant.id])).rows[0];
    if (!m) throw new UserError("Member not found");
    if (m.user_id === ctx.user.id) throw new UserError("You can’t change your own access.");
    if (status !== "active" && m.key === "owner" && (await ownerCount(db, ctx.tenant.id, id)) === 0) throw new UserError("A company needs at least one active owner.");
    if (status === "active") await assertEntitled(db, ctx.tenant.id, "users");
    await db.query("update memberships set status=$2 where id=$1", [id, status]);
    if (status !== "active") {
      await revokeUserSessions(db, m.user_id, ctx.tenant.id);
      await db.query("update approval_requests set delegated_to=null where tenant_id=$1 and delegated_to=$2 and status='pending'", [ctx.tenant.id, m.user_id]);
      await db.query("update employees set status='exited', exit_on=coalesce(exit_on,current_date) where tenant_id=$1 and user_id=$2 and $3='removed'", [ctx.tenant.id, m.user_id, status]);
    }
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: `member.${status}`, entityType: "membership", entityId: id });
    return { ok: true, message: status === "active" ? "Access restored." : "Access removed and their sessions ended. Pending delegations to them were cleared." };
  });
}

// ---------- roles ----------
export async function saveRoleAction(id: string | null, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("roles.manage", form, async (ctx, db) => {
    const f = formObj(form); const perms = (form.getAll("perm") as string[]).filter((p) => ALL_PERMS.includes(p));
    if ((f.name ?? "").length < 2) throw new UserError("Name the role.", { name: "Required" });
    for (const p of perms) if (!ctx.perms.has(p)) throw new AccessDenied(`You can’t grant “${p}” because you don’t hold it.`);
    if (id) {
      const r = (await db.query("select * from roles where id=$1 and tenant_id=$2", [id, ctx.tenant.id])).rows[0]; if (!r) throw new UserError("Role not found"); if (r.is_system) throw new UserError("Built-in roles can’t be edited. Create a custom role instead.");
      await db.query("update roles set name=$2, permissions=$3 where id=$1", [id, f.name, perms]);
      const users = (await db.query("select user_id from memberships where role_id=$1", [id])).rows; for (const u of users) await revokeUserSessions(db, u.user_id, ctx.tenant.id);
    } else {
      const key = "custom_" + randomBytes(3).toString("hex");
      await db.query("insert into roles(tenant_id,key,name,permissions) values ($1,$2,$3,$4)", [ctx.tenant.id, key, f.name, perms]);
    }
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: id ? "role.updated" : "role.created", entityType: "role", entityId: id ?? undefined, detail: { name: f.name, permissions: perms.length } });
    return { ok: true, message: "Role saved." + (id ? " Members with this role were signed out so changes apply." : "") };
  });
}
export async function deleteRoleAction(id: string): Promise<ActionResult> {
  return tenantAction("roles.manage", null, async (ctx, db) => {
    const r = (await db.query("select * from roles where id=$1 and tenant_id=$2", [id, ctx.tenant.id])).rows[0]; if (!r || r.is_system) throw new UserError("Only custom roles can be deleted.");
    if ((await db.query("select 1 from memberships where role_id=$1", [id])).rowCount || (await db.query("select 1 from invitations where role_id=$1 and status='pending'", [id])).rowCount) throw new UserError("This role is still assigned to someone. Move them to another role first.");
    await db.query("delete from roles where id=$1", [id]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "role.deleted", entityType: "role", entityId: id });
    return { ok: true, message: "Role deleted." };
  });
}

// ---------- config studio ----------
export async function addRuleAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("config.manage", form, async (ctx, db) => {
    const f = formObj(form); let min: number; try { min = f.min_amount === "0" ? 0 : parseMoney(f.min_amount, "Threshold"); } catch (e: any) { throw new UserError(e.message, { min_amount: e.message }); }
    if (!ALL_PERMS.includes(f.permission)) throw new UserError("Choose an approver permission.", { permission: "Required" });
    // unavailable approver check: someone other than the requester pool must hold it
    const holders = Number((await db.query("select count(*) c from memberships m join roles r on r.id=m.role_id where m.tenant_id=$1 and m.status='active' and $2 = any(r.permissions)", [ctx.tenant.id, f.permission])).rows[0].c);
    if (holders < 2) throw new UserError("At least two active users must hold that permission, otherwise requesters who hold it could not be approved by anyone else. Invite another approver first.", { permission: "Not enough approvers" });
    const dup = (await db.query("select 1 from approval_rules where tenant_id=$1 and entity_type=$2 and status='active' and min_amount_paise=$3", [ctx.tenant.id, f.entity_type, min])).rowCount; if (dup) throw new UserError("A rule with this type and threshold already exists.");
    await db.query("insert into approval_rules(tenant_id,entity_type,min_amount_paise,approver_permission) values ($1,$2,$3,$4)", [ctx.tenant.id, f.entity_type, min, f.permission]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "approval_rule.added", detail: { type: f.entity_type, min } });
    return { ok: true, message: "Rule published. It applies to new submissions; requests already pending keep the routing they were submitted with." };
  });
}
export async function retireRuleAction(id: string): Promise<ActionResult> {
  return tenantAction("config.manage", null, async (ctx, db) => { await db.query("update approval_rules set status='retired' where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "approval_rule.retired", entityId: id }); return { ok: true, message: "Rule retired for new submissions." }; });
}
export async function addCustomFieldAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("config.manage", form, async (ctx, db) => {
    const f = formObj(form); if (!/^[a-z][a-z0-9_]{1,30}$/.test(f.key ?? "")) throw new UserError("Key: lowercase letters, numbers, underscores (e.g. region_code).", { key: "Invalid key" });
    if (!f.label) throw new UserError("Enter a label.", { label: "Required" });
    await db.query("insert into custom_fields(tenant_id,entity,key,label,kind) values ($1,$2,$3,$4,$5)", [ctx.tenant.id, f.entity, f.key, f.label, f.kind]);
    return { ok: true, message: "Custom field added. Existing records keep their data; the field appears on forms." };
  });
}
export async function retireFieldAction(id: string): Promise<ActionResult> {
  return tenantAction("config.manage", null, async (ctx, db) => { await db.query("update custom_fields set status='retired' where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); return { ok: true, message: "Field hidden; stored values are kept." }; });
}
export async function numberingAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("config.manage", form, async (ctx, db) => {
    for (const [k, v] of Object.entries(formObj(form))) if (k.startsWith("pfx_")) {
      if (!/^[A-Z0-9]{1,8}$/.test(v)) throw new UserError(`Prefix for ${k.slice(4)} must be 1–8 capital letters or digits.`, { [k]: "Invalid prefix" });
      await db.query("update number_sequences set prefix=$3 where tenant_id=$1 and key=$2", [ctx.tenant.id, k.slice(4), v]);
    }
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "numbering.updated" });
    return { ok: true, message: "Prefixes updated for new documents. Existing numbers are unchanged." };
  });
}

// ---------- integrations ----------
export async function createApiKeyAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("settings.manage", form, async (ctx, db) => {
    const name = formObj(form).name; if (!name) throw new UserError("Name the key.", { name: "Required" });
    const key = "llk_" + randomBytes(24).toString("base64url");
    await db.query("insert into api_keys(tenant_id,name,prefix,key_hash,created_by) values ($1,$2,$3,$4,$5)", [ctx.tenant.id, name, key.slice(0, 10), sha256(key), ctx.user.id]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "api_key.created", detail: { name } });
    return { ok: true, message: `Copy this key now — it is shown once and stored only as a hash:\n${key}` };
  });
}
export async function revokeApiKeyAction(id: string): Promise<ActionResult> {
  return tenantAction("settings.manage", null, async (ctx, db) => { await db.query("update api_keys set revoked_at=now() where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "api_key.revoked", entityId: id }); return { ok: true, message: "Key revoked immediately." }; });
}
export async function createWebhookAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("settings.manage", form, async (ctx, db) => {
    const f = formObj(form);
    try { await assertPublicUrl(f.url); } catch (e: any) { throw new UserError(e.message, { url: e.message }); }
    const secret = "whsec_" + randomBytes(20).toString("hex");
    await db.query("insert into webhook_endpoints(tenant_id,url,secret) values ($1,$2,$3)", [ctx.tenant.id, f.url, secret]);
    return { ok: true, message: `Endpoint added. Signing secret (shown once): ${secret}` };
  });
}
export async function toggleWebhookAction(id: string, active: boolean): Promise<ActionResult> {
  return tenantAction("settings.manage", null, async (ctx, db) => { await db.query("update webhook_endpoints set active=$3 where id=$1 and tenant_id=$2", [id, ctx.tenant.id, active]); return { ok: true }; });
}
export async function retryDeliveryAction(id: string): Promise<ActionResult> {
  return tenantAction("settings.manage", null, async (ctx, db) => {
    const { enqueue } = await import("@/lib/jobs");
    const d = (await db.query("select * from webhook_deliveries where id=$1 and tenant_id=$2 and status='failed'", [id, ctx.tenant.id])).rows[0]; if (!d) throw new UserError("Only failed deliveries can be retried.");
    await db.query("update webhook_deliveries set status='pending' where id=$1", [id]);
    await enqueue(db, "webhook_delivery", { id }, { tenantId: ctx.tenant.id, dedupeKey: `wh:${id}:retry:${Date.now()}` });
    return { ok: true, message: "Queued for retry." };
  });
}

// ---------- billing ----------
export async function choosePlanAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("billing.manage", form, async (ctx, db) => {
    const f = formObj(form); if (!["monthly", "yearly"].includes(f.interval)) throw new UserError("Choose monthly or yearly billing.");
    const r = await planChangeInvoice(db, ctx.tenant.id, f.plan, f.interval as any, f.coupon || undefined);
    if (r.scheduled) return { ok: true, message: `Change scheduled for the end of your current period (${new Date(r.effective).toDateString()}). Nothing to pay now.` };
    return { ok: true, redirectTo: `/app/settings/billing/checkout/${r.invoice.id}` };
  }, { allowReadOnly: true });
}
export async function cancelSubAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("billing.manage", form, async (ctx, db) => {
    const reason = formObj(form).reason ?? ""; if (reason.length < 3) throw new UserError("Tell us why (helps us improve).", { reason: "Required" });
    const until = await cancelSubscription(db, ctx.tenant.id, ctx.user.id, reason);
    return { ok: true, message: `Cancellation scheduled. You keep full access until ${new Date(until).toDateString()}; export your data any time under Data & closure.` };
  }, { allowReadOnly: true });
}
export async function resumeSubAction(): Promise<ActionResult> {
  return tenantAction("billing.manage", null, async (ctx, db) => { await resumeSubscription(db, ctx.tenant.id, ctx.user.id); return { ok: true, message: "Subscription will continue." }; }, { allowReadOnly: true });
}

// ---------- support access & closure ----------
export async function decideSupportAccessAction(id: string, approve: boolean, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("settings.manage", form, async (ctx, db) => {
    const hours = Math.min(72, Math.max(1, Number(formObj(form).hours) || 4));
    const r = await db.query("update support_access set status=$3, decided_by=$4, expires_at=case when $3='approved' then now() + ($5 || ' hours')::interval end where id=$1 and tenant_id=$2 and status='requested'", [id, ctx.tenant.id, approve ? "approved" : "denied", ctx.user.id, String(hours)]);
    if (!r.rowCount) throw new UserError("This request was already decided.");
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: approve ? "support_access.approved" : "support_access.denied", entityId: id, detail: { hours } });
    return { ok: true, message: approve ? `Read-only support access granted for ${hours} hour(s).` : "Request denied." };
  });
}
export async function revokeSupportAccessAction(id: string): Promise<ActionResult> {
  return tenantAction("settings.manage", null, async (ctx, db) => { await db.query("update support_access set status='revoked', expires_at=now() where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "support_access.revoked", entityId: id }); return { ok: true, message: "Support access ended." }; });
}
export async function requestClosureAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("data.export", form, async (ctx, db) => {
    const f = formObj(form); if (f.confirm !== ctx.tenant.name) throw new UserError("Type the company name exactly to confirm.", { confirm: "Does not match" });
    if (!ctx.perms.has("billing.manage")) throw new AccessDenied();
    await db.query("insert into closure_requests(tenant_id,requested_by,reason) values ($1,$2,$3)", [ctx.tenant.id, ctx.user.id, f.reason || null]);
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "tenant.closure_requested", reason: f.reason });
    return { ok: true, message: "Closure requested. Platform staff will confirm after your final export; the company stays read-only-safe until then." };
  }, { allowReadOnly: true });
}
