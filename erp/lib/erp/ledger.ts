import type { Db } from "../db";
import { UserError } from "../errors";
import { audit } from "../audit";

export interface JLine { account: string; debit?: number; credit?: number; branchId?: string | null; memo?: string }
const cache = new Map<string, string>();

/** Resolves a system account key (e.g. "ar") or an account UUID to the account id for this company. */
export async function acct(db: Db, tenantId: string, keyOrId: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/.test(keyOrId)) return keyOrId;
  const r = await db.query("select id from accounts where tenant_id=$1 and system_key=$2", [tenantId, keyOrId]);
  if (!r.rows[0]) throw new UserError(`Ledger account "${keyOrId}" is not configured`);
  return r.rows[0].id;
}

export interface PostInput {
  tenantId: string; userId: string; date: string; memo: string; sourceType?: string; sourceId?: string; lines: JLine[];
}
/** Creates and posts a balanced journal in one step. The database re-checks balance and the period lock at commit. */
export async function postJournal(db: Db, p: PostInput): Promise<string> {
  const lines = p.lines.filter((l) => (l.debit ?? 0) + (l.credit ?? 0) > 0);
  const d = lines.reduce((s, l) => s + (l.debit ?? 0), 0), c = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (lines.length < 2 || d !== c || d === 0) throw new UserError(`Journal does not balance (debit ${d}, credit ${c})`);
  const num = (await db.query("select next_number($1,'journal') n", [p.tenantId])).rows[0].n;
  const j = (await db.query(
    `insert into journals(tenant_id,number,entry_date,memo,status,source_type,source_id,created_by)
     values ($1,$2,$3,$4,'draft',$5,$6,$7) returning id`, [p.tenantId, num, p.date, p.memo, p.sourceType ?? null, p.sourceId ?? null, p.userId])).rows[0].id;
  for (const l of lines) {
    await db.query(`insert into journal_lines(tenant_id,journal_id,account_id,debit_paise,credit_paise,branch_id,memo) values ($1,$2,$3,$4,$5,$6,$7)`,
      [p.tenantId, j, await acct(db, p.tenantId, l.account), l.debit ?? 0, l.credit ?? 0, l.branchId ?? null, l.memo ?? null]);
  }
  await db.query("update journals set status='posted', posted_by=$2, posted_at=now() where id=$1", [j, p.userId]);
  return j;
}

/** Reverses a posted journal with a mirror entry dated `date` (must be in an open period). Original is never edited. */
export async function reverseJournal(db: Db, tenantId: string, userId: string, journalId: string, reason: string, date: string): Promise<string> {
  if (!reason || reason.trim().length < 3) throw new UserError("A reason is required to reverse a posted entry.", { reason: "Required" });
  const j = (await db.query("select * from journals where id=$1 for update", [journalId])).rows[0];
  if (!j) throw new UserError("Journal not found");
  if (j.status !== "posted") throw new UserError(`Journal ${j.number} is ${j.status} and cannot be reversed.`);
  const ls = (await db.query("select * from journal_lines where journal_id=$1", [journalId])).rows;
  const num = (await db.query("select next_number($1,'journal') n", [tenantId])).rows[0].n;
  const r = (await db.query(
    `insert into journals(tenant_id,number,entry_date,memo,status,source_type,source_id,reverses_id,reversal_reason,created_by)
     values ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9) returning id`,
    [tenantId, num, date, `Reversal of ${j.number}: ${reason}`, j.source_type, j.source_id, journalId, reason, userId])).rows[0].id;
  for (const l of ls) {
    await db.query(`insert into journal_lines(tenant_id,journal_id,account_id,debit_paise,credit_paise,branch_id,memo) values ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, r, l.account_id, l.credit_paise, l.debit_paise, l.branch_id, l.memo]);
  }
  await db.query("update journals set status='posted', posted_by=$2, posted_at=now() where id=$1", [r, userId]);
  await db.query("update journals set status='reversed' where id=$1", [journalId]);
  await audit(db, { tenantId, actorUserId: userId, action: "journal.reversed", entityType: "journal", entityId: journalId, detail: { reversal: r }, reason });
  return r;
}

export const today = () => new Date().toISOString().slice(0, 10);
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
