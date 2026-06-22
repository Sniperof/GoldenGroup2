import { useEffect, useState, useCallback } from 'react';
import {
  X, Loader2, ListPlus, AlertTriangle, FileText, Smartphone,
  Banknote, MapPin, Calendar, Flag, Tag, CheckCircle2,
} from 'lucide-react';
import { api } from '../../lib/api';

// DEC-010 — Visit Task Pull. Lists the customer's waiting-phase tasks (in the
// visit's branch) and pulls a chosen one into the in_progress visit.

type PullableTask = Awaited<ReturnType<typeof api.fieldVisits.pullableTasks>>[number];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open:            { label: 'مفتوحة',        cls: 'bg-slate-100 text-slate-600' },
  needs_follow_up: { label: 'بحاجة متابعة', cls: 'bg-amber-50 text-amber-700' },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high:   { label: 'عالية',   cls: 'bg-rose-50 text-rose-700' },
  medium: { label: 'متوسطة', cls: 'bg-sky-50 text-sky-700' },
  low:    { label: 'منخفضة', cls: 'bg-slate-100 text-slate-500' },
};

const ORIGIN_LABELS: Record<string, string> = {
  branch_plan:               'خطة الفرع',
  service_request_call:      'طلب خدمة',
  telemarketing_inline_booking: 'حجز تيليماركتر',
  cascading_during_visit:    'أثناء زيارة',
  manual_creation:           'إنشاء يدوي',
  emergency_request:         'طلب طارئ',
  system_trigger:            'النظام',
};

function fmtDate(ts: string | null | undefined) {
  if (!ts) return null;
  try { return new Date(ts).toLocaleDateString('ar-SY', { numberingSystem: 'latn' }); }
  catch { return ts; }
}

function fmtAmount(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('ar-SY', { numberingSystem: 'latn' })} ل.س`;
}

export default function PullTaskModal({
  visitId, open, onClose, onPulled,
}: {
  visitId: number;
  open: boolean;
  onClose: () => void;
  onPulled: () => void;
}) {
  const [tasks, setTasks] = useState<PullableTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pullingId, setPullingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.fieldVisits.pullableTasks(visitId);
      setTasks(data);
    } catch (err: any) {
      setError(err?.message ?? 'تعذّر جلب المهام القابلة للسحب');
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  if (!open) return null;

  const handlePull = async (t: PullableTask) => {
    setPullingId(t.openTaskId);
    try {
      await api.fieldVisits.addTask(visitId, { taskType: t.taskType, openTaskId: t.openTaskId });
      onPulled();
    } catch (err: any) {
      alert(err?.message ?? 'فشل سحب المهمة');
    } finally {
      setPullingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <ListPlus className="w-5 h-5 text-indigo-600" />
          <h2 className="text-sm font-bold text-slate-800">سحب مهمة للزيارة</h2>
          <span className="text-xs text-slate-400">مهام الزبون قيد الانتظار في هذا الفرع</span>
          <button onClick={onClose} className="mr-auto text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto custom-scroll">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-2 py-8 text-rose-600">
              <AlertTriangle className="w-8 h-8" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && tasks.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <p className="text-sm">لا توجد مهام قيد الانتظار لهذا الزبون في هذا الفرع.</p>
            </div>
          )}

          <div className="space-y-3">
            {tasks.map((t) => {
              const st = STATUS_META[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-500' };
              const pr = t.priority ? PRIORITY_META[t.priority] : null;
              const amount = fmtAmount(t.installmentRemaining ?? t.installmentAmount ?? t.expectedAmount);
              return (
                <div key={t.openTaskId} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">{t.arabicLabel ?? t.taskType}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {t.taskFamily === 'marketing' ? 'تسويق' : 'خدمة'}
                        {t.reason && <span className="text-slate-400"> · {t.reason}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      {pr && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${pr.cls}`}>{pr.label}</span>}
                    </div>
                  </div>

                  {/* Context chips */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                    {t.contractNumber && (
                      <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        <FileText className="w-3 h-3 text-slate-400" /> عقد {t.contractNumber}
                      </span>
                    )}
                    {t.deviceModelName && (
                      <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded text-blue-700">
                        <Smartphone className="w-3 h-3" /> {t.deviceModelName}
                      </span>
                    )}
                    {t.installmentNumber != null && (
                      <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        قسط #{t.installmentNumber}
                      </span>
                    )}
                    {amount && (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded text-emerald-700">
                        <Banknote className="w-3 h-3" /> {amount}
                      </span>
                    )}
                    {t.receivableLabel && !t.contractNumber && (
                      <span className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">
                        {t.receivableLabel}
                      </span>
                    )}
                    {t.taskAddress && (
                      <span className="inline-flex items-center gap-1 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded text-rose-700">
                        <MapPin className="w-3 h-3" /> {t.taskAddress}
                      </span>
                    )}
                  </div>

                  {/* Meta + action */}
                  <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> أُنشئت {fmtDate(t.createdAt)}
                      </span>
                      {t.expectedDate && (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Flag className="w-3 h-3" /> متوقعة {fmtDate(t.expectedDate)}{t.expectedTime ? ` ${t.expectedTime}` : ''}
                        </span>
                      )}
                      {t.creationOrigin && (
                        <span className="inline-flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {ORIGIN_LABELS[t.creationOrigin] ?? t.creationOrigin}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handlePull(t)}
                      disabled={pullingId === t.openTaskId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 disabled:opacity-60 transition-colors">
                      {pullingId === t.openTaskId
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <ListPlus className="w-3.5 h-3.5" />}
                      سحب
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
