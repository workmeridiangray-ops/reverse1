import { NextResponse } from "next/server";
import { getAuth } from "@/lib/server/auth";
import { confirmClientPayment } from "@/lib/server/billing";
import { can } from "@/lib/server/perms";
export async function POST(req: Request) {
  const a = await getAuth(); if (!a || "expired" in a || !a.membership || !can(a.membership.role, "admin.billing")) return new NextResponse("Not allowed", { status: 403 });
  const origin = req.headers.get("origin"); if (origin && new URL(origin).host !== req.headers.get("host")) return new NextResponse("Bad origin", { status: 403 });
  const b = await req.json().catch(() => ({}));
  try { await confirmClientPayment(String(b.razorpay_order_id), String(b.razorpay_payment_id), String(b.razorpay_signature)); return NextResponse.json({ ok: true }); }
  catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: 400 }); }
}
