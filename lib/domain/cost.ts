import { roundPaise } from "./money";
export type CostInput = {
  materialIssued: { qty: number; unitCostPaise: number }[];
  ops: { actualMin: number; rateHourPaise: number; overheadPct: number }[];
  completedQty: number; scrapQty: number;
  standardUnitPaise: number; scrapRecovery?: number;
};
export type JobCost = { material: number; labour: number; overhead: number; total: number; unitActual: number; standardTotal: number; variance: number; scrapCost: number };
/**
 * Operational costing method (agreed worked example in docs/costing.md):
 *  material = Σ issued qty × movement unit cost; labour = actual minutes/60 × work-centre rate;
 *  overhead = labour × work-centre overhead %. Scrap is not spread over good units:
 *  scrap cost = scrap/(good+scrap) × total is shown separately and still sits in job cost.
 *  Variance = actual total − standard unit × good output (positive = adverse).
 */
export function jobCost(i: CostInput): JobCost {
  const material = roundPaise(i.materialIssued.reduce((s, m) => s + m.qty * m.unitCostPaise, 0));
  const labour = roundPaise(i.ops.reduce((s, o) => s + (o.actualMin / 60) * o.rateHourPaise, 0));
  const overhead = roundPaise(i.ops.reduce((s, o) => s + (o.actualMin / 60) * o.rateHourPaise * (o.overheadPct / 100), 0));
  const total = material + labour + overhead;
  const units = i.completedQty;
  const standardTotal = roundPaise(i.standardUnitPaise * units);
  const scrapCost = i.completedQty + i.scrapQty > 0 ? roundPaise((i.scrapQty / (i.completedQty + i.scrapQty)) * total) : 0;
  return { material, labour, overhead, total, unitActual: units > 0 ? roundPaise(total / units) : 0, standardTotal, variance: total - standardTotal, scrapCost };
}
