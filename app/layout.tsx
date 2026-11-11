import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/Toaster";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`, template: `%s · ${PRODUCT_NAME}` },
  description: "Tender, BOQ, contract, measurement, running bills, procurement and handover in one multi-company project ERP for contractors and builders.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-3">Skip to content</a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
