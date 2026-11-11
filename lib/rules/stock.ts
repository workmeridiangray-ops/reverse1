/** Stock level summaries for the pharmacy screen. Pure. */
import { type StockBatch, batchState, daysBetween, EXPIRING_SOON_DAYS, isEligible } from "./dispensing";

export interface StockSummary {
  /** units that can be dispensed today */
  usable: number;
  expired: number;
  quarantined: number;
  recalled: number;
  /** usable units that expire within the window */
  expiringSoon: number;
  outOfStock: boolean;
  /** at or below the reorder level (counting usable units only) */
  belowReorder: boolean;
  nextExpiry: string | null;
}

export function summarizeStock(batches: readonly StockBatch[], reorderLevel: number, today: string, soonDays = EXPIRING_SOON_DAYS): StockSummary {
  let usable = 0, expired = 0, quarantined = 0, recalled = 0, expiringSoon = 0;
  let nextExpiry: string | null = null;
  for (const b of batches) {
    const s = batchState(b, today);
    if (s === "expired") expired += b.onHand;
    else if (s === "quarantined") quarantined += b.onHand;
    else if (s === "recalled") recalled += b.onHand;
    if (isEligible(b, today)) {
      usable += b.onHand;
      if (daysBetween(today, b.expiryDate) <= soonDays) expiringSoon += b.onHand;
      if (nextExpiry === null || b.expiryDate < nextExpiry) nextExpiry = b.expiryDate;
    }
  }
  return { usable, expired, quarantined, recalled, expiringSoon, outOfStock: usable === 0, belowReorder: usable <= reorderLevel, nextExpiry };
}

/** Expired stock still on the shelf must be written off, not left to be picked by mistake. */
export const needsWriteOff = (b: StockBatch, today: string): boolean => b.onHand > 0 && b.expiryDate < today;
