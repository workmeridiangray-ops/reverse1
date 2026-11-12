import { withSystem } from "@/lib/db";
import { requirePlatform } from "@/lib/auth/session";
import { PageHead } from "@/components/ui";
import { ActionForm, Field } from "@/components/ActionForm";
import { couponAction } from "../actions";
export default async function Coupons() {
  await requirePlatform("billing"); const rows = await withSystem(async (db) => (await db.query("select * from platform_coupons order by created_at desc")).rows);
  return (<><PageHead title="Coupons" /><div className="card"><ActionForm action={couponAction} submit="Create coupon" resetOnSuccess><div className="grid g3"><Field name="code" label="Code (blank = random)" /><Field name="percent" label="% off first invoice" required /><Field name="max" label="Max redemptions" /></div></ActionForm></div>
    <div className="card">{rows.map((c: any) => <p key={c.id}><strong>{c.code}</strong> · {c.percent_off}% · used {c.redeemed}{c.max_redemptions ? `/${c.max_redemptions}` : ""}</p>)}</div></>);
}
