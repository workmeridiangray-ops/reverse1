import { describe, expect, it } from "vitest";
import { BomCycleError, convert, explode, lowLevelCodes, type BomDef } from "@/lib/domain/bom";
import { netForecast, runMrp } from "@/lib/domain/mrp";
import { jobCost } from "@/lib/domain/cost";
import { parseRupees, formatINR } from "@/lib/domain/money";
import { subWorkingDays } from "@/lib/domain/dates";

const boms: Record<string, BomDef> = {
  PUMP: { item: "PUMP", yieldPct: 100, lines: [{ component: "HOUSING", qtyPer: 1, scrapPct: 0 }, { component: "BOLT", qtyPer: 4, scrapPct: 5 }] },
  HOUSING: { item: "HOUSING", yieldPct: 80, lines: [{ component: "CASTING", qtyPer: 2, scrapPct: 0 }] },
};
const getBom = (i: string) => boms[i];

describe("BOM explosion", () => {
  it("explodes multi-level with scrap and yield", () => {
    const r = explode("PUMP", 10, getBom);
    const q = (i: string) => r.filter((x) => x.item === i).reduce((s, x) => s + x.qty, 0);
    expect(q("HOUSING")).toBeCloseTo(10);
    expect(q("BOLT")).toBeCloseTo(42);          // 10*4*1.05
    expect(q("CASTING")).toBeCloseTo(25);        // 10 / 0.8 * 2
  });
  it("detects cycles", () => {
    const cyc: Record<string, BomDef> = { A: { item: "A", yieldPct: 100, lines: [{ component: "B", qtyPer: 1, scrapPct: 0 }] }, B: { item: "B", yieldPct: 100, lines: [{ component: "A", qtyPer: 1, scrapPct: 0 }] } };
    expect(() => explode("A", 1, (i) => cyc[i])).toThrow(BomCycleError);
  });
  it("low-level codes put children below parents", () => {
    const c = lowLevelCodes(["PUMP", "HOUSING", "CASTING", "BOLT"], getBom);
    expect(c.get("PUMP")).toBe(0); expect(c.get("HOUSING")).toBe(1); expect(c.get("CASTING")).toBe(2);
  });
  it("converts only with approved factors", () => {
    expect(convert(2, "kg", "g", [{ from: "kg", to: "g", factor: 1000 }])).toBe(2000);
    expect(convert(500, "g", "kg", [{ from: "kg", to: "g", factor: 1000 }])).toBe(0.5);
    expect(() => convert(1, "kg", "m", [])).toThrow(/No approved conversion/);
  });
});

describe("MRP", () => {
  const items = [
    { id: "PUMP", code: "PUMP", kind: "make" as const, leadTimeDays: 3, lotSize: 5, safetyStock: 0, onHand: 2 },
    { id: "HOUSING", code: "HOUSING", kind: "make" as const, leadTimeDays: 2, lotSize: 1, safetyStock: 0, onHand: 0 },
    { id: "BOLT", code: "BOLT", kind: "buy" as const, leadTimeDays: 5, lotSize: 100, safetyStock: 0, onHand: 500 },
    { id: "CASTING", code: "CASTING", kind: "buy" as const, leadTimeDays: 10, lotSize: 10, safetyStock: 0, onHand: 0 },
  ];
  const base = { today: "2026-11-02", horizonDays: 90, items, forecasts: [], supplies: [], getBom, workingWeekdays: [1, 2, 3, 4, 5] };
  it("nets stock, rounds to lot size, explains and cascades", () => {
    const r = runMrp({ ...base, salesDemand: [{ item: "PUMP", qty: 10, date: "2026-11-20", source: "SO-1/1" }] });
    const pump = r.suggestions.find((s) => s.item === "PUMP")!;
    expect(pump.qty).toBe(10);                           // short 8 → lot of 5 → 10
    expect(pump.kind).toBe("production");
    expect(pump.reason.sources[0]!.source).toBe("SO-1/1");
    expect(pump.releaseDate).toBe("2026-11-17");         // 3 working days before Fri 20th
    expect(r.suggestions.some((s) => s.item === "HOUSING")).toBe(true);
    const casting = r.suggestions.find((s) => s.item === "CASTING")!;
    expect(casting.kind).toBe("purchase");
    expect(casting.qty % 10).toBe(0);
    expect(r.suggestions.find((s) => s.item === "BOLT")).toBeUndefined(); // 500 on hand covers 42
  });
  it("is deterministic and counts supply", () => {
    const inp = { ...base, salesDemand: [{ item: "PUMP", qty: 10, date: "2026-11-20", source: "SO-1/1" }], supplies: [{ item: "PUMP", qty: 8, date: "2026-11-10", source: "WO-1" }] };
    expect(runMrp(inp)).toEqual(runMrp(inp));
    expect(runMrp(inp).suggestions.find((s) => s.item === "PUMP")).toBeUndefined();
  });
  it("forecast is netted against confirmed orders, not added", () => {
    const orders = [{ item: "PUMP", qty: 6, date: "2026-11-15", source: "SO-1" }];
    const n = netForecast([{ item: "PUMP", periodStart: "2026-11-01", qty: 10 }], orders);
    expect(n[0]!.qty).toBe(4);
    expect(netForecast([{ item: "PUMP", periodStart: "2026-11-01", qty: 5 }], orders)).toEqual([]);
  });
  it("flags past release dates", () => {
    const r = runMrp({ ...base, salesDemand: [{ item: "CASTING", qty: 5, date: "2026-11-04", source: "SO-9" }] });
    expect(r.suggestions[0]!.releaseDate).toBe("2026-11-02");
    expect(r.suggestions[0]!.reason.note).toMatch(/past/);
  });
});

describe("costing", () => {
  it("separates material, labour, overhead, scrap and variance", () => {
    const c = jobCost({ materialIssued: [{ qty: 20, unitCostPaise: 5000 }], ops: [{ actualMin: 120, rateHourPaise: 30000, overheadPct: 50 }], completedQty: 9, scrapQty: 1, standardUnitPaise: 20000 });
    expect(c.material).toBe(100000); expect(c.labour).toBe(60000); expect(c.overhead).toBe(30000);
    expect(c.total).toBe(190000); expect(c.scrapCost).toBe(19000);
    expect(c.standardTotal).toBe(180000); expect(c.variance).toBe(10000);
  });
});
describe("money & dates", () => {
  it("parses strictly", () => {
    expect(parseRupees("1,250.5")).toBe(125050);
    expect(() => parseRupees("12.345")).toThrow();
    expect(formatINR(125050)).toBe("₹1,250.50");
  });
  it("skips weekends", () => { expect(subWorkingDays("2026-11-16", 1, new Set([1, 2, 3, 4, 5]))).toBe("2026-11-13"); });
});
