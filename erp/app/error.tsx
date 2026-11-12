"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (<main id="main" style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}><div className="card"><h1>Something went wrong</h1><p>The page could not be loaded and nothing was changed. Try again; if it keeps happening, contact support with the time it occurred.</p><div className="row"><button className="btn primary" onClick={reset}>Try again</button><a className="btn" href="/">Home</a></div></div></main>);
}
