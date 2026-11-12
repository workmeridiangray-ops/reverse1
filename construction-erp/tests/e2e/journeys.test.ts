import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import pg from 'pg';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.E2E_BASE ?? 'http://localhost:3100';
const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER });
let browser: any; const errors: string[] = [];

async function login(email: string, pw = 'Demo-pass-123') {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => errors.push(`${email}: ${e.message}`));
  page.on('response', (r: any) => { if (r.status() >= 500) errors.push(`${email}: ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`); await page.fill('#email', email); await page.fill('#password', pw); await page.click('button[type=submit]');
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  return { ctx, page };
}
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser.close(); await owner.end(); });

describe('public site and access control', () => {
  it('serves public pages, health, and refuses anonymous access', async () => {
    for (const p of ['/', '/features', '/solutions', '/pricing', '/help', '/updates', '/contact', '/demo', '/legal/terms', '/legal/privacy', '/signup', '/login', '/forgot']) { const r = await fetch(BASE + p); expect(r.status, p).toBe(200); }
    expect((await (await fetch(BASE + '/api/health')).json()).status).toBe('ok');
    const dash = await fetch(BASE + '/dashboard', { redirect: 'manual' }); expect([307, 308]).toContain(dash.status); expect(dash.headers.get('location')).toContain('/login');
    expect((await fetch(BASE + '/api/files/00000000-0000-0000-0000-000000000000')).status).toBe(401);
    expect((await fetch(BASE + '/api/cron/tick', { method: 'POST' })).status).toBe(401);
    expect((await fetch(BASE + '/api/webhooks/payments', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(BASE + '/nope')).status).toBe(404);
  });
  it('wrong password shows a clear error and stays on the form', async () => {
    const page = await (await browser.newContext()).newPage(); await page.goto(`${BASE}/login`);
    await page.fill('#email', 'owner@demo.test'); await page.fill('#password', 'wrong-password-1'); await page.click('button[type=submit]');
    await page.waitForSelector('form [role=alert]'); expect(await page.textContent('form [role=alert]')).toContain('incorrect'); expect(page.url()).toContain('/login');
  });
});

describe('internal roles', () => {
  let pid: string;
  it('owner sees the dashboard and every project screen loads without errors', async () => {
    const { page, ctx } = await login('owner@demo.test');
    expect(page.url()).toContain('/dashboard'); expect(await page.textContent('h1')).toContain('Dashboard');
    pid = (await owner.query(`select id from projects where code='DEMO-1'`)).rows[0].id;
    for (const sub of ['', '/boq', '/contract', '/schedule', '/drawings', '/procurement', '/stores', '/reports', '/subcontract', '/quality', '/billing', '/variations', '/handover', '/team', '/e/wbs', '/e/rfis', '/e/purchase_orders', '/e/incidents', '/e/snags', '/e/forecast']) {
      const r = await page.goto(`${BASE}/p/${pid}${sub}`); expect(r.status(), sub).toBeLessThan(400);
      expect(await page.locator('h1').first().textContent(), sub).toBeTruthy();
    }
    for (const p of ['/inbox', '/tenders', '/o/parties', '/settings', '/settings/team', '/settings/billing', '/settings/business', '/settings/audit', '/account', '/account/security', '/account/sessions', '/account/notifications', '/notifications', '/onboarding', '/search?q=DEMO']) { const r = await page.goto(BASE + p); expect(r.status(), p).toBeLessThan(400); }
    await ctx.close();
  });
  it('supervisor submits a daily report on a phone-size screen; engineer verifies; progress updates', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const page = await ctx.newPage();
    await page.goto(`${BASE}/login`); await page.fill('#email', 'supervisor@demo.test'); await page.fill('#password', 'Demo-pass-123'); await page.click('button[type=submit]'); await page.waitForURL(/dashboard/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);   // no horizontal page scroll on mobile
    await page.goto(`${BASE}/p/${pid}/reports/new`);
    await page.selectOption('#site_id', { index: 1 });
    await page.selectOption('[name=qt_activity_0]', { label: 'ACT-1 · Excavation' }); await page.fill('[name=qt_claimed_0]', '120');
    await page.fill('[name=lab_trade_0]', 'Mason'); await page.fill('[name=lab_headcount_0]', '8');
    await page.click('button[name=intent][value=submit]'); await page.waitForURL(/reports\/[0-9a-f-]{36}/, { timeout: 15000 });
    expect(await page.textContent('main')).toContain('submitted'); await ctx.close();
    const eng = await login('engineer@demo.test'); await eng.page.goto(page.url());
    await eng.page.waitForSelector('input[name^=vq_]'); await eng.page.fill('input[name^=vq_]', '100'); await eng.page.fill('input[name^=vr_]', 'Only 100 m3 measured on site');
    await eng.page.click('button[type=submit]:has-text("Verify report")'); await eng.page.waitForSelector('input[name^=vq_]', { state: 'detached', timeout: 15000 });
    const a = (await owner.query(`select done_qty from activities where code='ACT-1'`)).rows[0]; expect(a.done_qty).toBe('100.000');
    const rq = (await owner.query(`select claimed_qty, verified_qty from report_quantities`)).rows[0]; expect(rq).toMatchObject({ claimed_qty: '120.000', verified_qty: '100.000' });
    await eng.ctx.close();
  });
  it('a store keeper cannot open billing or settings', async () => {
    const { page, ctx } = await login('store@demo.test');
    await page.goto(`${BASE}/p/${pid}/billing`); expect(page.url()).toContain('/denied');
    await page.goto(`${BASE}/settings/team`); expect(page.url()).toMatch(/denied/); await ctx.close();
  });
});

