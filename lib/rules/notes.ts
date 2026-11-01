/**
 * Consultation note rules. Pure.
 * PARITY: the "assessment or plan" requirement and the post-signing lock are
 * also enforced by app.consultation_rules() in the database.
 */
import { validateCriticalFlag } from "./clinical-priority";

export interface NoteDraft {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  isCritical: boolean;
  criticalReason: string | null;
}

export const NOTE_FIELD_LIMIT = 20_000;

export function validateNote(note: NoteDraft, intent: "save" | "sign"): string[] {
  const issues = [...validateCriticalFlag(note.isCritical, note.criticalReason)];
  for (const [k, v] of Object.entries({ subjective: note.subjective, objective: note.objective, assessment: note.assessment, plan: note.plan })) {
    if (v.length > NOTE_FIELD_LIMIT) issues.push(`${k[0]?.toUpperCase()}${k.slice(1)} is too long.`);
  }
  if (intent === "sign" && !note.assessment.trim() && !note.plan.trim()) {
    issues.push("Add an assessment or plan before signing.");
  }
  return issues;
}

/** Once signed, only the critical flag may change (to resolve it). */
export function editableFields(signed: boolean): ReadonlyArray<keyof NoteDraft> {
  return signed ? ["isCritical", "criticalReason"] : ["subjective", "objective", "assessment", "plan", "isCritical", "criticalReason"];
}
