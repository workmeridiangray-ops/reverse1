import type { Metadata } from "next";
import Link from "next/link";
import { DateTimeText } from "@/components/ui/Format";
import { Card, EmptyState, PageHeader } from "@/components/ui/Layout";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { markNotificationsRead } from "../lab/actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Notifications() {
  const session = await requireSession();
  const { data } = await (await createClient()).from("notifications").select("id, title, link, created_at, read_at, kind").order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Notifications" actions={rows.some((r) => !r.read_at) ? <form action={markNotificationsRead}><SubmitButton variant="secondary">Mark all read</SubmitButton></form> : null} />
      <Card>{rows.length === 0 ? <EmptyState title="Nothing new" /> : (
        <ul className="divide-y divide-line">{rows.map((n) => (
          <li key={n.id} className="py-3">{n.link ? <Link href={n.link} className={n.read_at ? "" : "font-bold"}>{n.title}</Link> : <span>{n.title}</span>}
            {n.kind === "critical_result" ? " · critical" : ""}<br /><span className="text-sm text-ink-500"><DateTimeText at={n.created_at} timeZone={session.clinic.timezone} />{n.read_at ? "" : " · new"}</span></li>))}</ul>)}</Card>
    </>
  );
}
