-- Identity, entitlement, numbering and ledger helpers.

create or replace function app.tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.active_tenant_id from public.profiles p
  join public.memberships m on m.user_id = p.user_id and m.tenant_id = p.active_tenant_id and m.active
  join public.tenants t on t.id = m.tenant_id and t.status <> 'cancelled'
  where p.user_id = auth.uid()
$$;

create or replace function app.role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.user_id = auth.uid() and m.tenant_id = app.tenant_id() and m.active
$$;

create or replace function app.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.role() = any (roles), false)
$$;

create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Writes are refused while the tenant is suspended or its trial has expired.
create or replace function app.require_writable() returns void
language plpgsql stable security definer set search_path = '' as $$
declare t public.tenants;
begin
  select * into t from public.tenants where id = app.tenant_id();
  if t.id is null then raise exception 'no active workspace' using errcode = '42501'; end if;
  if t.status in ('suspended','cancelled') then raise exception 'workspace is %', t.status using errcode = '42501'; end if;
  if t.status = 'trial' and t.trial_ends_at < now() then raise exception 'trial expired: choose a plan' using errcode = '42501'; end if;
end $$;

create or replace function app.require_role(variadic roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_writable();
  if not app.has_role(variadic roles) then raise exception 'role not permitted' using errcode = '42501'; end if;
end $$;

create or replace function app.next_number(p_tenant uuid, p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into app.counters as c (tenant_id, kind, last) values (p_tenant, p_kind, 1)
  on conflict (tenant_id, kind) do update set last = c.last + 1 returning last into n;
  return p_prefix || '-' || lpad(n::text, 5, '0');
end $$;

create or replace function app.account_id(p_tenant uuid, p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.accounts where tenant_id = p_tenant and system_key = p_key
$$;

-- ---- generic triggers
create or replace function app.forbid_tenant_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'tenant_id cannot be changed' using errcode = '42501'; end if;
  return new;
end $$;

create or replace function app.immutable() returns trigger language plpgsql set search_path = '' as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;

create or replace function app.audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare j_new jsonb := to_jsonb(new); j_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end; f text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into f from jsonb_object_keys(j_new) k where j_new->k is distinct from j_old->k;
  end if;
  insert into public.audit_log (tenant_id, actor, action, table_name, row_id, changed_fields)
  values ((case tg_table_name when 'tenants' then j_new->>'id' else j_new->>'tenant_id' end)::uuid, auth.uid(), tg_op, tg_table_name, j_new->>'id', f);
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['branches','warehouses','tax_codes','customers','suppliers','items','sales_orders','purchase_orders','supplier_bills','invoices','payments','accounts','memberships','tenants'] loop
    execute format('create trigger audit after insert or update on public.%I for each row execute function app.audit()', t);
  end loop;
  foreach t in array array['branches','warehouses','tax_codes','customers','suppliers','items','sales_orders','sales_order_lines','purchase_requests','purchase_orders','purchase_order_lines','goods_receipts','supplier_bills','dispatches','invoices','payments','accounts','journal_entries','stock_movements','memberships'] loop
    execute format('create trigger forbid_tenant_change before update on public.%I for each row execute function app.forbid_tenant_change()', t);
  end loop;
  foreach t in array array['stock_movements','journal_entries','journal_lines','audit_log','goods_receipt_lines','dispatch_lines','invoice_lines','payment_allocations'] loop
    execute format('create trigger immutable before update or delete on public.%I for each row execute function app.immutable()', t);
  end loop;
end $$;

-- ---- ledger integrity: every entry balances, in a closed period nothing posts
create or replace function app.check_entry_balanced() returns trigger language plpgsql security definer set search_path = '' as $$
declare d bigint; c bigint; e uuid := coalesce(new.entry_id, old.entry_id);
begin
  select coalesce(sum(debit_paise),0), coalesce(sum(credit_paise),0) into d, c from public.journal_lines where entry_id = e;
  if d <> c or d = 0 then raise exception 'journal entry % is unbalanced (debit %, credit %)', e, d, c using errcode = '23514'; end if;
  return null;
end $$;
create constraint trigger journal_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_entry_balanced();

create or replace function app.check_period_open() returns trigger language plpgsql security definer set search_path = '' as $$
declare lk date;
begin
  select locked_through into lk from public.period_locks where tenant_id = new.tenant_id;
  if lk is not null and new.entry_date <= lk then raise exception 'period closed through %', lk using errcode = '23514'; end if;
  return new;
end $$;
create trigger period_open before insert on public.journal_entries for each row execute function app.check_period_open();

-- ---- entitlements: plan limits on users, branches, warehouses
create or replace function app.check_entitlement() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.plans; n int;
begin
  select pl.* into p from public.plans pl join public.tenants t on t.plan_code = pl.code where t.id = new.tenant_id;
  if tg_table_name = 'memberships' then
    if not new.active then return new; end if;
    select count(*) into n from public.memberships where tenant_id = new.tenant_id and active and user_id <> new.user_id;
    if n + 1 > p.max_users then raise exception 'plan limit: % users on the % plan', p.max_users, p.name using errcode = '53400'; end if;
  elsif tg_table_name = 'branches' then
    select count(*) into n from public.branches where tenant_id = new.tenant_id and active and id <> new.id;
    if n + 1 > p.max_branches then raise exception 'plan limit: % branches on the % plan', p.max_branches, p.name using errcode = '53400'; end if;
  else
    select count(*) into n from public.warehouses where tenant_id = new.tenant_id and active and id <> new.id;
    if n + 1 > p.max_warehouses then raise exception 'plan limit: % warehouses on the % plan', p.max_warehouses, p.name using errcode = '53400'; end if;
  end if;
  return new;
end $$;
create trigger entitlement before insert or update on public.memberships for each row execute function app.check_entitlement();
create trigger entitlement before insert or update on public.branches for each row execute function app.check_entitlement();
create trigger entitlement before insert or update on public.warehouses for each row execute function app.check_entitlement();

-- ---- stock views
create or replace view public.stock_levels with (security_invoker = true) as
select i.tenant_id, i.id as item_id, w.id as warehouse_id, i.sku, i.name as item_name, w.name as warehouse_name, i.unit, i.reorder_level,
  coalesce((select sum(m.qty) from public.stock_movements m where m.tenant_id = i.tenant_id and m.item_id = i.id and m.warehouse_id = w.id), 0) as on_hand,
  coalesce((select sum(r.qty) from public.reservations r where r.tenant_id = i.tenant_id and r.item_id = i.id and r.warehouse_id = w.id), 0) as reserved
from public.items i join public.warehouses w on w.tenant_id = i.tenant_id
where i.kind = 'stock' and i.active and w.active;

-- ---- posting helper (internal): creates a balanced entry from jsonb lines [{key, debit, credit}]
create or replace function app.post_journal(p_tenant uuid, p_date date, p_memo text, p_src text, p_src_id uuid, p_lines jsonb,
  p_reverses uuid default null, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e uuid; l jsonb; a uuid;
begin
  insert into public.journal_entries (tenant_id, number, entry_date, memo, source_type, source_id, reverses_id, reversal_reason, created_by)
  values (p_tenant, app.next_number(p_tenant,'journal','JV'), p_date, p_memo, p_src, p_src_id, p_reverses, p_reason, auth.uid()) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::bigint,0) = 0 and coalesce((l->>'credit')::bigint,0) = 0 then continue; end if;
    a := app.account_id(p_tenant, l->>'key');
    if a is null then raise exception 'missing system account %', l->>'key'; end if;
    insert into public.journal_lines (tenant_id, entry_id, account_id, debit_paise, credit_paise)
    values (p_tenant, e, a, coalesce((l->>'debit')::bigint,0), coalesce((l->>'credit')::bigint,0));
  end loop;
  if not exists (select 1 from public.journal_lines where entry_id = e) then raise exception 'journal entry has no non-zero lines'; end if;
  return e;
end $$;

-- money helpers (mirror lib/rules/money.ts)
create or replace function app.line_net(p_qty numeric, p_price bigint, p_disc_bp int) returns bigint
language sql immutable as $$ select round(round(p_qty * p_price) * (10000 - p_disc_bp) / 10000.0)::bigint $$;
create or replace function app.line_tax(p_net bigint, p_rate_bp int) returns bigint
language sql immutable as $$ select round(p_net * p_rate_bp / 10000.0)::bigint $$;

create or replace view public.trial_balance with (security_invoker = true) as
select a.tenant_id, a.id as account_id, a.code, a.name, a.type,
  coalesce(sum(l.debit_paise),0)::bigint as debit_paise, coalesce(sum(l.credit_paise),0)::bigint as credit_paise,
  (coalesce(sum(l.debit_paise),0) - coalesce(sum(l.credit_paise),0))::bigint as balance_paise
from public.accounts a left join public.journal_lines l on l.account_id = a.id and l.tenant_id = a.tenant_id
group by a.tenant_id, a.id, a.code, a.name, a.type;
