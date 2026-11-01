import { PRODUCT_NAME } from "@/lib/brand";

/** Wordmark: an open leaf-in-circle mark (tend + well) and the name. */
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const px = size === "lg" ? 36 : 28;
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={px} height={px} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <circle cx="16" cy="16" r="14" fill="none" stroke="#0E5B57" strokeWidth="2.5" />
        <path d="M10 20c0-6 4.5-10 12-10 0 7.5-4 12-10 12" fill="#D8ECE8" stroke="#0E5B57" strokeWidth="2" strokeLinejoin="round" />
        <path d="M10 22l6.5-6.5" stroke="#A4492A" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className={`${size === "lg" ? "text-heading" : "text-title"} font-bold tracking-tight text-ink-900`}>{PRODUCT_NAME}</span>
    </span>
  );
}
