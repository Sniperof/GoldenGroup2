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
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronLeft } from './icons';

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

// Always-visible view switcher tabs. RTL renders them يوم (right) → سنة (left).
const VIEW_TABS: { key: 'days' | 'months' | 'years'; label: string }[] = [
  { key: 'days', label: 'يوم' },
  { key: 'months', label: 'شهر' },
  { key: 'years', label: 'سنة' },
];

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
  // Guard against an invalid `value` (e.g. a field with no date yet parsed to an
  // Invalid Date) — otherwise year/month become NaN and the grid renders "NaN".
  const rawInitial = value ?? new Date();
  const initial = isNaN(rawInitial.getTime()) ? new Date() : rawInitial;
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [selected, setSelected] = useState({
    y: initial.getFullYear(),
    m: initial.getMonth(),
    d: initial.getDate(),
  });
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Keep the popover hidden until we've measured the anchor — otherwise it would
  // paint once at (0,0) before the layout effect moves it into place, which reads
  // as a flicker/slide from the screen corner on first open.
  const [positioned, setPositioned] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Re-sync when (re)opened with a (possibly) new value.
  useEffect(() => {
    if (!isOpen) return;
    const raw = value ?? new Date();
    const v = isNaN(raw.getTime()) ? new Date() : raw;
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

  // Position relative to the anchor; reposition on scroll (capture: catches
  // scrolls inside a modal body too) and resize. Flip above the trigger when
  // there isn't room below, and clamp within the viewport so the popover is
  // never hidden behind a modal footer or pushed off-screen. `view` is a dep
  // because switching day/month/year changes the popover height.
  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const GAP = 6, EDGE = 8;
      const popH = popRef.current?.offsetHeight || 348; // measured; fallback ≈ days view
      // RTL: align the popover's right edge with the trigger's right edge.
      const left = Math.max(EDGE, Math.min(r.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - EDGE));
      const spaceBelow = window.innerHeight - r.bottom - GAP - EDGE;
      const spaceAbove = r.top - GAP - EDGE;
      // Open downward if it fits (or below is the roomier side); else flip up.
      let top = (spaceBelow >= popH || spaceBelow >= spaceAbove) ? r.bottom + GAP : r.top - GAP - popH;
      // Clamp fully inside the viewport regardless of direction.
      top = Math.max(EDGE, Math.min(top, window.innerHeight - popH - EDGE));
      setPos({ top, left });
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
  }, [isOpen, anchorRef, view]);

  if (!isOpen) return null;

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);
  const today = new Date();

  // Year-grid window: aligned 12-year block containing the current year, so the
  // navigation arrows step exactly one grid (±12 years) at a time.
  const decadeStart = year - (year % 12);
  const decadeEnd = decadeStart + 11;
  // Year-granularity range bounds — a year is disabled only when it lies wholly
  // outside [min, max].
  const minYear = min ? new Date(min).getFullYear() : null;
  const maxYear = max ? new Date(max).getFullYear() : null;
  const isYearOutOfRange = (y: number) =>
    (minYear !== null && y < minYear) || (maxYear !== null && y > maxYear);

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
          className={`w-8 h-8 mx-auto text-sm font-medium rounded-full flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
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

      <div
        ref={popRef}
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_WIDTH, visibility: positioned ? 'visible' : 'hidden' }}
        className="z-[61] bg-white rounded-2xl shadow-lg border border-slate-100 p-3"
      >
        {/* View tabs — always-visible level switcher (day / month / year).
            Each tab jumps straight to that granularity, so the current level and
            the way to change it are never ambiguous. */}
        <div className="flex items-center gap-0.5 mb-2 p-0.5 bg-slate-100 rounded-full">
          {VIEW_TABS.map((t) => {
            const active = view === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setView(t.key)}
                aria-pressed={active}
                className={`no-pill flex-1 py-1 rounded-full text-xs font-bold transition-colors focus:outline-none ${
                  active ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Navigation row — arrows + non-clickable context label */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-slate-700 px-1">
            {view === 'days'
              ? `${MONTH_NAMES[month]} ${year}`
              : view === 'months'
                ? year
                : `${decadeStart} – ${decadeEnd}`}
          </span>

          <div className="flex items-center gap-0.5">
            {/* RTL: previous = points right, next = points left */}
            <button
              type="button"
              aria-label="السابق"
              onClick={() => (view === 'days' ? prevMonth() : setYear((y) => y - (view === 'years' ? 12 : 1)))}
              className="p-1.5 text-sky-600 hover:bg-slate-100 rounded-full transition-colors focus:outline-none"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              aria-label="التالي"
              onClick={() => (view === 'days' ? nextMonth() : setYear((y) => y + (view === 'years' ? 12 : 1)))}
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
                <div key={i} className="text-xs font-bold text-slate-400 py-1">
                  {wd}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {renderDays()}
            </div>
          </>
        ) : view === 'months' ? (
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
        ) : (
          /* Year picker — 12-year block; arrows page by decade */
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }, (_, i) => decadeStart + i).map((y) => {
              const isSelected = y === selected.y;
              const isCurrent = y === today.getFullYear();
              const disabled = isYearOutOfRange(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => { setYear(y); setView('months'); }}
                  disabled={disabled}
                  aria-disabled={disabled}
                  className={`py-2 rounded-full text-xs font-bold transition-colors ${
                    disabled
                      ? 'text-slate-300 cursor-not-allowed line-through decoration-slate-300'
                      : isSelected
                        ? 'bg-sky-500 text-white'
                        : `text-slate-700 hover:bg-slate-100 ${isCurrent ? 'ring-1 ring-sky-300' : ''}`
                  }`}
                >
                  {y}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
