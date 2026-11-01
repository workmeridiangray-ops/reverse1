import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { color } from "./tokens";

describe("design tokens meet WCAG AA", () => {
  it.each(Object.entries(color.status))("status %s text on its background >= 4.5:1", (_, c) => {
    expect(contrast(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["ink-900 on canvas", color.ink[900], color.canvas],
    ["ink-700 on canvas", color.ink[700], color.canvas],
    ["ink-500 on canvas", color.ink[500], color.canvas],
    ["ink-500 on surface", color.ink[500], color.surface],
    ["ink-500 on sunken", color.ink[500], color.sunken],
    ["white on brand-700 (primary button)", "#FFFFFF", color.brand[700]],
    ["brand-700 on surface (links)", color.brand[700], color.surface],
    ["brand-700 on brand-50 (active nav)", color.brand[700], color.brand[50]],
    ["clay-600 on surface", color.clay[600], color.surface],
    ["white on danger (destructive button)", "#FFFFFF", color.status.danger.fg],
  ])("%s >= 4.5:1", (_, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["canvas", color.canvas],
    ["surface", color.surface],
    ["sunken", color.sunken],
  ])("focus ring (drawn with a 2px offset, so it sits on the page) is >= 3:1 against %s", (_, bg) => {
    expect(contrast(color.focus, bg)).toBeGreaterThanOrEqual(3);
  });

  it("form input borders (ink-500) are >= 3:1 against the surface (WCAG 1.4.11)", () => {
    expect(contrast(color.ink[500], color.surface)).toBeGreaterThanOrEqual(3);
  });
});
