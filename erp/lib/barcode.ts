// Code 128 (set B) as an SVG: widths per symbol value 0..105 plus stop; each is 11 modules (stop 13).
const P = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
export const CODE128_PATTERNS = P;
export function code128B(text: string): { bars: [number, number][]; width: number } {
  const vals = [104, ...[...text].map((c) => { const v = c.charCodeAt(0) - 32; if (v < 0 || v > 94) throw new Error(`Character not supported in barcode: ${c}`); return v; })];
  const sum = vals.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  vals.push(sum % 103); vals.push(106);
  const bars: [number, number][] = []; let x = 10; // 10-module quiet zone
  for (const v of vals) { const p = P[v]; for (let i = 0; i < p.length; i++) { const w = Number(p[i]); if (i % 2 === 0) bars.push([x, w]); x += w; } }
  return { bars, width: x + 10 };
}
export function barcodeSvg(text: string, h = 60): string {
  const { bars, width } = code128B(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width * 1.6}" height="${h}" role="img" aria-label="Barcode ${text.replace(/[<>&"]/g, "")}"><rect width="${width}" height="${h}" fill="#fff"/>${bars.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="${h}" fill="#000"/>`).join("")}</svg>`;
}
