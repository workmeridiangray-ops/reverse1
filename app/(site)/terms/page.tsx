import type { Metadata } from "next";
import { Alert, PageHeader } from "@/components/ui/Layout";

export const metadata: Metadata = { title: "Terms" };

export default function Page() {
  return (
    <>
      <PageHeader title="Terms" />
      <div className="max-w-prose">
        <Alert tone="warn" title="Draft, not yet approved">This page has not been reviewed by the operator's legal advisers. It must be replaced with approved wording before real patients or hospitals use the service.</Alert>
      </div>
    </>
  );
}
