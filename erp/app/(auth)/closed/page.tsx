import Link from "next/link";
export const metadata = { title: "Company closed" };
export default function Closed() {
  return (<div className="card"><h1>This company has been closed</h1><p>The workspace was closed and its data is retained only as described in the retention policy. Contact support if you need an export.</p><Link className="btn" href="/workspaces">Choose another company</Link></div>);
}
