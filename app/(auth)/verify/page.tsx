import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { verifyEmail } from "@/lib/server/accounts";
export const metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";
export default async function P({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token } = await searchParams; let err = "";
  try { if (!token) throw new Error("This link is incomplete."); await verifyEmail(token); } catch (e: any) { err = e.message; }
  return <AuthCard title={err ? "Verification failed" : "Email verified"} foot={<Link className="text-brand underline" href="/app">Continue</Link>}><p className="text-sm">{err || "Thanks — your email address is confirmed."}</p>{err && <p className="mt-2 text-sm text-muted">Sign in and use “Resend verification” in the banner to get a new link.</p>}</AuthCard>;
}
