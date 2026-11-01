import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * /lib/rules must stay pure: no framework, database, network, clock-reading
 * or filesystem dependencies. Only relative imports between rule modules.
 */
const dir = new URL(".", import.meta.url).pathname;
const modules = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("lib/rules purity", () => {
  it("has modules to check", () => {
    expect(modules.length).toBeGreaterThan(5);
  });

  it.each(modules)("%s imports only sibling rule modules", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    const imports = [...src.matchAll(/(?:import|export)[^'"]*from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of imports) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[\w-]+$/);
  });

  it.each(modules)("%s does not read the clock, network or environment", (file) => {
    const src = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/Date\.now\(|new Date\(\)|fetch\(|process\.env|Math\.random\(/);
  });
});
