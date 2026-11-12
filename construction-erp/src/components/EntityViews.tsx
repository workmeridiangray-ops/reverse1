import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Table, Td, Empty, Pager, Field, DL, Card, fmtDateTime } from './ui';
import ActionForm, { ConfirmButton, ReasonForm } from './ActionForm';
import type { E, F } from '@/lib/entities';
import { display } from '@/lib/engine';
import { createEntityAction, updateEntityAction, entityActionRun, bulkDeleteAction, saveViewAction, deleteViewAction } from '@/app/actions/entity';

const paiseToInput = (p: string | null) => { if (p === null || p === undefined) return ''; const b = BigInt(p); const neg = b < 0n; const a = neg ? -b : b; return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`; };
const toInput = (f: F, v: any) => (v === null || v === undefined ? (f.def ?? '') : f.t === 'money' ? paiseToInput(v) : f.t === 'date' ? String(v).slice(0, 10) : String(v));

export function FieldInput({ f, value, options }: { f: F; value?: any; options?: { id: string; label: string }[] }) {
  const v = toInput(f, value);
  const common = { id: f.n, name: f.n, required: f.req, 'aria-describedby': f.help ? `${f.n}-help` : undefined } as const;
  if (f.t === 'bool') return <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" id={f.n} name={f.n} defaultChecked={value === undefined ? f.def === 'on' : !!value} className="h-5 w-5" /> <span className="text-sm">{f.l}</span></label>;
  let input: ReactNode;
  if (f.t === 'area') input = <textarea {...common} className="input" rows={3} defaultValue={v} />;
  else if (f.t === 'select') input = <select {...common} className="input" defaultValue={v}><option value="">Choose…</option>{f.opts!.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  else if (f.t === 'ref') input = <select {...common} className="input" defaultValue={v}><option value="">{f.req ? 'Choose…' : 'None'}</option>{(options ?? []).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>;
  else if (f.t === 'date') input = <input {...common} type="date" className="input" defaultValue={v} />;
  else if (f.t === 'email') input = <input {...common} type="email" className="input" defaultValue={v} />;
  else if (f.t === 'money') input = <input {...common} inputMode="decimal" className="input num !text-left" defaultValue={v} placeholder="0.00" pattern="-?[0-9,]+(\.[0-9]{1,2})?" title="Amount in rupees, up to 2 decimals" />;
  else if (f.t === 'qty') input = <input {...common} inputMode="decimal" className="input" defaultValue={v} placeholder="0" pattern="[0-9,]+(\.[0-9]{1,3})?" title="Up to 3 decimals" />;
  else if (f.t === 'int') input = <input {...common} inputMode="numeric" className="input" defaultValue={v} pattern="-?[0-9]+" />;
  else input = <input {...common} type="text" className="input" defaultValue={v} />;
  return <Field label={f.l} name={f.n} help={f.help} required={f.req}>{input}</Field>;
}

export function EntityForm({ e, pid, row, options }: { e: E; pid: string | null; row?: any; options: Record<string, { id: string; label: string }[]> }) {
  const fields = e.fields.filter(f => !f.hideForm && !f.ro);
  const action = row ? updateEntityAction.bind(null, e.key, pid, row.id) : createEntityAction.bind(null, e.key, pid);
  return (
    <ActionForm action={action} submit={row ? 'Save changes' : `Create ${e.singular.toLowerCase()}`}>
      {row && <input type="hidden" name="_version" value={row.version} />}
      <div className="grid md:grid-cols-2 gap-4">
        {fields.map(f => <div key={f.n} className={f.t === 'area' ? 'md:col-span-2' : ''}><FieldInput f={f} value={row ? row[f.n] : undefined} options={options[f.n]} /></div>)}
      </div>
    </ActionForm>
  );
}

export function ActionBar({ e, pid, row, perms }: { e: E; pid: string | null; row: any; perms: Set<string> }) {
  const acts = (e.actions ?? []).filter(a => a.when(row) && perms.has(a.perm));
  if (!acts.length) return null;
  return (
    <div className="flex flex-wrap gap-2 items-start">
      {acts.map(a => {
        const bound = entityActionRun.bind(null, e.key, pid, row.id, a.key);
        if (a.reason) return <ReasonForm key={a.key} action={bound} label={a.label} reasonLabel={a.reason} danger={a.danger} />;
        if (a.confirm || a.danger) return <ConfirmButton key={a.key} action={bound} label={a.label} confirmText={a.confirm ?? `${a.label}?`} className={`btn btn-sm ${a.danger ? 'text-bad' : 'btn-primary'}`} />;
        return <ConfirmButton key={a.key} action={bound} label={a.label} confirmText={`${a.label}?`} className="btn btn-sm btn-primary" />;
      })}
    </div>
  );
}

export function EntityDetailBody({ e, row, history }: { e: E; row: any; history: any[] }) {
  const items: [string, ReactNode][] = e.fields.map(f => [f.l.replace(/ \(.*\)/, ''), f.t === 'bool' ? (row[f.n] ? 'Yes' : 'No') : display(f, row[f.n], row[`${f.n}__l`])]);
  return (
    <>
      <Card title="Details"><DL items={items} /></Card>
      <Card title="History" className="mt-6">
        {history.length === 0 ? <p className="text-sm text-muted">No history recorded.</p> :
          <ul className="divide-y divide-line text-sm">{history.map((h: any) => <li key={h.id} className="py-2 flex justify-between gap-3"><span>{h.action.replace(/[._]/g, ' ')}{h.detail?.reason ? <em className="text-muted"> — “{h.detail.reason}”</em> : ''}</span><time className="text-muted whitespace-nowrap">{fmtDateTime(h.at)}</time></li>)}</ul>}
      </Card>
    </>
  );
}

export function EntityListView({ e, pid, rows, total, page, pages, sp, base, perms, views, canCreate }: { e: E; pid: string | null; rows: any[]; total: number; page: number; pages: number; sp: Record<string, string>; base: string; perms: Set<string>; views: any[]; canCreate: boolean }) {
  const cols = e.fields.filter(f => !f.hideList && f.t !== 'area').slice(0, 6);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'page' && k !== 'saved')).toString();
  const sortLink = (n: string) => { const p = new URLSearchParams(qs); p.set('sort', n); p.set('dir', sp.sort === n && sp.dir !== 'desc' ? 'desc' : 'asc'); return `${base}?${p}`; };
  const deletable = rows.some(r => e.deleteWhen?.(r));
  const bulk = bulkDeleteAction.bind(null, e.key, pid);
  return (
    <>
      <form className="flex flex-wrap gap-2 mb-4 items-end" role="search">
        <div className="flex-1 min-w-[200px]"><label className="label" htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} className="input" placeholder={`Search ${e.plural.toLowerCase()}`} /></div>
        {e.statuses && <div><label className="label" htmlFor="status">Status</label><select id="status" name="status" defaultValue={sp.status ?? ''} className="input"><option value="">All</option>{e.statuses.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>}
        <button className="btn btn-primary">Apply</button>
        {(sp.q || sp.status) && <Link href={base} className="btn">Clear</Link>}
        {perms.has(`${e.module === 'project' ? 'reports' : e.module}:export`) && <a className="btn" href={`/api/export/entity?entity=${e.key}${pid ? `&project=${pid}` : ''}&${qs}`}>Export CSV</a>}
      </form>
      {(views.length > 0 || qs) && (
        <div className="flex flex-wrap gap-2 items-center mb-4 text-sm">
          {views.length > 0 && <span className="text-muted">Saved views:</span>}
          {views.map((v: any) => <span key={v.id} className="inline-flex items-center gap-1"><Link className="btn btn-sm" href={`${base}?${v.query}`}>{v.name}</Link><ConfirmButton action={deleteViewAction} label="✕" confirmText={`Remove the saved view "${v.name}"?`} className="btn btn-sm" hidden={{ id: v.id }} /></span>)}
          {qs && <details><summary className="btn btn-sm cursor-pointer list-none">Save this view</summary><div className="card p-3 mt-2 absolute z-20"><ActionForm action={saveViewAction.bind(null, `${pid ?? 'org'}:${e.key}`)} submit="Save view" resetOnSuccess><input type="hidden" name="query" value={qs} /><Field label="View name" name="name"><input id="name" name="name" className="input" required minLength={2} /></Field></ActionForm></div></details>}
        </div>
      )}
      <form action={undefined}>
        <BulkWrap enabled={deletable && perms.has(`${e.module}:edit`)} action={bulk}>
          <Table head={[...(deletable ? [{ label: 'Select' }] : []), ...cols.map(f => ({ label: f.l.replace(/ \(.*\)/, ''), num: f.t === 'money' || f.t === 'qty', hideSm: cols.indexOf(f) > 2 })), ...(e.status ? [{ label: 'Status' }] : [])]}
            empty={<Empty title={`No ${e.plural.toLowerCase()} yet`} action={canCreate ? <Link className="btn btn-primary" href={`${base}/new`}>Create {e.singular.toLowerCase()}</Link> : null}>{sp.q || sp.status ? 'Nothing matches those filters. Try clearing them.' : e.blurb}</Empty>}>
            {rows.map(r => (
              <tr key={r.id}>
                {deletable && <Td>{e.deleteWhen?.(r) ? <input type="checkbox" name="ids" value={r.id} aria-label={`Select ${e.titleOf(r)}`} className="h-5 w-5" /> : null}</Td>}
                {cols.map((f, i) => <Td key={f.n} num={f.t === 'money' || f.t === 'qty'} hideSm={i > 2}>{i === 0 ? <Link href={`${base}/${r.id}${qs ? `?from=${encodeURIComponent(qs)}` : ''}`}>{display(f, r[f.n], r[`${f.n}__l`])}</Link> : display(f, r[f.n], r[`${f.n}__l`])}</Td>)}
                {e.status && <Td><Badge status={String(r[e.status])} /></Td>}
              </tr>
            ))}
          </Table>
        </BulkWrap>
      </form>
      <p className="text-xs text-muted mt-2">{total} record{total === 1 ? '' : 's'}. Click a column heading to sort: {cols.filter(f => f.t !== 'ref').slice(0, 4).map((f, i) => <span key={f.n}>{i > 0 && ', '}<Link href={sortLink(f.n)}>{f.l.replace(/ \(.*\)/, '')}</Link></span>)}</p>
      <Pager page={page} pages={pages} base={`${base}${qs ? `?${qs}` : ''}`} />
    </>
  );
}
import BulkWrap from './BulkWrap';
