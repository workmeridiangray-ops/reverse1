"use server";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { parseMajor } from "@/lib/rules/money";
import { parsePercentBp } from "@/lib/rules/qty";

export const saveBudget = mutation("boq.edit", "saveBudget", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const items = await db.q<{ id: string; code: string }>("SELECT id,code FROM boq_items WHERE project_id=$1", [p.id]);
  let n = 0;
  for (const it of items) {
    const cost = str(fd, `cost_${it.id}`); const cont = str(fd, `cont_${it.id}`);
    if (cost === "") continue;
    const rate = parseMajor(cost, "INR"); const bp = cont === "" ? 0 : parsePercentBp(cont, "Contingency");
    if (bp > 10000) throw new UserError(`${it.code}: contingency cannot exceed 100%.`);
    await db.exec(`INSERT INTO budget_lines(boq_item_id,tenant_id,project_id,cost_rate_minor,contingency_bp) VALUES ($1,$2,$3,$4,$5)
                   ON CONFLICT (boq_item_id) DO UPDATE SET cost_rate_minor=EXCLUDED.cost_rate_minor, contingency_bp=EXCLUDED.contingency_bp`, [it.id, c.tenant.id, p.id, rate, bp]); n++;
  }
  await audit(db, c.user.id, c.tenant.id, "budget.saved", "project", p.id, { lines: n });
  return `Baseline budget saved for ${n} item(s).`;
});
