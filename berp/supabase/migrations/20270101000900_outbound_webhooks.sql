-- Outbound webhooks: signed, retried, deduplicated delivery of business events to customer endpoints.
-- Events are written to an outbox in the same transaction as the change, so none is lost or sent for a rolled-back change.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null check (url ~ '^https://[^\s/@]+(:\d+)?(/\S*)?$' and length(url) <= 500),
  secret text not null, events text[] not null check (cardinality(events) > 0),
  active boolean not null default true, created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, endpoint_id uuid not null, event_id uuid not null, event_type text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','dead')),
  attempts int not null default 0, next_attempt_at timestamptz not null default now(),
  last_status int, last_error text, created_at timestamptz not null default now(), delivered_at timestamptz,
  unique (endpoint_id, event_id),
  foreign key (tenant_id, endpoint_id) references public.webhook_endpoints(tenant_id, id) on delete cascade
);
create index on public.webhook_deliveries (status, next_attempt_at) where status = 'pending';
create index on public.webhook_deliveries (tenant_id, created_at desc);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
create policy wh_endpoints_read on public.webhook_endpoints for select to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner')));
create policy wh_deliveries_read on public.webhook_deliveries for select to authenticated using (tenant_id = (select app.tenant_id()) and (select app.has_role('owner','manager')));
grant select (id, tenant_id, url, events, active, created_at) on public.webhook_endpoints to authenticated;  -- never the secret
grant select on public.webhook_deliveries to authenticated;
create trigger audit after insert or update on public.webhook_endpoints for each row execute function app.audit();

create or replace function app.webhook_event_types() returns text[] language sql immutable as $$
  select array['sales_order.confirmed','sales_order.cancelled','dispatch.created','invoice.created','payment.received','purchase_order.created','goods.received'] $$;

create or replace function app.emit_event(p_tenant uuid, p_type text, p_payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare ev uuid := gen_random_uuid();
begin
  insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, event_type, payload)
  select p_tenant, e.id, ev, p_type, jsonb_build_object('id', ev, 'type', p_type, 'created_at', now(), 'data', p_payload)
  from public.webhook_endpoints e where e.tenant_id = p_tenant and e.active and p_type = any (e.events);
end $$;

create or replace function app.emit_from_row() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'sales_orders' then
    if new.status = 'confirmed' and old.status = 'draft' then perform app.emit_event(new.tenant_id, 'sales_order.confirmed', jsonb_build_object('id', new.id, 'number', new.number, 'customer_id', new.customer_id, 'total_paise', app.order_total(new.id)));
    elsif new.status = 'cancelled' and old.status <> 'cancelled' then perform app.emit_event(new.tenant_id, 'sales_order.cancelled', jsonb_build_object('id', new.id, 'number', new.number)); end if;
  elsif tg_table_name = 'dispatches' then perform app.emit_event(new.tenant_id, 'dispatch.created', jsonb_build_object('id', new.id, 'number', new.number, 'order_id', new.order_id));
  elsif tg_table_name = 'invoices' then perform app.emit_event(new.tenant_id, 'invoice.created', jsonb_build_object('id', new.id, 'number', new.number, 'order_id', new.order_id, 'customer_id', new.customer_id, 'total_paise', new.total_paise, 'tax_paise', new.tax_paise));
  elsif tg_table_name = 'payments' then perform app.emit_event(new.tenant_id, 'payment.received', jsonb_build_object('id', new.id, 'number', new.number, 'customer_id', new.customer_id, 'amount_paise', new.amount_paise, 'method', new.method));
  elsif tg_table_name = 'purchase_orders' then perform app.emit_event(new.tenant_id, 'purchase_order.created', jsonb_build_object('id', new.id, 'number', new.number, 'supplier_id', new.supplier_id));
  elsif tg_table_name = 'goods_receipts' then perform app.emit_event(new.tenant_id, 'goods.received', jsonb_build_object('id', new.id, 'number', new.number, 'po_id', new.po_id));
  end if;
  return null;
