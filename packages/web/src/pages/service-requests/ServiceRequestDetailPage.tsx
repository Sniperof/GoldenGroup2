// ============================================================
// ServiceRequestDetailPage — central detail/action view
// Constitution: maintenance.md §٠.٣ + §٠.٤ + §٠.١٦ + §٠.١٧ + §٠.١٩
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpCircle,
  ClipboardCheck,
  Clock,
  Hash,
  Loader2,
  MapPin,
  Phone,
  UserCheck,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import ProblemsList from '../../components/service-requests/ProblemsList';
import SuggestedMatchesPanel from '../../components/service-requests/SuggestedMatchesPanel';
import AuditLogTimeline from '../../components/service-requests/AuditLogTimeline';
import MergeOrSplitModal from '../../components/service-requests/MergeOrSplitModal';
import TerminalTransitionModal, { type ModalMode } from '../../components/service-requests/TerminalTransitionModal';

const STATUS_LABELS: Record<string, string> = {
  received: 'مُستلَم',
  in_review: 'قيد المراجعة',
  awaiting_customer_info: 'بانتظار الزبون',
  resolved_at_intake: 'محلول في الاستلام',
  rejected: 'مرفوض',
  promoted: 'مُرَقّى',
  cancelled: 'مُلغى',
};

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-gray-100 text-gray-700',
  in_review: 'bg-blue-100 text-blue-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
  resolved_at_intake: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  promoted: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

type Tab = 'overview' | 'problems' | 'audit' | 'linkage';

