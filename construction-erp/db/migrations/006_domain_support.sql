create table doc_counters (
  org_id uuid not null, scope uuid not null, kind text not null, n int not null default 0,
  primary key (org_id, scope, kind)
);
alter table doc_counters enable row level security;
create policy dc_all on doc_counters for all using (org_id = app_org()) with check (org_id = app_org());
grant select, insert, update on doc_counters to erp_app;

alter table measurement_book add column bill_id uuid references ra_bills(id);
alter table ra_bills add column certificate_ref text;
alter table ra_bills add column invoiced_at timestamptz;
alter table projects add column handover_date date;
alter table sub_bills add column paid_at timestamptz;
alter table purchase_orders add column override_reason text;
alter table daily_reports add column correction_reason text;
alter table inspections add column waiver_reason text;
