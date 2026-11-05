import { useState, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, DataTable, FormView, Modal, PageHeader, ReasonDialog, ConfirmDialog, Kpi, Card, notify, toast, Notice, KV, type Col, type FieldSpec, type RowAction, type TFilter } from '../ui/kit';
import { useRows, useBalances, useSettings, useSession, saveSettings, insert, update, type Res, type Bal } from '../store';
import type { Row } from '../data/seed';

export interface Ctx { customers: Row[]; suppliers: Row[]; items: Row[]; invoices: Row[]; receipts: Row[]; allocs: Row[]; credits: Row[]; disputes: Row[]; bills: Row[]; payments: Row[]; branches: Row[]; members: Row[]; bal: Record<string, Bal>; settings: any; role: string; dlg: Dlg; nav: (to: string) => void }
export interface Dlg { reason: (title: string, onSubmit: (reason: string) => boolean | void, opts?: { label?: string; confirm?: string; danger?: boolean; extra?: ReactNode }) => void; form: (title: string, spec: FieldSpec[], init: Row, onSubmit: (v: Row) => Res | void, submit?: string) => void; confirm: (title: string, text: ReactNode, onOk: () => void, opts?: { danger?: boolean; confirm?: string }) => void; view: (title: string, body: ReactNode) => void }

export function useDlg(): [Dlg, ReactNode] {
  const [m, setM] = useState<ReactNode>(null); const close = () => setM(null);
  const dlg: Dlg = {
    reason: (title, onSubmit, o = {}) => setM(<ReasonDialog title={title} onCancel={close} onSubmit={onSubmit} label={o.label} confirm={o.confirm} danger={o.danger} extra={o.extra} />),
    form: (title, spec, init, onSubmit, submit = 'Save') => setM(<Modal title={title} onClose={close} wide={spec.length > 6}><FormView spec={spec} init={init} submit={submit} onCancel={close} onSubmit={(v) => { const r = onSubmit(v); if (!r || r.ok) { if (r) notify(r); close(); } return r; }} /></Modal>),
    confirm: (title, text, onOk, o = {}) => setM(<ConfirmDialog title={title} text={text} onOk={onOk} onCancel={close} danger={o.danger} confirm={o.confirm} />),
    view: (title, body) => setM(<Modal title={title} onClose={close} wide>{body}</Modal>),
  };
  return [dlg, m];
}
export function useCtx(): [Ctx, ReactNode] {
  const [dlg, node] = useDlg(); const nav = useNavigate(); const sess = useSession();
  const ctx: Ctx = { customers: useRows('customers'), suppliers: useRows('suppliers'), items: useRows('items'), invoices: useRows('invoices'), receipts: useRows('receipts'), allocs: useRows('allocations'), credits: useRows('credits'), disputes: useRows('disputes'), bills: useRows('bills'), payments: useRows('supplierPayments'), branches: useRows('branches'), members: useRows('members'), bal: useBalances(), settings: useSettings(), role: sess?.role ?? '', dlg, nav };
  return [ctx, node];
}
export const opts = (rows: Row[], label = 'name'): [string, string][] => rows.map((r) => [r.id, r[label]]);

