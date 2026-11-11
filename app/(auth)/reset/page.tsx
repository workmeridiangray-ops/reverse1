import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field, Hidden } from "@/components/ui";
import { resetAction } from "../actions";
export const metadata = { title: "Choose a new password" };
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token } = await searchParams;
  if (!token) return <AuthCard title="Link incomplete" foot={<Link className="text-brand underline" href="/forgot">Request a new link</Link>}><p className="text-sm">This reset link is missing its token.</p></AuthCard>;
  return <AuthCard title="Choose a new password" sub="You’ll be signed out of all devices.">
    <ActionForm action={resetAction} submit="Update password" className="space-y-3"><Hidden name="token" value={token} /><Field label="New password" name="password" type="password" required hint="At least 10 characters, with letters and a number." /><Field label="Confirm password" name="confirm" type="password" required /></ActionForm></AuthCard>;
}
