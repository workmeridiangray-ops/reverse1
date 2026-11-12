import { type Q, many, one } from './db';
export async function onboardingSteps(q: Q, orgId: string) {
  const o = (await one<any>(q, 'select * from orgs where id = $1', [orgId]))!;
  const u = (await one<any>(q, 'select org_usage($1) u', [orgId]))!.u;
  const sub = await one<any>(q, `select status from subscriptions where org_id = $1`, [orgId]);
  const parties = await one<any>(q, 'select count(*) n from parties');
  return [
    { key: 'business', label: 'Add business details', href: '/settings/business', done: !!(o.legal_name && o.gstin && o.address) },
    { key: 'billing', label: 'Add billing details', href: '/settings/business', done: !!(o.billing_email && o.billing_address) },
    { key: 'branch', label: 'Set up a branch or office', href: '/settings/branches', done: u.branches > 0 },
    { key: 'branding', label: 'Choose your brand colour', href: '/settings/business', done: !!o.setup?.branding },
    { key: 'team', label: 'Invite your team', href: '/settings/team', done: u.users > 1 },
    { key: 'parties', label: 'Add clients and suppliers', href: '/o/parties', done: Number(parties!.n) > 0 },
    { key: 'plan', label: 'Choose a plan', href: '/settings/billing', done: sub?.status === 'active' },
    { key: 'review', label: 'Review & activate', href: '/onboarding', done: !!o.setup?.activated },
  ];
}
