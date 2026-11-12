"use server";
import { tenantAction, type ActionResult } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { runImport } from "@/lib/erp/import";
import { audit } from "@/lib/audit";

export async function importAction(_p: ActionResult | null, form: FormData): Promise<ActionResult> {
  return tenantAction("masters.manage", form, async (ctx, db) => {
    const kind = String(form.get("kind") ?? ""); const commit = form.get("mode") === "commit"; const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a CSV file.", { file: "Required" });
    if (file.size > 2 * 1024 * 1024) throw new UserError("File is larger than 2 MB.", { file: "Too large" });
    if (!/\.csv$/i.test(file.name)) throw new UserError("Only .csv files are accepted.", { file: "Not a CSV" });
    if (kind === "opening_stock" && !ctx.perms.has("inventory.adjust")) throw new UserError("Loading opening stock needs the stock-adjust permission.");
    const { results, applied } = await runImport(db, ctx, kind, await file.text(), commit);
    const bad = results.filter((r) => !r.ok); const ok = results.length - bad.length;
    await db.query("insert into import_batches(tenant_id,kind,filename,rows_total,rows_ok,rows_failed,errors,created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)", [ctx.tenant.id, kind, file.name.slice(0, 100), results.length, ok, bad.length, JSON.stringify(bad.slice(0, 50)), ctx.user.id]);
    if (applied) await audit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, action: "import.applied", detail: { kind, rows: ok } });
    if (bad.length) return { ok: false, error: `${bad.length} row(s) have problems, so nothing was imported. ${bad.slice(0, 8).map((r) => `Line ${r.line}: ${r.error}`).join(" · ")}${bad.length > 8 ? ` … and ${bad.length - 8} more` : ""}` };
    return { ok: true, message: applied ? `Imported ${ok} row(s).` : `Preview OK: all ${ok} row(s) are valid. Choose “Import now” to apply.` };
  });
}
