import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F8FA", surface: "#FFFFFF", sunken: "#EEF1F5", line: "#D9DFE7",
        ink: "#17212F", muted: "#526174", brand: "#244B78", "brand-dark": "#1A3A5E",
        ok: "#1E6B3C", warn: "#8A5A00", danger: "#A32727", info: "#244B78",
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      borderRadius: { md: "8px", lg: "12px" },
    },
  },
  plugins: [],
};
export default config;
