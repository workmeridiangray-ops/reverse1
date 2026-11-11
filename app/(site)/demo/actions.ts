"use server";
import { createClient } from "@/lib/supabase/server";

export interface DemoState {
  status?: "received" | "duplicate";
  errors?: Partial<Record<"name" | "email" | "organisation" | "beds", string>>;
  formError?: string;
  values?: Record<string, string>;
}

export async function requestDemo(_prev: DemoState, form: FormData): Promise<DemoState> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  // Honeypot: real people never fill this hidden field. Pretend success.
  if ((values.website ?? "").trim()) return { status: "received" };
  const errors: NonNullable<DemoState["errors"]> = {};
  const name = (values.name ?? "").trim();
  const email = (values.email ?? "").trim();
  const org = (values.organisation ?? "").trim();
  if (!name) errors.name = "Enter your name.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (!org) errors.organisation = "Enter your organisation.";
  let beds: number | null = null;
  if (values.beds?.trim()) {
    beds = Number(values.beds);
    if (!Number.isInteger(beds) || beds < 1 || beds > 100000) errors.beds = "Enter a whole number of beds, or leave it empty.";
  }
  if (Object.keys(errors).length) return { errors, values };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_demo_request", {
    p_name: name, p_email: email, p_organisation: org, p_beds: beds as number, // SQL accepts NULL for "not given"
    p_message: (values.message ?? "").slice(0, 2000),
  });
  if (error) return { formError: "We couldn't send your request just now. Please try again in a few minutes.", values };
  return { status: data === "duplicate" ? "duplicate" : "received" };
}
