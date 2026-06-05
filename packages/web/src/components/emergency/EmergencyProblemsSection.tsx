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
}

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
  problems: Problem[];
  derivedOutcome: { outcome: string; counts: Record<string, number>; total: number } | null;
  readOnly?: boolean;
  onChanged: () => void;
}

export default function EmergencyProblemsSection({
  taskId,
  serviceRequestId,
  installedDeviceId,
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
    setResolveRepairedBy('');
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

  const active = problems.filter((p) => p.status !== 'cancelled');

  return (
    <div className="bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-rose-200 rounded-lg p-4 mb-4" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Wrench className="h-5 w-5 text-rose-600" />
          لائحة الأعطال ({active.length})
        </h3>
        <div className="flex items-center gap-2">
          {derivedOutcome && (
            <span className="text-xs px-2 py-1 bg-white border border-gray-300 rounded font-medium text-gray-700">
              النتيجة المُحسوبة: <strong>{derivedOutcome.outcome}</strong>
            </span>
          )}
          {!readOnly && (
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="text-xs bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              عطل مُكتشَف
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2 rounded mb-2">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="bg-white border border-rose-200 rounded p-3 mb-3 space-y-2">
          <select
            value={newTypeId}
            onChange={(e) => setNewTypeId(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded p-1.5"
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
            className="w-full text-sm border border-gray-300 rounded p-1.5"
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={addNew}
              className="text-sm bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-1 rounded"
            >
              {busy ? 'جاري...' : 'حفظ كـ field_discovery'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white p-3 rounded text-center">
          لا توجد أعطال على هذه المهمة.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((p) => {
            const typeLabel = problemTypes.find((t) => t.id === p.problemTypeId)?.value ?? `#${p.problemTypeId}`;
            return (
              <li key={p.id} className="bg-white border border-gray-200 rounded p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                        {PHASE_LABELS[p.addedDuringPhase]}
                      </span>
                      {p.addedDuringPhase === 'field_discovery' && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          ميدانياً
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-gray-800">{typeLabel}</div>
                    {p.details && <p className="text-xs text-gray-600 mt-0.5">{p.details}</p>}
                    {p.resolvedAt && p.repairedByEmployeeId && (
                      <div className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        أَصلَحَه #{p.repairedByEmployeeId} — {new Date(p.resolvedAt).toLocaleDateString('ar-SY')}
                      </div>
                    )}
                  </div>
                  {!readOnly && p.status !== 'resolved' && p.status !== 'resolved_at_intake' && (
                    <div className="flex flex-col gap-1 items-end">
                      {(p.status === 'reported' || p.status === 'confirmed' || p.status === 'deferred') && (
                        <button
                          disabled={busy}
                          onClick={() => startResolve(p.id)}
                          className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-2 py-1 rounded flex items-center gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          حُلَّ
                        </button>
                      )}
                      {(p.status === 'reported' || p.status === 'confirmed') && (
                        <button
                          disabled={busy}
                          onClick={() => changeStatus(p.id, 'deferred')}
                          className="text-xs bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white px-2 py-1 rounded flex items-center gap-1"
                        >
                          <Clock className="h-3 w-3" />
                          تأجيل
                        </button>
                      )}
                      {(p.status === 'reported' || p.status === 'confirmed') && (
                        <button
                          disabled={busy}
                          onClick={() => changeStatus(p.id, 'unresolvable_field')}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 rounded flex items-center gap-1"
                        >
                          <XCircle className="h-3 w-3" />
                          غير قابل
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {resolving === p.id && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-1.5">
                    <select
                      value={resolveRepairedBy}
                      onChange={(e) => setResolveRepairedBy(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded p-1.5"
                    >
                      <option value="">— الفني الذي أَصلَح —</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={resolveNotes}
                      onChange={(e) => setResolveNotes(e.target.value)}
                      placeholder="ملاحظات الحلّ"
                      rows={2}
                      className="w-full text-sm border border-gray-300 rounded p-1.5"
                    />
                    <div className="flex gap-1.5">
                      <button
                        disabled={busy || !resolveRepairedBy}
                        onClick={() => confirmResolve(p.id)}
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1 rounded"
                      >
                        تَأكيد الحلّ
                      </button>
                      <button
                        onClick={() => setResolving(null)}
                        className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
