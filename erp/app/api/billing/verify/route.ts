import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/session";
import { verifyRazorpayCheckoutSignature } from "@/lib/billing/provider";
// Browser-side confirmation only; the webhook is the source of truth for activating plans.
export async function POST(req: Request) {
  const ctx = await getCtx(); if (!ctx?.tenant || !ctx.perms.has("billing.manage")) return new NextResponse("forbidden", { status: 403 });
  const b = await req.json().catch(() => null);
  if (!b?.razorpay_order_id || !b?.razorpay_payment_id || !b?.razorpay_signature) return new NextResponse("bad request", { status: 400 });
  return verifyRazorpayCheckoutSignature(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature) ? NextResponse.json({ ok: true }) : new NextResponse("bad signature", { status: 400 });
}
