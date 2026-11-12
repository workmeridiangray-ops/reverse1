import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Buildline — Construction project ERP', template: '%s' }, description: 'One system from tender to handover: BOQ, contracts, planning, procurement, site reporting, subcontract measurement, running bills and client portals.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-3">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
