import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/session";
import { withTenantSystem } from "@/lib/db";
import { RESOURCES } from "@/lib/masters";
import { PageHead, Badge, Empty, Pager } from "@/components/ui";
import { Filters } from "@/components/Filters";
import { MasterForm, type Opts } from "@/components/MasterForm";
import { paging, like, sp1, orderBy, pages, type SP } from "@/lib/list";
import { saveMasterAction } from "../actions";
import { formatMoney, formatQty } from "@/lib/money";

export function cell(col: string, v: any) {
  if (v === null || v === undefined || v === "") return "—";
  if (col === "status") return <Badge status={v} />;
  if (col.endsWith("_paise")) return formatMoney(v);
  if (col.endsWith("_qty")) return formatQty(v);
  if (col === "rate_bps") return `${v / 100}%`;
  return String(v);
}
export async function loadOpts(db: any, tenantId: string): Promise<Opts> {
  const q = async (sql: string) => (await db.query(sql, [tenantId])).rows;
  return { tax_codes: await q("select id, code||' — '||name name from tax_codes where tenant_id=$1 and status='active' order by code"), price_lists: await q("select id, name from price_lists where tenant_id=$1 and status='active' order by name"), branches: await q("select id, name from branches where tenant_id=$1 and status='active' order by name") };
}
export default async function MasterList({ params, searchParams }: { params: Promise<{ resource: string }>; searchParams: Promise<SP> }) {
  const { resource } = await params; const r = RESOURCES[resource]; if (!r) notFound();
  const ctx = await requireTenant("masters.view"); const sp = await searchParams;
  const q = sp1(sp.q), status = sp1(sp.status), sort = sp1(sp.sort); const { page, limit, offset } = paging(sp);
  const canEdit = ctx.perms.has("masters.manage");
  const data = await withTenantSystem(ctx.tenant.id, async (db) => {
    const where = ["t.tenant_id=$1"]; const args: any[] = [ctx.tenant.id];
    if (q) { args.push(like(q)); where.push("(" + r.search.map((c) => `t.${c} ilike $${args.length}`).join(" or ") + ")"); }
    if (status) { args.push(status); where.push(`t.status=$${args.length}`); }
    const join = resource === "warehouses" ? "left join branches b on b.id=t.branch_id and b.tenant_id=t.tenant_id" : "";
    const sel = resource === "warehouses" ? "t.*, b.name branch" : "t.*";
    const order = orderBy(sort, Object.fromEntries(r.listCols.filter((c) => c !== "branch").map((c) => [c, `t.${c}`])), `t.${r.codeCol} asc`);
    const total = Number((await db.query(`select count(*) c from ${r.table} t ${join} where ${where.join(" and ")}`, args)).rows[0].c);
    const rows = (await db.query(`select ${sel} from ${r.table} t ${join} where ${where.join(" and ")} order by ${order} limit ${limit} offset ${offset}`, args)).rows;
    return { total, rows, opts: await loadOpts(db, ctx.tenant.id), custom: (await db.query("select key,label,kind from custom_fields where tenant_id=$1 and entity=$2 and status='active'", [ctx.tenant.id, resource])).rows };
  });
  const base = `/app/masters/${resource}`;
  const sortLink = (c: string) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), sort: sort === c ? "-" + c : c })}`;
  return (
    <>
      <PageHead title={r.title} crumbs={[["Master data"], [r.title]]} />
      {canEdit && !ctx.readOnlyReason && (
        <details className="drawer"><summary>+ New {r.singular}</summary><div><MasterForm r={r} opts={data.opts} custom={data.custom} action={saveMasterAction.bind(null, resource, null)} submit={`Create ${r.singular}`} /></div></details>)}
      <Filters action={base} q={q} status={status} statuses={["active", "retired"]} sort={sort} />
      <div className="card flush">
        {data.rows.length === 0 ? <Empty title={q || status ? "Nothing matches these filters" : `No ${r.title.toLowerCase()} yet`}>{q || status ? "Try clearing the filters." : canEdit ? `Use “New ${r.singular}” above, or import a CSV under Master data → Import.` : "Ask someone with edit rights to add them."}</Empty> : (
          <div className="tablewrap"><table className="stack-sm"><thead><tr>{r.listCols.map((c) => <th key={c} className={c.endsWith("_paise") || c.endsWith("_qty") || c.endsWith("_days") || c === "rate_bps" ? "num" : ""}><Link href={sortLink(c)} style={{ color: "inherit", textDecoration: "none" }}>{c.replace(/_paise|_qty|_bps|_days|_on/g, "").replace(/_/g, " ")}{sort === c ? " ▲" : sort === "-" + c ? " ▼" : ""}</Link></th>)}</tr></thead>
            <tbody>{data.rows.map((row: any) => (<tr key={row.id}>{r.listCols.map((c, i) => <td key={c} data-label={c.replace(/_/g, " ")} className={c.endsWith("_paise") || c.endsWith("_qty") || c.endsWith("_days") || c === "rate_bps" ? "num" : ""}>{i === 0 ? <Link href={`${base}/${row.id}`}>{cell(c, row[c])}</Link> : cell(c, row[c])}</td>)}</tr>))}</tbody></table></div>)}
        <Pager page={page} pages={pages(data.total)} total={data.total} base={base} params={{ q, status, sort }} />
      </div>
    </>
  );
}
