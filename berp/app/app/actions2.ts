"use server";
import { redirect } from "next/navigation";
import { act, must, num, str } from "@/lib/action";
import { parseInr } from "@/lib/rules/money";
import { validateImport, type ImportKind } from "@/lib/rules/csv";
import { requireCtx } from "@/lib/session";

// ---- credit notes
export async function createCreditNote(f: FormData) {
  const id = str(f, "invoice"); const back = `/app/invoices/${id}`;
  await act(back, back, "Credit note issued", async (sb) => {
    const lines = [...f.keys()].filter((k) => k.startsWith("q_")).map((k) => ({ invoice_line_id: k.slice(2), qty: Number(f.get(k)) })).filter((l) => l.qty > 0);
    if (!lines.length) throw new Error("Enter a quantity to credit");
    must(await sb.rpc("create_credit_note", { p_invoice: id, p_lines: lines, p_reason: str(f, "reason"), p_restock: f.get("restock") === "on" }));
  });
}

// ---- transfers
export async function createTransfer(f: FormData) {
  await act("/app/inventory", "/app/inventory", "Transfer sent", async (sb) => {
    const lines = [0, 1, 2].map((i) => ({ item_id: str(f, `ti_${i}`), qty: Number(str(f, `tq_${i}`)) })).filter((l) => l.item_id && l.qty > 0);
    if (!lines.length) throw new Error("Add at least one line with a quantity");
    must(await sb.rpc("create_transfer", { p_from: str(f, "from"), p_to: str(f, "to"), p_lines: lines }));
  });
}
export async function receiveTransfer(f: FormData) {
  await act("/app/inventory", "/app/inventory", "Transfer received", async (sb) => { must(await sb.rpc("receive_transfer", { p_transfer: str(f, "id") })); });
}

// ---- CSV import (all-or-nothing)
async function runImport(f: FormData, dry: boolean) {
  const kind = str(f, "kind") as ImportKind;
  if (!["customers", "suppliers", "items"].includes(kind)) redirect("/app/import?error=Unknown%20import%20type");
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/app/import?error=Choose%20a%20CSV%20file");
  if (file.size > 2_000_000) redirect("/app/import?error=File%20is%20larger%20than%202%20MB");
  await act("/app/import", "/app/import", dry ? "Validated" : "Imported", async (sb) => {
    await requireCtx();
    const { data: taxes } = await sb.from("tax_codes").select("id,code");
    const map = Object.fromEntries((taxes ?? []).map((t: any) => [String(t.code).toUpperCase(), t.id]));
    const res = validateImport(kind, await file.text(), map);
    if (res.errors.length) {
      const shown = res.errors.slice(0, 8).map((e) => `line ${e.line}: ${e.message}`).join(" · ");
      throw new Error(`${res.errors.length} problem(s), nothing imported. ${shown}${res.errors.length > 8 ? " …" : ""}`);
    }
    if (dry) return `/app/import?checked=${res.rows.length}`;
    const tenant = (await sb.rpc("current_tenant")).data;
    must(await sb.from(kind).insert(res.rows.map((r) => ({ ...r, tenant_id: tenant }))).select("id"));
    return `/app/import?done=${res.rows.length}&kind=${kind}`;
  });
}

export async function importCsv(f: FormData) { await runImport(f, false); }
export async function validateCsv(f: FormData) { await runImport(f, true); }

// ---- projects
export async function createProject(f: FormData) {
  await act("/app/projects", "/app/projects", "Project created", async (sb) => {
    const id = must(await sb.rpc("create_project", { p_name: str(f, "name"), p_customer: str(f, "customer") || null, p_budget: str(f, "budget") ? parseInr(str(f, "budget")) : 0 }));
    return `/app/projects/${id}`;
  });
}
export async function addMilestone(f: FormData) {
  const id = str(f, "project"); const back = `/app/projects/${id}`;
  await act(back, back, "Milestone added", async (sb) => { must(await sb.rpc("add_milestone", { p_project: id, p_name: str(f, "name"), p_amount: parseInr(str(f, "amount")) })); });
}
export async function logTime(f: FormData) {
  const id = str(f, "project"); const back = `/app/projects/${id}`;
  await act(back, back, "Time logged", async (sb) => { must(await sb.rpc("log_time", { p_project: id, p_date: str(f, "date"), p_hours: num(f, "hours"), p_rate: 0, p_note: str(f, "note") })); });
}
export async function logExpense(f: FormData) {
  const id = str(f, "project"); const back = `/app/projects/${id}`;
  await act(back, back, "Expense submitted", async (sb) => { must(await sb.rpc("log_expense", { p_project: id, p_date: str(f, "date"), p_amount: parseInr(str(f, "amount")), p_desc: str(f, "description") })); });
}
async function decideEntryAs(f: FormData, approve: boolean) {
  const back = `/app/projects/${str(f, "project")}`;
  await act(back, back, "Decision recorded", async (sb) => {
    must(await sb.rpc("decide_project_entry", { p_kind: str(f, "kind"), p_id: str(f, "id"), p_approve: approve, p_reason: str(f, "reason") || null, p_rate_paise: str(f, "rate") ? parseInr(str(f, "rate")) : null }));
  });
}
export async function approveEntry(f: FormData) { await decideEntryAs(f, true); }
export async function rejectEntry(f: FormData) { await decideEntryAs(f, false); }
export async function billMilestone(f: FormData) {
  const back = `/app/projects/${str(f, "project")}`;
  await act(back, back, "Milestone invoiced", async (sb) => {
    const inv = must(await sb.rpc("bill_milestone", { p_milestone: str(f, "id"), p_service_item: str(f, "item"), p_warehouse: str(f, "warehouse") }));
    return `/app/invoices/${inv}`;
  });
}
export async function closeProject(f: FormData) {
  const id = str(f, "project"); const back = `/app/projects/${id}`;
  await act(back, back, "Project closed", async (sb) => { must(await sb.rpc("close_project", { p_project: id })); });
}

