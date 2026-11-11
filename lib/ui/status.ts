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
import type { StoredAllergyStatus } from "@/lib/rules/allergy";
import { FLAG_LABEL, type ResultFlag } from "@/lib/rules/lab-flags";
import { LAB_ORDER_LABEL, type LabOrderStatus } from "@/lib/rules/lab-orders";
import type { BatchState, ExpiryBand } from "@/lib/rules/dispensing";
import { REQUEST_LABEL, type RequestStatus } from "@/lib/rules/portal";

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

export const LAB_FLAG_VISUAL: Record<ResultFlag, StatusVisual> = {
  normal: { tone: "ok", icon: "check", label: FLAG_LABEL.normal },
  low: { tone: "warn", icon: "alert", label: FLAG_LABEL.low },
  high: { tone: "warn", icon: "alert", label: FLAG_LABEL.high },
  critical_low: { tone: "critical", icon: "flag", label: FLAG_LABEL.critical_low },
  critical_high: { tone: "critical", icon: "flag", label: FLAG_LABEL.critical_high },
  unflagged: { tone: "neutral", icon: "dot", label: FLAG_LABEL.unflagged },
};

export const LAB_ORDER_VISUAL: Record<LabOrderStatus, StatusVisual> = {
  ordered: { tone: "neutral", icon: "clock", label: LAB_ORDER_LABEL.ordered },
  collected: { tone: "info", icon: "hourglass", label: LAB_ORDER_LABEL.collected },
  resulted: { tone: "ok", icon: "check", label: LAB_ORDER_LABEL.resulted },
  cancelled: { tone: "neutral", icon: "x", label: LAB_ORDER_LABEL.cancelled },
};

export const ALLERGY_CHECK_VISUAL: Record<StoredAllergyStatus, StatusVisual> = {
  clear: { tone: "ok", icon: "shield", label: "Allergy check clear" },
  overridden: { tone: "danger", icon: "alert", label: "Allergy warning overridden" },
  unchecked: { tone: "warn", icon: "alert", label: "Allergy check not run" },
  no_allergy_record: { tone: "warn", icon: "alert", label: "No allergy record" },
};

export const RESULT_RELEASE_VISUAL = {
  released: { tone: "ok", icon: "check", label: "Released to patient" },
  held: { tone: "neutral", icon: "lock", label: "Not released" },
} as const satisfies Record<string, StatusVisual>;

export const BATCH_STATE_VISUAL: Record<BatchState, StatusVisual> = {
  usable: { tone: "ok", icon: "check", label: "In stock" },
  expired: { tone: "danger", icon: "ban", label: "Expired" },
  quarantined: { tone: "warn", icon: "lock", label: "Quarantined" },
  recalled: { tone: "danger", icon: "flag", label: "Recalled" },
  empty: { tone: "neutral", icon: "dot", label: "Empty" },
};

export const EXPIRY_BAND_VISUAL: Record<ExpiryBand, StatusVisual> = {
  expired: { tone: "danger", icon: "ban", label: "Expired" },
  soon: { tone: "warn", icon: "clock", label: "Expires soon" },
  ok: { tone: "ok", icon: "check", label: "In date" },
};

export const STOCK_LEVEL_VISUAL = {
  out: { tone: "danger", icon: "ban", label: "Out of stock" },
  low: { tone: "warn", icon: "alert", label: "Below reorder level" },
  ok: { tone: "ok", icon: "check", label: "Stock OK" },
} as const satisfies Record<string, StatusVisual>;

export const DISPENSE_FLAG_VISUAL = {
  midCourse: { tone: "warn", icon: "clock", label: "Expires mid-course" },
  fefoSkipped: { tone: "warn", icon: "alert", label: "Earlier batch skipped" },
  allergy: { tone: "danger", icon: "alert", label: "Allergy to this class" },
} as const satisfies Record<string, StatusVisual>;

export const REQUEST_VISUAL: Record<RequestStatus, StatusVisual> = {
  open: { tone: "info", icon: "hourglass", label: REQUEST_LABEL.open },
  booked: { tone: "ok", icon: "check", label: REQUEST_LABEL.booked },
  declined: { tone: "neutral", icon: "x", label: REQUEST_LABEL.declined },
  cancelled: { tone: "neutral", icon: "x", label: REQUEST_LABEL.cancelled },
};

export const ALL_VISUAL_SETS = {
  APPOINTMENT_VISUAL,
  PAYMENT_VISUAL,
  INVOICE_STATE_VISUAL,
  INSURANCE_VISUAL,
  ROOM_VISUAL,
  CONSENT_VISUAL,
  NOTE_VISUAL,
  LAB_FLAG_VISUAL,
  LAB_ORDER_VISUAL,
  ALLERGY_CHECK_VISUAL,
  RESULT_RELEASE_VISUAL,
  BATCH_STATE_VISUAL,
  EXPIRY_BAND_VISUAL,
  STOCK_LEVEL_VISUAL,
  DISPENSE_FLAG_VISUAL,
  REQUEST_VISUAL,
} as const;
