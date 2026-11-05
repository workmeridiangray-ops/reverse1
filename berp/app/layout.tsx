import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "BERP — Business ERP", template: "%s · BERP" }, description: "Sales, purchasing, stock and finance in one multi-company ERP for growing businesses." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
