import type { IconName } from "@/lib/ui/status";

/** 16px stroke icons. Decorative: always paired with visible text. */
const PATHS: Record<IconName | "arrow-right" | "plus" | "search" | "chevron-left" | "chevron-right" | "logout" | "menu" | "home" | "building" | "file" | "inbox", string> = {
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  home: "M2.5 7.5L8 2.5l5.5 5M4 7v6.5h8V7",
  building: "M3.5 14V2.5h6V14M9.5 6h3V14M2.5 14h11M5.5 5h2M5.5 8h2M5.5 11h2",
  file: "M4 1.5h5l3 3V14.5H4zM9 1.5V4.5h3",
  inbox: "M2 9l1.8-5.5h8.4L14 9v4.5H2zM2 9h3.5l1 1.5h3L10.5 9H14",
  check: "M3.5 8.5l3 3 6-7",
  clock: "M8 4.5V8l2.5 1.5M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0z",
  alert: "M8 5.5v3.5M8 11.5v.01M7.1 2.4L1.6 12a1 1 0 0 0 .9 1.5h11a1 1 0 0 0 .9-1.5L8.9 2.4a1 1 0 0 0-1.8 0z",
  x: "M4 4l8 8M12 4l-8 8",
  user: "M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4",
  coin: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0zM9.8 5.8C9.4 5.3 8.8 5 8 5c-1.1 0-2 .6-2 1.5S6.9 7.7 8 8s2 .8 2 1.6S9.1 11 8 11c-.8 0-1.5-.3-1.9-.9M8 4v1M8 11v1",
  shield: "M8 1.8l5 2v4c0 3.2-2.2 5.4-5 6.4-2.8-1-5-3.2-5-6.4v-4l5-2zM5.8 8l1.6 1.6L10.5 6.5",
  ban: "M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0zM3.8 3.8l8.4 8.4",
  pencil: "M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z",
  dot: "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  flag: "M3.5 14V2.5M3.5 2.5h8l-1.8 3 1.8 3h-8",
  lock: "M4 7.5h8V14H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5",
  "arrow-right": "M3 8h10M9 4l4 4-4 4",
  plus: "M8 3v10M3 8h10",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  "chevron-left": "M10 3L5 8l5 5",
  "chevron-right": "M6 3l5 5-5 5",
  logout: "M6 14H3V2h3M10.5 11L14 8l-3.5-3M14 8H6",
};

export type AnyIcon = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4" }: { name: AnyIcon; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}
