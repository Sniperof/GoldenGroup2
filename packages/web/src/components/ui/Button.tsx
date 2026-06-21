// ────────────────────────────────────────────────────────────────────────────
// <Button> — Golden Group design system.
//
// Variants:
//   primary   — filled brand blue (default CTAs)
//   secondary — outlined white (companion actions)
//   ghost     — transparent (subtle / tertiary actions)
//   danger    — filled brand red (destructive)
//   gold      — filled brand gold (special CTAs)
//
// Sizes:
//   sm — h-8  px-4  text-[12.5px]
//   md — h-10 px-5  text-[13.5px]  (default)
//   lg — h-12 px-6  text-[15px]
//
// All pill-shaped. Optional leading/trailing Lucide icon.
// `loading` shows a spinner and disables the button.
// `fullWidth` makes the button span its container.
//
// Renders a <button>; preserves all native button props (onClick, type, etc.).
// ────────────────────────────────────────────────────────────────────────────
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:   'bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white shadow-sm hover:shadow-md',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50',
  ghost:     'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-800',
  danger:    'bg-red-500 hover:bg-red-600 active:bg-red-700 text-white shadow-sm hover:shadow-md',
  gold:      'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white shadow-sm hover:shadow-md',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-4 text-[12.5px] gap-1.5',
  md: 'h-10 px-5 text-[13.5px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconPosition = 'leading',
    loading = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const iconCls = ICON_SIZE[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center rounded-full font-bold whitespace-nowrap',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 className={`${iconCls} animate-spin`} aria-hidden="true" />
      ) : Icon && iconPosition === 'leading' ? (
        <Icon className={iconCls} aria-hidden="true" />
      ) : null}
      {children}
      {!loading && Icon && iconPosition === 'trailing' && (
        <Icon className={iconCls} aria-hidden="true" />
      )}
    </button>
  );
});

export default Button;
