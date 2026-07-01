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
  unit: 'count' | 'percent';
  data: MetricResponse | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

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

export default function KpiCard({ title, unit, data, loading, error, refreshing, onRefresh }: Props) {
  const delta = data?.deltaPct ?? null;
  const deltaUp = delta != null && delta >= 0;

  return (
    <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-slate-500 font-medium">{title}</p>
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
          <p className="text-2xl font-bold text-slate-800">{data ? formatValue(data.value, unit) : '—'}</p>
          {delta != null && (
            <span
              className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${
                deltaUp
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
        <p className="text-[10px] text-slate-400 mt-3">
          آخر تحديث: {formatUpdatedAt(data.computedAt)}
          {data.fromCache ? ' · مخزّن' : ''}
        </p>
      )}
    </div>
  );
}
