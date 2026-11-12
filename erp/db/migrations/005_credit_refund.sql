alter table credit_notes add column refund_due_paise bigint not null default 0 check (refund_due_paise >= 0);
alter table credit_notes add column refunded_paise bigint not null default 0 check (refunded_paise >= 0);
alter table credit_notes add column return_id uuid;
alter table credit_notes add check (refunded_paise <= refund_due_paise);
alter table stock_counts add column journal_id uuid;
