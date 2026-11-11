import "server-only";
import { type AdmissionStatus, type AdmissionType, bedState, type BedState, type ClearanceDepartment, dischargeBlockers } from "@/lib/rules/admission";
import type { ServerClient } from "@/lib/supabase/server";

function check<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

export interface CensusBed {
  id: string;
  label: string;
  wardId: string;
  state: BedState;
  housekeeping: "clean" | "dirty" | "cleaning";
  occupant: { admissionId: string; patientId: string; name: string; mrn: string; since: string } | null;
}
export interface CensusWard {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  beds: CensusBed[];
}

export async function getCensus(supabase: ServerClient) {
  const [wards, beds, stays] = await Promise.all([
    supabase.from("wards").select("id, name, kind, active").order("name"),
    supabase.from("beds").select("id, label, ward_id, out_of_service, housekeeping").order("label"),
    supabase.from("bed_stays").select("bed_id, admission_id, patient_id, starts_at").is("ends_at", null),
  ]);
  const w = check(wards, "wards");
  const b = check(beds, "beds");
  const s = check(stays, "stays");
  const patientIds = [...new Set(s.map((x) => x.patient_id))];
  const patients = patientIds.length
    ? check(await supabase.from("patients").select("id, mrn, given_name, family_name").in("id", patientIds), "patients")
    : [];
  const byPatient = new Map(patients.map((p) => [p.id, p]));
  const stayByBed = new Map(s.map((x) => [x.bed_id, x]));

  const out: CensusWard[] = w.map((ward) => ({
    ...ward,
    beds: b
      .filter((x) => x.ward_id === ward.id)
      .map((x) => {
        const stay = stayByBed.get(x.id);
        const p = stay ? byPatient.get(stay.patient_id) : undefined;
        return {
          id: x.id,
          label: x.label,
          wardId: x.ward_id,
          housekeeping: x.housekeeping as CensusBed["housekeeping"],
          state: bedState({ outOfService: x.out_of_service || !ward.active, housekeeping: x.housekeeping as CensusBed["housekeeping"], occupied: Boolean(stay) }),
          occupant: stay
            ? { admissionId: stay.admission_id, patientId: stay.patient_id, name: p ? `${p.given_name} ${p.family_name}` : "Patient", mrn: p?.mrn ?? "", since: stay.starts_at }
            : null,
        };
      }),
  }));

  const all = out.flatMap((x) => x.beds);
  const inService = all.filter((x) => x.state !== "out_of_service");
  return {
    wards: out,
    summary: {
      inService: inService.length,
      occupied: all.filter((x) => x.state === "occupied").length,
      available: all.filter((x) => x.state === "available").length,
      needsCleaning: all.filter((x) => x.state === "needs_cleaning" || x.state === "being_cleaned").length,
    },
  };
}

export interface AdmissionRow {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  status: AdmissionStatus;
  type: AdmissionType;
  reason: string;
  attending: string;
  requestedAt: string;
  admittedAt: string | null;
  bed: string | null;
  authorised: boolean;
}

export async function listAdmissions(supabase: ServerClient, statuses: AdmissionStatus[], limit = 200): Promise<AdmissionRow[]> {
  const adm = check(
    await supabase
      .from("admissions")
      .select("id, patient_id, attending_id, status, admission_type, reason, requested_at, admitted_at, discharge_authorised_at")
      .in("status", statuses)
      .order("requested_at", { ascending: false })
      .limit(limit),
    "admissions",
  );
  if (adm.length === 0) return [];
  const ids = adm.map((a) => a.id);
  const [patients, doctors, stays, beds] = await Promise.all([
    supabase.from("patients").select("id, mrn, given_name, family_name").in("id", [...new Set(adm.map((a) => a.patient_id))]),
    supabase.from("profiles").select("id, full_name").in("id", [...new Set(adm.map((a) => a.attending_id))]),
    supabase.from("bed_stays").select("admission_id, bed_id").in("admission_id", ids).is("ends_at", null),
    supabase.from("beds").select("id, label"),
  ]);
  const pm = new Map(check(patients, "patients").map((p) => [p.id, p]));
  const dm = new Map(check(doctors, "staff").map((p) => [p.id, p.full_name]));
  const bm = new Map(check(beds, "beds").map((p) => [p.id, p.label]));
  const sm = new Map(check(stays, "stays").map((p) => [p.admission_id, bm.get(p.bed_id) ?? null]));
  return adm.map((a) => {
    const p = pm.get(a.patient_id);
    return {
      id: a.id,
      patientId: a.patient_id,
      patientName: p ? `${p.given_name} ${p.family_name}` : "Patient",
      mrn: p?.mrn ?? "",
      status: a.status as AdmissionStatus,
      type: a.admission_type as AdmissionType,
      reason: a.reason,
      attending: dm.get(a.attending_id) ?? "—",
      requestedAt: a.requested_at,
      admittedAt: a.admitted_at,
      bed: sm.get(a.id) ?? null,
      authorised: Boolean(a.discharge_authorised_at),
    };
  });
}

