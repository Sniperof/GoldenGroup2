import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { JobApplicationDetail, AuditLog, ApplicationStage, ContactEntry, InterviewerOption } from '../../lib/types';
import { authFetch } from '../../lib/authFetch';
import { useInterviewStore } from '../../hooks/useInterviewStore';
import EmployeeFormModal, { type EmployeeFormInitialValues } from '../../components/employees/EmployeeFormModal';
import Select from '../../components/ui/Select';
import Button from '../../components/ui/Button';
import {
  ArrowRight, User, Briefcase, MapPin, Phone, Mail, Calendar, Users, GraduationCap,
  FileText, Clock, CheckCircle, XCircle, UserPlus, AlertTriangle, Award,
  ChevronDown, ChevronUp, ArrowRightLeft, Car, Monitor, Globe, DollarSign, Archive,
  Eye, Minus, X, Play, ThumbsUp, ThumbsDown, LogOut, Zap, CircleDot,
  ArrowUpRight, ShieldCheck, Ban, RotateCcw, Sparkles, Loader2, Gavel,
  BookOpen, ExternalLink, Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import IconButton from '../../components/ui/IconButton';
import PermissionGate from '../../components/PermissionGate';
import { calculateJobMatchScore } from '../../lib/jobMatch';
import { getUnifiedApplicationState } from '../../lib/applicationState';
import { useAuthStore } from '../../hooks/useAuthStore';
import { fetchInterviewersForApplication } from './interviewerLookup';

const STAGE_LABELS: Record<ApplicationStage, string> = {
  'Submitted': 'استلام الطلب', 'Shortlisted': 'القائمة القصيرة',
  'Interview': 'المقابلة', 'Training': 'التدريب', 'Final Decision': 'القرار النهائي',
};

const STAGE_ICONS: Record<ApplicationStage, React.ElementType> = {
  'Submitted':      FileText,       // وثيقة — استلام الطلب
  'Shortlisted':    Sparkles,       // نجمة — اختيار القائمة القصيرة
  'Interview':      Users,          // أشخاص — مرحلة المقابلة
  'Training':       GraduationCap,  // قبعة — مرحلة التدريب
  'Final Decision': Gavel,          // مطرقة — القرار النهائي
};

const STATUS_LABELS: Record<string, string> = {
  'New': 'جديد', 'In Review': 'قيد المراجعة', 'Qualified': 'مؤهل', 'Rejected': 'مرفوض',
  'Interview Scheduled': 'مقابلة مجدولة', 'Interview Completed': 'مقابلة مكتملة',
  'Interview Failed': 'فشل المقابلة', 'Approved': 'موافق عليه',
  'Training Scheduled': 'تدريب مجدول', 'Training Started': 'تدريب بدأ',
  'Training Completed': 'تدريب مكتمل', 'Retraining': 'إعادة تدريب',
  'Passed': 'ناجح', 'Final Hired': 'تم التوظيف', 'Final Rejected': 'مرفوض نهائياً', 'Retreated': 'منسحب',
};

const STAGE_STATUS_LABELS: Record<string, string> = {
  'Pending': 'قيد الانتظار', 'Under Review': 'قيد المراجعة', 'Ready': 'جاهز',
  'Scheduled': 'مجدول', 'Completed': 'مكتمل', 'In Progress': 'قيد التنفيذ',
  'Awaiting Decision': 'بانتظار القرار',
};

const DECISION_LABELS: Record<string, string> = {
  'Qualified': 'مؤهل', 'Approved': 'موافق عليه', 'Passed': 'ناجح', 'Hired': 'تم التوظيف',
  'Rejected': 'مرفوض', 'Failed': 'فشل', 'Retraining': 'إعادة تدريب', 'Retreated': 'منسحب',
};

const STAGES_ORDER: ApplicationStage[] = ['Submitted', 'Shortlisted', 'Interview', 'Training', 'Final Decision'];

const TERMINAL_STATUSES = ['Rejected', 'Interview Failed', 'Final Hired', 'Final Rejected', 'Retreated'];

type ActionIcon = typeof Play;
interface WorkflowAction {
  label: string;
  description: string;
  newStage: string;
  newStatus: string;
  icon: ActionIcon;
  variant: 'primary' | 'success' | 'danger' | 'warning';
  requiresReason?: boolean;
}

/** Operational (automated) workflow actions — move the process forward */
function getWorkflowActions(stage: ApplicationStage, status: string): WorkflowAction[] {
  switch (stage) {
    case 'Submitted':
      // Review is triggered via the guidance card → review modal (handleReviewDecision).
      return [];
    case 'Interview':
      // Interview result (Completed/Failed) is set exclusively via the interview module.
      // No manual workflow action is exposed here.
      return [];
    case 'Training':
      // Training transitions are managed exclusively via the training module.
      return [];
    default: return [];
  }
}

/** HR decisions — explicit human choices that change the candidate's trajectory */
function getDecisionActions(stage: ApplicationStage, status: string): WorkflowAction[] {
  switch (stage) {
    case 'Submitted':
      if (status === 'In Review') return [
        { label: 'تأهيل', description: 'نقل المتقدم إلى القائمة القصيرة', newStage: 'Shortlisted', newStatus: 'Qualified', icon: ThumbsUp, variant: 'success' },
        { label: 'رفض', description: 'المتقدم لا يستوفي المتطلبات', newStage: 'Submitted', newStatus: 'Rejected', icon: Ban, variant: 'danger', requiresReason: true },
      ];
      return [];
    case 'Shortlisted':
      if (status === 'Qualified') return [
        { label: 'تحويل للمقابلة', description: 'جدولة مقابلة للمرشح', newStage: 'Interview', newStatus: 'Interview Scheduled', icon: ArrowUpRight, variant: 'success' },
        { label: 'رفض', description: 'المرشح لم يعد مناسباً', newStage: 'Shortlisted', newStatus: 'Rejected', icon: Ban, variant: 'danger', requiresReason: true },
      ];
      return [];
    case 'Interview':
      if (status === 'Interview Completed') return [
        { label: 'موافقة وتحويل للتدريب', description: 'اجتاز المقابلة بنجاح', newStage: 'Training', newStatus: 'Approved', icon: ShieldCheck, variant: 'success' },
        { label: 'فشل في المقابلة', description: 'لم يجتز المقابلة', newStage: 'Interview', newStatus: 'Interview Failed', icon: ThumbsDown, variant: 'danger', requiresReason: true },
      ];
      return [];
    case 'Training':
      // أثناء التدريب الجاري لا يظهر أي قرار؛ القرار/النتيجة تُتاح فقط بعد اكتمال الدورة.
      if (status === 'Training Completed') return [
        { label: 'ناجح — تحويل للقرار النهائي', description: 'اجتاز التدريب بتفوق', newStage: 'Final Decision', newStatus: 'Passed', icon: Sparkles, variant: 'success' },
      ];
      return [];
    case 'Final Decision':
      if (status === 'Passed') return [
        { label: 'توظيف نهائي', description: 'إتمام التوظيف وحجز الشاغر', newStage: 'Final Decision', newStatus: 'Final Hired', icon: Award, variant: 'success' },
        { label: 'رفض نهائي', description: 'رفض التوظيف في هذا الشاغر', newStage: 'Final Decision', newStatus: 'Final Rejected', icon: Ban, variant: 'danger', requiresReason: true },
      ];
      return [];
    default: return [];
  }
}

function buildApplicationContacts(detail: JobApplicationDetail): ContactEntry[] {
  const contacts: ContactEntry[] = [];
  const primary = String(detail.applicant?.mobileNumber ?? '').replace(/\D/g, '');
  const secondary = String(detail.applicant?.secondaryMobile ?? '').replace(/\D/g, '');

  if (primary) {
    contacts.push({
      id: 'application-primary',
      type: 'mobile',
      number: primary,
      label: 'أساسي',
      hasWhatsApp: Boolean(detail.applicant?.hasWhatsappPrimary),
      isPrimary: false,
      status: 'active',
    });
  }

  if (secondary) {
    contacts.push({
      id: 'application-secondary',
      type: 'mobile',
      number: secondary,
      label: 'بديل',
      hasWhatsApp: Boolean(detail.applicant?.hasWhatsappSecondary),
      isPrimary: false,
      status: 'active',
    });
  }

  return contacts;
}

function normalizeDrivingLicense(value: unknown): '' | 'yes' | 'no' {
  if (value == null || value === '') return '';
  if (value === true) return 'yes';
  if (value === false) return 'no';
  const raw = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'نعم'].includes(raw)) return 'yes';
  if (['no', 'false', '0', 'لا'].includes(raw)) return 'no';
  return '';
}

function buildApplicationAddressHint(detail: JobApplicationDetail) {
  return [
    detail.applicant?.governorate,
    detail.applicant?.cityOrArea,
    detail.applicant?.subArea,
    detail.applicant?.neighborhood,
    detail.applicant?.detailedAddress,
  ].filter(Boolean).join(' - ');
}

