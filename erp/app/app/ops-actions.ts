"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { audit } from "@/lib/audit";
import { revokeUserSessions } from "@/lib/auth/session";
import { postJournal, today } from "@/lib/erp/ledger";

const money = (v: string, k: string) => { try { return parseMoney(v); } catch (e: any) { throw new UserError(e.message, { [k]: e.message }); } };
const need = (v: string | undefined, k: string, l: string) => { if (!v) throw new UserError(`${l} is required.`, { [k]: "Required" }); return v; };

// ---- people ----
export async function addEmployeeAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("hr.manage", form, async (ctx, db) => {
    const f = formObj(form); need(f.code, "code", "Code"); need(f.name, "name", "Name");
    const sens = ctx.perms.has("hr.sensitive");
    const e = (await db.query("insert into employees(tenant_id,code,name,email,phone,designation,department_id,branch_id,joined_on,pii_pan,pii_bank_account) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
      [ctx.tenant.id, f.code, f.name, f.email || null, f.phone || null, f.designation || null, f.department_id || null, f.branch_id || null, f.joined_on || null, sens ? f.pan || null : null, sens ? f.bank || null : null])).rows[0].id;
    for (const t of ["Collect ID documents", "Create email account", "Assign laptop / assets", "Induction"]) await db.query("insert into checklist_items(tenant_id,employee_id,kind,title) values ($1,$2,'joining',$3)", [ctx.tenant.id, e, t]);
    return { ok: true, message: "Employee added with a joining checklist." };
  });
}
export async function tickChecklistAction(id: string): Promise<ActionResult> {
  return tenantAction("hr.manage", null, async (ctx, db) => { await db.query("update checklist_items set done_at=case when done_at is null then now() end where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); return { ok: true }; });
}
export async function exitEmployeeAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("hr.manage", form, async (ctx, db) => {
    const f = formObj(form); need(f.exit_on, "exit_on", "Last working day");
    const e = (await db.query("select * from employees where id=$1 and tenant_id=$2 for update", [id, ctx.tenant.id])).rows[0]; if (!e || e.status === "exited") throw new UserError("Employee not found or already exited.");
    // reassign work: open tasks go to the chosen colleague (or become unassigned), assets are flagged for return
    if (f.reassign_to) await db.query("update project_tasks set assignee_id=$3 where tenant_id=$1 and assignee_id=$2 and status <> 'done'", [ctx.tenant.id, id, f.reassign_to]); else await db.query("update project_tasks set assignee_id=null where tenant_id=$1 and assignee_id=$2 and status <> 'done'", [ctx.tenant.id, id]);
    const assets = (await db.query("select tag from assets where tenant_id=$1 and assigned_to=$2 and status <> 'disposed'", [ctx.tenant.id, id])).rows;
    for (const t of ["Final settlement review", "Revoke system access", ...assets.map((a: any) => `Return asset ${a.tag}`)]) await db.query("insert into checklist_items(tenant_id,employee_id,kind,title) values ($1,$2,$3,$4)", [ctx.tenant.id, id, t.startsWith("Return asset") ? "asset_return" : "exit", t]);
    await db.query("update employees set status='exited', exit_on=$2 where id=$1", [id, f.exit_on]);
    if (e.user_id) { await db.query("update memberships set status='removed' where tenant_id=$1 and user_id=$2", [ctx.tenant.id, e.user_id]); await revokeUserSessions(db, e.user_id, ctx.tenant.id); }
    await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "employee.exited", entityType: "employee", entityId: id, detail: { assetsToReturn: assets.length } });
    return { ok: true, message: `Exit recorded. Open tasks reassigned, ${assets.length} asset(s) on the return checklist${e.user_id ? ", system access revoked and sessions ended" : ""}.` };
  });
}
export async function requestLeaveAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("hr.view", form, async (ctx, db) => {
    const f = formObj(form); need(f.employee_id, "employee_id", "Employee"); if (!f.starts_on || !f.ends_on || f.ends_on < f.starts_on) throw new UserError("End date must be on or after the start date.", { ends_on: "Check dates" });
    if (!ctx.perms.has("hr.manage")) { const own = (await db.query("select 1 from employees where id=$1 and tenant_id=$2 and user_id=$3", [f.employee_id, ctx.tenant.id, ctx.user.id])).rowCount; if (!own) throw new UserError("You can only request leave for yourself."); }
    const clash = (await db.query("select 1 from leave_requests where tenant_id=$1 and employee_id=$2 and status in ('pending','approved') and daterange(starts_on, ends_on, '[]') && daterange($3::date, $4::date, '[]')", [ctx.tenant.id, f.employee_id, f.starts_on, f.ends_on])).rowCount;
    if (clash) throw new UserError("That overlaps an existing leave request.");
    await db.query("insert into leave_requests(tenant_id,employee_id,leave_type,starts_on,ends_on,reason) values ($1,$2,$3,$4,$5,$6)", [ctx.tenant.id, f.employee_id, f.leave_type || "casual", f.starts_on, f.ends_on, f.reason || null]);
    return { ok: true, message: "Leave requested." };
  });
}
export async function decideLeaveAction(id: string, approve: boolean, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("hr.manage", form, async (ctx, db) => {
    const reason = formObj(form).reason ?? ""; if (!approve && reason.length < 3) throw new UserError("A reason is required when rejecting.", { reason: "Required" });
    const r = await db.query("update leave_requests set status=$2, decided_by=$3, decision_reason=$4 where id=$1 and tenant_id=$5 and status='pending'", [id, approve ? "approved" : "rejected", ctx.user.id, reason || null, ctx.tenant.id]);
    if (!r.rowCount) throw new UserError("Already decided."); return { ok: true, message: approve ? "Approved." : "Rejected." };
  });
}
// ---- projects ----
export async function addProjectAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("projects.manage", form, async (ctx, db) => {
    const f = formObj(form); need(f.code, "code", "Code"); need(f.name, "name", "Name");
    const p = (await db.query("insert into projects(tenant_id,code,name,customer_id,budget_paise) values ($1,$2,$3,$4,$5) returning id", [ctx.tenant.id, f.code, f.name, f.customer_id || null, f.budget ? money(f.budget, "budget") : 0])).rows[0].id;
    return { ok: true, message: "Project created.", redirectTo: `/app/projects/${p}` };
  });
}
export async function addTaskAction(projectId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("projects.manage", form, async (ctx, db) => { const f = formObj(form); need(f.title, "title", "Title"); await db.query("insert into project_tasks(tenant_id,project_id,title,assignee_id,milestone) values ($1,$2,$3,$4,$5)", [ctx.tenant.id, projectId, f.title, f.assignee_id || null, f.milestone || null]); return { ok: true, message: "Task added." }; });
}
export async function setTaskStatusAction(id: string, status: string): Promise<ActionResult> {
  return tenantAction("projects.manage", null, async (ctx, db) => { if (!["open", "in_progress", "done"].includes(status)) throw new UserError("Bad status"); await db.query("update project_tasks set status=$3 where id=$1 and tenant_id=$2", [id, ctx.tenant.id, status]); return { ok: true }; });
}
export async function logTimeAction(projectId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("projects.view", form, async (ctx, db) => {
    const f = formObj(form); const mins = Math.round(Number(f.hours) * 60); if (!(mins > 0 && mins <= 24 * 60)) throw new UserError("Hours must be between 0 and 24.", { hours: "Invalid" });
    need(f.employee_id, "employee_id", "Employee");
    if (!ctx.perms.has("projects.manage")) { const own = (await db.query("select 1 from employees where id=$1 and tenant_id=$2 and user_id=$3", [f.employee_id, ctx.tenant.id, ctx.user.id])).rowCount; if (!own) throw new UserError("You can only log your own time."); }
    const pr = (await db.query("select status from projects where id=$1 and tenant_id=$2", [projectId, ctx.tenant.id])).rows[0]; if (!pr || pr.status === "closed") throw new UserError("This project is closed.");
    await db.query("insert into time_entries(tenant_id,project_id,employee_id,work_date,minutes,cost_rate_paise_per_hour,note) values ($1,$2,$3,$4,$5,$6,$7)", [ctx.tenant.id, projectId, f.employee_id, f.work_date || today(), mins, f.rate ? money(f.rate, "rate") : 0, f.note || null]);
    return { ok: true, message: "Time submitted for approval." };
  });
}
export async function decideTimeAction(id: string, approve: boolean): Promise<ActionResult> {
  return tenantAction("projects.manage", null, async (ctx, db) => { const r = await db.query("update time_entries set status=$3, decided_by=$4 where id=$1 and tenant_id=$2 and status='submitted'", [id, ctx.tenant.id, approve ? "approved" : "rejected", ctx.user.id]); if (!r.rowCount) throw new UserError("Already decided."); return { ok: true }; });
}
export async function addCostAction(projectId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("projects.manage", form, async (ctx, db) => { const f = formObj(form); need(f.description, "description", "Description"); await db.query("insert into project_costs(tenant_id,project_id,kind,description,amount_paise,cost_date) values ($1,$2,$3,$4,$5,$6)", [ctx.tenant.id, projectId, f.kind === "purchase" ? "purchase" : "expense", f.description, money(f.amount, "amount"), f.cost_date || today()]); return { ok: true, message: "Cost recorded." }; });
}
export async function closeProjectAction(id: string): Promise<ActionResult> {
  return tenantAction("projects.manage", null, async (ctx, db) => {
    const pend = Number((await db.query("select count(*) c from time_entries where project_id=$1 and status='submitted'", [id])).rows[0].c); if (pend) throw new UserError(`${pend} time entr${pend > 1 ? "ies are" : "y is"} awaiting approval. Decide them before closing.`);
    const open = Number((await db.query("select count(*) c from project_tasks where project_id=$1 and status <> 'done'", [id])).rows[0].c); if (open) throw new UserError(`${open} task(s) are still open.`);
    await db.query("update projects set status='closed' where id=$1 and tenant_id=$2", [id, ctx.tenant.id]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "project.closed", entityId: id }); return { ok: true, message: "Project closed." };
  });
}
// ---- assets ----
export async function addAssetAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("assets.manage", form, async (ctx, db) => { const f = formObj(form); need(f.tag, "tag", "Tag"); need(f.name, "name", "Name"); await db.query("insert into assets(tenant_id,tag,name,branch_id,assigned_to,location,warranty_until,next_service_on) values ($1,$2,$3,$4,$5,$6,$7,$8)", [ctx.tenant.id, f.tag, f.name, f.branch_id || null, f.assigned_to || null, f.location || null, f.warranty_until || null, f.next_service_on || null]); return { ok: true, message: "Asset registered." }; });
}
export async function transferAssetAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("assets.manage", form, async (ctx, db) => { const f = formObj(form); await db.query("update assets set location=coalesce(nullif($3,''),location), branch_id=coalesce(nullif($4,'')::uuid,branch_id), assigned_to=nullif($5,'')::uuid where id=$1 and tenant_id=$2 and status <> 'disposed'", [id, ctx.tenant.id, f.location ?? "", f.branch_id ?? "", f.assigned_to ?? ""]); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "asset.transferred", entityType: "asset", entityId: id }); return { ok: true, message: "Asset updated." }; });
}
export async function openTicketAction(assetId: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("assets.view", form, async (ctx, db) => {
    const f = formObj(form); need(f.issue, "issue", "Describe the problem");
    const n = (await db.query("select next_number($1,'asset_ticket') n", [ctx.tenant.id])).rows[0].n;
    await db.query("insert into asset_tickets(tenant_id,asset_id,number,issue) values ($1,$2,$3,$4)", [ctx.tenant.id, assetId, n, f.issue]);
    await db.query("update assets set status='under_repair' where id=$1 and tenant_id=$2 and status='in_service'", [assetId, ctx.tenant.id]);
    return { ok: true, message: `Ticket ${n} opened.` };
  });
}
export async function resolveTicketAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("assets.manage", form, async (ctx, db) => {
    const f = formObj(form); need(f.report, "report", "Service report"); const cost = f.cost ? money(f.cost, "cost") : 0;
    const t = (await db.query("select * from asset_tickets where id=$1 and tenant_id=$2 for update", [id, ctx.tenant.id])).rows[0]; if (!t || t.status === "resolved") throw new UserError("Ticket not found or already resolved.");
    await db.query("update asset_tickets set status='resolved', service_report=$2, cost_paise=$3, technician_id=nullif($4,'')::uuid, resolved_at=now() where id=$1", [id, f.report, cost, f.technician_id ?? ""]);
    await db.query("update assets set status='in_service' where id=$1 and status='under_repair'", [t.asset_id]);
    if (cost > 0) await postJournal(db, { tenantId: ctx.tenant.id, userId: ctx.user.id, date: today(), memo: `Maintenance ${t.number}`, sourceType: "asset_ticket", sourceId: id, lines: [{ account: "maintenance", debit: cost }, { account: "cash", credit: cost }] });
    return { ok: true, message: cost ? "Resolved; repair cost posted to Repairs & maintenance." : "Resolved." };
  });
}
export async function disposeAssetAction(id: string, step: "request" | "approve"): Promise<ActionResult> {
  return tenantAction(step === "approve" ? "finance.approve" : "assets.manage", null, async (ctx, db) => {
    const r = await db.query("update assets set status=$3 where id=$1 and tenant_id=$2 and status=$4", [id, ctx.tenant.id, step === "request" ? "disposal_pending" : "disposed", step === "request" ? "in_service" : "disposal_pending"]);
    if (!r.rowCount) throw new UserError("Not in the right state for that step."); await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: `asset.disposal_${step}`, entityId: id }); return { ok: true, message: step === "request" ? "Disposal requested; a finance approver must approve." : "Disposal approved." };
  });
}
