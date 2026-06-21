// ────────────────────────────────────────────────────────────────────────────
// <IconButton> — Golden Group design system.
//
// Square, icon-only button. Absorbs the large "SKIP" class of native buttons:
// modal close (✕), table-row actions, nav chevrons, and state toggles whose
// only content is a Lucide icon.
//
// Variants:
//   ghost   — transparent, slate icon (default; modal close, subtle actions)
//   outline — bordered white (nav / companion icon actions)
//   solid   — filled brand blue (primary icon CTA)
//   danger  — transparent red (destructive: delete a row, remove a chip)
//   gold    — filled brand gold (special icon CTA)
//
// Sizes (square):
//   sm — 8×8   icon 4
//   md — 9×9   icon 5   (default)
//   lg — 10×10 icon 5
//
// Shape: `square` (rounded-lg, default) or `circle` (rounded-full).
//
// `active` highlights the button (for on/off icon toggles like ★ primary,
// WhatsApp). `loading` swaps the icon for a spinner and disables.
//
// ACCESSIBILITY: `label` is REQUIRED — there is no visible text, so it sets
// both `aria-label` and the native `title` tooltip. Pass an explicit `title`
// prop to override the tooltip while keeping the aria-label.
//
// Renders a <button>; preserves all native button props (onClick, type, etc.).
// ────────────────────────────────────────────────────────────────────────────
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type IconButtonVariant = 'ghost' | 'outline' | 'solid' | 'danger' | 'gold';
export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonShape = 'square' | 'circle';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** Accessible name — sets aria-label and the default title tooltip. Required. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: IconButtonShape;
  /** Highlight as "on" — for icon toggles (e.g. ★ primary, WhatsApp on). */
  active?: boolean;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost:   'bg-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-100',
  outline: 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:bg-slate-50',
  solid:   'bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white shadow-sm hover:shadow-md',
  danger:  'bg-transparent text-red-500 hover:text-red-600 hover:bg-red-50',
  gold:    'bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white shadow-sm hover:shadow-md',
};

// Applied on top of the variant when `active` is true. Only meaningful for the
// transparent variants (ghost/danger); solid/gold are already filled.
const ACTIVE_CLASSES: Record<IconButtonVariant, string> = {
  ghost:   'bg-sky-50 text-sky-600 hover:bg-sky-100 hover:text-sky-700',
  outline: 'bg-sky-50 text-sky-600 border-sky-200 hover:bg-sky-100',
  solid:   '',
  danger:  'bg-red-50 text-red-600 hover:bg-red-100',
  gold:    '',
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
  lg: 'w-10 h-10',
};

const ICON_SIZE: Record<IconButtonSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-5 h-5',
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    variant = 'ghost',
    size = 'md',
    shape = 'square',
    active = false,
    loading = false,
    disabled,
    className = '',
    title,
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
      aria-label={label}
      title={title ?? label}
      className={[
        'inline-flex items-center justify-center shrink-0',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        active ? ACTIVE_CLASSES[variant] || VARIANT_CLASSES[variant] : VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 className={`${iconCls} animate-spin`} aria-hidden="true" />
      ) : (
        <Icon className={iconCls} aria-hidden="true" />
      )}
    </button>
  );
});

export default IconButton;
