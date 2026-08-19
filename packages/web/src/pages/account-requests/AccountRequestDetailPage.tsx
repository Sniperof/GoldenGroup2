// ============================================================
// AccountRequestDetailPage — review + decide on an account-creation request
// DEC-013 — a declared specialization of the unified detail skeleton
// (request-section-contract.md §8 + §9): same regions, same order; the only
// type-specific parts are the completed banner, the link-to-activate decision
// and the governorate snapshot fields. No parallel structure.
//
// Contract §3: request-info / resume-review are fully dropped (migration 383
// returned any parked rows to in_review).
// ============================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquarePlus,
  RotateCcw,
  ShieldAlert,
  XCircle,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  UserRound,
} from 'lucide-react';
import { api } from '../../lib/api';
import Button from '../../components/ui/Button';
import Select from '../../components/ui/Select';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import AuditLogTimeline from '../../components/service-requests/AuditLogTimeline';
import SuggestedMatchesPanel from '../../components/service-requests/SuggestedMatchesPanel';
import RequestDetailLayout from '../../components/requests/RequestDetailLayout';
import { reviewRequiredReasons } from '../../lib/serviceRequestDisplay';

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

const BRANCH_RESOLUTION_LABELS: Record<string, string> = {
  no_coverage: 'لا يوجد فرع يغطي هذا العنوان',
  ambiguous: 'العنوان مشترك بين أكثر من فرع',
  missing_geo: 'تعذّر تحديد الوحدة الجغرافية',
  resolved: 'تم تحديد الفرع',
};

const ACTIVE = ['received', 'in_review', 'awaiting_customer_info'];

