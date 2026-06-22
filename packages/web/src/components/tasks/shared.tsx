import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

export type CardAccent = 'indigo' | 'emerald' | 'slate' | 'violet' | 'amber' | 'sky' | 'rose';

const ACCENT_THEME: Record<CardAccent, { bar: string; iconBg: string; iconText: string }> = {
  indigo:  { bar: 'bg-indigo-500',  iconBg: 'bg-indigo-50',  iconText: 'text-indigo-600' },
  emerald: { bar: 'bg-emerald-500', iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
  slate:   { bar: 'bg-slate-400',   iconBg: 'bg-slate-100',  iconText: 'text-slate-600' },
  violet:  { bar: 'bg-violet-500',  iconBg: 'bg-violet-50',  iconText: 'text-violet-600' },
  amber:   { bar: 'bg-amber-500',   iconBg: 'bg-amber-50',   iconText: 'text-amber-600' },
  sky:     { bar: 'bg-sky-500',     iconBg: 'bg-sky-50',     iconText: 'text-sky-600' },
  rose:    { bar: 'bg-rose-500',    iconBg: 'bg-rose-50',    iconText: 'text-rose-600' },
};

export function Card({ title, icon: Icon, children, className = '', accent }: { title: string; icon: LucideIcon; children: ReactNode; className?: string; accent?: CardAccent }) {
  const theme = accent ? ACCENT_THEME[accent] : null;
  return (
    <div className={`relative bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm transition-shadow hover:shadow-md ${className}`}>
      {theme && <span className={`absolute top-0 inset-x-0 h-0.5 ${theme.bar}`} aria-hidden />}
      <div className="px-5 py-3 border-b border-slate-100 bg-gradient-to-bl from-white to-slate-50/40 flex items-center gap-2.5">
        {theme ? (
          <span className={`w-7 h-7 rounded-lg ${theme.iconBg} ${theme.iconText} flex items-center justify-center`}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        ) : (
          <Icon className="w-4 h-4 text-slate-400" />
        )}
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function InfoLine({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5 gap-4">
      <span className="text-xs text-slate-400 font-bold shrink-0">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-8 text-center text-slate-500">
      <Icon className="w-8 h-8 text-slate-300" />
      <p className="mt-3 text-sm font-bold text-slate-600">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

export function TabAlert({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
      <p className="font-bold mb-1 flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        {title}
      </p>
      <ul className="list-disc pr-5 space-y-1">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

// All formatters use the Latin numbering system per operator preference
// (Western digits, e.g. 2026 not ٢٠٢٦) while keeping Arabic month names / locale.
const LATN: Intl.DateTimeFormatOptions = { numberingSystem: 'latn' } as Intl.DateTimeFormatOptions;

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('ar-SY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      ...LATN,
    });
  } catch { return dateStr; }
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-SY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      ...LATN,
    });
  } catch { return dateStr; }
}

export function formatMoney(value: any, currency: string | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const formatted = n.toLocaleString('ar-SY', { numberingSystem: 'latn' } as any);
  return currency ? `${formatted} ${currency}` : formatted;
}
