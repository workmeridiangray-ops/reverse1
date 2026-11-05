"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "plain" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = variant === "primary" ? "btn btn-primary" : variant === "danger" ? "btn btn-danger" : "btn";
  return <button type="submit" className={cls} disabled={pending} aria-busy={pending}>{pending ? "Working…" : children}</button>;
}
