"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions";

/** One-click server action with confirm, pending state and visible result. */
export function StatusButton({ action, label, confirm, danger, className = "btn" }: { action: () => Promise<ActionResult>; label: string; confirm?: string; danger?: boolean; className?: string }) {
  const [pending, start] = useTransition(); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const router = useRouter();
  return (
    <span>
      <button type="button" className={`${className} ${danger ? "danger" : ""}`} disabled={pending} aria-busy={pending}
        onClick={() => { if (confirm && !window.confirm(confirm)) return; start(async () => { const r = await action(); setMsg({ ok: r.ok, t: r.ok ? r.message ?? "Done" : r.error }); if (r.ok) { if (r.redirectTo) router.push(r.redirectTo); else router.refresh(); } }); }}>
        {pending ? "Working…" : label}</button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "small muted" : "err"} style={{ marginLeft: 8 }}>{msg.t}</span>}
    </span>
  );
}
