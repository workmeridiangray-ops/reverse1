/** CSV parsing and row validation for imports. Pure. Handles quotes, escaped quotes, CRLF and a UTF-8 BOM. */
import { parseInr } from "./money";

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cell += ch;
  }
  if (inQ) throw new Error("Unclosed quote in CSV");
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export type ImportKind = "customers" | "suppliers" | "items";
export const TEMPLATES: Record<ImportKind, string[]> = {
  customers: ["name", "email", "phone", "gstin", "credit_limit", "payment_terms_days"],
  suppliers: ["name", "email", "phone", "gstin"],
  items: ["sku", "name", "kind", "unit", "sale_price", "cost", "tax_code", "reorder_level", "tracking", "barcode"],
};
const REQUIRED: Record<ImportKind, string[]> = { customers: ["name"], suppliers: ["name"], items: ["sku", "name"] };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ROWS = 2000;

export type RowError = { line: number; message: string };
export type Parsed = { rows: Record<string, unknown>[]; errors: RowError[]; total: number };

export function validateImport(kind: ImportKind, text: string, taxCodes: Record<string, string>): Parsed {
  const all = parseCsv(text);
  const errors: RowError[] = [];
  if (all.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty" }], total: 0 };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const known = TEMPLATES[kind];
  const unknown = header.filter((h) => !known.includes(h));
  if (unknown.length) errors.push({ line: 1, message: `Unknown column(s): ${unknown.join(", ")}. Expected: ${known.join(", ")}` });
  for (const r of REQUIRED[kind]) if (!header.includes(r)) errors.push({ line: 1, message: `Missing required column "${r}"` });
  if (errors.length) return { rows: [], errors, total: all.length - 1 };
  const body = all.slice(1);
  if (body.length > MAX_ROWS) return { rows: [], errors: [{ line: 1, message: `Too many rows (${body.length}); the limit is ${MAX_ROWS} per file` }], total: body.length };
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = (cells[i] ?? "").trim()));
    const fail = (m: string) => errors.push({ line, message: m });
    const before = errors.length;
    for (const r of REQUIRED[kind]) if (!rec[r]) fail(`"${r}" is required`);
    if (rec.email && !EMAIL.test(rec.email)) fail(`"${rec.email}" is not a valid email`);
    if (rec.gstin && !GSTIN.test(rec.gstin.toUpperCase())) fail(`"${rec.gstin}" is not a valid GSTIN`);
    const money = (k: string): number | null => {
      if (!rec[k]) return null;
      try { return parseInr(rec[k]!); } catch { fail(`${k} "${rec[k]}" is not a valid amount`); return null; }
    };
    const out: Record<string, unknown> = {};
    if (kind === "customers") {
      Object.assign(out, { name: rec.name, email: rec.email || null, phone: rec.phone || null, gstin: rec.gstin ? rec.gstin.toUpperCase() : null, credit_limit_paise: money("credit_limit") });
      if (rec.payment_terms_days) { const n = Number(rec.payment_terms_days); if (!Number.isInteger(n) || n < 0 || n > 365) fail("payment_terms_days must be a whole number from 0 to 365"); else out.payment_terms_days = n; }
      const key = rec.name!.toLowerCase();
      if (rec.name && seen.has(key)) fail(`duplicate customer "${rec.name}" in this file`); seen.add(key);
    } else if (kind === "suppliers") {
      Object.assign(out, { name: rec.name, email: rec.email || null, phone: rec.phone || null, gstin: rec.gstin ? rec.gstin.toUpperCase() : null });
      const key = rec.name!.toLowerCase();
      if (rec.name && seen.has(key)) fail(`duplicate supplier "${rec.name}" in this file`); seen.add(key);
    } else {
      if (rec.sku && !/^[A-Za-z0-9._-]{1,40}$/.test(rec.sku)) fail(`sku "${rec.sku}" may only use letters, numbers, . _ - (max 40)`);
      const k = rec.kind || "stock"; if (!["stock", "service"].includes(k)) fail(`kind must be stock or service`);
      const tc = rec.tax_code ? taxCodes[rec.tax_code.toUpperCase()] : null;
      if (rec.tax_code && !tc) fail(`tax_code "${rec.tax_code}" does not exist in this workspace`);
      let reorder = 0; if (rec.reorder_level) { reorder = Number(rec.reorder_level); if (!(reorder >= 0) || !/^\d+(\.\d{1,3})?$/.test(rec.reorder_level)) fail("reorder_level must be a number with up to 3 decimals"); }
      const tr = rec.tracking || "none"; if (!["none", "batch", "serial"].includes(tr)) fail("tracking must be none, batch or serial"); else if (tr !== "none" && k !== "stock") fail("only stock items can be batch or serial tracked");
      if (rec.barcode && !/^[\x20-\x7E]{1,40}$/.test(rec.barcode)) fail("barcode must be 1–40 printable characters");
      if (rec.barcode) { const bk = "bc:" + rec.barcode.toLowerCase(); if (seen.has(bk)) fail(`duplicate barcode "${rec.barcode}" in this file`); seen.add(bk); }
      Object.assign(out, { tracking: tr, barcode: rec.barcode || null, sku: rec.sku, name: rec.name, kind: k, unit: rec.unit || "nos", sale_price_paise: money("sale_price") ?? 0, cost_paise: money("cost") ?? 0, tax_code_id: tc ?? null, reorder_level: reorder });
      const key = (rec.sku ?? "").toLowerCase();
      if (rec.sku && seen.has(key)) fail(`duplicate sku "${rec.sku}" in this file`); seen.add(key);
    }
    if (errors.length === before) rows.push(out);
  });
  return { rows, errors, total: body.length };
}

export const csvEscape = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"` : s; };
export const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