describe('client portal', () => {
  it('client sees the portal only, never internal pages or another tenant', async () => {
    const { page, ctx } = await login('client@demo.test');
    expect(page.url()).toContain('/portal');
    const pid = (await owner.query(`select id from projects where code='DEMO-1'`)).rows[0].id;
    await page.goto(`${BASE}/portal/${pid}`); expect(await page.textContent('main')).toContain('Physical progress'); expect(await page.innerText('main')).not.toMatch(/budget|margin|Procurement|rate analysis/i);
    await page.goto(`${BASE}/dashboard`); expect(page.url()).toContain('/portal');
    await page.goto(`${BASE}/p/${pid}/boq`); expect(page.url()).toContain('/portal');
    expect((await page.goto(`${BASE}/portal/00000000-0000-0000-0000-000000000000`))!.status()).toBe(404);
    await ctx.close();
  });
});

describe('sign-up, verification, trial, test payment', () => {
  it('a new business signs up, verifies email, and activates a plan through the test provider', async () => {
    const email = `new-${Date.now()}@e2e.test`; const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(`${BASE}/signup`); await page.fill('#name', 'Nina New'); await page.fill('#email', email); await page.fill('#company', 'E2E Builders'); await page.fill('#password', 'Sturdy-pass-77'); await page.check('input[name=terms]'); await page.click('button[type=submit]');
    await page.waitForURL(/verify\/sent/); expect(await page.locator('a:has-text("verification link")').count()).toBe(0);   // dev link must never be shown in production
    const mail = (await owner.query(`select body from email_outbox where to_email = $1 and subject like 'Verify%'`, [email])).rows[0].body as string; const link = mail.match(/https?:\/\/\S+/)![0]; expect(link).toContain('/verify?token=');
    await page.goto(`${BASE}/login`); await page.fill('#email', email); await page.fill('#password', 'Sturdy-pass-77'); await page.click('button[type=submit]');
    await page.waitForSelector('form [role=alert]'); expect(await page.textContent('form [role=alert]')).toContain('Verify your email');
    await page.goto(link!); expect(await page.textContent('h1')).toContain('Email confirmed');
    await page.goto(`${BASE}/login`); await page.fill('#email', email); await page.fill('#password', 'Sturdy-pass-77'); await page.click('button[type=submit]'); await page.waitForURL(/dashboard/);
    expect(await page.textContent('body')).toContain('Free trial');
    await page.goto(`${BASE}/settings/billing`); await page.locator('form:has(input[value=starter]) button[type=submit]').click(); await page.waitForURL(/pay=/);
    await page.once('dialog', (d: any) => d.accept()); await page.click('button:has-text("Simulate successful payment")'); await page.waitForTimeout(1500); await page.reload();
    expect(await page.textContent('main')).toContain('Payment received');
    const sub = (await owner.query(`select s.status, p.code from subscriptions s join plans p on p.id=s.plan_id join orgs o on o.id=s.org_id where o.name='E2E Builders'`)).rows[0]; expect(sub).toMatchObject({ status: 'active', code: 'starter' });
    await ctx.close();
  });
  it('no server errors or uncaught browser exceptions occurred during the journeys', () => { expect(errors).toEqual([]); });
});
