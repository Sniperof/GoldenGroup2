// ────────────────────────────────────────────────────────────────────────────
// <DateField> — Golden Group date input. Drop-in replacement for a native
// <input type="date">.
//
// Renders a brand-styled trigger (with calendar icon) that opens the floating
// <DatePicker> popover. Value is a 'YYYY-MM-DD' string (same shape the app's
// forms already store), so migrating a native date input is a one-liner:
//
//   - <input type="date" value={x} onChange={e => setX(e.target.value)} className={cls} />
//   + <DateField value={x} onChange={setX} className={cls} />
// ────────────────────────────────────────────────────────────────────────────
import { useState, useRef } from 'react';
import { Calendar } from 'lucide-react';
import DatePicker from './DatePicker';

// Mirrors the app's standard text-input styling (brand border + radius).
const DEFAULT_TRIGGER_CLASS =
  'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:outline-none transition-colors';

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface DateFieldProps {
  /** 'YYYY-MM-DD' or '' (empty = nothing selected). */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Override the trigger styling (defaults to the standard brand input look). */
  className?: string;
}

export default function DateField({
  value,
  onChange,
  placeholder = 'اختر التاريخ',
  disabled = false,
  className,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const display = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <div className="relative">
      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 pointer-events-none" />
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(true)}
        className={`no-pill text-right pr-10 ${className ?? DEFAULT_TRIGGER_CLASS} ${
          display ? '' : 'text-slate-300'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {display || placeholder}
      </button>
      <DatePicker
        isOpen={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        value={value ? new Date(`${value}T00:00:00`) : undefined}
        onChange={(d) => onChange(toYMD(d))}
      />
    </div>
  );
}
