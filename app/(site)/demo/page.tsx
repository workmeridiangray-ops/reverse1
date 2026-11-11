import { Page } from "@/components/ui";
import { LeadForm } from "@/components/LeadForm";
export const metadata = { title: "Request a demo" };
export default function P() { return <div className="mx-auto max-w-xl"><Page title="Request a demo" sub="Tell us about your plant and we’ll walk through your product structure on a live workspace."><LeadForm kind="demo" /></Page></div>; }
