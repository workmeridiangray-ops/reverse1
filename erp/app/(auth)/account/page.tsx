import Profile from "@/app/app/profile/page";
import { Alert } from "@/components/ui";
export const metadata = { title: "Account security" };
export default async function Account({ searchParams }: { searchParams: Promise<{ need2fa?: string }> }) {
  const sp = await searchParams;
  return (<div style={{ maxWidth: 760 }}>{sp.need2fa && <Alert tone="warn">Platform staff must turn on two-factor authentication before using the console.</Alert>}<Profile /></div>);
}
