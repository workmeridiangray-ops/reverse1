import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
export const metadata = { title: "Access denied" };
export default function P() { return <AuthCard title="Access denied" sub="Your role doesn’t include this area." foot={<Link className="text-brand underline" href="/app">Back to your home</Link>}><p className="text-sm text-muted">If you need access, ask your company owner to change your role. Access changes are logged.</p></AuthCard>; }
