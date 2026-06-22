// ────────────────────────────────────────────────────────────────────────────
// <Badge> — Golden Group design system status pill.
//
// Variants follow the brand status language:
//   success  — bg-emerald-100 text-emerald-700  (done / active / positive)
//   error    — bg-red-100     text-red-700      (failed / blocked / urgent)
//   warning  — bg-amber-100   text-amber-700    (pending / route / hold)
//   info     — bg-sky-100     text-sky-700      (informational / in progress)
//   neutral  — bg-slate-100   text-slate-500    (idle / default)
//   gold     — bg-amber-100   text-amber-800    (highlighted / special)
//
// Sizes:
//   sm — text-xs px-2 py-0.5
//   md — text-xs px-2.5 py-0.5  (default)
//
// Optional leading Lucide icon. Always pill-shaped.
// ────────────────────────────────────────────────────────────────────────────
import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'gold';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: LucideIcon;
  children?: ReactNode;
}

const VARIANT: Record<BadgeVariant, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error:   'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info:    'bg-sky-100 text-sky-700',
  neutral: 'bg-slate-100 text-slate-500',
  gold:    'bg-amber-100 text-amber-800',
};

const SIZE: Record<BadgeSize, string> = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-0.5 gap-1.5',
};

const ICON_SIZE: Record<BadgeSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
};

export default function Badge({
  variant = 'neutral',
  size = 'md',
  icon: Icon,
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center justify-center rounded-full font-bold whitespace-nowrap',
        VARIANT[variant],
        SIZE[size],
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {Icon && <Icon className={ICON_SIZE[size]} aria-hidden="true" />}
      {children}
    </span>
  );
}
