import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Runs a mutation; on success redirects to `to` with ?ok=, on failure back to `back` with ?error=. */
export async function act(back: string, to: string, ok: string, fn: (sb: Awaited<ReturnType<typeof createClient>>) => Promise<string | void>): Promise<never> {
  let dest = to;
  try {
    const sb = await createClient();
    const override = await fn(sb);
    if (override) dest = override;
    revalidatePath("/app", "layout");
  } catch (e) {
    unstable_rethrow(e);
    const msg = (e as Error).message || "Something went wrong";
    redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
  }
  if (/^https:\/\//.test(dest)) redirect(dest);
  redirect(`${dest}${dest.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok)}`);
}

/** Throws a readable Error when a Supabase call failed. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string) => Number(str(f, k));
