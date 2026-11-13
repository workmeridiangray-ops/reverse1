import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, asScope, freshDatabase, ownerClient } from "./helpers";

const A = randomUUID(), B = randomUUID();
const uOwnerA = randomUUID(), uOwnerB = randomUUID(), uClientA = randomUUID(), uMgrA = randomUUID();
const PA1 = randomUUID(), PA2 = randomUUID(), PB1 = randomUUID();
let pool: pg.Pool; const ids: Record<string, string> = {};

beforeAll(async () => {
  await freshDatabase();
  const o = ownerClient(); await o.connect();
  const plan = (await o.query("SELECT id FROM plans WHERE code='starter'")).rows[0].id;
  for (const [id, n] of [[A, "Alpha Builders"], [B, "Beta Constructions"]] as const) await o.query("INSERT INTO tenants(id,name,slug,plan_id) VALUES ($1,$2,$3,$4)", [id, n, n.slice(0, 4).toLowerCase() + id.slice(0, 4), plan]);
  for (const [id, e] of [[uOwnerA, "oa@x.test"], [uOwnerB, "ob@x.test"], [uClientA, "ca@x.test"], [uMgrA, "ma@x.test"]] as const) await o.query("INSERT INTO users(id,email,name,password_hash) VALUES ($1,$2,'U','x')", [id, e]);
  await o.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'client'),($1,$6,'manager')", [A, uOwnerA, B, uOwnerB, uClientA, uMgrA]);
  for (const [p, t, c] of [[PA1, A, "A1"], [PA2, A, "A2"], [PB1, B, "B1"]] as const) await o.query("INSERT INTO projects(id,tenant_id,code,name,client_name,status) VALUES ($1,$2,$3,'P','C','active')", [p, t, c]);
  await o.query("INSERT INTO project_access(tenant_id,project_id,user_id) VALUES ($1,$2,$3)", [A, PA1, uClientA]);
  for (const [p, t] of [[PA1, A], [PA2, A], [PB1, B]] as const) {
    const item = (await o.query("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor) VALUES ($1,$2,'1','x','m3',1000,100) RETURNING id", [t, p])).rows[0].id;
    ids["item" + p] = item;
    await o.query("INSERT INTO budget_lines(boq_item_id,tenant_id,project_id,cost_rate_minor) VALUES ($1,$2,$3,50)", [item, t, p]);
    await o.query("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,measured_on,status) VALUES ($1,$2,$3,10,current_date,'recorded'),($1,$2,$3,20,current_date,'verified')", [t, p, item]);
    await o.query("INSERT INTO variations(tenant_id,project_id,number,title,boq_item_id,status) VALUES ($1,$2,1,'draft v',$3,'draft'),($1,$2,2,'sub v',$3,'submitted')", [t, p, item]);
    await o.query("INSERT INTO suppliers(tenant_id,name) VALUES ($1,$2)", [t, "S" + p]);
    for (const [n, st] of [[1, "draft"], [2, "certified"]] as const) await o.query("INSERT INTO bills(tenant_id,project_id,bill_no,status,terms) VALUES ($1,$2,$3,$4,'{}')", [t, p, n, st]);
  }
  await o.end();
  pool = appPool();
});
afterAll(async () => { await pool?.end(); });

const ownerA = { tenantId: A, userId: uOwnerA, role: "owner" };
const clientA = { tenantId: A, userId: uClientA, role: "client", allProjects: false };

describe("tenant isolation", () => {
  it("a tenant sees only its own projects", async () => {
    const r = await asScope(pool, ownerA, (q) => q("SELECT id FROM projects"));
    expect(r.rows.map((x) => x.id).sort()).toEqual([PA1, PA2].sort());
  });
  it("a guessed identifier from another tenant returns nothing", async () => {
    for (const t of ["projects", "boq_items", "bills", "measurements", "suppliers", "budget_lines", "variations"]) {
      const r = await asScope(pool, ownerA, (q) => q(`SELECT 1 FROM ${t} WHERE tenant_id = $1`, [B]));
      expect(r.rowCount, t).toBe(0);
    }
    const r = await asScope(pool, ownerA, (q) => q("SELECT 1 FROM projects WHERE id = $1", [PB1]));
    expect(r.rowCount).toBe(0);
  });
  it("cannot update or delete another tenant's rows", async () => {
    const u = await asScope(pool, ownerA, (q) => q("UPDATE projects SET name='hacked' WHERE id = $1", [PB1]));
    expect(u.rowCount).toBe(0);
    const d = await asScope(pool, ownerA, (q) => q("DELETE FROM boq_items WHERE project_id = $1", [PB1]));
    expect(d.rowCount).toBe(0);
  });
  it("cannot insert a row into another tenant, or reference another tenant's parent", async () => {
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO projects(tenant_id,code,name,client_name) VALUES ($1,'X','x','x')", [B]))).rejects.toThrow();
    // own tenant id but other tenant's project: composite foreign key rejects it
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor) VALUES ($1,$2,'9','x','m',1,1)", [A, PB1]))).rejects.toThrow();
  });
  it("no tenant context means no rows at all", async () => {
    const r = await asScope(pool, {}, (q) => q("SELECT id FROM projects"));
    expect(r.rowCount).toBe(0);
  });
  it("membership rows are scoped; a user sees only their own memberships across tenants", async () => {
    const r = await asScope(pool, { userId: uOwnerA }, (q) => q("SELECT tenant_id FROM memberships"));
    expect(r.rows.map((x) => x.tenant_id)).toEqual([A]);
    const x = await asScope(pool, ownerA, (q) => q("SELECT 1 FROM memberships WHERE tenant_id=$1", [B]));
    expect(x.rowCount).toBe(0);
  });
});

