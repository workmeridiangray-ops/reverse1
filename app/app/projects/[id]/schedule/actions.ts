"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";
import { validateActivity, slipDays, type Act } from "@/lib/rules/schedule";

async function all(db: import("@/lib/server/db").Db, pid: string): Promise<Act[]> {
  return (await db.q<{ id: string; s: string; e: string; d: string[] }>("SELECT id,start_date::text s,end_date::text e,depends_on d FROM schedule_activities WHERE project_id=$1", [pid])).map((r) => ({ id: r.id, start: r.s, end: r.e, deps: r.d }));
}
const parse = (fd: FormData) => z.object({ wbs: z.string().trim().min(1, "Enter a WBS code").max(30), name: z.string().trim().min(2, "Name the activity").max(200), start: dateStr, end: dateStr })
  .parse({ wbs: str(fd, "wbs"), name: str(fd, "name"), start: str(fd, "start_date"), end: str(fd, "end_date") });

export const addActivity = mutation("plan.edit", "addActivity", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id")); const d = parse(fd);
  const deps = fd.getAll("depends_on").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const item = str(fd, "boq_item_id") || null;
  if (item) await db.one("SELECT 1 FROM boq_items WHERE id=$1 AND project_id=$2", [item, p.id]);
  const id = crypto.randomUUID();
  const problems = validateActivity({ id, start: d.start, end: d.end, deps }, await all(db, p.id));
  if (problems.length) throw new UserError("The schedule is inconsistent.", undefined, problems);
  await db.exec("INSERT INTO schedule_activities(id,tenant_id,project_id,wbs,name,start_date,end_date,depends_on,boq_item_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, c.tenant.id, p.id, d.wbs, d.name, d.start, d.end, deps, item, c.user.id]);
  return `Activity ${d.wbs} added.`;
});

export const rescheduleActivity = mutation("plan.edit", "rescheduleActivity", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const id = z.string().uuid().parse(str(fd, "activity_id"));
  const start = dateStr.parse(str(fd, "start_date")), end = dateStr.parse(str(fd, "end_date"));
  const cur = await db.one<{ base_end: string | null; d: string[]; version: number }>("SELECT base_end::text, depends_on d, version FROM schedule_activities WHERE id=$1 AND project_id=$2 FOR UPDATE", [id, p.id]);
  if (cur.version !== Number(str(fd, "version"))) throw new UserError("This activity was changed by someone else. Reload and try again.");
  const others = (await all(db, p.id));
  const problems = validateActivity({ id, start, end, deps: cur.d }, others);
  // successors must still start after this activity finishes
  for (const o of others) if (o.deps.includes(id) && o.start < end) problems.push(`A successor starts on ${o.start}, before the new finish date.`);
  if (problems.length) throw new UserError("The new dates break the schedule.", undefined, problems);
  const slip = slipDays({ end, baseEnd: cur.base_end });
  const reason = str(fd, "delay_reason");
  if (slip > 0 && reason.length < 5) throw new UserError(`Finishing ${slip} day(s) after the baseline needs a delay reason.`, "delay_reason");
  await db.exec("UPDATE schedule_activities SET start_date=$2,end_date=$3,delay_reason=$4,version=version+1 WHERE id=$1", [id, start, end, slip > 0 ? reason : null]);
  await audit(db, c.user.id, c.tenant.id, "schedule.rescheduled", "activity", id, { start, end, slip, reason });
  return slip > 0 ? `Rescheduled; ${slip} day(s) behind baseline.` : "Rescheduled.";
});

export const freezeBaseline = mutation("plan.edit", "freezeBaseline", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const acts = await db.q<{ id: string; wbs: string; s: string; e: string }>("SELECT id,wbs,start_date::text s,end_date::text e FROM schedule_activities WHERE project_id=$1 ORDER BY wbs", [p.id]);
  if (!acts.length) throw new UserError("Add activities before freezing a baseline.");
  const v = (await db.one<{ v: number }>("SELECT COALESCE(max(version),0)::int+1 v FROM schedule_baselines WHERE project_id=$1", [p.id])).v;
  await db.exec("INSERT INTO schedule_baselines(tenant_id,project_id,version,note,frozen_by,snapshot) VALUES ($1,$2,$3,$4,$5,$6)", [c.tenant.id, p.id, v, str(fd, "note") || null, c.user.id, JSON.stringify(acts)]);
  await db.exec("UPDATE schedule_activities SET base_start=start_date, base_end=end_date WHERE project_id=$1", [p.id]);
  await audit(db, c.user.id, c.tenant.id, "schedule.baseline_frozen", "project", p.id, { version: v });
  return `Baseline v${v} frozen. Later updates are compared with it, never rewritten into it.`;
});
