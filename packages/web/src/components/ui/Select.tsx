// ────────────────────────────────────────────────────────────────────────────
// <Select> — Golden Group design system custom dropdown.
//
// Why not <select>?
//   Native <select> rendered popups are OS-styled — we cannot match the
//   design's checkmark + rounded items + brand hover. This component is a
//   pill-trigger button + absolutely-positioned popover menu.
//
// Behavior:
//   • Click trigger → toggle open
//   • Click outside / ESC → close
//   • Click option → select + close
//   • Arrow keys navigate (Up/Down), Enter selects, Home/End jump
//   • Selected option shown with ✓ + bg-sky-50 text-sky-700
//
// Variants:
//   • outlined (default) — white bg, slate border
//   • filled — soft grey bg, no border
//
// Style values match TABS_AND_TOASTS.md / pill-dropdown-select spec.
// ────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption<V extends string | number> = {
  value: V;
  label: string;
  /** Optional left-of-label adornment (e.g. icon, color dot). */
  leading?: ReactNode;
  disabled?: boolean;
};

export interface SelectProps<V extends string | number> {
  value: V;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  variant?: 'outlined' | 'filled';
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  /** Optional id for the trigger (for label htmlFor). */
  id?: string;
  /** Optional aria-label when no visible label. */
  ariaLabel?: string;
}

export default function Select<V extends string | number>({
  value,
  onChange,
  options,
  placeholder,
  variant = 'outlined',
  size = 'md',
  disabled = false,
  className = '',
  id,
  ariaLabel,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Menu is portalled to <body> with fixed positioning so it escapes any
  // ancestor `overflow-hidden` card and never gets clipped. `openUp` flips it
  // above the trigger when there isn't enough room below (bottom of screen/card).
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number; maxHeight: number; openUp: boolean } | null>(null);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${triggerId}-listbox`;

  const selectedIndex = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  // Open: highlight the currently-selected item.
  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  // Click outside closes the menu. The menu lives in a portal (outside rootRef),
  // so its own node must be excluded too — otherwise clicking an option would
  // count as "outside" and close before the option's onClick fires.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open, close]);

  // Position the portalled menu against the trigger; flip up when needed.
  // Recomputed before paint and on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return; }

    const GAP = 6;          // matches the old mt-1.5
    const MARGIN = 8;       // min breathing room from the viewport edge
    const MAX = 288;        // matches the old max-h-72

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - GAP - MARGIN;
      const spaceAbove = rect.top - GAP - MARGIN;
      // Flip up only when there's genuinely more room above.
      const openUp = spaceBelow < Math.min(MAX, 180) && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(MAX, openUp ? spaceAbove : spaceBelow));
      setMenuPos({
        left: rect.left,
        top: openUp ? rect.top - GAP : rect.bottom + GAP,
        width: rect.width,
        maxHeight,
        openUp,
      });
    };

    place();
    window.addEventListener('scroll', place, true); // capture: catch scrolls in any ancestor
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function moveActive(delta: number) {
    if (options.length === 0) return;
    let i = activeIndex;
    for (let step = 0; step < options.length; step++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) {
        setActiveIndex(i);
        return;
      }
    }
  }

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close();
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'ArrowDown')   { e.preventDefault(); moveActive(+1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Home')    { e.preventDefault(); setActiveIndex(0); }
    else if (e.key === 'End')     { e.preventDefault(); setActiveIndex(options.length - 1); }
    else if (e.key === 'Enter')   { e.preventDefault(); commit(activeIndex); }
    else if (e.key === 'Escape')  { e.preventDefault(); close(); }
    else if (e.key === 'Tab')     { close(); }
  }

  // ---- styling --------------------------------------------------------------
  const triggerBase =
    'group inline-flex w-full items-center justify-between gap-2 rounded-full font-bold transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed';
  const triggerSize = size === 'sm'
    ? 'h-8 px-4 text-sm'
    : 'h-[39px] px-4 text-sm';
  const triggerVariant = variant === 'filled'
    ? 'bg-[#EEF1F4] text-slate-700 hover:bg-[#E3E7EC]'
    : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300';

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        className={`${triggerBase} ${triggerSize} ${triggerVariant} no-pill`}
      >
        <span className={`truncate ${!selected ? 'text-slate-400 font-medium' : ''}`}>
          {selected ? (
            <span className="inline-flex items-center gap-1.5">
              {selected.leading}
              {selected.label}
            </span>
          ) : (
            placeholder ?? '...'
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? '-rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && menuPos && createPortal(
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          autoFocus
          onKeyDown={onListKeyDown}
          aria-activedescendant={activeIndex >= 0 ? `${triggerId}-opt-${activeIndex}` : undefined}
          className="overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg focus:outline-none"
          style={{
            position: 'fixed',
            left: menuPos.left,
            top: menuPos.top,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
            transform: menuPos.openUp ? 'translateY(-100%)' : undefined,
            zIndex: 9999,
          }}
        >
          {options.map((opt, i) => {
            const isActive = i === activeIndex;
            const isSelected = opt.value === value;
            return (
              <li
                key={String(opt.value)}
                id={`${triggerId}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                onPointerEnter={() => !opt.disabled && setActiveIndex(i)}
                onClick={() => commit(i)}
                className={[
                  'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  opt.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  isSelected
                    ? 'bg-sky-50 text-sky-700 font-semibold'
                    : isActive
                      ? 'bg-slate-50 text-slate-800'
                      : 'text-slate-700',
                ].join(' ')}
              >
                <span className="inline-flex items-center gap-2 truncate">
                  {opt.leading}
                  {opt.label}
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
