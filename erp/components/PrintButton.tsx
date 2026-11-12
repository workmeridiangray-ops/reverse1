"use client";
export function PrintButton({ label = "Print" }: { label?: string }) { return <button type="button" className="btn no-print" onClick={() => window.print()}>{label}</button>; }
