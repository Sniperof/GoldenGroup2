// ============================================================
// AttemptAlertsCard.tsx — Supervisor-side alert for high-attempt tasks
// ============================================================
// Constitution source:
//   DEC-006 D37 — informational alert when attempt_count >= threshold,
//                  NO forced close. Threshold lives in
//                  system_settings.attempt_alert_threshold (default 5).
// ============================================================

import { useEffect, useState } from 'react';
import { AlertTriangle, Phone, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';

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

export default function AttemptAlertsCard() {
  const [threshold, setThreshold] = useState<number>(5);
  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.openTasks.attemptAlerts();
      setThreshold(res.threshold);
      setItems(res.items as unknown as AlertItem[]);
    } catch (e: any) {
      setError(e?.message ?? 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-amber-900">
            تنبيه المحاولات (≥ {threshold})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      <p className="text-[11px] text-amber-800/80">
        قائمة المهام التي تجاوزت عتبة المحاولات. تنبيه إعلامي فقط — لا إغلاق قسري
        (DEC-006 D37). العتبة قابلة للضبط من إعدادات النظام.
      </p>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-amber-300 bg-white/60 p-3 text-center text-xs text-amber-800">
          لا توجد مهام فوق العتبة حالياً.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.openTaskId}
              className="rounded-md bg-white border border-amber-200 p-2 flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">
                  {item.clientName}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  مهمة #{item.openTaskId} · {item.taskType}
                </div>
                <div className="text-[10px] text-slate-400">
                  آخر محاولة: {formatDateTime(item.lastAttemptAt)}
                </div>
              </div>
              <div className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 text-amber-900 text-[11px] font-bold">
                <Phone className="w-3 h-3" /> {item.attemptCount}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
