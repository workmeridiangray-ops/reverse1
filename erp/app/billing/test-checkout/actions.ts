"use server";
import { randomUUID } from "node:crypto";
import { tenantAction, type ActionResult } from "@/lib/actions";
import { env } from "@/lib/env";
import { signTestPayload } from "@/lib/billing/provider";
import { UserError } from "@/lib/errors";

/** Sends a signed event to our own webhook endpoint, so the whole production path (signature, dedupe, job) is exercised. */
export async function testPayAction(invoiceId: string, outcome: "success" | "fail"): Promise<ActionResult> {
  return tenantAction("billing.manage", null, async (ctx, db) => {
    if (env.billingProvider !== "test") throw new UserError("Test provider is disabled.");
    const inv = (await db.query("select * from platform_invoices where id=$1 and tenant_id=$2", [invoiceId, ctx.tenant.id])).rows[0]; if (!inv) throw new UserError("Invoice not found");
    const body = JSON.stringify({ id: "evt_" + randomUUID(), type: outcome === "success" ? "payment.succeeded" : "payment.failed", invoiceId, paymentId: "pay_test_" + randomUUID().slice(0, 12), amount: inv.total_paise, reason: outcome === "fail" ? "Insufficient funds (test)" : undefined });
    const res = await fetch(`${env.appUrl}/api/webhooks/payments`, { method: "POST", headers: { "content-type": "application/json", "x-signature": signTestPayload(body) }, body });
    if (!res.ok) throw new UserError(`Webhook rejected (${res.status}).`);
    return outcome === "success" ? { ok: true, message: "Payment succeeded — plan activated.", redirectTo: "/app/settings/billing" } : { ok: true, message: "Payment declined (test). You can retry from Billing.", redirectTo: "/app/settings/billing" };
  }, { allowReadOnly: true });
}
