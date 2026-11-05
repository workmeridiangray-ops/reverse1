import { expect, test } from "vitest";
import { contrast, pairs } from "./tokens";

test("every text/background token pair meets WCAG AA (4.5:1)", () => {
  for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), name).toBeGreaterThanOrEqual(4.5);
});
