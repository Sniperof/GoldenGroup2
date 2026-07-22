// ============================================================
// AccountRequestDetailPage — review + decide on an account-creation request
// DEC-013 — composed from the SAME shared building blocks as the water_check
// detail surface (SuggestedMatchesPanel, AuditLogTimeline, claim bar, tabs,
// terminal actions), but wired to the independent account_requests.* endpoints.
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  ShieldAlert,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import { usePermissions } from '../../hooks/usePermissions';
import AuditLogTimeline from '../../components/service-requests/AuditLogTimeline';
import SuggestedMatchesPanel from '../../components/service-requests/SuggestedMatchesPanel';

const STATUS_LABELS: Record<string, string> = {
  received: 'مُستلَم',
  in_review: 'قيد المراجعة',
  awaiting_customer_info: 'بانتظار الزبون',
  completed: 'مُعتمَد ومُفعَّل',
  rejected: 'مرفوض',
  cancelled: 'مُلغى',
};

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-700',
  in_review: 'bg-blue-100 text-blue-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

// Shared reject outcomes (state machine TRIAGE_OUTCOMES_BY_TERMINAL.rejected).
const REJECT_REASONS = [
  { value: 'duplicate', label: 'مكرَّر' },
  { value: 'invalid_request', label: 'طلب غير صالح' },
  { value: 'spam', label: 'مزعج / سبام' },
  { value: 'out_of_scope', label: 'خارج النطاق' },
  { value: 'unverified_caller', label: 'مُرسِل غير موثّق' },
];

const OUTCOME_LABELS: Record<string, string> = {
  linked_to_op: 'مرتبط بزبون مُشغَّل (OP)',
  linked_to_fop: 'مرتبط بزبون تشغيل ميداني (FOP)',
  linked_to_lead: 'مرتبط بعميل محتمل (Lead)',
  linked_to_client: 'مرتبط بزبون قائم',
};

const ACTIVE = ['received', 'in_review', 'awaiting_customer_info'];
type Tab = 'overview' | 'audit';

function Field({ label, value }: { label: string; value: any }) {
  const empty = value == null || value === '';
  return (
    <div className="rounded-lg bg-slate-50/70 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm ${empty ? 'text-slate-400' : 'text-slate-800'}`}>{empty ? '—' : value}</div>
    </div>
  );
}

