// ============================================================
// MetricWidget — widget يجلب مؤشره بنفسه (reporting-analytics §7.1)
// ============================================================
// الجلب عند الطلب فقط: كل widget معروض يطلب مؤشره مرّة عند تغيّر النطاق. التحديث
// اليدوي يفرض إعادة حساب على الخادم (forceRefresh). الخادم يخدم من الكاش ضمن
// فترة الأدمن — فلا ضغط على قاعدة البيانات.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { api, type MetricResponse } from '../../lib/api';
import KpiCard from './KpiCard';
import type { ScopeState, WidgetDef } from './widgetRegistry';

interface Props {
  def: WidgetDef;
  scope: ScopeState;
}

export default function MetricWidget({ def, scope }: Props) {
  const [data, setData] = useState<MetricResponse | null>(null);
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
          ? await api.reports.refresh(def.key, params)
          : await api.reports.metric(def.key, params);
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
    <KpiCard
      title={def.titleAr}
      unit={def.unit}
      data={data}
      loading={loading}
      error={error}
      refreshing={refreshing}
      onRefresh={() => void load(true)}
    />
  );
}
