import { subWorkingDays } from "./dates";
import { type BomDef, componentQty, lowLevelCodes } from "./bom";

export type MrpItem = { id: string; code: string; kind: "make" | "buy" | "subcontract"; leadTimeDays: number; lotSize: number; safetyStock: number; onHand: number };
export type DemandLine = { item: string; qty: number; date: string; source: string };
export type Supply = { item: string; qty: number; date: string; source: string };
export type Forecast = { item: string; periodStart: string; qty: number };
export type MrpInput = {
  today: string; horizonDays: number; items: MrpItem[]; salesDemand: DemandLine[]; forecasts: Forecast[];
  supplies: Supply[]; getBom: (item: string) => BomDef | undefined; workingWeekdays: number[];
  /** Quantity already reserved (committed to existing jobs) is excluded from available on-hand. */
};
export type Suggestion = {
  item: string; kind: "purchase" | "production"; qty: number; needDate: string; releaseDate: string;
  reason: { shortage: number; projectedBefore: number; onHand: number; safetyStock: number; lotSize: number; leadTimeDays: number; sources: { source: string; qty: number; date: string }[]; note: string };
};
export type MrpResult = { suggestions: Suggestion[]; assumptions: string[]; netForecastTotal: number };

/**
 * Forecast consumption: forecast demand in a period is reduced by confirmed orders due in the same
 * period, so the same demand is never counted twice.
 */
export function netForecast(forecasts: Forecast[], orders: DemandLine[]): DemandLine[] {
  const out: DemandLine[] = [];
  for (const f of forecasts) {
    const start = f.periodStart;
    const end = new Date(start + "T00:00:00Z"); end.setUTCMonth(end.getUTCMonth() + 1);
    const endS = end.toISOString().slice(0, 10);
    const confirmed = orders.filter((o) => o.item === f.item && o.date >= start && o.date < endS).reduce((s, o) => s + o.qty, 0);
    const rem = f.qty - confirmed;
    if (rem > 0) out.push({ item: f.item, qty: rem, date: start, source: `forecast ${start.slice(0, 7)} (net of ${confirmed} confirmed)` });
  }
  return out;
}

const ceilToLot = (q: number, lot: number) => Math.ceil(q / lot - 1e-9) * lot;

/** Bounded, deterministic, infinite-capacity MRP. Same input → same output. */
export function runMrp(inp: MrpInput): MrpResult {
  const working = new Set(inp.workingWeekdays);
  const horizonEnd = new Date(inp.today + "T00:00:00Z");
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + inp.horizonDays);
  const horizon = horizonEnd.toISOString().slice(0, 10);
  const byId = new Map(inp.items.map((i) => [i.id, i]));
  const lowLevel = lowLevelCodes(inp.items.map((i) => i.id), inp.getBom);
  const order = [...inp.items].sort((a, b) => (lowLevel.get(a.id)! - lowLevel.get(b.id)!) || a.code.localeCompare(b.code));
  const net = netForecast(inp.forecasts, inp.salesDemand);
  const demand: DemandLine[] = [...inp.salesDemand, ...net].filter((d) => d.date <= horizon);
  const suggestions: Suggestion[] = [];

  for (const item of order) {
    const gross = demand.filter((d) => d.item === item.id).sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
    const supplies = inp.supplies.filter((s) => s.item === item.id);
    const events = [
      ...gross.map((g) => ({ date: g.date, delta: -g.qty, g, s: undefined as Supply | undefined })),
      ...supplies.map((s) => ({ date: s.date < inp.today ? inp.today : s.date, delta: s.qty, g: undefined as DemandLine | undefined, s })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.delta - a.delta); // supplies before demand on the same day
    let projected = item.onHand;
    const contributing: { source: string; qty: number; date: string }[] = [];
    for (const e of events) {
      projected += e.delta;
      if (e.g) contributing.push({ source: e.g.source, qty: e.g.qty, date: e.g.date });
      if (projected < item.safetyStock - 1e-9) {
        const before = projected;
        const shortage = item.safetyStock - projected;
        const qty = ceilToLot(shortage, item.lotSize);
        const needDate = e.date < inp.today ? inp.today : e.date;
        let releaseDate = subWorkingDays(needDate, item.leadTimeDays, working);
        let note = "";
        if (releaseDate < inp.today) { note = `Release date ${releaseDate} is in the past — expedite or accept a later delivery.`; releaseDate = inp.today; }
        suggestions.push({
          item: item.id, kind: item.kind === "buy" ? "purchase" : "production", qty, needDate, releaseDate,
          reason: { shortage, projectedBefore: before, onHand: item.onHand, safetyStock: item.safetyStock, lotSize: item.lotSize, leadTimeDays: item.leadTimeDays, sources: [...contributing], note },
        });
        projected += qty;
        // Planned order creates dependent demand on its components at its release date.
        const bom = item.kind !== "buy" ? inp.getBom(item.id) : undefined;
        if (bom) for (const l of bom.lines) {
          if (byId.has(l.component)) demand.push({ item: l.component, qty: componentQty(qty, l, bom.yieldPct), date: releaseDate, source: `planned ${item.code} ×${qty} (released ${releaseDate})` });
        }
      }
    }
  }
  return {
    suggestions,
    netForecastTotal: net.reduce((s, n) => s + n.qty, 0),
    assumptions: [
      "Infinite capacity: work-centre load is checked at scheduling, not by MRP.",
      "Lead times are in working days from the plant shift calendar.",
      "Forecast is netted against confirmed orders in the same month; it is never added on top.",
      "Suggestions are not orders — each must be released deliberately.",
    ],
  };
}
