import { describe, expect, test } from "vitest";
import { CODE128_PATTERNS, CODE128_STOP, code128Svg, code128Values, code128Widths } from "./barcode";

describe("Code 128 B", () => {
  test("pattern table is structurally valid", () => {
    expect(CODE128_PATTERNS).toHaveLength(106);
    expect(new Set(CODE128_PATTERNS).size).toBe(106);
    for (const p of CODE128_PATTERNS) {
      const w = [...p].map(Number);
      expect(w.reduce((a, b) => a + b, 0), p).toBe(11);          // every symbol is 11 modules wide
      expect(w[0]! + w[2]! + w[4]!, p).toSatisfy((n: number) => n % 2 === 0); // bars have even parity (self-checking)
    }
    expect([...CODE128_STOP].map(Number).reduce((a, b) => a + b, 0)).toBe(13);
  });
  test("checksum matches the published example (PJJ123C: start A + 54; start B gives 55)", () => {
    const v = code128Values("PJJ123C");
    expect(v[0]).toBe(104);
    expect(v.at(-1)).toBe(55);
    expect(code128Values("A").slice(1)).toEqual([33, (104 + 33) % 103]);
  });
  test("total width = 11 per symbol + 13 for stop; rejects unencodable text", () => {
    const w = code128Widths("BERP-001");
    expect(w.reduce((a, b) => a + b, 0)).toBe(11 * (1 + 8 + 1) + 13);
    expect(() => code128Svg("")).toThrow();
    expect(() => code128Svg("é")).toThrow();
    expect(code128Svg("AB<")).not.toContain("<AB");
  });
});
