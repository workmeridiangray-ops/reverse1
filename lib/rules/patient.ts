/**
 * Patient record rules: input validation and consent state. Pure.
 *
 * Consent fields: treatment consent and data-processing consent are both
 * required before a patient is seen; communication consent is optional and
 * gates reminders. A consent recorded against an older form version counts as
 * "outdated" and must be re-collected. The required version is set per clinic.
 */
import { parseDateKey } from "./time";

export type SexAtBirth = "female" | "male" | "intersex" | "unknown";
export const SEX_AT_BIRTH: readonly SexAtBirth[] = ["female", "male", "intersex", "unknown"];

export interface PatientInput {
  givenName: string;
  familyName: string;
  dateOfBirth: string; // YYYY-MM-DD
  sexAtBirth: string;
  phone?: string | null;
  email?: string | null;
}

export type FieldErrors = Partial<Record<keyof PatientInput, string>>;

export function validatePatient(input: PatientInput, today: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.givenName.trim()) errors.givenName = "Enter a given name.";
  if (!input.familyName.trim()) errors.familyName = "Enter a family name.";
  if (input.givenName.length > 100) errors.givenName = "Keep names under 100 characters.";
  if (input.familyName.length > 100) errors.familyName = "Keep names under 100 characters.";

  try {
    parseDateKey(input.dateOfBirth);
    if (input.dateOfBirth > today) errors.dateOfBirth = "Date of birth cannot be in the future.";
    else if (input.dateOfBirth < "1900-01-01") errors.dateOfBirth = "Check the year of birth.";
  } catch {
    errors.dateOfBirth = "Enter a date of birth.";
  }

  if (!(SEX_AT_BIRTH as readonly string[]).includes(input.sexAtBirth)) {
    errors.sexAtBirth = "Choose sex at birth (choose Unknown if not stated).";
  }
  const phone = input.phone?.trim();
  if (phone && !/^\+?[0-9 ()\-]{6,20}$/.test(phone)) errors.phone = "Enter a valid phone number.";
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  return errors;
}

export interface ConsentRecord {
  consentTreatmentAt: string | null;
  consentDataProcessingAt: string | null;
  consentCommunication: boolean;
  consentVersion: string | null;
}

export type ConsentState = "complete" | "missing" | "outdated";

export function consentState(record: ConsentRecord, requiredVersion: string): ConsentState {
  if (!record.consentTreatmentAt || !record.consentDataProcessingAt) return "missing";
  if (record.consentVersion !== requiredVersion) return "outdated";
  return "complete";
}

export function consentLabel(state: ConsentState): string {
  return { complete: "Consent on file", missing: "Consent missing", outdated: "Consent outdated" }[state];
}

export function fullName(p: { givenName: string; familyName: string }): string {
  return `${p.givenName.trim()} ${p.familyName.trim()}`.trim();
}
