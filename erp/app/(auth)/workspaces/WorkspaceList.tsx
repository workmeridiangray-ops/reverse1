"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { selectWorkspaceAction } from "@/lib/auth/actions";
export function WorkspaceList({ items }: { items: { id: string; name: string; role: string; status: string; customer: boolean }[] }) {
  const router = useRouter(); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  return (<div className="stack">
    {err && <div className="alert bad" role="alert">{err}</div>}
    {items.map((w) => (
      <button key={w.id} className="card btn" style={{ justifyContent: "space-between", width: "100%", textAlign: "left", minHeight: 64 }} disabled={!!busy}
        onClick={async () => { setBusy(w.id); const r = await selectWorkspaceAction(w.id); if (r.ok) router.push(r.redirectTo ?? "/app"); else { setErr(r.error); setBusy(""); } }}>
        <span><strong>{w.name}</strong><br /><span className="small muted">{w.role}{w.customer ? " · customer portal" : ""}</span></span>
        <span className="small muted">{busy === w.id ? "Opening…" : w.status}</span>
      </button>))}
  </div>);
}