describe("project and external-party scope", () => {
  it("a client sees only assigned projects", async () => {
    const r = await asScope(pool, clientA, (q) => q("SELECT id FROM projects"));
    expect(r.rows.map((x) => x.id)).toEqual([PA1]);
    const b = await asScope(pool, clientA, (q) => q("SELECT 1 FROM boq_items WHERE project_id=$1", [PA2]));
    expect(b.rowCount).toBe(0);
  });
  it("a client sees only certified/submitted bills, verified measurements and non-draft variations", async () => {
    expect((await asScope(pool, clientA, (q) => q("SELECT status FROM bills"))).rows.map((r) => r.status)).toEqual(["certified"]);
    expect((await asScope(pool, clientA, (q) => q("SELECT status FROM measurements"))).rows.map((r) => r.status)).toEqual(["verified"]);
    expect((await asScope(pool, clientA, (q) => q("SELECT status FROM variations"))).rows.map((r) => r.status)).toEqual(["submitted"]);
  });
  it("internal margins, suppliers and procurement are invisible to a client", async () => {
    for (const t of ["budget_lines", "suppliers", "material_requests", "purchase_orders", "grn_lines"]) {
      expect((await asScope(pool, clientA, (q) => q(`SELECT 1 FROM ${t}`))).rowCount, t).toBe(0);
    }
  });
  it("a client cannot write BOQ or measurements", async () => {
    await expect(asScope(pool, clientA, (q) => q("UPDATE boq_items SET rate_minor = 1"))).rejects.toThrow(/row-level security/);
    await expect(asScope(pool, clientA, (q) => q("INSERT INTO boq_items(tenant_id,project_id,code,description,unit,qty_milli,rate_minor) VALUES ($1,$2,'Z','x','m',1,1)", [A, PA1]))).rejects.toThrow();
  });
  it("a manager with explicit assignments (allProjects=false) is limited the same way", async () => {
    const r = await asScope(pool, { tenantId: A, userId: uMgrA, role: "manager", allProjects: false }, (q) => q("SELECT id FROM projects"));
    expect(r.rowCount).toBe(0);
  });
});

describe("planning and subcontract tables", () => {
  it("external roles cannot read subcontract data; tenants cannot read each other's", async () => {
    const sup = randomUUID(), pk = randomUUID();
    await asScope(pool, ownerA, async (q) => {
      await q("INSERT INTO suppliers(id,tenant_id,name) VALUES ($1,$2,'SubCo')", [sup, A]);
      await q("INSERT INTO sub_packages(id,tenant_id,project_id,number,name,supplier_id) VALUES ($1,$2,$3,1,'x',$4)", [pk, A, PA1, sup]);
      await q("INSERT INTO schedule_activities(tenant_id,project_id,wbs,name,start_date,end_date) VALUES ($1,$2,'1','a',current_date,current_date)", [A, PA1]);
    });
    expect((await asScope(pool, clientA, (q) => q("SELECT 1 FROM sub_packages"))).rowCount).toBe(0);
    expect((await asScope(pool, { tenantId: B, userId: uOwnerB, role: "owner" }, (q) => q("SELECT 1 FROM sub_packages"))).rowCount).toBe(0);
    expect((await asScope(pool, clientA, (q) => q("SELECT 1 FROM schedule_activities"))).rowCount).toBe(1);
    await expect(asScope(pool, clientA, (q) => q("INSERT INTO schedule_activities(tenant_id,project_id,wbs,name,start_date,end_date) VALUES ($1,$2,'9','a',current_date,current_date)", [A, PA1]))).rejects.toThrow();
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO schedule_activities(tenant_id,project_id,wbs,name,start_date,end_date) VALUES ($1,$2,'8','a',current_date + 1,current_date)", [A, PA1]))).rejects.toThrow();
  });
});

describe("platform operator", () => {
  it("can see tenant metadata but no customer project data", async () => {
    const t = await asScope(pool, { userId: uOwnerA, platform: true }, (q) => q("SELECT id FROM tenants"));
    expect(t.rowCount).toBe(2);
    for (const tbl of ["projects", "boq_items", "bills", "files", "drawings", "daily_reports"])
      expect((await asScope(pool, { userId: uOwnerA, platform: true }, (q) => q(`SELECT 1 FROM ${tbl}`))).rowCount, tbl).toBe(0);
  });
});

