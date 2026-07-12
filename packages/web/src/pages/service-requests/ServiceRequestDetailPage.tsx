// ============================================================
// ServiceRequestDetailPage — central detail/action view
// Constitution: maintenance.md §٠.٣ + §٠.٤ + §٠.١٦ + §٠.١٧ + §٠.١٩
// ============================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowRight,
  ArrowUpCircle,
  CalendarClock,
  ClipboardCheck,
  Clock,
  Hash,
  Loader2,
  UserCheck,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { getOpenTaskDetailPath } from '../../lib/taskRoutes';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuthStore } from '../../hooks/useAuthStore';
import ProblemsList from '../../components/service-requests/ProblemsList';
import SuggestedMatchesPanel from '../../components/service-requests/SuggestedMatchesPanel';
import AuditLogTimeline from '../../components/service-requests/AuditLogTimeline';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import DateField from '../../components/ui/DateField';
import ClientModal from '../../components/ClientModal';
import ClientSnapshot from '../../components/ClientSnapshot';
import MergeOrSplitModal from '../../components/service-requests/MergeOrSplitModal';
import TerminalTransitionModal, { type ModalMode } from '../../components/service-requests/TerminalTransitionModal';
import WaterCheckRequestDetailPanel from '../../components/service-requests/WaterCheckRequestDetailPanel';
import type { Client, GeoUnit } from '../../lib/types';

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
  received: 'bg-slate-100 text-slate-700',
  in_review: 'bg-blue-100 text-blue-700',
  awaiting_customer_info: 'bg-yellow-100 text-yellow-700',
  resolved_at_intake: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  promoted: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

type Tab = 'overview' | 'problems' | 'audit' | 'linkage';

type PeriodicAttachmentCandidate = {
  taskId: number;
  status: string;
  dueDate: string;
  daysUntilDue: number;
  attachWindowDays: number;
};

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  const empty = value == null || value === '';
  return (
    <div className="rounded-lg bg-slate-50/70 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${empty ? 'text-slate-300' : 'text-slate-800'}`}>{empty ? '—' : value}</div>
    </div>
  );
}

