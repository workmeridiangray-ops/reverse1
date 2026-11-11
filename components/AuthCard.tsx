import Link from "next/link";
export function AuthCard({ title, sub, children, foot }: { title: string; sub?: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (<div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
    <Link href="/" className="mb-6 text-lg font-semibold text-brand">Forgeline</Link>
    <main id="main" className="card w-full max-w-md p-6"><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}<div className="mt-5">{children}</div></main>
    {foot && <div className="mt-4 text-sm text-muted">{foot}</div>}
  </div>);
}
