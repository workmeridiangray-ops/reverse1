import type { Metadata } from "next";
import { Logo } from "@/components/shell/Logo";
import { Alert } from "@/components/ui/Layout";
import { safeNextPath } from "@/lib/rules/routing";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo size="lg" /></div>
        <div className="rounded-lg border border-line bg-surface p-8 shadow-raised">
          <h1 className="mb-1 text-heading font-bold">Sign in</h1>
          <p className="mb-6 text-ink-700">Use the account your clinic gave you.</p>
          {error === "no-access" ? (
            <div className="mb-5">
              <Alert tone="warn" title="Your account isn't active">Ask your clinic administrator to restore access.</Alert>
            </div>
          ) : null}
          <LoginForm next={safeNextPath(next)} />
        </div>
        {process.env.NODE_ENV !== "production" ? (
          <p className="mt-6 text-center text-sm text-ink-500">
            Local demo: <span className="font-mono">desk@cedarlane.test</span>, <span className="font-mono">dr.okafor@cedarlane.test</span>,{" "}
            <span className="font-mono">admin@cedarlane.test</span> · password <span className="font-mono">tendwell-demo-pass</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