// ---- people
export async function addEmployee(f: FormData) {
  await act("/app/people", "/app/people", "Employee added", async (sb) => {
    const tenant = (await sb.rpc("current_tenant")).data;
    must(await sb.from("employees").insert({ tenant_id: tenant, code: str(f, "code").toUpperCase(), full_name: str(f, "name"), job_title: str(f, "title"), email: str(f, "email") || null, phone: str(f, "phone") || null, branch_id: str(f, "branch") || null, joined_on: str(f, "joined") || new Date().toISOString().slice(0, 10) }).select("id"));
  });
}
export async function linkEmployee(f: FormData) {
  await act("/app/people", "/app/people", "Login linked", async (sb) => {
    const members = must(await sb.rpc("team")) as any[];
    const m = members.find((x) => String(x.email).toLowerCase() === str(f, "email").toLowerCase());
    if (!m) throw new Error("No workspace member has that email. Add them under Settings first.");
    must(await sb.from("employees").update({ user_id: m.user_id }).eq("id", str(f, "id")).select("id"));
  });
}
export async function requestLeave(f: FormData) {
  await act("/app/people", "/app/people", "Leave requested", async (sb) => { must(await sb.rpc("request_leave", { p_from: str(f, "from"), p_to: str(f, "to"), p_kind: str(f, "kind"), p_reason: str(f, "reason") })); });
}
async function decideLeaveAs(f: FormData, approve: boolean) {
  await act("/app/people", "/app/people", "Decision recorded", async (sb) => { must(await sb.rpc("decide_leave", { p_id: str(f, "id"), p_approve: approve, p_reason: str(f, "reason") || null })); });
}
export async function approveLeave(f: FormData) { await decideLeaveAs(f, true); }
export async function rejectLeave(f: FormData) { await decideLeaveAs(f, false); }
export async function offboard(f: FormData) {
  await act("/app/people", "/app/people", "Employee offboarded and access revoked", async (sb) => { must(await sb.rpc("offboard_employee", { p_employee: str(f, "id"), p_last_day: str(f, "day") })); });
}

// ---- assets
export async function registerAsset(f: FormData) {
  await act("/app/assets", "/app/assets", "Asset registered", async (sb) => {
    must(await sb.rpc("register_asset", { p_tag: str(f, "tag"), p_name: str(f, "name"), p_category: str(f, "category"), p_warehouse: str(f, "warehouse") || null,
      p_cost: str(f, "cost") ? parseInr(str(f, "cost")) : 0, p_warranty: str(f, "warranty") || null, p_service_days: str(f, "every") ? Number(str(f, "every")) : null }));
  });
}
export async function assignAsset(f: FormData) {
  await act("/app/assets", "/app/assets", "Assignment updated", async (sb) => { must(await sb.rpc("assign_asset", { p_asset: str(f, "id"), p_employee: str(f, "employee") || null })); });
}
export async function openWorkOrder(f: FormData) {
  await act("/app/assets", "/app/assets", "Work order opened", async (sb) => { must(await sb.rpc("open_work_order", { p_asset: str(f, "id"), p_kind: str(f, "kind"), p_desc: str(f, "description") })); });
}
export async function closeWorkOrder(f: FormData) {
  await act("/app/assets", "/app/assets", "Work order closed", async (sb) => {
    must(await sb.rpc("close_work_order", { p_wo: str(f, "id"), p_report: str(f, "report"), p_spare_item: str(f, "spare") || null, p_spare_qty: str(f, "qty") ? num(f, "qty") : null, p_warehouse: str(f, "warehouse"), p_labour: str(f, "labour") ? parseInr(str(f, "labour")) : 0 }));
  });
}
export async function disposeAsset(f: FormData) {
  await act("/app/assets", "/app/assets", "Asset disposed", async (sb) => { must(await sb.rpc("dispose_asset", { p_asset: str(f, "id"), p_reason: str(f, "reason") })); });
}

