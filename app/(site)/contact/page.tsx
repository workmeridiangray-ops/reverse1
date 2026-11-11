import { Page } from "@/components/ui";
import { LeadForm } from "@/components/LeadForm";
export const metadata = { title: "Contact" };
export default function P() { return <div className="mx-auto max-w-xl"><Page title="Contact us" sub="Sales, support or add-ons — we reply within one business day."><LeadForm kind="contact" /></Page></div>; }