function buildEmployeeInitialValuesFromApplication(detail: JobApplicationDetail): EmployeeFormInitialValues {
  return {
    firstName: detail.applicant?.firstName ?? '',
    lastName: detail.applicant?.lastName ?? '',
    birthDate: detail.applicant?.dob ?? '',
    gender: detail.applicant?.gender === 'male' || detail.applicant?.gender === 'female'
      ? detail.applicant.gender
      : detail.applicant?.gender === 'ذكر'
        ? 'male'
        : detail.applicant?.gender === 'أنثى'
          ? 'female'
          : '',
    maritalStatus: detail.applicant?.maritalStatus ?? '',
    detailedAddress: detail.applicant?.detailedAddress ?? '',
    applicantGovernorate: detail.applicant?.governorate ?? '',
    applicantCityOrArea: detail.applicant?.cityOrArea ?? '',
    applicantSubArea: detail.applicant?.subArea ?? '',
    applicantNeighborhood: detail.applicant?.neighborhood ?? '',
    contacts: buildApplicationContacts(detail),
    academicQualification: detail.applicant?.academicQualification ?? '',
    specialization: detail.applicant?.specialization ?? '',
    yearsOfExperience: detail.applicant?.yearsOfExperience != null ? String(detail.applicant.yearsOfExperience) : '',
    drivingLicense: normalizeDrivingLicense(detail.applicant?.drivingLicense),
    jobSkills: detail.applicant?.computerSkills ?? '',
    foreignLanguages: typeof detail.applicant?.foreignLanguages === 'string'
      ? detail.applicant.foreignLanguages.split(',').map((item) => item.trim()).filter(Boolean)
      : [],
    branchId: detail.branchId ?? null,
    workType: detail.vacancy?.workType ?? '',
    previousEmployment: detail.applicant?.previousEmployment ?? '',
    jobTitle: detail.vacancy?.title ?? '',
    referrerType: detail.referrer?.type === 'Customer'
      ? 'Client'
      : detail.referrer?.type ?? (detail.submissionType === 'Refer a Candidate' ? 'Unknown' : ''),
    sourceChannel: detail.applicationSource ?? '',
    referrerName: detail.referrer?.fullName ?? '',
    referralNotes: detail.referrer?.referrerNotes ?? '',
    referralEntityId: detail.referrer?.referralEntityId ?? detail.referrer?.employeeId ?? null,
  };
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const authUser = useAuthStore(s => s.user);
  const hasPermission = useAuthStore(s => s.hasPermission);
  const actorRole = authUser?.role || 'HR_MANAGER';
  const { scheduleInterview: storeScheduleInterview, fetchInterviews } = useInterviewStore();
  const [detail, setDetail] = useState<JobApplicationDetail | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'details' | 'interviews' | 'training' | 'audit'>('details');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReasonModal, setShowReasonModal] = useState<{ newStage: string; newStatus: string } | null>(null);
  const [showAuditExpanded, setShowAuditExpanded] = useState<number | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');

  // ── Schedule Interview inline ──
  const [showScheduleInterviewModal, setShowScheduleInterviewModal] = useState(false);
  const [interviewForm, setInterviewForm] = useState({
    interviewType: 'HR Interview' as 'HR Interview' | 'Technical Interview',
    interviewNumber: 'First Interview' as 'First Interview' | 'Second Interview',
    interviewerUserId: '',
    interviewDate: '',
    interviewTime: '',
    internalNotes: '',
  });
  const [interviewFormError, setInterviewFormError] = useState('');
  const [interviewSubmitting, setInterviewSubmitting] = useState(false);
  const [interviewerOptions, setInterviewerOptions] = useState<InterviewerOption[]>([]);
  const [loadingInterviewers, setLoadingInterviewers] = useState(false);

  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState('');

  const fetchDetail = () => {
    setLoading(true);
    Promise.all([
      authFetch(`/api/admin/applications/${id}`).then(r => r.json()),
      authFetch(`/api/admin/applications/${id}/audit-logs`).then(r => r.json()),
    ]).then(([app, logs]) => {
      setDetail(app && !app.error ? app : null);
      setAuditLogs(Array.isArray(logs) ? logs : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const loadInterviewerOptions = async () => {
    if (!id) return;
    setLoadingInterviewers(true);
    setInterviewerOptions([]);
    setInterviewFormError('');
    try {
      const rows = await fetchInterviewersForApplication(Number(id));
      setInterviewerOptions(rows);
      if (rows.length === 0) {
        setInterviewFormError('لا يوجد مستخدمون مؤهلون لإجراء مقابلات ضمن هذا الفرع.');
      }
    } catch (err: any) {
      setInterviewFormError(err.message || 'تعذر تحميل قائمة المقابلين المؤهلين.');
    } finally {
      setLoadingInterviewers(false);
    }
  };

  useEffect(() => { fetchDetail(); }, [id]);
  useEffect(() => {
    if (showScheduleInterviewModal) {
      void loadInterviewerOptions();
    }
  }, [showScheduleInterviewModal]);

  const handleStageAction = async (newStage: string, newStatus: string, reason?: string) => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: newStage, status: newStatus,
          internalNotes: reason || null,
          performedByRole: actorRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      fetchDetail();
      setShowReasonModal(null);
      setRejectReason('');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Combined: review → immediate decision (qualify or reject) in two sequential calls
  const handleReviewDecision = async (decision: 'qualify' | 'reject') => {
    setActionLoading(true);
    setActionError('');
    try {
      // Step 1: transition to In Review (records the review event)
      const r1 = await authFetch(`/api/admin/applications/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'Submitted', status: 'In Review', performedByRole: actorRole }),
      });
      if (!r1.ok) { const e = await r1.json(); throw new Error(e.error); }

      // Step 2: apply the actual decision
      const r2 = await authFetch(`/api/admin/applications/${id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          decision === 'qualify'
            ? { stage: 'Shortlisted', status: 'Qualified', internalNotes: reviewNotes || null, performedByRole: actorRole }
            : { stage: 'Submitted', status: 'Rejected', internalNotes: reviewNotes || null, performedByRole: actorRole }
        ),
      });
      if (!r2.ok) { const e = await r2.json(); throw new Error(e.error); }

      setShowReviewModal(false);
      setReviewNotes('');
      fetchDetail();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleScheduleInterview = async () => {
    if (!interviewForm.interviewerUserId) { setInterviewFormError('يجب اختيار المقابِل من القائمة'); return; }
    if (!interviewForm.interviewDate) { setInterviewFormError('تاريخ المقابلة مطلوب'); return; }
    if (!interviewForm.interviewTime) { setInterviewFormError('وقت المقابلة مطلوب'); return; }
    setInterviewFormError('');
    setInterviewSubmitting(true);
    try {
      await storeScheduleInterview({
        jobVacancyId: Number(detail?.vacancy?.id),
        applicationId: Number(id),
        interviewType: interviewForm.interviewType,
        interviewNumber: interviewForm.interviewNumber,
        interviewerUserId: Number(interviewForm.interviewerUserId),
        interviewDate: interviewForm.interviewDate,
        interviewTime: interviewForm.interviewTime,
        internalNotes: interviewForm.internalNotes || undefined,
      } as any);
      fetchInterviews();
      setShowScheduleInterviewModal(false);
      setInterviewForm({ interviewType: 'HR Interview', interviewNumber: 'First Interview', interviewerUserId: '', interviewDate: '', interviewTime: '', internalNotes: '' });
      fetchDetail();
    } catch (err: any) {
      setInterviewFormError(err.message);
    } finally {
      setInterviewSubmitting(false);
    }
  };

  const handleHire = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/hire`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performedByRole: actorRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      fetchDetail();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecisionAction = async (decision: 'Rejected', reason?: string) => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          internalNotes: reason || null,
          performedByRole: actorRole,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      fetchDetail();
      setShowReasonModal(null);
      setRejectReason('');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetreat = () => {
    handleStageAction(detail!.currentStage, 'Retreated', 'انسحاب');
  };

  const [showEscalateConfirm, setShowEscalateConfirm] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');
  const [escalateLoading, setEscalateLoading] = useState(false);
  const [escalateError, setEscalateError] = useState('');
  const [resolveEscalationLoading, setResolveEscalationLoading] = useState(false);
  const [resolveEscalationError, setResolveEscalationError] = useState('');

  const handleEscalate = async () => {
    const reason = escalateReason.trim();
    if (!reason) {
      setEscalateError('سبب التصعيد مطلوب');
      return;
    }
    setEscalateLoading(true);
    setEscalateError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/escalate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setShowEscalateConfirm(false);
      setEscalateReason('');
      fetchDetail();
    } catch (err: any) {
      setEscalateError(err.message);
    } finally {
      setEscalateLoading(false);
    }
  };

  const handleResolveEscalation = async () => {
    setResolveEscalationLoading(true);
    setResolveEscalationError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/resolve-escalation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      fetchDetail();
    } catch (err: any) {
      setResolveEscalationError(err.message);
    } finally {
      setResolveEscalationLoading(false);
    }
  };

  const ARCHIVABLE_STATUSES = ['Final Hired', 'Final Rejected', 'Retreated'];

  const handleArchive = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ performedByRole: actorRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      fetchDetail();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const employeeInitialValues = useMemo(
    () => (detail ? buildEmployeeInitialValuesFromApplication(detail) : undefined),
    [detail],
  );

  const applicationAddressHint = useMemo(
    () => (detail ? buildApplicationAddressHint(detail) : ''),
    [detail],
  );

  const handleCreateEmployeeRecord = async (payload: Record<string, unknown>) => {
    setEmployeeLoading(true);
    setEmployeeError('');
    try {
      const res = await authFetch(`/api/admin/applications/${id}/employee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      setShowEmployeeModal(false);
      fetchDetail();
    } catch (err: any) {
      setEmployeeError(err.message);
    } finally {
      setEmployeeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <p>الطلب غير موجود</p>
      </div>
    );
  }

  const currentStageIdx = STAGES_ORDER.indexOf(detail.currentStage);
  const workflowActions = getWorkflowActions(detail.currentStage, detail.applicationStatus);
  const decisionActions = getDecisionActions(detail.currentStage, detail.applicationStatus);
  const isTerminal = TERMINAL_STATUSES.includes(detail.applicationStatus);
  const isAssistantEscalationLock = authUser?.role === 'HR_ASSISTANT' && detail.isEscalated;
  const isAssistantFinalDecisionLock = authUser?.role === 'HR_ASSISTANT' && detail.currentStage === 'Final Decision';
  const isAssistantWorkflowLocked = isAssistantEscalationLock || isAssistantFinalDecisionLock;
  const canResolveEscalation = detail.isEscalated;
  const assistantLockMessage = isAssistantEscalationLock
    ? 'تم تصعيد الطلب للإدارة، ولا يمكن لمساعد الموارد البشرية متابعة هذا الطلب بعد الآن.'
    : isAssistantFinalDecisionLock
      ? 'القرار النهائي على هذا الطلب من صلاحية مدير الموارد البشرية فقط.'
      : '';
  const unifiedState = getUnifiedApplicationState({
    currentStage: detail.currentStage,
    applicationStatus: detail.applicationStatus,
    stageStatus: detail.stageStatus,
    decision: detail.decision,
    hasScheduledInterview: detail.interviews?.some(i => i.interviewStatus === 'Interview Scheduled'),
  });

  // Compute match score once at render time (used in profile card + review modal)
  const matchResult = (detail.applicant && detail.vacancy)
    ? calculateJobMatchScore(detail.applicant, detail.vacancy)
    : null;

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      {/* Back Button & Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/jobs/applications')}
          className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">طلب التوظيف #{detail.id}</h1>
          <p className="text-sm text-slate-500">{detail.applicant?.firstName} {detail.applicant?.lastName} — {detail.vacancy?.title}</p>
        </div>
      </div>

      {/* Stage Progress Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center justify-between">
          {STAGES_ORDER.map((stage, idx) => {
            const isDone    = idx < currentStageIdx;
            const isCurrent = idx === currentStageIdx;
            const Icon = STAGE_ICONS[stage];
            return (
              <div key={stage} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all shadow-sm ${
                    isDone    ? 'bg-emerald-500 shadow-emerald-200'
                    : isCurrent ? (isTerminal
                        ? (detail.applicationStatus === 'Final Hired' ? 'bg-emerald-500 shadow-emerald-200'
                          : detail.applicationStatus === 'Retreated' ? 'bg-slate-400 shadow-slate-200'
                          : 'bg-red-500 shadow-red-200')
                        : 'bg-sky-500 shadow-sky-200')
                    : 'bg-slate-100'
                  }`}>
                    {isDone
                      ? <CheckCircle className="w-5 h-5 text-white" />
                      : <Icon className={`w-5 h-5 ${isCurrent ? 'text-white' : 'text-slate-400'}`} />}
                  </div>
                  <span className={`text-xs mt-2 font-semibold ${isDone || isCurrent ? 'text-slate-700' : 'text-slate-400'}`}>
                    {STAGE_LABELS[stage]}
                  </span>
                </div>
                {idx < STAGES_ORDER.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-2 rounded transition-all ${isDone ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {actionError}
          <button onClick={() => setActionError('')} className="mr-auto text-red-400 hover:text-red-600"><XCircle className="w-4 h-4" /></button>
        </div>
      )}

      {/* Tabs — underline pattern (Golden Group design system) */}
      <div className="flex gap-1 mb-6 border-b border-[#E3E7EC] flex-wrap">
        {(() => {
          const tabBase = 'relative inline-flex items-center gap-1.5 px-3.5 py-2.5 text-base font-bold transition-colors';
          const tabActive = 'text-sky-600 after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:bg-sky-600 after:rounded-t';
          const tabIdle = 'text-slate-500 hover:text-slate-800';
          const cls = (active: boolean) => `${tabBase} ${active ? tabActive : tabIdle}`;
          return (
            <>
              <button onClick={() => setActiveTab('details')} className={cls(activeTab === 'details')}>
                <FileText className="w-4 h-4" /> التفاصيل
              </button>
              <button onClick={() => setActiveTab('interviews')} className={cls(activeTab === 'interviews')}>
                <Users className="w-4 h-4" /> المقابلات ({detail.interviews?.length || 0})
              </button>
              <button onClick={() => setActiveTab('training')} className={cls(activeTab === 'training')}>
                <BookOpen className="w-4 h-4" /> التدريب ({detail.trainings?.length || 0})
              </button>
              <PermissionGate permission="jobs.applications.view_audit_logs">
                <button onClick={() => setActiveTab('audit')} className={cls(activeTab === 'audit')}>
                  <Clock className="w-4 h-4" /> سجل التدقيق ({auditLogs.length})
                </button>
              </PermissionGate>
            </>
          );
        })()}
      </div>

      {activeTab === 'details' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Applicant Profile */}
          <div className="lg:col-span-2 space-y-5">

            {/* ── 1. Profile Hero ── */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-start gap-5">
                {/* Photo */}
                <div className="shrink-0">
                  {detail.applicant?.photoUrl ? (
                    <img
                      src={detail.applicant.photoUrl}
                      alt={`${detail.applicant.firstName} ${detail.applicant.lastName}`}
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-slate-100 shadow-sm"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center shadow-sm">
                      <span className="text-white text-2xl font-black tracking-tight">
                        {detail.applicant?.firstName?.[0]}{detail.applicant?.lastName?.[0]}
                      </span>
                    </div>
                  )}
                </div>

                {/* Name + score + actions */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800 leading-tight">
                        {detail.applicant?.firstName} {detail.applicant?.lastName}
                      </h2>
                      {detail.applicant?.applicantSegment && (
                        <span className="mt-1 inline-block text-xs px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full font-semibold">
                          {detail.applicant.applicantSegment}
                        </span>
                      )}
                    </div>
                    {/* Match score badge */}
                    {matchResult && (
                      <div className={`shrink-0 flex flex-col items-center px-4 py-2 rounded-xl border ${
                        matchResult.score >= 85 ? 'bg-emerald-50 border-emerald-100' :
                        matchResult.score >= 60 ? 'bg-sky-50 border-sky-100' :
                        matchResult.score >= 40 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'
                      }`}>
                        <span className={`text-2xl font-black leading-none ${
                          matchResult.score >= 85 ? 'text-emerald-600' :
                          matchResult.score >= 60 ? 'text-sky-600' :
                          matchResult.score >= 40 ? 'text-amber-600' : 'text-red-500'
                        }`}>{matchResult.score}%</span>
                        <span className="text-xs text-slate-400 font-medium mt-0.5">التوافق</span>
                      </div>
                    )}
                  </div>

                  {/* Quick-info chips */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                      <Phone className="w-3 h-3 text-slate-400" />{detail.applicant?.mobileNumber || '—'}
                    </span>
                    {detail.applicant?.email && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                        <Mail className="w-3 h-3 text-slate-400" />{detail.applicant.email}
                      </span>
                    )}
                    {matchResult?.appAge != null && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                        <Calendar className="w-3 h-3 text-slate-400" />{matchResult.appAge} سنة
                      </span>
                    )}
                    {detail.applicant?.gender && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                        <User className="w-3 h-3 text-slate-400" />{detail.applicant.gender}
                      </span>
                    )}
                    {detail.applicant?.governorate && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-lg">
                        <MapPin className="w-3 h-3 text-slate-400" />{detail.applicant.governorate}
                        {detail.applicant.cityOrArea ? ` — ${detail.applicant.cityOrArea}` : ''}
                      </span>
                    )}
                  </div>

                  {/* CV button */}
                  {detail.applicant?.cvUrl ? (
                    <a
                      href={detail.applicant.cvUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition-colors shadow-sm shadow-sky-500/20"
                    >
                      <FileText className="w-3.5 h-3.5" /> عرض السيرة الذاتية
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-400 rounded-xl text-xs border border-slate-100 border-dashed">
                      <FileText className="w-3.5 h-3.5" /> لا توجد سيرة ذاتية مرفقة
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── 2. Personal Info + Location ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Personal */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <User className="w-3.5 h-3.5" /> المعلومات الشخصية
                </h3>
                <div className="space-y-3">
                  <InfoRow label="تاريخ الميلاد" value={detail.applicant?.dob ? new Date(detail.applicant.dob).toLocaleDateString('ar-IQ') : '—'} icon={<Calendar className="w-3.5 h-3.5" />} />
                  <InfoRow label="الجنس" value={detail.applicant?.gender || '—'} />
                  <InfoRow label="الحالة الاجتماعية" value={detail.applicant?.maritalStatus || '—'} />
                  <InfoRow label="هاتف بديل" value={detail.applicant?.secondaryMobile || '—'} icon={<Phone className="w-3.5 h-3.5" />} />
                  <InfoRow label="الراتب المتوقع" value={detail.applicant?.expectedSalary ? `${detail.applicant.expectedSalary.toLocaleString('ar-IQ')} د.ع` : '—'} icon={<DollarSign className="w-3.5 h-3.5" />} />
                </div>
              </div>

              {/* Location */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" /> السكن والعنوان
                </h3>
                <div className="space-y-3">
                  <InfoRow label="المحافظة" value={detail.applicant?.governorate || '—'} />
                  <InfoRow label="المدينة / المنطقة" value={detail.applicant?.cityOrArea || '—'} />
                  {detail.applicant?.subArea && <InfoRow label="المنطقة الفرعية" value={detail.applicant.subArea} />}
                  {detail.applicant?.neighborhood && <InfoRow label="الحي" value={detail.applicant.neighborhood} />}
                  {detail.applicant?.detailedAddress && (
                    <InfoRow label="العنوان التفصيلي" value={detail.applicant.detailedAddress} icon={<MapPin className="w-3.5 h-3.5" />} />
                  )}
                </div>
              </div>
            </div>

            {/* ── 3. Professional Profile ── */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <GraduationCap className="w-3.5 h-3.5" /> المؤهلات والخبرة المهنية
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <InfoRow label="المؤهل الدراسي" value={detail.applicant?.academicQualification || '—'} icon={<GraduationCap className="w-3.5 h-3.5" />} />
                <InfoRow label="الاختصاص / التخصص" value={detail.applicant?.specialization || '—'} />
                <InfoRow label="سنوات الخبرة" value={detail.applicant?.yearsOfExperience != null ? `${detail.applicant.yearsOfExperience} سنة` : '—'} />
                <InfoRow label="جهة العمل السابقة" value={detail.applicant?.previousEmployment || '—'} />
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Monitor className="w-3 h-3" /> مهارات الحاسب</p>
                  <p className="text-xs text-slate-700 font-medium leading-relaxed">{detail.applicant?.computerSkills || '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Globe className="w-3 h-3" /> اللغات</p>
                  <p className="text-xs text-slate-700 font-medium leading-relaxed">{detail.applicant?.foreignLanguages || '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> رخصة قيادة</p>
                  <p className="text-xs font-bold">
                    {detail.applicant?.drivingLicense && detail.applicant.drivingLicense !== 'false'
                      ? <span className="text-emerald-600">نعم</span>
                      : <span className="text-slate-400">لا</span>}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1 flex items-center gap-1"><Car className="w-3 h-3" /> هل تمتلك سيارة</p>
                  <p className="text-xs font-bold">
                    {detail.applicant?.hasCar === true
                      ? <span className="text-emerald-600">نعم</span>
                      : detail.applicant?.hasCar === false
                        ? <span className="text-slate-400">لا</span>
                        : <span className="text-slate-400">—</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* ── 4. Match Score vs Vacancy ── */}
            {matchResult && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" /> مؤشرات التوافق مع الشاغر
                </h3>
                <div className="flex items-center gap-5 mb-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-full h-full -rotate-90">
                      <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-slate-100" />
                      <motion.circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="6" fill="transparent"
                        strokeDasharray={163.4}
                        initial={{ strokeDashoffset: 163.4 }}
                        animate={{ strokeDashoffset: 163.4 - (163.4 * matchResult.score) / 100 }}
                        transition={{ duration: 1.2, ease: 'easeOut' }}
                        className={matchResult.score >= 85 ? 'text-emerald-500' : matchResult.score >= 60 ? 'text-sky-500' : 'text-amber-500'}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className={`text-sm font-black ${matchResult.score >= 85 ? 'text-emerald-600' : matchResult.score >= 60 ? 'text-sky-600' : 'text-amber-600'}`}>
                        {matchResult.score}%
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {[
                      { label: 'المؤهل', level: matchResult.certMatch },
                      { label: 'الاختصاص', level: matchResult.specMatch },
                      { label: 'الخبرة', level: matchResult.expMatch },
                      { label: 'الموقع', level: matchResult.locMatch },
                      { label: 'الجنس', level: matchResult.genderMatch },
                      { label: 'العمر', level: matchResult.ageMatch },
                      { label: 'رخصة', level: matchResult.dlMatch },
                    ].filter(c => c.level !== 'neutral').map(c => (
                      <span key={c.label} className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${
                        c.level === 'match' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                        c.level === 'partial' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                        'bg-red-50 text-red-600 border-red-100'
                      }`}>
                        {c.level === 'match' ? <CheckCircle className="w-3 h-3" /> : c.level === 'partial' ? <Minus className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {c.label}
                      </span>
                    ))}
                    {matchResult.vacSkills.length > 0 && (
                      <div className="w-full mt-1">
                        <p className="text-xs text-slate-400 mb-1.5">مهارات الشاغر المطلوبة:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {matchResult.vacSkills.map((s, i) => (
                            <span key={i} className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${
                              matchResult.appSkills.includes(s) ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                            }`}>{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── 5. Vacancy Details ── */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5" /> الشاغر الوظيفي
              </h3>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-base font-bold text-slate-800">{detail.vacancy?.title || '—'}</p>
                  <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3.5 h-3.5" />{detail.vacancy?.branch || '—'}
                  </p>
                </div>
                <div className="text-left text-xs text-slate-400">
                  <p>{detail.vacancy?.startDate ? new Date(detail.vacancy.startDate).toLocaleDateString('ar-IQ') : '—'}</p>
                  <p className="text-slate-300">→</p>
                  <p>{detail.vacancy?.endDate ? new Date(detail.vacancy.endDate).toLocaleDateString('ar-IQ') : '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">المؤهل المطلوب</p>
                  <p className="text-xs font-bold text-slate-700">{detail.vacancy?.requiredCertificate || 'لا يهم'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">الاختصاص</p>
                  <p className="text-xs font-bold text-slate-700">{detail.vacancy?.requiredMajor || 'لا يهم'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">الخبرة المطلوبة</p>
                  <p className="text-xs font-bold text-slate-700">
                    {detail.vacancy?.requiredExperienceYears != null ? `${detail.vacancy.requiredExperienceYears}+ سنة` : 'لا يهم'}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">الجنس</p>
                  <p className="text-xs font-bold text-slate-700">{detail.vacancy?.requiredGender || 'لا يهم'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">الفئة العمرية</p>
                  <p className="text-xs font-bold text-slate-700">
                    {(detail.vacancy?.requiredAgeMin || detail.vacancy?.requiredAgeMax)
                      ? `${detail.vacancy.requiredAgeMin || '—'} – ${detail.vacancy.requiredAgeMax || '—'} سنة`
                      : 'لا يهم'}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-0.5">الشواغر المتبقية</p>
                  <p className="text-xs font-bold text-slate-700">{detail.vacancy?.vacancyCount ?? '—'}</p>
                </div>
              </div>
              {detail.vacancy?.requiredSkills && (
                <div className="mt-3 bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1.5">المهارات المطلوبة</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{detail.vacancy.requiredSkills}</p>
                </div>
              )}
              {detail.vacancy?.responsibilities && (
                <div className="mt-3 bg-slate-50 rounded-xl p-3">
                  <p className="text-xs text-slate-400 mb-1.5">المهام والمسؤوليات</p>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{detail.vacancy.responsibilities}</p>
                </div>
              )}
            </div>

            {/* ── 6. Referrer ── */}
            {detail.referrer && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <UserPlus className="w-3.5 h-3.5 text-amber-400" /> المُعرِّف
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <InfoRow label="النوع" value={detail.referrer.type === 'Employee' ? 'موظف' : 'زبون'} />
                  <InfoRow label="الاسم" value={`${detail.referrer.fullName || ''} ${detail.referrer.lastName || ''}`.trim()} />
                  <InfoRow label="الهاتف" value={detail.referrer.mobileNumber || '—'} icon={<Phone className="w-3.5 h-3.5" />} />
                  <InfoRow label="المهنة" value={detail.referrer.referrerWork || '—'} />
                  <InfoRow label="المحافظة" value={detail.referrer.governorate || '—'} />
                  <InfoRow label="المدينة" value={detail.referrer.cityOrArea || '—'} />
                  {detail.referrer.referrerNotes && (
                    <div className="col-span-2 bg-amber-50 rounded-xl p-3">
                      <p className="text-xs text-amber-400 mb-1">ملاحظات</p>
                      <p className="text-xs text-amber-800">{detail.referrer.referrerNotes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Stage Management */}
          <div className="space-y-5">
            {/* ── Status Overview Card ── */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {/* Stage + Status Header */}
              <div className={`px-5 py-4 ${
                isTerminal
                  ? detail.applicationStatus === 'Final Hired' ? 'bg-gradient-to-l from-emerald-500 to-emerald-600'
                    : detail.applicationStatus === 'Retreated' ? 'bg-gradient-to-l from-slate-400 to-slate-500'
                    : 'bg-gradient-to-l from-red-500 to-red-600'
                  : 'bg-gradient-to-l from-sky-500 to-indigo-600'
              }`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                    {isTerminal ? (
                      detail.applicationStatus === 'Final Hired' ? <Award className="w-5 h-5 text-white" />
                        : detail.applicationStatus === 'Retreated' ? <LogOut className="w-5 h-5 text-white" />
                        : <Ban className="w-5 h-5 text-white" />
                    ) : (
                      <Zap className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/70 text-xs font-medium">المرحلة الحالية</p>
                    <p className="text-white font-bold text-sm">{STAGE_LABELS[detail.currentStage]}</p>
                  </div>
                  {/* Operational status pill */}
                  <div className="bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-lg">
                    <p className="text-white text-xs font-bold flex items-center gap-1.5">
                      <CircleDot className="w-3 h-3" />
                      {unifiedState.label}
                    </p>
                  </div>
                </div>
              </div>


              {/* Meta info */}
              <div className="px-5 py-4 space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400 text-xs">نوع التقديم</span>
                  <span className="text-slate-600 text-xs font-medium">
                    {detail.submissionType === 'Apply' ? 'شخصي' : 'نيابة عن مرشح'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400 text-xs">مصدر الطلب</span>
                  <span className="text-slate-600 text-xs font-medium">{detail.applicationSource || '—'}</span>
                </div>
                {detail.isEscalated && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    مُصعَّد للإدارة العليا
                  </div>
                )}
                {isAssistantWorkflowLocked && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span className="leading-relaxed">{assistantLockMessage}</span>
                  </div>
                )}
                {detail.duplicateFlag && (
                  <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-100 rounded-lg p-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    تم الكشف عن تكرار سابق
                  </div>
                )}
              </div>

              {/* Terminal state banner */}
              {isTerminal && (
                <div className={`mx-5 mb-4 p-4 rounded-xl text-center ${
                  detail.applicationStatus === 'Final Hired' ? 'bg-emerald-50 border border-emerald-200' :
                  detail.applicationStatus === 'Retreated' ? 'bg-slate-50 border border-slate-200' :
                  'bg-red-50 border border-red-200'
                }`}>
                  <p className={`text-xs font-medium mb-1 ${
                    detail.applicationStatus === 'Final Hired' ? 'text-emerald-500' :
                    detail.applicationStatus === 'Retreated' ? 'text-slate-400' : 'text-red-400'
                  }`}>الحالة النهائية</p>
                  <p className={`text-sm font-bold ${
                    detail.applicationStatus === 'Final Hired' ? 'text-emerald-700' :
                    detail.applicationStatus === 'Retreated' ? 'text-slate-600' : 'text-red-700'
                  }`}>
                    {unifiedState.label}
                  </p>
                </div>
              )}

              {detail.applicationStatus === 'Final Hired' && (
                <PermissionGate permission="employees.create">
                  <div className="mx-5 mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                        <UserPlus className="w-5 h-5 text-emerald-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-emerald-800">إجراء ما بعد القبول النهائي</p>
                        <p className="text-xs text-emerald-700 leading-relaxed mt-1">
                          يمكن من هنا إضافة مقدم الطلب إلى سجلات الموظفين وربطه نهائيًا بهذا الطلب.
                        </p>
                      </div>
                    </div>

                    {detail.hiredEmployeeId ? (
                      <div className="rounded-xl border border-emerald-200 bg-white/70 px-3 py-3 text-sm text-emerald-800 flex items-center justify-between gap-3">
                        <span>تم إنشاء سجل الموظف وربطه بهذا الطلب برقم #{detail.hiredEmployeeId}.</span>
                        <Button size="sm" onClick={() => navigate(`/employees/${detail.hiredEmployeeId}`)} className="shrink-0 bg-emerald-600 hover:bg-emerald-700">
                          فتح ملف الموظف
                        </Button>
                      </div>
                    ) : (
                      <Button
                        fullWidth
                        size="sm"
                        icon={UserPlus}
                        loading={employeeLoading}
                        onClick={() => { setEmployeeError(''); setShowEmployeeModal(true); }}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        إضافة مقدم الطلب إلى سجلات الموظفين
                      </Button>
                    )}

                    {employeeError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {employeeError}
                      </div>
                    )}
                  </div>
                </PermissionGate>
              )}

              {/* Archive */}
              {ARCHIVABLE_STATUSES.includes(detail.applicationStatus) && !detail.isArchived && (
                <PermissionGate permission="jobs.applications.archive">
                  <div className="px-5 pb-4">
                    <Button variant="secondary" size="sm" fullWidth icon={Archive} onClick={handleArchive} disabled={actionLoading}>
                      أرشفة الطلب
                    </Button>
                  </div>
                </PermissionGate>
              )}
              {detail.isArchived && (
                <div className="mx-5 mb-4 flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-xl p-2.5 justify-center">
                  <Archive className="w-3.5 h-3.5" />
                  تمت الأرشفة{detail.archivedAt ? ` — ${new Date(detail.archivedAt).toLocaleDateString('ar-IQ')}` : ''}
                </div>
              )}
            </div>

            {/* ── Submitted / New: guidance card to open review modal ── */}
            {!isTerminal && !isAssistantWorkflowLocked && detail.currentStage === 'Submitted' && detail.applicationStatus === 'New' && (
              <PermissionGate permission="jobs.applications.change_stage">
                <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5 space-y-3">
                  <h3 className="text-base font-bold text-sky-600 uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> مرحلة استلام الطلب
                  </h3>
                  <p className="text-xs text-sky-700 leading-relaxed">
                    لم تتم مراجعة الطلب بعد — انقر أدناه لمراجعة الطلب ومقارنته بمتطلبات الشاغر واتخاذ قرار التأهيل أو الرفض مباشرةً.
                  </p>
                  <Button fullWidth size="sm" icon={Eye} onClick={() => setShowReviewModal(true)}>
                    بدء مراجعة الطلب واتخاذ القرار
                  </Button>
                </div>
              </PermissionGate>
            )}

            {/* ── Interview Scheduled: guide HR to the interview module ── */}
            {!isTerminal && !isAssistantWorkflowLocked && detail.currentStage === 'Interview' && detail.applicationStatus === 'Interview Scheduled' && (() => {
              const scheduledInterview = detail.interviews?.find(i => i.interviewStatus === 'Interview Scheduled');
              return (
                <PermissionGate permission="jobs.interviews.schedule">
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                    <h3 className="text-base font-bold text-amber-600 uppercase tracking-widest flex items-center gap-2">
                      <Users className="w-3.5 h-3.5" /> مرحلة المقابلة
                    </h3>
                    {scheduledInterview ? (
                      <>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          المقابلة مجدولة — يتم تحديث حالة الطلب تلقائياً عند تسجيل النتيجة من خلال وحدة المقابلات.
                        </p>
                        <Button variant="gold" fullWidth size="sm" icon={ExternalLink} onClick={() => navigate(`/jobs/interviews?applicationId=${detail.id}&highlightInterviewId=${scheduledInterview.id}`)}>
                          فتح صفحة المقابلة وتسجيل النتيجة
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          لم تُجدَّل مقابلة بعد — يمكنك جدولة المقابلة مباشرةً من هنا أو من تاب المقابلات.
                        </p>
                        <Button variant="gold" fullWidth size="sm" icon={Plus} onClick={() => setShowScheduleInterviewModal(true)}>
                          جدولة مقابلة الآن
                        </Button>
                      </>
                    )}
                  </div>
                </PermissionGate>
              );
            })()}

            {/* ── Training stage: guide HR to the training module ── */}
            {!isTerminal && !isAssistantWorkflowLocked && detail.currentStage === 'Training' && (() => {
              const enrollment = detail.trainings?.[detail.trainings.length - 1]; // latest enrollment
              const statusMap: Record<string, { text: string; sub: string }> = {
                'Training Scheduled': { text: 'الدورة التدريبية مجدولة', sub: 'يتم تحديث حالة الطلب تلقائياً عند تسجيل نتيجة التدريب من خلال وحدة الدورات التدريبية.' },
                'Training Started':   { text: 'التدريب جارٍ حالياً',      sub: 'يتم تحديث حالة الطلب تلقائياً عند تسجيل نتيجة التدريب من خلال وحدة الدورات التدريبية.' },
                'Training Completed': { text: 'اكتمل التدريب',             sub: 'انتقل إلى صفحة الدورة التدريبية لتسجيل نتيجة المتدرب واتخاذ القرار المناسب.' },
              };
              const info = enrollment ? statusMap[enrollment.trainingStatus] : null;
              return (
                <PermissionGate anyOf={["jobs.training.view_detail", "jobs.training.create"]}>
                  <div className="bg-cyan-50 border border-cyan-200 rounded-2xl p-5 space-y-3">
                    <h3 className="text-base font-bold text-cyan-600 uppercase tracking-widest flex items-center gap-2">
                      <BookOpen className="w-3.5 h-3.5" /> مرحلة التدريب
                    </h3>
                    {enrollment && info ? (
                      <>
                        <p className="text-xs text-cyan-700 leading-relaxed">
                          <span className="font-bold">{info.text}</span> — {info.sub}
                        </p>
                        {enrollment.trainingName && (
                          <p className="text-xs text-cyan-600 bg-cyan-100/60 rounded-lg px-3 py-2">
                            الدورة: <span className="font-bold">{enrollment.trainingName}</span>
                            {enrollment.startDate && <> · {new Date(enrollment.startDate).toLocaleDateString('ar-IQ')}</>}
                          </p>
                        )}
                        <Button fullWidth size="sm" icon={ExternalLink} onClick={() => navigate(`/jobs/training-courses/${enrollment.trainingCourseId}`)} className="bg-cyan-500 hover:bg-cyan-600">
                          فتح صفحة الدورة التدريبية
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-cyan-700 leading-relaxed">
                        لم يُسجَّل في دورة تدريبية بعد — يمكنك متابعة الدورات من صفحة إدارة الدورات التدريبية.
                      </p>
                    )}
                  </div>
                </PermissionGate>
              );
            })()}

            {/* ── Workflow Actions (Operational) ── */}
            {!isTerminal && !isAssistantWorkflowLocked && workflowActions.length > 0 && (
              <PermissionGate permission="jobs.applications.change_stage">
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-sky-400" /> الإجراء التالي
                </h3>
                <div className="space-y-2">
                  {workflowActions.map((action, i) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (action.newStatus === 'In Review') {
                            setShowReviewModal(true);
                          } else {
                            handleStageAction(action.newStage, action.newStatus);
                          }
                        }}
                        disabled={actionLoading}
                        className="w-full text-right group bg-sky-50 hover:bg-sky-100 border border-sky-100 hover:border-sky-200 rounded-xl p-3.5 transition-all disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center shrink-0 transition-colors">
                            {actionLoading ? <Loader2 className="w-4 h-4 text-sky-600 animate-spin" /> : <Icon className="w-4 h-4 text-sky-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-sky-700">{action.label}</p>
                            <p className="text-xs text-sky-500/80 mt-0.5">{action.description}</p>
                          </div>
                          <ArrowUpRight className="w-4 h-4 text-sky-400 group-hover:text-sky-600 shrink-0 transition-colors" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              </PermissionGate>
            )}

            {/* ── HR Decisions ── */}
            {!isTerminal && !isAssistantWorkflowLocked && decisionActions.length > 0 && (
              <PermissionGate anyOf={["jobs.applications.record_decision", "jobs.applications.hire"]}>
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Gavel className="w-3.5 h-3.5 text-violet-400" /> اتخاذ قرار
                </h3>
                <div className="space-y-2">
                  {decisionActions.map((action, i) => {
                    const Icon = action.icon;
                    const isPositive = action.variant === 'success';
                    const isNegative = action.variant === 'danger';
                    const bgBase = isPositive ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-100 hover:border-emerald-200'
                      : isNegative ? 'bg-red-50 hover:bg-red-100 border-red-100 hover:border-red-200'
                      : 'bg-amber-50 hover:bg-amber-100 border-amber-100 hover:border-amber-200';
                    const iconBg = isPositive ? 'bg-emerald-100 group-hover:bg-emerald-200'
                      : isNegative ? 'bg-red-100 group-hover:bg-red-200'
                      : 'bg-amber-100 group-hover:bg-amber-200';
                    const iconColor = isPositive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-amber-600';
                    const textColor = isPositive ? 'text-emerald-700' : isNegative ? 'text-red-700' : 'text-amber-700';
                    const descColor = isPositive ? 'text-emerald-500/80' : isNegative ? 'text-red-500/80' : 'text-amber-500/80';

                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (action.newStatus === 'Final Hired') {
                            handleHire();
                          } else if (action.requiresReason) {
                            setShowReasonModal({ newStage: action.newStage, newStatus: action.newStatus });
                          } else {
                            handleStageAction(action.newStage, action.newStatus);
                          }
                        }}
                        disabled={actionLoading}
                        className={`w-full text-right group border rounded-xl p-3.5 transition-all disabled:opacity-50 ${bgBase}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${iconBg}`}>
                            {actionLoading ? <Loader2 className={`w-4 h-4 ${iconColor} animate-spin`} /> : <Icon className={`w-4 h-4 ${iconColor}`} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-bold ${textColor}`}>{action.label}</p>
                            <p className={`text-xs mt-0.5 ${descColor}`}>{action.description}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              </PermissionGate>
            )}

            {/* ── Secondary actions row ── */}
            {!isTerminal && !isAssistantWorkflowLocked && (
              <div className="flex gap-2">
                {/* Escalate */}
                {!detail.isEscalated && (
                  <PermissionGate permission="jobs.applications.escalate">
                    <Button variant="secondary" size="sm" icon={AlertTriangle} onClick={() => { setEscalateError(''); setEscalateReason(''); setShowEscalateConfirm(true); }} disabled={actionLoading} className="flex-1 border-dashed border-orange-300 text-orange-500 hover:border-orange-400 hover:bg-orange-50">
                      تصعيد للإدارة
                    </Button>
                  </PermissionGate>
                )}

                {/* Retreat */}
                <PermissionGate permission="jobs.applications.change_stage">
                  <Button variant="secondary" size="sm" icon={LogOut} onClick={handleRetreat} disabled={actionLoading} className="flex-1 border-dashed">
                    تسجيل انسحاب
                  </Button>
                </PermissionGate>
              </div>
            )}

            {canResolveEscalation && !isAssistantWorkflowLocked && (authUser?.isSuperAdmin === true || authUser?.role === 'branch_manager' || hasPermission('jobs.applications.resolve_escalation')) && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-base font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                      <RotateCcw className="w-3.5 h-3.5" /> فك التصعيد
                    </h3>
                    <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                      الطلب مصعّد حالياً ويمكن فك التصعيد فقط من خلال هذه الصلاحية.
                    </p>
                  </div>
                  <Button size="sm" icon={RotateCcw} loading={resolveEscalationLoading} onClick={handleResolveEscalation} className="bg-emerald-600 hover:bg-emerald-700">
                    فك التصعيد
                  </Button>
                </div>
              </div>
            )}

            {/* Internal Notes */}
            {detail.internalNotes && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-base font-bold text-slate-400 uppercase tracking-widest mb-3">ملاحظات داخلية</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{detail.internalNotes}</p>
              </div>
            )}
            {resolveEscalationError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mt-3 text-xs text-red-700 flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />{resolveEscalationError}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'interviews' ? (
        /* Interviews Tab */
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-500" /> المقابلات
            </h3>

          </div>
          {!detail.interviews || detail.interviews.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">لا توجد مقابلات مسجلة</p>
          ) : (
            <div className="space-y-3">
              {detail.interviews.map((interview) => (
                <div key={interview.id} className="border border-slate-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-700">{interview.interviewerName}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                        interview.interviewStatus === 'Interview Completed' ? 'bg-teal-100 text-teal-700' :
                        interview.interviewStatus === 'Interview Failed' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {interview.interviewStatus === 'Interview Scheduled' ? 'مجدولة' :
                         interview.interviewStatus === 'Interview Completed' ? 'مكتملة' : 'فشلت'}
                      </span>
                      <button
                        onClick={() => navigate(`/jobs/interviews?applicationId=${detail.id}&highlightInterviewId=${interview.id}`)}
                        className="p-1 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                        title="عرض المقابلة ضمن جدول المقابلات"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {interview.interviewDate ? new Date(interview.interviewDate).toLocaleDateString('ar-IQ') : '—'}
                      {interview.interviewTime && ` — ${interview.interviewTime}`}
                    </span>
                    <span>{interview.interviewType === 'HR Interview' ? 'مقابلة HR' : 'مقابلة تقنية'}</span>
                    <span className="text-slate-400">{interview.interviewNumber === 'First Interview' ? 'الأولى' : 'الثانية'}</span>
                  </div>
                  {interview.internalNotes && (
                    <p className="text-xs text-slate-600 mt-2 bg-slate-50 rounded-lg p-2">{interview.internalNotes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'training' ? (
        /* Training Tab */
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-sky-500" /> سجل التدريب
            </h3>
          </div>
          {!detail.trainings || detail.trainings.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">لم يُسجَّل في أي دورة تدريبية بعد</p>
          ) : (
            <div className="space-y-4">
              {detail.trainings.map((t) => {
                const resultColors: Record<string, string> = {
                  Passed: 'bg-emerald-100 text-emerald-700',
                  Retraining: 'bg-amber-100 text-amber-700',
                  Rejected: 'bg-red-100 text-red-700',
                  Retreated: 'bg-slate-100 text-slate-600',
                };
                const resultLabels: Record<string, string> = {
                  Passed: 'ناجح',
                  Retraining: 'إعادة تدريب',
                  Rejected: 'مرفوض',
                  Retreated: 'منسحب',
                };
                const statusColors: Record<string, string> = {
                  'Training Scheduled': 'bg-amber-50 text-amber-700 border-amber-200',
                  'Training Started': 'bg-sky-50 text-sky-700 border-sky-200',
                  'Training Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                };
                const statusLabels: Record<string, string> = {
                  'Training Scheduled': 'مجدول',
                  'Training Started': 'جارٍ',
                  'Training Completed': 'مكتمل',
                };
                return (
                  <div key={t.id} className="border border-slate-100 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{t.trainingName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">المدرب: {t.trainer} — الفرع: {t.branch}</p>
                        {t.deviceName && <p className="text-xs text-slate-400">الجهاز: {t.deviceName}</p>}
                      </div>
                      <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-bold border ${statusColors[t.trainingStatus] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {statusLabels[t.trainingStatus] || t.trainingStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        البداية: {t.startDate ? new Date(t.startDate).toLocaleDateString('ar-IQ') : '—'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        النهاية: {t.endDate ? new Date(t.endDate).toLocaleDateString('ar-IQ') : '—'}
                      </span>
                    </div>

                    {/* Result */}
                    <div className={`flex items-center justify-between rounded-lg p-3 ${t.result ? (resultColors[t.result] ? resultColors[t.result].replace('text-', 'bg-').split(' ')[0] + '/10' : 'bg-slate-50') : 'bg-slate-50'}`}>
                      <span className="text-xs font-medium text-slate-500">نتيجة التدريب</span>
                      {t.result ? (
                        <span className={`text-sm font-bold px-3 py-1 rounded-full ${resultColors[t.result] || 'bg-slate-100 text-slate-600'}`}>
                          {resultLabels[t.result] || t.result}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">لم تُسجَّل النتيجة بعد</span>
                      )}
                    </div>

                    {t.resultRecordedAt && (
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        سُجِّلت النتيجة: {new Date(t.resultRecordedAt).toLocaleDateString('ar-IQ')}
                      </p>
                    )}
                    {t.notes && (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2">{t.notes}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Audit Log Tab */
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-500" /> سجل التدقيق
          </h3>
          {auditLogs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">لا توجد سجلات</p>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => (
                <div key={log.id} className="border border-slate-100 rounded-xl p-4 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-slate-700">{AUDIT_ACTION_LABELS[log.actionType] || log.actionType}</span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(log.timestamp).toLocaleString('ar-IQ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    {log.performedByRole && (
                      <span className="flex items-center gap-1">
                        <span className="text-slate-400">بواسطة:</span>
                        <span className="font-medium">{AUDIT_ROLE_LABELS[log.performedByRole] || log.performedByRole}</span>
                      </span>
                    )}
                    {log.entityType && log.entityType !== 'application' && (
                      <span className="text-sky-600 font-medium">
                        {AUDIT_ENTITY_LABELS[log.entityType] || log.entityType} #{log.entityId}
                      </span>
                    )}
                    {log.internalReason && (
                      <span className="flex items-center gap-1">
                        <span className="text-slate-400">السبب:</span>
                        <span className="font-medium text-slate-600">{log.internalReason}</span>
                      </span>
                    )}
                  </div>
                  {(log.oldValue || log.newValue) && (
                    <button
                      onClick={() => setShowAuditExpanded(showAuditExpanded === log.id ? null : log.id)}
                      className="mt-2 text-xs text-sky-500 hover:text-sky-600 flex items-center gap-1"
                    >
                      {showAuditExpanded === log.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showAuditExpanded === log.id ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
                    </button>
                  )}
                  <AnimatePresence>
                    {showAuditExpanded === log.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {log.oldValue && (
                            <div className="bg-red-50 rounded-lg p-3">
                              <span className="text-xs font-bold text-red-600 block mb-2">قبل التغيير</span>
                              <div className="space-y-1.5">{formatAuditJson(log.oldValue, 'red')}</div>
                            </div>
                          )}
                          {log.newValue && (
                            <div className="bg-emerald-50 rounded-lg p-3">
                              <span className="text-xs font-bold text-emerald-600 block mb-2">بعد التغيير</span>
                              <div className="space-y-1.5">{formatAuditJson(log.newValue, 'emerald')}</div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Review Comparison Modal */}
      <AnimatePresence>
        {showReviewModal && detail && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={() => setShowReviewModal(false)}>
            <motion.div initial={{ scale: 0.96, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, y: 20, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden"
              style={{ maxHeight: 'min(92vh, 800px)' }}
              onClick={e => e.stopPropagation()} dir="rtl">

              {/* Header */}
              <div className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Eye className="w-5 h-5 text-sky-500" /> مراجعة الطلب مقابل متطلبات الشاغر
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    طلب #{detail.id} — {detail.applicant?.firstName} {detail.applicant?.lastName}
                  </p>
                </div>
                <IconButton icon={X} label="إغلاق" onClick={() => setShowReviewModal(false)} />
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {(() => {
                  const app = detail.applicant;
                  const vac = detail.vacancy;
                  if (!app || !vac) return <p className="text-center text-slate-400">لا توجد بيانات</p>;

                  /* ── Scoring Logic & UI ── */
                  type MatchLevel = 'match' | 'mismatch' | 'partial' | 'neutral';
                  const MatchIcon = ({ level }: { level: MatchLevel }) => (
                    level === 'match' ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> :
                    level === 'mismatch' ? <XCircle className="w-4 h-4 text-red-400 shrink-0" /> :
                    level === 'partial' ? <Minus className="w-4 h-4 text-amber-400 shrink-0" /> :
                    <Minus className="w-4 h-4 text-slate-300 shrink-0" />
                  );

                  const calculateMatchScore = () => {
                    return calculateJobMatchScore(app, vac);
                    /* let score = 0;
                    // 1. Education (10 pts)
                    const certLevel = (c: string) => {
                      const levels: Record<string, number> = { 'ابتدائية': 1, 'متوسطة': 2, 'إعدادية': 3, 'دبلوم': 4, 'بكالوريوس': 5, 'ماجستير': 6, 'دكتوراه': 7 };
                      return levels[c || ''] || 0;
                    };
                    const appCertVal = certLevel(app.academicQualification || '');
                    const vacCertVal = certLevel(vac.requiredCertificate || '');
                    let certMatch: MatchLevel = 'neutral';
                    if (vac.requiredCertificate) {
                       if (appCertVal >= vacCertVal) { score += 10; certMatch = 'match'; }
                       else { certMatch = 'mismatch'; }
                    }

                    // 2. Specialization (15 pts)
                    let specMatch: MatchLevel = 'neutral';
                    if (vac.requiredMajor) {
                      if (app.specialization?.trim() === vac.requiredMajor.trim()) { score += 15; specMatch = 'match'; }
                      else if (app.specialization?.includes(vac.requiredMajor)) { score += 7; specMatch = 'partial'; }
                      else { specMatch = 'mismatch'; }
                    }

                    // 3. Experience (20 pts)
                    let expMatch: MatchLevel = 'neutral';
                    if (vac.requiredExperienceYears != null) {
                      const appExp = app.yearsOfExperience || 0;
                      if (appExp >= vac.requiredExperienceYears) { score += 20; expMatch = 'match'; }
                      else if (appExp > 0) { score += 10; expMatch = 'partial'; }
                      else { expMatch = 'mismatch'; }
                    }

                    // 4. Location (10 pts)
                    let locMatch: MatchLevel = 'neutral';
                    if (vac.governorate) {
                      if (app.governorate === vac.governorate) {
                        if (app.cityOrArea === vac.cityOrArea) { score += 10; locMatch = 'match'; }
                        else { score += 5; locMatch = 'partial'; }
                      } else { locMatch = 'mismatch'; }
                    }

                    // 5. Gender (Eligibility)
                    const genderMatch: MatchLevel = !vac.requiredGender || app.gender === vac.requiredGender ? 'match' : 'mismatch';
                    if (genderMatch === 'match' && vac.requiredGender) score += 5;

                    // 6. Age (5 pts)
                    const appAge = app.dob ? Math.floor((Date.now() - new Date(app.dob).getTime()) / 31557600000) : null;
                    const ageMatch: MatchLevel = (!vac.requiredAgeMin && !vac.requiredAgeMax) || appAge == null ? 'neutral' :
                      ((!vac.requiredAgeMin || appAge >= vac.requiredAgeMin) && (!vac.requiredAgeMax || appAge <= vac.requiredAgeMax)) ? 'match' : 'mismatch';
                    if (ageMatch === 'match') score += 5;

                    // 7. Driving License (10 pts)
                    const dlMatch: MatchLevel = !vac.drivingLicenseRequired ? 'neutral' :
                      app.drivingLicense ? 'match' : 'mismatch';
                    if (dlMatch === 'match') score += 10;

                    const carMatch: MatchLevel = !vac.hasCarRequired ? 'neutral' :
                      app.hasCar ? 'match' : 'mismatch';
                    if (carMatch === 'match') score += 0;

                    // 8. Skills (Bonus up to 25 pts)
                    const appSkills = (app.computerSkills || '').toLowerCase();
                    const vacSkills = (vac.requiredSkills || '').split(/[,،\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
                    let skillScore = 0;
                    vacSkills.forEach(s => { if (appSkills.includes(s)) skillScore += 5; });
                    score += Math.min(25, skillScore);

                    return { score, certMatch, specMatch, expMatch, locMatch, genderMatch, ageMatch, dlMatch, appAge, vacSkills, appSkills }; */
                  };

                  const { score, certMatch, specMatch, expMatch, locMatch, genderMatch, ageMatch, dlMatch, appAge, vacSkills, appSkills } = calculateMatchScore();
                  const carMatch: MatchLevel = !vac.hasCarRequired ? 'neutral' : app.hasCar ? 'match' : 'mismatch';

                  const rows = [
                    { label: 'المؤهل العلمي', applicant: app.academicQualification || '—', vacancy: vac.requiredCertificate || 'لا يهم', level: certMatch },
                    { label: 'الاختصاص', applicant: app.specialization || '—', vacancy: vac.requiredMajor || 'لا يهم', level: specMatch },
                    { label: 'سنوات الخبرة', applicant: (app.yearsOfExperience || 0).toString(), vacancy: vac.requiredExperienceYears != null ? `${vac.requiredExperienceYears}+` : 'لا يهم', level: expMatch },
                    { label: 'نطاق السكن', applicant: [app.governorate, app.cityOrArea].filter(Boolean).join(' / ') || '—', vacancy: [vac.governorate, vac.cityOrArea].filter(Boolean).join(' / ') || 'لا يهم', level: locMatch },
                    { label: 'الجنس', applicant: app.gender || '—', vacancy: vac.requiredGender || 'لا يهم', level: genderMatch },
                    { label: 'العمر', applicant: appAge != null ? `${appAge} سنة` : '—', vacancy: (vac.requiredAgeMin || vac.requiredAgeMax) ? `${vac.requiredAgeMin || '—'} – ${vac.requiredAgeMax || '—'} سنة` : 'لا يهم', level: ageMatch },
                    { label: 'رخصة القيادة', applicant: app.drivingLicense ? 'نعم' : 'لا', vacancy: vac.drivingLicenseRequired ? 'مطلوبة' : 'غير مطلوبة', level: dlMatch },
                    { label: 'هل يمتلك سيارة', applicant: app.hasCar ? 'نعم' : 'لا', vacancy: vac.hasCarRequired ? 'مطلوب' : 'غير مطلوب', level: carMatch },
                  ];

                  return (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-1 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center text-center shadow-sm">
                          <div className="relative w-24 h-24 mb-3">
                            <svg className="w-full h-full transform -rotate-90">
                              <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-100" />
                              <motion.circle
                                cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="8" fill="transparent"
                                strokeDasharray={251.2}
                                initial={{ strokeDashoffset: 251.2 }}
                                animate={{ strokeDashoffset: 251.2 - (251.2 * score) / 100 }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                                className={score >= 85 ? 'text-emerald-500' : score >= 60 ? 'text-sky-500' : 'text-amber-500'}
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-lg font-black text-slate-800">{score}%</span>
                              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">درجة الملاءمة</span>
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-4 py-1.5 rounded-full ${
                            score >= 85 ? 'bg-emerald-100 text-emerald-700' :
                            score >= 65 ? 'bg-sky-100 text-sky-700' :
                            score >= 45 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {score >= 85 ? 'ملاءمة ممتازة' : score >= 65 ? 'ملاءمة جيدة' : score >= 45 ? 'ملاءمة متوسطة' : 'ملاءمة ضعيفة'}
                          </span>
                        </div>
                        <div className="md:col-span-2 bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col justify-center gap-4">
                          <div className="flex items-center gap-4">
                            <div className="flex-1 space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-400 uppercase tracking-widest">
                                <span>مؤشرات المراجعة الآلية</span>
                                <span className="text-sky-600">{score}/100</span>
                              </div>
                              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 1 }}
                                  className={`h-full rounded-full ${score >= 85 ? 'bg-emerald-500' : 'bg-sky-500'}`} />
                              </div>
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed italic">
                            * يتم حساب هذه الدرجة آلياً بناءً على مصفوفة معايير الشركة لضمان الحيادية في التقييم الأولي قبل المقابلة.
                          </p>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="grid grid-cols-[1.5fr_1.5fr_auto_1.5fr] bg-slate-50 border-b border-slate-200">
                          <div className="px-5 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-widest">المعيار الأساسي</div>
                          <div className="px-5 py-3.5 text-xs font-bold text-sky-600 uppercase tracking-widest flex items-center gap-2"><User className="w-4 h-4" /> بيانات المتقدم</div>
                          <div className="px-4 py-3.5 italic text-xs text-slate-400">الحالة</div>
                          <div className="px-5 py-3.5 text-xs font-bold text-indigo-600 uppercase tracking-widest flex items-center gap-2"><Briefcase className="w-4 h-4" /> متطلبات الشاغر</div>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {rows.map((row, i) => (
                            <div key={row.label} className={`grid grid-cols-[1.5fr_1.5fr_auto_1.5fr] items-center hover:bg-slate-50/50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                              <div className="px-5 py-4 text-sm font-bold text-slate-700">{row.label}</div>
                              <div className="px-5 py-4 text-sm text-slate-600 font-medium">{row.applicant}</div>
                              <div className="px-4 py-4 flex justify-center"><MatchIcon level={row.level as MatchLevel} /></div>
                              <div className="px-5 py-4 text-sm text-slate-500 italic">{row.vacancy}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-4">
                          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-amber-500" /> مهارات إضافية تم رصدها
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {vacSkills.length > 0 ? vacSkills.map((s, i) => (
                                <span key={i} className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                  appSkills.includes(s) ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100'
                                }`}>
                                  {s}
                                </span>
                              )) : <span className="text-xs text-slate-400 italic">لا توجد مهارات محددة</span>}
                            </div>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                              <Clock className="w-4 h-4 text-sky-500" /> خبرات سابقة أخرى
                            </h4>
                            <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                              {app.previousEmployment || 'لا يوجد تفاصيل إضافية مسجلة عن الخبرات السابقة'}
                            </p>
                          </div>
                        </div>
                        <div className="bg-indigo-50/30 border border-indigo-100 rounded-2xl p-5 flex flex-col">
                          <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <FileText className="w-4 h-4" /> ملاحظات عامة
                          </h4>
                          <textarea
                            placeholder="سجل ملاحظاتك هنا أثناء المراجعة للمرجعية المستقبلية..."
                            rows={6}
                            value={reviewNotes}
                            onChange={e => setReviewNotes(e.target.value)}
                            className="w-full h-full bg-white border border-indigo-100 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-300"
                          />
                          <p className="text-xs text-indigo-400 mt-3 font-medium">سيتم حفظ هذه الملاحظات في سجل التدقيق (Audit Log) عند التأكيد.</p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between bg-white">
                <Button variant="secondary" onClick={() => setShowReviewModal(false)}>
                  إغلاق
                </Button>
                <div className="flex items-center gap-3">
                  <Button
                    variant="danger"
                    icon={XCircle}
                    disabled={actionLoading}
                    loading={actionLoading}
                    onClick={() => handleReviewDecision('reject')}
                  >
                    {actionLoading ? 'جاري...' : 'رفض'}
                  </Button>
                  <Button
                    icon={CheckCircle}
                    disabled={actionLoading}
                    loading={actionLoading}
                    onClick={() => handleReviewDecision('qualify')}
                  >
                    {actionLoading ? 'جاري...' : 'تأهيل للقائمة القصيرة'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <EmployeeFormModal
        isOpen={showEmployeeModal}
        title="استكمال بيانات الموظف المقبول"
        description="تمت تعبئة الحقول المتاحة من طلب التوظيف تلقائيًا. أكمل البيانات الناقصة قبل إنشاء سجل الموظف النهائي وربطه بهذا الطلب."
        submitLabel="إنشاء سجل الموظف"
        submitting={employeeLoading}
        error={employeeError}
        initialValues={employeeInitialValues}
        fixedBranchId={detail?.branchId ?? null}
        fixedBranchName={detail?.vacancy?.branch ?? ''}
        branchLocked
        addressHint={applicationAddressHint}
        onClose={() => {
          if (employeeLoading) return;
          setShowEmployeeModal(false);
        }}
        onSubmit={handleCreateEmployeeRecord}
      />

      {/* ── Schedule Interview Modal ── */}
      <AnimatePresence>
        {showScheduleInterviewModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowScheduleInterviewModal(false)}
          >
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                  <Users className="w-4 h-4 text-sky-500" /> جدولة مقابلة
                </h3>
                <div className="flex flex-col gap-0.5 text-right">
                  <span className="text-xs text-slate-500">المتقدم: <span className="font-bold text-slate-700">{detail.applicant?.firstName} {detail.applicant?.lastName}</span></span>
                  <span className="text-xs text-slate-500">الشاغر: <span className="font-bold text-slate-700">{detail.vacancy?.title}</span></span>
                </div>
              </div>

              <div className="px-6 py-5 overflow-y-auto space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1.5">نوع المقابلة</label>
                    <Select<string>
                      value={interviewForm.interviewType}
                      onChange={(v) => setInterviewForm(f => ({ ...f, interviewType: v as any }))}
                      options={[
                        { value: 'HR Interview', label: 'مقابلة HR' },
                        { value: 'Technical Interview', label: 'مقابلة تقنية' },
                      ]}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1.5">رقم المقابلة</label>
                    <Select<string>
                      value={interviewForm.interviewNumber}
                      onChange={(v) => setInterviewForm(f => ({ ...f, interviewNumber: v as any }))}
                      options={[
                        { value: 'First Interview', label: 'الأولى' },
                        { value: 'Second Interview', label: 'الثانية' },
                      ]}
                      className="w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5">المقابِل <span className="text-red-400">*</span></label>
                  <Select<string>
                    value={interviewForm.interviewerUserId}
                    onChange={(v) => setInterviewForm(f => ({ ...f, interviewerUserId: v }))}
                    disabled={loadingInterviewers || interviewerOptions.length === 0}
                    options={[
                      {
                        value: '',
                        label: loadingInterviewers
                          ? 'جاري تحميل المقابلين...'
                          : interviewerOptions.length === 0
                            ? 'لا يوجد مقابِلون مؤهلون لهذا الفرع'
                            : 'اختر المقابِل...',
                      },
                      ...interviewerOptions.map(opt => ({
                        value: String(opt.id),
                        label: `${opt.name}${opt.username ? ` (@${opt.username})` : ''}${opt.roleDisplayName ? ` — ${opt.roleDisplayName}` : ''}`,
                      })),
                    ]}
                    className="w-full"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1.5">تاريخ المقابلة <span className="text-red-400">*</span></label>
                    <input type="date" value={interviewForm.interviewDate}
                      onChange={e => setInterviewForm(f => ({ ...f, interviewDate: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 block mb-1.5">وقت المقابلة <span className="text-red-400">*</span></label>
                    <input type="time" value={interviewForm.interviewTime}
                      onChange={e => setInterviewForm(f => ({ ...f, interviewTime: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5">ملاحظات داخلية</label>
                  <textarea value={interviewForm.internalNotes}
                    onChange={e => setInterviewForm(f => ({ ...f, internalNotes: e.target.value }))}
                    rows={3} placeholder="ملاحظات إضافية (اختياري)..."
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 resize-none"
                  />
                </div>
                {interviewFormError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{interviewFormError}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
                <Button variant="secondary" onClick={() => setShowScheduleInterviewModal(false)}>إلغاء</Button>
                <Button
                  icon={Calendar}
                  loading={interviewSubmitting}
                  disabled={interviewSubmitting}
                  onClick={handleScheduleInterview}
                >
                  {interviewSubmitting ? 'جاري...' : 'جدولة المقابلة'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Escalate Confirm Modal ── */}
      <AnimatePresence>
        {showEscalateConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowEscalateConfirm(false)}
          >
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">تصعيد الطلب</h3>
                  <p className="text-xs text-slate-500 mt-0.5">سيتم رفع الطلب للإدارة العليا للمراجعة</p>
                </div>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3 mb-4">
                <p className="text-xs text-orange-700 leading-relaxed">
                  <span className="font-bold">{detail.applicant?.firstName} {detail.applicant?.lastName}</span>
                  {' — '}{detail.vacancy?.title}
                  <br />
                  <span className="text-orange-500 mt-1 block">هذا الإجراء لا يمكن التراجع عنه. الرجاء كتابة سبب التصعيد.</span>
                </p>
              </div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">سبب التصعيد</label>
              <textarea
                value={escalateReason}
                onChange={e => setEscalateReason(e.target.value)}
                rows={4}
                placeholder="اكتب سبب التصعيد هنا..."
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500 mb-4 resize-none"
              />
              {escalateError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-xs text-red-700 flex items-center gap-2">
                  <XCircle className="w-4 h-4 shrink-0" />{escalateError}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={() => { setShowEscalateConfirm(false); setEscalateReason(''); }}
                >
                  إلغاء
                </Button>
                <Button
                  variant="gold"
                  fullWidth
                  icon={AlertTriangle}
                  loading={escalateLoading}
                  disabled={escalateLoading}
                  onClick={handleEscalate}
                >
                  {escalateLoading ? 'جاري...' : 'تأكيد التصعيد'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reason Modal */}
      <AnimatePresence>
        {showReasonModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
            onClick={() => setShowReasonModal(null)}
          >
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-base font-bold text-slate-800 mb-4">سبب القرار</h3>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="أدخل السبب (اختياري)..."
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-500 mb-4"
              />
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => { setShowReasonModal(null); setRejectReason(''); }}>
                  إلغاء
                </Button>
                <Button
                  variant="danger"
                  loading={actionLoading}
                  disabled={actionLoading}
                  onClick={() => {
                    if (showReasonModal.newStatus === 'Final Rejected' && detail.currentStage === 'Final Decision') {
                      handleDecisionAction('Rejected', rejectReason);
                      return;
                    }
                    handleStageAction(showReasonModal.newStage, showReasonModal.newStatus, rejectReason);
                  }}
                >
                  {actionLoading ? 'جاري...' : 'تأكيد'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoRow({ label, value, icon, className }: { label: string; value: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="text-xs text-slate-400 block mb-0.5">{label}</span>
      <span className="text-slate-700 flex items-center gap-1.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        {value}
      </span>
    </div>
  );
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'Application Submitted (Admin)': 'تقديم طلب يدوي',
  'Stage Transition': 'انتقال مرحلة',
  'Final Hired': 'توظيف نهائي',
  'Decision Made': 'قرار اتُّخذ',
  'Employee Record Created': 'إنشاء سجل موظف',
  'Escalated': 'تصعيد للإدارة',
  'Application Archived': 'أرشفة الطلب',
  'Interview Scheduled': 'جدولة مقابلة',
  'Interview Result Recorded': 'تسجيل نتيجة المقابلة',
  'Training Enrolled': 'تسجيل في دورة تدريبية',
  'Training Result Recorded': 'تسجيل نتيجة التدريب',
};

const AUDIT_ROLE_LABELS: Record<string, string> = {
  'HR_MANAGER': 'مدير الموارد البشرية',
  'HR_ASSISTANT': 'مساعد الموارد البشرية',
  'ADMIN': 'مدير النظام',
  'SYSTEM': 'النظام',
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  'interview': 'مقابلة',
  'training': 'تدريب',
  'training_trainee': 'متدرب',
};

const AUDIT_KEY_LABELS: Record<string, string> = {
  'stage': 'المرحلة',
  'status': 'الحالة',
  'stageStatus': 'الحالة التشغيلية',
  'decision': 'القرار',
  'applicationStatus': 'حالة الطلب',
  'interviewType': 'نوع المقابلة',
  'interviewNumber': 'رقم المقابلة',
  'interviewerName': 'المقابِل',
  'interviewDate': 'تاريخ المقابلة',
  'interviewTime': 'وقت المقابلة',
  'interviewStatus': 'حالة المقابلة',
  'notes': 'ملاحظات',
  'internalNotes': 'ملاحظات داخلية',
  'result': 'النتيجة',
  'trainingName': 'اسم الدورة',
};

const AUDIT_VALUE_LABELS: Record<string, string> = {
  'Submitted': 'استلام الطلب', 'Shortlisted': 'القائمة القصيرة',
  'Interview': 'المقابلة', 'Training': 'التدريب', 'Final Decision': 'القرار النهائي',
  'New': 'جديد', 'In Review': 'قيد المراجعة', 'Qualified': 'مؤهل', 'Rejected': 'مرفوض',
  'Interview Scheduled': 'مقابلة مجدولة', 'Interview Completed': 'مقابلة مكتملة',
  'Interview Failed': 'فشل المقابلة', 'Approved': 'موافق عليه',
  'Training Scheduled': 'تدريب مجدول', 'Training Started': 'تدريب جارٍ',
  'Training Completed': 'تدريب مكتمل', 'Retraining': 'إعادة تدريب',
  'Passed': 'ناجح', 'Final Hired': 'تم التوظيف', 'Final Rejected': 'مرفوض نهائياً', 'Retreated': 'منسحب',
  'Pending': 'قيد الانتظار', 'Under Review': 'قيد المراجعة', 'Ready': 'جاهز',
  'Scheduled': 'مجدول', 'Completed': 'مكتمل', 'In Progress': 'قيد التنفيذ',
  'Awaiting Decision': 'بانتظار القرار',
  'HR Interview': 'مقابلة HR', 'Technical Interview': 'مقابلة تقنية',
  'First Interview': 'الأولى', 'Second Interview': 'الثانية',
  'Hired': 'تم التوظيف', 'Failed': 'فشل',
};

function formatAuditJson(str: string, color: 'red' | 'emerald') {
  const textClass = color === 'red' ? 'text-red-700' : 'text-emerald-700';
  const labelClass = color === 'red' ? 'text-red-400' : 'text-emerald-400';
  try {
    const obj = JSON.parse(str);
    return Object.entries(obj).map(([k, v]) => {
      const label = AUDIT_KEY_LABELS[k] || k;
      const raw = String(v);
      const value = AUDIT_VALUE_LABELS[raw] || raw;
      return (
        <div key={k} className="flex items-start gap-2 text-xs">
          <span className={`${labelClass} shrink-0`}>{label}:</span>
          <span className={`${textClass} font-medium break-all`}>{value}</span>
        </div>
      );
    });
  } catch {
    return <span className={`text-xs ${textClass}`}>{str}</span>;
  }
}
