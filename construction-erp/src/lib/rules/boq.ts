import { RuleError, bpOf, divRound, lineAmount, parseMoney, parseQty, sum } from './money';

export const UNITS = ['m', 'm2', 'm3', 'sqm', 'cum', 'rm', 'nos', 'no', 'kg', 'tonne', 'mt', 'ltr', 'ls', 'set', 'bag', 'hr', 'day', 'sqft', 'rft'];

export interface ImportRow { row: number; code: string; description: string; unit: string; qty: bigint; ratePaise: bigint }
export interface ImportError { row: number; message: string }

function splitCsv(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map(s => s.trim());
}

/** The one agreed BOQ import format: code,description,unit,qty,rate  (rate in rupees). */
export function parseBoqCsv(text: string): { rows: ImportRow[]; errors: ImportError[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  const errors: ImportError[] = []; const rows: ImportRow[] = [];
  if (lines.length === 0) return { rows, errors: [{ row: 0, message: 'The file is empty' }] };
  const head = splitCsv(lines[0]).map(h => h.toLowerCase());
  const want = ['code', 'description', 'unit', 'qty', 'rate'];
  if (want.some((w, i) => head[i] !== w)) return { rows, errors: [{ row: 1, message: `Header must be exactly: ${want.join(',')}` }] };
  if (lines.length > 5001) return { rows, errors: [{ row: 0, message: 'Maximum 5000 rows per import' }] };
  const seen = new Set<string>();
  lines.slice(1).forEach((l, idx) => {
    const row = idx + 2; const c = splitCsv(l);
    try {
      if (c.length !== 5) throw new RuleError(`expected 5 columns, found ${c.length}`);
      const [code, description, unitRaw, q, r] = c;
      if (!code) throw new RuleError('code is required');
      if (seen.has(code)) throw new RuleError(`duplicate code ${code} in file`);
      if (!description) throw new RuleError('description is required');
      const unit = unitRaw.toLowerCase();
      if (!UNITS.includes(unit)) throw new RuleError(`unknown unit "${unitRaw}"`);
      const qty = parseQty(q); const ratePaise = parseMoney(r);
      if (ratePaise < 0n) throw new RuleError('rate cannot be negative');
      seen.add(code); rows.push({ row, code, description, unit, qty, ratePaise });
    } catch (e) { errors.push({ row, message: (e as Error).message }); }
  });
  return { rows, errors };
}

/** Rate analysis: (material + labour + equipment) plus overhead & profit. */
export function analyseRate(matPaise: bigint, labPaise: bigint, eqpPaise: bigint, overheadBp: number): bigint {
  const direct = matPaise + labPaise + eqpPaise;
  return direct + bpOf(direct, overheadBp);
}
export const boqTotal = (items: { qtyMilli: bigint; ratePaise: bigint }[]) => sum(items.map(i => lineAmount(i.qtyMilli, i.ratePaise)));
export const marginBp = (tender: bigint, cost: bigint) => (tender === 0n ? 0 : Number(divRound((tender - cost) * 10000n, tender)));