export default function AccountRequestDetailPage() {
  const { id } = useParams();
  const rid = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canLink = hasPermission('account_requests.link');
  const canEscalate = hasPermission('account_requests.escalate');
  const canReject = hasPermission('account_requests.reject');

  const [data, setData] = useState<{ request: any; audit: any[] } | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState('duplicate');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.accountRequests.get(rid));
    } finally {
      setLoading(false);
    }
  }, [rid]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchSuggestions = useCallback(
    async () => {
      const res = await api.accountRequests.suggestions(rid);
      return { clients: res.suggestions ?? [], candidates: [] };
    },
    [rid],
  );

  async function act(fn: () => Promise<any>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (okMsg) toast.success(okMsg);
    } catch (e: any) {
      toast.error(e?.message ?? 'فشل تنفيذ الإجراء');
    } finally {
      setBusy(false);
    }
  }

  // The shared AuditLogTimeline expects camelCase events.
  const auditEvents = useMemo(
    () =>
      (data?.audit ?? []).map((a: any, i: number) => ({
        id: Number(a.id ?? i),
        eventType: a.event_type,
        eventPayload: a.event_payload ?? null,
        actorUserId: a.actor_user_id ?? null,
        actorRole: a.actor_role ?? '',
        actorName: a.actor_name ?? null,
        note: a.note ?? null,
        createdAt: a.created_at,
      })),
    [data],
  );

  const r = data?.request;
  const p = r?.submitted_payload ?? {};
  const sa = r?.service_address ?? {};
  const labels = sa.labels ?? p.address_labels ?? {};

  // Adapt the account request into the shape SuggestedMatchesPanel compares against.
  const panelRequest = useMemo(
    () => ({
      requesterExternal: {
        firstName: p.first_name,
        lastName: p.last_name,
        primary_phone: p.primary_mobile,
        secondary_phone: p.secondary_mobile,
      },
      serviceAddress: {
        governorateId: sa.governorate,
        regionId: sa.city_or_area,
        subdistrictId: sa.sub_area,
        neighborhoodId: sa.neighborhood,
        detailedAddress: sa.detailed_address,
      },
    }),
    [p.first_name, p.last_name, p.primary_mobile, p.secondary_mobile,
     sa.governorate, sa.city_or_area, sa.sub_area, sa.neighborhood, sa.detailed_address],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!r) return <div className="p-6 text-slate-500">الطلب غير موجود.</div>;

  const isActive = ACTIVE.includes(r.status);
  const isClaimed = r.reviewed_by_user_id != null;
  const isEscalated = r.escalated_at != null;
  const dupEvent = (data?.audit ?? []).find((a: any) => a.event_type === 'duplicate_flag_set');
  const dup = dupEvent?.event_payload ?? null;

  return (
    <div className="max-w-6xl mx-auto p-4" dir="rtl">
      <button
        onClick={() => navigate('/account-requests')}
        className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 mb-3"
      >
        <ArrowRight className="h-4 w-4" /> رجوع للقائمة
      </button>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <PageHeader
          title={`طلب ${r.public_ref_number}`}
          icon={<UserCheck className="h-6 w-6 text-blue-600" />}
        />
        <div className="flex items-center gap-2">
          {r.reopen_count > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700">
              أُعيد فتحه {r.reopen_count}×
            </span>
          )}
          {isEscalated && (
            <span className="text-xs px-2 py-1 rounded bg-red-600 text-white">مُصعَّد</span>
          )}
          <span className={`text-xs px-2.5 py-1 rounded ${STATUS_COLORS[r.status] ?? ''}`}>
            {STATUS_LABELS[r.status] ?? r.status}
          </span>
        </div>
      </div>

      {/* Banners */}
      {r.status === 'completed' && (
        <div className="bg-green-50 border border-green-200 rounded p-3 mb-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          تم اعتماد الربط وتفعيل الحساب — الزبون #{r.beneficiary_client_id}
          {r.triage_outcome && ` · ${OUTCOME_LABELS[r.triage_outcome] ?? r.triage_outcome}`}
        </div>
      )}
      {r.status === 'rejected' && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-3 text-sm text-red-800">
          مرفوض — السبب: {REJECT_REASONS.find((x) => x.value === r.rejection_reason)?.label ?? r.rejection_reason ?? '—'}
        </div>
      )}
      {isEscalated && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-3 text-sm text-red-800 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>الطلب مُصعَّد — سبب: {r.escalation_reason ?? '—'}. الإجراءات مقيّدة حتى الحسم.</span>
        </div>
      )}
      {r.duplicate_flag && (
        <div className="bg-orange-50 border border-orange-200 rounded p-3 mb-3 text-sm text-orange-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            تكرار محتمل — يتطابق مع{' '}
            {dup?.match_kind === 'account'
              ? `حساب قائم (#${dup?.matched_id})`
              : dup?.match_kind === 'request'
                ? `طلب إنشاء آخر (#${dup?.matched_id})`
                : 'سجل قائم'}
            {typeof dup?.score === 'number' && ` — درجة التطابق ${Math.round(dup.score * 100)}%`}. مراجعة إلزامية.
          </span>
        </div>
      )}
      {!r.duplicate_flag && r.review_required_flag && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> مراجعة إلزامية قبل الاعتماد.
        </div>
      )}

      {/* Ownership / claim bar */}
      <div className="bg-white border border-slate-200 rounded p-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-600 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          {isClaimed ? (
            <span>
              المسؤول: <span className="font-medium text-slate-800">{r.reviewed_by_name ?? `#${r.reviewed_by_user_id}`}</span>
            </span>
          ) : (
            <span className="text-amber-700">غير مُستلَم — استلمه قبل اتخاذ أي قرار</span>
          )}
        </div>
        {isActive && canLink && (
          <Button
            size="sm"
            variant={isClaimed ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() =>
              act(
                () => (isClaimed ? api.accountRequests.takeOver(rid) : api.accountRequests.claim(rid)),
                isClaimed ? 'تم نقل المسؤولية إليك' : 'تم استلام الطلب',
              )
            }
          >
            {isClaimed ? 'نقل المسؤولية إليّ' : 'استلام الطلب'}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-4">
        {([['overview', 'نظرة عامة'], ['audit', 'سجل التدقيق']] as [Tab, string][]).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              tab === k
                ? 'border-blue-600 text-blue-700 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'audit' ? (
        <div className="bg-white border border-slate-200 rounded p-4">
          <AuditLogTimeline events={auditEvents} />
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Request data */}
          <div className="bg-white border border-slate-200 rounded p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1">
              <Hash className="h-4 w-4 text-slate-400" /> بيانات الطلب
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <Field label="الاسم الأول" value={p.first_name} />
              <Field label="الكنية" value={p.last_name} />
              <Field
                label="رقم الموبايل الرئيسي"
                value={p.primary_mobile ? <span dir="ltr" className="font-mono">{p.primary_mobile}</span> : null}
              />
              <Field
                label="رقم ثانوي"
                value={p.secondary_mobile ? <span dir="ltr" className="font-mono">{p.secondary_mobile}</span> : null}
              />
              <Field label="المحافظة" value={labels.governorate ?? sa.governorate} />
              <Field label="المنطقة" value={labels.city_or_area ?? sa.city_or_area} />
              <Field label="الناحية" value={labels.sub_area ?? sa.sub_area} />
              <Field label="الحي" value={labels.neighborhood ?? sa.neighborhood} />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <Field label="العنوان التفصيلي" value={sa.detailed_address ?? p.detailed_address} />
              <Field label="ملاحظات المُرسِل" value={p.notes} />
            </div>
          </div>

          {/* Suggested clients — shared comparison panel */}
          <div className="bg-white border border-slate-200 rounded p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">السجلات المقترحة (زبائن)</h2>
            {isActive ? (
              <SuggestedMatchesPanel
                serviceRequestId={rid}
                request={panelRequest}
                sources="clients"
                fetchSuggestions={fetchSuggestions}
                onLink={async (m) => {
                  if (!canLink) {
                    alert('لا تملك صلاحية الربط');
                    return;
                  }
                  await act(() => api.accountRequests.link(rid, m.id), 'تم الربط وتفعيل الحساب');
                }}
              />
            ) : (
              <p className="text-sm text-slate-400 py-6">الطلب مُغلق — لا حاجة لاقتراحات.</p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="bg-white border border-slate-200 rounded p-4 mt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">الإجراءات</h2>

          <div className="flex flex-wrap gap-2 mb-4">
            {canLink && r.status === 'in_review' && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => act(() => api.accountRequests.requestInfo(rid), 'بانتظار بيانات الزبون')}>
                طلب بيانات من الزبون
              </Button>
            )}
            {canLink && r.status === 'awaiting_customer_info' && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => act(() => api.accountRequests.resumeReview(rid), 'استُؤنفت المراجعة')}>
                استئناف المراجعة
              </Button>
            )}
            {canEscalate && !isEscalated && (
              <Button size="sm" variant="secondary" disabled={busy}
                onClick={() => {
                  const reason = prompt('سبب التصعيد؟');
                  if (reason) act(() => api.accountRequests.escalate(rid, reason), 'تم التصعيد');
                }}>
                تصعيد
              </Button>
            )}
          </div>

          {/* Reject with a managed reason */}
          {canReject && (
            <div className="flex items-end gap-2 flex-wrap border-t border-slate-100 pt-3">
              <div className="w-56">
                <label className="text-[11px] text-slate-500 block mb-1">سبب الرفض</label>
                <Select
                  value={rejectReason}
                  onChange={(v) => setRejectReason(v)}
                  size="sm"
                  ariaLabel="سبب الرفض"
                  options={REJECT_REASONS.map((x) => ({ value: x.value, label: x.label }))}
                />
              </div>
              <Button size="sm" variant="danger" disabled={busy}
                onClick={() => {
                  if (confirm('تأكيد رفض الطلب؟')) {
                    act(() => api.accountRequests.reject(rid, rejectReason), 'تم رفض الطلب');
                  }
                }}>
                <XCircle className="h-4 w-4 ml-1" /> رفض الطلب
              </Button>
              <span className="text-[11px] text-slate-400">
                الرفض يتطلّب تصعيداً أو علامة مراجعة إلزامية.
              </span>
            </div>
          )}

          {/* Internal note */}
          {canLink && (
            <div className="flex items-end gap-2 border-t border-slate-100 pt-3 mt-3">
              <div className="flex-1">
                <label className="text-[11px] text-slate-500 block mb-1">ملاحظة داخلية</label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="تُسجَّل في سجل التدقيق"
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                />
              </div>
              <Button size="sm" variant="secondary" disabled={busy || !note.trim()}
                onClick={() => act(async () => { await api.accountRequests.addNote(rid, note.trim()); setNote(''); }, '')}>
                <MessageSquarePlus className="h-4 w-4 ml-1" /> إضافة
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reopen a terminal request */}
      {!isActive && r.status !== 'completed' && canLink && (
        <div className="bg-white border border-slate-200 rounded p-4 mt-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-slate-600">الطلب مُغلق. يمكن إعادة فتحه بسبب موثّق.</span>
          <Button size="sm" variant="secondary" disabled={busy}
            onClick={() => {
              const reason = prompt('سبب إعادة الفتح؟');
              if (reason) act(() => api.accountRequests.reopen(rid, reason), 'أُعيد فتح الطلب');
            }}>
            <RotateCcw className="h-4 w-4 ml-1" /> إعادة الفتح
          </Button>
        </div>
      )}
    </div>
  );
}
