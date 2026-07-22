// ============================================================
// KpiCard — بطاقة مؤشر (reporting-analytics §1.3 / §6.5)
// ============================================================
// عرض رقم + دلتا مقابل الفترة السابقة + "آخر تحديث" + زر تحديث يدوي (§7.6).
// تستبدل بطاقات الداشبورد القديمة ذات الدلتا الوهمية الثابتة.
// ============================================================

import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import type { MetricResponse } from '../../lib/api';

interface Props {
  title: string;
  description: string;
  accent: 'sky' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet';
  trendDirection?: 'higher-is-better' | 'lower-is-better' | 'neutral';
  unit: 'count' | 'percent';
  data: MetricResponse | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

const ACCENTS = {
  sky: { line: 'bg-sky-500', wash: 'from-sky-50', value: 'text-sky-700' },
  indigo: { line: 'bg-indigo-500', wash: 'from-indigo-50', value: 'text-indigo-700' },
  emerald: { line: 'bg-emerald-500', wash: 'from-emerald-50', value: 'text-emerald-700' },
  amber: { line: 'bg-amber-500', wash: 'from-amber-50', value: 'text-amber-700' },
  rose: { line: 'bg-rose-500', wash: 'from-rose-50', value: 'text-rose-700' },
  violet: { line: 'bg-violet-500', wash: 'from-violet-50', value: 'text-violet-700' },
} as const;

function formatValue(value: number, unit: 'count' | 'percent'): string {
  if (unit === 'percent') return `${value}%`;
  return new Intl.NumberFormat('ar').format(value);
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function KpiCard({
  title,
  description,
  accent,
  trendDirection = 'neutral',
  unit,
  data,
  loading,
  error,
  refreshing,
  onRefresh,
}: Props) {
  const delta = data?.deltaPct ?? null;
  const deltaUp = delta != null && delta >= 0;
  const deltaIsGood = delta == null || delta === 0 || trendDirection === 'neutral'
    ? null
    : trendDirection === 'higher-is-better' ? deltaUp : !deltaUp;
  const tone = ACCENTS[accent];

  return (
    <div className={`relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br ${tone.wash} via-white to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${tone.line}`} />
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 pl-2">
          <p className="text-sm font-black text-slate-800">{title}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{description}</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing || loading}
          title="تحديث"
          aria-label="تحديث المؤشر"
          className="p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="h-8 w-20 bg-slate-100 rounded animate-pulse" />
      ) : error ? (
        <p className="text-sm text-rose-500">{error}</p>
      ) : (
        <div className="flex items-end justify-between gap-2">
          <p className={`text-3xl font-black tracking-tight ${tone.value}`}>{data ? formatValue(data.value, unit) : '—'}</p>
          {delta != null && (
            <span
              className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${
                deltaIsGood === null
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : deltaIsGood
                  ? 'text-emerald-600 bg-emerald-50 border-emerald-100'
                  : 'text-rose-600 bg-rose-50 border-rose-100'
              }`}
            >
              {deltaUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {Math.abs(delta)}%
            </span>
          )}
        </div>
      )}

      {data && !loading && !error && (
        <p className="mt-4 border-t border-slate-100 pt-3 text-[10px] text-slate-400">
          آخر تحديث: {formatUpdatedAt(data.computedAt)}
          {data.fromCache ? ' · مخزّن' : ''}
        </p>
      )}
    </div>
  );
}
