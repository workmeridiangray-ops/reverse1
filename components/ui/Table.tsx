import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ caption, children, captionVisible = false }: { caption: string; children: ReactNode; captionVisible?: boolean }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-left">
        <caption className={captionVisible ? "mb-3 text-left text-sm text-ink-500" : "sr-only"}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={`border-b-2 border-line px-3 py-2 text-caption font-bold uppercase tracking-wide text-ink-500 ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`border-b border-line px-3 py-3 align-middle ${className}`} {...rest}>
      {children}
    </td>
  );
}
