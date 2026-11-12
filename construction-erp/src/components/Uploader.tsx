'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = { project?: string | null; entityType?: string; entityId?: string; kind?: string; accept?: string; label?: string; onDone?: (f: { id: string; name: string }) => void; hiddenName?: string; restricted?: boolean };
/** Upload with visible progress, automatic retries on network failure and a manual retry. Never loses the chosen file on error. */
export default function Uploader({ project, entityType, entityId, kind = 'document', accept = '.pdf,.jpg,.jpeg,.png,.csv,.xlsx,.docx,.zip', label = 'Attach a file', hiddenName, restricted }: Props) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const file = useRef<File | null>(null);
  const router = useRouter();

  function send(f: File, attempt = 0) {
    setErr(null); setPct(0);
    const fd = new FormData(); fd.set('file', f);
    if (project) fd.set('project', project); if (entityType) fd.set('entityType', entityType); if (entityId) fd.set('entityId', entityId); fd.set('kind', kind); if (restricted) fd.set('restricted', '1');
    const x = new XMLHttpRequest(); x.open('POST', '/api/files');
    x.upload.onprogress = e => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let body: any = {}; try { body = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) { setPct(null); setDone(body); router.refresh(); }
      else if (x.status === 401) { setPct(null); setErr('Your session expired. Sign in again, then retry — the file is still selected.'); }
      else { setPct(null); setErr(body.error ?? 'Upload failed.'); }
    };
    x.onerror = () => { if (attempt < 2) setTimeout(() => send(f, attempt + 1), 1000 * 2 ** attempt); else { setPct(null); setErr('Network problem. The file is kept — press Retry when you are back online.'); } };
    x.send(fd);
  }
  return (
    <div className="space-y-2">
      <label className="label" htmlFor={`up-${entityId ?? kind}`}>{label}</label>
      <input id={`up-${entityId ?? kind}`} type="file" accept={accept} className="input py-2" onChange={e => { const f = e.target.files?.[0]; if (f) { file.current = f; send(f); } }} disabled={pct !== null} />
      {pct !== null && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress" className="h-2 bg-line rounded overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>}
      {pct !== null && <p className="text-sm text-muted">Uploading… {pct}%</p>}
      {err && <div role="alert" className="text-sm text-bad">{err} {file.current && <button type="button" className="underline" onClick={() => send(file.current!)}>Retry</button>}</div>}
      {done && <p role="status" className="text-sm text-ok">Uploaded {done.name}.</p>}
      {hiddenName && done && <input type="hidden" name={hiddenName} value={done.id} />}
    </div>
  );
}
