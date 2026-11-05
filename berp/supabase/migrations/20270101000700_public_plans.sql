-- The public pricing page is read by signed-out visitors: expose active, paying plans only.
grant select on public.plans to anon;
create policy plans_public_read on public.plans for select to anon using (active and code <> 'trial');

-- invoice lines referenced items only by column; the UI embeds the item, so declare the relationship.
alter table public.invoice_lines add constraint invoice_lines_item_fk foreign key (tenant_id, item_id) references public.items(tenant_id, id);
