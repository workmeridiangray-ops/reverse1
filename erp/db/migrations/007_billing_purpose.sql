alter table platform_invoices add column purpose text not null default 'new' check (purpose in ('new','renewal','upgrade'));
alter table platform_invoices add column billing_interval text not null default 'monthly';
alter table platform_invoices add column coupon_id uuid references platform_coupons(id);
alter table platform_invoices add column credit_applied_paise bigint not null default 0;
alter table platform_invoices add column checkout_ref text;
create table platform_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  amount_paise bigint not null, reason text not null, created_by uuid references users(id), used_invoice_id uuid references platform_invoices(id),
  created_at timestamptz not null default now()
);
alter table platform_credits enable row level security; alter table platform_credits force row level security;
create policy tenant_or_system on platform_credits using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on') with check (current_setting('app.system', true) = 'on');
grant select, insert, update, delete on platform_credits to erp_app;
