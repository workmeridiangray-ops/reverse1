// Central, validated configuration. Secrets only ever come from the environment.
const get = (k: string, d?: string) => process.env[k] ?? d;

export const env = {
  get databaseUrl() { return must('DATABASE_URL'); },
  get appUrl() { return get('APP_URL', 'http://localhost:3100')!; },
  get isProd() { return process.env.NODE_ENV === 'production'; },
  get storageDir() { return get('STORAGE_DIR', './.storage')!; },
  get maxUploadMb() { return Number(get('MAX_UPLOAD_MB', '25')); },
  get sessionDays() { return Number(get('SESSION_DAYS', '14')); },
  get mailFrom() { return get('MAIL_FROM', 'Buildline <no-reply@localhost>')!; },
  get resendKey() { return get('RESEND_API_KEY'); },
  get razorpayKeyId() { return get('RAZORPAY_KEY_ID'); },
  get razorpayKeySecret() { return get('RAZORPAY_KEY_SECRET'); },
  get razorpayWebhookSecret() { return get('RAZORPAY_WEBHOOK_SECRET'); },
  /** Defaults to the live provider in production; "test" (simulated payments) must be chosen explicitly, e.g. on staging. */
  get paymentMode() { return (get('PAYMENT_MODE', process.env.NODE_ENV === 'production' ? 'razorpay' : 'test') as 'test' | 'razorpay'); },
  get cronSecret() { return get('CRON_SECRET'); },
  get demoEnabled() { return get('ALLOW_DEMO_DATA', 'true') === 'true'; },
};
function must(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required environment variable ${k}`);
  return v;
}
