// Horizontal, RTL-aware profile tab bar: icon + label tabs with an active
// underline, plus edge fades and chevron buttons when the tabs overflow.
// Shared by the client profile and the device profile pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from './icons';
import type { LucideIcon } from './icons';

export interface ProfileTab {
  id: string;
  label: string;
  icon: LucideIcon;
}

export default function ProfileTabsBar({
  tabs,
  activeId,
  onChange,
}: {
  tabs: ProfileTab[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 1) {
      setOverflow({ start: false, end: false });
      return;
    }
    // RTL-safe: scrolled distance away from the visual start (right edge).
    const scrolled = Math.abs(el.scrollLeft);
    setOverflow({ start: scrolled > 1, end: scrolled < max - 1 });
  }, []);

  useEffect(() => {
    updateOverflow();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateOverflow, { passive: true });
    window.addEventListener('resize', updateOverflow);
    return () => {
      el.removeEventListener('scroll', updateOverflow);
      window.removeEventListener('resize', updateOverflow);
    };
  }, [updateOverflow, tabs.length]);

  const scrollToward = (dir: 'start' | 'end') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.6, 160);
    // RTL: moving toward the visual end (left) decreases scrollLeft.
    el.scrollBy({ left: dir === 'end' ? -amount : amount, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      {/* start (right edge in RTL) */}
      {overflow.start && (
        <>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-slate-50 via-slate-50/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollToward('start')}
            aria-label="عرض التبويبات السابقة"
            className="absolute inset-y-0 right-0 z-20 flex items-center pr-0.5 pl-1.5 text-slate-400 transition-colors hover:text-sky-600"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* end (left edge in RTL) */}
      {overflow.end && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-slate-50 via-slate-50/80 to-transparent" />
          <button
            type="button"
            onClick={() => scrollToward('end')}
            aria-label="عرض التبويبات التالية"
            className="absolute inset-y-0 left-0 z-20 flex items-center pl-0.5 pr-1.5 text-slate-400 transition-colors hover:text-sky-600"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </>
      )}

      <div ref={scrollRef} className="overflow-x-auto no-scrollbar">
        <div className="flex w-max min-w-full items-center gap-1">
          {tabs.map((tab) => {
            const active = activeId === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onChange(tab.id)}
                className={`relative inline-flex shrink-0 items-center justify-center gap-1.5 px-3.5 py-2.5 text-base font-bold whitespace-nowrap transition-colors ${active
                  ? 'text-sky-600 after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:bg-sky-600 after:rounded-t'
                  : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <tab.icon className={`w-4 h-4 ${active ? 'text-sky-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
