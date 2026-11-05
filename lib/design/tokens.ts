/**
 * Design tokens. Single source of truth for colour, type, spacing,
 * radius and elevation; tailwind.config.ts reads from here.
 *
 * Identity: calm, warm and clinical. Deep teal ink on warm paper, with one
 * clay accent. Generous spacing. Every status colour pair below meets WCAG AA
 * (>= 4.5:1) for normal text on its own background, and status is never
 * conveyed by colour alone: badges always pair colour with an icon and a word.
 */
export const color = {
  canvas: "#F7F8FA", // page background (scope: #F7F8FA)
  surface: "#FFFFFF",
  sunken: "#EEF1F5",
  line: { DEFAULT: "#D9DFE7", strong: "#9AA6B5" },
  ink: {
    900: "#17212F", // primary text
    700: "#3A485A", // secondary text
    500: "#526174", // muted text (scope: #526174)
    300: "#9AA6B5", // decoration only, never text
  },
  brand: {
    50: "#EDF2F8",
    100: "#D9E4F1",
    200: "#B3C8E0",
    600: "#2F5E94",
    700: "#244B78", // scope accent
    800: "#1A3859",
  },
  clay: {
    50: "#F3F5F8",
    100: "#E3E8EF",
    600: "#2F5E94",
    700: "#244B78",
  },
  focus: "#C2410C",
  status: {
    ok: { fg: "#1B5E36", bg: "#E3F1E7", line: "#A6CFB2" },
    warn: { fg: "#734600", bg: "#FCF0D6", line: "#E3C27C" },
    danger: { fg: "#9B2318", bg: "#FBE6E3", line: "#E6AAA2" },
    info: { fg: "#1D4A85", bg: "#E4EDF9", line: "#A7C0E4" },
    neutral: { fg: "#45505A", bg: "#ECEEF0", line: "#C6CCD1" },
    critical: { fg: "#FFFFFF", bg: "#9B2318", line: "#7A1B12" },
  },
} as const;

export const font = {
  sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
  mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
} as const;

/** Type scale: [size, { lineHeight, letterSpacing? }]. Body is 16px minimum. */
export const fontSize = {
  caption: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px - metadata only
  sm: ["0.9375rem", { lineHeight: "1.375rem" }], // 15px
  base: ["1rem", { lineHeight: "1.625rem" }], // 16px
  lg: ["1.125rem", { lineHeight: "1.75rem" }], // 18px
  title: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.005em" }],
  heading: ["1.625rem", { lineHeight: "2.125rem", letterSpacing: "-0.01em" }],
  display: ["2.125rem", { lineHeight: "2.625rem", letterSpacing: "-0.015em" }],
} as const;

/** Spacing additions on top of Tailwind's 4px grid. */
export const spacing = {
  gutter: "1.5rem", // default gap between cards
  section: "2.5rem", // gap between page sections
  row: "3.5rem", // min height of an interactive table row (touch target)
} as const;

export const radius = { sm: "6px", DEFAULT: "10px", lg: "14px", pill: "999px" } as const;

export const shadow = {
  card: "0 1px 0 rgba(16,39,42,0.04), 0 1px 3px rgba(16,39,42,0.08)",
  raised: "0 2px 4px rgba(16,39,42,0.06), 0 8px 24px rgba(16,39,42,0.10)",
} as const;