export default function ServiceRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ request: any; auditLog: any[]; problems: any[] } | null>(null);
  const [periodicCandidate, setPeriodicCandidate] = useState<PeriodicAttachmentCandidate | null>(null);
  const [collision, setCollision] = useState<{ existingOpenTaskId: number; installedDeviceId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 4 polish — modal for the 4 in_review actions; toasts via sonner
  const [actionModal, setActionModal] = useState<ModalMode | null>(null);
  const [waterCheckClientModalOpen, setWaterCheckClientModalOpen] = useState(false);
  const [waterCheckClientDraft, setWaterCheckClientDraft] = useState<any | null>(null);
  const [mediatorClientModalOpen, setMediatorClientModalOpen] = useState(false);
  const [mediatorClientDraft, setMediatorClientDraft] = useState<any | null>(null);
  const [beneficiarySnapshot, setBeneficiarySnapshot] = useState<any | null>(null);
  const [referrerSnapshot, setReferrerSnapshot] = useState<any | null>(null);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [waterCheckTaskModalOpen, setWaterCheckTaskModalOpen] = useState(false);
  const [waterCheckTaskDraft, setWaterCheckTaskDraft] = useState<{
    priority: 'high' | 'medium' | 'low';
    operatorNote: string;
    dueDate: string;
    creationReason: string;
  }>({ priority: 'medium', operatorNote: '', dueDate: '', creationReason: '' });
  const [deviceDemoReasons, setDeviceDemoReasons] = useState<{ value: string; label: string }[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.serviceRequests.get(requestId);
      let candidate: PeriodicAttachmentCandidate | null = null;
      if (res.request?.installedDeviceId) {
        try {
          const candidateRes = await api.serviceRequests.periodicAttachmentCandidate(requestId);
          candidate = candidateRes.candidate;
        } catch {
          candidate = null;
        }
      }
      setData(res);
      setPeriodicCandidate(candidate);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Level-2 snapshots for linked beneficiary / mediator (shown in the linkage tab).
  const beneficiaryClientId = data?.request?.beneficiaryClientId ?? null;
  const referrerClientId = data?.request?.referrerClientId ?? null;

  useEffect(() => {
    if (!beneficiaryClientId) { setBeneficiarySnapshot(null); return; }
    let active = true;
    api.clients.snapshot(Number(beneficiaryClientId))
      .then((r) => { if (active) setBeneficiarySnapshot(r.snapshot); })
      .catch(() => { if (active) setBeneficiarySnapshot(null); });
    return () => { active = false; };
  }, [beneficiaryClientId]);

  useEffect(() => {
    if (!referrerClientId) { setReferrerSnapshot(null); return; }
    let active = true;
    api.clients.snapshot(Number(referrerClientId))
      .then((r) => { if (active) setReferrerSnapshot(r.snapshot); })
      .catch(() => { if (active) setReferrerSnapshot(null); });
    return () => { active = false; };
  }, [referrerClientId]);

  useEffect(() => {
    if (!waterCheckTaskModalOpen || deviceDemoReasons.length > 0) return;
    let active = true;
    api.systemLists.getItemsByCode('device_demo_creation_reasons')
      .then((rows) => {
        if (!active) return;
        const opts = (Array.isArray(rows) ? rows : [])
          .filter((r: any) => r?.isActive !== false && typeof r?.value === 'string' && r.value.trim())
          .map((r: any) => ({ value: String(r.value), label: String(r.value) }));
        setDeviceDemoReasons(opts);
      })
      .catch(() => { if (active) setDeviceDemoReasons([]); });
    return () => { active = false; };
  }, [waterCheckTaskModalOpen, deviceDemoReasons.length]);

  useEffect(() => {
    if ((!waterCheckClientModalOpen && !mediatorClientModalOpen) || geoUnits.length > 0) return;
    let active = true;
    api.geoUnits.names()
      .then((rows) => {
        if (active) setGeoUnits(rows);
      })
      .catch(() => {
        if (active) setGeoUnits([]);
      });
    return () => {
      active = false;
    };
  }, [waterCheckClientModalOpen, mediatorClientModalOpen, geoUnits.length]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const req = data.request;
  const isWaterCheck = req.requestType === 'water_check';
  const visibleTabs = (isWaterCheck
    ? ['overview', 'linkage', 'audit']
    : ['overview', 'problems', 'linkage', 'audit']) as Tab[];
  const isOwner = req.reviewedByUserId === user?.id;
  const canReview = hasPermission('service_requests.review');
  const canReject = hasPermission('service_requests.reject');
  const canResolveEscalation = hasPermission('service_requests.resolve_escalation');
  const canPromote = hasPermission('service_requests.promote');
  const canArchive = hasPermission('service_requests.archive');
  const isActive = ['received', 'in_review', 'awaiting_customer_info'].includes(req.status);
  const isTerminal = !isActive;
  // SR-ESC-01 — restricted mode: while escalated, only reject + de-escalate are allowed.
  const isEscalated = !!req.escalatedAt;
  // SR-LINK-01 — linking (and create-from-request) requires the request to be
  // claimed first. Only available in_review and while not escalated.
  const canLink = req.status === 'in_review' && !isEscalated;
  const canCreateWaterCheckClient =
    isWaterCheck
    && canLink
    && !req.beneficiaryClientId
    && req.branchId
    && req.branchResolutionStatus === 'resolved'
    && hasPermission('clients.create');
  const canCreateCandidateFromRequest =
    !isWaterCheck
    && canLink
    && !req.beneficiaryClientId
    && !req.beneficiaryCandidateId
    && hasPermission('candidates.create');
  const hasMediator = !!req.referrerExternal;
  const canCreateMediatorClient =
    isWaterCheck
    && canLink
    && hasMediator
    && !req.referrerClientId
    && !!req.branchId
    && hasPermission('clients.create');

  // V1.0 promote pre-conditions (maintenance-v1.md §١٢)
  const activeProblems = data.problems.filter((p) => p.deletedAt == null);
  const promoteMissing: string[] = [];
  if (!req.beneficiaryClientId) promoteMissing.push('ربط زبون');
  if (!req.installedDeviceId) promoteMissing.push('ربط جهاز');
  if (activeProblems.length === 0) promoteMissing.push('عطل واحد على الأقل في اللائحة');
  const canDoPromote = !isWaterCheck && promoteMissing.length === 0;
  const waterCheckHandoffMissing: string[] = [];
  if (isWaterCheck && !req.linkedOpenTaskId) {
    if (req.status !== 'in_review') waterCheckHandoffMissing.push('استلام الطلب ونقله إلى قيد المراجعة');
    if (!req.beneficiaryClientId) waterCheckHandoffMissing.push('ربط الطلب بزبون موجود');
    if (!req.branchId) waterCheckHandoffMissing.push('تحديد الفرع المرتبط بالطلب');
    if (req.branchResolutionStatus !== 'resolved') waterCheckHandoffMissing.push('حسم ربط الفرع من التغطية الجغرافية');
  }
  const canWaterCheckHandoffByPermission = canPromote && hasPermission('open_tasks.edit');
  const canDoWaterCheckHandoff =
    isWaterCheck
    && !req.linkedOpenTaskId
    && canWaterCheckHandoffByPermission
    && waterCheckHandoffMissing.length === 0;

  function showToast(message: string, kind: 'success' | 'error' = 'success') {
    if (kind === 'error') toast.error(message);
    else toast.success(message);
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
      case 'reject':
        await api.serviceRequests.reject(requestId, payload);
        showToast('✓ تَمَّ رَفض الطلب', 'success');
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

  function openWaterCheckTaskModal() {
    if (!canDoWaterCheckHandoff) return;
    setWaterCheckTaskDraft({ priority: 'medium', operatorNote: '', dueDate: '', creationReason: '' });
    setWaterCheckTaskModalOpen(true);
  }

  async function submitWaterCheckHandoff() {
    if (!waterCheckTaskDraft.creationReason) {
      showToast('اختر سبب إنشاء مهمة عرض الجهاز.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.serviceRequests.handoffWaterCheck(requestId, {
        priority: waterCheckTaskDraft.priority,
        operatorNote: waterCheckTaskDraft.operatorNote.trim() || null,
        dueDate: waterCheckTaskDraft.dueDate || null,
        creationReason: waterCheckTaskDraft.creationReason,
      });
      setWaterCheckTaskModalOpen(false);
      showToast('تم تحويل طلب فحص المياه إلى مهمة عرض جهاز', 'success');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? 'تعذر إنشاء مهمة عرض الجهاز', 'error');
    } finally {
      setBusy(false);
    }
  }

  function getWaterCheckClientPayload() {
    const external = req.beneficiaryExternal ?? req.requesterExternal ?? {};
    const submitted = req.submittedPayload?.data ?? {};
    const address = req.serviceAddress ?? {};
    // Mediator (وسيط) captured when the request was submitted for another person.
    // The submitter becomes the beneficiary's referrer (external → 'Personal').
    const mediator = (req.referrerExternal && typeof req.referrerExternal === 'object') ? req.referrerExternal : null;
    const mediatorName = String(
      mediator?.name || [mediator?.firstName, mediator?.lastName].filter(Boolean).join(' ') || '',
    ).trim();
    const mediatorPhone = String(mediator?.primary_phone || '').trim();
    const firstName = String(external.firstName || submitted.firstName || '').trim();
    const fatherName = String(external.fatherName || submitted.fatherName || '').trim();
    const lastName = String(external.lastName || submitted.lastName || '').trim();
    const primaryPhone = String(external.primary_phone || submitted.phoneNumber || '').trim();
    const secondaryPhone = String(external.secondary_phone || submitted.secondaryPhone || '').trim();
    const primaryPhoneHasWhatsapp = Boolean(external.primaryPhoneHasWhatsapp ?? submitted.primaryPhoneHasWhatsapp);
    const secondaryPhoneHasWhatsapp = Boolean(external.secondaryPhoneHasWhatsapp ?? submitted.secondaryPhoneHasWhatsapp);
    const detailedAddress = String(address.detailedAddress || address.detailed_address || submitted.detailedAddress || '').trim();
    const mapLocation = address.mapLocation || submitted.mapLocation || null;
    const contacts = [
      primaryPhone ? {
        id: 'water-check-primary',
        type: 'mobile',
        number: primaryPhone,
        hasWhatsApp: primaryPhoneHasWhatsapp,
        isPrimary: true,
        status: 'active',
      } : null,
      secondaryPhone ? {
        id: 'water-check-secondary',
        type: 'mobile',
        number: secondaryPhone,
        hasWhatsApp: secondaryPhoneHasWhatsapp,
        isPrimary: false,
        status: 'active',
      } : null,
    ].filter(Boolean);

    return {
      firstName,
      fatherName: fatherName || null,
      lastName,
      name: [firstName, fatherName, lastName].filter(Boolean).join(' '),
      mobile: primaryPhone,
      secondaryPhone,
      primaryPhoneHasWhatsapp,
      secondaryPhoneHasWhatsapp,
      contacts,
      branchId: req.branchId,
      governorate: Number(address.governorateId ?? submitted.governorateId) || null,
      district: Number(address.regionId ?? submitted.regionId) || null,
      neighborhood: Number(address.neighborhoodId ?? submitted.neighborhoodId ?? address.subdistrictId ?? submitted.subdistrictId) || null,
      detailedAddress,
      gpsCoordinates: mapLocation,
      referrerType: req.referrerClientId ? 'Client' : (mediatorName ? 'Personal' : 'Unknown'),
      referrerId: req.referrerClientId ?? null,
      referrerName: req.referrerClientId ? (req.referrerClientName || mediatorName || null) : (mediatorName || null),
      sourceChannel: 'App',
      referralReason: `طلب فحص المياه ${req.publicRefNumber ?? requestId}`,
      referralNotes: mediatorName
        ? `طلب فحص المياه ${req.publicRefNumber ?? requestId} من تطبيق الموبايل — وسيط: ${mediatorName}${mediatorPhone ? ` (${mediatorPhone})` : ''}.`
        : `طلب فحص المياه ${req.publicRefNumber ?? requestId} من تطبيق الموبايل.`,
      notes: [
        `تم إنشاء السجل من طلب فحص المياه ${req.publicRefNumber ?? requestId}.`,
        mediatorName ? `الوسيط: ${mediatorName}${mediatorPhone ? ` - ${mediatorPhone}` : ''}.` : null,
        external.notes || submitted.notes || null,
      ].filter(Boolean).join('\n'),
      isCandidate: false,
    };
  }

  function getApiPayload(error: any) {
    return error?.payload ?? error?.response?.data ?? null;
  }

  async function createWaterCheckClientFromRequest() {
    setWaterCheckClientDraft(getWaterCheckClientPayload());
    setWaterCheckClientModalOpen(true);
  }

  async function submitWaterCheckClientFromRequest(clientData: Client) {
    const payload = {
      ...clientData,
      branchId: clientData.branchId ?? req.branchId,
      isCandidate: false,
      referralReason: (clientData as any).referralReason ?? `طلب فحص المياه ${req.publicRefNumber ?? requestId}`,
    };
    if (!payload.firstName || !payload.lastName || !payload.mobile) {
      showToast('الاسم الأول والكنية ورقم الموبايل الأساسي حقول مطلوبة قبل إنشاء الزبون.', 'error');
      return;
    }
    if (!payload.branchId) {
      showToast('لا يمكن إنشاء الزبون قبل تحديد فرع الطلب.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api.clients.create(payload);
      await api.serviceRequests.link(requestId, { beneficiaryClientId: created.id });
      setWaterCheckClientModalOpen(false);
      showToast('تم إنشاء سجل جديد وربطه بطلب فحص المياه', 'success');
      await reload();
    } catch (e: any) {
      const payload = getApiPayload(e);
      if (payload?.status === 'MATCH_VISIBLE') {
        showToast(`الرقم موجود مسبقاً: ${payload.client?.name ?? `#${payload.client?.id}`}. راجع المقارنة قبل الربط.`, 'error');
      } else if (payload?.status === 'MATCH_RESTRICTED') {
        showToast(payload.message ?? 'الرقم موجود مسبقاً خارج نطاق عرضك.', 'error');
      } else {
        showToast(e?.message ?? 'تعذر إنشاء السجل من بيانات الطلب', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  // ── Mediator (referrer) → its own client record, same mechanism as beneficiary ──
  function getMediatorClientPayload() {
    const m = (req.referrerExternal && typeof req.referrerExternal === 'object') ? req.referrerExternal : {};
    const firstName = String(m.firstName || '').trim();
    const lastName = String(m.lastName || '').trim();
    const primaryPhone = String(m.primary_phone || '').trim();
    const detailedAddress = String(m.detailedAddress || '').trim();
    const contacts = primaryPhone ? [{
      id: 'mediator-primary',
      type: 'mobile',
      number: primaryPhone,
      hasWhatsApp: Boolean(m.primaryPhoneHasWhatsapp),
      isPrimary: true,
      status: 'active',
    }] : [];
    return {
      firstName,
      lastName,
      name: [firstName, lastName].filter(Boolean).join(' '),
      mobile: primaryPhone,
      primaryPhoneHasWhatsapp: Boolean(m.primaryPhoneHasWhatsapp),
      contacts,
      occupation: m.occupation || null,
      branchId: req.branchId,
      governorate: Number(m.governorateId) || null,
      district: Number(m.regionId) || null,
      neighborhood: Number(m.neighborhoodId ?? m.subdistrictId) || null,
      detailedAddress,
      referrerType: 'Unknown',
      sourceChannel: 'App',
      referralReason: `وسيط طلب فحص المياه ${req.publicRefNumber ?? requestId}`,
      referralNotes: `أُنشئ كوسيط لطلب فحص المياه ${req.publicRefNumber ?? requestId}.`,
      notes: [
        `تم إنشاء هذا السجل كوسيط لطلب فحص المياه ${req.publicRefNumber ?? requestId}.`,
        m.notes || null,
      ].filter(Boolean).join('\n'),
      isCandidate: false,
    };
  }

  async function createMediatorClientFromRequest() {
    setMediatorClientDraft(getMediatorClientPayload());
    setMediatorClientModalOpen(true);
  }

  async function submitMediatorClientFromRequest(clientData: Client) {
    const payload = {
      ...clientData,
      branchId: clientData.branchId ?? req.branchId,
      isCandidate: false,
      referralReason: (clientData as any).referralReason ?? `وسيط طلب فحص المياه ${req.publicRefNumber ?? requestId}`,
    };
    if (!payload.firstName || !payload.lastName || !payload.mobile) {
      showToast('الاسم الأول والكنية ورقم الموبايل الأساسي حقول مطلوبة قبل إنشاء الوسيط.', 'error');
      return;
    }
    if (!payload.branchId) {
      showToast('لا يمكن إنشاء الوسيط قبل تحديد فرع الطلب.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api.clients.create(payload);
      await api.serviceRequests.linkReferrer(requestId, created.id);
      setMediatorClientModalOpen(false);
      showToast('تم إنشاء سجل الوسيط وربطه بالطلب كمُحيل', 'success');
      await reload();
    } catch (e: any) {
      const p = getApiPayload(e);
      if (p?.status === 'MATCH_VISIBLE') {
        showToast(`الرقم موجود مسبقاً: ${p.client?.name ?? `#${p.client?.id}`}. اربطه من قائمة المقترحات.`, 'error');
      } else if (p?.status === 'MATCH_RESTRICTED') {
        showToast(p.message ?? 'الرقم موجود مسبقاً خارج نطاق عرضك.', 'error');
      } else {
        showToast(e?.message ?? 'تعذر إنشاء سجل الوسيط', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function linkReferrerSuggested(match: { source: 'client' | 'candidate'; id: number }) {
    if (match.source !== 'client') {
      showToast('الوسيط يُربط بزبون فقط.', 'error');
      return;
    }
    await api.serviceRequests.linkReferrer(requestId, match.id);
    await reload();
  }

  function getCandidatePayloadFromRequest() {
    const external = req.beneficiaryExternal ?? req.requesterExternal ?? {};
    const submitted = req.submittedPayload?.data ?? {};
    const address = req.serviceAddress ?? {};
    const rawName = String(external.name || submitted.name || '').trim();
    const nameParts = rawName.split(/\s+/).filter(Boolean);
    const firstName = String(external.firstName || submitted.firstName || nameParts[0] || '').trim();
    const lastName = String(external.lastName || submitted.lastName || nameParts.slice(1).join(' ') || '').trim();
    const primaryPhone = String(external.primary_phone || submitted.phoneNumber || submitted.phone || '').trim();
    const secondaryPhone = String(external.secondary_phone || submitted.secondaryPhone || '').trim();
    const addressText = String(address.detailedAddress || address.detailed_address || submitted.detailedAddress || '').trim();
    const geoUnitId = Number(
      address.neighborhoodId
      ?? submitted.neighborhoodId
      ?? address.subdistrictId
      ?? submitted.subdistrictId
      ?? address.regionId
      ?? submitted.regionId
      ?? address.governorateId
      ?? submitted.governorateId,
    ) || null;
    const contacts = [
      primaryPhone ? {
        id: 'service-request-primary',
        type: 'mobile',
        number: primaryPhone,
        isPrimary: true,
        status: 'active',
      } : null,
      secondaryPhone ? {
        id: 'service-request-secondary',
        type: 'mobile',
        number: secondaryPhone,
        isPrimary: false,
        status: 'active',
      } : null,
    ].filter(Boolean);

    return {
      firstName,
      lastName,
      mobile: primaryPhone,
      contacts,
      addressText,
      geoUnitId,
      branchId: req.branchId ?? undefined,
      referralOriginChannel: req.channel,
      referralNameSnapshot: external.name || rawName || [firstName, lastName].filter(Boolean).join(' '),
      referralReason: `طلب خدمة ${req.publicRefNumber ?? requestId}`,
      status: 'Suggested',
      candidateNotes: [
        `تم إنشاء المرشح من طلب خدمة ${req.publicRefNumber ?? requestId}.`,
        external.notes || submitted.notes || null,
      ].filter(Boolean).join('\n'),
    };
  }

  async function createCandidateFromRequest() {
    setBusy(true);
    try {
      const created = await api.candidates.create(getCandidatePayloadFromRequest());
      await api.serviceRequests.link(requestId, { beneficiaryCandidateId: created.id });
      showToast('تم إنشاء مرشح جديد وربطه بالطلب', 'success');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? 'تعذر إنشاء المرشح من بيانات الطلب', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function attachToPeriodicCandidate() {
    if (!periodicCandidate) return;
    const note = prompt('ملاحظة الإلحاق بالدورية (اختياري):') ?? null;
    setBusy(true);
    try {
      await api.serviceRequests.attachPeriodic(requestId, periodicCandidate.taskId, note);
      showToast(`تم ربط البلاغ بالدورية #${periodicCandidate.taskId}`, 'success');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? 'فشل ربط البلاغ بالدورية', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function linkSuggested(m: { source: 'client' | 'candidate'; id: number }) {
    if (isWaterCheck && m.source !== 'client') {
      showToast('طلب فحص المياه يمكن ربطه بزبون فقط.', 'error');
      return;
    }
    await api.serviceRequests.link(requestId, {
      [m.source === 'client' ? 'beneficiaryClientId' : 'beneficiaryCandidateId']: m.id,
    });
    await reload();
  }

  const modalInputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50';
  const modalLabelClass = 'space-y-1 text-sm font-semibold text-slate-700';

  return (
    <div className="max-w-6xl mx-auto p-6" dir="rtl">
      {/* Top bar */}
      <div className="mb-4">
        <Button variant="ghost" size="sm" icon={ArrowRight} onClick={() => navigate(-1)}>
          عودة
        </Button>
      </div>

      {/* Hero */}
      <div className="mb-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-l from-sky-50/70 to-white px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
              <Hash className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-black text-slate-800">
                <span dir="ltr" className="font-mono">{req.publicRefNumber}</span>
                <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">
                  {req.requestTypeLabel ?? req.requestType}
                </span>
              </h1>
              <div className="mt-1 text-xs text-slate-400">
                أُنشئ {new Date(req.createdAt).toLocaleString('ar-SY')}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[req.status]}`}>
              {req.statusLabel ?? STATUS_LABELS[req.status] ?? req.status}
            </span>
            {req.duplicateFlag && (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">مُكَرَّر</span>
            )}
            {req.reviewRequiredFlag && (
              <span className="rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-700">يحتاج مراجعة</span>
            )}
            {req.archivedAt && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">مُؤرشَف</span>
            )}
            {isEscalated && (
              <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">مُصعَّد</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
          {[
            { label: 'القناة', value: req.channelLabel ?? req.channel },
            { label: 'الأولوية', value: req.priority ?? '—' },
            { label: 'المُستلِم', value: req.reviewedByUserName ?? 'لم يتول أحد' },
            { label: 'الفرع', value: req.branchName ?? 'غير محدد' },
          ].map((tile) => (
            <div key={tile.label} className="bg-white px-5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</div>
              <div className="mt-0.5 text-sm font-bold text-slate-700">{tile.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* SR-ESC-01 — escalation (restricted mode) banner */}
      {isEscalated && (
        <div className="bg-red-50 border border-red-300 rounded p-3 mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-red-900">
              <div className="font-bold">الطلب مُصعَّد إلى المدقّق — وضع مقيَّد</div>
              <div className="mt-1 text-red-800">
                كل الإجراءات محجوبة حتى <span className="font-semibold">فكّ التصعيد</span> أو <span className="font-semibold">الرفض</span>.
                {req.escalatedByUserName && <> صعّده: {req.escalatedByUserName}.</>}
                {req.escalationReason && <> السبب: {req.escalationReason}.</>}
              </div>
            </div>
            {canResolveEscalation && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => safeRun(
                  () => api.serviceRequests.resolveEscalation(requestId, prompt('سبب فكّ التصعيد (اختياري):') ?? null),
                  '✓ تَمَّ فكّ التصعيد — عادت الإجراءات',
                )}
              >
                فكّ التصعيد
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Action bar */}
      {isActive && (
        <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-sky-100 bg-sky-50/60 p-3.5 shadow-sm">
          {req.status === 'received' && canReview && !isEscalated && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.claim(requestId))}
            >
              تَولّي الطلب
            </Button>
          )}
          {req.status === 'in_review' && !isOwner && canReview && !isEscalated && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.takeOver(requestId))}
            >
              نَقل الـ Ownership إليّ
            </Button>
          )}
          {req.status === 'in_review' && canReview && !isEscalated && (
            <>
              {/* V1.0: "طلب معلومة من الزبون" مُؤجَّل (awaiting_customer_info خارج V1.0).
                  الكود يَبقى في الـ stateMachine للـ V2. */}
              {!isWaterCheck && canPromote && (
                <Button
                  size="sm"
                  icon={ArrowUpCircle}
                  disabled={busy || !canDoPromote}
                  onClick={doPromote}
                  title={
                    canDoPromote
                      ? 'تَرقية الطلب إلى مهمة طوارئ'
                      : `يَنقصك: ${promoteMissing.join(' + ')}`
                  }
                >
                  ترقية إلى مهمة{!canDoPromote && ` (${promoteMissing.length} ينقص)`}
                </Button>
              )}
              {isWaterCheck && canPromote && (
                <Button
                  size="sm"
                  icon={ArrowUpCircle}
                  disabled={busy || !canDoWaterCheckHandoff}
                  onClick={openWaterCheckTaskModal}
                  title={
                    canDoWaterCheckHandoff
                      ? 'إنشاء مهمة عرض جهاز'
                      : waterCheckHandoffMissing.length > 0
                        ? `ينقصك: ${waterCheckHandoffMissing.join(' + ')}`
                        : 'لا تملك صلاحية إنشاء مهمة ضمن فرع هذا الطلب'
                  }
                >
                  إنشاء مهمة عرض جهاز{!canDoWaterCheckHandoff && waterCheckHandoffMissing.length > 0 && ` (${waterCheckHandoffMissing.length} ينقص)`}
                </Button>
              )}
              <Button
                size="sm"
                icon={ClipboardCheck}
                disabled={busy}
                onClick={() => setActionModal('resolveAtIntake')}
              >
                حُلَّ في الاستلام
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => setActionModal('escalate')}
              >
                تَصعيد للمدقّق
              </Button>
            </>
          )}
          {/* V1.0: awaiting_customer_info خارج النطاق — زر "العَودة للمراجعة" مَخفي.
              لو وُجد سجل قديم بهذه الحالة، يَبقى الزر للأمان. */}
          {req.status === 'awaiting_customer_info' && canReview && !isEscalated && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.resumeReview(requestId))}
            >
              العَودة للمراجعة (سجل قديم)
            </Button>
          )}
          {(req.reviewRequiredFlag || isEscalated) && canReject && (
            <Button
              variant="danger"
              size="sm"
              icon={X}
              disabled={busy}
              onClick={() => setActionModal('reject')}
            >
              رَفض (مدقّق)
            </Button>
          )}
          {canReview && req.status !== 'received' && !isEscalated && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setActionModal('cancel')}
            >
              إلغاء إداري
            </Button>
          )}
        </div>
      )}
      {!isWaterCheck && req.status === 'in_review' && canPromote && periodicCandidate && (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-emerald-900">
              <div className="font-bold flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                توجد صيانة دورية قريبة لهذا الجهاز
              </div>
              <div className="mt-1 text-emerald-800">
                المهمة #{periodicCandidate.taskId}، تاريخها {periodicCandidate.dueDate}،
                الفارق {periodicCandidate.daysUntilDue} يوم ضمن نافذة {periodicCandidate.attachWindowDays} يوم.
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                disabled={busy}
                onClick={attachToPeriodicCandidate}
              >
                الاكتفاء بالدورية وربط البلاغ
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canDoPromote}
                onClick={doPromote}
              >
                إنشاء طارئة مستقلة
              </Button>
            </div>
          </div>
        </div>
      )}
      {isTerminal && canArchive && !req.archivedAt && (
        <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => safeRun(() => api.serviceRequests.archive(requestId, prompt('سبب الأرشفة (اختياري):') ?? null))}
          >
            أرشفة
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4">
        <nav className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-100 bg-slate-50 p-1">
          {visibleTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === t
                  ? 'bg-white text-sky-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
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

      {tab === 'overview' && (isWaterCheck ? (
        <WaterCheckRequestDetailPanel
          request={req}
          handoff={{
            permissionDenied: !canWaterCheckHandoffByPermission,
            missing: waterCheckHandoffMissing,
            onOpenTask: (taskId) => {
              const detailPath = getOpenTaskDetailPath('device_demo', taskId);
              if (detailPath) navigate(detailPath);
            },
          }}
        />
      ) : (
        <div className="space-y-3">
          {/* V1.0 §١٢ — promote readiness checklist (visible in in_review only). */}
          {!isWaterCheck && req.status === 'in_review' && !canDoPromote && (
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
                  <Button variant="gold" size="sm" onClick={() => setTab('linkage')}>
                    اذهب إلى الربط ←
                  </Button>
                )}
                {req.beneficiaryClientId && !req.installedDeviceId && canReview && (
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={async () => {
                      const idStr = prompt('أَدخِل installed_device_id من أجهزة الزبون:');
                      const did = Number(idStr);
                      if (!Number.isFinite(did) || did <= 0) return;
                      await safeRun(
                        () => api.serviceRequests.link(requestId, { installedDeviceId: did }),
                        '✓ تَمَّ ربط الجهاز',
                      );
                    }}
                  >
                    ربط جهاز
                  </Button>
                )}
                {activeProblems.length === 0 && (
                  <Button variant="gold" size="sm" onClick={() => setTab('problems')}>
                    إضافة عطل ←
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <h3 className="mb-2 flex items-center gap-1.5 font-bold text-slate-800">
              <ClipboardCheck className="h-4 w-4 text-slate-400" />
              شكوى الزبون
            </h3>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{req.problemDescription}</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-1.5 font-bold text-slate-800">
              <UserCheck className="h-4 w-4 text-sky-500" />
              البيانات والربط
            </h3>
            <div className="grid gap-3 md:grid-cols-3">
              <DetailField label="صاحب الطلب" value={req.requesterExternal?.name} />
              <DetailField label="رقم الهاتف" value={req.requesterExternal?.primary_phone} />
              <DetailField
                label="عنوان الخدمة"
                value={req.serviceAddress ? `${req.serviceAddress.governorate ?? ''} — ${req.serviceAddress.detailed_address ?? ''}` : ''}
              />
              <DetailField label="الزبون المربوط" value={req.beneficiaryClientId ? `#${req.beneficiaryClientId}` : ''} />
              <DetailField label="الجهاز المربوط" value={req.installedDeviceId ? `#${req.installedDeviceId}` : ''} />
              <DetailField label="الأولوية" value={req.priority} />
            </div>
          </div>

          {req.linkedOpenTaskId && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm">
              <h3 className="mb-2 font-bold text-purple-800">المهمة المُرتبطة</h3>
              <button
                onClick={() => {
                  const detailPath = getOpenTaskDetailPath(req.requestType ?? 'emergency_maintenance', req.linkedOpenTaskId);
                  if (detailPath) navigate(detailPath);
                }}
                className="text-sm font-semibold text-purple-700 hover:underline"
              >
                open_task #{req.linkedOpenTaskId} ←
              </button>
            </div>
          )}
        </div>
      ))}

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

      {tab === 'linkage' && isWaterCheck && (
        <div className="space-y-3">
          {req.beneficiaryClientId ? (
            <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              <UserCheck className="ml-1 inline h-4 w-4 text-green-700" />
              مربوط بالزبون: {req.beneficiaryClientName ?? `#${req.beneficiaryClientId}`}
            </div>
          ) : (
            <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              لا يوجد زبون مرتبط بعد. طلب فحص المياه لا يرتبط بمرشح، ويجب ربطه بزبون قبل التحويل إلى مهمة.
            </div>
          )}
          {req.beneficiaryClientId && beneficiarySnapshot && (
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <ClientSnapshot data={beneficiarySnapshot} />
            </div>
          )}
          {canReview && isActive && !canLink && (
            <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              تولَّ الطلب أولاً (زر «تَولّي الطلب») قبل ربطه بزبون.
            </div>
          )}
          {canReview && canLink && (
            <SuggestedMatchesPanel
              serviceRequestId={requestId}
              request={req}
              onLink={linkSuggested}
              sources="clients"
              canCreateFromRequest={!!canCreateWaterCheckClient}
              createBusy={busy}
              onCreateFromRequest={createWaterCheckClientFromRequest}
            />
          )}

          {hasMediator && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <UserCheck className="h-4 w-4 text-amber-600" />
                ربط الوسيط (المُحيل) بسجل زبون
              </h3>
              {req.referrerClientId ? (
                <>
                  <div className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">
                    <UserCheck className="ml-1 inline h-4 w-4 text-green-700" />
                    الوسيط مربوط بالزبون: {req.referrerClientName ?? `#${req.referrerClientId}`}
                  </div>
                  {referrerSnapshot && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                      <ClientSnapshot data={referrerSnapshot} />
                    </div>
                  )}
                </>
              ) : canReview && canLink ? (
                <SuggestedMatchesPanel
                  serviceRequestId={requestId}
                  request={req}
                  party="referrer"
                  sources="clients"
                  onLink={linkReferrerSuggested}
                  canCreateFromRequest={!!canCreateMediatorClient}
                  createBusy={busy}
                  onCreateFromRequest={createMediatorClientFromRequest}
                />
              ) : canReview && isActive && !canLink ? (
                <div className="text-sm text-sky-800">تولَّ الطلب أولاً لربط الوسيط.</div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {tab === 'linkage' && !isWaterCheck && (
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
          {req.beneficiaryClientId && beneficiarySnapshot && (
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <ClientSnapshot data={beneficiarySnapshot} />
            </div>
          )}
          {canReview && isActive && !canLink && (
            <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              تولَّ الطلب أولاً (زر «تَولّي الطلب») قبل ربطه بزبون أو مرشح.
            </div>
          )}
          {canReview && canLink && (
            <SuggestedMatchesPanel
              serviceRequestId={requestId}
              request={req}
              onLink={linkSuggested}
              canCreateFromRequest={canCreateCandidateFromRequest}
              createBusy={busy}
              onCreateFromRequest={createCandidateFromRequest}
            />
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

      <ClientModal
        isOpen={waterCheckClientModalOpen}
        onClose={() => {
          if (!busy) setWaterCheckClientModalOpen(false);
        }}
        onSave={submitWaterCheckClientFromRequest}
        initialData={waterCheckClientDraft as Client | null}
        geoUnits={geoUnits}
      />

      <ClientModal
        isOpen={mediatorClientModalOpen}
        onClose={() => {
          if (!busy) setMediatorClientModalOpen(false);
        }}
        onSave={submitMediatorClientFromRequest}
        initialData={mediatorClientDraft as Client | null}
        geoUnits={geoUnits}
      />

      <Modal
        isOpen={waterCheckTaskModalOpen}
        onClose={() => {
          if (!busy) setWaterCheckTaskModalOpen(false);
        }}
        title="إنشاء مهمة عرض جهاز"
        subtitle={req.publicRefNumber}
        size="2xl"
        closeOnBackdrop={!busy}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setWaterCheckTaskModalOpen(false)}
            >
              إلغاء
            </Button>
            <Button
              loading={busy}
              disabled={busy || !waterCheckTaskDraft.creationReason}
              onClick={submitWaterCheckHandoff}
            >
              إنشاء المهمة
            </Button>
          </>
        }
      >
        <div className="space-y-5 p-5" dir="rtl">
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            سيتم إنشاء مهمة عرض جهاز وربطها بهذا الطلب بعد تأكيدك. راجع الزبون والفرع قبل المتابعة.
          </div>

          <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-slate-500">الزبون</div>
              <div className="mt-1 font-semibold text-slate-800">{req.beneficiaryClientName ?? `#${req.beneficiaryClientId}`}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">الفرع</div>
              <div className="mt-1 font-semibold text-slate-800">{req.branchName ?? `#${req.branchId}`}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">نوع المهمة</div>
              <div className="mt-1 font-semibold text-slate-800">عرض جهاز</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">مصدر المهمة</div>
              <div className="mt-1 font-semibold text-slate-800">طلب فحص المياه</div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className={modalLabelClass}>
              <span>سبب إنشاء المهمة <span className="text-red-500">*</span></span>
              <Select
                value={waterCheckTaskDraft.creationReason}
                onChange={(v) => setWaterCheckTaskDraft((prev) => ({ ...prev, creationReason: v }))}
                ariaLabel="سبب إنشاء مهمة عرض الجهاز"
                className="w-full"
                options={[
                  { value: '', label: '— اختر السبب —' },
                  ...deviceDemoReasons,
                ]}
              />
            </label>

            <label className={modalLabelClass}>
              <span>تاريخ مستحق <span className="text-xs font-normal text-slate-400">(اختياري)</span></span>
              <DateField
                value={waterCheckTaskDraft.dueDate}
                onChange={(v) => setWaterCheckTaskDraft((prev) => ({ ...prev, dueDate: v }))}
                className={modalInputClass}
              />
            </label>
          </div>

          <label className={modalLabelClass}>
            <span>الأولوية</span>
            <select
              className={modalInputClass}
              value={waterCheckTaskDraft.priority}
              onChange={(e) => setWaterCheckTaskDraft((prev) => ({
                ...prev,
                priority: e.target.value as 'high' | 'medium' | 'low',
              }))}
            >
              <option value="medium">متوسطة</option>
              <option value="high">عالية</option>
              <option value="low">منخفضة</option>
            </select>
          </label>

          <label className={modalLabelClass}>
            <span>ملاحظة للمهمة</span>
            <textarea
              className={`${modalInputClass} min-h-28 resize-y`}
              value={waterCheckTaskDraft.operatorNote}
              onChange={(e) => setWaterCheckTaskDraft((prev) => ({ ...prev, operatorNote: e.target.value }))}
              placeholder="أي توجيه إضافي لفريق عرض الجهاز"
            />
          </label>
        </div>
      </Modal>

      {actionModal && (
        <TerminalTransitionModal
          mode={actionModal}
          requestType={req.requestType}
          onClose={() => setActionModal(null)}
          onConfirm={handleModalConfirm}
        />
      )}

    </div>
  );
}
