import Link from "next/link";
export const metadata = { title: "Access denied" };
export default function Denied() {
  return (<div className="card"><h1>Access denied</h1><p>Your role does not include this area. If you need it, ask a company owner to adjust your role.</p><Link className="btn" href="/app">Back to dashboard</Link></div>);
}
