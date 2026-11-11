"use client";
import { useState } from "react";
declare global { interface Window { Razorpay?: any } }
export function PayButton({ orderId, amount, keyId, name, email }: { orderId: string; amount: number; keyId: string; name: string; email: string }) {
  const [msg, setMsg] = useState("");
  const pay = () => {
    if (!window.Razorpay) { setMsg("Payment window is still loading — try again in a moment."); return; }
    const rz = new window.Razorpay({ key: keyId, order_id: orderId, amount, currency: "INR", name: "Forgeline", description: name, prefill: { email },
      handler: async (r: any) => { setMsg("Confirming payment…"); const res = await fetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) }); window.location.href = "/app/settings/billing?paid=" + (res.ok ? "1" : "0"); },
      modal: { ondismiss: () => setMsg("Payment window closed. Nothing was charged.") } });
    rz.on("payment.failed", () => setMsg("Payment failed. You can try again.")); rz.open();
  };
  return <div className="mt-4"><button onClick={pay} className="btn-primary">Pay securely</button><p role="status" className="mt-2 text-sm">{msg}</p></div>;
}
