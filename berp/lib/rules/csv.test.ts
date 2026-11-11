import { describe, expect, test } from "vitest";
import { parseCsv, toCsv, validateImport } from "./csv";

describe("csv", () => {
  test("parses quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
    expect(() => parseCsv('a,"b')).toThrow(/Unclosed/);
  });
  test("customers: valid rows pass, bad rows report line numbers, nothing partial", () => {
    const r = validateImport("customers", "name,email,gstin,credit_limit\nKiran,k@x.in,27ABCDE1234F1Z5,50000\n,bad,,\nKiran,,,abc", {});
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: "Kiran", credit_limit_paise: 5000000, gstin: "27ABCDE1234F1Z5" });
    expect(r.errors.map((e) => e.line)).toEqual([3, 3, 4, 4]);
    expect(r.errors[0]!.message).toMatch(/name.*required/);
    expect(r.errors.some((e) => /duplicate customer/.test(e.message))).toBe(true);
  });
  test("items: header checks, tax code lookup, duplicates, money and quantity formats", () => {
    expect(validateImport("items", "sku\nA", {}).errors[0]!.message).toMatch(/Missing required column "name"/);
    expect(validateImport("items", "sku,name,colour\nA,B,red", {}).errors[0]!.message).toMatch(/Unknown column/);
    const ok = validateImport("items", "sku,name,sale_price,cost,tax_code,reorder_level\nW-1,Widget,1000.50,600,gst18,5", { GST18: "tax-id" });
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0]).toMatchObject({ sku: "W-1", sale_price_paise: 100050, cost_paise: 60000, tax_code_id: "tax-id", reorder_level: 5, kind: "stock" });
    const bad = validateImport("items", "sku,name,sale_price,tax_code\nW 1,A,12.345,GST99\nW-2,B,1,\nW-2,C,1,", {});
    expect(bad.rows).toHaveLength(1);
    expect(bad.errors.map((e) => e.message).join("|")).toMatch(/may only use letters.*does not exist.*not a valid amount.*duplicate sku/s);
  });
  test("items: tracking and barcode columns are validated", () => {
    const r = validateImport("items", "sku,name,tracking,barcode\nA,A,batch,890123\nB,B,lot,\nC,C,serial,890123\nD,D,none,caf\u00e9", {});
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ sku: "A", tracking: "batch", barcode: "890123" });
    expect(r.errors.map((e) => e.message).join("|")).toMatch(/tracking must be.*duplicate barcode.*printable/s);
  });
  test("files over the row limit are refused whole; exports neutralise spreadsheet formulas", () => {
    const big = "name\n" + Array.from({ length: 2001 }, (_, i) => `n${i}`).join("\n");
    expect(validateImport("suppliers", big, {}).errors[0]!.message).toMatch(/Too many rows/);
    expect(toCsv(["a"], [["=SUM(A1)"], ['x,"y"']])).toBe("a\r\n\"'=SUM(A1)\"\r\n\"x,\"\"y\"\"\"\r\n");
  });
});
