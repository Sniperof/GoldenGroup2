// ============================================================
// FunnelChart — قمع تراكمي مركزي (reporting-analytics §3.9)
// ============================================================
// أشرطة أفقية مركزية تتناقص للأسفل فتُشكّل صورة القمع؛ عرض كل شريط ∝ قيمته/قمة
// القمع، والقيمة داخل الشريط، والنسبة = تحويل من قمة المسار (كم بقي من الداخلين).
// المدخلات تراكمية (متناقصة) من breakdownCatalog. بلا مكتبة رسم — CSS/flex، RTL.
// ============================================================

import type { BreakdownGroup } from '../../lib/api';

// تدرّج لوني هادئ يميّز المراحل بصريًا (من قمة المسار نزولًا).
const FUNNEL_TONES = [
  'from-sky-600 to-sky-500',
  'from-sky-500 to-cyan-500',
  'from-indigo-500 to-indigo-400',
  'from-amber-500 to-amber-400',
  'from-emerald-500 to-emerald-400',
];

export default function FunnelChart({ groups }: { groups: BreakdownGroup[] }) {
  const top = groups.length > 0 ? Math.max(1, groups[0].value) : 1;

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g, i) => {
        const widthPct = g.value > 0 ? Math.max(8, Math.round((g.value / top) * 100)) : 0;
        const convPct = Math.round((g.value / top) * 100);
        return (
          <div key={g.key} className="flex items-center gap-2">
            <span className="w-16 shrink-0 truncate text-xs font-bold text-slate-600" title={g.label}>{g.label}</span>
            <div className="flex flex-1 justify-center">
              {widthPct > 0 ? (
                <div
                  className={`flex h-7 items-center justify-center rounded-md bg-gradient-to-l ${FUNNEL_TONES[i % FUNNEL_TONES.length]} text-[11px] font-black text-white shadow-sm transition-all duration-500`}
                  style={{ width: `${widthPct}%` }}
                >
                  {g.value}
                </div>
              ) : (
                <div className="flex h-7 items-center text-[11px] font-bold text-slate-300">0</div>
              )}
            </div>
            <span className="w-9 shrink-0 text-left text-[11px] tabular-nums text-slate-400">{convPct}%</span>
          </div>
        );
      })}
    </div>
  );
}
