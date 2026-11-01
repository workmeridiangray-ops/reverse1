import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface Common {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  optional?: boolean;
}

function describedBy(name: string, error?: string, hint?: string) {
  return [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ") || undefined;
}

function Shell({ label, name, error, hint, optional, children }: Common & { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-bold text-ink-900">
        {label}
        {optional ? <span className="font-normal text-ink-500"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={`${name}-hint`} className="text-caption text-ink-500">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${name}-error`} className="flex items-center gap-1 text-sm font-bold text-danger-fg">
          <span aria-hidden="true">!</span> {error}
        </p>
      ) : null}
    </div>
  );
}

const INPUT =
  "min-h-touch w-full rounded border border-ink-500 bg-surface px-3 text-base text-ink-900 placeholder:text-ink-500 aria-[invalid=true]:border-danger-fg aria-[invalid=true]:border-2";

export function TextField({ label, name, error, hint, optional, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Shell {...{ label, name, error, hint, optional }}>
      <input id={name} name={name} aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, hint)} required={!optional} className={INPUT} {...rest} />
    </Shell>
  );
}

export function SelectField({
  label, name, error, hint, optional, children, ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <Shell {...{ label, name, error, hint, optional }}>
      <select id={name} name={name} aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, hint)} required={!optional} className={INPUT} {...rest}>
        {children}
      </select>
    </Shell>
  );
}

export function TextAreaField({ label, name, error, hint, optional, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Shell {...{ label, name, error, hint, optional }}>
      <textarea id={name} name={name} aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, hint)} required={!optional}
        className={`${INPUT} min-h-[6rem] py-2 leading-relaxed`} {...rest} />
    </Shell>
  );
}

export function CheckboxField({ label, name, hint, ...rest }: Omit<Common, "error" | "optional"> & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-start gap-3">
      <input id={name} name={name} type="checkbox" aria-describedby={hint ? `${name}-hint` : undefined}
        className="mt-1 h-5 w-5 shrink-0 rounded-sm border-ink-500 accent-brand-700" {...rest} />
      <div>
        <label htmlFor={name} className="font-bold">{label}</label>
        {hint ? <p id={`${name}-hint`} className="text-caption text-ink-500">{hint}</p> : null}
      </div>
    </div>
  );
}