// ---- API keys & billing
export async function createApiKey(f: FormData) {
  await act("/app/settings", "/app/settings", "Key created", async (sb) => {
    const secret = must(await sb.rpc("create_api_key", { p_name: str(f, "name") })) as string;
    return `/app/settings?newkey=${encodeURIComponent(secret)}`; // shown once, never stored in clear
  });
}
export async function revokeApiKey(f: FormData) {
  await act("/app/settings", "/app/settings", "Key revoked", async (sb) => { must(await sb.rpc("revoke_api_key", { p_key: str(f, "id") })); });
}
export async function startCheckout(f: FormData) {
  const plan = str(f, "plan"), cycle = str(f, "cycle") === "yearly" ? "yearly" : "monthly";
  await act("/app/settings", "/app/settings", "Redirecting", async () => {
    const ctx = await requireCtx();
    if (ctx.role !== "owner") throw new Error("Only the owner can manage billing");
    const key = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
    const planId = process.env[`RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`];
    if (!key || !secret || !planId) throw new Error("Online billing is not configured yet. Contact support to activate your plan.");
    const res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
      body: JSON.stringify({ plan_id: planId, total_count: cycle === "yearly" ? 10 : 120, customer_notify: 1, notes: { tenant_id: ctx.tenant.id, plan, cycle } }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j.short_url) throw new Error("The payment provider rejected the request. Try again or contact support.");
    return j.short_url as string;
  });
}

// ---- approvals
export async function requestApproval(f: FormData) {
  const back = str(f, "back");
  await act(back, back, "Approval requested", async (sb) => { must(await sb.rpc("request_approval", { p_subject: str(f, "subject"), p_id: str(f, "id") })); });
}
async function decideApprovalAs(f: FormData, approve: boolean) {
  await act("/app/approvals", "/app/approvals", "Decision recorded", async (sb) => {
    must(await sb.rpc("decide_approval", { p_id: str(f, "id"), p_approve: approve, p_reason: str(f, "reason") || null }));
  });
}
export async function approveApproval(f: FormData) { await decideApprovalAs(f, true); }
export async function rejectApproval(f: FormData) { await decideApprovalAs(f, false); }
export async function saveApprovalRule(f: FormData) {
  await act("/app/settings", "/app/settings", "Rule saved", async (sb) => {
    must(await sb.rpc("save_approval_rule", { p_subject: str(f, "subject"), p_min: parseInr(str(f, "min")), p_role: str(f, "role"), p_from: str(f, "from") || new Date().toISOString().slice(0, 10), p_second: f.get("then_owner") === "on" ? "owner" : null }));
  });
}
export async function deactivateRule(f: FormData) {
  await act("/app/settings", "/app/settings", "Rule turned off", async (sb) => { must(await sb.rpc("deactivate_approval_rule", { p_rule: str(f, "id") })); });
}

// ---- outbound webhooks
export async function createWebhook(f: FormData) {
  await act("/app/settings", "/app/settings", "Webhook created", async (sb) => {
    const { checkWebhookUrl } = await import("@/lib/webhook");
    const url = str(f, "url"); const chk = checkWebhookUrl(url);
    if (!chk.ok) throw new Error(`Webhook URL rejected: ${chk.reason}`);
    const events = f.getAll("events").map(String);
    const secret = must(await sb.rpc("create_webhook", { p_url: url, p_events: events })) as string;
    return `/app/settings?newsecret=${encodeURIComponent(secret)}`;
  });
}
export async function toggleWebhook(f: FormData) {
  await act("/app/settings", "/app/settings", "Webhook updated", async (sb) => { must(await sb.rpc("set_webhook_active", { p_id: str(f, "id"), p_active: str(f, "active") === "true" })); });
}
export async function retryDelivery(f: FormData) {
  await act("/app/settings", "/app/settings", "Delivery queued again", async (sb) => { must(await sb.rpc("retry_webhook_delivery", { p_id: str(f, "id") })); });
}

export async function createDelegation(f: FormData) {
  await act("/app/settings", "/app/settings", "Delegation created", async (sb) => {
    const members = must(await sb.rpc("team")) as any[];
    const m = members.find((x) => String(x.email).toLowerCase() === str(f, "email").toLowerCase() && x.active);
    if (!m) throw new Error("No active team member has that email.");
    must(await sb.rpc("create_delegation", { p_to: m.user_id, p_from: str(f, "from"), p_until: str(f, "until") }));
  });
}
export async function revokeDelegation(f: FormData) {
  await act("/app/settings", "/app/settings", "Delegation ended", async (sb) => { must(await sb.rpc("revoke_delegation", { p_id: str(f, "id") })); });
}
