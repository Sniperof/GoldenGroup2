// ============================================================
// AttemptAlertsCard.tsx — Supervisor-side alert for high-attempt tasks
// ============================================================
// Constitution source:
//   DEC-006 D37 — informational alert when attempt_count >= threshold,
//                  NO forced close. Threshold lives in
//                  system_settings.attempt_alert_threshold (default 5).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Phone, RefreshCw } from '../ui/icons';
import { api } from '../../lib/api';
import { useBranchContextStore } from '../../hooks/useBranchContextStore';
import Button from '../ui/Button';

interface AlertItem {
  openTaskId: number;
  clientId: number;
  clientName: string;
  clientMobile: string | null;
  taskType: string;
  attemptCount: number;
  lastAttemptAt: string | null;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-IQ', { hour12: false, dateStyle: 'short', timeStyle: 'short' });
}

export default function AttemptAlertsCard({ refreshKey }: { refreshKey: number }) {
  const branchId = useBranchContextStore(s => s.branchId);
  const [threshold, setThreshold] = useState<number>(5);
  const [visibilityScope, setVisibilityScope] = useState<'GLOBAL' | 'BRANCH' | 'ASSIGNED' | null>(null);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  async function load() {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoaded(false);
    setVisibilityScope(null);
    setError(null);
    try {
      const res = await api.openTasks.attemptAlerts();
      if (currentRequest !== requestId.current) return;
      setThreshold(res.threshold);
      setVisibilityScope(res.visibilityScope);
      setItems(res.items);
      setLoaded(true);
    } catch (e: any) {
      if (currentRequest !== requestId.current) return;
      setError(e?.message ?? 'فشل التحميل');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [refreshKey, branchId]);

  return (
    <section className="rounded-2xl border border-amber-200 bg-white p-4 sm:p-5 space-y-3" aria-labelledby="attempt-heading">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <h2 id="attempt-heading" className="text-lg font-bold text-amber-900">مهام بلغت عتبة المحاولات (≥ {threshold})</h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load()}
          loading={loading}
          icon={RefreshCw}
        >
          تحديث
        </Button>
      </div>

      <p className="text-xs text-amber-800/80">
        {visibilityScope === 'ASSIGNED' ? 'مهام زبائنك أو فريق زياراتك المسندة فقط.' : 'مهام الفرع للمراقبة.'} راجع حالة التواصل وحدد الخطوة التالية. التنبيه لا يغلق المهمة أو يمنع محاولة جديدة.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {loading && !loaded && <p className="text-sm text-slate-500">جارٍ تحميل المهام…</p>}
      {loaded && items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-white/60 p-3 text-center text-xs text-amber-800">
          لا توجد مهام فوق العتبة ضمن نطاقك حالياً.
        </div>
      ) : loaded ? (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.openTaskId}
              className="rounded-lg bg-white border border-amber-200 p-2 flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">
                  {item.clientName}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  مهمة #{item.openTaskId} · {item.taskType}
                </div>
                <div className="text-xs text-slate-400">
                  آخر محاولة: {formatDateTime(item.lastAttemptAt)}
                </div>
              </div>
              <div className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 text-amber-900 text-xs font-bold">
                <Phone className="w-3 h-3" /> {item.attemptCount}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
