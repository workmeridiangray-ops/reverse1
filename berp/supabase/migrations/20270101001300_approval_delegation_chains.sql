-- Approval delegation (time-boxed, no chains, no self-approval loopholes) and two-step approval chains (manager then owner).

alter table public.approval_rules add column second_approver_role public.app_role check (second_approver_role is null or (second_approver_role = 'owner' and approver_role = 'manager'));
alter table public.approvals drop constraint approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending','pending_second','approved','rejected'));
alter table public.approvals add column second_role public.app_role, add column first_decided_by uuid, add column first_decided_at timestamptz, add column delegated_from uuid;
drop index public.approval_one_pending;
create unique index approval_one_pending on public.approvals (tenant_id, subject, subject_id) where status in ('pending','pending_second');

create table public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_user uuid not null, to_user uuid not null,
  starts_on date not null, ends_on date not null,
  active boolean not null default true, created_at timestamptz not null default now(),
  check (from_user <> to_user), check (ends_on >= starts_on and ends_on - starts_on <= 90),
  foreign key (from_user, tenant_id) references public.memberships(user_id, tenant_id),
  foreign key (to_user, tenant_id) references public.memberships(user_id, tenant_id)
);
alter table public.approval_delegations enable row level security;
create policy deleg_read on public.approval_delegations for select to authenticated
  using (tenant_id = (select app.tenant_id()) and ((select app.has_role('owner','manager')) or to_user = (select auth.uid())));
grant select on public.approval_delegations to authenticated;
create trigger audit after insert or update on public.approval_delegations for each row execute function app.audit();

-- Does the caller hold authority for `need` today — by their own role, or by a live delegation from someone who does?
create or replace function app.authority_source(p_need public.app_role) returns uuid  -- null when none; caller's own id when direct; delegator's id when delegated
language plpgsql stable security definer set search_path = '' as $$
declare d uuid;
begin
  if app.role_satisfies(app.role(), p_need) then return auth.uid(); end if;
  select dg.from_user into d from public.approval_delegations dg
    join public.memberships m on m.user_id = dg.from_user and m.tenant_id = dg.tenant_id and m.active
    where dg.tenant_id = app.tenant_id() and dg.to_user = auth.uid() and dg.active and current_date between dg.starts_on and dg.ends_on and app.role_satisfies(m.role, p_need)
    order by dg.ends_on limit 1;
  return d;
end $$;

create or replace function app.require_approved(p_subject text, p_id uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); need public.app_role;
begin
  need := app.required_role(t, p_subject, p_amount);
  if need is null then return; end if;
  -- a single-step requirement can be met directly by the approver (or their delegate); a two-step rule always needs the recorded chain
  if (select r.second_approver_role from public.approval_rules r where r.tenant_id = t and r.subject = p_subject and r.active and r.effective_from <= current_date and r.min_amount_paise <= p_amount order by r.min_amount_paise desc limit 1) is null
     and app.authority_source(need) is not null then return; end if;
  if exists (select 1 from public.approvals where tenant_id = t and subject = p_subject and subject_id = p_id and status = 'approved' and amount_paise >= p_amount) then return; end if;
  raise exception 'approval required: amounts of this size need a % (this one is %). Request approval first.', need, p_amount using errcode = '42501';
end $$;

create or replace function public.request_approval(p_subject text, p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); amt bigint; rule public.approval_rules; a uuid;
begin
  perform app.require_role('owner','manager','sales','purchasing');
  if p_subject = 'sales_order' then
    select app.order_total(id) into amt from public.sales_orders where id = p_id and tenant_id = t and status = 'draft';
  elsif p_subject = 'purchase_request' then
    select round(r.qty * i.cost_paise)::bigint into amt from public.purchase_requests r join public.items i on i.id = r.item_id where r.id = p_id and r.tenant_id = t and r.status = 'pending';
  else raise exception 'unknown subject'; end if;
  if amt is null then raise exception 'nothing to approve: record not found or not awaiting approval'; end if;
  select * into rule from public.approval_rules where tenant_id = t and subject = p_subject and active and effective_from <= current_date and min_amount_paise <= amt order by min_amount_paise desc limit 1;
  if rule.id is null then raise exception 'no approval is required for this amount'; end if;
  insert into public.approvals (tenant_id, subject, subject_id, amount_paise, required_role, second_role, requested_by)
  values (t, p_subject, p_id, amt, rule.approver_role, rule.second_approver_role, auth.uid()) returning id into a;
  return a;
