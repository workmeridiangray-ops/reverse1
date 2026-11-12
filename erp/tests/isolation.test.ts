import { describe, it, expect, afterAll } from "vitest";
import { makeCompany, seedCatalog, T } from "./helpers";
import { withTenant, withSystem, pool } from "@/lib/db";
import { createOrderRaw } from "@/lib/erp/sales";
import { resolveLines } from "@/lib/erp/lines";
afterAll(() => pool.end());

describe("tenant isolation (enforced by the database, not just app code)", () => {
  it("company A cannot read, write or reference company B records", async () => {
    const a = await makeCompany("A Co"), b = await makeCompany("B Co");
    const ca = await seedCatalog(a), cb = await seedCatalog(b);
    // reads
    expect((await withTenant(a.tenantId, (db) => db.query("select id from customers where id=$1", [cb.cust]))).rowCount).toBe(0);
    expect((await withTenant(a.tenantId, (db) => db.query("select id from items"))).rows.map((r: any) => r.id)).toEqual([ca.item]);
    // guessed id on a write is a no-op
    expect((await withTenant(a.tenantId, (db) => db.query("update customers set name='hacked' where id=$1", [cb.cust]))).rowCount).toBe(0);
    // writing a row stamped with the other tenant is rejected by RLS
    await expect(withTenant(a.tenantId, (db) => db.query("insert into customers(tenant_id,code,name) values ($1,'X','x')", [b.tenantId]))).rejects.toThrow(/row-level security/);
    // composite FK: an order in A cannot point at B's customer even via raw SQL as A
    await expect(withTenant(a.tenantId, (db) => db.query("insert into sales_orders(tenant_id,number,customer_id,branch_id,warehouse_id) values ($1,'SO-X',$2,$3,$4)", [a.tenantId, cb.cust, a.branchId, a.warehouseId]))).rejects.toThrow();
    // application layer also refuses
    const lines = await T(a, (db) => resolveLines(db, a.tenantId, [{ itemId: ca.item, qty: "1" }], { kind: "sale" }));
    await expect(T(a, (db) => createOrderRaw(db, a.ctx, { customerId: cb.cust, branchId: a.branchId, warehouseId: a.warehouseId, lines }))).rejects.toThrow();
    // no tenant context at all: nothing visible
    expect((await withTenant("00000000-0000-0000-0000-000000000000", (db) => db.query("select * from items"))).rowCount).toBe(0);
  });
  it("control-plane (system) mode cannot see business documents", async () => {
    const a = await makeCompany("Sys Co"); await seedCatalog(a);
    expect((await withSystem((db) => db.query("select * from customers"))).rowCount).toBe(0);
    expect((await withSystem((db) => db.query("select * from journals"))).rowCount).toBe(0);
    expect((await withSystem((db) => db.query("select id from tenants"))).rowCount).toBeGreaterThan(0);
  });
  it("audit log is append-only for the application role", async () => {
    const a = await makeCompany("Audit Co");
    await withSystem((db) => db.query("insert into audit_log(tenant_id,action) values ($1,'t')", [a.tenantId]));
    await expect(withSystem((db) => db.query("update audit_log set action='x'"))).rejects.toThrow();
    await expect(withSystem((db) => db.query("delete from audit_log"))).rejects.toThrow();
  });
});
