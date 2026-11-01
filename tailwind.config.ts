import type { Config } from "tailwindcss";
import { color, font, fontSize, radius, shadow, spacing } from "./lib/design/tokens";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    // Replace (not extend) colours so only token colours can be used.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#FFFFFF",
      canvas: color.canvas,
      surface: color.surface,
      sunken: color.sunken,
      line: color.line,
      ink: color.ink,
      brand: color.brand,
      clay: color.clay,
      focus: color.focus,
      ok: color.status.ok,
      warn: color.status.warn,
      danger: color.status.danger,
      info: color.status.info,
      neutral: color.status.neutral,
      critical: color.status.critical,
    },
    fontFamily: { sans: [...font.sans], mono: [...font.mono] },
    fontSize: fontSize as unknown as NonNullable<Config["theme"]>["fontSize"],
    borderRadius: { none: "0", ...radius },
    extend: {
      spacing,
      boxShadow: shadow,
      minHeight: { row: spacing.row, touch: "2.75rem" },
      minWidth: { touch: "2.75rem" },
      maxWidth: { page: "88rem", prose: "42rem" },
    },
  },
  plugins: [],
};

export default config;
