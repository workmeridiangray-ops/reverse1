"use client";
import { useState } from "react";
import Script from "next/script";
declare global { interface Window { Razorpay: any } }
export function RazorpayCheckout({ keyId, orderId, amount, name, email, invoiceId }: { keyId: string; orderId: string; amount: number; name: string; email: string; invoiceId: string }) {
  const [msg, setMsg] = useState("");
  const pay = () => {
    const rz = new window.Razorpay({ key: keyId, order_id: orderId, amount, currency: "INR", name: "Ledgerline", description: `Invoice ${invoiceId.slice(0, 8)}`, prefill: { email },
      handler: async (r: any) => { const res = await fetch("/api/billing/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...r, invoiceId }) }); setMsg(res.ok ? "Payment received. Your plan updates in a few seconds — confirmation arrives from the payment provider." : "We could not verify the payment. If you were charged, it will be reconciled automatically; contact support if the plan does not update."); },
      modal: { ondismiss: () => setMsg("Payment window closed. You can retry from Billing.") } });
    rz.on("payment.failed", (e: any) => setMsg(e?.error?.description ?? "Payment failed. Try another method."));
    rz.open();
  };
  return (<div><Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" /><button className="btn primary" onClick={pay}>Pay securely</button>{msg && <div className="alert info" role="status" style={{ marginTop: 12 }}>{msg}</div>}</div>);
}
