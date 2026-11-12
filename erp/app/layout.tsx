import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Ledgerline — ERP for growing businesses", template: "%s · Ledgerline" }, description: "Sales, purchasing, inventory, finance, projects and people in one multi-company ERP for growing SMEs and multi-branch companies." };
export const viewport = { width: "device-width", initialScale: 1 };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body><a className="skip" href="#main">Skip to content</a>{children}</body>
    </html>
  );
}
