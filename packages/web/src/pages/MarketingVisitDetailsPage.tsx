import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Briefcase, Building2, Calendar, CheckCircle2, ClipboardList,
  ExternalLink, Loader2, MapPin, Navigation, Pencil, Phone, RotateCcw,
  ShieldCheck, User, Users, XCircle, Hash, Clock, MessageCircle,
  UserCheck, Plus, Layers, FileText, Star, AlertCircle, X, Send, Lock,
} from 'lucide-react';
import type {
  ContactEntry, CustomerOwnership, DeviceModel, Employee, GeoUnit,
  MarketingVisitCancelRequest, MarketingVisit, MarketingVisitRescheduleRequest,
  MarketingVisitStatus, MarketingVisitTask, MarketingVisitTaskOutcomeRequest,
} from '@golden-crm/shared';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../hooks/useAuthStore';
import { buildMapsUrl } from '../utils/addressUtils';
import ClientAvatar from '../components/ClientAvatar';
import CancelVisitModal from '../components/marketing-visits/CancelVisitModal';
import MarketingVisitOutcomeModal from '../components/marketing-visits/MarketingVisitOutcomeModal';
import RescheduleVisitModal from '../components/marketing-visits/RescheduleVisitModal';
import ReferralSheetDetailsModal from '../components/candidates/SessionDetailsModal';
import EmergencyResultWizard from '../components/emergency/EmergencyResultWizard';

// ── Status metadata ───────────────────────────────────────────────────────────

