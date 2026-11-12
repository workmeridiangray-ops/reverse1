import { describe, it, expect } from "vitest";
import { parseMoney, parseQty, formatMoney, formatQty, lineAmounts, mulDiv } from "@/lib/money";
import { parseCsv, csvCell, toCsv } from "@/lib/csv";
import { code128B, CODE128_PATTERNS } from "@/lib/barcode";
import { verifyTotp, totpAt, newSecret } from "@/lib/auth/totp";
import { passwordProblem, hashPassword, verifyPassword } from "@/lib/auth/password";

describe("money and quantity", () => {
  it("parses exactly, rejecting excess precision", () => {
    expect(parseMoney("1,250.50")).toBe(125050); expect(parseMoney("0.07")).toBe(7);
    expect(() => parseMoney("1.234")).toThrow(); expect(() => parseMoney("-5")).toThrow(); expect(() => parseMoney("abc")).toThrow();
    expect(parseQty("2.5")).toBe(2500); expect(() => parseQty("0")).toThrow(); expect(() => parseQty("1.2345")).toThrow();
  });
  it("formats with Indian grouping", () => { expect(formatMoney(123456789)).toBe("₹12,34,567.89"); expect(formatMoney(-5)).toBe("-₹0.05"); expect(formatQty(2500)).toBe("2.5"); });
  it("rounds half-up and keeps tax/discount exact", () => {
    expect(mulDiv(1, 1, 2)).toBe(1);   // 0.5 -> 1
    expect(lineAmounts(3000, 10000, 1000, 1800)).toEqual({ net: 27000, tax: 4860, total: 31860 });
    expect(lineAmounts(12000, 1999, 0, 500, 12000)).toEqual({ net: 1999, tax: 100, total: 2099 });   // 12 base units sold as one box
  });
});
describe("csv", () => {
  it("round-trips quotes/newlines and neutralises formulas", () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\n'); expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)"); expect(csvCell("-12.5")).toBe("-12.5"); expect(toCsv(["h"], [["a,b"]])).toBe('h\r\n"a,b"\r\n');
  });
});
describe("barcode", () => {
  it("has a valid Code 128 pattern table (each symbol 11 modules, stop 13)", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((s, c) => s + Number(c), 0)).toBe(i === 106 ? 13 : 11));
    expect(code128B("ABC123").bars.length).toBeGreaterThan(20); expect(() => code128B("é")).toThrow();
  });
});
describe("auth primitives", () => {
  it("TOTP matches RFC 6238 test vector and tolerates one step of drift", () => {
    // RFC 6238 SHA1 secret "12345678901234567890" base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ, T=59s -> 94287082 (8 digits) -> last 6 = 287082
    expect(totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000)).toBe("287082");
    const s = newSecret(); const now = Date.now(); expect(verifyTotp(s, totpAt(s, now - 30000), now)).toBe(true); expect(verifyTotp(s, totpAt(s, now - 120000), now)).toBe(false);
  });
  it("hashes and policy", async () => {
    const h = await hashPassword("Correct-horse9"); expect(await verifyPassword("Correct-horse9", h)).toBe(true); expect(await verifyPassword("wrong", h)).toBe(false);
    expect(passwordProblem("short1")).toBeTruthy(); expect(passwordProblem("nodigitshere")).toBeTruthy(); expect(passwordProblem("Longenough12")).toBeNull();
  });
});
