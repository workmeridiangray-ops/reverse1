"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/data/errors";
import { applyConsentChange, type FieldErrors, SEX_AT_BIRTH, type SexAtBirth, validatePatient } from "@/lib/rules/patient";
import { localDateKey } from "@/lib/rules/time";
import { createClient } from "@/lib/supabase/server";

export interface PatientFormState {
  errors?: FieldErrors;
  formError?: string;
  values?: Record<string, string>;
}

function read(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    givenName: s("given_name"),
    familyName: s("family_name"),
    dateOfBirth: s("date_of_birth"),
    sexAtBirth: s("sex_at_birth"),
    phone: s("phone") || null,
    email: s("email") || null,
    address: s("address") || null,
    consent: {
      treatment: form.get("consent_treatment") === "on",
      dataProcessing: form.get("consent_data_processing") === "on",
      communication: form.get("consent_communication") === "on",
      reconfirm: form.get("consent_reconfirm") === "on",
    },
  };
}

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function savePatient(_prev: PatientFormState, form: FormData): Promise<PatientFormState> {
  const session = await requireRole("admin", "receptionist");
  const id = String(form.get("id") ?? "") || null;
  const input = read(form);
  const errors = validatePatient(input, localDateKey(new Date(), session.clinic.timezone));
  if (Object.keys(errors).length) return { errors, values: echo(form) };

  const supabase = await createClient();
  let current = { consentTreatmentAt: null as string | null, consentDataProcessingAt: null as string | null, consentCommunication: false, consentVersion: null as string | null };
  if (id) {
    const { data } = await supabase
      .from("patients")
      .select("consent_treatment_at, consent_data_processing_at, consent_communication, consent_version")
      .eq("id", id)
      .maybeSingle();
    if (!data) return { formError: "Patient not found.", values: echo(form) };
    current = {
      consentTreatmentAt: data.consent_treatment_at,
      consentDataProcessingAt: data.consent_data_processing_at,
      consentCommunication: data.consent_communication,
      consentVersion: data.consent_version,
    };
  }
  const consent = applyConsentChange(current, input.consent, new Date().toISOString(), session.clinic.consentVersion);

  const row = {
    given_name: input.givenName,
    family_name: input.familyName,
    date_of_birth: input.dateOfBirth,
    sex_at_birth: input.sexAtBirth as SexAtBirth,
    phone: input.phone,
    email: input.email,
    address: input.address,
    consent_treatment_at: consent.consentTreatmentAt,
    consent_data_processing_at: consent.consentDataProcessingAt,
    consent_communication: consent.consentCommunication,
    consent_version: consent.consentVersion,
    ...(consent.changed ? { consent_recorded_by: session.userId } : {}),
  };
  if (!(SEX_AT_BIRTH as readonly string[]).includes(row.sex_at_birth)) return { errors: { sexAtBirth: "Choose an option." } };

  if (id) {
    const { error } = await supabase.from("patients").update(row).eq("id", id);
    if (error) return { formError: friendlyDbError(error.message), values: echo(form) };
    revalidatePath(`/patients/${id}`);
    redirect(`/patients/${id}?saved=1`);
  }
  // mrn is assigned by a database trigger; the placeholder satisfies the type only.
  const { data, error } = await supabase
    .from("patients")
    .insert({ ...row, clinic_id: session.clinic.id, mrn: "" })
    .select("id")
    .single();
  if (error) return { formError: friendlyDbError(error.message), values: echo(form) };
  revalidatePath("/patients");
  redirect(`/patients/${data.id}?saved=1`);
}
