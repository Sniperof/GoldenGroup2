import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, MapPin, Phone, Users2, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * "زياراتي" — the field member's own (team-assigned) visits for a day. A focused,
 * personal surface distinct from the management Visits page (which moved to a
 * single-branch admin view, §6). Gated by field_visits.my_visits.view (ASSIGNED);
 * the server scopes rows to visits whose team includes the holder.
 */

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: 'مجدولة', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  in_progress: { label: 'قيد التنفيذ', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ended: { label: 'منتهية', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  completed: { label: 'مكتملة', cls: 'bg-green-50 text-green-700 border-green-100' },
  not_completed: { label: 'غير مكتملة', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  cancelled: { label: 'ملغاة', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

interface MyVisitRow {
  id: number;
  visitType: string;
  status: string;
  scheduledDate: string;
  scheduledTime: string | null;
  clientId: number;
  clientName: string | null;
  clientMobile: string | null;
  addressShort: string | null;
  supervisorName: string | null;
  technicianName: string | null;
  traineeName: string | null;
  taskCount: number;
}

export default function MyVisitsPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<MyVisitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await api.fieldVisits.myVisits({ date }) as MyVisitRow[]);
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل زياراتي');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const teamName = (r: MyVisitRow) =>
    r.supervisorName ? `فريق ${r.supervisorName}` : r.technicianName ? `فريق ${r.technicianName}` : '—';

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500 shadow-lg shadow-teal-500/20 flex items-center justify-center">
            <CalendarCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl mb-1 font-bold text-slate-800">زياراتي</h1>
            <p className="text-sm text-slate-500">زيارات الفريق الذي أنت جزء منه ليوم محدد</p>
          </div>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-slate-500">
          <CalendarCheck className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>لا توجد زيارات لك في هذا اليوم</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((r) => {
            const st = STATUS_LABELS[r.status] ?? { label: r.status, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/field-visits/${r.id}`)}
                className="text-right bg-white rounded-xl border border-slate-200 shadow-sm hover:border-teal-300 hover:shadow transition-all p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-slate-800">{r.clientName || '—'}</span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${st.cls}`}>{st.label}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500">
                  <span className="font-mono text-slate-600">{r.scheduledTime?.slice(0, 5) ?? '—'}</span>
                  {r.clientMobile && (
                    <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{r.clientMobile}</span>
                  )}
                  {r.addressShort && (
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{r.addressShort}</span>
                  )}
                  <span className="flex items-center gap-1"><Users2 className="w-3.5 h-3.5" />{teamName(r)}</span>
                  <span className="text-xs">{r.taskCount} مهمة</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
