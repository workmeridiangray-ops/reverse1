/**
 * Visual mapping for every status in the product. Each status gets a tone
 * (colour), an icon (shape) AND a text label, so meaning never depends on
 * colour alone (WCAG 1.4.1). lib/ui/status.test.ts enforces this.
 */
import type { AppointmentStatus } from "@/lib/rules/scheduling";
import type { InsuranceStatus, InvoiceState, PaymentStatus } from "@/lib/rules/invoice";
import type { RoomState } from "@/lib/rules/reception";
import type { ConsentState } from "@/lib/rules/patient";
import { STATUS_LABEL } from "@/lib/rules/appointment-status";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "critical" | "brand";
export type IconName =
  | "check"
  | "clock"
  | "alert"
  | "x"
  | "door"
  | "user"
  | "coin"
  | "hourglass"
  | "shield"
  | "ban"
  | "pencil"
  | "dot"
  | "wrench"
  | "flag"
  | "lock";

export interface StatusVisual {
  tone: Tone;
  icon: IconName;
  label: string;
}

export const APPOINTMENT_VISUAL: Record<AppointmentStatus, StatusVisual> = {
  scheduled: { tone: "neutral", icon: "clock", label: STATUS_LABEL.scheduled },
  arrived: { tone: "info", icon: "user", label: STATUS_LABEL.arrived },
  in_room: { tone: "brand", icon: "door", label: STATUS_LABEL.in_room },
  completed: { tone: "ok", icon: "check", label: STATUS_LABEL.completed },
  cancelled: { tone: "neutral", icon: "x", label: STATUS_LABEL.cancelled },
  no_show: { tone: "warn", icon: "ban", label: STATUS_LABEL.no_show },
};

export const PAYMENT_VISUAL: Record<PaymentStatus | "none", StatusVisual> = {
  none: { tone: "neutral", icon: "dot", label: "No invoice" },
  draft: { tone: "neutral", icon: "pencil", label: "Draft" },
  void: { tone: "neutral", icon: "x", label: "Void" },
  unpaid: { tone: "danger", icon: "coin", label: "Unpaid" },
  partially_paid: { tone: "warn", icon: "coin", label: "Part paid" },
  awaiting_insurance: { tone: "info", icon: "hourglass", label: "Awaiting insurer" },
  paid: { tone: "ok", icon: "check", label: "Paid" },
  overpaid: { tone: "warn", icon: "alert", label: "Overpaid" },
};

export const INVOICE_STATE_VISUAL: Record<InvoiceState, StatusVisual> = {
  draft: { tone: "neutral", icon: "pencil", label: "Draft" },
  issued: { tone: "info", icon: "flag", label: "Issued" },
  void: { tone: "neutral", icon: "x", label: "Void" },
};

export const INSURANCE_VISUAL: Record<InsuranceStatus, StatusVisual> = {
  none: { tone: "neutral", icon: "dot", label: "Self-pay" },
  pending: { tone: "info", icon: "hourglass", label: "Claim pending" },
  settled: { tone: "ok", icon: "shield", label: "Insurer settled" },
  denied: { tone: "danger", icon: "ban", label: "Claim denied" },
};

export const ROOM_VISUAL: Record<RoomState, StatusVisual> = {
  free: { tone: "ok", icon: "check", label: "Free" },
  occupied: { tone: "brand", icon: "user", label: "In use" },
  reserved_soon: { tone: "warn", icon: "clock", label: "Needed soon" },
  out_of_service: { tone: "neutral", icon: "wrench", label: "Out of service" },
};

export const CONSENT_VISUAL: Record<ConsentState, StatusVisual> = {
  complete: { tone: "ok", icon: "shield", label: "Consent on file" },
  missing: { tone: "danger", icon: "alert", label: "Consent missing" },
  outdated: { tone: "warn", icon: "alert", label: "Consent outdated" },
};

export const NOTE_VISUAL = {
  critical: { tone: "critical", icon: "flag", label: "Critical" },
  unsigned: { tone: "warn", icon: "pencil", label: "Unsigned note" },
  signed: { tone: "ok", icon: "lock", label: "Signed" },
  none: { tone: "neutral", icon: "dot", label: "No note yet" },
} as const satisfies Record<string, StatusVisual>;

export const ALL_VISUAL_SETS = {
  APPOINTMENT_VISUAL,
  PAYMENT_VISUAL,
  INVOICE_STATE_VISUAL,
  INSURANCE_VISUAL,
  ROOM_VISUAL,
  CONSENT_VISUAL,
  NOTE_VISUAL,
} as const;