export async function getAdmissionDetail(supabase: ServerClient, id: string, clinic: { emergencyNeedsFinance: boolean }) {
  const admissionRes = await supabase.from("admissions").select("*").eq("id", id).maybeSingle();
  if (admissionRes.error) throw new Error(`admission: ${admissionRes.error.message}`);
  const admission = admissionRes.data;
  if (!admission) return null;
  const [patient, attending, stays, beds, clearances, summary, tasks, obs, reservations, billedDays] = await Promise.all([
    supabase.from("patients").select("id, mrn, given_name, family_name, date_of_birth, sex_at_birth").eq("id", admission.patient_id).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("id", admission.attending_id).maybeSingle(),
    supabase.from("bed_stays").select("id, bed_id, starts_at, ends_at, reason, note").eq("admission_id", id).order("starts_at"),
    supabase.from("beds").select("id, label, ward_id, out_of_service, housekeeping"),
    supabase.from("discharge_clearances").select("department, status, note, cleared_at, cleared_by").eq("admission_id", id),
    supabase.from("admission_summaries").select("summary, written_by, updated_at").eq("admission_id", id).maybeSingle(),
    supabase.from("care_tasks").select("id, title, due_at, status, not_done_reason, completed_at, completed_by").eq("admission_id", id).order("due_at"),
    supabase.from("observations").select("id, recorded_at, recorded_by, systolic, diastolic, pulse, resp_rate, temp_c, spo2, note, corrects_id, correction_reason").eq("admission_id", id).order("recorded_at", { ascending: false }).limit(50),
    supabase.from("bed_reservations").select("id, bed_id, reserved_from, reserved_until, status").eq("admission_id", id).eq("status", "active"),
    supabase.rpc("billed_bed_days", { p_admission: id }),
  ]);
  const bedRows = check(beds, "beds");
  const wards = check(await supabase.from("wards").select("id, name, active"), "wards");
  const wardName = new Map(wards.map((w) => [w.id, w.name]));
  const wardActive = new Map(wards.map((w) => [w.id, w.active]));
  const bedLabel = new Map(bedRows.map((b) => [b.id, `${wardName.get(b.ward_id) ?? ""} · ${b.label}`]));
  const openStays = check(await supabase.from("bed_stays").select("bed_id").is("ends_at", null), "occupancy");
  const occupied = new Set(openStays.map((s) => s.bed_id));
  const staffIds = [...new Set([
    ...check(clearances, "clearances").map((c) => c.cleared_by),
    ...check(tasks, "tasks").map((t) => t.completed_by).filter((x): x is string => Boolean(x)),
    ...check(obs, "observations").map((o) => o.recorded_by),
    admission.discharge_authorised_by, admission.discharged_by, admission.requested_by,
  ].filter((x): x is string => Boolean(x)))];
  const staff = staffIds.length ? check(await supabase.from("profiles").select("id, full_name").in("id", staffIds), "staff") : [];
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]));

  const allocatable = bedRows
    .filter((b) => wardActive.get(b.ward_id) !== false)
    .map((b) => ({ id: b.id, label: bedLabel.get(b.id) ?? b.label, state: bedState({ outOfService: b.out_of_service, housekeeping: b.housekeeping as "clean" | "dirty" | "cleaning", occupied: occupied.has(b.id) }) }))
    .filter((b) => b.state === "available");

  const clearanceRows = check(clearances, "clearances");
  const status = admission.status as AdmissionStatus;
  const blockers = dischargeBlockers({
    status,
    type: admission.admission_type as AdmissionType,
    emergencyNeedsFinance: clinic.emergencyNeedsFinance,
    authorised: Boolean(admission.discharge_authorised_at),
    hasSummary: Boolean(summary.data),
    clearances: clearanceRows.map((c) => c.department as ClearanceDepartment),
  });

  return {
    admission,
    patient: patient.data,
    attending: attending.data?.full_name ?? "—",
    stays: check(stays, "stays").map((s) => ({ ...s, bed: bedLabel.get(s.bed_id) ?? "Bed" })),
    clearances: clearanceRows.map((c) => ({ ...c, by: staffName.get(c.cleared_by) ?? "—" })),
    summary: summary.data ?? null,
    summaryReadable: !summary.error,
    tasks: check(tasks, "tasks").map((t) => ({ ...t, by: t.completed_by ? staffName.get(t.completed_by) ?? "—" : null })),
    observations: check(obs, "observations").map((o) => ({ ...o, by: staffName.get(o.recorded_by) ?? "—" })),
    reservations: check(reservations, "reservations").map((r) => ({ ...r, bed: bedLabel.get(r.bed_id) ?? "Bed" })),
    allocatable,
    blockers,
    billedBedDays: typeof billedDays.data === "number" ? billedDays.data : null,
    names: {
      authorisedBy: admission.discharge_authorised_by ? staffName.get(admission.discharge_authorised_by) ?? null : null,
      dischargedBy: admission.discharged_by ? staffName.get(admission.discharged_by) ?? null : null,
      requestedBy: admission.requested_by ? staffName.get(admission.requested_by) ?? null : null,
    },
  };
}

export async function getWardsForSetup(supabase: ServerClient) {
  const [wards, beds] = await Promise.all([
    supabase.from("wards").select("id, name, kind, active").order("name"),
    supabase.from("beds").select("id, label, ward_id, out_of_service").order("label"),
  ]);
  return { wards: check(wards, "wards"), beds: check(beds, "beds") };
}