function Field({ label, value }: { label: string; value: any }) {
  const empty = value == null || value === '';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${empty ? 'text-slate-300' : 'text-slate-800'}`}>{empty ? 'غير متوفر' : value}</div>
    </div>
  );
}

export default function AccountRequestDetailPage() {
  const { id } = useParams();
  const rid = Number(id);
  const { hasPermission } = usePermissions();
  // Standard family semantics (contract §5): review = claim/work/notes/escalate,
  // decide = approve-link/reject/reopen, + dedicated resolve_escalation/archive.
  const canReview = hasPermission('account_requests.review');
  const canDecide = hasPermission('account_requests.decide');
  const canResolveEscalation = hasPermission('account_requests.resolve_escalation');
  const canArchive = hasPermission('account_requests.archive');
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<{ request: any; audit: any[] } | null>(null);
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

  const fetchSuggestions = useCallback(async () => {
    const res = await api.accountRequests.suggestions(rid);
    return { clients: res.suggestions ?? [], candidates: [] };
  }, [rid]);

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
  const labels = sa?.labels ?? {};

  const panelRequest = useMemo(
    () => ({
      requesterExternal: {
        firstName: p.first_name,
        fatherName: p.father_name,
        lastName: p.last_name,
        primary_phone: p.primary_mobile,
        primaryPhoneHasWhatsapp: p.primary_mobile_has_whatsapp,
        secondary_phone: p.secondary_mobile,
        secondaryPhoneHasWhatsapp: p.secondary_mobile_has_whatsapp,
      },
      // Passed through as stored. Both mobile intake paths now write the same
      // `service_address` shape (canonical snake_case + camelCase aliases +
      // labels), so this page no longer translates one vocabulary into another.
      serviceAddress: sa,
    }),
    [
      p.first_name,
      p.father_name,
      p.last_name,
      p.primary_mobile,
      p.primary_mobile_has_whatsapp,
      p.secondary_mobile,
      p.secondary_mobile_has_whatsapp,
      sa,
    ],
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
  const isOwner = isClaimed && r.reviewed_by_user_id === user?.id;
  const isEscalated = r.escalated_at != null;
  const dupEvent = (data?.audit ?? []).find((a: any) => a.event_type === 'duplicate_flag_set');
  const dup = dupEvent?.event_payload ?? null;
  const reviewReasons = reviewRequiredReasons(data?.audit);

  return (
    <RequestDetailLayout
      backPath="/account-requests"
      refNumber={r.public_ref_number}
      typeLabel="طلب إنشاء حساب"
      createdAt={r.created_at}
      status={r.status}
      requestType="account_creation"
      flags={{
        duplicate: !!r.duplicate_flag,
        reviewRequired: !!r.review_required_flag,
        escalated: isEscalated,
        archived: !!r.archived_at,
      }}
      infoTiles={[
        { label: 'القناة', value: 'تطبيق موبايل' },
        { label: 'المحافظة', value: labels.governorate ?? sa.governorate ?? '—' },
        {
          label: 'رقم الموبايل',
          value: p.primary_mobile ? <span dir="ltr" className="font-mono">{p.primary_mobile}</span> : '—',
        },
        { label: 'الزبون المربوط', value: r.beneficiary_client_id ? `#${r.beneficiary_client_id}` : '—' },
      ]}
      headerBadges={
        r.reopen_count > 0 ? (
          <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700">
            أُعيد فتحه {r.reopen_count}×
          </span>
        ) : undefined
      }
      banners={
        <>
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
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-3 text-sm text-red-800 flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                الطلب مُصعَّد — سبب: {r.escalation_reason ?? '—'}. الإجراءات مقيّدة حتى الحسم أو فكّ التصعيد.
              </span>
              {canResolveEscalation && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api.accountRequests.resolveEscalation(rid, prompt('سبب فكّ التصعيد (اختياري):') ?? null),
                      'تم فكّ التصعيد — عادت الإجراءات',
                    )
                  }
                >
                  فكّ التصعيد
                </Button>
              )}
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
          {r.branch_resolution_status && r.branch_resolution_status !== 'resolved' && r.branch_resolution_status !== 'not_applicable' && (
            <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">حالة تغطية العنوان: {BRANCH_RESOLUTION_LABELS[r.branch_resolution_status] ?? r.branch_resolution_status}</div>
                <div className="mt-1">يمكن اعتماد الحساب وتفعيله، لكن هذا العنوان حالياً خارج تغطية الفروع أو يحتاج مراجعة.</div>
                {r.branch_resolution_reason && <div className="mt-1 text-xs text-amber-800">{r.branch_resolution_reason}</div>}
              </div>
            </div>
          )}
          {!r.duplicate_flag && r.review_required_flag && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-bold">مراجعة إلزامية قبل الاعتماد</div>
                {reviewReasons.length > 0 ? (
                  <ul className="mt-1 list-disc space-y-1 pe-5">
                    {reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                ) : (
                  <div className="mt-1">لم يُسجّل سبب تفصيلي لهذا الوسم.</div>
                )}
              </div>
            </div>
          )}
        </>
      }
      reviewerId={r.reviewed_by_user_id ?? null}
      reviewerName={r.reviewed_by_name ?? null}
      ownershipActions={
        <>
          {/* Same rules as the unified model: claim only while unclaimed,
              take-over only when someone ELSE holds it. */}
          {isActive && canReview && !isClaimed && !isEscalated && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(() => api.accountRequests.claim(rid), 'تم تولّي الطلب')}
            >
              تَولّي الطلب
            </Button>
          )}
          {r.status === 'in_review' && canReview && isClaimed && !isOwner && !isEscalated && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => act(() => api.accountRequests.takeOver(rid), 'تم نقل التولّي إليك')}
            >
              نقل التولّي إليّ
            </Button>
          )}
          {/* Contract §3: request-info/resume-review dropped entirely —
              migration 383 returned any parked rows to in_review. */}
          {r.status === 'in_review' && canReview && !isEscalated && (
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => {
                const reason = prompt('سبب التصعيد؟');
                if (reason) act(() => api.accountRequests.escalate(rid, reason), 'تم التصعيد');
              }}
            >
              تَصعيد للمدقّق
            </Button>
          )}
        </>
      }
      submittedData={
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
              <UserRound className="h-5 w-5 text-sky-600" />
              بيانات الهوية
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
            <Field label="الاسم الأول" value={p.first_name} />
            <Field label="اسم الأب" value={p.father_name} />
            <Field label="الكنية" value={p.last_name} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
              <Phone className="h-5 w-5 text-sky-600" />
              معلومات التواصل
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="رقم الموبايل الرئيسي"
              value={p.primary_mobile ? (
                <span dir="ltr" className="font-mono">
                  {p.primary_mobile}
                  {p.primary_mobile_has_whatsapp === true
                    ? ' · WhatsApp'
                    : p.primary_mobile_has_whatsapp === false ? ' · بدون WhatsApp' : ''}
                </span>
              ) : null}
            />
            <Field
              label="رقم ثانوي"
              value={p.secondary_mobile ? (
                <span dir="ltr" className="font-mono">
                  {p.secondary_mobile}
                  {p.secondary_mobile_has_whatsapp === true
                    ? ' · WhatsApp'
                    : p.secondary_mobile_has_whatsapp === false ? ' · بدون WhatsApp' : ''}
                </span>
              ) : null}
            />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
              <MapPin className="h-5 w-5 text-sky-600" />
              عنوان الخدمة
            </h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="المحافظة" value={labels.governorate ?? sa.governorate} />
            <Field label="المنطقة" value={labels.city_or_area ?? sa.city_or_area} />
            <Field label="الناحية" value={labels.sub_area ?? sa.sub_area} />
            <Field label="الحي" value={labels.neighborhood ?? sa.neighborhood} />
            </div>
            <div className="mt-3">
            <Field label="العنوان التفصيلي" value={sa.detailed_address ?? p.detailed_address} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-800">
              <MessageCircle className="h-5 w-5 text-sky-600" />
              ملاحظات مقدم الطلب
            </h2>
            <Field label="الملاحظة المرسلة مع الطلب" value={p.notes} />
          </section>
          </div>
      }
      linkage={
        r.status === 'received' ? (
          <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            تولَّ الطلب أولاً (زر «تَولّي الطلب») قبل الربط والاعتماد.
          </div>
        ) : r.status === 'in_review' ? (
          <SuggestedMatchesPanel
            serviceRequestId={rid}
            request={panelRequest}
            sources="clients"
            fetchSuggestions={fetchSuggestions}
            onLink={async (m) => {
              if (!canDecide) {
                toast.error('لا تملك صلاحية اعتماد الربط');
                return;
              }
              await act(() => api.accountRequests.link(rid, m.id), 'تم الربط وتفعيل الحساب');
            }}
          />
        ) : (
          <p className="text-sm text-slate-400 py-6">الطلب مُغلق — لا حاجة لاقتراحات.</p>
        )
      }
      decision={
        <>
          {/* SR-R005 + state machine: decisions exist only while in_review. */}
          {r.status === 'received' && (
            <p className="text-sm text-slate-500">لا حسم قبل تولّي الطلب.</p>
          )}
          {r.status === 'in_review' && isClaimed && canDecide && (
            <div className="flex items-end gap-2 flex-wrap">
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
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (confirm('تأكيد رفض الطلب؟')) {
                    act(() => api.accountRequests.reject(rid, rejectReason), 'تم رفض الطلب');
                  }
                }}
              >
                <XCircle className="h-4 w-4 ml-1" /> رفض الطلب
              </Button>
              <span className="text-[11px] text-slate-400">الرفض يتطلّب تصعيداً أو علامة مراجعة إلزامية.</span>
            </div>
          )}
          {!isActive && r.status !== 'completed' && canDecide && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-slate-600">الطلب مُغلق. يمكن إعادة فتحه بسبب موثّق.</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const reason = prompt('سبب إعادة الفتح؟');
                  if (reason) act(() => api.accountRequests.reopen(rid, reason), 'أُعيد فتح الطلب');
                }}
              >
                <RotateCcw className="h-4 w-4 ml-1" /> إعادة الفتح
              </Button>
            </div>
          )}
          {!isActive && canArchive && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              {r.archived_at ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act(() => api.accountRequests.unarchive(rid), 'أُلغيت الأرشفة')}
                >
                  إلغاء الأرشفة
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act(() => api.accountRequests.archive(rid, prompt('سبب الأرشفة (اختياري):') ?? null), 'تمت الأرشفة')}
                >
                  أرشفة
                </Button>
              )}
            </div>
          )}
          {r.status === 'in_review' && !canDecide && (
            <p className="text-sm text-slate-400">لا تملك صلاحية الحسم على هذا النوع.</p>
          )}
        </>
      }
      audit={<AuditLogTimeline events={auditEvents} />}
      notes={
        canReview ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-slate-500 block mb-1">ملاحظة داخلية</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="تُسجَّل في سجل التدقيق (ومنها توثيق محاولات التواصل مع الزبون)"
                className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !note.trim()}
              onClick={() => act(async () => { await api.accountRequests.addNote(rid, note.trim()); setNote(''); }, 'أُضيفت الملاحظة')}
            >
              <MessageSquarePlus className="h-4 w-4 ml-1" /> إضافة
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}
