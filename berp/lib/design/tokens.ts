/** Design tokens. Palette from the product brief; every text/background pair is contrast-tested. */
export const color = {
  canvas: "#F7F8FA",
  surface: "#FFFFFF",
  line: "#D9DFE7",
  ink: "#17212F",
  muted: "#526174",
  brand: "#244B78",
  brandInk: "#FFFFFF",
  ok: "#17603A", okBg: "#E6F4EC",
  warn: "#7A4B00", warnBg: "#FFF3DC",
  danger: "#A12622", dangerBg: "#FDECEA",
  info: "#244B78", infoBg: "#E8EFF8",
  neutral: "#3F4B5B", neutralBg: "#EDF0F4",
} as const;

export const pairs: [string, string, string][] = [
  ["ink on canvas", color.ink, color.canvas],
  ["ink on surface", color.ink, color.surface],
  ["muted on surface", color.muted, color.surface],
  ["muted on canvas", color.muted, color.canvas],
  ["brand on surface", color.brand, color.surface],
  ["white on brand", color.brandInk, color.brand],
  ["ok", color.ok, color.okBg], ["warn", color.warn, color.warnBg], ["danger", color.danger, color.dangerBg],
  ["info", color.info, color.infoBg], ["neutral", color.neutral, color.neutralBg],
];

export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
