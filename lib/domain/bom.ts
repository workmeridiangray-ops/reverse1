export type BomLine = { component: string; qtyPer: number; scrapPct: number };
export type BomDef = { item: string; yieldPct: number; lines: BomLine[] };
export type Requirement = { item: string; qty: number; level: number; parent: string; path: string[] };

/** Required component qty for a parent quantity, honouring yield loss and scrap allowance. */
export function componentQty(parentQty: number, line: BomLine, yieldPct: number): number {
  return (parentQty / (yieldPct / 100)) * line.qtyPer * (1 + line.scrapPct / 100);
}
export class BomCycleError extends Error { constructor(public path: string[]) { super("BOM cycle: " + path.join(" → ")); } }

/** Multi-level explosion. `getBom` returns the effective released BOM for an item, or undefined for leaf/purchased items. */
export function explode(root: string, qty: number, getBom: (item: string) => BomDef | undefined): Requirement[] {
  const out: Requirement[] = [];
  const walk = (item: string, q: number, level: number, stack: string[]) => {
    if (stack.includes(item)) throw new BomCycleError([...stack, item]);
    const bom = getBom(item);
    if (!bom) return;
    for (const l of bom.lines) {
      const cq = componentQty(q, l, bom.yieldPct);
      out.push({ item: l.component, qty: cq, level: level + 1, parent: item, path: [...stack, item] });
      walk(l.component, cq, level + 1, [...stack, item]);
    }
  };
  walk(root, qty, 0, []);
  return out;
}
/** Low-level code: deepest level an item appears at, so MRP can process parents before children. */
export function lowLevelCodes(items: string[], getBom: (i: string) => BomDef | undefined): Map<string, number> {
  const code = new Map<string, number>(items.map((i) => [i, 0]));
  const visit = (item: string, level: number, stack: string[]) => {
    if (stack.includes(item)) throw new BomCycleError([...stack, item]);
    if ((code.get(item) ?? 0) < level) code.set(item, level);
    const b = getBom(item); if (!b) return;
    for (const l of b.lines) visit(l.component, level + 1, [...stack, item]);
  };
  for (const i of items) visit(i, 0, []);
  return code;
}
/** Unit conversion with explicit approved factors only. */
export function convert(qty: number, from: string, to: string, factors: { from: string; to: string; factor: number }[]): number {
  if (from === to) return qty;
  const f = factors.find((x) => x.from === from && x.to === to);
  if (f) return qty * f.factor;
  const r = factors.find((x) => x.from === to && x.to === from);
  if (r) return qty / r.factor;
  throw new Error(`No approved conversion from ${from} to ${to}`);
}
