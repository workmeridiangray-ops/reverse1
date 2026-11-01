/**
 * End-to-end through the real Supabase stack: GoTrue sign-in -> JWT ->
 * PostgREST -> RLS. Proves the policies hold for real sessions, not only for
 * claims set by hand in SQL.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CLINIC_A, ID } from "./helpers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Public, well-known key of every local Supabase stack (safe to commit).
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PASSWORD = "tendwell-demo-pass";

async function signIn(email: string) {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

describe("real sessions through PostgREST", () => {
  it("receptionist sees only their clinic's patients", async () => {
    const sb = await signIn("desk@cedarlane.test");
    const { data, error } = await sb.from("patients").select("id, clinic_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(7);
    expect(new Set(data?.map((p) => p.clinic_id))).toEqual(new Set([CLINIC_A]));
  });

  it("receptionist cannot fetch another clinic's patient by id", async () => {
    const sb = await signIn("desk@cedarlane.test");
    const { data } = await sb.from("patients").select("id").eq("id", ID.jon);
    expect(data).toEqual([]);
  });

  it("patient sees only themselves and only issued invoices", async () => {
    const sb = await signIn("amal.haddad@patient.test");
    const patients = await sb.from("patients").select("id");
    expect(patients.data?.map((p) => p.id)).toEqual([ID.amal]);
    const invoices = await sb.from("invoice_balances").select("invoice_id, payment_status");
    expect(invoices.data).toEqual([{ invoice_id: ID.invAmal, payment_status: "partially_paid" }]);
  });

  it("doctor reads notes; reception does not", async () => {
    const doctor = await signIn("dr.okafor@cedarlane.test");
    expect((await doctor.from("consultations").select("id")).data).toHaveLength(3);
    const desk = await signIn("desk@cedarlane.test");
    expect((await desk.from("consultations").select("id")).data).toEqual([]);
  });

  it("deactivated staff can sign in but see nothing", async () => {
    const sb = await signIn("former.desk@cedarlane.test");
    expect((await sb.from("patients").select("id")).data).toEqual([]);
  });

  it("anonymous requests are refused", async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await anon.from("patients").select("id");
    expect(data).toBeNull();
    expect(error?.message).toMatch(/permission denied/);
  });

  it("public sign-up is disabled (staff accounts are provisioned)", async () => {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error } = await anon.auth.signUp({ email: "intruder@example.test", password: "whatever-123456" });
    expect(error).not.toBeNull();
  });
});
