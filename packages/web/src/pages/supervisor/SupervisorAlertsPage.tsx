// ============================================================
// SupervisorAlertsPage.tsx — Supervisor/Branch-Manager alert hub
// ============================================================
// Aggregates the two operational alert streams introduced in Phases 5–7:
//   - DEC-006 D37: open_tasks whose attempt_count crossed the threshold
//   - DEC-006 D38: field_visits with escalation alerts pending
// ============================================================

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Activity, RefreshCw } from 'lucide-react';
import AttemptAlertsCard from '../../components/supervisor/AttemptAlertsCard';
import { api } from '../../lib/api';

interface EscalationItem {
  visitId: number;
  status: string;
  branchId: number;
  clientId: number;
  clientName: string | null;
  teamResponsibleUserId: number | null;
  hoursSinceUpdate: number;
  tiersAlerted: number[];
}

const TIER_META: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'L1 — تنبيه الفني', color: 'text-amber-800', bg: 'bg-amber-100' },
  2: { label: 'L2 — قفل بدء + المشرف', color: 'text-orange-800', bg: 'bg-orange-100' },
  3: { label: 'L3 — مدير الفرع', color: 'text-red-800', bg: 'bg-red-100' },
};

export default function SupervisorAlertsPage() {
  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadEscalations() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fieldVisits.escalationAlerts();
      setEscalations(res.items as unknown as EscalationItem[]);
    } catch (e: any) {
      setError(e?.message ?? 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEscalations();
  }, []);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800">لوحة تنبيهات المشرف</h1>
            <p className="text-xs text-slate-500">تتبع المهام عالية المحاولات والزيارات بانتظار التوثيق.</p>
          </div>
        </div>
        <button
          onClick={() => void loadEscalations()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 hover:bg-slate-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* DEC-006 D37: attempt threshold alerts */}
        <AttemptAlertsCard />

        {/* DEC-006 D38: undocumented visit escalation */}
        <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-700" />
            <h3 className="text-sm font-bold text-orange-900">زيارات بانتظار التوثيق</h3>
          </div>
          <p className="text-[11px] text-orange-800/80">
            زيارات في in_progress / ended تجاوزت عتبة الساعات. التصعيد ينطلق على ثلاث مراحل (24/48/72h) من إعدادات النظام.
          </p>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-700">{error}</div>
          )}

          {escalations.length === 0 ? (
            <div className="rounded-md border border-dashed border-orange-300 bg-white/60 p-3 text-center text-xs text-orange-800">
              لا توجد زيارات بحاجة لتصعيد حالياً.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {escalations.map((item) => (
                <Link
                  key={item.visitId}
                  to={`/visits/${item.visitId}`}
                  className="block rounded-md bg-white border border-orange-200 p-2 hover:bg-orange-50/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-800 truncate">
                        {item.clientName || `زبون #${item.clientId}`}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        زيارة #{item.visitId} · {item.status}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        منذ {Math.round(item.hoursSinceUpdate)} ساعة
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-0.5">
                      {item.tiersAlerted.map((tier) => (
                        <span
                          key={tier}
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TIER_META[tier].bg} ${TIER_META[tier].color}`}
                        >
                          {TIER_META[tier].label}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
