import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { type AnyIcon, Icon } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand-700 text-white border-brand-700 hover:bg-brand-800",
  secondary: "bg-surface text-ink-900 border-ink-500 hover:bg-sunken",
  ghost: "bg-transparent text-brand-700 border-transparent hover:bg-brand-50",
  danger: "bg-danger-fg text-white border-danger-fg hover:bg-[#7f1d14]",
};
const SIZE: Record<Size, string> = {
  sm: "min-h-touch px-3 text-sm gap-1.5",
  md: "min-h-touch px-4 text-base gap-2",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `inline-flex items-center justify-center rounded border font-bold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: AnyIcon; children: ReactNode }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  children,
  className = "",
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: AnyIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  );
}
