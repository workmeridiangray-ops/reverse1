import { Page } from "@/components/ui";
import Link from "next/link";
export const metadata = { title: "Solutions" };
const s: [string, string][] = [["Engineering & machine shops", "Multi-level BOMs, routings with setup/run time, work-centre load, subcontract outside operations."], ["Fabrication & assembly", "Make-to-order jobs with component batch genealogy and serialised finished goods."], ["Electrical & electronics assembly", "Serial and batch traceability, incoming inspection, quarantine and recall."], ["Auto components", "Customer schedules, yield and scrap visibility, job margin and supplier performance."]];
export default function P() { return <div className="mx-auto max-w-6xl"><Page title="Industry solutions" sub="Built for discrete manufacturing with bills of materials and work centres.">
  <div className="grid gap-4 sm:grid-cols-2">{s.map(([t, d]) => <div key={t} className="card p-5"><h2 className="font-semibold">{t}</h2><p className="mt-2 text-sm text-muted">{d}</p></div>)}</div>
  <p className="mt-6"><Link href="/demo" className="btn-primary">See it with your product structure</Link></p></Page></div>; }
