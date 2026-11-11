import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";
import { ActionForm } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { forgotAction } from "../actions";
export const metadata = { title: "Reset password" };
export default function P() { return <AuthCard title="Reset your password" sub="We’ll email a link that works for one hour." foot={<Link className="text-brand underline" href="/login">Back to sign in</Link>}>
  <ActionForm action={forgotAction} submit="Send reset link"><Field label="Email" name="email" type="email" required /></ActionForm></AuthCard>; }
