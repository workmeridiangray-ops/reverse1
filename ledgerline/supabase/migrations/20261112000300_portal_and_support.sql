-- Customers may read the business's public profile (name, billing details printed on invoices, branding) but not its private settings.
create or replace function public.customer_can_read(t text, c text, rid text, d jsonb) returns boolean language plpgsql stable security definer set search_path = public as $$
declare pc text := public.portal_customer(t);
begin
  if pc is null then return false; end if;
  if c = '_public' then return true; end if;
  if c in ('invoices') then return d->>'customerId' = pc and coalesce(d->>'status','') not in ('draft','pending_approval'); end if;
  if c in ('receipts','credits','disputes','messages','quotes','schedules','contacts','promises') then return d->>'customerId' = pc; end if;
  if c = 'customers' then return rid = pc; end if;
  if c = 'allocations' then
    return exists (select 1 from public.records i where i.tenant_id = t and i.collection = 'invoices' and i.id = d->>'invoiceId' and i.data->>'customerId' = pc);
  end if;
  return false;
end $$;

-- Platform support asks a business owner for time-limited access. Platform staff cannot write tenant records directly.
create or replace function public.request_support_access(p_tenant text, p_reason text, p_scope text, p_expires text) returns text language plpgsql security definer set search_path = public as $$
declare r text := public.platform_role(); rid text := 'sa_' || substr(replace(gen_random_uuid()::text,'-',''), 1, 10); who text;
begin
  if r is null or r not in ('platform_owner','platform_support') then raise exception 'only support staff can request access' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'a reason is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'unknown business' using errcode = '23503'; end if;
  select name into who from public.platform_staff where user_id = auth.uid();
  insert into public.records(tenant_id, collection, id, data) values (p_tenant, 'supportAccess', rid,
    jsonb_build_object('id', rid, 'tenantId', p_tenant, 'requestedBy', who || ' (Ledgerline ' || replace(r,'platform_','') || ')', 'reason', p_reason, 'scope', coalesce(p_scope,'Read-only, audited'), 'requested', to_char(now(),'YYYY-MM-DD'), 'expires', p_expires, 'status', 'pending'));
  return rid;
end $$;
revoke all on function public.request_support_access(text,text,text,text) from public, anon;
grant execute on function public.request_support_access(text,text,text,text) to authenticated;
