-- Database-level guards for the rules that protect money. These run for every writer, including a tampered browser.
create or replace function public.rec_num(v jsonb) returns bigint language sql immutable as $$ select coalesce((v)::text::numeric, 0)::bigint $$;

create or replace function public.period_locked(t text, d text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.records p where p.tenant_id = t and p.collection = 'periods' and (p.data->>'locked')::boolean is true and d between p.data->>'start' and p.data->>'end') $$;

create or replace function public.enforce_invariants() returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text := coalesce(new.tenant_id, old.tenant_id);
  c text := coalesce(new.collection, old.collection);
  o jsonb := case when tg_op = 'INSERT' then null else old.data end;
  n jsonb := case when tg_op = 'DELETE' then null else new.data end;
  alloc_sum bigint; cap bigint; cust_a text; cust_b text;
begin
  -- 1. Audit trail is append-only.
  if c = 'audit' and tg_op <> 'INSERT' then raise exception 'audit entries cannot be changed or deleted' using errcode = '42501'; end if;

  -- 2. Issued invoices and accepted quotations are frozen apart from status/void, due date, delivery and history.
  if c = 'invoices' and tg_op = 'UPDATE' and coalesce(o->>'status','draft') not in ('draft','pending_approval') then
    if n->'lines' is distinct from o->'lines' or n->>'total' is distinct from o->>'total' or n->>'customerId' is distinct from o->>'customerId'
       or n->>'number' is distinct from o->>'number' or n->>'issueDate' is distinct from o->>'issueDate' or n->'totals' is distinct from o->'totals' then
      raise exception 'issued invoice % cannot be edited; use a credit note and reissue', o->>'number' using errcode = '23514';
    end if;
    if n->>'status' is distinct from o->>'status' and n->>'status' <> 'void' then raise exception 'an issued invoice can only move to void' using errcode = '23514'; end if;
    if o->>'status' = 'void' and n->>'status' <> 'void' then raise exception 'a void invoice cannot be reopened' using errcode = '23514'; end if;
  end if;
  if c = 'invoices' and tg_op = 'DELETE' and coalesce(o->>'status','draft') <> 'draft' then raise exception 'only draft invoices can be deleted' using errcode = '23514'; end if;
  if c = 'invoices' and tg_op in ('INSERT','UPDATE') and coalesce(n->>'status','draft') not in ('draft','pending_approval') and coalesce(n->>'number','') = '' then
    raise exception 'an issued invoice must have a number' using errcode = '23514'; end if;
  if c = 'quotes' and tg_op = 'UPDATE' and o->>'status' in ('accepted','converted') then
    if n->'lines' is distinct from o->'lines' or n->>'total' is distinct from o->>'total' or n->>'customerId' is distinct from o->>'customerId' then
      raise exception 'an accepted quotation cannot be edited' using errcode = '23514'; end if;
  end if;

  -- 3. Locked financial periods refuse backdated documents.
  if tg_op in ('INSERT','UPDATE') then
    if c = 'invoices' and coalesce(n->>'status','draft') not in ('draft','pending_approval') and (tg_op = 'INSERT' or o->>'status' in ('draft','pending_approval') or n->>'issueDate' is distinct from o->>'issueDate') and public.period_locked(t, n->>'issueDate') then
      raise exception 'issue date % falls in a locked period', n->>'issueDate' using errcode = '23514'; end if;
    if c = 'receipts' and (tg_op = 'INSERT' or n->>'date' is distinct from o->>'date') and public.period_locked(t, n->>'date') then
      raise exception 'receipt date % falls in a locked period', n->>'date' using errcode = '23514'; end if;
    if c = 'credits' and tg_op = 'INSERT' and public.period_locked(t, n->>'date') then
      raise exception 'adjustment date % falls in a locked period', n->>'date' using errcode = '23514'; end if;
  end if;

  -- 4. Allocations: never over-apply a receipt or an invoice, and only within one customer.
  if c = 'allocations' and tg_op in ('INSERT','UPDATE') and coalesce((n->>'reversed')::boolean, false) is false then
    select (r.data->>'amount')::bigint, r.data->>'customerId' into cap, cust_a from public.records r where r.tenant_id = t and r.collection = 'receipts' and r.id = n->>'receiptId';
    if cap is null then raise exception 'allocation refers to an unknown receipt' using errcode = '23503'; end if;
    select coalesce(sum((a.data->>'amount')::bigint), 0) into alloc_sum from public.records a
      where a.tenant_id = t and a.collection = 'allocations' and a.data->>'receiptId' = n->>'receiptId' and coalesce((a.data->>'reversed')::boolean, false) is false and a.id <> new.id;
    if alloc_sum + (n->>'amount')::bigint > cap then raise exception 'allocation exceeds the receipt amount' using errcode = '23514'; end if;
    select (i.data->>'total')::bigint, i.data->>'customerId' into cap, cust_b from public.records i where i.tenant_id = t and i.collection = 'invoices' and i.id = n->>'invoiceId';
    if cap is null then raise exception 'allocation refers to an unknown invoice' using errcode = '23503'; end if;
    if cust_a is distinct from cust_b then raise exception 'receipt and invoice belong to different customers' using errcode = '23514'; end if;
    select coalesce(sum((a.data->>'amount')::bigint), 0) into alloc_sum from public.records a
      where a.tenant_id = t and a.collection = 'allocations' and a.data->>'invoiceId' = n->>'invoiceId' and coalesce((a.data->>'reversed')::boolean, false) is false and a.id <> new.id;
    if alloc_sum + (n->>'amount')::bigint > cap then raise exception 'allocation exceeds the invoice total' using errcode = '23514'; end if;
    if (n->>'amount')::bigint <= 0 then raise exception 'allocation must be positive' using errcode = '23514'; end if;
  end if;
  if c = 'allocations' and tg_op = 'DELETE' then raise exception 'allocations are reversed, never deleted' using errcode = '23514'; end if;
  if c = 'receipts' and tg_op = 'DELETE' then raise exception 'receipts are reversed, never deleted' using errcode = '23514'; end if;

  -- 5. Separation of duties and reasons on adjustments.
  if c = 'credits' and tg_op = 'UPDATE' and o->>'status' = 'pending' and n->>'status' = 'approved' then
    if coalesce(n->>'approvedBy','') = '' or n->>'approvedBy' = o->>'requestedBy' then raise exception 'an adjustment cannot be approved by its requester' using errcode = '42501'; end if;
  end if;
  if c = 'credits' and tg_op = 'INSERT' and (coalesce(btrim(n->>'reason'),'') = '' or (n->>'amount')::bigint <= 0) then raise exception 'an adjustment needs a reason and a positive amount' using errcode = '23514'; end if;

  -- 6. Document numbering only moves forward.
  if c = 'numbering' and tg_op = 'UPDATE' and (n->>'nextSeq')::int < (o->>'nextSeq')::int then raise exception 'next number cannot go backwards' using errcode = '23514'; end if;

  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now(); new.updated_by := auth.uid(); return new;
