"use server";
import { z } from "zod";
import { mutation, str } from "@/lib/server/actions";

export const addSupplier = mutation("supplier.manage", "addSupplier", async (c, db, fd) => {
  const d = z.object({ name: z.string().trim().min(2, "Enter the supplier name").max(160) }).parse({ name: str(fd, "name") });
  await db.exec("INSERT INTO suppliers(tenant_id,name,contact,gstin) VALUES ($1,$2,$3,$4)", [c.tenant.id, d.name, str(fd, "contact") || null, str(fd, "gstin").toUpperCase() || null]);
  return "Supplier added.";
});
