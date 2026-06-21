// ============================================================
// ProblemsList — diagnosed problems for a service_request
// Constitution: maintenance.md §٠.١٩ (لائحة الأعطال)
// ============================================================
import { useEffect, useState } from 'react';
import { Plus, Wrench, Trash2, CheckCircle2, AlertCircle, Edit2, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../ui/Select';

interface Problem {
  id: number;
  installedDeviceId: number;
  problemTypeId: number;
  details: string | null;
  status: string;
  addedDuringPhase: string;
  creatorRoleSnapshot: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionRecordedByUserId: number | null;
  repairedByEmployeeId: number | null;
  resolutionVisitTaskId: number | null;
  deletedAt: string | null;
}

interface ProblemType {
  id: number;
  value: string;
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
  reported: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  resolved_at_intake: 'bg-green-100 text-green-700',
  resolved: 'bg-green-100 text-green-700',
  deferred: 'bg-yellow-100 text-yellow-700',
  unresolvable_field: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

const PHASE_LABELS: Record<string, string> = {
  intake: 'الاستلام',
  in_review: 'المراجعة',
  technical_consultation: 'استشارة فنّية',
  field_discovery: 'مُكتشَف ميدانياً',
};

export default function ProblemsList({
  serviceRequestId,
  installedDeviceId,
  problems,
  canEdit,
  onRefresh,
}: {
  serviceRequestId: number;
  installedDeviceId: number | null;
  problems: Problem[];
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [problemTypes, setProblemTypes] = useState<ProblemType[]>([]);
  const [newType, setNewType] = useState('');
  const [newDetails, setNewDetails] = useState('');
  const [newPhase, setNewPhase] = useState<'intake' | 'in_review' | 'technical_consultation' | 'field_discovery'>('in_review');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/system-lists?category=diagnosis_problem_types', {
      headers: { Authorization: `Bearer ${localStorage.getItem('hr_token') ?? ''}` },
    })
      .then((r) => r.json())
      .then((rows) => setProblemTypes(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  async function addNew() {
    if (!newType || !installedDeviceId) {
      setError(!installedDeviceId ? 'يَلزم ربط جهاز قبل إضافة عطل' : 'اختر نوع العطل');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.serviceRequests.addProblem(serviceRequestId, {
        installedDeviceId,
        problemTypeId: Number(newType),
        details: newDetails || null,
        addedDuringPhase: newPhase,
        creatorRoleSnapshot: 'operator',
      });
      setShowAdd(false);
      setNewType('');
      setNewDetails('');
      onRefresh();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل إضافة العطل');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(pid: number, toStatus: string) {
    if (!confirm(`نَقل العطل إلى "${STATUS_LABELS[toStatus]}"؟`)) return;
    try {
      await api.serviceRequests.setProblemStatus(serviceRequestId, pid, { toStatus });
      onRefresh();
    } catch (e: any) {
      alert(e?.message ?? 'فَشل تَغيير الحالة');
    }
  }

  async function softDelete(pid: number) {
    const reason = prompt('سبب الحذف:');
    if (!reason) return;
    try {
      await api.serviceRequests.deleteProblem(serviceRequestId, pid, reason);
      onRefresh();
    } catch (e: any) {
      alert(e?.message ?? 'فَشل الحذف');
    }
  }

  const active = problems.filter((p) => p.deletedAt == null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          لائحة الأعطال ({active.length})
        </h3>
        {canEdit && (
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            إضافة عطل
          </button>
        )}
      </div>

      {showAdd && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 space-y-2">
          {error && <div className="text-xs text-red-700 bg-red-50 p-1.5 rounded">{error}</div>}
          <Select
            value={newType}
            onChange={setNewType}
            placeholder="— نوع العطل —"
            ariaLabel="نوع العطل"
            className="w-full"
            options={problemTypes.map(t => ({ value: String(t.id), label: t.value }))}
          />
          <textarea
            value={newDetails}
            onChange={(e) => setNewDetails(e.target.value)}
            placeholder="تفاصيل (اختياري)"
            rows={2}
            className="w-full text-sm border border-gray-300 rounded p-2"
          />
          <Select<'intake' | 'in_review' | 'technical_consultation' | 'field_discovery'>
            value={newPhase}
            onChange={setNewPhase}
            ariaLabel="مرحلة الإضافة"
            className="w-full"
            options={[
              { value: 'intake', label: PHASE_LABELS.intake },
              { value: 'in_review', label: PHASE_LABELS.in_review },
              { value: 'technical_consultation', label: PHASE_LABELS.technical_consultation },
              { value: 'field_discovery', label: PHASE_LABELS.field_discovery },
            ]}
          />
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={addNew}
              className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"
            >
              {busy ? 'جاري...' : 'حفظ'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 p-3 rounded">
          لا توجد أعطال مُسجَّلة بعد.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((p) => (
            <li key={p.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                    {PHASE_LABELS[p.addedDuringPhase] ?? p.addedDuringPhase}
                  </span>
                  {p.addedDuringPhase === 'field_discovery' && (
                    <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      مُكتشَف ميدانياً
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">#{p.id}</span>
              </div>
              <div className="text-sm text-gray-700">
                <strong>نوع #{p.problemTypeId}</strong>
                {p.details && <p className="text-xs text-gray-600 mt-1">{p.details}</p>}
              </div>
              {p.resolvedAt && (
                <div className="text-xs text-green-700 mt-1.5">
                  ✓ حُلَّ {new Date(p.resolvedAt).toLocaleDateString('ar-SY')}
                  {p.repairedByEmployeeId && ` — أصلحه #${p.repairedByEmployeeId}`}
                </div>
              )}
              {canEdit && p.status !== 'resolved' && p.status !== 'cancelled' && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {p.status === 'reported' && (
                    <button
                      onClick={() => changeStatus(p.id, 'confirmed')}
                      className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded"
                    >
                      تأكيد
                    </button>
                  )}
                  {p.status === 'reported' && (
                    <button
                      onClick={() => changeStatus(p.id, 'resolved_at_intake')}
                      className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1 rounded flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      حُلَّ هاتفياً
                    </button>
                  )}
                  <button
                    onClick={() => softDelete(p.id)}
                    className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" />
                    حذف
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
