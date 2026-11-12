import { requireTenant } from "@/lib/auth/session";
import { PageHead, Badge } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { extensionInterestAction } from "./actions";
const EXT: [string, string][] = [["Manufacturing (BOM, MRP, production, WIP, costing)", "Dedicated scope"], ["Batch, expiry and serial traceability", "Dedicated scope"], ["Payroll and statutory deductions", "Dedicated scope"], ["E-invoicing and statutory filing", "Provider integration"], ["Multi-currency and consolidation", "Dedicated scope"], ["Courier APIs and route optimisation", "Provider integration"], ["Restaurant POS / School / Healthcare / Construction packages", "Separate products"], ["Enterprise SSO, additional languages", "On request"]];
export default async function Extensions() {
  await requireTenant();
  return (<><PageHead title="Extensions & readiness" crumbs={[["Company"], ["Extensions"]]} sub="Not part of the standard product. Tell us what you need and we will scope it with you." />
    <div className="card flush tablewrap"><table><thead><tr><th>Capability</th><th>Availability</th><th>Status in your plan</th></tr></thead><tbody>{EXT.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td><td><Badge status="draft" label="not enabled" /></td></tr>)}</tbody></table></div>
    <div className="card"><h2>Register interest</h2><ActionForm action={extensionInterestAction} submit="Send" resetOnSuccess><Field name="message" label="Which extension and what do you need?" type="textarea" required /></ActionForm></div></>);
}
