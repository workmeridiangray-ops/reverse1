import { ActionForm, Field } from "./ActionForm";
import type { Resource } from "@/lib/masters";
import type { ActionResult } from "@/lib/actions";
import { inputMoney, inputQty } from "@/lib/money";

export type Opts = Record<string, { id: string; name: string }[]>;
type Act = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

export function MasterForm({ r, values, opts, action, custom, submit }: { r: Resource; values?: any; opts: Opts; action: Act; custom?: { key: string; label: string; kind: string; value?: string }[]; submit: string }) {
  return (
    <ActionForm action={action} submit={submit}>
      <div className="grid g2">
        {r.fields.map((f) => {
          let dv: any = values?.[f.name] ?? "";
          if (values) { if (f.type === "money") dv = inputMoney(values[f.name] ?? 0); if (f.type === "qty") dv = inputQty(values[f.name] ?? 0); if (f.type === "bps") dv = (values[f.name] ?? 0) / 100; }
          const full = f.type === "textarea";
          return (
            <div key={f.name} style={full ? { gridColumn: "1 / -1" } : undefined}>
              {f.type === "select" ? (
                <Field name={f.name} label={f.label} type="select" required={f.required} defaultValue={dv} hint={f.hint}>
                  {!f.required && <option value="">—</option>}
                  {Array.isArray(f.options) ? f.options.map((o) => <option key={o} value={o}>{o}</option>) : (opts[f.options as string] ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Field>
              ) : <Field name={f.name} label={f.label} type={f.type === "textarea" ? "textarea" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} required={f.required} defaultValue={dv} hint={f.hint} />}
            </div>
          );
        })}
        {custom?.map((c) => <Field key={c.key} name={"cf_" + c.key} label={c.label} type={c.kind === "date" ? "date" : "text"} defaultValue={c.value ?? ""} />)}
      </div>
    </ActionForm>
  );
}