export interface ListCfg {
  coll: string; title: string; sub?: ReactNode; cols: Col[]; filter?: (r: Row, c: Ctx) => boolean; map?: (r: Row, c: Ctx) => Row; filters?: TFilter[];
  create?: { label: string; spec: FieldSpec[]; init?: Row; onSubmit: (v: Row, c: Ctx) => Res; title?: string; draftKey?: string };
  edit?: { spec: FieldSpec[]; onSubmit: (row: Row, v: Row, c: Ctx) => Res; label?: string; title?: string; show?: (r: Row) => boolean };
  actions?: (c: Ctx) => RowAction[]; bulk?: (c: Ctx) => { label: string; run: (rows: Row[]) => void; danger?: boolean }[]; link?: (r: Row) => string; preview?: (r: Row, c: Ctx) => ReactNode;
  kpis?: (rows: Row[], c: Ctx) => { label: string; value: ReactNode; note?: ReactNode; tone?: 'bad' | 'good' | 'warn' }[]; totalsFor?: string[]; crumbs?: [string, string?][]; notice?: ReactNode; empty?: ReactNode; extraActions?: ReactNode; allow?: (c: Ctx) => boolean; pageSize?: number; searchKeys?: string[]; defaultSort?: [string, 'asc' | 'desc'];
}
export function ListScreen({ id, cfg }: { id: string; cfg: (c: Ctx) => ListCfg }) {
  const [ctx, node] = useCtx(); const c = cfg(ctx); const all = useRows(c.coll);
  let rows = all.filter((r) => !c.filter || c.filter(r, ctx)); if (c.map) rows = rows.map((r) => c.map!(r, ctx));
  const nav = useNavigate(); const acts: RowAction[] = [...(c.actions?.(ctx) ?? [])];
  if (c.edit) acts.unshift({ label: c.edit.label ?? 'Edit', show: c.edit.show, run: (r) => ctx.dlg.form(c.edit!.title ?? 'Edit', c.edit!.spec, r, (v) => c.edit!.onSubmit(r, v, ctx)) });
  const canCreate = c.create && (!c.allow || c.allow(ctx));
  return <>
    <PageHeader title={c.title} sub={c.sub} crumbs={c.crumbs} actions={<>{c.extraActions}{canCreate && <Button variant="primary" icon="plus" onClick={() => ctx.dlg.form(c.create!.title ?? c.create!.label, c.create!.spec, c.create!.init ?? {}, (v) => c.create!.onSubmit(v, ctx), 'Create')}>{c.create!.label}</Button>}</>} />
    {c.notice}
    {c.kpis && <div className="kpis">{c.kpis(rows, ctx).map((k) => <Kpi key={k.label} {...k} />)}</div>}
    <DataTable id={id} rows={rows} cols={c.cols} filters={c.filters} rowActions={acts} bulk={c.bulk?.(ctx)} onRowClick={c.link ? (r) => nav(c.link!(r)) : undefined} preview={c.preview ? (r) => c.preview!(r, ctx) : (r) => <KV row={r} />} totalsFor={c.totalsFor} csvName={id} empty={c.empty} pageSize={c.pageSize} searchKeys={c.searchKeys} defaultSort={c.defaultSort} />
    {node}
  </>;
}

/** A settings form bound to one group inside the tenant's settings object. */
export function SettingsScreen({ title, sub, group, spec, crumbs, note, audit, readOnlyFor }: { title: string; sub?: ReactNode; group: string; spec: FieldSpec[]; crumbs?: [string, string?][]; note?: ReactNode; audit?: string; readOnlyFor?: string[] }) {
  const st = useSettings(); const sess = useSession(); const ro = readOnlyFor?.includes(sess?.role ?? '');
  return <><PageHeader title={title} sub={sub} crumbs={crumbs} />{note}{ro && <Notice kind="warn">Your role can view these settings but not change them.</Notice>}
    <Card><FormView key={JSON.stringify(st[group])} spec={ro ? spec.map((f) => ({ ...f, readOnly: true })) : spec} init={st[group] ?? {}} submit="Save changes" draftKey={'settings-' + group} onSubmit={(v) => { if (ro) return { ok: false, error: 'You do not have permission to change this.' }; saveSettings(group, v, audit); toast('Saved'); }} /></Card></>;
}
export function FormScreen({ title, sub, spec, submit, onSubmit, crumbs, init, after, note }: { title: string; sub?: ReactNode; spec: FieldSpec[]; submit?: string; onSubmit: (v: Row) => Res; crumbs?: [string, string?][]; init?: Row; after?: ReactNode; note?: ReactNode }) {
  const [done, setDone] = useState<string>('');
  return <><PageHeader title={title} sub={sub} crumbs={crumbs} />{note}<Card>{done ? <Notice kind="good">{done}</Notice> : null}<FormView key={done} spec={spec} init={init} submit={submit} onSubmit={(v) => { const r = onSubmit(v); if (r.ok) { setDone(r.message ?? 'Saved.'); toast(r.message ?? 'Saved'); } return r; }} /></Card>{after}</>;
}
export function Info({ title, children, crumbs, actions }: { title: string; children: ReactNode; crumbs?: [string, string?][]; actions?: ReactNode }) { return <><PageHeader title={title} crumbs={crumbs} actions={actions} />{children}</>; }
export function LinkBtn({ to, children, variant = 'secondary' }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost' }) { return <Link to={to} className={'btn ' + variant}>{children}</Link>; }
export { update, insert };
