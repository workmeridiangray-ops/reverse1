import "server-only";
import { notFound } from "next/navigation";
import { type Db, NotFound } from "./db";
import { contractValue, collectionState } from "@/lib/rules/billing";
import { amountFor } from "@/lib/rules/qty";

export interface Project {
  id: string; code: string; name: string; client_name: string; location: string | null; status: "tender" | "active" | "handover" | "closed";
  start_date: string | null; end_date: string | null;
}
/** Row-level security hides other tenants' and unassigned projects, so a guessed id is simply "not found". */
export async function getProject(db: Db, id: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await db.maybe<Project>("SELECT id,code,name,client_name,location,status,start_date,end_date FROM projects WHERE id = $1", [id]);
  if (!p) notFound();
  return p;
}

export interface BoqRow { id: string; code: string; description: string; unit: string; qty_milli: number; rate_minor: number; source: string; delta: number; }
export async function boqWithDeltas(db: Db, projectId: string): Promise<BoqRow[]> {
  return db.q<BoqRow>(
    `SELECT b.id,b.code,b.description,b.unit,b.qty_milli,b.rate_minor,b.source,
            COALESCE((SELECT sum(v.qty_delta_milli) FROM variations v WHERE v.boq_item_id = b.id AND v.status='approved'),0)::bigint delta
       FROM boq_items b WHERE b.project_id = $1 ORDER BY b.code`, [projectId]);
}

export interface Summary {
  contractValueMinor: number; verifiedValueMinor: number; claimedMinor: number; certifiedMinor: number; invoicedMinor: number;
  collectedMinor: number; outstandingMinor: number; disputedMinor: number; retentionHeldMinor: number; advanceRecoveredMinor: number;
}
export async function projectSummary(db: Db, projectId: string, internal: boolean): Promise<Summary> {
  const boq = await boqWithDeltas(db, projectId);
  const cv = contractValue(boq.map((b) => ({ qtyMilli: b.qty_milli, approvedDeltaMilli: Number(b.delta), rateMinor: b.rate_minor })));
  const rates = new Map(boq.map((b) => [b.id, b.rate_minor]));
  const ms = await db.q<{ boq_item_id: string; q: number }>("SELECT boq_item_id, sum(qty_milli)::bigint q FROM measurements WHERE project_id=$1 AND status='verified' GROUP BY 1", [projectId]);
  const verified = ms.reduce((a, m) => a + amountFor(Number(m.q), rates.get(m.boq_item_id) ?? 0), 0);
  const b = await db.one<{ claimed: number; certified: number; ret: number; adv: number }>(
    `SELECT COALESCE(sum(claimed_gross_minor) FILTER (WHERE status IN ('submitted','certified','invoiced')),0)::bigint claimed,
            COALESCE(sum(certified_gross_minor) FILTER (WHERE status IN ('certified','invoiced')),0)::bigint certified,
            COALESCE(sum(retention_minor) FILTER (WHERE status IN ('certified','invoiced')),0)::bigint ret,
            COALESCE(sum(advance_recovery_minor) FILTER (WHERE status IN ('certified','invoiced')),0)::bigint adv
       FROM bills WHERE project_id=$1`, [projectId]);
  const inv = await db.one<{ invoiced: number }>("SELECT COALESCE(sum(amount_minor),0)::bigint invoiced FROM client_invoices WHERE project_id=$1", [projectId]);
  const rec = await db.one<{ c: number }>("SELECT COALESCE(sum(amount_minor),0)::bigint c FROM receipts WHERE project_id=$1 AND reversed_at IS NULL", [projectId]);
  const dis = await db.one<{ d: number }>("SELECT COALESCE(sum(amount_minor),0)::bigint d FROM disputes WHERE project_id=$1 AND status='open'", [projectId]);
  const st = collectionState(inv.invoiced, [rec.c], [dis.d]);
  void internal;
  return { contractValueMinor: cv, verifiedValueMinor: verified, claimedMinor: b.claimed, certifiedMinor: b.certified, invoicedMinor: inv.invoiced,
    collectedMinor: rec.c, outstandingMinor: st.outstandingMinor, disputedMinor: dis.d, retentionHeldMinor: b.ret, advanceRecoveredMinor: b.adv };
}

export async function tenantLimits(db: Db, tenantId: string) {
  return db.one<{ max_projects: number; max_users: number; storage_mb: number; plan: string; projects: number; users: number; storage_bytes: number }>(
    `SELECT p.max_projects, p.max_users, p.storage_mb, p.name plan,
            (SELECT count(*) FROM projects WHERE status <> 'closed')::int projects,
            (SELECT count(*) FROM memberships WHERE status='active')::int + (SELECT count(*) FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::int users,
            COALESCE((SELECT sum(size_bytes) FROM files),0)::bigint storage_bytes
       FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`, [tenantId]);
}

import { UserError } from "./db";
/** Loads a project for update; refuses when it is closed (records are read-only after closure). */
export async function writableProject(db: Db, id: string): Promise<Project> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFound();
  const p = await db.one<Project>("SELECT id,code,name,client_name,location,status,start_date,end_date FROM projects WHERE id = $1 FOR UPDATE", [id]);
  if (p.status === "closed") throw new UserError("This project is closed; its records are read-only.");
  return p;
}

export async function closureChecks(db: Db, projectId: string) {
  const r = await db.one<{ snags: number; bills: number; vars: number; meas: number; rfis: number }>(
    `SELECT (SELECT count(*) FROM snags WHERE project_id=$1 AND status <> 'verified')::int snags,
            (SELECT count(*) FROM bills WHERE project_id=$1 AND status IN ('draft','submitted'))::int bills,
            (SELECT count(*) FROM variations WHERE project_id=$1 AND status IN ('draft','submitted'))::int vars,
            (SELECT count(*) FROM measurements WHERE project_id=$1 AND status='recorded')::int meas,
            (SELECT count(*) FROM rfis WHERE project_id=$1 AND status='open')::int rfis`, [projectId]);
  return [
    { ok: r.snags === 0, label: "All snags rectified and verified", detail: `${r.snags} open` },
    { ok: r.bills === 0, label: "No draft or submitted running bills", detail: `${r.bills} open` },
    { ok: r.vars === 0, label: "No unresolved variations", detail: `${r.vars} open` },
    { ok: r.meas === 0, label: "No unverified measurements", detail: `${r.meas} open` },
    { ok: r.rfis === 0, label: "No open RFIs", detail: `${r.rfis} open` },
  ];
}

