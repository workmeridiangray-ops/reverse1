-- Launch plan catalogue. Prices are placeholders the platform owner must confirm in Platform -> Plans (new versions preserve history).
insert into plans(key, name) values ('starter','Starter'), ('growth','Growth'), ('scale','Scale');
insert into plan_versions(plan_id, version, price_monthly_paise, price_yearly_paise, max_users, max_branches, max_storage_mb, features)
select id, 1, p.m, p.y, p.u, p.b, p.s, p.f from plans
join (values ('starter', 199900, 1999000, 5, 1, 1024, array['Sales, purchasing, inventory','Double-entry ledger','Email support']),
             ('growth', 599900, 5999000, 25, 5, 10240, array['Everything in Starter','Approvals and config studio','Projects, workforce, assets','Priority support']),
             ('scale', 1499900, 14999000, 100, 20, 51200, array['Everything in Growth','Branch-level access rules','API keys and webhooks','Named support contact'])) as p(k,m,y,u,b,s,f) on p.k = plans.key;
