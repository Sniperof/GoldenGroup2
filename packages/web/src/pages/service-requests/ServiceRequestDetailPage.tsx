// ============================================================
// ServiceRequestDetailPage — central detail/action view
// Constitution: maintenance.md §٠.٣ + §٠.٤ + §٠.١٦ + §٠.١٧ + §٠.١٩
// ============================================================
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowUpCircle,
  ClipboardCheck,
  Loader2,
  UserCheck,
  X,
} from '../../components/ui/icons';
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
import { DeviceRequestDetailPanel, DeviceRequestHandoffModal } from '../../components/service-requests/DeviceRequestPanel';
import NameNominationPanel from '../../components/service-requests/NameNominationPanel';
import RequestDetailLayout from '../../components/requests/RequestDetailLayout';
import type { Client, GeoUnit } from '../../lib/types';
import { reviewRequiredReasons } from '../../lib/serviceRequestDisplay';

const PRIORITY_LABELS: Record<string, string> = {
  high: 'عالية',
  medium: 'متوسطة',
  low: 'منخفضة',
  normal: 'عادية',
  Normal: 'عادية',
};

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  const empty = value == null || value === '';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${empty ? 'text-slate-300' : 'text-slate-800'}`}>{empty ? 'غير متوفر' : value}</div>
    </div>
  );
}

export default function ServiceRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [internalNote, setInternalNote] = useState('');
  const [data, setData] = useState<{ request: any; auditLog: any[]; problems: any[] } | null>(null);
  const [collision, setCollision] = useState<{ existingOpenTaskId: number; installedDeviceId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 4 polish — modal for the 4 in_review actions; toasts via sonner
  const [actionModal, setActionModal] = useState<ModalMode | null>(null);
  const [waterCheckClientModalOpen, setWaterCheckClientModalOpen] = useState(false);
  const [waterCheckClientDraft, setWaterCheckClientDraft] = useState<any | null>(null);
  const [mediatorClientModalOpen, setMediatorClientModalOpen] = useState(false);
  const [mediatorClientDraft, setMediatorClientDraft] = useState<any | null>(null);
  const [requesterClientModalOpen, setRequesterClientModalOpen] = useState(false);
  const [requesterClientDraft, setRequesterClientDraft] = useState<any | null>(null);
  const [beneficiarySnapshot, setBeneficiarySnapshot] = useState<any | null>(null);
  const [requesterSnapshot, setRequesterSnapshot] = useState<any | null>(null);
  const [referrerSnapshot, setReferrerSnapshot] = useState<any | null>(null);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [waterCheckTaskModalOpen, setWaterCheckTaskModalOpen] = useState(false);
  const [deviceRequestTaskModalOpen, setDeviceRequestTaskModalOpen] = useState(false);
  const [waterCheckTaskDraft, setWaterCheckTaskDraft] = useState<{
    priority: 'high' | 'medium' | 'low';
    operatorNote: string;
    dueDate: string;
    creationReason: string;
  }>({ priority: 'medium', operatorNote: '', dueDate: '', creationReason: '' });
  const [deviceDemoReasons, setDeviceDemoReasons] = useState<{ value: string; label: string }[]>([]);
  const [beneficiaryDevices, setBeneficiaryDevices] = useState<any[]>([]);
  const [deviceLinkChoice, setDeviceLinkChoice] = useState('');
  const [deviceModels, setDeviceModels] = useState<any[]>([]);
  const [externalModelChoice, setExternalModelChoice] = useState('');

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

  // Level-2 snapshots for linked beneficiary / mediator (shown in the linkage tab).
  const beneficiaryClientId = data?.request?.beneficiaryClientId ?? null;
  const requesterClientId = data?.request?.requesterClientId ?? null;
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
    if (!requesterClientId) { setRequesterSnapshot(null); return; }
    let active = true;
    api.clients.snapshot(Number(requesterClientId))
      .then((r) => { if (active) setRequesterSnapshot(r.snapshot); })
      .catch(() => { if (active) setRequesterSnapshot(null); });
    return () => { active = false; };
  }, [requesterClientId]);

  useEffect(() => {
    if (!beneficiaryClientId) {
      setBeneficiaryDevices([]);
      return;
    }
    api.installedDevices.list({ customerId: Number(beneficiaryClientId) })
      .then((rows) => setBeneficiaryDevices(Array.isArray(rows) ? rows : []))
      .catch(() => setBeneficiaryDevices([]));
  }, [beneficiaryClientId]);

  useEffect(() => {
  if (data?.request?.deviceSource !== 'external_device' && data?.request?.requestType !== 'device_request') return;
    api.deviceModels.list()
      .then((rows) => setDeviceModels(Array.isArray(rows) ? rows : []))
      .catch(() => setDeviceModels([]));
  }, [data?.request?.deviceSource]);

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
    if ((!waterCheckClientModalOpen && !mediatorClientModalOpen && !requesterClientModalOpen) || geoUnits.length > 0) return;
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
  }, [waterCheckClientModalOpen, mediatorClientModalOpen, requesterClientModalOpen, geoUnits.length]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const req = data.request;
  const isEmergencyMaintenance = req.requestType === 'emergency_maintenance';
  const isWaterCheck = req.requestType === 'water_check';
  const isDeviceRequest = req.requestType === 'device_request';
  const isPeriodicMaintenance = req.requestType === 'periodic_maintenance';
  const isGoldenWarranty = req.requestType === 'golden_warranty';
  const isNameNomination = req.requestType === 'name_nomination';
  const hasPartyLinkage = isEmergencyMaintenance || isWaterCheck || isDeviceRequest
    || isPeriodicMaintenance || isGoldenWarranty;
  const requestKindLabel = isEmergencyMaintenance
    ? 'طلب الصيانة الطارئة'
    : isWaterCheck
      ? 'طلب فحص المياه'
      : isDeviceRequest
        ? 'طلب الجهاز'
        : isPeriodicMaintenance
          ? 'طلب الصيانة الدورية'
          : isGoldenWarranty ? 'طلب الكفالة الذهبية' : 'طلب الخدمة';
  const beneficiaryRoleLabel = isDeviceRequest
    ? 'المستفيد من طلب الجهاز'
    : isWaterCheck
      ? 'المستفيد من فحص المياه'
      : isEmergencyMaintenance
        ? 'المستفيد من الصيانة الطارئة'
        : isPeriodicMaintenance
          ? 'المستفيد من الصيانة الدورية'
          : isGoldenWarranty ? 'المستفيد من الكفالة الذهبية' : 'المستفيد';
  const isOwner = req.reviewedByUserId === user?.id;
  // Permission family per request type (request-section-contract.md §5).
  const permFamily = isWaterCheck
    ? 'water_check'
    : isPeriodicMaintenance ? 'periodic_maintenance'
      : isGoldenWarranty ? 'golden_warranty' : isNameNomination ? 'name_nomination' : 'service_requests';
  const canReview = hasPermission(`${permFamily}.review`);
  const canDecide = hasPermission(`${permFamily}.decide`);
  const canResolveEscalation = hasPermission(`${permFamily}.resolve_escalation`);
  const canArchive = hasPermission(`${permFamily}.archive`);
  const isActive = ['received', 'in_review', 'awaiting_customer_info'].includes(req.status);
  const isTerminal = !isActive;
  // SR-ESC-01 — restricted mode: while escalated, only reject + de-escalate are allowed.
  const isEscalated = !!req.escalatedAt;
  const hasBeneficiaryClient = req.beneficiaryClientId != null;
  const reviewReasons = reviewRequiredReasons(data.auditLog);
  const canOfferReject = req.status === 'in_review'
    && req.reviewedByUserId != null
    && (req.reviewRequiredFlag || isEscalated || isNameNomination)
    && canDecide;
  const canReject = canOfferReject && (hasBeneficiaryClient || isNameNomination);
  // SR-LINK-01 — linking (and create-from-request) requires the request to be
  // claimed first. Only available in_review and while not escalated.
  const canLink = req.status === 'in_review' && !isEscalated;
  const canCreateBeneficiaryClient =
    (isWaterCheck || isDeviceRequest || isPeriodicMaintenance || isGoldenWarranty)
    && canLink
    && !req.beneficiaryClientId
    && (isDeviceRequest || isGoldenWarranty || (req.branchId && req.branchResolutionStatus === 'resolved'))
    && hasPermission('clients.create');
  const canCreateCandidateFromRequest =
    !isWaterCheck && !isDeviceRequest && !isPeriodicMaintenance && !isGoldenWarranty && !isNameNomination
    && canLink
    && !req.beneficiaryClientId
    && !req.beneficiaryCandidateId
    && hasPermission('candidates.create');
  const hasMediator = !!req.referrerExternal;
  const hasIndependentRequester = hasPartyLinkage
    && req.submissionType === 'refer_a_candidate';
  const canCreateRequesterClient =
    hasIndependentRequester
    && canLink
    && !req.requesterClientId
    && (isDeviceRequest || isGoldenWarranty || !!req.branchId)
    && hasPermission('clients.create');
  const canCreateMediatorClient =
    hasPartyLinkage
    && !isGoldenWarranty
    && canLink
    && hasMediator
    && !req.referrerClientId
    && (isDeviceRequest || !!req.branchId)
    && hasPermission('clients.create');

  // V1.0 promote pre-conditions (maintenance-v1.md §١٢)
  const activeProblems = data.problems.filter((p) => p.deletedAt == null);
  const promoteMissing: string[] = [];
  if (!req.beneficiaryClientId) promoteMissing.push('ربط زبون');
  if (req.deviceSource === 'external_device') {
    if (!req.reportedDeviceModelId && !externalModelChoice) promoteMissing.push('ربط الجهاز الآخر بطراز مسجل');
  } else if (!req.installedDeviceId) promoteMissing.push('ربط جهاز من أجهزة المستفيد');
  if (activeProblems.length === 0) promoteMissing.push('عطل واحد على الأقل في اللائحة');
  const canDoPromote = !isWaterCheck && !isDeviceRequest && !isPeriodicMaintenance && !isGoldenWarranty && !isNameNomination && promoteMissing.length === 0;
  const periodicHandoffMissing: string[] = [];
  if (isPeriodicMaintenance && !req.linkedOpenTaskId) {
    if (req.status !== 'in_review') periodicHandoffMissing.push('تولّي الطلب');
    if (!req.beneficiaryClientId) periodicHandoffMissing.push('ربط المستفيد بزبون');
    if (!req.installedDeviceId) periodicHandoffMissing.push('تثبيت الجهاز المقصود');
    if (!req.periodicMaintenanceReasonId) periodicHandoffMissing.push('سبب طلب الصيانة الدورية');
    if (!req.branchId) periodicHandoffMissing.push('تحديد فرع الجهاز');
  }
  const canDoPeriodicHandoff = isPeriodicMaintenance
    && !req.linkedOpenTaskId
    && canDecide
    && periodicHandoffMissing.length === 0;
  const goldenHandoffMissing: string[] = [];
  if (isGoldenWarranty && !req.linkedOpenTaskId) {
    if (req.status !== 'in_review') goldenHandoffMissing.push('تولّي الطلب');
    if (!req.beneficiaryClientId) goldenHandoffMissing.push('ربط المستفيد بزبون');
    if (!req.installedDeviceId) goldenHandoffMissing.push('تثبيت الجهاز المقصود');
    if (!req.requestedWarrantyMonths) goldenHandoffMissing.push('المدة المطلوبة');
    if (!req.beneficiaryContactConsentConfirmed) goldenHandoffMissing.push('موافقة التواصل مع المستفيد');
    if (!req.branchId) goldenHandoffMissing.push('تحديد فرع الجهاز');
  }
  const canDoGoldenHandoff = isGoldenWarranty
    && !req.linkedOpenTaskId
    && canDecide
    && hasPermission('open_tasks.edit')
    && goldenHandoffMissing.length === 0;
  const waterCheckHandoffMissing: string[] = [];
  if (isWaterCheck && !req.linkedOpenTaskId) {
    if (req.status !== 'in_review') waterCheckHandoffMissing.push('استلام الطلب ونقله إلى قيد المراجعة');
    if (!req.beneficiaryClientId) waterCheckHandoffMissing.push('ربط الطلب بزبون موجود');
    if (!req.branchId) waterCheckHandoffMissing.push('تحديد الفرع المرتبط بالطلب');
    if (req.branchResolutionStatus !== 'resolved') waterCheckHandoffMissing.push('حسم ربط الفرع من التغطية الجغرافية');
  }
  const canWaterCheckHandoffByPermission = canDecide && hasPermission('open_tasks.edit');
  const canDoWaterCheckHandoff =
    isWaterCheck
    && !req.linkedOpenTaskId
    && canWaterCheckHandoffByPermission
    && waterCheckHandoffMissing.length === 0;
  const deviceRequestHandoffMissing: string[] = [];
  if (isDeviceRequest && !req.linkedOpenTaskId) {
    if (req.status !== 'in_review') deviceRequestHandoffMissing.push('تولي الطلب');
    if (!req.beneficiaryClientId) deviceRequestHandoffMissing.push('ربط المستفيد بزبون');
    if (!req.branchId || req.branchResolutionStatus !== 'resolved') deviceRequestHandoffMissing.push('اعتماد فرع المستفيد');
    if (req.activeDeviceDemo) deviceRequestHandoffMissing.push('توجد مهمة عرض نشطة');
  }
  const canDoDeviceRequestHandoff = isDeviceRequest
    && canDecide
    && hasPermission('open_tasks.edit')
    && deviceRequestHandoffMissing.length === 0;

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
      const promoteBody = {
        ...(externalModelChoice ? { externalDeviceModelId: Number(externalModelChoice) } : {}),
      };
      let res;
      try {
        res = await api.serviceRequests.promote(requestId, promoteBody);
      } catch (error: any) {
        if (error?.code !== 'device_location_decision_required') throw error;
        const useRegisteredLocation = window.confirm(
          'الموقع المبلّغ عنه يختلف عن موقع الجهاز المسجل. اضغط موافق لاعتماد موقع الجهاز المسجل للمهمة، أو إلغاء للعودة وإنشاء مهمة نقل جهاز منفصلة.',
        );
        if (!useRegisteredLocation) return;
        res = await api.serviceRequests.promote(requestId, {
          ...promoteBody,
          deviceLocationDecision: 'registered_location_confirmed',
        });
      }
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

  async function doPeriodicMaintenanceHandoff() {
    setBusy(true);
    try {
      let result;
      try {
        result = await api.serviceRequests.handoffPeriodicMaintenance(requestId);
      } catch (error: any) {
        if (error?.code !== 'device_location_decision_required') throw error;
        const confirmed = window.confirm(
          'عنوان الطلب يختلف عن موقع الجهاز المسجل. اضغط موافق لاعتماد موقع الجهاز المسجل، أو إلغاء لمعالجة نقل الجهاز أولاً.',
        );
        if (!confirmed) return;
        result = await api.serviceRequests.handoffPeriodicMaintenance(requestId, {
          deviceLocationDecision: 'registered_location_confirmed',
        });
      }
      showToast(`تم إنشاء مهمة الصيانة الدورية #${result.openTaskId}`, 'success');
      await reload();
    } catch (error: any) {
      if (error?.code === 'active_periodic_task_exists') {
        showToast('توجد مهمة صيانة دورية نشطة؛ استخدم حل عند الاستلام.', 'error');
      } else {
        showToast(error?.message ?? 'تعذر إنشاء مهمة الصيانة الدورية', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function doGoldenWarrantyHandoff() {
    setBusy(true);
    try {
      const result = await api.serviceRequests.handoffGoldenWarranty(requestId);
      showToast(`تم إنشاء مهمة عرض الكفالة الذهبية #${result.openTaskId}`, 'success');
      await reload();
    } catch (error: any) {
      const resolveCodes = new Set([
        'active_contract_warranty_exists',
        'active_golden_warranty_exists',
        'active_golden_warranty_offer_exists',
        'device_not_active',
        'device_model_not_golden_warranty_eligible',
        'requested_period_no_longer_available',
      ]);
      showToast(
        resolveCodes.has(error?.code)
          ? 'تعذر إنشاء المهمة بسبب حالة الجهاز الحالية؛ أغلق الطلب بحل عند الاستلام والسبب المطابق.'
          : error?.message ?? 'تعذر إنشاء مهمة عرض الكفالة الذهبية',
        'error',
      );
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
    const sourceLabel = requestKindLabel;
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
      // An unlinked request mediator is preserved on the request snapshot and
      // notes only. `Personal` means the acting user in the clients domain, so
      // using it here would incorrectly attribute the beneficiary to the admin.
      referrerType: req.referrerClientId ? 'Client' : null,
      referrerId: req.referrerClientId ?? null,
      referrerName: req.referrerClientId ? (req.referrerClientName || mediatorName || null) : null,
      sourceChannel: 'App',
      referralReason: `${sourceLabel} ${req.publicRefNumber ?? requestId}`,
      referralNotes: mediatorName
        ? `${sourceLabel} ${req.publicRefNumber ?? requestId} من تطبيق الموبايل — وسيط: ${mediatorName}${mediatorPhone ? ` (${mediatorPhone})` : ''}.`
        : `${sourceLabel} ${req.publicRefNumber ?? requestId} من تطبيق الموبايل.`,
      notes: [
        `تم إنشاء السجل من ${sourceLabel} ${req.publicRefNumber ?? requestId}.`,
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
      referralReason: (clientData as any).referralReason ?? `${requestKindLabel} ${req.publicRefNumber ?? requestId}`,
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
      await api.clients.create({
        ...payload,
        serviceRequestLink: { serviceRequestId: requestId, party: 'beneficiary' },
      });
      setWaterCheckClientModalOpen(false);
      showToast(`تم إنشاء سجل جديد وربطه بـ${requestKindLabel}`, 'success');
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

  function getPartyClientPayload(party: any, roleLabel: string) {
    const firstName = String(party?.firstName || '').trim();
    const fatherName = String(party?.fatherName || '').trim();
    const lastName = String(party?.lastName || '').trim();
    const primaryPhone = String(party?.primary_phone || '').trim();
    const secondaryPhone = String(party?.secondary_phone || '').trim();
    const contacts = [
      primaryPhone ? {
        id: `${roleLabel}-primary`, type: 'mobile', number: primaryPhone,
        hasWhatsApp: Boolean(party?.primaryPhoneHasWhatsapp), isPrimary: true, status: 'active',
      } : null,
      secondaryPhone ? {
        id: `${roleLabel}-secondary`, type: 'mobile', number: secondaryPhone,
        hasWhatsApp: Boolean(party?.secondaryPhoneHasWhatsapp), isPrimary: false, status: 'active',
      } : null,
    ].filter(Boolean);
    return {
      firstName, fatherName, lastName,
      name: [firstName, fatherName, lastName].filter(Boolean).join(' '),
      mobile: primaryPhone,
      primaryPhoneHasWhatsapp: Boolean(party?.primaryPhoneHasWhatsapp),
      contacts,
      branchId: req.branchId,
      referrerType: 'Unknown',
      sourceChannel: 'App',
      referralReason: `${roleLabel} ${requestKindLabel} ${req.publicRefNumber ?? requestId}`,
      notes: `تم إنشاء هذا السجل من ${roleLabel} ${requestKindLabel} ${req.publicRefNumber ?? requestId}.`,
      isCandidate: false,
    };
  }

  async function createRequesterClientFromRequest() {
    setRequesterClientDraft(getPartyClientPayload(req.requesterExternal ?? {}, 'مقدم'));
    setRequesterClientModalOpen(true);
  }

  async function submitRequesterClientFromRequest(clientData: Client) {
    const payload = { ...clientData, branchId: clientData.branchId ?? req.branchId, isCandidate: false };
    if (!payload.firstName || !payload.lastName || !payload.mobile || !payload.branchId) {
      showToast('الاسم الأول والكنية والهاتف الأساسي والفرع مطلوبة لإنشاء مقدم الطلب.', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.clients.create({
        ...payload,
        serviceRequestLink: { serviceRequestId: requestId, party: 'requester' },
      });
      setRequesterClientModalOpen(false);
      showToast('تم إنشاء سجل مقدم الطلب وربطه', 'success');
      await reload();
    } catch (e: any) {
      showToast(e?.message ?? 'تعذر إنشاء سجل مقدم الطلب', 'error');
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
      referralReason: `وسيط ${requestKindLabel} ${req.publicRefNumber ?? requestId}`,
      referralNotes: `أُنشئ كوسيط لـ${requestKindLabel} ${req.publicRefNumber ?? requestId}.`,
      notes: [
        `تم إنشاء هذا السجل كوسيط لـ${requestKindLabel} ${req.publicRefNumber ?? requestId}.`,
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
      referralReason: (clientData as any).referralReason ?? `وسيط ${requestKindLabel} ${req.publicRefNumber ?? requestId}`,
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
      await api.clients.create({
        ...payload,
        serviceRequestLink: { serviceRequestId: requestId, party: 'referrer' },
      });
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

  async function linkSuggested(m: { source: 'client' | 'candidate'; id: number }) {
    if ((isWaterCheck || isDeviceRequest || isPeriodicMaintenance || isGoldenWarranty) && m.source !== 'client') {
      showToast(`${requestKindLabel} يمكن ربطه بزبون فقط.`, 'error');
      return;
    }
    await api.serviceRequests.link(requestId, {
      [m.source === 'client' ? 'beneficiaryClientId' : 'beneficiaryCandidateId']: m.id,
    });
    await reload();
  }

  async function linkRequesterSuggested(match: { source: 'client' | 'candidate'; id: number }) {
    if (match.source !== 'client') {
      showToast('مقدم الطلب يُربط بزبون فقط.', 'error');
      return;
    }
    await api.serviceRequests.linkRequester(requestId, match.id);
    await reload();
  }

  const modalInputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50';
  const modalLabelClass = 'space-y-1 text-sm font-semibold text-slate-700';

  const backPath = isWaterCheck ? '/service-requests/water-check'
    : isDeviceRequest ? '/service-requests/device-requests'
      : isNameNomination ? '/service-requests/name-nomination' : '/service-requests';

  return (
    <RequestDetailLayout
      backPath={backPath}
      activeTab={tab}
      onTabChange={setTab}
      refNumber={req.publicRefNumber}
      typeLabel={req.requestTypeLabel ?? req.requestType}
      createdAt={req.createdAt}
      status={req.status}
      requestType={req.requestType}
      flags={{
        duplicate: !!req.duplicateFlag,
        reviewRequired: !!req.reviewRequiredFlag,
        escalated: isEscalated,
        archived: !!req.archivedAt,
      }}
      infoTiles={[
        { label: 'القناة', value: req.channelLabel ?? req.channel },
        { label: 'الأولوية', value: PRIORITY_LABELS[req.priority] ?? req.priority ?? '—' },
        { label: 'الفرع', value: req.branchName ?? 'غير محدد' },
        { label: 'المهمة المرتبطة', value: req.linkedOpenTaskId ? `#${req.linkedOpenTaskId}` : '—' },
      ]}
      reviewerId={req.reviewedByUserId ?? null}
      reviewerName={req.reviewedByUserName ?? null}
      ownershipActions={
        <>
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
              نقل التولّي إليّ
            </Button>
          )}
          {req.status === 'in_review' && canReview && !isEscalated && (
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => setActionModal('escalate')}
            >
              تَصعيد للمدقّق
            </Button>
          )}
        </>
      }
      banners={
        <>
          {req.reviewRequiredFlag && (
            <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-bold">سبب طلب المراجعة</div>
              {reviewReasons.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pe-5">
                  {reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : (
                <div className="mt-1">لم يُسجّل سبب تفصيلي لهذا الوسم.</div>
              )}
            </div>
          )}
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
        </>
      }
      decision={
        <div className="flex flex-wrap items-center gap-2">
          {/* SR-R005 + state machine: decisions exist only while in_review. */}
          {req.status === 'received' && (
            <p className="text-sm text-slate-500">لا حسم قبل تولّي الطلب.</p>
          )}
          {req.status === 'in_review' && !isEscalated && canDecide && (
            <>
              {!isWaterCheck && !isDeviceRequest && !isPeriodicMaintenance && !isGoldenWarranty && !isNameNomination && (
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
              {isWaterCheck && (
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
              {isDeviceRequest && (
                <Button
                  size="sm"
                  icon={ArrowUpCircle}
                  disabled={busy || !canDoDeviceRequestHandoff}
                  onClick={() => setDeviceRequestTaskModalOpen(true)}
                  title={canDoDeviceRequestHandoff
                    ? 'إنشاء مهمة عرض جهاز'
                    : `ينقصك: ${deviceRequestHandoffMissing.join(' + ')}`}
                >
                  إنشاء مهمة عرض جهاز
                </Button>
              )}
              {isPeriodicMaintenance && (
                <Button
                  size="sm"
                  icon={ArrowUpCircle}
                  disabled={busy || !canDoPeriodicHandoff}
                  onClick={doPeriodicMaintenanceHandoff}
                  title={canDoPeriodicHandoff
                    ? 'إنشاء مهمة صيانة دورية جديدة'
                    : `ينقصك: ${periodicHandoffMissing.join(' + ')}`}
                >
                  إنشاء مهمة صيانة دورية
                </Button>
              )}
              {isGoldenWarranty && (
                <Button
                  size="sm"
                  icon={ArrowUpCircle}
                  disabled={busy || !canDoGoldenHandoff}
                  onClick={doGoldenWarrantyHandoff}
                  title={canDoGoldenHandoff
                    ? 'إنشاء مهمة عرض الكفالة بالمدة المقفلة'
                    : `ينقصك: ${goldenHandoffMissing.join(' + ')}`}
                >
                  إنشاء مهمة عرض الكفالة الذهبية
                </Button>
              )}
              {!isNameNomination && <Button
                size="sm"
                icon={ClipboardCheck}
                disabled={busy || !hasBeneficiaryClient
                  || (isPeriodicMaintenance && (!req.installedDeviceId || !req.activePeriodicMaintenanceTask))}
                onClick={() => setActionModal('resolveAtIntake')}
                title={hasBeneficiaryClient ? 'حل الطلب عند الاستلام' : 'اربط المستفيد بسجل زبون أولاً'}
              >
                حُلَّ في الاستلام
              </Button>}
            </>
          )}
          {canOfferReject && (
            <Button
              variant="danger"
              size="sm"
              icon={X}
              disabled={busy || !canReject}
              onClick={() => setActionModal('reject')}
              title={hasBeneficiaryClient ? 'رفض الطلب' : 'اربط المستفيد بسجل زبون أولاً'}
            >
              رَفض (مدقّق)
            </Button>
          )}
          {req.status === 'in_review' && canDecide && !hasBeneficiaryClient && !isNameNomination && (
            <span className="text-xs font-semibold text-amber-700">اربط المستفيد بسجل زبون قبل الرفض أو الحل عند الاستلام.</span>
          )}
          {isActive && canDecide && req.status !== 'received' && !isEscalated && !isPeriodicMaintenance && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setActionModal('cancel')}
            >
              إلغاء إداري
            </Button>
          )}
          {isTerminal && canArchive && !req.archivedAt && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.archive(requestId, prompt('سبب الأرشفة (اختياري):') ?? null))}
            >
              أرشفة
            </Button>
          )}
          {isTerminal && canArchive && req.archivedAt && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => safeRun(() => api.serviceRequests.unarchive(requestId))}
            >
              إلغاء الأرشفة
            </Button>
          )}
          {isActive && !canDecide && (
            <p className="text-sm text-slate-400">لا تملك صلاحية الحسم على هذا النوع.</p>
          )}
        </div>
      }
      submittedData={isNameNomination ? (
        <NameNominationPanel request={req} canDecide={canDecide && isOwner}
          canCreateCandidates={hasPermission('candidates.create')} onChanged={reload} />
      ) : isWaterCheck ? (
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
      ) : isDeviceRequest ? (
        <DeviceRequestDetailPanel
          request={req}
          onOpenTask={(taskId) => {
            const detailPath = getOpenTaskDetailPath('device_demo', taskId);
            if (detailPath) navigate(detailPath);
          }}
        />
      ) : isGoldenWarranty ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailField
              label="الجهاز كما ورد في الطلب"
              value={req.reportedDeviceSnapshot?.modelName
                ?? (req.installedDeviceId ? `جهاز مسجل #${req.installedDeviceId}` : null)}
            />
            <DetailField label="الرقم التسلسلي" value={req.reportedDeviceSnapshot?.serialNumber} />
            <DetailField
              label="المدة المطلوبة المقفلة"
              value={req.requestedWarrantyPeriodSnapshot?.label
                ?? (req.requestedWarrantyMonths ? `${req.requestedWarrantyMonths} شهر` : null)}
            />
            <DetailField
              label="موافقة التواصل مع المستفيد"
              value={req.beneficiaryContactConsentConfirmed ? 'مؤكدة' : 'غير مؤكدة'}
            />
            <DetailField label="الجهاز المثبت" value={req.installedDeviceId ? `#${req.installedDeviceId}` : null} />
            <DetailField
              label="كفالة فعالة"
              value={req.activeDeviceWarranty?.id
                ? `#${req.activeDeviceWarranty.id} — ${req.activeDeviceWarranty.type}` : null}
            />
            <DetailField
              label="مهمة عرض فعالة"
              value={req.activeGoldenWarrantyOfferTask?.id
                ? `#${req.activeGoldenWarrantyOfferTask.id} — ${req.activeGoldenWarrantyOfferTask.status}` : null}
            />
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            السعر والدفع والتقسيط تُحدد في نتيجة مهمة العرض، ولا يجوز تغيير المدة المختارة في الطلب.
          </p>
        </div>
      ) : isPeriodicMaintenance ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailField
              label="الجهاز كما أبلغ عنه منشئ الطلب"
              value={req.reportedDeviceSnapshot?.deviceName
                ?? req.reportedDeviceSnapshot?.modelName
                ?? (req.installedDeviceId ? `جهاز مسجل #${req.installedDeviceId}` : null)}
            />
            <DetailField label="الرقم التسلسلي المبلّغ عنه" value={req.reportedDeviceSnapshot?.serialNumber} />
            <DetailField label="سبب طلب الصيانة الدورية" value={req.periodicMaintenanceReasonSnapshot?.label} />
            <DetailField label="الجهاز المثبت" value={req.installedDeviceId ? `#${req.installedDeviceId}` : null} />
            <DetailField
              label="عنوان الطلب"
              value={req.serviceAddress?.detailed_address ?? req.serviceAddress?.address_text}
            />
            <DetailField
              label="المهمة الدورية النشطة"
              value={req.activePeriodicMaintenanceTask?.id
                ? `#${req.activePeriodicMaintenanceTask.id} — ${req.activePeriodicMaintenanceTask.status}`
                : null}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DetailField
              label="الجهاز كما أبلغ عنه مقدم الطلب"
              value={req.reportedDeviceSnapshot?.deviceName
                ?? req.reportedDeviceSnapshot?.modelName
                ?? req.externalDeviceName
                ?? (req.installedDeviceId ? `جهاز مسجل #${req.installedDeviceId}` : null)}
            />
            <DetailField
              label="مصدر الطلب الهاتفي"
              value={req.sourceCallLogId ? `سجل اتصال ${req.sourceCallLogId}` : null}
            />
            <DetailField
              label="مؤشرات السلامة"
              value={Array.isArray(req.safetyIndicatorCodes) && req.safetyIndicatorCodes.length
                ? req.safetyIndicatorCodes.join('، ')
                : null}
            />
            <DetailField
              label="قرار موقع تنفيذ المهمة"
              value={req.deviceLocationDecision === 'registered_location_confirmed'
                ? 'اعتماد موقع الجهاز المسجل'
                : req.deviceLocationDecision}
            />
          </div>
          {/* V1.0 §١٢ — promote readiness checklist (visible in in_review only). */}
          {!isWaterCheck && !isDeviceRequest && !isPeriodicMaintenance && !isGoldenWarranty && req.status === 'in_review' && !canDoPromote && (
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
                {req.deviceSource !== 'external_device' && req.beneficiaryClientId && !req.installedDeviceId && canReview && (
                  <div className="flex min-w-[280px] items-center gap-2">
                    <Select
                      value={deviceLinkChoice}
                      onChange={setDeviceLinkChoice}
                      placeholder="اختر جهاز المستفيد"
                      ariaLabel="جهاز المستفيد"
                      className="flex-1"
                      options={beneficiaryDevices.map((device) => ({
                        value: String(device.id),
                        label: `${device.deviceModelName ?? device.externalDeviceName ?? 'جهاز'}${device.serialNumber ? ` — ${device.serialNumber}` : ` — #${device.id}`}`,
                      }))}
                    />
                    <Button
                      variant="gold"
                      size="sm"
                      disabled={!deviceLinkChoice}
                      onClick={() => safeRun(
                        () => api.serviceRequests.link(requestId, { installedDeviceId: Number(deviceLinkChoice) }),
                        '✓ تَمَّ ربط جهاز المستفيد',
                      )}
                    >
                      ربط
                    </Button>
                  </div>
                )}
                {req.deviceSource === 'external_device' && !req.reportedDeviceModelId && canReview && (
                  <div className="min-w-[320px] space-y-1">
                    <Select
                      value={externalModelChoice}
                      onChange={setExternalModelChoice}
                      placeholder="اختر الطراز بعد إضافته في قسم الأجهزة"
                      ariaLabel="طراز الجهاز الخارجي"
                      options={deviceModels.map((model) => ({
                        value: String(model.id),
                        label: model.nameAr ?? model.name_ar ?? model.name ?? `#${model.id}`,
                      }))}
                    />
                    <div className="text-xs text-yellow-800">
                      إن كان الجهاز فريداً، أضف طرازه أولاً في قسم الأجهزة ثم عد لاختياره هنا.
                    </div>
                  </div>
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
            <p className={`whitespace-pre-wrap text-sm ${req.problemDescription ? 'text-slate-700' : 'text-slate-400'}`}>
              {req.problemDescription || 'لم يرفق مقدم الطلب وصفاً للمشكلة.'}
            </p>
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
              <DetailField
                label="الأولوية"
                value={PRIORITY_LABELS[req.priority] ?? req.priority}
              />
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
                فتح المهمة رقم {req.linkedOpenTaskId} ←
              </button>
            </div>
          )}
        </div>
      )}
      extraTabs={!isWaterCheck && !isDeviceRequest && !isPeriodicMaintenance && !isGoldenWarranty ? [{
        id: 'problems',
        label: `الأعطال (${data.problems.filter((p) => p.deletedAt == null).length})`,
        content: (
          <ProblemsList
            serviceRequestId={requestId}
            installedDeviceId={req.installedDeviceId}
            problems={data.problems}
            canEdit={canReview && isActive}
            onRefresh={reload}
          />
        ),
      }] : undefined}
      audit={<AuditLogTimeline events={data.auditLog} />}
      linkage={
        isNameNomination ? undefined : <div>
          {hasPartyLinkage && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-slate-800">أطراف {requestKindLabel}</h2>
            <p className="mt-1 text-sm text-slate-500">
              يعرض كل قسم الطرف المقصود وحالة ربطه. ربط المستفيد مطلوب قبل تحويل الطلب إلى مهمة، أما ربط مقدم الطلب والوسيط فاختياري.
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {hasIndependentRequester && (
                <div className={`rounded-xl border p-3 ${req.requesterClientId ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="text-xs font-semibold text-slate-500">مقدم الطلب</div>
                  <div className={`mt-1 text-sm font-bold ${req.requesterClientId ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {req.requesterClientId ? `مرتبط: ${req.requesterClientName ?? `#${req.requesterClientId}`}` : 'غير مرتبط · اختياري'}
                  </div>
                </div>
              )}
              <div className={`rounded-xl border p-3 ${req.beneficiaryClientId ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="text-xs font-semibold text-slate-500">المستفيد</div>
                <div className={`mt-1 text-sm font-bold ${req.beneficiaryClientId ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {req.beneficiaryClientId
                    ? `مرتبط بزبون: ${req.beneficiaryClientName ?? `#${req.beneficiaryClientId}`}`
                    : req.beneficiaryCandidateId
                      ? `مرتبط بمرشح مؤقتاً: ${req.beneficiaryCandidateName ?? `#${req.beneficiaryCandidateId}`} · يلزم ربط زبون`
                      : 'غير مرتبط · مطلوب'}
                </div>
              </div>
              {hasMediator && (
                <div className={`rounded-xl border p-3 ${req.referrerClientId ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="text-xs font-semibold text-slate-500">الوسيط (المُحيل)</div>
                  <div className={`mt-1 text-sm font-bold ${req.referrerClientId ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {req.referrerClientId ? `مرتبط: ${req.referrerClientName ?? `#${req.referrerClientId}`}` : 'غير مرتبط · اختياري'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {hasIndependentRequester && (
            <section className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
              <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-800">
                <UserCheck className="h-4 w-4 text-sky-600" />
                مقدم الطلب
              </h3>
              <p className="mb-3 mt-1 text-sm text-slate-500">الشخص الذي أرسل الطلب. ربطه بسجل زبون اختياري ولا يغني عن ربط المستفيد.</p>
              {req.requesterClientId ? (
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    مقدم الطلب مرتبط بسجل الزبون: {req.requesterClientName ?? `#${req.requesterClientId}`}
                  </div>
                  {requesterSnapshot && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                      <ClientSnapshot data={requesterSnapshot} />
                    </div>
                  )}
                </>
              ) : canReview && canLink ? (
                <SuggestedMatchesPanel
                  serviceRequestId={requestId}
                  request={req}
                  party="requester"
                  sources="clients"
                  onLink={linkRequesterSuggested}
                  canCreateFromRequest={!!canCreateRequesterClient}
                  createBusy={busy}
                  onCreateFromRequest={createRequesterClientFromRequest}
                  heading="سجلات زبائن مقترحة لمقدم الطلب"
                  createLabel="إنشاء سجل زبون جديد لمقدم الطلب"
                />
              ) : canReview && isActive && !canLink ? (
                <div className="text-sm text-sky-800">تولَّ الطلب أولاً لربط مقدم الطلب.</div>
              ) : null}
            </section>
          )}

          <section className={`rounded-2xl border p-4 ${req.beneficiaryClientId ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-300 bg-amber-50/60'}`}>
            <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-800">
              <UserCheck className={`h-4 w-4 ${req.beneficiaryClientId ? 'text-emerald-600' : 'text-amber-600'}`} />
              {beneficiaryRoleLabel}
              {!req.beneficiaryClientId && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">مطلوب ربط زبون</span>}
            </h3>
            <p className="mb-3 mt-1 text-sm text-slate-500">
              الشخص الذي سيستفيد فعلياً من الخدمة، ويجب تثبيت هويته وربطه بالسجل المقصود قبل الحسم أو التسليم.
            </p>
            {req.beneficiaryClientId ? (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                  المستفيد مرتبط بسجل الزبون: {req.beneficiaryClientName ?? `#${req.beneficiaryClientId}`}
                </div>
                {beneficiarySnapshot && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <ClientSnapshot data={beneficiarySnapshot} />
                  </div>
                )}
              </>
            ) : (
              <>
                {req.beneficiaryCandidateId ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    المستفيد مرتبط مؤقتاً بسجل المرشح: <strong>{req.beneficiaryCandidateName ?? `#${req.beneficiaryCandidateId}`}</strong>. يلزم ربطه بسجل زبون قبل الحسم أو التسليم.
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    الطرف المطلوب ربطه الآن هو <strong>المستفيد</strong>، وليس مقدم الطلب. اختر سجله أدناه أو أنشئ له سجلاً جديداً.
                  </div>
                )}
                {canReview && isActive && !canLink && (
                  <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                    تولَّ الطلب أولاً (زر «تَولّي الطلب») قبل ربط المستفيد.
                  </div>
                )}
                {canReview && canLink && (
                  <div className="mt-3">
                    <SuggestedMatchesPanel
                      serviceRequestId={requestId}
                      request={req}
                      onLink={linkSuggested}
                      sources={isEmergencyMaintenance ? 'all' : 'clients'}
                      canCreateFromRequest={isEmergencyMaintenance ? canCreateCandidateFromRequest : !!canCreateBeneficiaryClient}
                      createBusy={busy}
                      onCreateFromRequest={isEmergencyMaintenance ? createCandidateFromRequest : createWaterCheckClientFromRequest}
                      heading={isEmergencyMaintenance ? 'سجلات زبائن ومرشحين مقترحة للمستفيد' : 'سجلات زبائن مقترحة للمستفيد'}
                      createLabel={isEmergencyMaintenance ? 'إنشاء سجل مرشح جديد للمستفيد' : 'إنشاء سجل زبون جديد للمستفيد'}
                    />
                  </div>
                )}
              </>
            )}
          </section>

          {hasMediator && (
            <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
              <h3 className="flex items-center gap-1.5 text-base font-bold text-slate-800">
                <UserCheck className="h-4 w-4 text-amber-600" />
                الوسيط (المُحيل)
              </h3>
              <p className="mb-3 mt-1 text-sm text-slate-500">الشخص الذي عرّفنا بالمستفيد. ربطه اختياري ويسجله كمُحيل رسمي.</p>
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
                  heading="سجلات زبائن مقترحة للوسيط"
                  createLabel="إنشاء سجل زبون جديد للوسيط"
                />
              ) : canReview && isActive && !canLink ? (
                <div className="text-sm text-sky-800">تولَّ الطلب أولاً لربط الوسيط.</div>
              ) : null}
            </section>
          )}
        </div>
          )}
          {!hasPartyLinkage && (
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
        </div>
      }
      notes={
        canReview ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-slate-500 block mb-1">ملاحظة داخلية</label>
              <input
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="تُسجَّل في سجل التدقيق (ومنها توثيق محاولات التواصل مع الزبون)"
                className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !internalNote.trim()}
              onClick={() => safeRun(async () => {
                await api.serviceRequests.addNote(requestId, internalNote.trim());
                setInternalNote('');
              }, '✓ أُضيفت الملاحظة')}
            >
              إضافة
            </Button>
          </div>
        ) : undefined
      }
      overlays={
        <>
      {collision && (
        <MergeOrSplitModal
          serviceRequestId={requestId}
          existingOpenTaskId={collision.existingOpenTaskId}
          installedDeviceId={collision.installedDeviceId}
          canSplit={hasPermission('service_requests.override_active_emergency')}
          onClose={() => setCollision(null)}
          onResolved={async () => {
            setCollision(null);
            await reload();
          }}
        />
      )}

      {deviceRequestTaskModalOpen && (
        <DeviceRequestHandoffModal
          request={req}
          onClose={() => setDeviceRequestTaskModalOpen(false)}
          onCompleted={async () => {
            setDeviceRequestTaskModalOpen(false);
            showToast('تم إنشاء مهمة عرض الجهاز', 'success');
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

      <ClientModal
        isOpen={requesterClientModalOpen}
        onClose={() => {
          if (!busy) setRequesterClientModalOpen(false);
        }}
        onSave={submitRequesterClientFromRequest}
        initialData={requesterClientDraft as Client | null}
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
        </>
      }
    />
  );
}
