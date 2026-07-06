// ============================================================
// FunnelChart — رسم قمع بسيط (reporting-analytics §3.9)
// ============================================================
// أشرطة أفقية بترتيب المسار؛ عرض كل شريط ∝ حصّته من أكبر مرحلة (شكل القمع).
// بلا مكتبة رسم خارجية — CSS/flex فقط، متسق مع نظام التصميم وRTL.
// ============================================================

import type { BreakdownGroup } from '../../lib/api';

// تدرّج لوني هادئ يميّز المراحل بصريًا دون دلالة ترتيبية زائفة.
const BAR_TONES = [
  'from-sky-500 to-sky-400',
  'from-sky-500 to-sky-400',
  'from-indigo-500 to-indigo-400',
  'from-amber-500 to-amber-400',
  'from-emerald-500 to-emerald-400',
  'from-rose-500 to-rose-400',
];

export default function FunnelChart({ groups }: { groups: BreakdownGroup[] }) {
  const max = Math.max(1, ...groups.map(g => g.value));
  const total = groups.reduce((sum, g) => sum + g.value, 0);

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => {
        const widthPct = g.value > 0 ? Math.max(4, Math.round((g.value / max) * 100)) : 0;
        const sharePct = total > 0 ? Math.round((g.value / total) * 100) : 0;
        return (
          <div key={g.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-xs font-bold text-slate-600" title={g.label}>{g.label}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-slate-100">
              <div
                className={`absolute inset-y-0 right-0 rounded-md bg-gradient-to-l ${BAR_TONES[i % BAR_TONES.length]} transition-all duration-500`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right text-xs font-black tabular-nums text-slate-700">{g.value}</span>
            <span className="w-9 shrink-0 text-left text-[11px] tabular-nums text-slate-400">{sharePct}%</span>
          </div>
        );
      })}
    </div>
  );
}
