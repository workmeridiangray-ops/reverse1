/** Code 39 barcode (works with keyboard-wedge scanners and phone camera scanners). Returns SVG bars for the uppercase A-Z 0-9 - . space $ / + % set. */
const P: Record<string, string> = { "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn", U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "$": "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn" };
export const code39Valid = (s: string) => /^[0-9A-Z\-. $/+%]+$/.test(s);
export function code39Svg(text: string, h = 56): { svg: string; width: number } {
  const t = text.toUpperCase(); if (!code39Valid(t)) throw new Error("Unsupported character for Code 39");
  const full = `*${t}*`; let x = 10, bars = ""; const nar = 2, wide = 5;
  for (const ch of full) { const p = P[ch]!; for (let i = 0; i < 9; i++) { const w = p[i] === "w" ? wide : nar; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`; x += w; } x += nar; }
  return { svg: bars, width: x + 10 };
}
