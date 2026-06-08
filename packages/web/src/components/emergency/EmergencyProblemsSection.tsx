// ============================================================
// EmergencyProblemsSection — Phase 6c.1
// Shown above MaintenanceActionsForm when the open_task came from
// a service_request (taskMeta.sourceServiceRequestId != null).
//
// Constitution: maintenance.md §٠.١٩ + §٠.١٩.ط (Field Discovery)
//
// Behavior:
//   - Lists the problems linked to this open_task.
//   - Lets the technician change status (resolved / deferred /
//     unresolvable_field) with repaired_by + visit_task_id fields.
//   - "Add discovered problem" → POST /service-requests/:srid/problems
//     with addedDuringPhase='field_discovery' then stamps open_task_id
//     via the hybrid /:taskId/actions endpoint (handled server-side).
//
// Saves are immediate per-action (matches ProblemsList.tsx UX in the
// detail page). The wizard's own Save (action meta) stays unchanged.
// ============================================================
import { useEffect, useState } from 'react';
import { Plus, Wrench, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';

interface Problem {
  id: number;
  serviceRequestId: number;
  openTaskId: number | null;
  installedDeviceId: number;
  problemTypeId: number;
  details: string | null;
  status: string;
  addedDuringPhase: string;
  resolvedAt: string | null;
  repairedByEmployeeId: number | null;
  resolutionVisitTaskId: number | null;
  resolutionNotes: string | null;
  noResolveReason?: string | null;
}

const NO_RESOLVE_REASONS: { value: string; label: string }[] = [
  { value: 'awaiting_parts', label: 'بانتظار قطعة' },
  { value: 'customer_busy',  label: 'الزبون مَشغول' },
  { value: 'needs_lab',      label: 'يَحتاج وَرشة' },
  { value: 'other',          label: 'أخرى' },
];
const NO_RESOLVE_REASON_LABEL: Record<string, string> = Object.fromEntries(
  NO_RESOLVE_REASONS.map((r) => [r.value, r.label]),
);

interface ProblemType {
  id: number;
  value: string;
}

interface Employee {
  id: number;
  name: string;
}

const STATUS_LABELS: Record<string, string> = {
  reported: 'مُبلَّغ',
  confirmed: 'مؤكَّد',
  resolved_at_intake: 'محلول في الاستلام',
  resolved: 'محلول',
  deferred: 'مؤجَّل',
  unresolvable_field: 'غير قابل للحلّ ميدانياً',
  cancelled: 'مُلغى',
};

const STATUS_COLORS: Record<string, string> = {
  reported: 'bg-gray-100 text-gray-700 border-gray-300',
  confirmed: 'bg-blue-100 text-blue-700 border-blue-300',
  resolved_at_intake: 'bg-green-100 text-green-700 border-green-300',
  resolved: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  deferred: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  unresolvable_field: 'bg-red-100 text-red-700 border-red-300',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const PHASE_LABELS: Record<string, string> = {
  intake: 'الاستلام',
  in_review: 'المراجعة',
  technical_consultation: 'استشارة فنّية',
  field_discovery: 'مُكتشَف ميدانياً',
};

export interface EmergencyProblemsSectionProps {
  taskId: number;
  serviceRequestId: number;
  installedDeviceId: number | null;
  /** Default technician (from team_snapshot) — auto-fills repaired_by. */
  defaultTechnicianEmployeeId?: number | null;
  defaultTechnicianName?: string | null;
  problems: Problem[];
  derivedOutcome: { outcome: string; counts: Record<string, number>; total: number } | null;
  readOnly?: boolean;
  onChanged: () => void;
}

export default function EmergencyProblemsSection({
  taskId,
  serviceRequestId,
  installedDeviceId,
  defaultTechnicianEmployeeId = null,
  defaultTechnicianName = null,
  problems,
  derivedOutcome,
  readOnly = false,
  onChanged,
}: EmergencyProblemsSectionProps) {
  const [problemTypes, setProblemTypes] = useState<ProblemType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTypeId, setNewTypeId] = useState('');
  const [newDetails, setNewDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<number | null>(null);
  const [resolveRepairedBy, setResolveRepairedBy] = useState<string>('');
  const [resolveNotes, setResolveNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // #2 — defer / unresolvable_field inline reason prompt
  const [deferring, setDeferring] = useState<{ pid: number; to: 'deferred' | 'unresolvable_field' } | null>(null);
  const [deferReason, setDeferReason] = useState<string>('');

  useEffect(() => {
    fetch('/api/system-lists?category=diagnosis_problem_types', {
      headers: { Authorization: `Bearer ${localStorage.getItem('hr_token') ?? ''}` },
    })
      .then((r) => r.json())
      .then((rows) => setProblemTypes(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    fetch('/api/employees', {
      headers: { Authorization: `Bearer ${localStorage.getItem('hr_token') ?? ''}` },
    })
      .then((r) => r.json())
      .then((rows) => setEmployees(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  async function addNew() {
    if (!installedDeviceId) {
      setError('يَلزم installed_device_id على المهمة');
      return;
    }
    if (!newTypeId) {
      setError('اختر نوع العطل');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // POST through service_requests (writes to service_request_problems
      // with phase=field_discovery). The endpoint will stamp open_task_id
      // automatically since the request is linked.
      // Pass openTaskId so the backend stamps it immediately
      // (Phase 6c.1 — added to /service-requests/:id/problems route).
      await api.serviceRequests.addProblem(serviceRequestId, {
        installedDeviceId,
        problemTypeId: Number(newTypeId),
        details: newDetails || null,
        addedDuringPhase: 'field_discovery',
        creatorRoleSnapshot: 'technician',
        openTaskId: taskId,
      });
      setShowAdd(false);
      setNewTypeId('');
      setNewDetails('');
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل إضافة العطل');
    } finally {
      setBusy(false);
    }
  }

  async function startResolve(pid: number) {
    setResolving(pid);
    // Auto-fill from team_snapshot — one technician per team (per visit rules).
    setResolveRepairedBy(defaultTechnicianEmployeeId ? String(defaultTechnicianEmployeeId) : '');
    setResolveNotes('');
  }

  async function confirmResolve(pid: number) {
    if (!resolveRepairedBy) {
      setError('اختر الفني الذي أَصلَح');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.serviceRequests.recordProblemResolution(serviceRequestId, pid, {
        repairedByEmployeeId: Number(resolveRepairedBy),
        resolutionNotes: resolveNotes || null,
      });
      setResolving(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل تَسجيل الحلّ');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(pid: number, toStatus: string) {
    if (!confirm(`نَقل العطل إلى "${STATUS_LABELS[toStatus]}"؟`)) return;
    setBusy(true);
    try {
      await api.serviceRequests.setProblemStatus(serviceRequestId, pid, { toStatus });
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل تَغيير الحالة');
    } finally {
      setBusy(false);
    }
  }

  function startDefer(pid: number, to: 'deferred' | 'unresolvable_field') {
    setDeferring({ pid, to });
    setDeferReason('');
    setError(null);
  }

  async function confirmDefer() {
    if (!deferring) return;
    if (!deferReason) { setError('اختر السَّبب'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.serviceRequests.setProblemStatus(serviceRequestId, deferring.pid, {
        toStatus: deferring.to,
        noResolveReason: deferReason,
      });
      setDeferring(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل تَغيير الحالة');
    } finally {
      setBusy(false);
    }
  }

  const active = problems.filter((p) => p.status !== 'cancelled');
  const resolvedCount = active.filter((p) => p.status === 'resolved' || p.status === 'resolved_at_intake').length;
  const totalCount = active.length;
  const pct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;
  const useTable = totalCount > 3; // #4 — auto-switch to table for many rows

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm mb-4" dir="rtl">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-rose-600" />
          <h3 className="font-bold text-slate-800 text-sm">إجراء الصيانة</h3>
          <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5">
            {active.length} {active.length === 1 ? 'عطل' : 'أعطال'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* #6 — Goal indicator chip */}
          {totalCount > 0 && (
            <span className={`text-[10px] font-bold rounded-full border px-2.5 py-0.5 ${
              resolvedCount === totalCount ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : pct >= 50 ? 'bg-sky-50 text-sky-700 border-sky-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {resolvedCount}/{totalCount} محلولة ({pct}%)
            </span>
          )}
          {derivedOutcome && (
            <span className="text-[10px] font-bold text-slate-700 bg-white border border-slate-200 rounded-full px-2.5 py-0.5">
              المحصلة: <strong className="text-rose-700">{derivedOutcome.outcome}</strong>
            </span>
          )}
          {!readOnly && (
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 border border-rose-200 rounded-xl px-3 py-1.5 hover:bg-rose-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> عطل مُكتشَف ميدانياً
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded">{error}</div>
        )}

        {/* Add new (field_discovery) */}
        {showAdd && (
          <div className="bg-rose-50/40 border border-rose-200 rounded-xl p-3 space-y-2">
            <div className="text-xs font-bold text-rose-700 mb-1">إضافة عطل مكتشَف ميدانياً</div>
            <select
              value={newTypeId}
              onChange={(e) => setNewTypeId(e.target.value)}
              className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white"
            >
              <option value="">— نوع العطل —</option>
              {problemTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.value}
                </option>
              ))}
            </select>
            <textarea
              value={newDetails}
              onChange={(e) => setNewDetails(e.target.value)}
              placeholder="تفاصيل (اختياري)"
              rows={2}
              className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white resize-none"
            />
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={addNew}
                className="text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-bold"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ'}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1.5 rounded-lg font-bold"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        {/* Problems list */}
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
            <Wrench className="h-8 w-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">لا توجد أعطال على هذه المهمة</p>
            <p className="text-xs text-slate-300 mt-1">يُمكن إضافة عطل مُكتشَف من الزر أعلاه</p>
          </div>
        ) : useTable ? (
          <ProblemsTable
            active={active}
            problemTypes={problemTypes}
            employees={employees}
            readOnly={readOnly}
            busy={busy}
            resolving={resolving}
            deferring={deferring}
            defaultTechnicianName={defaultTechnicianName}
            resolveRepairedBy={resolveRepairedBy}
            setResolveRepairedBy={setResolveRepairedBy}
            resolveNotes={resolveNotes}
            setResolveNotes={setResolveNotes}
            deferReason={deferReason}
            setDeferReason={setDeferReason}
            startResolve={startResolve}
            confirmResolve={confirmResolve}
            setResolving={setResolving}
            startDefer={startDefer}
            confirmDefer={confirmDefer}
            setDeferring={setDeferring}
          />
        ) : (
          <ul className="space-y-2">
            {active.map((p) => {
              const typeLabel = problemTypes.find((t) => t.id === p.problemTypeId)?.value ?? `#${p.problemTypeId}`;
              const isResolved = p.status === 'resolved' || p.status === 'resolved_at_intake';
              const isFieldDiscovery = p.addedDuringPhase === 'field_discovery';
              const empName = employees.find((e) => e.id === p.repairedByEmployeeId)?.name;
              return (
                <li
                  key={p.id}
                  className={`border rounded-xl overflow-hidden ${
                    isResolved
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  {/* Card body */}
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Title row */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400">#{p.id}</span>
                          <span className="text-sm font-bold text-slate-800">{typeLabel}</span>
                          <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${STATUS_COLORS[p.status]}`}>
                            {STATUS_LABELS[p.status]}
                          </span>
                          {isFieldDiscovery && (
                            <span className="text-[10px] font-bold rounded-full border px-2 py-0.5 bg-violet-50 text-violet-700 border-violet-200 inline-flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> ميدانياً
                            </span>
                          )}
                          {!isFieldDiscovery && PHASE_LABELS[p.addedDuringPhase] && (
                            <span className="text-[10px] font-bold rounded-full border px-2 py-0.5 bg-slate-100 text-slate-600 border-slate-200">
                              من {PHASE_LABELS[p.addedDuringPhase]}
                            </span>
                          )}
                        </div>

                        {/* Details */}
                        {p.details && (
                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {p.details}
                          </p>
                        )}

                        {/* Resolution metadata */}
                        {isResolved && (p.resolvedAt || empName) && (
                          <div className="mt-2 pt-2 border-t border-emerald-100 text-xs text-emerald-700 flex items-center gap-3 flex-wrap">
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {empName ? `أَصلَحَه: ${empName}` : `الفني #${p.repairedByEmployeeId}`}
                            </span>
                            {p.resolvedAt && (
                              <span className="text-slate-500">
                                {new Date(p.resolvedAt).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            )}
                            {p.resolutionNotes && (
                              <span className="text-slate-600">— {p.resolutionNotes}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      {!readOnly && !isResolved && (
                        <div className="flex flex-col gap-1 items-stretch shrink-0">
                          {(p.status === 'reported' || p.status === 'confirmed' || p.status === 'deferred') && (
                            <button
                              disabled={busy}
                              onClick={() => startResolve(p.id)}
                              className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" /> حُلَّ
                            </button>
                          )}
                          {(p.status === 'reported' || p.status === 'confirmed') && (
                            <button
                              disabled={busy}
                              onClick={() => startDefer(p.id, 'deferred')}
                              className="text-xs border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1"
                            >
                              <Clock className="h-3 w-3" /> تأجيل
                            </button>
                          )}
                          {(p.status === 'reported' || p.status === 'confirmed') && (
                            <button
                              disabled={busy}
                              onClick={() => startDefer(p.id, 'unresolvable_field')}
                              className="text-xs border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1"
                            >
                              <XCircle className="h-3 w-3" /> غير قابل
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* #2 — Defer / unresolvable_field reason prompt */}
                    {deferring?.pid === p.id && (
                      <div className="mt-3 pt-3 border-t border-slate-200 bg-amber-50/30 -mx-3.5 -mb-3.5 px-3.5 py-3 space-y-2">
                        <div className="text-xs font-bold text-amber-700">
                          {deferring.to === 'deferred' ? 'سَبب التَأجيل' : 'سَبب عَدم القَابلية ميدانياً'}
                        </div>
                        <select
                          value={deferReason}
                          onChange={(e) => setDeferReason(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="">— اختر السبب —</option>
                          {NO_RESOLVE_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            disabled={busy || !deferReason}
                            onClick={confirmDefer}
                            className="text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-bold"
                          >
                            تأكيد
                          </button>
                          <button
                            onClick={() => setDeferring(null)}
                            className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1.5 rounded-lg font-bold"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Saved no_resolve_reason badge */}
                    {(p.status === 'deferred' || p.status === 'unresolvable_field') && p.noResolveReason && (
                      <div className="mt-2 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
                        السَّبب: {NO_RESOLVE_REASON_LABEL[p.noResolveReason] ?? p.noResolveReason}
                      </div>
                    )}

                    {/* Resolve form (inline) */}
                    {resolving === p.id && (
                      <div className="mt-3 pt-3 border-t border-slate-200 bg-emerald-50/30 -mx-3.5 -mb-3.5 px-3.5 py-3 space-y-2">
                        <div className="text-xs font-bold text-emerald-700">تسجيل حلّ العطل</div>
                        <div className="space-y-1">
                          <label className="text-xs text-slate-500 flex items-center gap-1">
                            الفني الذي أَصلَح
                            {defaultTechnicianName && (
                              <span className="text-[10px] text-emerald-700 font-bold">
                                (افتراضي من الفريق: {defaultTechnicianName})
                              </span>
                            )}
                          </label>
                          <select
                            value={resolveRepairedBy}
                            onChange={(e) => setResolveRepairedBy(e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white"
                          >
                            <option value="">— اختر —</option>
                            {employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <textarea
                          value={resolveNotes}
                          onChange={(e) => setResolveNotes(e.target.value)}
                          placeholder="ملاحظات الحلّ (اختياري)"
                          rows={2}
                          className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busy || !resolveRepairedBy}
                            onClick={() => confirmResolve(p.id)}
                            className="text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg font-bold"
                          >
                            تأكيد الحلّ
                          </button>
                          <button
                            onClick={() => setResolving(null)}
                            className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-1.5 rounded-lg font-bold"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── #4 — Compact table mode for >3 problems ───────────────────────
interface ProblemsTableProps {
  active: Problem[];
  problemTypes: ProblemType[];
  employees: Employee[];
  readOnly: boolean;
  busy: boolean;
  resolving: number | null;
  deferring: { pid: number; to: 'deferred' | 'unresolvable_field' } | null;
  defaultTechnicianName: string | null;
  resolveRepairedBy: string;
  setResolveRepairedBy: (v: string) => void;
  resolveNotes: string;
  setResolveNotes: (v: string) => void;
  deferReason: string;
  setDeferReason: (v: string) => void;
  startResolve: (pid: number) => void;
  confirmResolve: (pid: number) => void;
  setResolving: (v: number | null) => void;
  startDefer: (pid: number, to: 'deferred' | 'unresolvable_field') => void;
  confirmDefer: () => void;
  setDeferring: (v: any) => void;
}

function ProblemsTable(props: ProblemsTableProps) {
  const {
    active, problemTypes, employees, readOnly, busy,
    resolving, deferring, defaultTechnicianName,
    resolveRepairedBy, setResolveRepairedBy, resolveNotes, setResolveNotes,
    deferReason, setDeferReason,
    startResolve, confirmResolve, setResolving,
    startDefer, confirmDefer, setDeferring,
  } = props;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full text-right border-separate border-spacing-0 text-sm">
        <thead className="bg-slate-50">
          <tr className="text-xs font-bold text-slate-500">
            <th className="px-3 py-2 border-b border-slate-200">#</th>
            <th className="px-3 py-2 border-b border-slate-200">العطل</th>
            <th className="px-3 py-2 border-b border-slate-200">الحالة</th>
            <th className="px-3 py-2 border-b border-slate-200">بواسطة</th>
            <th className="px-3 py-2 border-b border-slate-200">السَّبب</th>
            <th className="px-3 py-2 border-b border-slate-200 text-center">إجراء</th>
          </tr>
        </thead>
        <tbody>
          {active.map((p) => {
            const typeLabel = problemTypes.find((t) => t.id === p.problemTypeId)?.value ?? `#${p.problemTypeId}`;
            const isResolved = p.status === 'resolved' || p.status === 'resolved_at_intake';
            const empName = employees.find((e) => e.id === p.repairedByEmployeeId)?.name;
            const isEditingResolve = resolving === p.id;
            const isEditingDefer = deferring?.pid === p.id;
            const sCls = STATUS_COLORS[p.status] ?? '';
            return (
              <FragmentRow key={p.id}>
                <tr className={`text-sm text-slate-700 ${isResolved ? 'bg-emerald-50/30' : ''}`}>
                  <td className="px-3 py-2 border-b border-slate-100 font-mono text-xs text-slate-400">#{p.id}</td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <div className="font-bold text-slate-800">{typeLabel}</div>
                    {p.details && <div className="text-xs text-slate-500 line-clamp-1">{p.details}</div>}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${sCls}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-xs">
                    {empName ? <span className="font-semibold text-emerald-700">{empName}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-xs">
                    {(p.status === 'deferred' || p.status === 'unresolvable_field') && p.noResolveReason
                      ? <span className="font-semibold text-amber-700">{NO_RESOLVE_REASON_LABEL[p.noResolveReason] ?? p.noResolveReason}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-center">
                    {!readOnly && !isResolved && (
                      <div className="flex gap-1 justify-center flex-wrap">
                        {(p.status === 'reported' || p.status === 'confirmed' || p.status === 'deferred') && (
                          <button onClick={() => startResolve(p.id)} disabled={busy}
                            className="text-[10px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-2 py-1 rounded font-bold">
                            حُلَّ
                          </button>
                        )}
                        {(p.status === 'reported' || p.status === 'confirmed') && (
                          <button onClick={() => startDefer(p.id, 'deferred')} disabled={busy}
                            className="text-[10px] border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 px-2 py-1 rounded font-bold">
                            تأجيل
                          </button>
                        )}
                        {(p.status === 'reported' || p.status === 'confirmed') && (
                          <button onClick={() => startDefer(p.id, 'unresolvable_field')} disabled={busy}
                            className="text-[10px] border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-2 py-1 rounded font-bold">
                            غير قابل
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>

                {isEditingResolve && (
                  <tr><td colSpan={6} className="p-3 bg-emerald-50/40 border-b border-emerald-200">
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-emerald-700">تَسجيل حلّ العطل #{p.id}</div>
                      <div className="flex gap-2 flex-wrap">
                        <select value={resolveRepairedBy} onChange={(e) => setResolveRepairedBy(e.target.value)}
                          className="flex-1 min-w-[200px] text-sm border border-slate-300 rounded-lg p-2 bg-white">
                          <option value="">— الفني {defaultTechnicianName ? `(افتراضي: ${defaultTechnicianName})` : ''} —</option>
                          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <input type="text" value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)}
                          placeholder="ملاحظات (اختياري)"
                          className="flex-[2] min-w-[200px] text-sm border border-slate-300 rounded-lg p-2 bg-white" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => confirmResolve(p.id)} disabled={busy || !resolveRepairedBy}
                          className="text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-bold">
                          تأكيد الحلّ
                        </button>
                        <button onClick={() => setResolving(null)}
                          className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg font-bold">
                          إلغاء
                        </button>
                      </div>
                    </div>
                  </td></tr>
                )}

                {isEditingDefer && (
                  <tr><td colSpan={6} className="p-3 bg-amber-50/40 border-b border-amber-200">
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-amber-700">
                        {deferring!.to === 'deferred' ? 'سَبب التَأجيل' : 'سَبب عَدم القَابلية ميدانياً'} للعطل #{p.id}
                      </div>
                      <select value={deferReason} onChange={(e) => setDeferReason(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg p-2 bg-white">
                        <option value="">— اختر السبب —</option>
                        {NO_RESOLVE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button onClick={confirmDefer} disabled={busy || !deferReason}
                          className="text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-bold">
                          تأكيد
                        </button>
                        <button onClick={() => setDeferring(null)}
                          className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg font-bold">
                          إلغاء
                        </button>
                      </div>
                    </div>
                  </td></tr>
                )}
              </FragmentRow>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// React.Fragment with key prop — used to group <tr> rows
function FragmentRow({ children }: { children: any }) {
  return <>{children}</>;
}