const STATUS_META: Record<MarketingVisitStatus, { label: string; dot: string; badge: string }> = {
  scheduled:       { label: 'مجدولة',                    dot: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-700 border border-slate-200' },
  in_visit:        { label: 'جارية الآن',                dot: 'bg-indigo-500 animate-pulse', badge: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  ended:           { label: 'انتهت — في انتظار النتيجة', dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border border-amber-200' },
  completed:       { label: 'تمت',                        dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  not_completed:   { label: 'لم تتم',                    dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border border-rose-200' },
  cancelled:       { label: 'ملغاة',                     dot: 'bg-slate-400',   badge: 'bg-slate-200 text-slate-600 border border-slate-300' },
  needs_reschedule:{ label: 'تحتاج إعادة جدولة',         dot: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border border-amber-100' },
};
const DEFAULT_STATUS = { label: 'غير معروفة', dot: 'bg-slate-300', badge: 'bg-slate-100 text-slate-500 border border-slate-200' };
const getStatusMeta = (s?: string | null) => STATUS_META[s as MarketingVisitStatus] ?? DEFAULT_STATUS;

// ── Labels ────────────────────────────────────────────────────────────────────

const TASK_TYPE_LABELS: Record<string, string> = { device_demo: 'عرض جهاز' };

const TASK_STATUS_STYLES: Record<string, string> = {
  pending:       'bg-amber-50 text-amber-700 border border-amber-100',
  completed:     'bg-emerald-50 text-emerald-700 border border-emerald-100',
  not_completed: 'bg-rose-50 text-rose-700 border border-rose-100',
  closed:        'bg-slate-100 text-slate-600 border border-slate-200',
};
const TASK_STATUS_LABELS: Record<string, string> = {
  pending: 'مجدولة', completed: 'مكتملة', not_completed: 'لم تكتمل', closed: 'مغلقة نهائياً',
};

const ANSWERED_BY_LABELS: Record<string, string> = {
  customer: 'الزبون شخصياً',
  spouse: 'الزوج / الزوجة',
  child: 'الولد / البنت',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'ذكر', M: 'ذكر', female: 'أنثى', F: 'أنثى',
};

const CONTACT_TYPE_LABELS: Record<string, string> = {
  mobile: 'موبايل', phone: 'هاتف', other: 'آخر',
};

const REFERRER_TYPE_LABELS: Record<string, string> = {
  client: 'زبون', Client: 'زبون',
  employee: 'موظف', Employee: 'موظف',
  personal: 'شخصي', Personal: 'شخصي',
  external: 'خارجي',
};

const CONTACT_STATUS_META: Record<string, { label: string; cls: string }> = {
  preferred:        { label: 'مفضل',           cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  active:           { label: 'فعال',            cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  'out-of-coverage':{ label: 'خارج التغطية',   cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  unused:           { label: 'غير مستخدم',     cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  invalid:          { label: 'قيمة خاطئة',     cls: 'bg-red-50 text-red-600 border-red-200' },
};

const RATING_META: Record<string, { label: string; cls: string }> = {
  Committed:    { label: 'ملتزم',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  NotCommitted: { label: 'غير ملتزم', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const DATA_QUALITY_META: Record<string, { label: string; cls: string }> = {
  Complete:   { label: 'مكتملة',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  Incomplete: { label: 'ناقصة',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Invalid:    { label: 'غير صالحة', cls: 'bg-red-50 text-red-600 border-red-200' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateArabic(dateStr?: string | null) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString('ar-SY', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** تاريخ الميلاد — بدون يوم الأسبوع */
function formatBirthDate(dateStr?: string | null) {
  if (!dateStr) return null;
  const raw = String(dateStr).slice(0, 10); // handle Date objects or ISO strings
  const [y, m, d] = raw.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return raw;
  return new Date(y, m - 1, d).toLocaleDateString('ar-SY', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-SY', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isToday(dateStr?: string | null) {
  return !!dateStr && dateStr === new Date().toISOString().slice(0, 10);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildClientFullName(v: any): string {
  const parts = [v.clientFirstName, v.clientFatherName, v.clientLastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : (v.customerName || '—');
}

function geoHierarchy(geoUnits: GeoUnit[], neighborhoodId?: string | number | null, governorate?: string | null, district?: string | null) {
  const parts: string[] = [];
  if (neighborhoodId && geoUnits.length > 0) {
    const nId = Number(neighborhoodId);
    const neighborhood = geoUnits.find(u => u.id === nId);
    if (neighborhood) {
      const parent = geoUnits.find(u => u.id === (neighborhood as any).parentId);
      const grandparent = parent ? geoUnits.find(u => u.id === (parent as any).parentId) : null;
      const ggp = grandparent ? geoUnits.find(u => u.id === (grandparent as any).parentId) : null;
      if (ggp) parts.push(ggp.name);
      else if (grandparent) parts.push(grandparent.name);
      if (parent) parts.push(parent.name);
      parts.push(neighborhood.name);
    }
  }
  if (parts.length === 0) {
    if (governorate) parts.push(governorate);
    if (district) parts.push(district);
  }
  return parts;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children, action, accent }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
  action?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`flex items-center justify-between gap-2 border-b px-5 py-3 ${accent ?? 'border-slate-100 bg-slate-50/80'}`}>
        <div className="flex items-center gap-2">
          <span className={accent ? 'opacity-70' : 'text-slate-400'}>{icon}</span>
          <h2 className="text-sm font-bold text-slate-700">{title}</h2>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** A labelled field — label in slate-400, value below */
function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-slate-400">{label}</span>
      <div className="text-sm font-medium text-slate-800 leading-snug">
        {children ?? <span className="text-slate-300 font-normal">—</span>}
      </div>
    </div>
  );
}

/** A horizontal rule inside a section with optional label */
function SubSection({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-slate-50/60 border-y border-slate-100">
      <span className="text-[10px] font-bold text-slate-400 tracking-wider">{label}</span>
    </div>
  );
}

function GpsCard({ title, gps, icon, color }: {
  title: string;
  gps: { lat: number; lng: number; accuracy?: number | null } | null | undefined;
  icon: React.ReactNode;
  color: 'indigo' | 'emerald';
}) {
  const scheme = color === 'indigo'
    ? { ring: 'ring-indigo-100', bg: 'bg-indigo-50', text: 'text-indigo-600', btn: 'bg-indigo-600 hover:bg-indigo-700 text-white' }
    : { ring: 'ring-emerald-100', bg: 'bg-emerald-50', text: 'text-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700 text-white' };

  return (
    <div className={`flex-1 rounded-xl border border-slate-200 bg-white p-4 ring-2 ${scheme.ring} min-w-0`}>
      <div className={`flex items-center gap-2 mb-3 ${scheme.text}`}>
        {icon}
        <span className="text-xs font-bold">{title}</span>
      </div>
      {gps ? (
        <div className="space-y-2">
          <div className={`rounded-lg px-3 py-2 ${scheme.bg}`}>
            <p className="text-xs font-mono text-slate-700 leading-relaxed">
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </p>
            {gps.accuracy != null && (
              <p className="text-[10px] text-slate-400 mt-0.5">دقة ±{Math.round(gps.accuracy)} م</p>
            )}
          </div>
          <a href={mapsUrl(gps.lat, gps.lng)} target="_blank" rel="noopener noreferrer"
            className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${scheme.btn}`}>
            <Navigation className="h-3 w-3" />
            فتح على الخريطة
          </a>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-4 gap-1.5 text-slate-300">
          <MapPin className="h-6 w-6" />
          <span className="text-xs font-medium text-slate-400">لم يُسجَّل موقع</span>
        </div>
      )}
    </div>
  );
}

function OwnershipBadge({ ownership }: { ownership?: CustomerOwnership | null }) {
  const label = ownership?.ownerLabel || 'الشركة العامة';
  const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isPersonal ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarketingVisitDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const authUser = useAuthStore((state) => state.user);
  const isPrivilegedUser = authUser?.isSuperAdmin === true || authUser?.role === 'HR_MANAGER' || authUser?.role === 'ADMIN';
  const canViewMarketingVisits = isPrivilegedUser || hasPermission('marketing_visits.view');
  const canUpdateMarketingVisitResult = isPrivilegedUser || hasPermission('marketing_visits.update_result');
  const canCreateReferralSheet = isPrivilegedUser || hasPermission('referral_sheets.create') || hasPermission('candidates.name_lists.create');

  const [visit, setVisit] = useState<MarketingVisit | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [referralSheets, setReferralSheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [outcomeTask, setOutcomeTask] = useState<MarketingVisitTask | null>(null);
  const [showEmergencyResultModal, setShowEmergencyResultModal] = useState(false);
  const [emergencyResultTask, setEmergencyResultTask] = useState<MarketingVisitTask | null>(null);
  const [outcomeModalError, setOutcomeModalError] = useState('');
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [saleConfirmation, setSaleConfirmation] = useState<{ deviceName: string; saleRef: string }[]>([]);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [savingVisitLifecycle, setSavingVisitLifecycle] = useState(false);
  const [visitLifecycleError, setVisitLifecycleError] = useState('');
  // Referral sheet creation & viewing
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [referralChannel, setReferralChannel] = useState('');
  const [referralNotes, setReferralNotes] = useState('');
  const [referralTargetCount, setReferralTargetCount] = useState('');
  const [savingReferral, setSavingReferral] = useState(false);
  const [referralError, setReferralError] = useState('');
  const [viewSheetId, setViewSheetId] = useState<number | null>(null);
  // Task closure (إقفال نهائي)
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingNotes, setClosingNotes] = useState('');
  const [closingTasks, setClosingTasks] = useState(false);
  const [closeError, setCloseError] = useState('');
  // Team reassignment modal
  const [showSwapTeamModal, setShowSwapTeamModal] = useState(false);
  const [swapSupervisorId, setSwapSupervisorId] = useState<string>('');
  const [swapTechnicianId, setSwapTechnicianId] = useState<string>('');
  const [swapTraineeId, setSwapTraineeId] = useState<string>('');
  const [swapTelemarketerIds, setSwapTelemarketerIds] = useState<number[]>([]);
  const [savingSwap, setSavingSwap] = useState(false);
  const [swapError, setSwapError] = useState('');

  const employeesById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [visitData, employeesData, geoUnitsData, deviceModelsData] = await Promise.all([
        api.marketingVisits.get(id) as Promise<MarketingVisit>,
        api.employees.list() as Promise<Employee[]>,
        api.geoUnits.list() as Promise<GeoUnit[]>,
        api.deviceModels.list() as Promise<DeviceModel[]>,
      ]);
      setVisit(visitData);
      setEmployees(employeesData);
      setGeoUnits(geoUnitsData);
      setDeviceModels(deviceModelsData);
      // Load referral sheets for this client
      if ((visitData as any).clientId) {
        try {
          const sheets = await api.referralSheets.list();
          setReferralSheets(
            (sheets as any[]).filter(s => s.referralEntityId === (visitData as any).clientId)
          );
        } catch { setReferralSheets([]); }
      }
    } catch {
      setError('تعذر تحميل تفاصيل الزيارة');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!canViewMarketingVisits) { setLoading(false); return; }
    load();
  }, [canViewMarketingVisits, load]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleTransitionStatus = async (newStatus: string) => {
    if (!visit) return;
    setSavingStatus(true);
    let gps: { lat: number; lng: number; accuracy: number | null } | undefined;
    if ((newStatus === 'in_visit' || newStatus === 'ended') && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 })
        );
        gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null };
      } catch { /* GPS unavailable — proceed without */ }
    }
    try {
      const updated = await api.marketingVisits.updateStatus(visit.id, newStatus, gps);
      setVisit(updated);
    } catch (err: any) { console.error('Status transition failed:', err?.message); }
    finally { setSavingStatus(false); }
  };

  const handleSubmitOutcome = async (payload: MarketingVisitTaskOutcomeRequest) => {
    if (!visit || !outcomeTask) return;
    setSavingOutcome(true); setOutcomeModalError('');
    try {
      const updatedVisit = await api.marketingVisits.updateTaskOutcome(visit.id, outcomeTask.id, payload);
      setShowOutcomeModal(false); setOutcomeTask(null);

      // Extract generated sale reference numbers from the response
      const updatedTask = (updatedVisit?.tasks ?? []).find((t: any) => String(t.id) === String(outcomeTask.id))
        ?? updatedVisit?.task;
      const acceptedOffers: any[] = (updatedTask?.offers ?? []).filter(
        (o: any) => o.customerResponse === 'accepted' && o.saleReferenceNumber,
      );
      if (acceptedOffers.length > 0) {
        setSaleConfirmation(acceptedOffers.map((o: any) => ({
          deviceName: o.soldDeviceModelName ?? o.offeredDeviceModelName ?? `جهاز #${o.deviceModelId}`,
          saleRef: o.saleReferenceNumber,
        })));
      } else if (updatedTask?.saleReferenceNumber) {
        setSaleConfirmation([{ deviceName: updatedTask.soldDeviceModelName ?? 'الجهاز', saleRef: updatedTask.saleReferenceNumber }]);
      }

      await load();
    } catch (err: any) { setOutcomeModalError(err?.message || 'تعذر حفظ نتيجة المهمة'); }
    finally { setSavingOutcome(false); }
  };

  const handleRescheduleVisit = async (payload: MarketingVisitRescheduleRequest) => {
    if (!visit) return;
    setSavingVisitLifecycle(true); setVisitLifecycleError('');
    try {
      await api.marketingVisits.reschedule(visit.id, payload);
      setShowRescheduleModal(false); await load();
    } catch (err: any) { setVisitLifecycleError(err?.message || 'تعذر تأجيل الموعد'); }
    finally { setSavingVisitLifecycle(false); }
  };

  const handleCancelVisit = async (payload: MarketingVisitCancelRequest) => {
    if (!visit) return;
    setSavingVisitLifecycle(true); setVisitLifecycleError('');
    try {
      await api.marketingVisits.cancel(visit.id, payload);
      setShowCancelModal(false); await load();
    } catch (err: any) { setVisitLifecycleError(err?.message || 'تعذر إلغاء الموعد'); }
    finally { setSavingVisitLifecycle(false); }
  };

  const handleCreateReferralSheet = async () => {
    if (!visit || !referralChannel) return;
    setSavingReferral(true);
    setReferralError('');
    try {
      const vx = visit as any;
      const targetCount = referralTargetCount ? parseInt(referralTargetCount, 10) : 0;
      const sheet = await api.referralSheets.create({
        referralType: 'Client',
        referralEntityId: vx.clientId,
        referralNameSnapshot: visit.customerName,
        referralOriginChannel: referralChannel,
        referralNotes: referralNotes || null,
        referralDate: visit.scheduledDate,
        branchId: vx.branchId,
        targetCandidates: targetCount,
      });
      setReferralSheets(prev => [sheet, ...prev]);
      setShowReferralModal(false);
      setReferralChannel('');
      setReferralNotes('');
      setReferralTargetCount('');
    } catch (err: any) {
      setReferralError(err.message || 'تعذر إنشاء اللائحة');
    }
    finally { setSavingReferral(false); }
  };

  const handleCloseTasks = async () => {
    if (!visit) return;
    setClosingTasks(true);
    setCloseError('');
    try {
      await api.marketingVisits.close(visit.id, closingNotes || undefined);
      setShowCloseModal(false);
      setClosingNotes('');
      await load();
    } catch (err: any) {
      setCloseError(err.message || 'تعذر إقفال المهام');
    } finally {
      setClosingTasks(false);
    }
  };

  const openSwapModal = () => {
    const vx = visit as any;
    // Pre-populate with current effective team (reassigned if present, else original)
    const supId = vx.reassignedSupervisorId ?? vx.supervisorEmployeeId ?? '';
    const techId = vx.reassignedTechnicianId ?? vx.technicianEmployeeId ?? '';
    const traineeId = vx.reassignedTraineeId ?? vx.traineeEmployeeId ?? '';
    const tmIds: number[] = vx.reassignedTeamSnapshot?.telemarketerEmployeeIds
      ?? vx.teamSnapshot?.telemarketerEmployeeIds ?? [];
    setSwapSupervisorId(supId ? String(supId) : '');
    setSwapTechnicianId(techId ? String(techId) : '');
    setSwapTraineeId(traineeId ? String(traineeId) : '');
    setSwapTelemarketerIds(tmIds);
    setSwapError('');
    setShowSwapTeamModal(true);
  };

  const handleSaveTeamSwap = async () => {
    if (!visit) return;
    setSavingSwap(true);
    setSwapError('');
    try {
      await api.marketingVisits.updateTeam(visit.id, {
        supervisorEmployeeId: swapSupervisorId ? Number(swapSupervisorId) : null,
        technicianEmployeeId: swapTechnicianId ? Number(swapTechnicianId) : null,
        traineeEmployeeId:    swapTraineeId    ? Number(swapTraineeId)    : null,
        telemarketerEmployeeIds: swapTelemarketerIds,
      });
      setShowSwapTeamModal(false);
      await load();
    } catch (err: any) {
      setSwapError(err.message || 'تعذر تبديل الفريق');
    } finally {
      setSavingSwap(false);
    }
  };

  function isEmergencyTask(task: MarketingVisitTask): boolean {
    const family = (task as any).taskFamily as string | undefined;
    return family === 'emergency' || task.taskType === 'emergency_maintenance';
  }

  function getTaskDetailPath(task: MarketingVisitTask): string | null {
    if (!task.sourceOpenTaskId) return null;
    const family = (task as any).taskFamily as string | undefined;
    const type   = task.taskType as string;
    if (family === 'emergency' || type === 'emergency_maintenance') {
      return `/tasks/emergency/${task.sourceOpenTaskId}`;
    }
    // device_demo and all other task types fall back to the device-demo detail route
    // (which uses TaskDetailLayout and can handle any task type generically)
    return `/tasks/device-demo/${task.sourceOpenTaskId}`;
  }

  function getTaskDisplayLabel(task: MarketingVisitTask): string {
    const base = TASK_TYPE_LABELS[task.taskType] ?? task.taskType;
    const same = (visit?.tasks ?? []).filter(t => t.taskType === task.taskType);
    if (same.length <= 1) return base;
    return `${base} (${same.findIndex(t => t.id === task.id) + 1})`;
  }

  if (!canViewMarketingVisits) return <Navigate to="/" replace />;

  // ── Derived values ────────────────────────────────────────────────────────

  const v = visit as any;
  const statusMeta = getStatusMeta(visit?.status);

  // Original team (from booking)
  const originalSupervisorName = (() => {
    const eid = visit?.supervisorEmployeeId ?? (v?.teamSnapshot?.supervisorEmployeeId ?? null);
    return eid ? (employeesById.get(eid)?.name ?? `#${eid}`) : '—';
  })();
  const originalTechnicianName = (() => {
    const eid = visit?.technicianEmployeeId ?? (v?.teamSnapshot?.technicianEmployeeId ?? null);
    return eid ? (employeesById.get(eid)?.name ?? `#${eid}`) : '—';
  })();
  const originalTelemarketerName = (() => {
    const ids: number[] = v?.teamSnapshot?.telemarketerEmployeeIds ?? [];
    return ids.map(eid => employeesById.get(eid)?.name ?? `#${eid}`).join('، ') || '—';
  })();

  const contacts: ContactEntry[] = Array.isArray(v?.clientContacts) && v.clientContacts.length > 0
    ? [...v.clientContacts].sort((a: any, b: any) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
    : visit?.customerMobile
      ? [{ id: 'fallback', type: 'mobile', number: visit.customerMobile, label: 'موبايل', hasWhatsApp: false, isPrimary: true, status: 'active' }]
      : [];

  const clientGps = v?.clientGpsCoordinates
    ? (typeof v.clientGpsCoordinates === 'string' ? JSON.parse(v.clientGpsCoordinates) : v.clientGpsCoordinates)
    : null;
  const startGps = v?.visitStartGps;
  const endGps = v?.visitEndGps;

  const gpsDistance = startGps && clientGps
    ? haversineM(startGps.lat, startGps.lng, clientGps.lat, clientGps.lng)
    : null;

  const geoAddr = geoHierarchy(geoUnits, v?.clientNeighborhood, v?.clientGovernorate, v?.clientDistrict);

  // Effective team: reassigned overrides original
  const hasAnyTaskOutcome = (visit?.tasks ?? []).some(t => t.outcome != null);
  // Closure conditions
  const allTasksCompleted = (visit?.tasks ?? []).length > 0
    && (visit?.tasks ?? []).every(t => t.outcome != null);
  const allTasksClosed = (visit?.tasks ?? []).length > 0
    && (visit?.tasks ?? []).every(t => (t as any).openTaskStatus === 'closed');
  const canCloseTasks = canUpdateMarketingVisitResult
    && visit?.status === 'completed'
    && allTasksCompleted
    && !allTasksClosed;
  const canStartVisit = canUpdateMarketingVisitResult && visit?.status === 'scheduled' && isToday(visit?.scheduledDate);
  const effectiveSupervisorId   = v?.reassignedSupervisorId  ?? v?.supervisorEmployeeId  ?? null;
  const effectiveTechnicianId   = v?.reassignedTechnicianId  ?? v?.technicianEmployeeId  ?? null;
  const effectiveTraineeId      = v?.reassignedTraineeId     ?? v?.traineeEmployeeId     ?? null;
  const effectiveTelemarketerIds: number[] =
    v?.reassignedTeamSnapshot?.telemarketerEmployeeIds
    ?? v?.teamSnapshot?.telemarketerEmployeeIds ?? [];
  const isReassigned = !!(v?.reassignedSupervisorId || v?.reassignedTechnicianId ||
                          v?.reassignedTechnicianId || v?.reassignedTeamSnapshot);

  // Effective team names (reassigned overrides original)
  const supervisorName   = effectiveSupervisorId  ? (employeesById.get(effectiveSupervisorId)?.name  ?? `#${effectiveSupervisorId}`)  : '—';
  const technicianName   = effectiveTechnicianId  ? (employeesById.get(effectiveTechnicianId)?.name  ?? `#${effectiveTechnicianId}`)  : '—';
  const telemarketerName = effectiveTelemarketerIds.length
    ? effectiveTelemarketerIds.map(eid => employeesById.get(eid)?.name ?? `#${eid}`).join('، ')
    : '—';

  // Employee lists filtered by team slot type
  const supervisorsList   = employees.filter(e => e.teamSlotType === 'SUPERVISOR');
  const techniciansList   = employees.filter(e => e.teamSlotType === 'TECHNICIAN');
  const traineesList      = employees.filter(e => e.teamSlotType === 'TRAINEE');
  const telemarketersList = employees.filter(e => e.teamSlotType === 'TELEMARKETER');
  const canEndVisit = canUpdateMarketingVisitResult && visit?.status === 'in_visit';
  const canRescheduleCancel = canUpdateMarketingVisitResult && (visit?.status === 'scheduled' || visit?.status === 'in_visit') && !hasAnyTaskOutcome;

  // ── Render ────────────────────────────────────────────────────────────────

  // Visit is active (in progress right now)
  const isActive = visit?.status === 'in_visit';
  const headerAccent = isActive
    ? 'border-indigo-200 bg-indigo-600'
    : visit?.status === 'completed' ? 'border-emerald-200 bg-white'
    : 'border-slate-200 bg-white';

  return (
    <div className="min-h-full bg-slate-50/70" dir="rtl">

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <div className={`sticky top-0 z-20 border-b shadow-sm transition-colors ${isActive ? 'border-indigo-300 bg-indigo-600' : 'border-slate-200 bg-white'}`}>
        {/* Title row */}
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/marketing-visits')}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
              isActive ? 'border-indigo-400 text-indigo-100 hover:bg-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            <ArrowRight className="h-3.5 w-3.5" />
            رجوع
          </button>

          {visit && (
            <>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={`flex items-center gap-1 text-xs font-black ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}>
                  <Hash className="h-3.5 w-3.5" />{v?.visitNumber ?? '—'}
                </span>
                <span className={isActive ? 'text-indigo-400' : 'text-slate-200'}>·</span>
                <span className={`font-bold truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>{visit.customerName}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isActive && <span className="w-2 h-2 rounded-full bg-white animate-pulse" />}
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                  isActive ? 'bg-white/20 text-white' : statusMeta.badge
                }`}>
                  {statusMeta.label}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Action bar — only shown when actions are available */}
        {visit && (canStartVisit || canEndVisit || canRescheduleCancel) && (
          <div className={`border-t px-4 py-2.5 flex flex-wrap items-center gap-2 ${
            isActive ? 'border-indigo-500 bg-indigo-700' : 'border-slate-100 bg-slate-50'
          }`}>
            {canStartVisit && (
              <button type="button" onClick={() => handleTransitionStatus('in_visit')} disabled={savingStatus}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-colors">
                {savingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                بدء الزيارة
              </button>
            )}
            {canEndVisit && (
              <button type="button" onClick={() => handleTransitionStatus('ended')} disabled={savingStatus}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 shadow-sm transition-colors">
                {savingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                إنهاء الزيارة
              </button>
            )}
            {canRescheduleCancel && (
              <>
                <button type="button" onClick={() => { setVisitLifecycleError(''); setShowRescheduleModal(true); }}
                  disabled={savingVisitLifecycle}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors">
                  <RotateCcw className="h-3 w-3" /> تأجيل
                </button>
                <button type="button" onClick={() => { setVisitLifecycleError(''); setShowCancelModal(true); }}
                  disabled={savingVisitLifecycle}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50 transition-colors">
                  <XCircle className="h-3 w-3" /> إلغاء
                </button>
              </>
            )}
            {visitLifecycleError && (
              <p className="text-xs font-bold text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {visitLifecycleError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-4 py-5 space-y-4">

        {/* ── Sale confirmation banner ── */}
        {saleConfirmation.length > 0 && (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-5 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-sm font-bold text-emerald-800">✅ تم تسجيل البيع — أرقام البيعة</p>
                <div className="flex flex-wrap gap-3">
                  {saleConfirmation.map((item) => (
                    <div key={item.saleRef} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2">
                      <span className="text-xs text-slate-500">{item.deviceName}</span>
                      <span className="font-mono text-base font-black tracking-widest text-emerald-700">{item.saleRef}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-emerald-600">احتفظ بهذا الرقم لربطه بالعقد لاحقاً</p>
              </div>
              <button
                type="button"
                onClick={() => setSaleConfirmation([])}
                className="shrink-0 rounded-lg p-1.5 text-emerald-500 hover:bg-emerald-100 transition-colors"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
            <span className="text-sm font-medium">جاري تحميل تفاصيل الزيارة...</span>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-6 py-12 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-rose-300" />
            <p className="text-sm font-bold text-rose-600">{error}</p>
          </div>
        ) : !visit ? null : (
          <>
            {/* ── 1. تفاصيل الزيارة ───────────────────────────────────────── */}
            <SectionCard title="تفاصيل الزيارة" icon={<Calendar className="h-4 w-4" />}>
              <div className="p-5">
                {/* Top row: number + date + time */}
                <div className="flex flex-wrap items-center gap-4 mb-5 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-900">#{v.visitNumber ?? '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    <span>{formatDateArabic(visit.scheduledDate)}</span>
                  </div>
                  {visit.scheduledTime && (
                    <div className="flex items-center gap-1.5 text-sm font-mono font-bold text-slate-700">
                      <Clock className="h-4 w-4 text-slate-400" />
                      {visit.scheduledTime}
                    </div>
                  )}
                </div>

                {/* Details grid */}
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="تاريخ الإنشاء">{formatDateTime(visit.createdAt)}</Field>
                  {v.visitStartedAt && (
                    <Field label="وقت بدء الزيارة الفعلي">
                      <span className="text-indigo-700 font-bold">{formatDateTime(v.visitStartedAt)}</span>
                    </Field>
                  )}
                  {v.visitEndedAt && (
                    <Field label="وقت إنهاء الزيارة">
                      <span className="text-amber-700 font-bold">{formatDateTime(v.visitEndedAt)}</span>
                    </Field>
                  )}
                  {v.appointmentAnsweredBy && (
                    <Field label="من ردّ على مكالمة الحجز">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">
                        <UserCheck className="h-3 w-3" />
                        {ANSWERED_BY_LABELS[v.appointmentAnsweredBy] ?? v.appointmentAnsweredBy}
                      </span>
                    </Field>
                  )}
                  {visit.waterSource && (
                    <Field label="مصدر مياه الشرب">{visit.waterSource}</Field>
                  )}
                  {v.clientDetailedAddress && (
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Field label="العنوان التفصيلي">
                        <span className="text-slate-700">{v.clientDetailedAddress}</span>
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {/* ── 2. مقارنة موقع التنفيذ ──────────────────────────────────── */}
            {(startGps || clientGps) && (
              <SectionCard title="موقع التنفيذ" icon={<MapPin className="h-4 w-4" />}>
                <div className="p-5 space-y-4">
                  {/* Two GPS cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <GpsCard
                      title="موقع الفريق عند البدء"
                      gps={startGps}
                      icon={<Navigation className="h-3.5 w-3.5" />}
                      color="indigo"
                    />
                    <GpsCard
                      title="موقع الزبون المسجل"
                      gps={clientGps}
                      icon={<MapPin className="h-3.5 w-3.5" />}
                      color="emerald"
                    />
                  </div>

                  {/* Distance indicator */}
                  {gpsDistance != null && (
                    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold border ${
                      gpsDistance < 200 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : gpsDistance < 500 ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        gpsDistance < 200 ? 'bg-emerald-100'
                        : gpsDistance < 500 ? 'bg-amber-100'
                        : 'bg-rose-100'
                      }`}>
                        <MapPin className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold opacity-70 mb-0.5">المسافة بين الموقعين</p>
                        <p>
                          {gpsDistance < 1000 ? `${Math.round(gpsDistance)} متر` : `${(gpsDistance / 1000).toFixed(1)} كم`}
                          {gpsDistance < 100 && ' — الفريق في موقع الزبون'}
                          {gpsDistance >= 500 && ' — الموقعان متباعدان'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* End GPS */}
                  {endGps && (
                    <div className="pt-1 border-t border-slate-100">
                      <Field label="موقع الفريق عند الإنهاء">
                        <a href={mapsUrl(endGps.lat, endGps.lng)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-mono font-bold text-slate-600 hover:bg-white transition-colors">
                          <Navigation className="h-3 w-3 text-slate-400" />
                          {endGps.lat.toFixed(5)}, {endGps.lng.toFixed(5)}
                          <ExternalLink className="h-3 w-3 opacity-40" />
                        </a>
                      </Field>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* ── 3. معلومات الزبون ────────────────────────────────────────── */}
            <SectionCard title="معلومات الزبون" icon={<User className="h-4 w-4" />}>

              {/* الهوية */}
              <SubSection label="الهوية" />
              <div className="p-5">
                <div className="flex gap-4 items-start">
                  <ClientAvatar gender={v.clientGender ?? null} dataQuality={v.clientDataQuality ?? null} size="lg" />
                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Name — most prominent */}
                    <div>
                      <p className="text-lg font-black text-slate-900 leading-tight">{buildClientFullName(v)}</p>
                      {v.clientNickname && (
                        <p className="text-sm text-slate-400 mt-0.5">لقب: {v.clientNickname}</p>
                      )}
                    </div>
                    {/* Quick badges */}
                    <div className="flex flex-wrap gap-2">
                      {v.clientGender && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          {GENDER_LABELS[v.clientGender] ?? v.clientGender}
                        </span>
                      )}
                      {v.clientBirthDate && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          {formatBirthDate(v.clientBirthDate)}
                        </span>
                      )}
                      {v.clientNationalId && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                          هوية: {v.clientNationalId}
                        </span>
                      )}
                      {v.clientRating && RATING_META[v.clientRating] && (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${RATING_META[v.clientRating].cls}`}>
                          <Star className="h-2.5 w-2.5" />
                          {RATING_META[v.clientRating].label}
                        </span>
                      )}
                      {v.clientDataQuality && DATA_QUALITY_META[v.clientDataQuality] && (
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${DATA_QUALITY_META[v.clientDataQuality].cls}`}>
                          {DATA_QUALITY_META[v.clientDataQuality].label}
                        </span>
                      )}
                      <OwnershipBadge ownership={visit.ownership} />
                    </div>
                  </div>
                </div>
              </div>

              {/* التواصل */}
              <SubSection label="أرقام التواصل" />
              <div className="p-5">
                {contacts.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-2">لا توجد أرقام مسجلة</p>
                ) : (
                  <div className="space-y-2">
                    {contacts.map((c, i) => {
                      const sm = CONTACT_STATUS_META[c.status] ?? { label: c.status, cls: 'bg-slate-50 text-slate-500 border-slate-200' };
                      return (
                        <div key={c.id ?? i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
                          {/* Icon */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                            c.isPrimary ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                          }`}>
                            <Phone className={`h-4 w-4 ${c.isPrimary ? 'text-emerald-500' : 'text-slate-400'}`} />
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <a href={`tel:${c.number}`} className="font-mono font-black text-slate-900 text-base hover:text-sky-600 transition-colors">
                                {c.number}
                              </a>
                              {c.isPrimary && (
                                <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-bold shrink-0">أساسي</span>
                              )}
                              {c.hasWhatsApp && (
                                <span className="text-[10px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-bold shrink-0">واتساب</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-[11px] font-medium text-slate-400">{CONTACT_TYPE_LABELS[c.type] ?? c.type}</span>
                              {c.label && <span className="text-[11px] text-slate-400">· {c.label}</span>}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${sm.cls}`}>{sm.label}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* العنوان */}
              <SubSection label="العنوان" />
              <div className="p-5 space-y-3">
                {geoAddr.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-1" />
                    {geoAddr.map((part, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-slate-300 text-sm mx-0.5">›</span>}
                        <span className="text-sm font-semibold text-slate-700">{part}</span>
                      </span>
                    ))}
                  </div>
                )}
                {v.clientDetailedAddress && (
                  <p className="text-sm text-slate-600 leading-relaxed">{v.clientDetailedAddress}</p>
                )}
                {clientGps && (
                  <a href={mapsUrl(clientGps.lat, clientGps.lng)} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors">
                    <Navigation className="h-3.5 w-3.5" />
                    فتح الموقع على الخريطة
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </a>
                )}
                {!geoAddr.length && !v.clientDetailedAddress && !clientGps && (
                  <p className="text-sm text-slate-400">لا يوجد عنوان مسجل</p>
                )}
              </div>

              {/* الوسيط — only if data available */}
              {(v.clientReferrerType || v.clientReferrerName) && (
                <>
                  <SubSection label="الوسيط" />
                  <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="نوع الوسيط">
                      {v.clientReferrerType ? (REFERRER_TYPE_LABELS[v.clientReferrerType] ?? v.clientReferrerType) : undefined}
                    </Field>
                    <Field label="اسم الوسيط">{v.clientReferrerName}</Field>
                    {v.clientReferralNotes && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <Field label="ملاحظات الوسيط">{v.clientReferralNotes}</Field>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* معلومات إضافية */}
              {(v.clientOccupation || v.clientSpouseOccupation || v.clientNotes) && (
                <>
                  <SubSection label="معلومات إضافية" />
                  <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {v.clientOccupation && <Field label="مهنة الزبون">{v.clientOccupation}</Field>}
                    {v.clientSpouseOccupation && <Field label="مهنة الزوج / الزوجة">{v.clientSpouseOccupation}</Field>}
                    {v.clientNotes && (
                      <div className="sm:col-span-2 lg:col-span-3">
                        <Field label="ملاحظات عامة">
                          <p className="text-sm text-slate-700 leading-relaxed">{v.clientNotes}</p>
                        </Field>
                      </div>
                    )}
                  </div>
                </>
              )}
            </SectionCard>

            {/* ── 4. الفريق الميداني ───────────────────────────────────────── */}
            <SectionCard
              title="الفريق الميداني"
              icon={<Users className="h-4 w-4" />}
              action={visit.status === 'scheduled' && canUpdateMarketingVisitResult ? (
                <button type="button" onClick={openSwapModal}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 transition-colors">
                  <Users className="h-3 w-3" /> تبديل الفريق
                </button>
              ) : undefined}
            >
              {/* Effective team */}
              <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-100">
                {[
                  { role: 'مشرف',       name: supervisorName,   origName: originalSupervisorName,   icon: <ShieldCheck className="h-4 w-4 text-indigo-400" />,  bg: 'bg-indigo-50/50',  changed: isReassigned && v?.reassignedSupervisorId != null },
                  { role: 'فني',        name: technicianName,   origName: originalTechnicianName,   icon: <User className="h-4 w-4 text-emerald-500" />,         bg: 'bg-emerald-50/50', changed: isReassigned && v?.reassignedTechnicianId != null },
                  { role: 'تيلماركتر', name: telemarketerName, origName: originalTelemarketerName, icon: <Phone className="h-4 w-4 text-violet-400" />,          bg: '',                 changed: isReassigned && v?.reassignedTeamSnapshot?.telemarketerEmployeeIds != null },
                ].map(({ role, name, origName, icon, bg, changed }) => (
                  <div key={role} className={`flex flex-col items-center gap-2 py-4 px-3 text-center ${bg}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm border ${changed ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
                      {icon}
                    </div>
                    <div className="w-full">
                      <p className="text-[10px] font-semibold text-slate-400 mb-0.5">{role}</p>
                      <p className="text-sm font-bold text-slate-800 truncate max-w-full">{name}</p>
                      {changed && origName !== name && (
                        <p className="text-[10px] text-slate-400 truncate mt-0.5 line-through">{origName}</p>
                      )}
                      {changed && (
                        <span className="inline-block mt-1 text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full border border-amber-200">
                          مُعاد الإسناد
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {isReassigned && v?.reassignedAt && (
                <div className="px-5 py-2.5 border-t border-slate-100 bg-amber-50/50 flex items-center gap-2 text-xs text-amber-700">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  أُعيد الإسناد في {formatDateTime(v.reassignedAt)}
                </div>
              )}
            </SectionCard>

            {/* ── 5. لوائح الأسماء المقترحة ────────────────────────────────── */}
            <SectionCard
              title="لوائح الأسماء المقترحة"
              icon={<FileText className="h-4 w-4" />}
              action={canCreateReferralSheet ? (
                <button type="button" onClick={() => setShowReferralModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700 transition-colors">
                  <Plus className="h-3.5 w-3.5" /> إضافة لائحة
                </button>
              ) : undefined}
            >
              {referralSheets.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <FileText className="h-10 w-10 text-slate-200" />
                  <p className="text-sm text-slate-400">لا توجد لوائح مرتبطة بهذا الزبون بعد</p>
                  {canCreateReferralSheet && (
                    <button type="button" onClick={() => setShowReferralModal(true)}
                      className="mt-1 text-xs font-bold text-sky-600 hover:underline">
                      إضافة أول لائحة
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {referralSheets.map((sheet: any) => (
                    <button key={sheet.id} type="button"
                      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors text-right"
                      onClick={() => setViewSheetId(sheet.id)}>
                      <div className="w-9 h-9 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                        <FileText className="h-4 w-4 text-sky-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{sheet.referralNameSnapshot || '—'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400">{sheet.referralDate || '—'}</span>
                          {(sheet.targetCandidates > 0 || sheet.totalCandidates > 0) && (
                            <span className="text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full">
                              {sheet.totalCandidates ?? 0} / {sheet.targetCandidates ?? '—'} مدخل/مستهدف
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${
                        sheet.status === 'In-Progress' ? 'bg-sky-50 text-sky-700 border-sky-200'
                        : sheet.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        {sheet.status || 'New'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* ── 6. مهام الزيارة ──────────────────────────────────────────── */}
            <SectionCard
              title="مهام الزيارة"
              icon={<ClipboardList className="h-4 w-4" />}
              action={canCloseTasks ? (
                <button type="button" onClick={() => { setCloseError(''); setShowCloseModal(true); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-600 transition-colors">
                  <Lock className="h-3 w-3" /> إقفال المهام
                </button>
              ) : allTasksClosed ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">
                  <Lock className="h-3 w-3" /> مُقفَلة نهائياً
                </span>
              ) : undefined}
            >
              {(!visit.tasks || visit.tasks.length === 0) ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <ClipboardList className="h-10 w-10 text-slate-200" />
                  <p className="text-sm text-slate-400">لا توجد مهام مرتبطة بهذه الزيارة</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {visit.tasks.map(task => {
                    const taskOpenStatus = (task as any).openTaskStatus as string | null;
                    const isClosed   = taskOpenStatus === 'closed';
                    const canRecord  = (visit.status === 'in_visit' || visit.status === 'ended') && !task.outcome && canUpdateMarketingVisitResult && !isClosed;
                    const canEdit    = !!task.outcome && canUpdateMarketingVisitResult && !isClosed;
                    const hasOutcome = !!task.outcome;
                    return (
                      <div key={task.id} className={`flex items-center justify-between gap-4 px-5 py-4 transition-colors ${isClosed ? 'bg-slate-50/80' : 'hover:bg-slate-50/60'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                            isClosed    ? 'bg-slate-100 border-slate-200'
                            : hasOutcome ? 'bg-emerald-50 border-emerald-200'
                            :              'bg-sky-50 border-sky-200'
                          }`}>
                            {isClosed
                              ? <Lock className="h-4 w-4 text-slate-400" />
                              : hasOutcome
                                ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                : <ClipboardList className="h-4 w-4 text-sky-500" />
                            }
                          </div>
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${isClosed ? 'text-slate-500' : 'text-slate-800'}`}>{getTaskDisplayLabel(task)}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                isClosed
                                  ? TASK_STATUS_STYLES['closed']
                                  : TASK_STATUS_STYLES[task.status] ?? 'bg-slate-50 text-slate-500 border-slate-200'
                              }`}>
                                {isClosed ? TASK_STATUS_LABELS['closed'] : (TASK_STATUS_LABELS[task.status] ?? task.status)}
                              </span>
                              {task.outcome && (
                                <span className={`text-[10px] font-semibold ${isClosed ? 'text-slate-400' : 'text-emerald-600'}`}>
                                  {task.outcome}
                                </span>
                              )}
                              {/* Sale reference numbers — one badge per sold offer */}
                              {(() => {
                                const refs: string[] = [];
                                if (task.saleReferenceNumber) refs.push(task.saleReferenceNumber);
                                (task.offers ?? []).forEach((o: any) => {
                                  if (o.saleReferenceNumber && !refs.includes(o.saleReferenceNumber))
                                    refs.push(o.saleReferenceNumber);
                                });
                                return refs.map((ref) => (
                                  <span key={ref} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-black tracking-wider ${
                                    isClosed ? 'border-slate-200 bg-slate-100 text-slate-400' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  }`}>
                                    #{ref}
                                  </span>
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {getTaskDetailPath(task) && (
                            <button type="button" onClick={() => navigate(getTaskDetailPath(task)!)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors">
                              <ExternalLink className="h-3 w-3" />
                              المهمة
                            </button>
                          )}
                          {canRecord ? (
                            isEmergencyTask(task) ? (
                              <button type="button"
                                onClick={() => { setEmergencyResultTask(task); setShowEmergencyResultModal(true); }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 transition-colors shadow-sm">
                                <CheckCircle2 className="h-3.5 w-3.5" /> تسجيل نتيجة الصيانة
                              </button>
                            ) : (
                              <button type="button"
                                onClick={() => { setOutcomeModalError(''); setOutcomeTask(task); setShowOutcomeModal(true); }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm">
                                <CheckCircle2 className="h-3.5 w-3.5" /> تسجيل النتيجة
                              </button>
                            )
                          ) : canEdit ? (
                            isEmergencyTask(task) ? (
                              <button type="button"
                                onClick={() => { setEmergencyResultTask(task); setShowEmergencyResultModal(true); }}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors">
                                <Pencil className="h-3 w-3" /> نتيجة الصيانة
                              </button>
                            ) : (
                              <button type="button"
                                onClick={() => { setOutcomeModalError(''); setOutcomeTask(task); setShowOutcomeModal(true); }}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                                <Pencil className="h-3 w-3" /> تعديل
                              </button>
                            )
                          ) : isClosed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <Lock className="h-3 w-3" /> مُقفَل
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* ── Task Closure Modal ───────────────────────────────────────────────── */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl"
          onClick={e => { if (e.target === e.currentTarget) setShowCloseModal(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center">
                  <Lock className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">إقفال المهام نهائياً</h3>
                  <p className="text-xs text-slate-500 mt-0.5">هذا الإجراء لا يمكن التراجع عنه</p>
                </div>
              </div>
              <button onClick={() => setShowCloseModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  بعد الإقفال لن يمكن تعديل نتائج أي مهمة. تأكد من مراجعة جميع النتائج قبل المتابعة.
                </span>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">ملاحظات الإقفال (اختياري)</label>
                <textarea
                  value={closingNotes}
                  onChange={e => setClosingNotes(e.target.value)}
                  rows={2}
                  placeholder="مثال: تمت المراجعة والاعتماد..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-400/20 resize-none"
                />
              </div>
              {closeError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {closeError}
                </p>
              )}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => { setShowCloseModal(false); setClosingNotes(''); setCloseError(''); }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
              <button onClick={handleCloseTasks} disabled={closingTasks}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-700 py-2.5 text-sm font-bold text-white hover:bg-slate-600 disabled:opacity-60">
                {closingTasks && <Loader2 className="h-4 w-4 animate-spin" />}
                <Lock className="h-4 w-4" />
                تأكيد الإقفال
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Emergency Result Modal ───────────────────────────────────────────── */}
      {showEmergencyResultModal && emergencyResultTask?.sourceOpenTaskId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm pt-4 pb-4 px-4"
          dir="rtl" onClick={e => { if (e.target === e.currentTarget) { setShowEmergencyResultModal(false); load(); } }}>
          <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-rose-50 shrink-0">
              <div>
                <h3 className="font-bold text-slate-800">نتيجة الصيانة الطارئة</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {getTaskDisplayLabel(emergencyResultTask)} · زيارة #{(visit as any)?.visitNumber ?? ''}
                </p>
              </div>
              <button onClick={() => { setShowEmergencyResultModal(false); load(); }}
                className="text-slate-400 hover:text-slate-600 p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Wizard */}
            <div className="flex-1 overflow-y-auto p-5">
              <EmergencyResultWizard
                taskId={emergencyResultTask.sourceOpenTaskId}
                contractId={(emergencyResultTask as any).contractId ?? null}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Team Swap Modal ──────────────────────────────────────────────────── */}
      {showSwapTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl"
          onClick={e => { if (e.target === e.currentTarget) setShowSwapTeamModal(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 bg-amber-50">
              <div>
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-600" />
                  تبديل الفريق
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  الفريق الأصلي يُحفظ للأرشيف — الفريق الجديد يتولى التنفيذ
                </p>
              </div>
              <button onClick={() => setShowSwapTeamModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Fields */}
            <div className="px-5 py-4 space-y-4">
              {/* Supervisor */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">مشرف</label>
                <select value={swapSupervisorId} onChange={e => setSwapSupervisorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20">
                  <option value="">— بدون مشرف —</option>
                  {supervisorsList.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              {/* Technician */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">فني</label>
                <select value={swapTechnicianId} onChange={e => setSwapTechnicianId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20">
                  <option value="">— بدون فني —</option>
                  {techniciansList.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              {/* Trainee */}
              {traineesList.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">متدرب (اختياري)</label>
                  <select value={swapTraineeId} onChange={e => setSwapTraineeId(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20">
                    <option value="">— بدون متدرب —</option>
                    {traineesList.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Telemarketers — multi-select via checkboxes */}
              {telemarketersList.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">تيلماركتر</label>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-36 overflow-y-auto">
                    {telemarketersList.map(e => (
                      <label key={e.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox"
                          checked={swapTelemarketerIds.includes(e.id)}
                          onChange={ev => setSwapTelemarketerIds(prev =>
                            ev.target.checked ? [...prev, e.id] : prev.filter(id => id !== e.id)
                          )}
                          className="w-4 h-4 accent-amber-500" />
                        <span className="text-sm font-medium text-slate-700">{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {swapError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {swapError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => setShowSwapTeamModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
              <button onClick={handleSaveTeamSwap} disabled={savingSwap}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-60">
                {savingSwap && <Loader2 className="h-4 w-4 animate-spin" />}
                حفظ التبديل
              </button>
            </div>
          </div>
        </div>
      )}

      <ReferralSheetDetailsModal
        isOpen={viewSheetId !== null}
        sheetId={viewSheetId}
        onClose={() => setViewSheetId(null)}
      />

      {showReferralModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir="rtl"
          onClick={e => { if (e.target === e.currentTarget) { setShowReferralModal(false); setReferralError(''); } }}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4 bg-sky-50">
              <div>
                <h3 className="font-bold text-slate-800">إضافة لائحة أسماء مقترحة</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {visit?.customerName} · {visit?.scheduledDate}
                </p>
              </div>
              <button onClick={() => { setShowReferralModal(false); setReferralError(''); }} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">طريقة التواصل <span className="text-red-500">*</span></label>
                <select value={referralChannel} onChange={e => setReferralChannel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 bg-white">
                  <option value="">— اختر —</option>
                  <option value="phone">هاتف</option>
                  <option value="whatsapp">واتساب</option>
                  <option value="in_person">حضوري أثناء الزيارة</option>
                  <option value="other">أخرى</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">العدد المتوقع</label>
                <div className="flex items-center gap-3">
                  <input type="number" min="0" value={referralTargetCount}
                    onChange={e => setReferralTargetCount(e.target.value)}
                    placeholder="0"
                    className="w-24 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-center font-bold focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20" />
                  <p className="text-xs text-slate-500 flex-1">التزام الفريق بإدخاله لاحقاً (يختلف عن الفعلي المدخل)</p>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">ملاحظات (اختياري)</label>
                <textarea value={referralNotes} onChange={e => setReferralNotes(e.target.value)}
                  rows={2} placeholder="أي تفاصيل إضافية..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 resize-none" />
              </div>
              {referralError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {referralError}
                </p>
              )}
            </div>
            <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
              <button onClick={() => { setShowReferralModal(false); setReferralError(''); }}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                إلغاء
              </button>
              <button onClick={handleCreateReferralSheet} disabled={!referralChannel || savingReferral}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
                {savingReferral && <Loader2 className="h-4 w-4 animate-spin" />}
                <Send className="h-4 w-4" />
                إنشاء اللائحة
              </button>
            </div>
          </div>
        </div>
      )}

      {visit ? (
        <MarketingVisitOutcomeModal
          isOpen={showOutcomeModal}
          task={outcomeTask}
          visit={visit}
          employees={employees}
          deviceModels={deviceModels}
          saving={savingOutcome}
          error={outcomeModalError}
          onClose={() => { if (savingOutcome) return; setShowOutcomeModal(false); setOutcomeTask(null); setOutcomeModalError(''); }}
          onSubmit={handleSubmitOutcome}
        />
      ) : null}

      {visit ? (
        <RescheduleVisitModal
          isOpen={showRescheduleModal}
          visit={visit}
          saving={savingVisitLifecycle}
          error={visitLifecycleError}
          onClose={() => { if (savingVisitLifecycle) return; setShowRescheduleModal(false); setVisitLifecycleError(''); }}
          onSubmit={handleRescheduleVisit}
        />
      ) : null}

      {visit ? (
        <CancelVisitModal
          isOpen={showCancelModal}
          visit={visit}
          saving={savingVisitLifecycle}
          error={visitLifecycleError}
          onClose={() => { if (savingVisitLifecycle) return; setShowCancelModal(false); setVisitLifecycleError(''); }}
          onSubmit={handleCancelVisit}
        />
      ) : null}
    </div>
  );
}
