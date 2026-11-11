"use server";
import { action, str } from "@/lib/server/action";
import { UserError, plat } from "@/lib/server/db";
import { audit, auditPlat } from "@/lib/server/audit";
import { actor } from "@/lib/server/svc/ctx";
import * as acc from "@/lib/server/accounts";
import { ROLES, type Role } from "@/lib/server/perms";
import { parseCsv } from "@/lib/server/csv";
import { seedSample } from "@/lib/server/sample";
import { assertWithin } from "@/lib/server/billing";
import { startCheckout, currentPlanVersions, confirmClientPayment, type Cycle } from "@/lib/server/billing";
import { requireCompany } from "@/lib/server/auth";
import { pubAction } from "@/lib/server/action";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/server/mail";

const need = (fd: FormData, k: string, l: string) => { const v = str(fd, k); if (!v) throw new UserError(`${l} is required.`); return v; };
export const loadSampleData = action("master.write", async ({ ctx, c }) => {
  if ((await c.query("select 1 from items limit 1")).rowCount) throw new UserError("Sample data can only be loaded into an empty workspace.");
  await seedSample(c, ctx.companyId, ctx.userId); await c.query("select 1");
  await plat("update companies set demo=true where id=$1", [ctx.companyId]); await audit(c, actor(ctx), "sample.load"); return { redirect: "/app?sample=1" };
});
export const clearDemoFlag = action("settings", async ({ ctx, c }) => { await plat("update companies set demo=false where id=$1", [ctx.companyId]); await audit(c, actor(ctx), "demo.acknowledged"); return "Demo marker removed. Delete sample records before go-live."; });
export const saveCompany = action("settings", async ({ fd, ctx, c }) => {
  await plat("update companies set name=$2, gstin=$3, address=$4, billing_email=$5, branding=$6 where id=$1", [ctx.companyId, need(fd, "name", "Company name"), str(fd, "gstin").toUpperCase() || null, str(fd, "address") || null, str(fd, "billing_email") || null, JSON.stringify({ tagline: str(fd, "tagline") })]);
  await audit(c, actor(ctx), "company.update"); return "Company details saved.";
});
export const inviteAction = action("admin.users", async ({ fd, ctx }) => {
  if (!ROLES.includes(str(fd, "role") as Role)) throw new UserError("Choose a role.");
  await acc.invite(ctx.companyId, ctx.userId, { email: str(fd, "email"), role: str(fd, "role") as Role, partyId: str(fd, "party") || null, plantIds: fd.getAll("plants").map(String).filter(Boolean) }); return "Invitation sent. It expires in 7 days.";
});
export const revokeInviteAction = action("admin.users", async ({ fd, ctx }) => { await acc.revokeInvitation(ctx.companyId, need(fd, "id", "Invitation"), ctx.userId); return "Invitation revoked — the link no longer works."; });
export const changeMemberAction = action("admin.users", async ({ fd, ctx }) => {
  const patch: any = {}; if (str(fd, "role")) patch.role = str(fd, "role"); if (str(fd, "active")) patch.active = str(fd, "active") === "1";
  await acc.changeMember(ctx.companyId, ctx.userId, need(fd, "id", "Member"), patch, str(fd, "reason")); return "Access updated. Their active sessions were ended.";
});
export const importAction = action("master.write", async ({ fd, ctx, c }) => {
  const kind = need(fd, "kind", "Import type"); const f = fd.get("file") as File | null;
  if (!f || !f.size) throw new UserError("Choose a CSV file."); if (f.size > 2_000_000) throw new UserError("File is larger than 2 MB."); if (!/\.csv$/i.test(f.name)) throw new UserError("Only .csv files are accepted.");
  const rows = parseCsv(await f.text()); const errors: { row: number; msg: string }[] = []; let ok = 0;
  const commit = str(fd, "commit") === "1";
  if (kind === "items") {
    await assertWithin(ctx.companyId, "items", Math.max(0, rows.length - 1));
    for (let i = 1; i < rows.length; i++) {
      const [code, name, k, uom, lot, lt, std] = rows[i]!;
      if (!code || !name) { errors.push({ row: i + 1, msg: "code and name are required" }); continue; }
      if (!["make", "buy", "subcontract"].includes(k ?? "")) { errors.push({ row: i + 1, msg: `type must be make, buy or subcontract (got "${k}")` }); continue; }
      if (!(await c.query("select 1 from uoms where code=$1", [uom])).rowCount) { errors.push({ row: i + 1, msg: `unknown unit "${uom}"` }); continue; }
      const lotN = Number(lot || 1), ltN = Number(lt || 0); if (!(lotN > 0) || !(ltN >= 0)) { errors.push({ row: i + 1, msg: "lot size must be > 0 and lead time >= 0" }); continue; }
      if (commit && !errors.length) await c.query("insert into items(company_id,code,name,kind,uom,lot_size,lead_time_days,std_cost_paise) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (company_id,code) do nothing", [ctx.companyId, code.toUpperCase(), name, k, uom, lotN, ltN, Math.round(Number(std || 0) * 100)]);
      ok++;
    }
  } else if (kind === "bom") {
    // columns: parent_code, component_code, qty_per, scrap_pct
    const byParent = new Map<string, string[][]>();
    for (let i = 1; i < rows.length; i++) { const r = rows[i]!; const p = byParent.get(r[0] ?? "") ?? []; p.push([String(i + 1), ...r]); byParent.set(r[0] ?? "", p); }
    for (const [parent, ls] of byParent) {
      const pi = (await c.query("select id from items where code=$1", [parent.toUpperCase()])).rows[0]; if (!pi) { errors.push({ row: Number(ls[0]![0]), msg: `unknown parent item ${parent}` }); continue; }
      let bomId: string | null = null;
      for (const l of ls) {
        const ci = (await c.query("select id from items where code=$1", [(l[2] ?? "").toUpperCase()])).rows[0]; const q = Number(l[3]);
        if (!ci) { errors.push({ row: Number(l[0]), msg: `unknown component ${l[2]}` }); continue; } if (!(q > 0)) { errors.push({ row: Number(l[0]), msg: "qty_per must be > 0" }); continue; }
        if (commit && !errors.length) {
          if (!bomId) bomId = (await c.query("insert into boms(company_id,item_id,version) values ($1,$2,(select coalesce(max(version),0)+1 from boms where item_id=$2)) returning id", [ctx.companyId, pi.id])).rows[0].id;
          try { await c.query("savepoint s"); await c.query("insert into bom_lines(company_id,bom_id,component_item_id,qty_per,scrap_pct) values ($1,$2,$3,$4,$5)", [ctx.companyId, bomId, ci.id, q, Number(l[4] || 0)]); } catch (e: any) { await c.query("rollback to savepoint s"); errors.push({ row: Number(l[0]), msg: e.message }); }
        }
        ok++;
      }
    }
  } else if (kind === "stock") {
    // columns: item_code, location_code, qty, unit_cost, batch
    const inv = await import("@/lib/server/svc/inventory");
    for (let i = 1; i < rows.length; i++) {
      const [ic, lc, q, uc, bc] = rows[i]!; const it = (await c.query("select id, tracking from items where code=$1", [(ic ?? "").toUpperCase()])).rows[0]; const lo = (await c.query("select id from locations where code=$1", [(lc ?? "").toUpperCase()])).rows[0];
      if (!it || !lo) { errors.push({ row: i + 1, msg: !it ? `unknown item ${ic}` : `unknown location ${lc}` }); continue; } if (!(Number(q) > 0)) { errors.push({ row: i + 1, msg: "qty must be > 0" }); continue; }
      if (it.tracking !== "none" && !bc) { errors.push({ row: i + 1, msg: "batch required for tracked item" }); continue; }
      if (commit && !errors.length) { let b: string | null = null; if (bc) b = (await c.query("insert into batches(company_id,item_id,code,source_ref) values ($1,$2,$3,'opening') on conflict (company_id,item_id,code) do update set code=excluded.code returning id", [ctx.companyId, it.id, bc])).rows[0].id; await inv.post(c, ctx, { itemId: it.id, batchId: b, locationId: lo.id, qty: Number(q), kind: "adjust", note: "Opening stock import", unitCostPaise: Math.round(Number(uc || 0) * 100), key: `import:${f.name}:${i}` }); }
      ok++;
    }
  } else throw new UserError("Unknown import type.");
  if (commit && errors.length) throw new UserError(`Nothing was imported: ${errors.length} row(s) have errors. First: row ${errors[0]!.row} — ${errors[0]!.msg}. Run a preview to see all.`);
  await c.query("insert into import_jobs(company_id,kind,status,rows_total,rows_ok,errors,created_by) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.companyId, kind, commit ? "committed" : "preview", rows.length - 1, ok, JSON.stringify(errors.slice(0, 200)), ctx.userId]);
  if (!commit) return errors.length ? `Preview: ${ok} valid, ${errors.length} with errors. ${errors.slice(0, 8).map((e) => `row ${e.row}: ${e.msg}`).join(" · ")}` : `Preview OK: ${ok} rows ready. Tick “commit” and upload again to import.`;
  await audit(c, actor(ctx), "import.commit", "import", kind, { ok }); return `Imported ${ok} rows.`;
});
export const supportTicketAction = action(null, async ({ fd, ctx }) => {
  if (need(fd, "subject", "Subject").length < 3 || need(fd, "body", "Details").length < 10) throw new UserError("Please add a few more details.");
  await plat("insert into support_tickets(company_id,user_id,subject,body) values ($1,$2,$3,$4)", [ctx.companyId, ctx.userId, str(fd, "subject"), str(fd, "body")]); return "Ticket raised. We’ll reply by email.";
});
export const grantSupportAction = action("admin.users", async ({ fd, ctx }) => {
  const id = need(fd, "id", "Request"); const hours = Math.min(24, Math.max(1, Number(str(fd, "hours") || 4)));
  const r = await plat("update support_access set status=$2, approved_by=$3, expires_at=case when $2='approved' then now()+($4||' hours')::interval end where id=$1 and company_id=$5 and status='requested' returning id", [id, str(fd, "decision") === "approve" ? "approved" : "denied", ctx.userId, String(hours), ctx.companyId]);
  if (!r.rowCount) throw new UserError("That request is no longer pending."); await auditPlat({ userId: ctx.userId, companyId: ctx.companyId }, "support_access." + str(fd, "decision"), "support_access", id); return "Recorded.";
});
export const markNotificationsRead = action(null, async ({ ctx }) => { await plat("update notifications set read_at=now() where user_id=$1 and read_at is null", [ctx.userId]); return "All marked as read."; });
// ---------- billing (owner) ----------
export const cancelSubscriptionAction = action("admin.billing", async ({ fd, ctx }) => {
  const resume = str(fd, "resume") === "1";
  await plat("update subscriptions set cancel_at_period_end=$2 where company_id=$1 and status='active'", [ctx.companyId, !resume]);
  await auditPlat({ userId: ctx.userId, companyId: ctx.companyId }, resume ? "billing.resume" : "billing.cancel", "subscription", undefined, {}, str(fd, "reason") || undefined);
  return resume ? "Cancellation withdrawn." : "Subscription will end at the period end. You can export your data until then and for 30 days after.";
}, { allowSuspended: true });
export const checkoutAction = action("admin.billing", async ({ fd, ctx }) => {
  const r = await startCheckout(ctx.companyId, need(fd, "version", "Plan"), (str(fd, "cycle") || "monthly") as Cycle, str(fd, "coupon") || undefined, ctx.userId);
  return { redirect: `/app/settings/billing/pay/${r.invoiceId}` };
}, { allowSuspended: true });
export const sandboxPayAction = pubAction(async (fd) => {
  const a = await requireCompany("admin.billing", { allowSuspended: true });
  if (process.env.ALLOW_SANDBOX_PAYMENTS !== "1") throw new UserError("Sandbox payments are disabled.");
  const inv = (await plat("select provider_ref from platform_invoices where id=$1 and company_id=$2 and status in ('pending','failed')", [need(fd, "id", "Invoice"), a.company.id])).rows[0]; if (!inv) throw new UserError("Invoice not payable.");
  const { hmacHex } = await import("@/lib/server/crypto"); const secret = process.env.SANDBOX_WEBHOOK_SECRET ?? "";
  if (str(fd, "outcome") === "fail") { const { settleInvoiceByOrder } = await import("@/lib/server/billing"); await settleInvoiceByOrder(inv.provider_ref, "sbx_fail", false); return { redirect: "/app/settings/billing?paid=0" }; }
  await confirmClientPayment(inv.provider_ref, "sbx_pay_" + Date.now(), hmacHex(secret, `${inv.provider_ref}|sbx_pay_${Date.now()}`)).catch(async () => { const { settleInvoiceByOrder } = await import("@/lib/server/billing"); await settleInvoiceByOrder(inv.provider_ref, "sbx_pay", true); });
  revalidatePath("/app", "layout"); return { redirect: "/app/settings/billing?paid=1" };
});
void currentPlanVersions; void sendEmail;
import { saveUpload } from "@/lib/server/files";
export const uploadDocument = action("master.write", async ({ fd, ctx, c }) => {
  const f = fd.get("file") as File | null; const entity = need(fd, "entity", "Record type"); const eid = need(fd, "entity_id", "Record");
  if (!["item", "shipment", "sales_order", "purchase_order", "work_order", "inspection"].includes(entity)) throw new UserError("Unsupported record type.");
  const t = { item: "items", shipment: "shipments", sales_order: "sales_orders", purchase_order: "purchase_orders", work_order: "work_orders", inspection: "inspections" }[entity]!;
  if (!(await c.query(`select 1 from ${t} where id=$1`, [eid])).rowCount) throw new UserError("That record was not found in this workspace.");
  const u = await saveUpload(f as File);
  await c.query("insert into documents(company_id,entity,entity_id,filename,mime,size_bytes,storage_key,sha256,shared_with_party,uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [ctx.companyId, entity, eid, u.name, u.mime, u.size, u.key, u.sha256, fd.get("share") === "on", ctx.userId]);
  await audit(c, actor(ctx), "document.upload", entity, eid, { name: u.name }); return "Uploaded.";
});
