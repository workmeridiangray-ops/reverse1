-- Plant-level scoping. app.plant_ids is set per request from the member's plant assignment (empty = all plants).
-- RESTRICTIVE policies AND with the tenant policy, so a plant-limited member cannot read or write other plants' rows.
create function app_plants() returns uuid[] language sql stable as $$
  select case when coalesce(current_setting('app.plant_ids', true), '') = '' then null
              else string_to_array(current_setting('app.plant_ids', true), ',')::uuid[] end $$;
grant execute on function app_plants() to mfg_app;

create policy plant_scope on plants      as restrictive using (app_plants() is null or id = any(app_plants()));
create policy plant_scope on locations   as restrictive using (app_plants() is null or plant_id = any(app_plants()));
create policy plant_scope on work_centres as restrictive using (app_plants() is null or plant_id = any(app_plants()));
create policy plant_scope on work_orders as restrictive using (app_plants() is null or plant_id = any(app_plants()));
create policy plant_scope on shift_calendar as restrictive using (app_plants() is null or plant_id = any(app_plants()));
create policy plant_scope on wo_operations as restrictive using (app_plants() is null or exists (select 1 from work_orders w where w.id = work_order_id));
create policy plant_scope on wo_materials  as restrictive using (app_plants() is null or exists (select 1 from work_orders w where w.id = work_order_id));
create policy plant_scope on stock_movements as restrictive using (app_plants() is null or exists (select 1 from locations l where l.id = location_id));
create policy plant_scope on shipment_lines  as restrictive using (app_plants() is null or exists (select 1 from locations l where l.id = location_id));
create policy plant_scope on machines as restrictive using (app_plants() is null or exists (select 1 from work_centres w where w.id = work_centre_id));
