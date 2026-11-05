import { useState } from 'react';
import { money, date, cap } from '../lib/format';
import { calcLine, type DocTotals, type Line } from '../lib/rules';
import { Money } from './kit';
import type { Row } from '../data/seed';

export function TotalsPanel({ t, intra }: { t: DocTotals; intra: boolean }) {
  return <div className="tot" aria-label="Totals">
    <div><span>Subtotal</span><Money v={t.subtotal} /></div>
    {t.discount > 0 && <div><span>Discount</span><Money v={-t.discount} /></div>}
    <div><span>Taxable value</span><Money v={t.taxable} /></div>
    {intra ? <><div><span>CGST</span><Money v={t.cgst} /></div><div><span>SGST</span><Money v={t.sgst} /></div></> : <div><span>IGST</span><Money v={t.igst} /></div>}
    {t.roundOff !== 0 && <div><span>Round off</span><Money v={t.roundOff} /></div>}
    <div className="gt"><span>Total</span><Money v={t.total} bold /></div>
  </div>;
}

export function LinesEditor({ lines, onChange, items, readOnly }: { lines: Line[]; onChange: (l: Line[]) => void; items: Row[]; readOnly?: boolean }) {
  const [raw, setRaw] = useState(() => lines.map((l) => ({ qty: String(l.qty), rate: String(l.rate / 100), disc: String(l.discountPct ?? 0) })));
  const set = (i: number, patch: Partial<Line>, r?: Partial<(typeof raw)[0]>) => { const nl = lines.map((l, k) => (k === i ? { ...l, ...patch } : l)); if (r) setRaw(raw.map((x, k) => (k === i ? { ...x, ...r } : x))); onChange(nl); };
  const add = (it?: Row) => { setRaw([...raw, { qty: '1', rate: it ? String(it.rate / 100) : '0', disc: '0' }]); onChange([...lines, { desc: it?.name ?? '', qty: 1, rate: it?.rate ?? 0, discountPct: 0, taxPct: it?.taxPct ?? 18, itemId: it?.id, unit: it?.unit }]); };
  const del = (i: number) => { setRaw(raw.filter((_, k) => k !== i)); onChange(lines.filter((_, k) => k !== i)); };
  return <div className="tbl-scroll"><table className="lines"><caption className="sr">Line items</caption>
    <thead><tr><th>Item / description</th><th style={{ width: 80 }}>Qty</th><th style={{ width: 120 }}>Rate (₹)</th><th style={{ width: 80 }}>Disc %</th><th style={{ width: 90 }}>GST %</th><th style={{ width: 130, textAlign: 'right' }}>Amount</th>{!readOnly && <th style={{ width: 48 }}><span className="sr">Remove</span></th>}</tr></thead>
    <tbody>{lines.map((l, i) => <tr key={i}>
      <td><input aria-label={`Line ${i + 1} description`} disabled={readOnly} value={l.desc} onChange={(e) => set(i, { desc: e.target.value })} placeholder="Describe the item or service" list="item-list" /></td>
      <td><input aria-label={`Line ${i + 1} quantity`} disabled={readOnly} inputMode="decimal" value={raw[i]?.qty ?? ''} onChange={(e) => set(i, { qty: parseFloat(e.target.value) || 0 }, { qty: e.target.value })} /></td>
      <td><input aria-label={`Line ${i + 1} rate`} disabled={readOnly} inputMode="decimal" value={raw[i]?.rate ?? ''} onChange={(e) => set(i, { rate: Math.round((parseFloat(e.target.value) || 0) * 100) }, { rate: e.target.value })} /></td>
      <td><input aria-label={`Line ${i + 1} discount percent`} disabled={readOnly} inputMode="decimal" value={raw[i]?.disc ?? ''} onChange={(e) => set(i, { discountPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) }, { disc: e.target.value })} /></td>
      <td><select aria-label={`Line ${i + 1} GST rate`} disabled={readOnly} value={l.taxPct} onChange={(e) => set(i, { taxPct: Number(e.target.value) })}>{[0, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
      <td className="r money" style={{ paddingTop: 14 }}>{money(calcLine(l).total)}</td>
      {!readOnly && <td><button type="button" className="x" aria-label={`Remove line ${i + 1}`} onClick={() => del(i)}>✕</button></td>}
    </tr>)}</tbody>
    {!readOnly && <tfoot><tr><td colSpan={7} style={{ paddingTop: 10 }}>
      <button type="button" className="btn secondary" onClick={() => add()}>+ Add line</button>{' '}
      <select aria-label="Add from catalogue" className="" style={{ width: 240, display: 'inline-block' }} value="" onChange={(e) => { const it = items.find((x) => x.id === e.target.value); if (it) add(it); }}><option value="">Add from catalogue…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name} – {money(it.rate)}</option>)}</select>
      <datalist id="item-list">{items.map((it) => <option key={it.id} value={it.name} />)}</datalist>
    </td></tr></tfoot>}
  </table></div>;
}

