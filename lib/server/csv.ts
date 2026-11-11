/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur.trim()); if (row.some((x) => x !== "")) rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  row.push(cur.trim()); if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? "'" + s : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(",")).join("\r\n");
