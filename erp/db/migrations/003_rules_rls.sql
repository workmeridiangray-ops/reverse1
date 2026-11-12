-- Document numbering
create function next_number(p_tenant uuid, p_key text) returns text language plpgsql as $$
declare n bigint; pfx text;
begin
  update number_sequences set next_no = next_no + 1
   where tenant_id = p_tenant and key = p_key returning next_no - 1, prefix into n, pfx;
  if n is null then raise exception 'unknown number sequence %', p_key; end if;
  return pfx || '-' || lpad(n::text, 5, '0');
end $$;

-- ---------- ledger integrity ----------
create function journal_check_balance(p_journal uuid) returns void language plpgsql as $$
declare st text; d bigint; c bigint;
begin
  select status into st from journals where id = p_journal;
  if st is null or st = 'draft' then return; end if;
  select coalesce(sum(debit_paise),0), coalesce(sum(credit_paise),0) into d, c from journal_lines where journal_id = p_journal;
  if d <> c or d = 0 then
    raise exception 'journal % is not balanced (debit %, credit %)', p_journal, d, c using errcode = '23514';
  end if;
end $$;
create function trg_jb_journal() returns trigger language plpgsql as $$
begin perform journal_check_balance(new.id); return null; end $$;
create function trg_jb_line() returns trigger language plpgsql as $$
begin perform journal_check_balance(coalesce(new.journal_id, old.journal_id)); return null; end $$;
create constraint trigger journals_balanced after insert or update on journals
  deferrable initially deferred for each row execute function trg_jb_journal();
create constraint trigger journal_lines_balanced after insert or update or delete on journal_lines
  deferrable initially deferred for each row execute function trg_jb_line();

create function trg_journal_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'posted journals cannot be deleted; reverse them' using errcode = '23000'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if old.status = 'posted' and new.status = 'reversed'
       and new.number = old.number and new.entry_date = old.entry_date and new.tenant_id = old.tenant_id then
      return new;
    end if;
    raise exception 'journal % is % and cannot be changed', old.number, old.status using errcode = '23000';
  end if;
  if new.status = 'posted' then
    if not exists (select 1 from fin_periods p where p.tenant_id = new.tenant_id and new.entry_date between p.starts_on and p.ends_on) then
      raise exception 'no financial period covers %', new.entry_date using errcode = '23000';
    end if;
    if exists (select 1 from fin_periods p where p.tenant_id = new.tenant_id and p.status = 'closed' and new.entry_date between p.starts_on and p.ends_on) then
      raise exception 'financial period covering % is closed', new.entry_date using errcode = '23000';
    end if;
  end if;
  return new;
end $$;
create trigger journals_guard before insert or update or delete on journals for each row execute function trg_journal_guard();

create function trg_journal_line_guard() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from journals where id = coalesce(new.journal_id, old.journal_id);
  if st is not null and st <> 'draft' then
    raise exception 'lines of a % journal cannot be changed', st using errcode = '23000';
  end if;
  return coalesce(new, old);
end $$;
create trigger journal_lines_guard before insert or update or delete on journal_lines for each row execute function trg_journal_line_guard();

-- ---------- row level security ----------
do $$
declare t record;
  ctl text[] := array['roles','memberships','invitations','subscriptions','platform_invoices','platform_payments','jobs','audit_log','notifications','support_access'];
  cond text := 'tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid';
  sysc text := 'current_setting(''app.system'', true) = ''on''';
begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = c.table_schema and tb.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'sessions'
  loop
    execute format('alter table %I enable row level security', t.table_name);
    execute format('alter table %I force row level security', t.table_name);
    if t.table_name = any(ctl) then
      execute format('create policy tenant_or_system on %I using (%s or %s) with check (%s or %s)', t.table_name, cond, sysc, cond, sysc);
    else
      execute format('create policy tenant_only on %I using (%s) with check (%s)', t.table_name, cond, cond);
    end if;
  end loop;
end $$;
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_or_system on tenants
  using (id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on')
  with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid or current_setting('app.system', true) = 'on');

-- ---------- grants for the application role ----------
grant usage on schema public to erp_app;
grant select, insert, update, delete on all tables in schema public to erp_app;
grant usage, select on all sequences in schema public to erp_app;
revoke update, delete on audit_log, stock_movements from erp_app;
grant execute on all functions in schema public to erp_app;
alter default privileges in schema public grant select, insert, update, delete on tables to erp_app;
