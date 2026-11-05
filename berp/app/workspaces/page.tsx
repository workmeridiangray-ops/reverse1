import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Field, Flash, TextInput } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createWorkspace, switchWorkspace } from "./actions";

export const metadata: Metadata = { title: "Choose a workspace" };

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const q = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: mem } = await sb.from("memberships").select("tenant_id, role, tenants(name, plan_code, status)").eq("user_id", user.id).eq("active", true);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-14">
      <h1 className="text-2xl font-semibold">Choose a company workspace</h1>
      <div className="mt-6"><Flash ok={q.ok} error={q.error} /></div>
      <ul className="space-y-2">
        {(mem ?? []).map((m: any) => (
          <li key={m.tenant_id} className="card flex items-center justify-between gap-3 p-4">
            <div><p className="font-medium">{m.tenants?.name}</p><p className="text-sm text-muted">{m.role} · {m.tenants?.plan_code} · {m.tenants?.status}</p></div>
            <form action={switchWorkspace}><input type="hidden" name="tenant" value={m.tenant_id} /><SubmitButton>Open</SubmitButton></form>
          </li>
        ))}
      </ul>
      <form action={createWorkspace} className="card mt-6 space-y-4 p-6">
        <h2 className="font-semibold">Create another company</h2>
        <Field label="Company name" name="name"><TextInput name="name" required minLength={2} /></Field>
        <SubmitButton>Create workspace</SubmitButton>
      </form>
    </main>
  );
}
