// DEC-CT-09: vertical timeline of device_possession_log entries.
//
// Renders rows newest-first (the API already orders them this way).
// The open row (end_at IS NULL) gets a "current" marker.

import { PossessionHolderChip } from './PossessionHolderChip';
import type { DevicePossessionEntry } from '@golden-crm/shared';

interface Props {
  entries: DevicePossessionEntry[];
  resolveHolderName?: (entry: DevicePossessionEntry) => string | null;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('ar-SY', { numberingSystem: 'latn' });
  } catch {
    return d;
  }
}

export function DevicePossessionTimeline({ entries, resolveHolderName }: Props) {
  if (!entries?.length) {
    return (
      <div className="text-xs text-slate-400 italic py-4 text-center">
        لا يوجد سجل حيازة بعد.
      </div>
    );
  }
  return (
    <ol className="relative border-r-2 border-slate-200 pr-6 space-y-6">
      {entries.map((e, idx) => {
        const isOpen = e.endAt == null;
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -right-[33px] top-1 w-4 h-4 rounded-full border-2 ${
                isOpen ? 'bg-emerald-500 border-emerald-200' : 'bg-slate-300 border-slate-100'
              }`}
            />
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <PossessionHolderChip
                  holderType={e.holderType}
                  holderName={resolveHolderName?.(e) ?? null}
                  reason={e.reason}
                  showReason
                />
                <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                  <span>من: <span className="font-semibold text-slate-700">{fmt(e.startAt)}</span></span>
                  {' — '}
                  <span>إلى: <span className="font-semibold text-slate-700">{isOpen ? 'الآن (حالي)' : fmt(e.endAt)}</span></span>
                </div>
                {e.notes && (
                  <p className="mt-1 text-[11px] text-slate-400 italic">{e.notes}</p>
                )}
              </div>
              {idx === 0 && isOpen && (
                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                  الحالي
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default DevicePossessionTimeline;
