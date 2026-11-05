import { describe, expect, test } from "vitest";
import { admin } from "./helpers";
import { lineNet, lineTax } from "@/lib/rules/money";

describe("SQL and TypeScript money rules agree", () => {
  test("line_net and line_tax over a grid of inputs", async () => {
    const qtys = ["0.001", "0.5", "1", "2.5", "3", "7.125", "10", "99.999", "1000"];
    const prices = [1, 99, 333, 25050, 100001, 999999];
    const discs = [0, 1, 250, 1250, 5000, 9999, 10000];
    const rates = [0, 500, 1200, 1800, 2800];
    let n = 0;
    for (const q of qtys) for (const p of prices) for (const d of discs) {
      const net = lineNet(q, p, d);
      const [row] = await admin<{ n: number }>("select app.line_net($1::numeric,$2::bigint,$3::int)::bigint as n", [q, p, d]);
      expect(net, `net ${q}×${p} −${d}bp`).toBe(Number(row!.n));
      for (const r of rates) {
        const [t] = await admin<{ t: number }>("select app.line_tax($1::bigint,$2::int)::bigint as t", [net, r]);
        expect(lineTax(net, r), `tax ${net} @${r}`).toBe(Number(t!.t));
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  }, 120_000);
});
