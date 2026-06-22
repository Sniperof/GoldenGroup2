// ────────────────────────────────────────────────────────────────────────────
// <Tabs> — Golden Group design system, single source of truth.
//
// variant="underline" (default) — section tabs. Active = sky-600 with a
//   2.5px sky-600 underline drawn by a ::after pseudo so the border on the
//   parent never needs a transparent stand-in.
//
// variant="pill" — segmented control for 2–3 short options.
//
// Counter badge is automatic when `count` is set on a tab.
//
// Style values match TABS_AND_TOASTS.md exactly. Do NOT duplicate this
// component or its classes inline in pages — import this instead.
// ────────────────────────────────────────────────────────────────────────────
import type { LucideIcon } from 'lucide-react';

export type TabDef<K extends string = string> = {
  id: K;
  label: string;
  icon?: LucideIcon;
  count?: number | string;
};

export interface TabsProps<K extends string = string> {
  tabs: TabDef<K>[];
  activeKey: K;
  onChange: (key: K) => void;
  variant?: 'underline' | 'pill';
  className?: string;
}

export default function Tabs<K extends string = string>({
  tabs,
  activeKey,
  onChange,
  variant = 'underline',
  className = '',
}: TabsProps<K>) {
  if (variant === 'pill') {
    return (
      <div className={`inline-flex items-center gap-1 bg-[#EEF1F4] p-1 rounded-full ${className}`}>
        {tabs.map(tab => {
          const Icon = tab.icon;
          const active = activeKey === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-base font-bold transition-all ${
                active ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`rounded-full text-xs font-bold px-1.5 ${
                    active ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`flex gap-1 border-b border-[#E3E7EC] ${className}`}>
      {tabs.map(tab => {
        const Icon = tab.icon;
        const active = activeKey === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative inline-flex items-center gap-1.5 px-3.5 py-2.5 text-base font-bold transition-colors whitespace-nowrap ${
              active
                ? 'text-sky-600 after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:bg-sky-600 after:rounded-t'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`rounded-full text-xs font-bold px-1.5 ${
                  active ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
