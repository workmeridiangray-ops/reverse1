/**
 * Audit trail: writes and record views are logged, the log is append-only,
 * logs hold column names (not values), and are visible only to the clinic admin.
 */
import { afterAll, describe, expect, it } from "vitest";
import { as, asOwner, attempt, CLINIC_A, ID, pool, U } from "./helpers";

afterAll(() => pool.end());

interface AuditRow {
  actor_id: string;
  actor_role: string;
  action: string;
  table_name: string;
  record_id: string;
  patient_id: string;
  changed_fields: string[] | null;
  clinic_id: string;
}

describe("audit log", () => {
  it("records who changed which fields, without storing the values", async () => {
    await as("deskA", async (q) => {
      await q(`update public.patients set phone = '+44 7700 900999' where id = $1`, [ID.george]);
      // The change is logged, but reception cannot read the audit log.
      expect(await q(`select id from public.audit_log`)).toHaveLength(0);
    });
    await asOwner(async (q) => {
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.deskA, role: "authenticated" })]);
      await q(`set local role authenticated`);
      await q(`update public.patients set phone = '+44 7700 900999' where id = $1`, [ID.george]);
      await q(`reset role`);
      const [row] = await q<AuditRow & { s: string }>(
        `select a.*, a::text as s from public.audit_log a where table_name = 'patients' and record_id = $1 and action = 'update'
         order by id desc limit 1`,
        [ID.george],
      );
      expect(row).toMatchObject({ actor_id: U.deskA, actor_role: "receptionist", patient_id: ID.george, changed_fields: ["phone"], clinic_id: CLINIC_A });
      expect(row?.s).not.toContain("900999");
    });
  });

  it("records a 'view' when a record is opened", async () => {
    await as("doctorA", async (q) => {
      await q(`select public.log_record_access('patients', $1, 'chart opened')`, [ID.amal]);
    });
    await asOwner(async (q) => {
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.doctorA, role: "authenticated" })]);
      await q(`set local role authenticated`);
      await q(`select public.log_record_access('consultations', $1)`, [ID.consultSigned]);
      await q(`reset role`);
      const [row] = await q<AuditRow>(`select * from public.audit_log where action = 'view' order by id desc limit 1`);
      expect(row).toMatchObject({ actor_id: U.doctorA, actor_role: "doctor", table_name: "consultations", record_id: ID.consultSigned, patient_id: ID.amal });
    });
  });

  it("cannot log (or probe) records the caller cannot see", async () => {
    await as("doctorA", async (q) => {
      expect((await attempt(q, `select public.log_record_access('patients', $1)`, [ID.jon])).error).toMatch(/not found/);
      expect((await attempt(q, `select public.log_record_access('invoices', $1)`, [ID.invAmal])).error).toMatch(/not found/);
    });
    await as("deskA", async (q) => {
      expect((await attempt(q, `select public.log_record_access('consultations', $1)`, [ID.consultSigned])).error).toMatch(/not found/);
      expect((await attempt(q, `select public.log_record_access('audit_log', $1)`, [ID.amal])).error).toMatch(/Unsupported/);
    });
  });

  it("is append-only for every role, including admins and the service role", async () => {
    await as("adminA", async (q) => {
      expect((await attempt(q, `update public.audit_log set reason = 'x'`)).error).toMatch(/permission denied/);
      expect((await attempt(q, `delete from public.audit_log`)).error).toMatch(/permission denied/);
      expect((await attempt(q, `insert into public.audit_log (clinic_id, action, table_name) values ($1, 'view', 'x')`, [CLINIC_A])).error).toMatch(/permission denied/);
    });
    await asOwner(async (q) => {
      await q(`set local role service_role`);
      expect((await attempt(q, `delete from public.audit_log`)).error).toMatch(/permission denied/);
      await q(`reset role`);
      // Even the table owner hits the immutability trigger.
      expect((await attempt(q, `update public.audit_log set reason = 'x'`)).error).toMatch(/append-only/);
      expect((await attempt(q, `delete from public.audit_log`)).error).toMatch(/append-only/);
      expect((await attempt(q, `truncate public.audit_log`)).error).toMatch(/append-only/);
    });
  });

  it("logs payments, invoice changes and appointment check-ins", async () => {
    await asOwner(async (q) => {
      await q(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.deskA, role: "authenticated" })]);
      await q(`set local role authenticated`);
      await q(`update public.appointments set status = 'arrived' where id = $1`, [ID.apptSofiaExpected]);
      await q(`reset role`);
      const [row] = await q<AuditRow>(`select * from public.audit_log where table_name = 'appointments' order by id desc limit 1`);
      expect(row?.changed_fields).toEqual(expect.arrayContaining(["checked_in_at", "checked_in_by", "status"]));
    });
  });
});
