"use server";
import { act, must, str } from "@/lib/action";

export async function createWorkspace(f: FormData) {
  await act("/workspaces", "/app", "Workspace created", async (sb) => { must(await sb.rpc("create_workspace", { p_name: str(f, "name") })); });
}
export async function switchWorkspace(f: FormData) {
  await act("/workspaces", "/app", "Switched workspace", async (sb) => { must(await sb.rpc("switch_workspace", { p_tenant: str(f, "tenant") })); });
}
