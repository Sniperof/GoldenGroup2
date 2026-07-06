// ============================================================
// DonutChart — توزيع فئوي حلقي (reporting-analytics §3.9)
// ============================================================
// حلقة SVG: قوس كل فئة ∝ حصّتها من الإجمالي + وسط يعرض الإجمالي + مفتاح ألوان
// (فئة/قيمة/نسبة). بلا مكتبة رسم — SVG خام + CSS، RTL. المجموعات كلها value>0
// (BreakdownWidget يمنع العرض عند الفراغ).
// ============================================================

import type { BreakdownResponse } from '../../lib/api';

// لوحة فئوية متمايزة (تُطابق درجات Tailwind الأساسية) — لا دلالة ترتيبية.
const DONUT_TONES = ['#0ea5e9', '#6366f1', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#14b8a6', '#94a3b8'];

const R = 48;
const CIRC = 2 * Math.PI * R;
const STROKE = 18;

export default function DonutChart({ data }: { data: BreakdownResponse }) {
  const groups = data.groups.filter(g => g.value > 0);
  const total = groups.reduce((sum, g) => sum + g.value, 0);
  const fmt = (v: number) => (data.valueUnit === 'percent' ? `${v}%` : new Intl.NumberFormat('ar').format(v));

  let acc = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative w-32 h-32 shrink-0">
        <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
          <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth={STROKE} />
          {groups.map((g, i) => {
            const len = total > 0 ? (g.value / total) * CIRC : 0;
            const seg = (
              <circle
                key={g.key}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={DONUT_TONES[i % DONUT_TONES.length]}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${CIRC - len}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-black tabular-nums text-slate-800">{fmt(total)}</span>
          <span className="text-[10px] text-slate-400">الإجمالي</span>
        </div>
      </div>

      <div className="flex flex-1 min-w-0 flex-col gap-1.5">
        {groups.map((g, i) => {
          const pct = total > 0 ? Math.round((g.value / total) * 100) : 0;
          return (
            <div key={g.key} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 shrink-0 rounded-sm"
                style={{ background: DONUT_TONES[i % DONUT_TONES.length] }}
              />
              <span className="flex-1 truncate font-bold text-slate-600" title={g.label}>{g.label}</span>
              <span className="shrink-0 tabular-nums font-black text-slate-700">{fmt(g.value)}</span>
              <span className="w-9 shrink-0 text-left tabular-nums text-slate-400">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
