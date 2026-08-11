// ────────────────────────────────────────────────────────────────────────────
// <Checkbox> — Golden Group design system.
//
// A filled square checkbox: an empty box with a slate border when off, and a
// brand sky-filled box with a white check (✓) when on. Replaces the ad-hoc
// native `<input type="checkbox">` and `CheckSquare`/`Square` lucide-icon
// buttons used for boolean selection across the app.
//
// Built on a real, visually-hidden `<input type="checkbox">`, so native
// semantics come for free: keyboard focus/space works and screen readers
// announce it. `indeterminate` renders a dash (–) for the partially-selected
// state.
//
//   Standalone:   <Checkbox checked={x} onCheckedChange={setX} label="تفعيل" />
//   With text:    <Checkbox checked={x} onCheckedChange={setX}>عرض السجل</Checkbox>
//   Bare (drop into an EXISTING <label>/row that already has the text/content,
//   replacing just the old <input>; the surrounding label toggles it):
//                 <label ...><div>…</div><Checkbox bare checked … /></label>
//
// Sizes:  sm — box 4 (default, matches the old icon size) · md — box 5
// ────────────────────────────────────────────────────────────────────────────
import { forwardRef, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Check, Minus } from './icons';

export type CheckboxSize = 'sm' | 'md';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Partially-selected state (renders a dash). Overrides the check glyph. */
  indeterminate?: boolean;
  size?: CheckboxSize;
  disabled?: boolean;
  /** Accessible name when there is no visible label text (children). */
  label?: string;
  id?: string;
  /** Applied to the wrapper (<label>, or <span> in bare mode). */
  className?: string;
  /** Optional visible label text rendered next to the box (ignored when bare). */
  children?: ReactNode;
  /**
   * Render only the box + hidden input, wrapped in a <span> (no <label>).
   * Use to replace a bare `<input type="checkbox">` that already lives inside
   * an existing <label> or clickable row — that ancestor keeps toggling it,
   * so nesting a second <label> is avoided.
   */
  bare?: boolean;
}

const BOX_CLASSES: Record<CheckboxSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

const GLYPH_CLASSES: Record<CheckboxSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
};

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onCheckedChange, indeterminate = false, size = 'sm', disabled = false, label, id, className = '', children, bare = false },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  // Reflect the indeterminate flag onto the native input (property-only, no attr).
  useEffect(() => {
    const el = (ref && typeof ref !== 'function' ? ref.current : null) ?? innerRef.current;
    if (el) el.indeterminate = indeterminate;
  }, [indeterminate, ref]);

  const active = checked || indeterminate;

  const input = (
    <input
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
      }}
      type="checkbox"
      id={id}
      className="peer sr-only"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  );

  const box = (
    <span
      aria-hidden="true"
      className={[
        'inline-flex items-center justify-center shrink-0 rounded border transition-colors',
        'peer-focus-visible:ring-2 peer-focus-visible:ring-sky-300 peer-focus-visible:ring-offset-1',
        active
          ? 'bg-sky-500 border-sky-500 text-white'
          : 'bg-white border-slate-300 text-transparent',
        BOX_CLASSES[size],
      ].filter(Boolean).join(' ')}
    >
      {indeterminate
        ? <Minus className={GLYPH_CLASSES[size]} strokeWidth={3} />
        : <Check className={GLYPH_CLASSES[size]} strokeWidth={3} />}
    </span>
  );

  if (bare) {
    return (
      <span
        className={[
          'relative inline-flex shrink-0',
          disabled ? 'opacity-50' : '',
          className,
        ].filter(Boolean).join(' ')}
      >
        {input}
        {box}
      </span>
    );
  }

  return (
    <label
      className={[
        'relative inline-flex items-center gap-2 select-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      ].filter(Boolean).join(' ')}
    >
      {input}
      {box}
      {children != null && <span>{children}</span>}
    </label>
  );
});

export default Checkbox;
