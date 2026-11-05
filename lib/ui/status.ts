export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "critical" | "brand";
export type IconName = "check" | "clock" | "alert" | "x" | "user" | "coin" | "shield" | "ban" | "pencil" | "dot" | "flag" | "lock";
export interface StatusVisual { label: string; tone: Tone; icon: IconName }

const V = (label: string, tone: Tone, icon: IconName): StatusVisual => ({ label, tone, icon });
const MAP: Record<string, StatusVisual> = {
  draft: V("Draft", "neutral", "pencil"), recorded: V("Recorded", "info", "pencil"), requested: V("Requested", "info", "clock"),
  submitted: V("Submitted", "info", "clock"), open: V("Open", "warn", "clock"), pending: V("Pending", "warn", "clock"),
  verified: V("Verified", "ok", "shield"), approved: V("Approved", "ok", "check"), certified: V("Certified", "ok", "check"),
  invoiced: V("Invoiced", "brand", "coin"), paid: V("Paid", "ok", "check"), part_paid: V("Part paid", "warn", "coin"),
  unpaid: V("Unpaid", "warn", "coin"), overpaid: V("Overpaid", "danger", "alert"),
  rejected: V("Rejected", "danger", "x"), returned: V("Returned", "warn", "alert"), cancelled: V("Cancelled", "neutral", "ban"),
  passed: V("Passed", "ok", "check"), failed: V("Failed", "danger", "x"), answered: V("Answered", "ok", "check"), closed: V("Closed", "neutral", "lock"),
  rectified: V("Rectified", "info", "check"), resolved: V("Resolved", "ok", "check"),
  superseded: V("Superseded", "danger", "ban"), current: V("Current", "ok", "check"),
  tender: V("Tender", "info", "flag"), active: V("Active", "ok", "check"), handover: V("Handover", "brand", "flag"),
  trial: V("Trial", "info", "clock"), past_due: V("Payment overdue", "danger", "alert"), suspended: V("Suspended", "danger", "ban"),
  issued: V("Issued", "info", "check"), part_received: V("Part received", "warn", "clock"), received: V("Received", "ok", "check"),
  sent: V("Sent", "ok", "check"), disabled: V("Disabled", "neutral", "ban"),
};
export function statusVisual(s: string): StatusVisual {
  return MAP[s] ?? { label: s.replace(/_/g, " "), tone: "neutral", icon: "dot" };
}
