"use client";
import { useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { startTotpAction, enableTotpAction } from "@/lib/auth/actions";
import type { ActionResult } from "@/lib/actions";

export function TotpSetup() {
  const [info, setInfo] = useState<{ secret: string; uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [state, run, pending] = useActionState<(ActionResult & { codes?: string[] }) | null, FormData>(async (_p, f) => enableTotpAction(null, f), null);
  if (state?.ok) return (
    <div className="alert ok" role="status"><strong>Two-factor authentication is on.</strong><p>Save these recovery codes somewhere safe. Each works once if you lose your device. They are shown only now.</p>
      <pre style={{ fontSize: 16, userSelect: "all" }}>{state.codes?.join("\n")}</pre><button className="btn" onClick={() => router.refresh()}>I’ve saved them</button></div>);
  return (
    <div>
      {!info ? <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); setInfo(await startTotpAction()); setBusy(false); }}>Set up authenticator app</button> : (
        <form action={run}>
          <p>Add this key in an authenticator app (Google Authenticator, Authy, 1Password…) as a time-based code:</p>
          <p><code style={{ fontSize: 18, userSelect: "all", wordBreak: "break-all" }}>{info.secret}</code></p>
          <p className="small muted">Or open on your phone: <a href={info.uri}>authenticator link</a>. Issuer: Ledgerline.</p>
          {state && !state.ok && <div className="alert bad" role="alert">{state.error}</div>}
          <div className="field"><label className="f" htmlFor="code">Enter the 6-digit code to confirm</label><input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required /></div>
          <button className="btn primary" disabled={pending}>{pending ? "Checking…" : "Turn on two-factor"}</button>
        </form>)}
    </div>
  );
}
