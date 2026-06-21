// ────────────────────────────────────────────────────────────────────────────
// <Toggle> — Golden Group design system.
//
// An accessible on/off switch (iOS-style sliding knob). Replaces the ad-hoc
// `ToggleLeft`/`ToggleRight` lucide-icon buttons used for boolean settings
// (active/inactive, enabled/disabled, …).
//
// Controlled: pass `checked` and `onCheckedChange`. The whole control is a
// single `role="switch"` button with `aria-checked`, so it is keyboard- and
// screen-reader-friendly out of the box.
//
// RTL-aware: the knob rests on the start edge (right, in this RTL app) and
// slides toward the end edge when on. The `rtl:`/`ltr:` variants keep it
// correct under either direction.
//
// Sizes:
//   sm — track 9×5  knob 4
//   md — track 11×6 knob 5  (default)
//
// `label` sets aria-label when the switch is used without a visible <label>.
// ────────────────────────────────────────────────────────────────────────────
import { forwardRef } from 'react';

export type ToggleSize = 'sm' | 'md';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: ToggleSize;
  disabled?: boolean;
  /** Accessible name when there is no associated visible label. */
  label?: string;
  id?: string;
  className?: string;
}

const TRACK_CLASSES: Record<ToggleSize, string> = {
  sm: 'w-9 h-5',
  md: 'w-11 h-6',
};

// Knob size + the travel distance from the start edge to the end edge.
// travel = trackWidth − knob − (2 × inset). md: 44 − 20 − 4 = 20px (translate-5)
//          sm: 36 − 16 − 4 = 16px (translate-4)
const KNOB_CLASSES: Record<ToggleSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

const KNOB_TRAVEL: Record<ToggleSize, string> = {
  sm: 'ltr:translate-x-4 rtl:-translate-x-4',
  md: 'ltr:translate-x-5 rtl:-translate-x-5',
};

const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { checked, onCheckedChange, size = 'md', disabled = false, label, id, className = '' },
  ref,
) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={[
        'relative inline-flex items-center shrink-0 rounded-full p-0.5',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-sky-500' : 'bg-slate-200',
        TRACK_CLASSES[size],
        className,
      ].filter(Boolean).join(' ')}
    >
      <span
        className={[
          'inline-block rounded-full bg-white shadow-sm transition-transform',
          KNOB_CLASSES[size],
          checked ? KNOB_TRAVEL[size] : 'translate-x-0',
        ].filter(Boolean).join(' ')}
        aria-hidden="true"
      />
    </button>
  );
});

export default Toggle;
