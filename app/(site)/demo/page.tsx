import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/Layout";
import { DemoForm } from "./DemoForm";

export const metadata: Metadata = { title: "Request a demo" };

export default function Demo() {
  return (<><PageHeader title="Request a demo" description="Tell us about your hospital. We will reply by email." /><DemoForm /></>);
}
