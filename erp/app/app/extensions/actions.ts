"use server";
import { tenantAction, formObj, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
export async function extensionInterestAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("settings.manage", form, async (ctx, db) => {
    const m = formObj(form).message ?? ""; if (m.length < 5) throw new UserError("Describe what you need.", { message: "Required" });
    await db.query("insert into contact_requests(kind,name,email,company,message) values ('contact',$1,$2,$3,$4)", [ctx.user.name, ctx.user.email, ctx.tenant.name, "[Extension interest] " + m]);
    return { ok: true, message: "Thanks — we’ll contact you to scope it." };
  }, { allowReadOnly: true });
}
