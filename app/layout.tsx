import "./globals.css";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = { title: { default: "Forgeline — Manufacturing ERP & Production Planning", template: "%s · Forgeline" }, description: "Multi-company manufacturing ERP: BOMs, MRP, shop floor, quality, costing and dispatch in one traceable system.", robots: { index: true } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>{children}</body></html>;
}
