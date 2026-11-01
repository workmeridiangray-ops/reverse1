import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { HOME_BY_ROLE } from "@/lib/rules/routing";

export default async function Root() {
  const session = await requireSession();
  redirect(HOME_BY_ROLE[session.role]);
}
