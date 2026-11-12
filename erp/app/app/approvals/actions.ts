"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { decide } from "@/lib/erp/approvals";
import { UserError } from "@/lib/errors";
import "@/lib/erp/sales"; import "@/lib/erp/procurement"; import "@/lib/erp/finance"; import "@/lib/erp/stock";

export async function decideAction(id: string, approve: boolean, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("approvals.decide", form, async (ctx, db) => {
    await decide(db, ctx, id, approve, formObj(form).reason ?? "");
    return { ok: true, message: approve ? "Approved." : "Rejected." };
  });
}
export async function delegateAction(id: string, _p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("approvals.decide", form, async (ctx, db) => {
    const to = formObj(form).to; if (!to) throw new UserError("Choose a colleague.", { to: "Required" });
    const target = (await db.query("select 1 from memberships where tenant_id=$1 and user_id=$2 and status='active'", [ctx.tenant.id, to])).rowCount;
    if (!target) throw new UserError("That person is not an active member of this company.");
    const r = await db.query("update approval_requests set delegated_to=$2 where id=$1 and status='pending' and requested_by <> $2", [id, to]);
    if (!r.rowCount) throw new UserError("Can’t delegate this request (already decided, or the requester is the delegate).");
    await db.query("insert into notifications(tenant_id,user_id,title,link) values ($1,$2,'An approval was delegated to you','/app/approvals')", [ctx.tenant.id, to]);
    return { ok: true, message: "Delegated. They can now decide it." };
  });
}
