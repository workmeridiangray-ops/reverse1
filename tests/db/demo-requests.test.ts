import { afterAll, describe, expect, it } from "vitest";
import { as, attempt, failure, pool } from "./helpers";

afterAll(() => pool.end());
const call = (u: Parameters<typeof as>[0], email = "a@b.test") =>
  as(u, (q) => q<{ r: string }>(`select public.submit_demo_request('Ann', $1, 'City Hospital', 120, 'Hello') as r`, [email]));

describe("demo requests", () => {
  it("anonymous visitors can submit; a repeat within the hour is acknowledged but stored once", async () => {
    await as(null, async (q) => {
      expect((await q<{ r: string }>(`select public.submit_demo_request('Ann','a@b.test','City Hospital',120,'Hi') as r`))[0]?.r).toBe("received");
      expect((await q<{ r: string }>(`select public.submit_demo_request('Ann','A@B.test','City Hospital',120,'Hi') as r`))[0]?.r).toBe("duplicate");
    });
  });
  it("rejects invalid email and empty names", async () => {
    expect(await failure(call(null, "not-an-email"))).toMatch(/check constraint/);
    expect(await failure(as(null, (q) => q(`select public.submit_demo_request('  ','a@b.test','Org',1,null)`)))).toMatch(/check constraint/);
  });
  it("nobody can read or write the table directly through the API", async () => {
    for (const u of [null, "adminA", "doctorA"] as const) {
      const r = await as(u, (q) => attempt(q, `select * from public.demo_requests`));
      expect(r.ok, String(u)).toBe(false);
      const w = await as(u, (q) => attempt(q, `insert into public.demo_requests (name,email,organisation) values ('x','x@y.test','z')`));
      expect(w.ok, String(u)).toBe(false);
    }
  });
});
