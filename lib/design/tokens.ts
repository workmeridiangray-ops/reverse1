/**
 * Tendwell design tokens. Single source of truth for colour, type, spacing,
 * radius and elevation; tailwind.config.ts reads from here.
 *
 * Identity: calm, warm and clinical. Deep teal ink on warm paper, with one
 * clay accent. Generous spacing. Every status colour pair below meets WCAG AA
 * (>= 4.5:1) for normal text on its own background, and status is never
 * conveyed by colour alone: badges always pair colour with an icon and a word.
 */
export const color = {
  canvas: "#F7F5F0", // warm paper page background
  surface: "#FFFFFF",
  sunken: "#EFEBE3",
  line: { DEFAULT: "#DCD5C9", strong: "#B3AA9B" },
  ink: {
    900: "#10272A", // primary text 15.6:1 on canvas
    700: "#34484B", // secondary text 9.5:1
    500: "#56686A", // muted text 5.6:1 on canvas, 6.0:1 on white
    300: "#9AA6A7", // disabled/decoration only, never text
  },
  brand: {
    50: "#EEF6F4",
    100: "#D8ECE8",
    200: "#B2D8D1",
    600: "#127069", // 5.9:1 on white
    700: "#0E5B57", // 7.6:1 on white - primary buttons
    800: "#0A4643",
  },
  clay: {
    50: "#FBF1EC",
    100: "#F5DFD4",
    600: "#A4492A", // 5.6:1 on white - accent, links on hover
    700: "#863A21",
  },
  focus: "#C2410C", // 3px outline, >= 3:1 against canvas, surface and brand
  status: {
    ok: { fg: "#1B5E36", bg: "#E3F1E7", line: "#A6CFB2" }, // 7.0:1
    warn: { fg: "#734600", bg: "#FCF0D6", line: "#E3C27C" }, // 7.1:1
    danger: { fg: "#9B2318", bg: "#FBE6E3", line: "#E6AAA2" }, // 6.4:1
    info: { fg: "#1D4A85", bg: "#E4EDF9", line: "#A7C0E4" }, // 7.4:1
    neutral: { fg: "#45505A", bg: "#ECEEF0", line: "#C6CCD1" }, // 7.3:1
    critical: { fg: "#FFFFFF", bg: "#9B2318", line: "#7A1B12" }, // 7.9:1
  },
} as const;

export const font = {
  sans: ["Atkinson Hyperlegible", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
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
