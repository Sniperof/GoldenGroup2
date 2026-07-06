// ============================================================
// BreakdownWidget — widget تجميعي يجلب مؤشره ويرسمه (reporting-analytics §7.1)
// ============================================================
// نظير MetricWidget للمؤشرات القياسية: جلب عند الطلب + تحديث يدوي (forceRefresh)
// + عرض "آخر تحديث/مخزّن". يختار الرسم حسب kind (حاليًا: funnel).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type BreakdownResponse } from '../../lib/api';
import FunnelChart from './FunnelChart';
import RankedBarChart from './RankedBarChart';
import type { ScopeState, WidgetDef } from './widgetRegistry';

interface Props {
  def: WidgetDef;
  scope: ScopeState;
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function BreakdownWidget({ def, scope }: Props) {
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = {
    preset: scope.preset,
    branchId: scope.branchId ?? undefined,
  };

  const load = useCallback(
    async (force: boolean) => {
      force ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const res = force
          ? await api.reports.refreshBreakdown(def.key, params)
          : await api.reports.breakdown(def.key, params);
        setData(res);
      } catch (err: any) {
        setError(err?.message?.includes('403') ? 'غير مصرّح' : 'تعذّر التحميل');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.key, scope.preset, scope.branchId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="bg-white shadow-sm border border-slate-200 rounded-xl p-5 hover:shadow-md transition-all h-full">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs text-slate-500 font-medium">{def.titleAr}</p>
        <button
          onClick={() => void load(true)}
          disabled={refreshing || loading}
          title="تحديث"
          aria-label="تحديث المؤشر"
          className="p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="h-6 rounded bg-slate-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <p className="text-sm text-rose-500">{error}</p>
      ) : data && (data.kind === 'funnel' ? data.total === 0 : data.groups.length === 0) ? (
        <p className="py-8 text-center text-sm text-slate-400">لا بيانات ضمن الفترة المختارة</p>
      ) : data ? (
        data.kind === 'ranked-bar' ? <RankedBarChart data={data} /> : <FunnelChart groups={data.groups} />
      ) : null}

      {data && !loading && !error && (
        <p className="text-[10px] text-slate-400 mt-4">
          آخر تحديث: {formatUpdatedAt(data.computedAt)}
          {data.fromCache ? ' · مخزّن' : ''}
          {data.kind === 'funnel' ? ` · الإجمالي: ${data.total}` : ` · ${data.groups.length} بندًا`}
        </p>
      )}
    </div>
  );
}
