import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true, poweredByHeader: false, output: "standalone",
  serverExternalPackages: ["pg"],
  async headers() {
    const csp = ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "frame-src https://api.razorpay.com https://checkout.razorpay.com", "connect-src 'self' https://lumberjack.razorpay.com https://api.razorpay.com", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }, { key: "Content-Security-Policy", value: csp },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }] }];
  },
};
export default nextConfig;
