"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parseQty } from "@/lib/rules/qty";
import { validateBoqCsv } from "@/lib/rules/boq-csv";

async function contractApproved(db: import("@/lib/server/db").Db, pid: string) {
  return !!(await db.maybe("SELECT 1 FROM contracts WHERE project_id=$1 AND status='approved'", [pid]));
}

export const addBoqItem = mutation("boq.edit", "addBoq", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const d = z.object({ code: z.string().min(1, "Enter an item code").max(40), description: z.string().min(2, "Describe the item").max(300), unit: z.string().min(1, "Enter a unit").max(12) })
    .parse({ code: str(fd, "code"), description: str(fd, "description"), unit: str(fd, "unit") });
  const qty = parseQty(str(fd, "quantity") || "0", "Quantity");
  const rate = parseMajor(str(fd, "rate") || "0", "INR");
  if (rate < 0) throw new UserError("Rate cannot be negative.", "rate");
  const approved = await contractApproved(db, p.id);
  if (approved && qty > 0) throw new UserError("The contract is approved: add the item at zero quantity and raise a variation to add quantity.", "quantity");
  await db.exec("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [c.tenant.id, p.id, d.code, d.description, d.unit, qty, rate, approved ? "added after contract approval" : "manual entry"]);
  await audit(db, c.user.id, c.tenant.id, "boq.item_added", "project", p.id, { code: d.code });
  return `Item ${d.code} added.`;
});

export const deleteBoqItem = mutation("boq.edit", "delBoq", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (await contractApproved(db, p.id)) throw new UserError("The contract is approved; BOQ items can no longer be deleted.");
  const id = z.string().uuid().parse(str(fd, "item_id"));
  const used = await db.maybe("SELECT 1 FROM measurements WHERE boq_item_id=$1 UNION ALL SELECT 1 FROM bill_lines WHERE boq_item_id=$1 LIMIT 1", [id]);
  if (used) throw new UserError("This item already has measurements or bill lines and cannot be deleted.");
  await db.exec("DELETE FROM budget_lines WHERE boq_item_id=$1", [id]);
  await db.exec("DELETE FROM boq_items WHERE id=$1 AND project_id=$2", [id, p.id]);
  await audit(db, c.user.id, c.tenant.id, "boq.item_deleted", "project", p.id, { item: id });
  return "Item deleted.";
});

export const importBoq = mutation("boq.edit", "importBoq", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  if (await contractApproved(db, p.id)) throw new UserError("The contract is approved; the BOQ can no longer be imported.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a CSV file.", "file");
  if (file.size > 2 * 1024 * 1024) throw new UserError("CSV is larger than 2 MB.", "file");
  const existing = new Set((await db.q<{ code: string }>("SELECT code FROM boq_items WHERE project_id=$1", [p.id])).map((r) => r.code.toLowerCase()));
  const parsed = validateBoqCsv(await file.text(), existing);
  if (parsed.errors.length) throw new UserError(`${parsed.errors.length} problem(s) found. Nothing was imported.`, undefined, parsed.errors.slice(0, 50));
  if (str(fd, "mode") !== "commit") return { message: `Validation passed: ${parsed.items.length} item(s) are ready. Choose “Import” to save them.` };
  for (const it of parsed.items)
    await db.exec("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [c.tenant.id, p.id, it.code, it.description, it.unit, it.qty, it.rate, `csv import: ${file.name.slice(0, 80)}`]);
  await audit(db, c.user.id, c.tenant.id, "boq.imported", "project", p.id, { rows: parsed.items.length, file: file.name.slice(0, 80) });
  return `Imported ${parsed.items.length} BOQ item(s).`;
});
