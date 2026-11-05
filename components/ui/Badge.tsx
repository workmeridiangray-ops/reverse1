import { statusVisual, type StatusVisual, type Tone } from "@/lib/ui/status";
import { Icon } from "./Icon";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-fg border-ok-line", warn: "bg-warn-bg text-warn-fg border-warn-line",
  danger: "bg-danger-bg text-danger-fg border-danger-line", info: "bg-info-bg text-info-fg border-info-line",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-line", critical: "bg-critical-bg text-critical-fg border-critical-line",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
};

/** Status badge: colour + icon + text, always. */
export function Badge({ status, visual, detail }: { status?: string; visual?: StatusVisual; detail?: string }) {
  const v = visual ?? statusVisual(status ?? "");
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-caption font-bold ${TONE[v.tone]}`}>
      <Icon name={v.icon} className="h-3.5 w-3.5" />
      <span>{v.label}</span>
      {detail ? <span className="font-normal">· {detail}</span> : null}
    </span>
  );
}
