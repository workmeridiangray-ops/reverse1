/** Code 128 (subset B) encoder → SVG. Pure; no dependencies. Handles printable ASCII 32–126. */

// Element widths (bar, space, bar, space, bar, space) for symbol values 0..105, then START A/B/C = 103..105; STOP is separate.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232",
] as const;
const STOP = "2331112";
export const START_B = 104;

export { PATTERNS as CODE128_PATTERNS, STOP as CODE128_STOP };

export function code128Values(text: string): number[] {
  if (text.length === 0 || text.length > 80) throw new Error("barcode text must be 1–80 characters");
  const vals = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`character "${ch}" cannot be encoded in Code 128 B`);
    vals.push(c - 32);
  }
  let sum = START_B;
  for (let i = 1; i < vals.length; i++) sum += vals[i]! * i;
  vals.push(sum % 103);
  return vals;
}

/** Module widths for the whole symbol: alternating bar/space starting with a bar. */
export function code128Widths(text: string): number[] {
  return [...code128Values(text).flatMap((v) => [...PATTERNS[v]!].map(Number)), ...[...STOP].map(Number)];
}

export function code128Svg(text: string, opts: { moduleWidth?: number; height?: number; quiet?: number } = {}): string {
  const mw = opts.moduleWidth ?? 2, h = opts.height ?? 60, quiet = (opts.quiet ?? 10) * mw;
  const widths = code128Widths(text);
  let x = quiet, bars = "";
  widths.forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w * mw}" height="${h}"/>`; x += w * mw; });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${h}" width="${total}" height="${h}" role="img" aria-label="Barcode ${text.replace(/[<>&"]/g, "")}"><rect width="${total}" height="${h}" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
}
