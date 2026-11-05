-- Reference data (not demo data). Prices are launch placeholders — change in Admin → Plans (adds a new effective-dated version).
insert into plans(code,name) values ('starter','Starter'),('growth','Growth'),('scale','Scale');
insert into plan_versions(plan_id,version,effective_from,price_monthly_paise,price_yearly_paise,max_users,max_plants,max_items,features)
select id, 1, '2026-01-01',
  case code when 'starter' then 499900 when 'growth' then 1499900 else 3999900 end,
  case code when 'starter' then 4999000 when 'growth' then 14999000 else 39999000 end,
  case code when 'starter' then 5 when 'growth' then 25 else 100 end,
  case code when 'starter' then 1 when 'growth' then 3 else 10 end,
  case code when 'starter' then 500 when 'growth' then 5000 else 50000 end,
  '{}'::jsonb from plans;
insert into platform_settings(key,value) values ('support_email','"support@example.com"');
