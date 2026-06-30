// ────────────────────────────────────────────────────────────────────────────
// <DatePicker> — Golden Group design system date picker.
//
// A small calendar POPOVER (not a full-screen modal): it floats under the
// trigger via a body PORTAL with fixed positioning, so it is never clipped by
// a modal's scroll container or a table's overflow. Dims nothing; closes on
// outside-click / ESC / day-pick. Date-only (no time) — matches the app's
// existing date fields.
//
//   • Brand primary (sky #1B5FA8) for the selected day & navigation.
//   • RTL + Arabic month/weekday names (localized via Intl).
//   • Light-only (the app has no dark theme).
//
// Prefer the <DateField> wrapper for day-to-day use; reach for <DatePicker>
// directly only when you need a custom trigger.
// ────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react';

// Localized labels (Arabic) — derived from Intl so they always match locale.
const AR_MONTH = new Intl.DateTimeFormat('ar', { month: 'long' });
const AR_MONTH_SHORT = new Intl.DateTimeFormat('ar', { month: 'short' });
const AR_WD = new Intl.DateTimeFormat('ar', { weekday: 'narrow' });

const MONTH_NAMES = Array.from({ length: 12 }, (_, m) => AR_MONTH.format(new Date(2023, m, 1)));
const MONTH_SHORT = Array.from({ length: 12 }, (_, m) => AR_MONTH_SHORT.format(new Date(2023, m, 1)));
// 2023-01-01 is a Sunday → Sun-first weekday header.
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => AR_WD.format(new Date(2023, 0, 1 + i)));

const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

const POPOVER_WIDTH = 280;

export interface DatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** The trigger element — the popover anchors under it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Initial / current selected date. Defaults to today. */
  value?: Date;
  /** Fired with the picked Date (at local midnight) when a day is selected. */
  onChange?: (date: Date) => void;
  /** Earliest selectable date (inclusive). Days before it are disabled. */
  min?: Date;
  /** Latest selectable date (inclusive). Days after it are disabled. */
  max?: Date;
}

export default function DatePicker({ isOpen, onClose, anchorRef, value, onChange, min, max }: DatePickerProps) {
  const initial = value ?? new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [selected, setSelected] = useState({
    y: initial.getFullYear(),
    m: initial.getMonth(),
    d: initial.getDate(),
  });
  const [view, setView] = useState<'days' | 'months'>('days');
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Gate the entrance animation until we've measured the anchor — otherwise the
  // popover paints once at (0,0) and visibly flies in from the corner on first
  // open (state persists across opens, so only the first one flashes).
  const [positioned, setPositioned] = useState(false);

  // Re-sync when (re)opened with a (possibly) new value.
  useEffect(() => {
    if (!isOpen) return;
    const v = value ?? new Date();
    setYear(v.getFullYear());
    setMonth(v.getMonth());
    setSelected({ y: v.getFullYear(), m: v.getMonth(), d: v.getDate() });
    setView('days');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Escape-to-close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Position under the anchor; reposition on scroll (capture: catches scrolls
  // inside a modal body too) and resize.
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // RTL: align the popover's right edge with the trigger's right edge.
      const left = Math.max(8, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8));
      setPos({ top: r.bottom + 6, left });
      setPositioned(true);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      setPositioned(false);
    };
  }, [isOpen, anchorRef]);

  if (!isOpen) return null;

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);
  const today = new Date();

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  // Day-granularity range bounds (min/max are inclusive).
  const minMs = min ? new Date(min).setHours(0, 0, 0, 0) : null;
  const maxMs = max ? new Date(max).setHours(23, 59, 59, 999) : null;
  const isOutOfRange = (day: number) => {
    const t = new Date(year, month, day).getTime();
    return (minMs !== null && t < minMs) || (maxMs !== null && t > maxMs);
  };

  const pick = (day: number) => {
    if (isOutOfRange(day)) return;
    setSelected({ y: year, m: month, d: day });
    onChange?.(new Date(year, month, day));
    onClose();
  };

  const renderDays = () => {
    const cells = [];
    for (let i = 0; i < firstDayIndex; i++) {
      cells.push(<div key={`empty-${i}`} className="w-8 h-8" />);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected = selected.d === day && selected.m === month && selected.y === year;
      const isToday =
        today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
      const disabled = isOutOfRange(day);
      cells.push(
        <button
          key={`day-${day}`}
          type="button"
          onClick={() => pick(day)}
          disabled={disabled}
          aria-disabled={disabled}
          className={`w-8 h-8 mx-auto text-[13px] font-medium rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
            disabled
              ? 'text-slate-300 cursor-not-allowed line-through decoration-slate-300'
              : isSelected
                ? 'bg-sky-500 text-white font-semibold'
                : `text-slate-700 hover:bg-slate-100 ${isToday ? 'ring-1 ring-sky-300' : ''}`
          }`}
        >
          {day}
        </button>,
      );
    }
    return cells;
  };

  return createPortal(
    <>
      {/* Transparent outside-click catcher — no dim, no blur. Above modals (z-50). */}
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden />

      {positioned && (
      <div
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH, transformOrigin: 'top right' }}
        className="z-[61] bg-white rounded-2xl shadow-lg border border-slate-100 p-3 animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header — month/year toggle + navigation */}
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setView((v) => (v === 'days' ? 'months' : 'days'))}
            className="no-pill flex items-center gap-1 text-[15px] font-semibold text-sky-600 hover:opacity-75 transition-opacity focus:outline-none"
          >
            <span>{view === 'days' ? `${MONTH_NAMES[month]} ${year}` : year}</span>
            <ChevronDown size={15} className={`transition-transform ${view === 'months' ? 'rotate-180' : ''}`} />
          </button>

          <div className="flex items-center gap-0.5">
            {/* RTL: previous = points right, next = points left */}
            <button
              type="button"
              aria-label="السابق"
              onClick={() => (view === 'days' ? prevMonth() : setYear((y) => y - 1))}
              className="p-1.5 text-sky-600 hover:bg-slate-100 rounded-full transition-colors focus:outline-none"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              aria-label="التالي"
              onClick={() => (view === 'days' ? nextMonth() : setYear((y) => y + 1))}
              className="p-1.5 text-sky-600 hover:bg-slate-100 rounded-full transition-colors focus:outline-none"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        </div>

        {view === 'days' ? (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-1 text-center">
              {WEEKDAYS.map((wd, i) => (
                <div key={i} className="text-[10px] font-bold text-slate-400 py-1">
                  {wd}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {renderDays()}
            </div>
          </>
        ) : (
          /* Month picker */
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_SHORT.map((m, idx) => {
              const isSelected = idx === month;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { setMonth(idx); setView('days'); }}
                  className={`py-2 rounded-full text-xs font-bold transition-colors ${
                    isSelected ? 'bg-sky-500 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}
    </>,
    document.body,
  );
}
