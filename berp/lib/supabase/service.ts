import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses RLS: only for webhooks and the API, always filtering by tenant explicitly. */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
