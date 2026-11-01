import { describe, expect, it } from "vitest";
import { ALL_VISUAL_SETS } from "./status";

describe("status visuals never rely on colour alone", () => {
  it.each(Object.entries(ALL_VISUAL_SETS))("%s: every status has a text label and an icon", (_, set) => {
    for (const [key, v] of Object.entries(set)) {
      expect(v.label.trim().length, key).toBeGreaterThan(0);
      expect(v.icon, key).toBeTruthy();
    }
  });

  it.each(Object.entries(ALL_VISUAL_SETS))("%s: labels are unique within the set", (_, set) => {
    const labels = Object.values(set).map((v) => v.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
