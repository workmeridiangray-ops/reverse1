import { plat } from "@/lib/server/db";
import { requirePlatform } from "@/lib/server/auth";
import { Page, Card, DataTable, Badge, Field, Grid, Hidden, date } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { setPlatformRole, postAnnouncement, suspendUser } from "../actions";
export const metadata = { title: "Staff" };
export default async function P() {
  const a = await requirePlatform("owner");
  const staff = (await plat("select id, email, name, platform_role, suspended from users where platform_role is not null order by email")).rows;
  const ann = (await plat("select * from announcements order by created_at desc limit 10")).rows;
  return <Page title="Platform staff & announcements" sub="Roles are separated: billing, support and technical operations see only their own areas.">
    <Card title="Staff"><DataTable rows={staff} cols={[{ h: "Email", r: (r: any) => r.email }, { h: "Role", r: (r: any) => <Badge s="info" label={r.platform_role} /> }, { h: "", r: (r: any) => r.id !== a.user.id ? <ActionForm action={suspendUser} submit={r.suspended ? "Restore" : "Suspend"} small secondary danger={!r.suspended}><Hidden name="id" value={r.id} /><input type="hidden" name="on" value={r.suspended ? "0" : "1"} /></ActionForm> : null }]} />
      <ActionForm action={setPlatformRole} submit="Set platform role" className="mt-3" resetOnOk><Grid><Field label="User email (must already have an account)" name="email" type="email" required /><Field label="Role (blank removes)" name="role" options={["owner", "billing", "support", "techops"].map((x) => ({ value: x, label: x }))} /></Grid></ActionForm></Card>
    <Card title="Announcements" className="mt-4"><ul className="mb-3 text-sm">{ann.map((x: any) => <li key={x.id}><b>{x.title}</b> <span className="text-muted">{date(x.created_at)}</span></li>)}</ul><ActionForm action={postAnnouncement} submit="Publish" resetOnOk><Field label="Title" name="title" required /><Field label="Body" name="body" type="textarea" required className="mt-2" /></ActionForm></Card></Page>;
}
