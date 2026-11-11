import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Layout";

export const metadata: Metadata = { title: "Pricing" };

export default function Pricing() {
  return (
    <>
      <PageHeader title="Pricing" description="Priced per organisation, based on beds, sites and the modules you switch on." />
      <Card title="Get a quote">
        <p className="max-w-prose text-ink-700">Online plan selection and card checkout are not open yet, so there are no published prices. Tell us about your hospital and we will reply with a quote and an onboarding plan.</p>
        <Link href="/demo" className={`${buttonClass("primary")} mt-5`}>Request a quote</Link>
      </Card>
    </>
  );
}
