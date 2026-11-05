"use server";
import { z } from "zod";
import { audit, queueEmail, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { tenantLimits } from "@/lib/server/queries";

export const saveBusiness = mutation("settings.manage", "saveBusiness", async (c, db, fd) => {
  const d = z.object({ name: z.string().trim().min(2, "Enter the business name").max(160), gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9A-Z]{15}$/, "GSTIN must be 15 letters/digits").optional(), address: z.string().max(400).optional() })
    .parse({ name: str(fd, "name"), gstin: str(fd, "gstin") || "", address: str(fd, "address") || undefined });
  await db.exec("UPDATE tenants SET name=$2, gstin=$3, address=$4 WHERE id=$1", [c.tenant.id, d.name, d.gstin || null, d.address ?? null]);
  await audit(db, c.user.id, c.tenant.id, "tenant.updated", "tenant", c.tenant.id);
  return "Business details saved.";
});

export const changePlan = mutation("settings.manage", "changePlan", async (c, db, fd) => {
  const planId = z.string().uuid().parse(str(fd, "plan_id"));
  const cycle = str(fd, "cycle") === "yearly" ? "yearly" : "monthly";
  const plan = await db.one<{ id: string; name: string; max_projects: number; max_users: number; storage_mb: number }>("SELECT id,name,max_projects,max_users,storage_mb FROM plans WHERE id=$1 AND active", [planId]);
  const lim = await tenantLimits(db, c.tenant.id);
  const problems: string[] = [];
  if (lim.projects > plan.max_projects) problems.push(`${lim.projects} open projects exceeds ${plan.name}'s limit of ${plan.max_projects}. Close ${lim.projects - plan.max_projects} project(s).`);
  if (lim.users > plan.max_users) problems.push(`${lim.users} users and pending invitations exceeds ${plan.max_users}. Suspend or revoke ${lim.users - plan.max_users}.`);
  if (lim.storage_bytes > plan.storage_mb * 1048576) problems.push(`Stored files exceed ${Math.round(plan.storage_mb / 1024)} GB.`);
  if (problems.length) throw new UserError(`Cannot switch to ${plan.name} yet.`, undefined, problems);
  const prev = c.tenant.planId;
  await db.exec("UPDATE tenants SET plan_id=$2, billing_cycle=$3 WHERE id=$1", [c.tenant.id, plan.id, cycle]);
  await db.exec("INSERT INTO plan_changes(tenant_id,from_plan_id,to_plan_id,changed_by) VALUES ($1,$2,$3,$4)", [c.tenant.id, prev, plan.id, c.user.id]);
  await audit(db, c.user.id, c.tenant.id, "plan.changed", "tenant", c.tenant.id, { to: plan.name, cycle });
  return `Plan changed to ${plan.name} (${cycle}).`;
});

export const requestActivation = mutation("settings.manage", "requestActivation", async (c, db) => {
  await audit(db, c.user.id, c.tenant.id, "billing.activation_requested", "tenant", c.tenant.id);
  if (process.env.SALES_EMAIL) await queueEmail(db, c.tenant.id, process.env.SALES_EMAIL, `Activation request: ${c.tenant.name}`, `${c.user.name} <${c.user.email}> asks to activate the paid plan for ${c.tenant.name} (${c.tenant.id}).`);
  return "Activation requested. Our team will contact you to arrange payment and activate your account.";
});
