import { describe, it, expect } from "vitest";
const lum = (h: string) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// text/background pairs actually used in globals.css
const PAIRS: [string, string, string][] = [["#17212F", "#F7F8FA", "body"], ["#17212F", "#FFFFFF", "card"], ["#526174", "#FFFFFF", "muted on card"], ["#526174", "#F7F8FA", "muted on page"], ["#FFFFFF", "#244B78", "primary button"], ["#244B78", "#E8EEF6", "accent badge"], ["#1E6B45", "#E4F3EA", "ok badge"], ["#7A4F00", "#FFF2D6", "warn badge"], ["#A12B2B", "#FBE7E7", "bad badge"], ["#A12B2B", "#FFFFFF", "error text"], ["#FFFFFF", "#A12B2B", "danger button"], ["#526174", "#FAFBFC", "table header"], ["#354357", "#EDF0F4", "neutral badge"], ["#244B78", "#FFFFFF", "links"]];
describe("design tokens meet WCAG AA (4.5:1) for text", () => { for (const [f, b, n] of PAIRS) it(n, () => expect(ratio(f, b)).toBeGreaterThanOrEqual(4.5)); });
