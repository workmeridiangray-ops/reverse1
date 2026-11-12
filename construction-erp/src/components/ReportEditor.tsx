'use client';
import { useEffect, useState } from 'react';
import ActionForm from './ActionForm';
import Uploader from './Uploader';
import { saveReportAction } from '@/app/actions/project';

type Opt = { id: string; label: string };
const empty = { lab: [{ trade: '', headcount: '', hours: '8' }], eq: [{ name: '', hours: '', idle: '0' }], qt: [{ activity: '', claimed: '' }], is: [{ text: '', severity: 'low' }] };

/** Fast site entry. Entries are mirrored to this device so a dropped connection or expired session never loses a day's work. */
export default function ReportEditor({ projectId, sites, activities, initial, reportId, version }: { projectId: string; sites: Opt[]; activities: Opt[]; initial?: any; reportId?: string; version?: number }) {
  const key = `report-draft:${projectId}:${reportId ?? 'new'}`;
  const [rows, setRows] = useState<any>(initial ?? empty);
  const [restore, setRestore] = useState<any>(null);
  const [photos, setPhotos] = useState<number[]>([0]);
  useEffect(() => { try { const v = localStorage.getItem(key); if (v) setRestore(JSON.parse(v)); } catch {} }, [key]);
  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(rows)); } catch {} }, 400); return () => clearTimeout(t); }, [rows, key]);
  const set = (g: string, i: number, f: string, v: string) => setRows((r: any) => ({ ...r, [g]: r[g].map((x: any, j: number) => (j === i ? { ...x, [f]: v } : x)) }));
  const add = (g: string, blank: any) => setRows((r: any) => ({ ...r, [g]: [...r[g], blank] }));
  const del = (g: string, i: number) => setRows((r: any) => ({ ...r, [g]: r[g].length > 1 ? r[g].filter((_: any, j: number) => j !== i) : r[g] }));
  const inp = 'input';
  return (
    <ActionForm action={saveReportAction.bind(null, projectId)} submit="Save draft" secondary={<button type="submit" name="intent" value="submit" className="btn btn-primary">Save & submit for review</button>}>
      {restore && <div role="status" className="rounded border border-[#ecd48f] bg-warn-soft px-4 py-3 text-sm">We found unsaved entries from earlier on this device. <button type="button" className="underline" onClick={() => { setRows(restore); setRestore(null); }}>Restore them</button> · <button type="button" className="underline" onClick={() => { localStorage.removeItem(key); setRestore(null); }}>Discard</button></div>}
      {reportId && <><input type="hidden" name="id" value={reportId} /><input type="hidden" name="version" value={version} /></>}
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="site_id">Site</label><select id="site_id" name="site_id" className={inp} required defaultValue={initial?.site_id ?? ''}><option value="">Choose…</option>{sites.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <div><label className="label" htmlFor="report_date">Date</label><input id="report_date" name="report_date" type="date" className={inp} required defaultValue={initial?.report_date ?? new Date().toISOString().slice(0, 10)} max={new Date().toISOString().slice(0, 10)} /></div>
        <div><label className="label" htmlFor="weather">Weather</label><input id="weather" name="weather" className={inp} defaultValue={initial?.weather ?? ''} placeholder="Clear, 32°C" /></div>
      </div>
      <fieldset className="space-y-2"><legend className="font-semibold">Work done today (claimed quantities)</legend>
        <input type="hidden" name="qt_n" value={rows.qt.length} />
        {rows.qt.map((r: any, i: number) => <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-end"><div><label className="label" htmlFor={`qa${i}`}>Activity</label><select id={`qa${i}`} name={`qt_activity_${i}`} className={inp} value={r.activity} onChange={e => set('qt', i, 'activity', e.target.value)}><option value="">Choose…</option>{activities.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div><div><label className="label" htmlFor={`qc${i}`}>Quantity</label><input id={`qc${i}`} name={`qt_claimed_${i}`} inputMode="decimal" className={inp} value={r.claimed} onChange={e => set('qt', i, 'claimed', e.target.value)} /></div><button type="button" className="btn btn-sm" onClick={() => del('qt', i)} aria-label="Remove row">✕</button></div>)}
        <button type="button" className="btn btn-sm" onClick={() => add('qt', { activity: '', claimed: '' })}>+ Add activity</button></fieldset>
      <fieldset className="space-y-2"><legend className="font-semibold">Labour</legend><input type="hidden" name="lab_n" value={rows.lab.length} />
        {rows.lab.map((r: any, i: number) => <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] gap-2 items-end"><div><label className="label" htmlFor={`lt${i}`}>Trade</label><input id={`lt${i}`} name={`lab_trade_${i}`} className={inp} value={r.trade} onChange={e => set('lab', i, 'trade', e.target.value)} placeholder="Mason" /></div><div><label className="label" htmlFor={`lh${i}`}>People</label><input id={`lh${i}`} name={`lab_headcount_${i}`} inputMode="numeric" className={inp} value={r.headcount} onChange={e => set('lab', i, 'headcount', e.target.value)} /></div><div><label className="label" htmlFor={`lo${i}`}>Hours</label><input id={`lo${i}`} name={`lab_hours_${i}`} inputMode="decimal" className={inp} value={r.hours} onChange={e => set('lab', i, 'hours', e.target.value)} /></div><button type="button" className="btn btn-sm" onClick={() => del('lab', i)} aria-label="Remove row">✕</button></div>)}
        <button type="button" className="btn btn-sm" onClick={() => add('lab', { trade: '', headcount: '', hours: '8' })}>+ Add trade</button><p className="help">Attendance and hours feed costing; this is not a payroll record.</p></fieldset>
      <fieldset className="space-y-2"><legend className="font-semibold">Equipment</legend><input type="hidden" name="eq_n" value={rows.eq.length} />
        {rows.eq.map((r: any, i: number) => <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] gap-2 items-end"><div><label className="label" htmlFor={`en${i}`}>Equipment</label><input id={`en${i}`} name={`eq_name_${i}`} className={inp} value={r.name} onChange={e => set('eq', i, 'name', e.target.value)} /></div><div><label className="label" htmlFor={`eh${i}`}>Hours</label><input id={`eh${i}`} name={`eq_hours_${i}`} inputMode="decimal" className={inp} value={r.hours} onChange={e => set('eq', i, 'hours', e.target.value)} /></div><div><label className="label" htmlFor={`ei${i}`}>Idle</label><input id={`ei${i}`} name={`eq_idle_${i}`} inputMode="decimal" className={inp} value={r.idle} onChange={e => set('eq', i, 'idle', e.target.value)} /></div><button type="button" className="btn btn-sm" onClick={() => del('eq', i)} aria-label="Remove row">✕</button></div>)}
        <button type="button" className="btn btn-sm" onClick={() => add('eq', { name: '', hours: '', idle: '0' })}>+ Add equipment</button></fieldset>
      <fieldset className="space-y-2"><legend className="font-semibold">Issues & delays</legend><input type="hidden" name="is_n" value={rows.is.length} />
        {rows.is.map((r: any, i: number) => <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2 items-end"><div><label className="label" htmlFor={`it${i}`}>Issue</label><input id={`it${i}`} name={`is_text_${i}`} className={inp} value={r.text} onChange={e => set('is', i, 'text', e.target.value)} /></div><div><label className="label" htmlFor={`is${i}`}>Severity</label><select id={`is${i}`} name={`is_severity_${i}`} className={inp} value={r.severity} onChange={e => set('is', i, 'severity', e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div><button type="button" className="btn btn-sm" onClick={() => del('is', i)} aria-label="Remove row">✕</button></div>)}
        <button type="button" className="btn btn-sm" onClick={() => add('is', { text: '', severity: 'low' })}>+ Add issue</button></fieldset>
      <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={3} className="input" defaultValue={initial?.notes ?? ''} /></div>
      <fieldset className="space-y-3"><legend className="font-semibold">Photos</legend>
        {photos.map(p => <Uploader key={p} project={projectId} kind="site_photo" accept=".jpg,.jpeg,.png" label={`Photo ${p + 1}`} hiddenName="photo_id" />)}
        <button type="button" className="btn btn-sm" onClick={() => setPhotos(x => [...x, x.length])}>+ Another photo</button><p className="help">Uploads retry automatically. A photo that fails keeps its Retry button; nothing else on this page is lost.</p></fieldset>
    </ActionForm>
  );
}
