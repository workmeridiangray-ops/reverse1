// Opens every registered screen as the right role and fails on crashes, console errors, 404s and WCAG A/AA violations.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const PORT = 4173, BASE = `http://127.0.0.1:${PORT}/`;
const withAxe = !process.argv.includes('--no-axe');
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* waiting */ } await sleep(200); }

// Pull the screen table out of the built registry by evaluating it in the page.
const browser = await chromium.launch();
const failures = []; let visited = 0; const axeSeen = new Map();

async function screens() {
  const p = await (await browser.newContext()).newPage(); await p.goto(BASE);
  await p.waitForSelector('h1'); const list = await p.evaluate(() => window.__SCREENS__); await p.close(); return list;
}
async function visit(page, path, label, expect) {
  const errors = [];
  const onErr = (e) => errors.push('pageerror: ' + e.message);
  const onCon = (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); };
  page.on('pageerror', onErr); page.on('console', onCon);
  await page.goto(BASE + '#' + path); await page.waitForTimeout(120);
  const body = await page.evaluate(() => document.body.innerText);
  const loc = await page.evaluate(() => location.hash.slice(1).split('?')[0]);
  if (/This screen hit a problem/.test(body)) errors.push('error boundary shown');
  if (/Page not found|Screen not found/.test(body) && !expect?.notFound) errors.push('not found');
  if (expect?.stay && loc !== path.split('?')[0]) errors.push(`redirected to ${loc} (expected to stay on ${path})`);
  if (expect?.redirect && loc !== expect.redirect) errors.push(`expected redirect to ${expect.redirect} but at ${loc}`);
  const hasH1 = await page.locator('h1').count(); if (!hasH1 && !expect?.redirect) errors.push('no h1');
  if (withAxe && !expect?.redirect) {
    const key = loc.replace(/\/[a-z]{2,3}_[a-z0-9_]+/gi, '/:id');
    if (!axeSeen.has(key)) { axeSeen.set(key, 1); try { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze(); r.violations.forEach((v) => errors.push(`a11y ${v.id} (${v.impact}): ${v.nodes[0]?.target?.join(' ')}`)); } catch (e) { errors.push('axe failed ' + e.message); } }
  }
  page.off('pageerror', onErr); page.off('console', onCon); visited++;
  if (errors.length) failures.push(`${label} ${path}\n   ` + [...new Set(errors)].join('\n   '));
}
async function login(ctx, email) {
  const page = await ctx.newPage(); await page.goto(BASE + '#/login'); await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'demo'); await page.click('button[type=submit]'); await page.waitForTimeout(150);
  if (/2fa/.test(page.url())) { await page.fill('input', '123456'); await page.click('button[type=submit]'); await page.waitForTimeout(150); }
  if (/workspaces/.test(page.url())) { await page.click('button.btn.secondary >> nth=0'); await page.waitForTimeout(150); }
  return page;
}
const all = await screens(); console.log(`registry: ${all.length} route patterns`);
const urlsFor = (area) => all.filter((s) => s.area === area).flatMap((s) => s.urls ?? (s.path.includes(':') ? [] : [s.path]));

// 1. Public + auth (signed out)
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  for (const u of [...urlsFor('public'), ...urlsFor('auth').filter((u) => !['/2fa', '/workspaces'].includes(u))]) await visit(page, u, 'public', { stay: true });
  await visit(page, '/app', 'guard', { redirect: '/login', notFound: false }); await visit(page, '/admin', 'guard', { redirect: '/login' }); await visit(page, '/portal', 'guard', { redirect: '/login' });
  await visit(page, '/no/such/page', 'public', { notFound: true }); await ctx.close(); }
// 2. Owner: every workspace screen
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await login(ctx, 'owner@northwind.test');
  for (const u of urlsFor('app')) await visit(page, u, 'owner', { stay: true });
  await visit(page, '/portal', 'owner→portal', { redirect: '/app' }); await visit(page, '/admin', 'owner→admin', { redirect: '/app' }); await ctx.close(); }
// 3. Mobile pass over key screens
{ const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true }); const page = await login(ctx, 'owner@northwind.test');
  for (const u of ['/app', '/app/invoices', '/app/invoices/in_t1_1', '/app/invoices/new', '/app/receipts/rc_t1_u0/allocate', '/app/collections', '/app/reconciliation/matching']) {
    await visit(page, u, 'mobile', { stay: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (overflow) failures.push(`mobile ${u}\n   horizontal page scroll`); }
  await ctx.close(); }
// 4. Staff: allowed screens work, restricted ones are denied
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await login(ctx, 'staff@northwind.test');
  for (const u of ['/app', '/app/invoices', '/app/receipts', '/app/masters/customers', '/app/expenses']) await visit(page, u, 'staff', { stay: true });
  for (const u of ['/app/users', '/app/plan', '/app/users/roles', '/app/reconciliation', '/app/integrations/api-keys']) await visit(page, u, 'staff-denied', { redirect: '/denied' });
  await ctx.close(); }
// 5. Customer portal
{ const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await login(ctx, 'accounts@aarav.example');
  for (const u of urlsFor('portal')) await visit(page, u, 'customer', { stay: true });
  await visit(page, '/app', 'customer→app', { redirect: '/portal' }); await ctx.close(); }
// 6. Platform roles
for (const [email, role] of [['priya@ledgerline.example', 'owner'], ['dev@ledgerline.example', 'billing'], ['sara@ledgerline.example', 'support'], ['ishaan@ledgerline.example', 'techops']]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await login(ctx, email);
  if (role === 'owner') for (const u of urlsFor('admin')) await visit(page, u, 'platform-owner', { stay: true });
  else { await visit(page, '/admin', 'platform-' + role, { stay: true }); await visit(page, '/admin/staff', 'platform-' + role + '-denied', { redirect: '/denied' }); }
  await ctx.close(); }

await browser.close(); server.kill();
console.log(`visited ${visited} screens`);
if (failures.length) { console.error(`\n${failures.length} problem(s):\n` + failures.join('\n')); process.exit(1); }
console.log('✓ no crashes, console errors, dead pages or WCAG A/AA violations');
