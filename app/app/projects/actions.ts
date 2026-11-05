"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { dateStr, mutation, str } from "@/lib/server/actions";
import { tenantLimits } from "@/lib/server/queries";

export const createProject = mutation("project.create", "createProject", async (c, db, fd) => {
  const d = z.object({
    code: z.string().trim().min(2, "Enter a code (e.g. P-001)").max(30),
    name: z.string().trim().min(2, "Enter a project name").max(160),
    client_name: z.string().trim().min(2, "Enter the client name").max(160),
    location: z.string().trim().max(200).optional(),
    start_date: dateStr.optional().or(z.literal("")), end_date: dateStr.optional().or(z.literal("")),
  }).parse(Object.fromEntries(["code", "name", "client_name", "location", "start_date", "end_date"].map((k) => [k, str(fd, k) || undefined])));
  if (d.start_date && d.end_date && d.end_date < d.start_date) throw new UserError("End date must be on or after the start date.", "end_date");
  const lim = await tenantLimits(db, c.tenant.id);
  if (lim.projects >= lim.max_projects) throw new UserError(`Your ${lim.plan} plan allows ${lim.max_projects} open projects. Close a project or upgrade in Settings.`);
  const p = await db.one<{ id: string }>(
    "INSERT INTO projects(tenant_id,code,name,client_name,location,start_date,end_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [c.tenant.id, d.code, d.name, d.client_name, d.location ?? null, d.start_date || null, d.end_date || null, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "project.created", "project", p.id, { code: d.code });
  return { message: "Project created.", redirectTo: `/app/projects/${p.id}` };
});
