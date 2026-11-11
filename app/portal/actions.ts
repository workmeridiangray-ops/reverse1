"use server";
import { action, str } from "@/lib/server/action";
import { UserError } from "@/lib/server/db";
import { confirmDelivery } from "@/lib/server/svc/fulfilment";
/** Customer portal: may only confirm delivery of their own shipment. */
export const portalDeliver = action(null, async ({ fd, ctx, c, auth }) => {
  if (auth.membership.role !== "customer" || !auth.membership.partyId) throw new UserError("Not allowed.", "denied");
  const own = await c.query("select 1 from shipments where id=$1 and customer_id=$2", [str(fd, "id"), auth.membership.partyId]);
  if (!own.rowCount) throw new UserError("Shipment not found.", "notfound");
  await confirmDelivery(c, ctx, str(fd, "id"), str(fd, "note")); return "Thanks — receipt confirmed.";
});