export function DocView({ kind, doc, seller, customer, contact }: { kind: 'Tax invoice' | 'Quotation'; doc: Row; seller: any; customer: Row | undefined; contact?: Row }) {
  const t = doc.totals as DocTotals;
  return <article className="doc" aria-label={kind} tabIndex={0}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <div><h2 style={{ fontSize: 20 }}>{seller.business.legalName}</h2><div style={{ color: 'var(--muted)', fontSize: 13 }}>{seller.billing.address}<br />GSTIN {seller.billing.gstin}</div></div>
      <div style={{ textAlign: 'right' }}><h2 style={{ fontSize: 20, textTransform: 'uppercase', letterSpacing: '.04em' }}>{kind}</h2><div className="num" style={{ fontWeight: 600 }}>{doc.number || 'DRAFT – not numbered'}</div>{doc.revision ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>Revision {doc.revision}</div> : null}</div>
    </div>
    <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '20px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
      <div><div style={{ color: 'var(--muted)', fontSize: 12 }}>BILL TO</div><b>{customer?.name}</b><br />{customer?.billingAddress}<br />{customer?.gstin && <>GSTIN {customer.gstin}<br /></>}{contact && <>Attn: {contact.name}</>}</div>
      <div style={{ textAlign: 'right' }}>{doc.issueDate && <div>Issue date: <b>{date(doc.issueDate)}</b></div>}{doc.date && !doc.issueDate && <div>Date: <b>{date(doc.date)}</b></div>}{doc.dueDate && <div>Due date: <b>{date(doc.dueDate)}</b></div>}{doc.validUntil && <div>Valid until: <b>{date(doc.validUntil)}</b></div>}<div>Place of supply: {customer?.stateName}</div></div>
    </div>
    <table style={{ marginTop: 20 }}><thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Disc</th><th className="r">GST</th><th className="r">Amount</th></tr></thead>
      <tbody>{(doc.lines as Line[]).map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.desc}</td><td className="r num">{l.qty}{l.unit ? ' ' + l.unit : ''}</td><td className="r money">{money(l.rate)}</td><td className="r">{l.discountPct ? l.discountPct + '%' : '—'}</td><td className="r">{l.taxPct}%</td><td className="r money">{money(calcLine(l).taxable)}</td></tr>)}</tbody></table>
    <TotalsPanel t={t} intra={doc.intraState} />
    <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>Total in words: INR {Math.round(t.total / 100).toLocaleString('en-IN')} only</p>
    {t.byRate.length > 0 && <table style={{ marginTop: 12, maxWidth: 420 }}><thead><tr><th>GST rate</th><th className="r">Taxable</th><th className="r">Tax</th></tr></thead><tbody>{t.byRate.map((b) => <tr key={b.rate}><td>{b.rate}%</td><td className="r money">{money(b.taxable)}</td><td className="r money">{money(b.tax)}</td></tr>)}</tbody></table>}
    {kind === 'Tax invoice' && seller.branding.showBank && <p style={{ fontSize: 13, marginTop: 16 }}><b>Pay by:</b> {seller.billing.bankName}, A/c {seller.billing.accountNo}, IFSC {seller.billing.ifsc} · UPI {seller.billing.upi}</p>}
    {doc.terms && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{doc.terms}</p>}
    {doc.notes && <p style={{ fontSize: 13 }}>{doc.notes}</p>}
    <p style={{ fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 16 }}>{seller.branding.footer} · This is a system-generated document. Statutory e-invoicing/IRN acceptance is not implied by this PDF; confirm jurisdiction-specific requirements with your adviser. Status: {cap(doc.status)}</p>
  </article>;
}
