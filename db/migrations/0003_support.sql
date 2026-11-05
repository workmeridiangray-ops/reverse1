-- approved substitutes derive from BOM lines; used by material issue checks
create view bom_substitutes_v as
  select distinct l.component_item_id as item_id, l.substitute_item_id as alt_id from bom_lines l where l.substitute_item_id is not null
  union select item_id, alternate_item_id from item_alternates;
alter view bom_substitutes_v set (security_invoker = true);
alter default privileges in schema public grant select, insert, update, delete on tables to mfg_app;
alter default privileges in schema public grant usage, select on sequences to mfg_app;
grant select on bom_substitutes_v to mfg_app;
