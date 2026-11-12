import Link from "next/link";
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (<main id="main"><div className="authbox" style={{ maxWidth: 800 }}><Link href="/" className="brand"><i />Ledgerline</Link>{children}</div></main>);
}
