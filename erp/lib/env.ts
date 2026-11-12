// Central configuration. Secrets only ever come from the environment, never from source.
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required environment variable ${name}`);
  return v;
}
export const isProd = process.env.NODE_ENV === "production";
export const env = {
  get databaseUrl() { return req("DATABASE_URL"); },
  get appUrl() { return (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, ""); },
  get billingProvider() { return (process.env.BILLING_PROVIDER ?? (isProd ? "razorpay" : "test")) as "test" | "razorpay"; },
  get razorpayKeyId() { return process.env.RAZORPAY_KEY_ID ?? ""; },
  get razorpayKeySecret() { return process.env.RAZORPAY_KEY_SECRET ?? ""; },
  get razorpayWebhookSecret() { return process.env.RAZORPAY_WEBHOOK_SECRET ?? ""; },
  get testWebhookSecret() { return process.env.TEST_WEBHOOK_SECRET ?? "dev-only-webhook-secret"; },
  get cronSecret() { return process.env.CRON_SECRET ?? ""; },
  get smtpUrl() { return process.env.SMTP_URL ?? ""; },
  get mailFrom() { return process.env.MAIL_FROM ?? "Ledgerline <no-reply@localhost>"; },
  get demoEnabled() { return process.env.ENABLE_DEMO_DATA === "true"; },
  get gstRateBps() { return Number(process.env.PLATFORM_TAX_BPS ?? "1800"); },
};
