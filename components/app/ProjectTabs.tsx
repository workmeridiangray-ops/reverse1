import Link from "next/link";
import type { Ctx } from "@/lib/server/auth";

export function ProjectTabs({ c, id, active }: { c: Ctx; id: string; active: string }) {
  const tabs: Array<[string, string, boolean]> = [
    ["overview", "Overview", true],
    ["boq", "BOQ", c.can("boq.view")],
    ["budget", "Budget", c.can("budget.view")],
    ["contract", "Contract", c.can("contract.edit") || c.can("bill.view")],
    ["measurements", "Measurements", c.can("measure.record") || c.can("measure.verify") || c.external || c.can("bill.view")],
    ["bills", "Bills & collections", c.can("bill.view")],
    ["variations", "Variations", c.can("variation.request") || c.can("variation.decide")],
    ["procurement", "Procurement", c.can("po.view") || c.can("material.request")],
    ["reports", "Site reports", c.can("report.view")],
    ["drawings", "Drawings & RFIs", c.can("drawing.view")],
    ["quality", "Quality & handover", c.can("inspection.manage") || c.can("snag.manage") || c.can("project.view")],
    ["access", "Access", c.can("project.access")],
  ];
  return (
    <nav aria-label="Project sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-line pb-2">
      {tabs.filter((t) => t[2]).map(([k, l]) => (
        <Link key={k} href={`/app/projects/${id}${k === "overview" ? "" : "/" + k}`} aria-current={k === active ? "page" : undefined}
          className={`flex min-h-touch items-center whitespace-nowrap rounded px-3 text-sm font-bold no-underline ${k === active ? "bg-brand-700 text-white hover:text-white" : "text-ink-700 hover:bg-brand-50"}`}>{l}</Link>
      ))}
    </nav>
  );
}