end $$;
create trigger emit_event after update on public.sales_orders for each row execute function app.emit_from_row();
create trigger emit_event after insert on public.dispatches for each row execute function app.emit_from_row();
create trigger emit_event after insert on public.payments for each row execute function app.emit_from_row();
create trigger emit_event after insert on public.purchase_orders for each row execute function app.emit_from_row();
create trigger emit_event after insert on public.goods_receipts for each row execute function app.emit_from_row();
-- invoice totals are written after the row exists, so emit once the totals are final
create trigger emit_event after update of total_paise on public.invoices for each row when (old.total_paise = 0 and new.total_paise > 0) execute function app.emit_from_row();

-- Owner API. The signing secret is returned once.
create or replace function public.create_webhook(p_url text, p_events text[]) returns text
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); s text;
begin
  perform app.require_role('owner');
  if not (p_events <@ app.webhook_event_types()) or cardinality(p_events) = 0 then raise exception 'choose one or more of: %', array_to_string(app.webhook_event_types(), ', '); end if;
  if (select count(*) from public.webhook_endpoints where tenant_id = t and active) >= 5 then raise exception 'limit of 5 active webhook endpoints'; end if;
  s := 'whsec_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.webhook_endpoints (tenant_id, url, secret, events, created_by) values (t, trim(p_url), s, p_events, auth.uid());
  return s;
end $$;

create or replace function public.set_webhook_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  update public.webhook_endpoints set active = p_active where id = p_id and tenant_id = app.tenant_id();
  if not found then raise exception 'endpoint not found'; end if;
end $$;

create or replace function public.retry_webhook_delivery(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner');
  update public.webhook_deliveries set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where id = p_id and tenant_id = app.tenant_id() and status = 'dead';
  if not found then raise exception 'only a failed (dead) delivery can be retried'; end if;
end $$;

-- Worker API (service role). Claiming hides a row for 5 minutes so a crashed worker cannot double-send forever.
create or replace function public.claim_webhook_deliveries(p_limit int default 25)
returns table (id uuid, url text, secret text, event_id uuid, event_type text, payload jsonb, attempts int)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select d.id from public.webhook_deliveries d join public.webhook_endpoints e on e.id = d.endpoint_id and e.active
    where d.status = 'pending' and d.next_attempt_at <= now() order by d.next_attempt_at limit least(p_limit, 100) for update of d skip locked
  ), upd as (
    update public.webhook_deliveries d set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes' from due where d.id = due.id
    returning d.id, d.endpoint_id, d.event_id, d.event_type, d.payload, d.attempts
  )
  select upd.id, e.url, e.secret, upd.event_id, upd.event_type, upd.payload, upd.attempts from upd join public.webhook_endpoints e on e.id = upd.endpoint_id;
end $$;

create or replace function public.record_webhook_result(p_id uuid, p_ok boolean, p_status int, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.webhook_deliveries;
begin
  select * into d from public.webhook_deliveries where id = p_id for update;
  if d.id is null or d.status <> 'pending' then return; end if;
  if p_ok then
    update public.webhook_deliveries set status = 'delivered', delivered_at = now(), last_status = p_status, last_error = null where id = d.id;
  elsif d.attempts >= 8 then
    update public.webhook_deliveries set status = 'dead', last_status = p_status, last_error = left(coalesce(p_error,''), 300) where id = d.id;
  else
    -- 1, 2, 4, 8 … minutes, capped at 6 hours
    update public.webhook_deliveries set last_status = p_status, last_error = left(coalesce(p_error,''), 300), next_attempt_at = now() + least(power(2, d.attempts - 1), 360) * interval '1 minute' where id = d.id;
  end if;
end $$;

create or replace function public.purge_webhook_deliveries() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.webhook_deliveries where (status = 'delivered' and delivered_at < now() - interval '30 days') or (status = 'dead' and created_at < now() - interval '90 days');
  get diagnostics n = row_count; return n;
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