end $$;

create or replace function public.decide_approval(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); a public.approvals; need public.app_role; src uuid; step2 boolean;
begin
  perform app.require_writable();
  select * into a from public.approvals where id = p_id and tenant_id = t and status in ('pending','pending_second') for update;
  if a.id is null then raise exception 'approval is not pending'; end if;
  step2 := a.status = 'pending_second';
  need := case when step2 then a.second_role else a.required_role end;
  src := app.authority_source(need);
  if src is null then raise exception 'this step needs a % (or someone they delegated to)', need using errcode = '42501'; end if;
  -- nobody decides their own request, directly or through the person they act for
  if a.requested_by = auth.uid() or a.requested_by = src then raise exception 'you cannot approve your own request' using errcode = '42501'; end if;
  -- the second approver is always a different person from the first (and from the first's delegator)
  if step2 and (a.first_decided_by = auth.uid() or a.first_decided_by = src) then raise exception 'the second approval must come from a different person' using errcode = '42501'; end if;
  if not p_approve and (p_reason is null or length(trim(p_reason)) < 3) then raise exception 'a reason is required to reject'; end if;
  if not p_approve then
    update public.approvals set status = 'rejected', decided_by = auth.uid(), decision_reason = trim(p_reason), decided_at = now(), delegated_from = case when src <> auth.uid() then src end where id = a.id;
  elsif a.second_role is not null and not step2 then
    update public.approvals set status = 'pending_second', first_decided_by = auth.uid(), first_decided_at = now() where id = a.id;
  else
    update public.approvals set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = nullif(trim(coalesce(p_reason,'')),''), delegated_from = case when src <> auth.uid() then src end where id = a.id;
  end if;
end $$;

drop function if exists public.save_approval_rule(text, bigint, public.app_role, date);
create or replace function public.save_approval_rule(p_subject text, p_min bigint, p_role public.app_role, p_from date default current_date, p_second public.app_role default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); new_id uuid;
begin
  perform app.require_role('owner');
  if p_role not in ('manager','owner') then raise exception 'approver must be a manager or owner'; end if;
  if p_second is not null and (p_role <> 'manager' or p_second <> 'owner') then raise exception 'a two-step chain is manager first, then owner'; end if;
  if p_role = 'manager' and not exists (select 1 from public.memberships where tenant_id = t and role = 'manager' and active) then raise exception 'no active manager exists to approve this; add one first'; end if;
  insert into public.approval_rules (tenant_id, subject, min_amount_paise, approver_role, second_approver_role, effective_from, created_by)
  values (t, p_subject, p_min, p_role, p_second, p_from, auth.uid()) returning approval_rules.id into new_id;
  return new_id;
end $$;

-- Delegations: only a manager or owner may delegate their own authority, to an active member, for at most 90 days.
create or replace function public.create_delegation(p_to uuid, p_from date, p_until date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid := app.tenant_id(); new_id uuid;
begin
  perform app.require_role('owner','manager');
  if p_to = auth.uid() then raise exception 'you cannot delegate to yourself'; end if;
  if not exists (select 1 from public.memberships where user_id = p_to and tenant_id = t and active and role <> 'viewer') then raise exception 'choose an active team member (not a viewer)'; end if;
  if p_until < p_from or p_until - p_from > 90 then raise exception 'a delegation lasts at most 90 days'; end if;
  if p_until < current_date then raise exception 'the end date is in the past'; end if;
  insert into public.approval_delegations (tenant_id, from_user, to_user, starts_on, ends_on) values (t, auth.uid(), p_to, p_from, p_until) returning approval_delegations.id into new_id;
  return new_id;
end $$;

create or replace function public.revoke_delegation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('owner','manager');
  update public.approval_delegations set active = false where id = p_id and tenant_id = app.tenant_id() and active and (from_user = auth.uid() or app.has_role('owner'));
  if not found then raise exception 'delegation not found'; end if;
end $$;

revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() from authenticated;
grant execute on function public.apply_provider_event(text,text,uuid,text,text,text), public.api_resolve_key(text),
  public.claim_webhook_deliveries(int), public.record_webhook_result(uuid,boolean,int,text), public.purge_webhook_deliveries() to service_role;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.tenant_id(), app.role(), app.has_role(public.app_role[]), app.is_platform_admin() to authenticated;
