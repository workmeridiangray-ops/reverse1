import { parseMajor } from "./money";
import { parseQty } from "./qty";

/** Minimal RFC-4180 style CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface ParsedBoq { items: Array<{ code: string; description: string; unit: string; qty: number; rate: number }>; errors: string[] }
export function validateBoqCsv(text: string, existing: Set<string>): ParsedBoq {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const errors: string[] = []; const items: ParsedBoq["items"] = [];
  if (rows.length < 2) return { items, errors: ["The file needs a header row and at least one item row."] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(["code", "description", "unit", "quantity", "rate"].map((k) => [k, header.indexOf(k)]));
  const missing = Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k);
  if (missing.length) return { items, errors: [`Missing column(s): ${missing.join(", ")}. Expected: code,description,unit,quantity,rate`] };
  if (rows.length > 2001) return { items, errors: ["Maximum 2,000 rows per import."] };
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2; const g = (k: string) => (r[idx[k]!] ?? "").trim();
    try {
      const code = g("code"), description = g("description"), unit = g("unit");
      if (!code) throw new Error("code is empty");
      if (code.length > 40) throw new Error("code is too long");
      if (description.length < 2) throw new Error("description is too short");
      if (!unit || unit.length > 12) throw new Error("unit is empty or too long");
      if (seen.has(code.toLowerCase())) throw new Error(`duplicate code ${code} in file`);
      if (existing.has(code.toLowerCase())) throw new Error(`code ${code} already exists in this project`);
      const qty = parseQty(g("quantity"), "quantity"); const rate = parseMajor(g("rate"), "INR");
      if (rate < 0) throw new Error("rate is negative");
      seen.add(code.toLowerCase()); items.push({ code, description, unit, qty, rate });
    } catch (e) { errors.push(`Row ${line}: ${(e as Error).message}`); }
  });
  return { items, errors };
}