export default function ServiceRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ request: any; auditLog: any[]; problems: any[] } | null>(null);
  const [collision, setCollision] = useState<{ existingOpenTaskId: number; installedDeviceId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 4 polish — modal for the 4 in_review actions + inline toast
  const [actionModal, setActionModal] = useState<ModalMode | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.serviceRequests.get(requestId);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const req = data.request;
  const isOwner = req.reviewedByUserId === user?.id;
  const canReview = hasPermission('service_requests.review');
  const canReject = hasPermission('service_requests.reject');
  const canPromote = hasPermission('service_requests.promote');
  const canArchive = hasPermission('service_requests.archive');
  const isActive = ['received', 'in_review', 'awaiting_customer_info'].includes(req.status);
  const isTerminal = !isActive;

  // V1.0 promote pre-conditions (maintenance-v1.md §١٢)
  const activeProblems = data.problems.filter((p) => p.deletedAt == null);
  const promoteMissing: string[] = [];
  if (!req.beneficiaryClientId) promoteMissing.push('ربط زبون');
  if (!req.installedDeviceId) promoteMissing.push('ربط جهاز');
  if (activeProblems.length === 0) promoteMissing.push('عطل واحد على الأقل في اللائحة');
  const canDoPromote = promoteMissing.length === 0;

  function showToast(message: string, kind: 'success' | 'error' = 'success') {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 4000);
  }

  async function safeRun(fn: () => Promise<any>, success?: string) {
    setBusy(true);
    try {
      await fn();
      if (success) showToast(success, 'success');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? 'فَشل العملية', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleModalConfirm(payload: any) {
    if (!actionModal) return;
    switch (actionModal) {
      case 'requestInfo':
        await api.serviceRequests.requestInfo(requestId, payload);
        showToast('✓ تَمَّ نَقل الطلب إلى "بانتظار الزبون"', 'success');
        break;
      case 'resolveAtIntake':
        await api.serviceRequests.resolveAtIntake(requestId, payload);
        showToast('✓ تَمَّ إغلاق الطلب بـ "حُلَّ في الاستلام"', 'success');
        break;
      case 'escalate':
        await api.serviceRequests.escalate(requestId, payload.note);
        showToast('✓ تَمَّ التَصعيد — المدقّق يَستطيع الآن الرفض', 'success');
        break;
      case 'cancel':
        await api.serviceRequests.cancel(requestId, payload);
        showToast('✓ تَمَّ إلغاء الطلب', 'success');
        break;
    }
    setActionModal(null);
    await reload();
  }

  async function doPromote() {
    setBusy(true);
    try {
      const res = await api.serviceRequests.promote(requestId);
      if ('collision' in res && res.collision) {
        setCollision(res.collision);
      } else {
        alert(`تَمَّت الترقية — open_task #${res.ok?.newOpenTaskId}`);
        await reload();
      }
    } catch (e: any) {
      alert(e?.message ?? 'فَشل الترقية');
    } finally {
      setBusy(false);
    }
  }

  async function linkSuggested(m: { source: 'client' | 'candidate'; id: number }) {
    await api.serviceRequests.link(requestId, {
      [m.source === 'client' ? 'beneficiaryClientId' : 'beneficiaryCandidateId']: m.id,
    });
    await reload();
  }

  return (
    <div className="max-w-6xl mx-auto p-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          <ArrowRight className="h-4 w-4 transform scale-x-[-1]" />
          عودة
        </button>
        <span className={`text-sm px-3 py-1 rounded-full ${STATUS_COLORS[req.status]}`}>
          {STATUS_LABELS[req.status] ?? req.status}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Hash className="h-5 w-5 text-gray-400" />
            {req.publicRefNumber}
          </h1>
          <div className="flex gap-1 flex-wrap">
            {req.duplicateFlag && (
              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded">مُكَرَّر</span>
            )}
            {req.reviewRequiredFlag && (
              <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded">يَحتاج مراجعة مدقّق</span>
            )}
            {req.archivedAt && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">مُؤرشَف</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">القناة</div>
            <div className="font-medium">{req.channel}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">الأولوية</div>
            <div className="font-medium">{req.priority ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">المُستلِم</div>
            <div className="font-medium">{req.reviewedByUserId ? `#${req.reviewedByUserId}` : '— لم يَتولّى أحد —'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">تاريخ الإنشاء</div>
            <div className="font-medium">{new Date(req.createdAt).toLocaleString('ar-SY')}</div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {isActive && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 flex flex-wrap gap-2">
          {req.status === 'received' && canReview && (
            <button
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.claim(requestId))}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              تَولّي الطلب
            </button>
          )}
          {req.status === 'in_review' && !isOwner && canReview && (
            <button
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.takeOver(requestId))}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              نَقل الـ Ownership إليّ
            </button>
          )}
          {req.status === 'in_review' && canReview && (
            <>
              {/* V1.0: "طلب معلومة من الزبون" مُؤجَّل (awaiting_customer_info خارج V1.0).
                  الكود يَبقى في الـ stateMachine للـ V2. */}
              {canPromote && (
                <button
                  disabled={busy || !canDoPromote}
                  onClick={doPromote}
                  title={
                    canDoPromote
                      ? 'تَرقية الطلب إلى مهمة طوارئ'
                      : `يَنقصك: ${promoteMissing.join(' + ')}`
                  }
                  className={`text-sm px-3 py-1.5 rounded flex items-center gap-1 ${
                    canDoPromote
                      ? 'bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <ArrowUpCircle className="h-4 w-4" />
                  ترقية إلى مهمة
                  {!canDoPromote && (
                    <span className="text-xs">({promoteMissing.length} ينقص)</span>
                  )}
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => setActionModal('resolveAtIntake')}
                className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded disabled:opacity-50 flex items-center gap-1"
              >
                <ClipboardCheck className="h-4 w-4" />
                حُلَّ في الاستلام
              </button>
              {!req.reviewRequiredFlag && (
                <button
                  disabled={busy}
                  onClick={() => setActionModal('escalate')}
                  className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
                >
                  تَصعيد للمدقّق
                </button>
              )}
            </>
          )}
          {/* V1.0: awaiting_customer_info خارج النطاق — زر "العَودة للمراجعة" مَخفي.
              لو وُجد سجل قديم بهذه الحالة، يَبقى الزر للأمان. */}
          {req.status === 'awaiting_customer_info' && canReview && (
            <button
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.resumeReview(requestId))}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              العَودة للمراجعة (سجل قديم)
            </button>
          )}
          {req.reviewRequiredFlag && canReject && (
            <button
              disabled={busy}
              onClick={() => {
                const outcome = prompt('سبب الرفض (duplicate/invalid_request/spam/out_of_scope/unverified_caller/device_not_company):');
                if (!outcome) return;
                safeRun(() => api.serviceRequests.reject(requestId, { triageOutcome: outcome }));
              }}
              className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded disabled:opacity-50 flex items-center gap-1"
            >
              <X className="h-4 w-4" />
              رَفض (مدقّق)
            </button>
          )}
          {canReview && req.status !== 'received' && (
            <button
              disabled={busy}
              onClick={() => setActionModal('cancel')}
              className="text-sm bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              إلغاء إداري
            </button>
          )}
        </div>
      )}
      {isTerminal && canArchive && !req.archivedAt && (
        <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
          <button
            disabled={busy}
            onClick={() => safeRun(() => api.serviceRequests.archive(requestId, prompt('سبب الأرشفة (اختياري):') ?? null))}
            className="text-sm bg-gray-600 hover:bg-gray-700 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            أرشفة
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="flex gap-1">
          {(['overview', 'problems', 'audit', 'linkage'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                tab === t
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'overview' && 'نظرة عامة'}
              {t === 'problems' && `الأعطال (${data.problems.filter((p) => p.deletedAt == null).length})`}
              {t === 'audit' && 'سجل الأحداث'}
              {t === 'linkage' && 'الربط'}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="space-y-3">
          {/* V1.0 §١٢ — promote readiness checklist (visible in in_review only). */}
          {req.status === 'in_review' && !canDoPromote && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
              <div className="font-semibold text-yellow-900 mb-1">
                للترقية إلى مهمة، ينقصك:
              </div>
              <ul className="list-disc pr-5 text-yellow-800 space-y-0.5">
                {promoteMissing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2 flex-wrap">
                {!req.beneficiaryClientId && (
                  <button
                    onClick={() => setTab('linkage')}
                    className="text-xs bg-yellow-700 hover:bg-yellow-800 text-white px-2 py-1 rounded"
                  >
                    اذهب إلى الربط ←
                  </button>
                )}
                {req.beneficiaryClientId && !req.installedDeviceId && canReview && (
                  <button
                    onClick={async () => {
                      const idStr = prompt('أَدخِل installed_device_id من أجهزة الزبون:');
                      const did = Number(idStr);
                      if (!Number.isFinite(did) || did <= 0) return;
                      await safeRun(
                        () => api.serviceRequests.link(requestId, { installedDeviceId: did }),
                        '✓ تَمَّ ربط الجهاز',
                      );
                    }}
                    className="text-xs bg-yellow-700 hover:bg-yellow-800 text-white px-2 py-1 rounded"
                  >
                    ربط جهاز
                  </button>
                )}
                {activeProblems.length === 0 && (
                  <button
                    onClick={() => setTab('problems')}
                    className="text-xs bg-yellow-700 hover:bg-yellow-800 text-white px-2 py-1 rounded"
                  >
                    إضافة عطل ←
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-semibold text-gray-800 mb-2">شكوى الزبون</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{req.problemDescription}</p>
          </div>

          {/* Linked client + device summary */}
          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-semibold text-gray-800 mb-2">الربط</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">الزبون</div>
                <div className="font-medium">
                  {req.beneficiaryClientId ? `#${req.beneficiaryClientId}` : '— لم يُربَط بعد —'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">الجهاز</div>
                <div className="font-medium">
                  {req.installedDeviceId ? `#${req.installedDeviceId}` : '— لم يُربَط بعد —'}
                </div>
              </div>
            </div>
          </div>
          {req.requesterExternal && (
            <div className="bg-white border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-800 mb-2">بيانات صاحب الطلب</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><Phone className="h-3 w-3 inline mr-1" /> {req.requesterExternal.name ?? '—'}</div>
                <div>{req.requesterExternal.primary_phone ?? '—'}</div>
              </div>
            </div>
          )}
          {req.serviceAddress && (
            <div className="bg-white border border-gray-200 rounded p-4">
              <h3 className="font-semibold text-gray-800 mb-2">عنوان الخدمة</h3>
              <p className="text-sm text-gray-700 flex items-center gap-1">
                <MapPin className="h-4 w-4 text-gray-400" />
                {req.serviceAddress.governorate} — {req.serviceAddress.detailed_address}
              </p>
            </div>
          )}
          {req.linkedOpenTaskId && (
            <div className="bg-purple-50 border border-purple-200 rounded p-4">
              <h3 className="font-semibold text-purple-800 mb-2">المهمة المُرتبطة</h3>
              <button
                onClick={() => navigate(`/tasks/emergency/${req.linkedOpenTaskId}`)}
                className="text-sm text-purple-700 hover:underline"
              >
                open_task #{req.linkedOpenTaskId} ←
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'problems' && (
        <ProblemsList
          serviceRequestId={requestId}
          installedDeviceId={req.installedDeviceId}
          problems={data.problems}
          canEdit={canReview && isActive}
          onRefresh={reload}
        />
      )}

      {tab === 'audit' && <AuditLogTimeline events={data.auditLog} />}

      {tab === 'linkage' && (
        <div className="space-y-3">
          {req.beneficiaryClientId ? (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-sm">
              <UserCheck className="h-4 w-4 inline text-green-700 ml-1" />
              مربوط بالعميل #{req.beneficiaryClientId}
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
              لا يوجد ربط مستفيد — الترقية مَحجوبة حتى الربط (SR-AUTH-02).
            </div>
          )}
          {canReview && isActive && (
            <SuggestedMatchesPanel serviceRequestId={requestId} onLink={linkSuggested} />
          )}
        </div>
      )}

      {collision && (
        <MergeOrSplitModal
          serviceRequestId={requestId}
          existingOpenTaskId={collision.existingOpenTaskId}
          installedDeviceId={collision.installedDeviceId}
          onClose={() => setCollision(null)}
          onResolved={async () => {
            setCollision(null);
            await reload();
          }}
        />
      )}

      {actionModal && (
        <TerminalTransitionModal
          mode={actionModal}
          onClose={() => setActionModal(null)}
          onConfirm={handleModalConfirm}
        />
      )}

      {toast && (
        <div
          className={`fixed top-4 left-4 z-[60] max-w-md rounded-lg shadow-lg px-4 py-3 text-sm border-2 transition-opacity ${
            toast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
