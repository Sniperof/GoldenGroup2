// ============================================================
// RankedBarChart — أشرطة أفقية مرتّبة تنازليًا (reporting-analytics §3.9)
// ============================================================
// Leaderboard: رتبة + اسم + شريط (عرضه ∝ القيمة/الأكبر) + القيمة + قيمة ثانوية
// اختيارية (مثل معدّل التحويل). بلا مكتبة رسم — CSS/flex فقط، RTL.
// ============================================================

import type { BreakdownResponse } from '../../lib/api';
import { breakdownLabel } from './breakdownLabels';

export default function RankedBarChart({ data }: { data: BreakdownResponse }) {
  const groups = data.groups;
  const max = Math.max(1, ...groups.map(g => g.value));
  const fmt = (v: number) => (data.valueUnit === 'percent' ? `${v}%` : new Intl.NumberFormat('ar').format(v));

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g, i) => {
        const label = breakdownLabel(g.key, g.label);
        const widthPct = g.value > 0 ? Math.max(4, Math.round((g.value / max) * 100)) : 0;
        return (
          <div key={g.key} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-[11px] font-black tabular-nums text-slate-400">{i + 1}</span>
            <span className="w-24 shrink-0 truncate text-xs font-bold text-slate-600" title={label}>{label}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div
                className="absolute inset-y-0 right-0 rounded-md bg-gradient-to-l from-sky-500 to-sky-400 transition-all duration-500"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="w-12 shrink-0 text-left text-xs font-black tabular-nums text-slate-700">{fmt(g.value)}</span>
            {g.value2 != null && data.secondaryLabel && (
              <span className="w-16 shrink-0 text-left text-[10px] tabular-nums text-slate-400">
                {data.secondaryLabel} {g.value2}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
