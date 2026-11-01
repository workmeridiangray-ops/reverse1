"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Keeps the board live: re-renders the server component when any appointment
 * or room in this clinic changes (Supabase Realtime, RLS-filtered), and once a
 * minute so waiting times and lateness stay current.
 */
export function LiveRefresh({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const sb = browserClient();
    const channel = sb
      .channel(`board-${clinicId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `clinic_id=eq.${clinicId}` }, refresh)
      .subscribe((status) => setLive(status === "SUBSCRIBED" ? "live" : status === "CLOSED" || status === "CHANNEL_ERROR" ? "offline" : "connecting"));
    const tick = setInterval(() => router.refresh(), 60_000);
    return () => {
      clearInterval(tick);
      if (timer.current) clearTimeout(timer.current);
      void sb.removeChannel(channel);
    };
  }, [clinicId, router]);

  const label = { connecting: "Connecting…", live: "Live", offline: "Updates paused, refreshing every minute" }[live];
  return (
    <p className="inline-flex items-center gap-2 text-sm text-ink-500" aria-live="polite">
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-pill ${live === "live" ? "bg-ok-fg" : "bg-ink-300"}`} />
      {label}
    </p>
  );
}
