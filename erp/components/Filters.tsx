import Link from "next/link";
/** Plain GET form so filters live in the URL: shareable, back-button safe, and restored when returning from a record. */
export function Filters({ action, q, status, statuses, extra, sort }: { action: string; q?: string; status?: string; statuses?: string[]; extra?: React.ReactNode; sort?: string }) {
  return (
    <form action={action} method="get" className="toolbar" role="search">
      <div><label className="f" htmlFor="flt_q">Search</label><input id="flt_q" name="q" defaultValue={q} placeholder="Search…" /></div>
      {statuses && <div><label className="f" htmlFor="flt_s">Status</label><select id="flt_s" name="status" defaultValue={status}><option value="">All</option>{statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>}
      {extra}
      {sort && <input type="hidden" name="sort" value={sort} />}
      <button className="btn">Apply</button>{(q || status) && <Link className="btn ghost" href={action}>Clear</Link>}
    </form>
  );
}