end $$;
create trigger records_guard before insert or update or delete on public.records for each row execute function public.enforce_invariants();

-- Members: never leave a business without an owner.
create or replace function public.keep_one_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner' and old.status = 'active') or (tg_op = 'UPDATE' and old.role = 'owner' and old.status = 'active' and (new.role <> 'owner' or new.status <> 'active')) then
    if not exists (select 1 from public.members m where m.tenant_id = old.tenant_id and m.role = 'owner' and m.status = 'active' and m.id <> old.id) then
      raise exception 'a business must keep at least one active owner' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;
create trigger members_guard before update or delete on public.members for each row execute function public.keep_one_owner();

-- ---------- onboarding RPCs ----------
-- First sign-in: attach this auth user to any invitations / portal access issued to their email.
create or replace function public.claim_access() returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := lower(coalesce(auth.jwt()->>'email','')); m int; p int;
begin
  if auth.uid() is null or e = '' then raise exception 'not signed in' using errcode = '28000'; end if;
  update public.members set user_id = auth.uid(), status = case when status = 'invited' then 'active' else status end where lower(email) = e and user_id is null and status in ('invited','active');
  get diagnostics m = row_count;
  update public.portal_users set user_id = auth.uid() where lower(email) = e and user_id is null;
  get diagnostics p = row_count;
  return jsonb_build_object('members', m, 'portal', p);
end $$;

-- Self-service signup: create a business and make the caller its owner.
create or replace function public.create_tenant(p_name text, p_owner_name text) returns text language plpgsql security definer set search_path = public as $$
declare tid text := 't_' || substr(replace(gen_random_uuid()::text,'-',''), 1, 10); e text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'business name is required' using errcode = '22023'; end if;
  insert into public.tenants(id, name) values (tid, btrim(p_name));
  insert into public.members(id, tenant_id, user_id, email, name, role, status) values ('m_' || substr(replace(gen_random_uuid()::text,'-',''), 1, 10), tid, auth.uid(), e, coalesce(nullif(btrim(p_owner_name),''), e), 'owner', 'active');
  insert into public.records(tenant_id, collection, id, data) values
    (tid,'roleDefs','rd_owner','{"name":"owner","permissions":["view","create","edit","approve","assign","export","refund","configure"],"system":true}'),
    (tid,'roleDefs','rd_manager','{"name":"manager","permissions":["view","create","edit","approve","assign","export"],"system":true}'),
    (tid,'roleDefs','rd_staff','{"name":"staff","permissions":["view","create","edit"],"system":true}'),
    (tid,'roleDefs','rd_customer','{"name":"customer","permissions":["view"],"system":true}');
  return tid;
end $$;
revoke all on function public.claim_access(), public.create_tenant(text, text) from public, anon;
grant execute on function public.claim_access(), public.create_tenant(text, text) to authenticated;
