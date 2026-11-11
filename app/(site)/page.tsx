import Link from "next/link";
const flow = ["Customer demand", "MRP", "Purchase / production", "Receipt & quality", "Material issue", "Operations", "Inspection", "Finished goods", "Dispatch", "Cost reconciliation"];
export default function Home() {
  return (<>
    <section className="mx-auto max-w-6xl px-4 py-16 sm:py-24">
      <p className="text-sm font-medium text-brand">Manufacturing ERP · Production planning · Traceability</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">One linked record from customer order to dispatch and cost.</h1>
      <p className="mt-5 max-w-2xl text-lg text-muted">Forgeline connects sales demand, bills of materials, MRP, purchasing, stock, shop-floor execution, quality and costing for discrete manufacturers — with every step traceable to its source.</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link href="/signup" className="btn-primary">Start 14-day free trial</Link><Link href="/demo" className="btn-secondary">Request a demo</Link></div>
    </section>
    <section className="border-y border-line bg-surface"><div className="mx-auto max-w-6xl px-4 py-10">
      <h2 className="text-xl font-semibold">The whole chain, in one system</h2>
      <ol className="mt-4 flex flex-wrap gap-2 text-sm">{flow.map((f, i) => <li key={f} className="rounded-full border border-line bg-canvas px-3 py-1.5"><span className="text-muted">{i + 1}.</span> {f}</li>)}</ol>
    </div></section>
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:grid-cols-3">
      {[["Plan with explanations", "Deterministic MRP shows why each suggestion exists and never creates orders on its own."], ["Execute with control", "Frozen engineering snapshots, quarantine-aware stock, immutable movement ledger and approved reversals."], ["Trace and recall", "Follow any batch forward to customers or backward to supplier lots in one query."], ["Cost honestly", "Estimated, standard and actual cost kept separate, with variances and period close."], ["Share safely", "Customer and supplier portals show only their own milestones and documents."], ["Isolated by design", "Every company’s data is separated at the database level, not just in screens."]]
        .map(([t, d]) => <div key={t} className="card p-5"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p></div>)}
    </section>
  </>);
}
