"use server";
import { z } from "zod";
import { audit, UserError } from "@/lib/server/db";
import { mutation, str } from "@/lib/server/actions";
import { writableProject } from "@/lib/server/queries";

export const grantAccess = mutation("project.access", "grantAccess", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const userId = z.string().uuid("Choose a person").parse(str(fd, "user_id"));
  const m = await db.maybe("SELECT 1 FROM memberships WHERE user_id=$1 AND status='active'", [userId]);
  if (!m) throw new UserError("That person is not an active member of this business.");
  await db.exec("INSERT INTO project_access(tenant_id,project_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [c.tenant.id, p.id, userId]);
  await audit(db, c.user.id, c.tenant.id, "project_access.granted", "project", p.id, { userId });
  return "Access granted.";
});
export const revokeAccess = mutation("project.access", "revokeAccess", async (c, db, fd) => {
  const p = await writableProject(db, str(fd, "project_id"));
  const userId = z.string().uuid().parse(str(fd, "user_id"));
  await db.exec("DELETE FROM project_access WHERE project_id=$1 AND user_id=$2", [p.id, userId]);
  await audit(db, c.user.id, c.tenant.id, "project_access.revoked", "project", p.id, { userId });
  return "Access removed.";
});
