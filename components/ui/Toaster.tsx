"use client";
import { useEffect, useState } from "react";

/** Persistent confirmation that survives the form that triggered it being re-rendered or removed. */
export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const h = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMsg({ text, id: Date.now() });
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 7000);
    };
    window.addEventListener("app:toast", h);
    return () => { window.removeEventListener("app:toast", h); clearTimeout(t); };
  }, []);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {msg ? (
        <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-lg border border-ok-line bg-ok-bg px-4 py-3 text-ok-fg shadow-raised">
          <span className="font-bold">{msg.text}</span>
          <button onClick={() => setMsg(null)} className="min-h-touch min-w-touch font-bold" aria-label="Dismiss message">×</button>
        </div>
      ) : null}
    </div>
  );
}
