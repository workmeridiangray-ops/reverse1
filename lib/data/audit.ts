import "server-only";
import type { ServerClient } from "@/lib/supabase/server";

export type AuditedTable = "patients" | "appointments" | "consultations" | "prescriptions" | "invoices" | "admissions";

/**
 * Record that the current user opened a patient-level record. Call from every
 * server page that shows a single record. Failure to log blocks the page:
 * if we cannot audit the access, we do not show the record.
 */
export async function logAccess(supabase: ServerClient, table: AuditedTable, id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("log_record_access", { p_table: table, p_record_id: id, p_reason: reason });
  if (error) throw new Error(`Access could not be audited: ${error.message}`);
}