describe("integrity rules", () => {
  it("audit log is append-only", async () => {
    await asScope(pool, ownerA, (q) => q("INSERT INTO audit_log(tenant_id,user_id,action) VALUES ($1,$2,'t')", [A, uOwnerA]));
    await expect(asScope(pool, ownerA, (q) => q("UPDATE audit_log SET action='x'"))).rejects.toThrow();
    await expect(asScope(pool, ownerA, (q) => q("DELETE FROM audit_log"))).rejects.toThrow();
    const o = ownerClient(); await o.connect();
    await expect(o.query("DELETE FROM audit_log")).rejects.toThrow(/append-only/);
    await o.end();
  });
  it("rejection needs a reason; duplicate measurements are blocked; one approved revision per drawing", async () => {
    const item = ids["item" + PA1]!;
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,measured_on,status) VALUES ($1,$2,$3,5,current_date,'rejected')", [A, PA1, item]))).rejects.toThrow();
    await asScope(pool, ownerA, (q) => q("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,measured_on,location) VALUES ($1,$2,$3,7,current_date,'L1')", [A, PA1, item]));
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO measurements(tenant_id,project_id,boq_item_id,qty_milli,measured_on,location) VALUES ($1,$2,$3,7,current_date,'L1')", [A, PA1, item]))).rejects.toThrow(/measurement_dup_key/);
    const f1 = randomUUID(), f2 = randomUUID(), d = randomUUID();
    await asScope(pool, ownerA, async (q) => {
      for (const f of [f1, f2]) await q("INSERT INTO files(id,tenant_id,project_id,entity,name,mime,size_bytes,sha256,storage_key) VALUES ($1,$2,$3,'drawing_revision','a','application/pdf',1,'x',$4)", [f, A, PA1, "k" + f]);
      await q("INSERT INTO drawings(id,tenant_id,project_id,number,title) VALUES ($1,$2,$3,'D1','t')", [d, A, PA1]);
      await q("INSERT INTO drawing_revisions(tenant_id,project_id,drawing_id,rev,file_id,status) VALUES ($1,$2,$3,'A',$4,'approved')", [A, PA1, d, f1]);
    });
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO drawing_revisions(tenant_id,project_id,drawing_id,rev,file_id,status) VALUES ($1,$2,$3,'B',$4,'approved')", [A, PA1, d, f2]))).rejects.toThrow(/one_approved_revision/);
  });
  it("a client sees only approved drawing revisions and their files; a draft's file is not reachable", async () => {
    const f3 = randomUUID(), d = randomUUID();
    await asScope(pool, ownerA, async (q) => {
      await q("INSERT INTO files(id,tenant_id,project_id,entity,name,mime,size_bytes,sha256,storage_key) VALUES ($1,$2,$3,'drawing_revision','a','application/pdf',1,'x',$4)", [f3, A, PA1, "k" + f3]);
      await q("INSERT INTO drawings(id,tenant_id,project_id,number,title) VALUES ($1,$2,$3,'D2','t')", [d, A, PA1]);
      await q("INSERT INTO drawing_revisions(tenant_id,project_id,drawing_id,rev,file_id,status) VALUES ($1,$2,$3,'A',$4,'draft')", [A, PA1, d, f3]);
    });
    expect((await asScope(pool, clientA, (q) => q("SELECT 1 FROM files WHERE id=$1", [f3]))).rowCount).toBe(0);
    expect((await asScope(pool, clientA, (q) => q("SELECT status FROM drawing_revisions"))).rows.every((r) => r.status === "approved")).toBe(true);
  });
  it("document numbers stay unique and gapless under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 12 }, () => asScope(pool, ownerA, async (q) => (await q("SELECT next_number('invoice') n")).rows[0].n as number)));
    expect([...nums].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });
  it("receipts must be positive and reversals need a reason", async () => {
    const bill = (await asScope(pool, ownerA, (q) => q("SELECT id FROM bills WHERE project_id=$1 AND bill_no=2", [PA1]))).rows[0].id;
    const inv = randomUUID();
    await asScope(pool, ownerA, (q) => q("INSERT INTO client_invoices(id,tenant_id,project_id,bill_id,number,amount_minor,issued_on,due_on) VALUES ($1,$2,$3,$4,'INV-1',1000,current_date,current_date)", [inv, A, PA1, bill]));
    await expect(asScope(pool, ownerA, (q) => q("INSERT INTO receipts(tenant_id,project_id,invoice_id,amount_minor,received_on) VALUES ($1,$2,$3,0,current_date)", [A, PA1, inv]))).rejects.toThrow();
    const r = (await asScope(pool, ownerA, (q) => q("INSERT INTO receipts(tenant_id,project_id,invoice_id,amount_minor,received_on) VALUES ($1,$2,$3,500,current_date) RETURNING id", [A, PA1, inv]))).rows[0].id;
    await expect(asScope(pool, ownerA, (q) => q("UPDATE receipts SET reversed_at=now() WHERE id=$1", [r]))).rejects.toThrow();
  });
});
