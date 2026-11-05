import type { Config } from "tailwindcss";
import { color } from "./lib/design/tokens";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent", current: "currentColor", white: "#FFFFFF",
      canvas: color.canvas, surface: color.surface, line: color.line, ink: color.ink, muted: color.muted,
      brand: color.brand,
      ok: color.ok, "ok-bg": color.okBg, warn: color.warn, "warn-bg": color.warnBg,
      danger: color.danger, "danger-bg": color.dangerBg, info: color.info, "info-bg": color.infoBg,
      neutral: color.neutral, "neutral-bg": color.neutralBg,
    },
    fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "monospace"] },
    borderRadius: { none: "0", sm: "0.5rem", md: "0.625rem", lg: "0.75rem", full: "9999px" },
    extend: { maxWidth: { page: "88rem" }, minHeight: { touch: "2.75rem" } },
  },
  plugins: [],
};
export default config;
