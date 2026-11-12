import Link from "next/link";
export default function NotFound() { return (<main id="main" style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}><div className="card"><h1>Not found</h1><p>This page or record doesn’t exist, or isn’t available to your account.</p><Link className="btn" href="/">Go home</Link></div></main>); }
