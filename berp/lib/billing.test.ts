import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { mapRazorpayEvent, verifyRazorpaySignature } from "./billing";

const sign = (b: string, s: string) => createHmac("sha256", s).update(b).digest("hex");
describe("billing webhook", () => {
  test("signature must match exactly", () => {
    const body = '{"event":"subscription.charged"}';
    expect(verifyRazorpaySignature(body, sign(body, "s3cret"), "s3cret")).toBe(true);
    expect(verifyRazorpaySignature(body + " ", sign(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifyRazorpaySignature(body, sign(body, "other"), "s3cret")).toBe(false);
    expect(verifyRazorpaySignature(body, null, "s3cret")).toBe(false);
    expect(verifyRazorpaySignature(body, "short", "s3cret")).toBe(false);
    expect(verifyRazorpaySignature(body, sign(body, ""), "")).toBe(false);
  });
  test("maps provider events and ignores unknown or tenant-less ones", () => {
    const t = "11111111-1111-4111-8111-111111111111";
    const ev = (event: string, notes: object = { tenant_id: t, plan: "growth", cycle: "yearly" }) => ({ event, payload: { subscription: { entity: { id: "sub_9", notes } } } });
    expect(mapRazorpayEvent("evt1", ev("subscription.charged"))).toEqual({ id: "evt1", kind: "charged", tenantId: t, plan: "growth", ref: "sub_9", cycle: "yearly" });
    expect(mapRazorpayEvent("evt2", ev("subscription.halted"))?.kind).toBe("failed");
    expect(mapRazorpayEvent("evt3", ev("subscription.cancelled"))?.kind).toBe("cancelled");
    expect(mapRazorpayEvent("evt4", ev("order.paid"))).toBeNull();
    expect(mapRazorpayEvent("evt5", ev("subscription.charged", {}))).toBeNull();
    expect(mapRazorpayEvent("evt6", ev("subscription.charged", { tenant_id: "x'; drop table" }))).toBeNull();
    expect(mapRazorpayEvent(null, ev("subscription.charged"))).toBeNull();
  });
});
