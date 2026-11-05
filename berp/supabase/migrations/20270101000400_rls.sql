-- Row-level security. Default deny; the tenant comes from the caller's active workspace.
-- Masters are written directly (role-gated). Everything transactional is written only
-- through the SECURITY DEFINER functions in 0300, never by direct INSERT/UPDATE.
--
-- read matrix        owner mgr sales purch wh  acct viewer
-- operational docs     y    y    y     y    y    y    y      (orders, POs, receipts, dispatches, stock)
-- finance docs         y    y    -     -    -    y    y      (invoices, payments, bills, journals, accounts)
-- audit log            y    y    -     -    -    -    -
-- write masters:  customers/items: owner,mgr,sales | suppliers: owner,mgr,purch | org+tax+accounts: owner (accounts: owner,acct)

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema app from public, anon, authenticated;
-- internal helpers are not callable by clients; only what RLS policies evaluate stays executable
revoke execute on all functions in schema app from authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;

grant select on all tables in schema public to authenticated;
revoke select on public.platform_admins from authenticated;
grant insert, update, delete on public.customers, public.suppliers, public.items, public.branches,
  public.warehouses, public.tax_codes, public.accounts to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (name, credit_check, bill_tolerance_bp) on public.tenants to authenticated;

do $$ declare t text; begin
  foreach t in array array['plans','tenants','profiles','memberships','platform_admins','subscription_events','branches','warehouses','tax_codes',
    'customers','suppliers','items','accounts','period_locks','journal_entries','journal_lines','sales_orders','sales_order_lines','reservations',
    'stock_movements','purchase_requests','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_bills',
    'dispatches','dispatch_lines','invoices','invoice_lines','payments','payment_allocations','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  alter table app.counters enable row level security; -- no policies: definer-only
end $$;

create policy plans_read on public.plans for select to authenticated using (true);

create policy tenants_read on public.tenants for select to authenticated using (id = (select app.tenant_id()) or (select app.is_platform_admin()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select app.tenant_id()) and (select app.has_role('owner'))) with check (id = (select app.tenant_id()));

create policy profiles_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or tenant_id = (select app.tenant_id()));
create policy subs_read on public.subscription_events for select to authenticated
  using ((tenant_id = (select app.tenant_id()) and (select app.has_role('owner'))) or (select app.is_platform_admin()));

-- tenant-scoped read for operational tables
do $$ declare t text; begin
  foreach t in array array['branches','warehouses','tax_codes','customers','suppliers','items','sales_orders','sales_order_lines','reservations',
    'stock_movements','purchase_requests','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','dispatches','dispatch_lines'] loop
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = (select app.tenant_id()))', t||'_read', t);
  end loop;
  foreach t in array array['accounts','period_locks','journal_entries','journal_lines','invoices','invoice_lines','payments','payment_allocations','supplier_bills'] loop
    execute format('create policy %I on public.%I for select to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role(''owner'',''manager'',''accountant'',''viewer'')))', t||'_read', t);
  end loop;
end $$;
create policy audit_read on public.audit_log for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager')));
-- sales staff also see invoices for their customers' statements
create policy invoices_sales_read on public.invoices for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('sales')));
create policy invoice_lines_sales_read on public.invoice_lines for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('sales')));

-- master writes
create policy customers_write on public.customers for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','sales')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','sales')));
create policy items_write on public.items for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','sales')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','sales')));
create policy suppliers_write on public.suppliers for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','purchasing')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager','purchasing')));
do $$ declare t text; begin
  foreach t in array array['branches','warehouses','tax_codes'] loop
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role(''owner''))) with check (tenant_id = (select app.tenant_id()) and (select app.has_role(''owner'')))', t||'_write', t);
  end loop;
end $$;
create policy accounts_write on public.accounts for all to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','accountant')))
  with check (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','accountant')));

-- masters that history refers to are retired, never deleted
revoke delete on public.customers, public.suppliers, public.items, public.branches, public.warehouses, public.tax_codes, public.accounts from authenticated;
-- system accounts keep their keys
create or replace function app.protect_system_accounts() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.system_key is not null and (new.system_key is distinct from old.system_key or new.type <> old.type or not new.active) then
    raise exception 'system account % cannot be retyped or deactivated', old.code using errcode = '42501';
  end if;
  return new;
end $$;
create trigger protect_system before update on public.accounts for each row execute function app.protect_system_accounts();
-- new accounts created by users never carry system keys
create or replace function app.no_user_system_key() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.system_key is not null and current_user = 'authenticated' then raise exception 'system_key is reserved' using errcode = '42501'; end if;
  return new;
end $$;
create trigger no_system_key before insert on public.accounts for each row execute function app.no_user_system_key();

-- ---- platform administration (operates the software business; never exposes tenant documents)
create or replace function public.admin_list_tenants()
returns table (id uuid, name text, plan_code text, status text, trial_ends_at timestamptz, members bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'platform admins only' using errcode = '42501'; end if;
  return query select t.id, t.name, t.plan_code, t.status, t.trial_ends_at,
    (select count(*) from public.memberships m where m.tenant_id = t.id and m.active), t.created_at from public.tenants t order by t.created_at desc;
end $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then raise exception 'platform admins only' using errcode = '42501'; end if;
  if p_status not in ('trial','active','past_due','suspended','cancelled') then raise exception 'bad status'; end if;
  if p_note is null or length(trim(p_note)) < 3 then raise exception 'a note is required'; end if;
  update public.tenants set status = p_status where id = p_tenant;
  insert into public.subscription_events (tenant_id, kind, note) values (p_tenant,
    case p_status when 'suspended' then 'suspended' when 'cancelled' then 'cancelled' when 'past_due' then 'payment_failed' else 'reactivated' end, trim(p_note));
end $$;

create or replace function public.add_member_by_email(p_email text, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  perform app.require_role('owner');
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'no account with that email; ask them to sign up first'; end if;
  perform public.add_member(u, p_role);
end $$;

create or replace function public.team() returns table (user_id uuid, email text, full_name text, role public.app_role, active boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, coalesce(p.full_name,''), m.role, m.active
  from public.memberships m join auth.users u on u.id = m.user_id left join public.profiles p on p.user_id = m.user_id
  where m.tenant_id = app.tenant_id() and app.role() is not null order by m.created_at
$$;

create or replace function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_platform_admin() $$;

create or replace function public.current_tenant() returns uuid
language sql stable security definer set search_path = '' as $$ select app.tenant_id() $$;
