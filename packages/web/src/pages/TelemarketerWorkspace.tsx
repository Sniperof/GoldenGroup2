import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Headset, Phone, FileText, CheckCircle2, History, CreditCard,
    AlertTriangle, Calendar, Send, Zap, User, Clock, CheckCircle,
    MapPin, PlusCircle, MessageSquare, ThumbsUp, Wrench, Activity, Briefcase,
    Search, ChevronLeft, ChevronRight, Layers, Eye, Edit3, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { useClientStore } from '../hooks/useClientStore';
import { OPEN_TASK_TYPE_LABELS, OPEN_TASK_REASON_LABELS } from '@golden-crm/shared';
import type { OpenTask, OpenTaskType, OpenTaskReason } from '@golden-crm/shared';
import { useTelemarketingStore } from '../hooks/useTelemarketingStore';
import TeamAgendaPanel from '../components/telemarketing/TeamAgendaPanel';
import OutcomeRecorderModal, { SaveExtras } from '../components/telemarketing/OutcomeRecorderModal';
import MessageReplyOutcomeModal from '../components/customers/MessageReplyOutcomeModal';
import { useSystemList } from '../hooks/useSystemList';
import AppointmentSchedulerModal, { CustomerOpenTask } from '../components/telemarketing/AppointmentSchedulerModal';
import ClientModal from '../components/ClientModal';
import type { DaySchedule, Contract, Visit, Employee, TaskListItem, Appointment, CustomerOwnership, ContactEntry, Client } from '../lib/types';
import type { TelemarketingOutcomeCode, GeoUnit } from '@golden-crm/shared';
import { OUTCOME_MAP, getOutcomeMeta, normaliseOutcomeCode, PHONE_STATUS_TO_CONTACT_ENTRY } from '@golden-crm/shared';
import { buildGeoHierarchyLabel } from '../utils/addressUtils';
import { getEntityContacts } from '../lib/contactUtils';
import { useAuthStore } from '../hooks/useAuthStore';

// ─── Date helpers ─────────────────────────────────────────────────────────────

const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};
const parseDateKey = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
const getToday = () => formatDateKey(new Date());
const shiftDate = (dateStr: string, days: number) => { const d = parseDateKey(dateStr); d.setDate(d.getDate() + days); return formatDateKey(d); };
const formatDateArabic = (dateStr: string) => parseDateKey(dateStr).toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// ─── Customer grouping ────────────────────────────────────────────────────────

/** A customer is the contact unit. They may have multiple open tasks. */
interface CustomerGroup {
    key: string;          // contact-target scoped when available, otherwise `${entityType}:${entityId}`
    entityType: 'candidate' | 'client';
    entityId: number;
    name: string;
    mobile: string;
    addressText: string;
    geoUnitId: number | null;
    contactTargetId: number | undefined;
    lockedByHrUserId?: number | null;
    lockedByHrUserName?: string | null;
    /** The first item is used as the primary item for call-log linkage. */
    primaryItem: TaskListItem;
    /** All task list items for this customer. */
    allItems: TaskListItem[];
    /** Open tasks nested under this customer — drives the booking modal. */
    openTasks: CustomerOpenTask[];
    /** Derived overall status. 'booked' wins if any item is booked. */
    status: 'pending' | 'called' | 'booked';
    callOutcome?: string;
}

interface CrossTeamTarget {
    id: number;
    customerId: number;
    teamKey: string | null;
    date: string;
    status: string;
    visitType: string | null;
    latestCallOutcome: string | null;
    latestVisitId: number | null;
    closingReason: string | null;
    closedAt: string | null;
    workLocationGeoUnitId: number | null;
    workLocationName: string | null;
    lockedByHrUserId: number | null;
    lockedByHrUserName: string | null;
    firstContactedByHrUserName: string | null;
    visitStatus: string | null;
    visitDate: string | null;
    visitTime: string | null;
    taskCount: number;
    latestTelemarketingOutcome: string | null;
    latestCallAt: string | null;
}

function groupByCustomer(items: TaskListItem[]): CustomerGroup[] {
    const map = new Map<string, CustomerGroup>();
    for (const item of items) {
        const key = item.contactTargetId ? `ct:${item.contactTargetId}` : `${item.entityType}:${item.entityId}`;
        if (!map.has(key)) {
            map.set(key, {
                key,
                entityType: item.entityType,
                entityId: item.entityId,
                name: item.name,
                mobile: item.mobile,
                addressText: item.addressText,
                geoUnitId: item.geoUnitId,
                contactTargetId: item.contactTargetId,
                lockedByHrUserId: item.lockedByHrUserId ?? null,
                lockedByHrUserName: item.lockedByHrUserName ?? null,
                primaryItem: item,
                allItems: [],
                openTasks: [],
                status: 'pending',
                callOutcome: undefined,
            });
        }
        const group = map.get(key)!;
        group.allItems.push(item);
        if (item.openTaskId != null) {
            group.openTasks.push({
                taskListItemId: item.id,
                openTaskId: item.openTaskId,
                openTaskType: item.openTaskType,
                openTaskReason: item.openTaskReason,
                openTaskStatus: item.openTaskStatus,
                openTaskExpectedDate: item.openTaskExpectedDate ?? null,
                openTaskExpectedTime: item.openTaskExpectedTime ?? null,
            });
        }
        // Status: booked > called > pending
        if (item.status === 'booked') {
            group.status = 'booked';
            group.callOutcome = item.callOutcome;
        } else if (item.status === 'called' && group.status !== 'booked') {
            group.status = 'called';
            group.callOutcome = item.callOutcome;
        }
    }
    return Array.from(map.values());
}

// ─── Contact-target lifecycle stages (§6.3 task-lifecycle-analysis.md) ────────
//
//   ضمن القائمة  →  أُضيفت للقائمة ولم يُسجَّل أي اتصال بعد
//   تم التواصل   →  سُجِّل اتصال واحد على الأقل، والـ CT لا تزال مفتوحة
//   مغلقة        →  انتهت المحاولة (حجز موعد / رفض / إغلاق يدوي)

type StatusFilter = 'all' | 'in_list' | 'contacted' | 'closed';

const statusFilterConfig: Record<StatusFilter, { label: string; activeBg: string; activeText: string; inactiveBg: string; inactiveText: string }> = {
    all:       { label: 'الكل',          activeBg: 'bg-slate-700',   activeText: 'text-white',       inactiveBg: 'bg-slate-100',   inactiveText: 'text-slate-600' },
    in_list:   { label: 'ضمن القائمة',   activeBg: 'bg-violet-600',  activeText: 'text-white',       inactiveBg: 'bg-violet-50',   inactiveText: 'text-violet-700' },
    contacted: { label: 'تم التواصل',    activeBg: 'bg-amber-500',   activeText: 'text-white',       inactiveBg: 'bg-amber-50',    inactiveText: 'text-amber-700' },
    closed:    { label: 'مغلقة',         activeBg: 'bg-slate-600',   activeText: 'text-white',       inactiveBg: 'bg-slate-100',   inactiveText: 'text-slate-600' },
};

/** Returns true if the contact target is closed for any reason. */
const isContactTargetClosed = (cg: CustomerGroup, hasAppointment: boolean): boolean => {
    if (cg.status === 'booked' || hasAppointment) return true;
    if (cg.callOutcome) {
        if (cg.callOutcome === 'manual_close') return true;
        const meta = getOutcomeMeta(cg.callOutcome);
        if (meta.closesContactTarget) return true;
    }
    return false;
};

/**
 * Maps a customer group to the 3 CT lifecycle stages.
 * Requires cgCallLogs to distinguish "ضمن القائمة" (no call yet)
 * from "تم التواصل" (attempted but not closed).
 */
const getCustomerStatusGroup = (cg: CustomerGroup, hasAppointment: boolean, cgCallLogs: any[]): StatusFilter => {
    if (isContactTargetClosed(cg, hasAppointment)) return 'closed';
    if (cgCallLogs.length > 0) return 'contacted';
    return 'in_list';
};

const getOutcomeDisplay = (code: string): { label: string; color: string; bg: string } => {
    const meta = getOutcomeMeta(code);
    const colors: Record<string, { color: string; bg: string }> = {
        no_answer: { color: 'text-orange-700', bg: 'bg-orange-100' },
        busy: { color: 'text-amber-700', bg: 'bg-amber-100' },
        not_in_service: { color: 'text-red-600', bg: 'bg-red-100' },
        wrong_number: { color: 'text-red-700', bg: 'bg-red-100' },
        not_interested: { color: 'text-red-700', bg: 'bg-red-100' },
        booked_marketing_appointment: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
    };
    return { label: meta.label, ...(colors[code] ?? { color: 'text-slate-700', bg: 'bg-slate-100' }) };
};

const getInitials = (name: string) => name.trim().split(' ').map(n => n[0]).slice(0, 2).join('') || 'U';

const SOURCE_CHANNEL_LABELS: Record<string, string> = {
    Acquaintance: 'معرفة شخصية',
    PhoneCall: 'اتصال هاتفي',
    SocialMedia: 'تواصل اجتماعي',
    Campaign: 'حملة',
    App: 'تطبيق',
};

const RATING_LABELS: Record<string, string> = {
    Committed: 'ملتزم',
    NotCommitted: 'غير ملتزم',
    Undefined: 'غير مصنف',
};

const getAppointmentForCustomer = (cg: CustomerGroup, appointments: Appointment[], teamKey: string, date: string): Appointment | undefined =>
    appointments.find(a =>
        a.entityType === cg.entityType &&
        a.entityId === cg.entityId &&
        a.teamKey === teamKey &&
        a.date === date &&
        (cg.contactTargetId ? a.contactTargetId === cg.contactTargetId : true),
    );

const getOpenTaskDetailPath = (taskType: string | null | undefined, taskId: number | null | undefined) => {
    if (!taskId) return null;
    if (taskType === 'emergency_maintenance') return `/tasks/emergency/${taskId}`;
    if (taskType === 'device_demo') return `/tasks/device-demo/${taskId}`;
    return null;
};

const getPriorityLabel = (priority: string | null | undefined) => {
    if (!priority) return '-';
    if (priority === 'high') return 'عالية';
    if (priority === 'medium') return 'متوسطة';
    if (priority === 'low') return 'منخفضة';
    return priority;
};

const OwnershipBadge = ({ ownership }: { ownership?: CustomerOwnership | null }) => {
    const label = ownership?.ownerLabel || 'الشركة العامة';
    const isPersonal = (ownership?.ownerType ?? '').startsWith('personal');
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
            isPersonal
                ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                : 'bg-slate-50 text-slate-600 border-slate-200'
        }`}>
            {label}
        </span>
    );
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TelemarketerWorkspace() {
    const candidates = useCandidateStore(state => state.candidates);
    const { clients, loadClients, updateClient } = useClientStore();
    const { taskLists, appointments, callLogs, loadData, addCallLog, addAppointment, addDirectAppointment, updateTaskListItemStatus, getTaskList, getAppointmentsForTeamDate } = useTelemarketingStore();
    const canBook = useAuthStore(state => state.hasPermission('telemarketing.appointments.book'));
    const authUser = useAuthStore(state => state.user);
    const { items: rejectionReasons } = useSystemList('telemarketing_rejection_reason');
    const [taskTypeOptions, setTaskTypeOptions] = useState<{ taskType: string; arabicLabel: string }[]>([]);
    useEffect(() => {
        api.telemarketing.taskTypeOptions().then(setTaskTypeOptions).catch(() => {});
    }, []);
    const navigate = useNavigate();

    const [contracts, setContracts] = useState<Contract[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [maintenanceRequests, setMaintenanceRequests] = useState<any[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
    // React to the external branch switcher (no full reload — §4).
    const branchId = useBranchContextStore(s => s.branchId);
    const [date, setDate] = useState(getToday());
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    const changeDateBy = useCallback((days: number) => setDate(prev => shiftDate(prev, days)), []);
    const goToToday = useCallback(() => setDate(getToday()), []);

    useEffect(() => {
        loadClients();
        loadData(date);
        setSelectedCustomerKey(null);
        // Legacy bulk `api.visits.list()` removed — the modern field_visits
        // endpoint is per-client. We load contracts/employees/etc. globally
        // and then fetch visits for the selected customer in a dedicated
        // effect below.
        Promise.all([
            api.contracts.list(),
            api.maintenanceRequests.list(),
            api.employees.list(),
            api.geoUnits.list(),
        ]).then(([c, m, e, g]) => {
            setContracts(c); setMaintenanceRequests(m); setEmployees(e); setGeoUnits(g);
        }).catch(() => {
            setContracts([]); setMaintenanceRequests([]); setEmployees([]); setGeoUnits([]);
        });
        setVisits([]); // reset while a new date/customer set is loading
    }, [loadClients, loadData, date, branchId]);

    useEffect(() => {
        setCurrentSchedule({ teams: [], solos: [] });
        api.schedules.get(date)
            .then(data => setCurrentSchedule(data || { teams: [], solos: [] }))
            .catch(() => setCurrentSchedule({ teams: [], solos: [] }));
    }, [date, branchId]);

    const getEmp = (id: number | null) => employees.find(e => e.id === id) || null;

    const availableTeams = useMemo(() => {
        const teams: { key: string; label: string; type: 'team' | 'solo'; count: number }[] = [];
        currentSchedule.teams.forEach((t, idx) => {
            // Foreign-branch slots arrive redacted to `{ locked: true }` (GAP-DS-005) —
            // skip them, keep idx so team_key stays aligned with route_assignments.
            if ((t as any)?.locked === true) return;
            const sup = getEmp(t.supervisor);
            teams.push({ key: `team_${idx}`, label: sup ? `فريق ${sup.name}` : `فريق #${idx + 1}`, type: 'team', count: (t.telemarketers || []).length });
        });
        currentSchedule.solos.forEach((s, idx) => {
            if ((s as any)?.locked === true) return;   // foreign-branch solo slot — skip, keep idx
            const tech = getEmp(s.technician);
            teams.push({ key: `solo_${idx}`, label: tech ? `طوارئ: ${tech.name}` : `فريق طوارئ #${idx + 1}`, type: 'solo', count: 1 });
        });
        return teams;
    }, [currentSchedule, employees]);

    const [selectedTeamKey, setSelectedTeamKey] = useState<string>('');
    const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);

    useEffect(() => {
        const validKeys = availableTeams.map(t => t.key);
        if (!validKeys.includes(selectedTeamKey)) {
            setSelectedTeamKey(validKeys[0] || '');
            setSelectedCustomerKey(null);
        }
    }, [availableTeams, selectedTeamKey]);

    const activeTaskList = useMemo(() => {
        if (!selectedTeamKey) return null;
        return getTaskList(selectedTeamKey, date);
    }, [getTaskList, selectedTeamKey, date, taskLists]);

    // Group task list items by customer — each customer appears exactly once.
    const customerGroups = useMemo((): CustomerGroup[] => {
        const raw = activeTaskList?.items || [];
        const groups = groupByCustomer(raw);
        return groups.sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return 0;
        });
    }, [activeTaskList]);

    const teamAppointments = useMemo(() => getAppointmentsForTeamDate(selectedTeamKey, date), [getAppointmentsForTeamDate, selectedTeamKey, date, appointments]);

    const getCustomerAppointment = useCallback((cg: CustomerGroup) => getAppointmentForCustomer(cg, teamAppointments, selectedTeamKey, date), [teamAppointments, selectedTeamKey, date]);

    useEffect(() => {
        const clientIds = Array.from(new Set(
            customerGroups
                .filter(cg => cg.entityType === 'client')
                .map(cg => cg.entityId),
        ));
        if (clientIds.length === 0) {
            setCrossTeamTargetsByClient({});
            setCrossTeamLoading(false);
            return;
        }

        let cancelled = false;
        const loadCrossTeamTargets = (showLoading: boolean) => {
            if (showLoading) setCrossTeamLoading(true);
            Promise.all(
                clientIds.map(clientId =>
                    api.telemarketing.customerTargetsToday(clientId, date)
                        .then(result => [clientId, result.items || []] as const)
                        .catch(() => [clientId, [] as CrossTeamTarget[]] as const),
                ),
            ).then(entries => {
                if (cancelled) return;
                const next: Record<number, CrossTeamTarget[]> = {};
                entries.forEach(([clientId, items]) => {
                    next[clientId] = items;
                });
                setCrossTeamTargetsByClient(next);
            }).finally(() => {
                if (!cancelled && showLoading) setCrossTeamLoading(false);
            });
        };

        loadCrossTeamTargets(true);
        const timer = window.setInterval(() => loadCrossTeamTargets(false), 30000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [customerGroups, date]);

    const counts = useMemo(() => {
        const cgLogs = (cg: CustomerGroup) =>
            callLogs.filter(l => l.entityId === cg.entityId && l.entityType === cg.entityType);
        return {
            in_list:   customerGroups.filter(cg => getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs(cg)) === 'in_list').length,
            contacted: customerGroups.filter(cg => getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs(cg)) === 'contacted').length,
            closed:    customerGroups.filter(cg => getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs(cg)) === 'closed').length,
        };
    }, [customerGroups, teamAppointments, callLogs, selectedTeamKey, date]);

    const filteredGroups = useMemo(() => {
        let result = customerGroups;
        if (statusFilter !== 'all') {
            result = result.filter(cg => {
                const cgLogs = callLogs.filter(l => l.entityId === cg.entityId && l.entityType === cg.entityType);
                return getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs) === statusFilter;
            });
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(cg =>
                cg.name.toLowerCase().includes(q) ||
                (cg.mobile && cg.mobile.toLowerCase().includes(q))
            );
        }
        return result;
    }, [customerGroups, statusFilter, searchQuery, callLogs, getCustomerAppointment]);

    // Auto-select first customer when list changes.
    useEffect(() => {
        if (selectedCustomerKey && !filteredGroups.some(cg => cg.key === selectedCustomerKey)) {
            setSelectedCustomerKey(filteredGroups[0]?.key || null);
            return;
        }
        if (!selectedCustomerKey && filteredGroups.length > 0) {
            const firstPending = filteredGroups.find(cg => cg.status === 'pending') || filteredGroups[0];
            setSelectedCustomerKey(firstPending.key);
        }
    }, [filteredGroups, selectedCustomerKey]);

    const [activeTab, setActiveTab] = useState<'journey' | 'contracts' | 'visits' | 'openTasks'>('journey');
    const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
    const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
    const [appointmentMode, setAppointmentMode] = useState<'call_result' | 'direct'>('call_result');
    const [isClientEditModalOpen, setIsClientEditModalOpen] = useState(false);
    const [callLogSaveError, setCallLogSaveError] = useState<string | null>(null);
    const [openTaskDetails, setOpenTaskDetails] = useState<Record<number, OpenTask>>({});
    const [openTaskDetailsLoading, setOpenTaskDetailsLoading] = useState(false);
    // Manual close modal (also used as step-2 after reject-scheduling)
    const [isManualCloseOpen, setIsManualCloseOpen] = useState(false);
    const [manualCloseReason, setManualCloseReason] = useState('');
    const [manualCloseSaving, setManualCloseSaving] = useState(false);
    // Service task creation modal — opens after service_request outcome
    const [isServiceTaskOpen, setIsServiceTaskOpen] = useState(false);
    const [serviceTaskType, setServiceTaskType] = useState('');
    const [serviceTaskTypeLabel, setServiceTaskTypeLabel] = useState('');
    const [serviceTaskNotes, setServiceTaskNotes] = useState('');
    const [serviceTaskPriority, setServiceTaskPriority] = useState('');
    const [serviceTaskSaving, setServiceTaskSaving] = useState(false);
    // Pre-selected contact — set when user picks a number in the contact picker
    const [preselectedContactId, setPreselectedContactId] = useState<string>('');
    // Contact picker modal (step 1 before outcome modal)
    const [isContactPickerOpen, setIsContactPickerOpen] = useState(false);
    // Message reply modal — used when updating outcome of a previously sent message
    const [isMessageReplyOpen, setIsMessageReplyOpen] = useState(false);
    const [messageReplyContactId, setMessageReplyContactId] = useState<string>('');
    const [crossTeamTargetsByClient, setCrossTeamTargetsByClient] = useState<Record<number, CrossTeamTarget[]>>({});
    const [crossTeamLoading, setCrossTeamLoading] = useState(false);

    const selectedCustomer = useMemo(() => filteredGroups.find(cg => cg.key === selectedCustomerKey) || null, [filteredGroups, selectedCustomerKey]);

    // Replaces the legacy bulk `api.visits.list()` load. The new field_visits
    // endpoint requires a clientId (or date) filter — so we fetch visits per
    // selected customer and adapt the shape to what the timeline below
    // expects (Visit interface in @golden-crm/shared).
    useEffect(() => {
        if (!selectedCustomer || selectedCustomer.entityType !== 'client') {
            setVisits([]);
            return;
        }
        let cancelled = false;
        api.fieldVisits.list({ clientId: selectedCustomer.entityId })
            .then((rows: any[]) => {
                if (cancelled) return;
                const adapted: Visit[] = (rows || []).map((fv: any) => ({
                    id: String(fv.id),
                    date: fv.scheduledDate || '',
                    customerId: Number(fv.clientId) || selectedCustomer.entityId,
                    employeeId: 0,
                    employeeName: fv?.team?.teamName || '',
                    outcome:
                        fv.status === 'completed' || fv.status === 'closed'
                            ? 'Completed'
                            : fv.status === 'cancelled'
                                ? 'Cancelled'
                                : 'Pending',
                    notes: fv.fieldNotes || undefined,
                }));
                setVisits(adapted);
            })
            .catch(() => { if (!cancelled) setVisits([]); });
        return () => { cancelled = true; };
    }, [selectedCustomer]);
    const selectedAppointment = useMemo(() => selectedCustomer ? getCustomerAppointment(selectedCustomer) : null, [selectedCustomer, getCustomerAppointment]);
    const selectedCrossTeamTargets = useMemo(() => {
        if (!selectedCustomer || selectedCustomer.entityType !== 'client') return [];
        return crossTeamTargetsByClient[selectedCustomer.entityId] || [];
    }, [selectedCustomer, crossTeamTargetsByClient]);
    const selectedOtherTargets = useMemo(() => {
        if (!selectedCustomer) return [];
        return selectedCrossTeamTargets.filter(target => target.id !== selectedCustomer.contactTargetId);
    }, [selectedCustomer, selectedCrossTeamTargets]);
    const getOtherTeamsCount = useCallback((cg: CustomerGroup) => {
        if (cg.entityType !== 'client') return 0;
        const items = crossTeamTargetsByClient[cg.entityId] || [];
        return new Set(
            items
                .filter(item => item.id !== cg.contactTargetId && item.teamKey && item.teamKey !== selectedTeamKey)
                .map(item => item.teamKey as string),
        ).size;
    }, [crossTeamTargetsByClient, selectedTeamKey]);
    /** True when the appointment has been booked (controls "جدولة زيارة" button). */
    const isBookedForSelected = useMemo(() => {
        if (!selectedCustomer) return false;
        return selectedCustomer.status === 'booked' || !!selectedAppointment;
    }, [selectedCustomer, selectedAppointment]);
    /** True when the contact target is closed for ANY reason — disables call/close actions. */
    const isCtClosedForSelected = useMemo(() => {
        if (!selectedCustomer) return false;
        return isContactTargetClosed(selectedCustomer, !!selectedAppointment);
    }, [selectedCustomer, selectedAppointment]);

    const isLockedByOtherForSelected = useMemo(() => {
        if (!selectedCustomer?.lockedByHrUserId || !authUser?.id) return false;
        return selectedCustomer.lockedByHrUserId !== authUser.id;
    }, [selectedCustomer, authUser]);

    const directBookingTask = useMemo(() => {
        if (!selectedCustomer) return null;
        return selectedCustomer.openTasks.find(task =>
            task.openTaskId != null &&
            !!task.openTaskExpectedDate &&
            ['needs_follow_up', 'assigned', 'in_scheduling'].includes(task.openTaskStatus || ''),
        ) || null;
    }, [selectedCustomer]);

    const claimSelectedContactTarget = useCallback(async (): Promise<boolean> => {
        if (!selectedCustomer?.contactTargetId) return true;
        try {
            setCallLogSaveError(null);
            await api.telemarketing.claimContactTarget(selectedCustomer.contactTargetId);
            return true;
        } catch (err: any) {
            setCallLogSaveError(err?.message || 'جهة الاتصال مقفلة حاليا باسم تيلماركتر آخر');
            await loadData(date);
            return false;
        }
    }, [selectedCustomer, loadData, date]);

    const canDirectBookSelected = !!canBook && !!selectedCustomer && !isBookedForSelected && !isLockedByOtherForSelected && !!directBookingTask;

    const entityDetails = useMemo(() => {
        if (!selectedCustomer) return null;
        if (selectedCustomer.entityType === 'candidate') return candidates.find(c => c.id === selectedCustomer.entityId);
        return clients.find(c => c.id === selectedCustomer.entityId);
    }, [selectedCustomer, candidates, clients]);

    const selectedContacts = useMemo(() => {
        if (!entityDetails) return [];
        return getEntityContacts(entityDetails as any).filter(contact => contact.number);
    }, [entityDetails]);

    const primarySelectedContact = useMemo(() => {
        return selectedContacts.find(contact => contact.isPrimary) || selectedContacts[0] || null;
    }, [selectedContacts]);

    const secondarySelectedContacts = useMemo(() => {
        if (!primarySelectedContact) return selectedContacts;
        return selectedContacts.filter(contact => contact.id !== primarySelectedContact.id && contact.number !== primarySelectedContact.number);
    }, [selectedContacts, primarySelectedContact]);

    const selectedAddressLabel = useMemo(() => {
        if (!selectedCustomer) return '';
        return buildGeoHierarchyLabel({
            geoUnits,
            neighborhoodId: selectedCustomer.geoUnitId,
            fallback: selectedCustomer.addressText,
        });
    }, [geoUnits, selectedCustomer]);

    const selectedSnapshotMeta = useMemo(() => {
        const details: any = entityDetails || {};
        const rawSource = details.sourceChannel || details.referralOriginChannel || '';
        const referrers = Array.isArray(details.referrers) ? details.referrers : [];
        const referrersCount = referrers.length || (details.referrerName || details.referralNameSnapshot ? 1 : 0);
        const referrerName = details.referrerName || details.referralNameSnapshot || '';
        const rawRating = details.rating || '';
        const classification = selectedCustomer?.entityType === 'client'
            ? (details.classification || details.candidateStatus || 'زبون')
            : 'مقترح';
        return {
            classification,
            nickname: details.nickname || '',
            occupation: details.occupation || '',
            spouseOccupation: details.spouseOccupation || '',
            notes: details.notes || '',
            sourceChannel: rawSource ? (SOURCE_CHANNEL_LABELS[rawSource] || rawSource) : '',
            referrerName,
            referrersCount,
            rating: rawRating ? (RATING_LABELS[rawRating] || rawRating) : '',
            branchName: details.branchName || '',
            detailedAddress: details.detailedAddress || '',
            gpsCoordinates: details.gpsCoordinates || null,
        };
    }, [entityDetails, selectedCustomer]);

    useEffect(() => {
        if (!selectedCustomer) {
            setOpenTaskDetails({});
            setOpenTaskDetailsLoading(false);
            return;
        }

        const openTaskIds = Array.from(new Set(selectedCustomer.openTasks.map(task => task.openTaskId).filter((id): id is number => typeof id === 'number')));
        if (openTaskIds.length === 0) {
            setOpenTaskDetails({});
            setOpenTaskDetailsLoading(false);
            return;
        }

        let cancelled = false;
        setOpenTaskDetailsLoading(true);
        Promise.all(openTaskIds.map(id => api.openTasks.get(id)))
            .then(rows => {
                if (cancelled) return;
                const details: Record<number, OpenTask> = {};
                rows.forEach(row => {
                    details[row.id] = row;
                });
                setOpenTaskDetails(details);
            })
            .catch(() => {
                if (!cancelled) setOpenTaskDetails({});
            })
            .finally(() => {
                if (!cancelled) setOpenTaskDetailsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [selectedCustomer]);

    // ── Call outcome handler ──────────────────────────────────────────────────

    const handleSaveOutcome = async (contactId: string, outcome: TelemarketingOutcomeCode, notes: string, extras?: SaveExtras) => {
        if (!selectedCustomer || !activeTaskList) return;

        const meta = OUTCOME_MAP[outcome] ?? OUTCOME_MAP['no_answer'];
        const entityContacts = getEntityContacts(entityDetails as any);
        const selectedContact = entityContacts.find(c => c.id === contactId) || entityContacts[0];

        let communicationMethod: 'phone' | 'cellular_text' | 'whatsapp_text' | 'whatsapp_voice' | undefined;
        const ch = extras?.communicationChannel;
        if (ch === 'whatsapp_text') communicationMethod = 'whatsapp_text';
        else if (ch === 'whatsapp_call') communicationMethod = 'whatsapp_voice';
        else if (ch === 'cellular_text') communicationMethod = 'cellular_text';
        else communicationMethod = 'phone';

        // Log the call — failure is surfaced to the user rather than swallowed.
        setCallLogSaveError(null);
        try {
            await addCallLog({
                entityType: selectedCustomer.entityType,
                entityId: selectedCustomer.entityId,
                taskListId: activeTaskList.id,
                taskListItemId: selectedCustomer.primaryItem.id,
                teamKey: selectedTeamKey,
                outcome,
                contactLabel: selectedContact?.label,
                contactNumber: selectedContact?.number,
                notes,
                communicationMethod,
            });
        } catch {
            setCallLogSaveError('فشل حفظ سجل الاتصال — تحقق من الاتصال وحاول مجدداً');
            return;
        }

        // Also save to customer_call_logs for client entities.
        if (selectedCustomer.entityType === 'client' && entityDetails?.id) {
            await api.customerCalls.create(entityDetails.id, {
                contactId: selectedContact?.id || null,
                contactNumber: selectedContact?.number || null,
                contactLabel: selectedContact?.label || null,
                outcome,
                notes: notes || null,
                sourceType: 'telemarketing_task',
                sourceId: selectedCustomer.primaryItem.id,
                taskId: selectedCustomer.primaryItem.openTaskId ?? null,
                taskListId: activeTaskList.id,
                taskListItemId: selectedCustomer.primaryItem.id,
                answeredBy: extras?.answeredBy ?? null,
                communicationChannel: extras?.communicationChannel ?? null,
                status: extras?.status ?? 'completed',
                callDate: extras?.callDateTime ?? null,
                actionLog: {},
            }).catch(() => {});
        }

        // Apply phone status update to the selected contact (for not_reached outcomes)
        if (
            meta.requiresPhoneStatusUpdate &&
            extras?.phoneStatusUpdate &&
            selectedContact?.id &&
            selectedCustomer.entityType === 'client' &&
            entityDetails?.contacts
        ) {
            const newContactStatus = PHONE_STATUS_TO_CONTACT_ENTRY[extras.phoneStatusUpdate] as ContactEntry['status'];
            if (newContactStatus) {
                const updatedContacts = (entityDetails.contacts as ContactEntry[]).map(c =>
                    c.id === selectedContact.id ? { ...c, status: newContactStatus } : c
                );
                await updateClient(selectedCustomer.entityId, { contacts: updatedContacts }).catch(() => {});
            }
        }

        // Not-interested: cancel open tasks. Reason (if provided) is stored in task notes.
        // Legacy codes other_company_not_interested / seen_offer_not_interested are kept in
        // OUTCOME_MAP for backward compatibility but no longer presented in the UI.
        if (outcome === 'not_interested' && selectedCustomer.entityType === 'client') {
            const reasonNote = extras?.rejectionReason ? `غير مهتم — ${extras.rejectionReason}` : 'غير مهتم';
            await Promise.all(
                selectedCustomer.openTasks
                    .filter(ot => ot.openTaskId != null)
                    .map(ot => api.openTasks.update(ot.openTaskId!, {
                        status: 'cancelled',
                        notes: reasonNote,
                    }).catch(() => {}))
            );
        }

        // Follow-up outcomes: set expected date, priority, and structured waiting reason
        // DEC-006 D39: customer_requested_followup replaces other_company_callback + seen_offer_callback.
        // The two legacy codes are retained in the list so historical records still update correctly.
        const isFollowUpOc = ['currently_busy', 'customer_requested_followup', 'other_company_callback', 'seen_offer_callback'].includes(outcome);
        if (isFollowUpOc && selectedCustomer.entityType === 'client') {
            const taskUpdate: Record<string, any> = { status: 'needs_follow_up' };
            if (extras?.followUpDueDate) taskUpdate.expectedDate = extras.followUpDueDate;
            if (extras?.followUpPriority) taskUpdate.priority = extras.followUpPriority;
            if (extras?.rescheduleReason) {
                taskUpdate.waitingReasonText = extras.rescheduleReason;
                taskUpdate.notes = `متابعة — ${extras.rescheduleReason}`;
            }
            await Promise.all(
                selectedCustomer.openTasks
                    .filter(ot => ot.openTaskId != null)
                    .map(ot => api.openTasks.update(ot.openTaskId!, taskUpdate).catch(() => {}))
            );
        }

        // ── Inline appointment booking — atomic: no separate modal ──────────────
        if (outcome === 'booked_marketing_appointment' && extras?.visitDate && extras?.visitTime && activeTaskList) {
            // Filter out tasks with no linked openTaskId (backend rejects null IDs via G-PL-05)
            const selectedTaskEntries = selectedCustomer.openTasks
                .filter(t => t.openTaskId != null)
                .map(t => ({
                    taskListItemId: t.taskListItemId,
                    openTaskId: t.openTaskId,
                    taskType: t.openTaskType || 'device_demo',
                }));

            try {
                await addAppointment({
                    entityType: selectedCustomer.entityType,
                    entityId: selectedCustomer.entityId,
                    customerName: selectedCustomer.name,
                    customerAddress: selectedCustomer.addressText,
                    customerMobile: selectedCustomer.mobile,
                    teamKey: selectedTeamKey,
                    taskListItemId: selectedCustomer.primaryItem.id,
                    taskListId: activeTaskList.id,
                    date: extras.visitDate,
                    timeSlot: extras.visitTime,
                    occupation: '',
                    waterSource: extras.waterSource || '',
                    notes: extras.technicianNotes || '',
                    visitTasks: selectedTaskEntries.map(t => t.taskType),
                    requestedDeviceModelId: null,
                    requestedDeviceName: '',
                }, selectedTaskEntries.length > 0 ? selectedTaskEntries : undefined);

                if (selectedCustomer.entityType === 'client' && extras.waterSource) {
                    await updateClient(selectedCustomer.entityId, { waterSource: extras.waterSource });
                }
                // Mark as booked AFTER appointment is confirmed
                await Promise.all(selectedCustomer.allItems.map(item =>
                    updateTaskListItemStatus(activeTaskList.id, item.id, 'booked', outcome)
                ));
                setIsOutcomeModalOpen(false);
                await loadData(date);
            } catch (err: any) {
                setCallLogSaveError(err.message || 'فشل حجز الموعد — تحقق من التفاصيل وحاول مجدداً');
            }
            return;
        }

        // ── Normal flow for all other outcomes ────────────────────────────────────
        const newStatus = meta.itemStatusAfterSave;
        await Promise.all(selectedCustomer.allItems.map(item =>
            updateTaskListItemStatus(activeTaskList.id, item.id, newStatus, outcome)
        ));

        setIsOutcomeModalOpen(false);

        if (extras?.rejectScheduling) {
            setManualCloseReason(extras.rejectionReason ?? '');
            setIsManualCloseOpen(true);
        } else if (outcome === 'service_request' && extras?.serviceTaskType) {
            setServiceTaskType(extras.serviceTaskType);
            const foundLabel = taskTypeOptions.find(t => t.taskType === extras.serviceTaskType)?.arabicLabel;
            setServiceTaskTypeLabel(foundLabel ?? extras.serviceTaskType);
            setServiceTaskNotes('');
            setServiceTaskPriority('');
            setIsServiceTaskOpen(true);
        } else if (meta.opensAppointment) {
            // Fallback: legacy path if inline data is missing
            setAppointmentMode('call_result');
            setIsAppointmentModalOpen(true);
        } else if (outcome === 'address_updated' || outcome === 'new_number') {
            setIsClientEditModalOpen(true);
        } else if (newStatus !== 'pending') {
            setTimeout(() => {
                const pendingGroups = filteredGroups.filter(cg => cg.status === 'pending' && cg.key !== selectedCustomer.key);
                if (pendingGroups.length > 0) setSelectedCustomerKey(pendingGroups[0].key);
            }, 500);
        }
    };

    // ── Appointment save handler ──────────────────────────────────────────────

    const handleSaveAppointment = async (data: {
        visitDate?: string;
        visitTime: string;
        selectedTaskEntries: import('../components/telemarketing/AppointmentSchedulerModal').SelectedTaskEntry[];
        waterSource: string;
        requestedDeviceModelId: number | null;
        requestedDeviceName: string;
        technicianNotes: string;
    }) => {
        if (!selectedCustomer || !activeTaskList) return;

        const visitTaskTypes = data.selectedTaskEntries.map(t => t.taskType);
        const appointmentPayload = {
            entityType: selectedCustomer.entityType,
            entityId: selectedCustomer.entityId,
            customerName: selectedCustomer.name,
            customerAddress: selectedCustomer.addressText,
            customerMobile: selectedCustomer.mobile,
            teamKey: selectedTeamKey,
            taskListItemId: selectedCustomer.primaryItem.id,
            taskListId: activeTaskList.id,
            date: data.visitDate ?? date,
            timeSlot: data.visitTime,
            occupation: '',
            waterSource: data.waterSource,
            notes: data.technicianNotes,
            visitTasks: visitTaskTypes,
            requestedDeviceModelId: data.requestedDeviceModelId,
            requestedDeviceName: data.requestedDeviceName,
            contactTargetId: selectedCustomer.contactTargetId,
        };

        if (appointmentMode === 'direct') {
            await addDirectAppointment(appointmentPayload, data.selectedTaskEntries);
        } else {
            await addAppointment(appointmentPayload, data.selectedTaskEntries);
        }

        if (selectedCustomer.entityType === 'client' && data.waterSource) {
            await updateClient(selectedCustomer.entityId, { waterSource: data.waterSource });
        }

        // Update ALL items for this customer as booked in the store.
        await Promise.all(selectedCustomer.allItems.map(item =>
            updateTaskListItemStatus(activeTaskList.id, item.id, 'booked', 'booked_marketing_appointment')
        ));

        await loadData(date);
    };

    // ── Manual close handler ─────────────────────────────────────────────────

    const handleCreateServiceTask = async () => {
        if (!selectedCustomer || !serviceTaskType) return;
        setServiceTaskSaving(true);
        try {
            await api.telemarketing.createServiceTask({
                clientId: selectedCustomer.entityId,
                taskType: serviceTaskType,
                notes: serviceTaskNotes || undefined,
                priority: serviceTaskPriority || undefined,
            });
            setIsServiceTaskOpen(false);
            setServiceTaskType('');
            setServiceTaskTypeLabel('');
            setServiceTaskNotes('');
            setServiceTaskPriority('');
            await loadData(date);
        } catch (err: any) {
            console.error('Service task creation failed:', err);
        } finally {
            setServiceTaskSaving(false);
        }
    };

    const handleManualClose = async () => {
        if (!selectedCustomer || !activeTaskList) return;
        if (!(await claimSelectedContactTarget())) return;
        setManualCloseSaving(true);
        try {
            await api.contactTargets.manualClose(
                activeTaskList.id,
                selectedCustomer.primaryItem.id,
                { reason: manualCloseReason || undefined },
            );
            setIsManualCloseOpen(false);
            setManualCloseReason('');
            await loadData(date);
        } catch (err: any) {
            console.error('Manual close failed:', err);
            setCallLogSaveError(err?.message || 'فشل إغلاق جهة الاتصال');
        } finally {
            setManualCloseSaving(false);
        }
    };

    // ── Journey events ────────────────────────────────────────────────────────

    const entityCallLogs = useMemo(() => {
        if (!selectedCustomer) return [];
        return callLogs.filter(log => log.entityId === selectedCustomer.entityId && log.entityType === selectedCustomer.entityType)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [selectedCustomer, callLogs]);

    const journeyEvents = useMemo(() => {
        if (!selectedCustomer) return [];
        const events: any[] = [];

        if (selectedCustomer.entityType === 'candidate') {
            const cand = candidates.find(c => c.id === selectedCustomer.entityId);
            if (cand) {
                events.push({ id: 'cand_' + cand.id, date: cand.createdAt, type: 'suggestion', icon: ThumbsUp, color: 'text-amber-600', bg: 'bg-amber-100',
                    content: <><p className="text-sm font-bold text-slate-800">تم اقتراح الزبون من قبل الوسيط <span className="text-amber-700">"{cand.referralNameSnapshot || 'غير محدد'}"</span></p><p className="text-xs text-slate-600 mt-1">المصدر: {cand.referralOriginChannel}</p></> });
            }
        }

        if (selectedCustomer.entityType === 'client') {
            const client = clients.find(c => c.id === selectedCustomer.entityId);
            if (client) {
                events.push({ id: 'client_' + client.id, date: client.createdAt, type: 'suggestion', icon: User, color: 'text-amber-600', bg: 'bg-amber-100',
                    content: <><p className="text-sm font-bold text-slate-800">تم تسجيل الزبون في النظام</p>{client.referrerName && <p className="text-xs text-slate-600 mt-1">الوسيط: {client.referrerName}</p>}</> });
            }

            contracts.filter(c => c.customerId === selectedCustomer.entityId).forEach(c => {
                events.push({ id: 'contract_' + c.id, date: c.contractDate || c.createdAt, type: 'contract', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-100',
                    content: <><p className="text-sm font-bold text-slate-800">تم شراء جهاز <span className="text-emerald-700">"{c.deviceModelName}"</span> بعقد #{c.contractNumber}</p><p className="text-xs text-slate-600 mt-1">القيمة: {c.finalPrice.toLocaleString()} ل.س | {c.paymentType === 'cash' ? 'نقدي' : 'أقساط'}</p></> });
            });

            maintenanceRequests.filter(m => m.customerId === selectedCustomer.entityId).forEach(m => {
                events.push({ id: 'maint_' + m.id, date: m.requestDate, type: 'maintenance', icon: Zap, color: 'text-orange-600', bg: 'bg-orange-100',
                    content: <><p className="text-sm font-bold text-slate-800">زيارة صيانة <span className="text-orange-700">"{m.visitType}"</span></p><p className="text-xs text-slate-600 mt-1">{m.problemDescription}</p></> });
            });
        }

        visits.filter(v => v.customerId === selectedCustomer.entityId).forEach(v => {
            events.push({ id: 'visit_' + v.id, date: v.date, type: 'visit', icon: Calendar, color: 'text-sky-600', bg: 'bg-sky-100',
                content: <><p className="text-sm font-bold text-slate-800">زيارة {v.outcome === 'Completed' ? 'ناجحة' : `بالحالة: ${v.outcome}`}</p><p className="text-xs text-slate-600 mt-1">بواسطة الفني: {v.employeeName}</p>{v.notes && <p className="text-xs text-slate-500 mt-1 border border-slate-200 bg-slate-50 p-1.5 rounded">ملاحظات: {v.notes}</p>}</> });
        });

        const taskCalls = callLogs.filter(log => log.entityId === selectedCustomer.entityId && log.entityType === selectedCustomer.entityType)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        taskCalls.forEach((log, index) => {
            const isTextMsg = log.outcome === 'message_sent' || log.communicationMethod === 'cellular_text';
            const isWhatsApp = log.communicationMethod?.startsWith('whatsapp');
            const isLatest = index === taskCalls.length - 1;
            events.push({
                id: 'call_' + log.id, date: log.timestamp, type: 'call',
                icon: (isTextMsg || isWhatsApp) ? MessageSquare : Headset,
                color: isTextMsg ? 'text-amber-600' : 'text-slate-600',
                bg: isTextMsg ? 'bg-amber-50' : 'bg-slate-100',
                content: (
                    <>
                        <p className="text-sm font-bold text-slate-800 flex items-center justify-between">
                            <span>
                                {isTextMsg ? 'رسالة مُرسَلة' : 'محاولة تواصل'}{' '}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] mr-1 ${getOutcomeDisplay(log.outcome).bg} ${getOutcomeDisplay(log.outcome).color}`}>{getOutcomeDisplay(log.outcome).label}</span>
                                {isTextMsg && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-700 font-bold mr-1">منتظر رد</span>
                                )}
                            </span>
                            <span className="text-xs text-slate-500 font-bold bg-slate-100 rounded px-2 py-0.5" dir="ltr">المحاولة {index + 1}</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2" dir="ltr">{log.contactNumber} ({log.contactLabel})</p>
                        {log.notes && <p className="text-xs text-slate-500 mt-2 border border-slate-200 bg-slate-50 p-2.5 rounded shadow-sm">ملاحظات: {log.notes}</p>}
                        {isLatest && log.outcome === 'message_sent' && (
                            <button
                                onClick={() => {
                                    const contacts = entityDetails ? ((entityDetails as any).contacts as any[] ?? []) : [];
                                    const match = contacts.find((c: any) => c.number === log.contactNumber);
                                    const contactId = match?.id ?? contacts.find((c: any) => c.isPrimary)?.id ?? contacts[0]?.id ?? '';
                                    setMessageReplyContactId(contactId);
                                    setIsMessageReplyOpen(true);
                                }}
                                className="mt-3 text-xs flex items-center gap-1 text-amber-700 font-bold bg-amber-50 hover:bg-amber-100 px-3 py-2 rounded-lg border border-amber-200 transition-colors w-full justify-center shadow-sm"
                            >
                                <Edit3 className="w-3.5 h-3.5" /> تعديل نتيجة الرسالة
                            </button>
                        )}
                        {isLatest && log.outcome !== 'message_sent' && !getOutcomeMeta(log.outcome).closesContactTarget && !getOutcomeMeta(log.outcome).opensAppointment && taskCalls.length < 3 && (
                            <button onClick={() => setIsOutcomeModalOpen(true)} className="mt-3 text-xs flex items-center gap-1 text-violet-600 font-bold bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg border border-violet-200 transition-colors w-full justify-center shadow-sm">
                                <Phone className="w-3.5 h-3.5" /> محاولة مرة أخرى
                            </button>
                        )}
                        {isLatest && log.outcome !== 'message_sent' && taskCalls.length >= 3 && !getOutcomeMeta(log.outcome).closesContactTarget && !getOutcomeMeta(log.outcome).opensAppointment && (
                            <div className="mt-3 text-xs font-bold text-amber-700 bg-amber-50 rounded-lg p-3 border border-amber-200 shadow-sm flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    3 محاولات قد تكون كافية.
                                    <button onClick={() => { setPreselectedContactId(''); setIsOutcomeModalOpen(true); }} className="block mt-1 underline text-amber-600">جرّب تغيير الرقم</button>
                                    <button onClick={() => setIsManualCloseOpen(true)} className="block mt-0.5 underline text-amber-600">أو ارفض الجدولة</button>
                                </div>
                            </div>
                        )}
                    </>
                ),
            });
        });

        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [selectedCustomer, candidates, clients, contracts, visits, maintenanceRequests, callLogs]);

    const openTaskRows = useMemo(() => {
        if (!selectedCustomer) return [];

        return selectedCustomer.openTasks.map(task => {
            const details = task.openTaskId ? openTaskDetails[task.openTaskId] : undefined;
            return {
                key: task.taskListItemId,
                id: task.openTaskId,
                taskType: details?.taskType || task.openTaskType || '-',
                taskTypeLabel: details ? (OPEN_TASK_TYPE_LABELS as Record<string, string>)[details.taskType] || details.taskType : (OPEN_TASK_TYPE_LABELS as Record<string, string>)[task.openTaskType || ''] || task.openTaskType || '-',
                contractLabel: details?.contractSnapshot?.contractNumber || '-',
                reasonLabel: details ? (OPEN_TASK_REASON_LABELS as Record<string, string>)[details.reason] || details.reason : (OPEN_TASK_REASON_LABELS as Record<string, string>)[task.openTaskReason || ''] || task.openTaskReason || '-',
                priorityLabel: getPriorityLabel(details?.priority || null),
            };
        });
    }, [selectedCustomer, openTaskDetails]);

    // ── Summary metrics ───────────────────────────────────────────────────────

    const inListCount = useMemo(() => {
        const cgLogs = (cg: CustomerGroup) => callLogs.filter(l => l.entityId === cg.entityId && l.entityType === cg.entityType);
        return customerGroups.filter(cg => getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs(cg)) === 'in_list').length;
    }, [customerGroups, callLogs, getCustomerAppointment]);
    const closedCount = useMemo(() => {
        const cgLogs = (cg: CustomerGroup) => callLogs.filter(l => l.entityId === cg.entityId && l.entityType === cg.entityType);
        return customerGroups.filter(cg => getCustomerStatusGroup(cg, !!getCustomerAppointment(cg), cgLogs(cg)) === 'closed').length;
    }, [customerGroups, callLogs, getCustomerAppointment]);
    const bookedCount = customerGroups.filter(cg => cg.status === 'booked' || !!getCustomerAppointment(cg)).length;
    const bookingRate = closedCount > 0 ? Math.round((bookedCount / closedCount) * 100) : 0;
    const totalScheduled = teamAppointments.length;
    const isToday = date === getToday();

    const renderEmptyState = (icon: React.ReactNode, message: string) => (
        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 bg-slate-50 relative overflow-hidden p-6">
            {icon}
            <p className="font-bold text-slate-500 text-center mt-3 text-sm">{message}</p>
        </div>
    );

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-100" dir="rtl">
            {/* TOP BAR */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                        <Headset className="w-5 h-5 text-white" />
                    </div>
                    <h1 className="text-base font-bold text-slate-800">إدارة المواعيد <span className="text-slate-400 font-normal text-sm">| Telemarketing</span></h1>
                </div>
                <div className="flex items-center gap-2" dir="rtl">
                    <button type="button" onClick={() => changeDateBy(-1)} className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200">
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                    </button>
                    <button type="button" onClick={goToToday} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${isToday ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                        {formatDateArabic(date)}
                    </button>
                    <button type="button" onClick={() => changeDateBy(1)} className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200">
                        <ChevronLeft className="w-4 h-4 text-slate-600" />
                    </button>
                </div>
            </div>

            {/* 3-COLUMN LAYOUT */}
            <div className="flex-1 flex overflow-hidden p-3 gap-3">

                {/* COLUMN 1: Customer queue (20%) */}
                <div className="w-1/5 min-w-[280px] bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm overflow-hidden">
                    {/* Team Selector */}
                    <div className="p-3 border-b border-gray-100 bg-slate-50">
                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">اختر أحد الفرق النشطة</label>
                        <select value={selectedTeamKey} onChange={e => { setSelectedTeamKey(e.target.value); setSelectedCustomerKey(null); }}
                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none">
                            {availableTeams.length === 0 && <option value="">لا يوجد فرق</option>}
                            {availableTeams.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                    </div>

                    {/* CT lifecycle filter tabs */}
                    <div className="px-2 py-2 border-b border-gray-100 flex flex-wrap gap-1">
                        {(Object.keys(statusFilterConfig) as StatusFilter[]).map(filter => {
                            const config = statusFilterConfig[filter];
                            const count = filter === 'all' ? customerGroups.length : counts[filter as keyof typeof counts] ?? 0;
                            const isActive = statusFilter === filter;
                            return (
                                <button key={filter} onClick={() => setStatusFilter(filter)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all ${isActive ? `${config.activeBg} ${config.activeText} shadow-sm` : `${config.inactiveBg} ${config.inactiveText} hover:opacity-80`}`}>
                                    {config.label} ({count})
                                </button>
                            );
                        })}
                    </div>

                    {/* Search */}
                    <div className="px-2 py-2 border-b border-gray-100">
                        <div className="relative">
                            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input type="text" placeholder="بحث بالاسم أو الرقم..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pr-8 pl-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:border-violet-400 focus:outline-none bg-white" />
                        </div>
                    </div>

                    {/* Queue header */}
                    <div className="sticky top-0 z-10 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                        <h2 className="text-sm font-black text-slate-700">قائمة الزبائن</h2>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200">{inListCount} ضمن القائمة</span>
                    </div>

                    {/* Customer list */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scroll" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                        {availableTeams.length === 0 && renderEmptyState(<AlertTriangle className="w-10 h-10 text-slate-300" />, 'لا يوجد جدول فرق لهذا التاريخ')}
                        {availableTeams.length > 0 && !activeTaskList && renderEmptyState(<Calendar className="w-10 h-10 text-slate-300" />, 'لم يتم توليد قائمة الاتصال لهذا الفريق بعد')}
                        {activeTaskList && filteredGroups.length === 0 && customerGroups.length > 0 && renderEmptyState(<Search className="w-10 h-10 text-slate-300" />, 'لا توجد نتائج مطابقة')}
                        {activeTaskList && customerGroups.length === 0 && renderEmptyState(<AlertTriangle className="w-10 h-10 text-slate-300" />, 'لا يوجد زبائن في قائمة الاتصال')}

                        {filteredGroups.map(cg => {
                            const isActive = cg.key === selectedCustomerKey;
                            const cgAppt = getCustomerAppointment(cg);
                            const isBooked = cg.status === 'booked' || !!cgAppt;
                            const cgLogs = callLogs.filter(l => l.entityId === cg.entityId && l.entityType === cg.entityType);
                            const ctStage = getCustomerStatusGroup(cg, isBooked, cgLogs);
                            const ctClosed = isContactTargetClosed(cg, isBooked);
                            const otherTeamsCount = getOtherTeamsCount(cg);

                            // Badge for CT lifecycle stage
                            const ctBadge = (() => {
                                if (isBooked) return (
                                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> محجوز{cgAppt ? ` ${cgAppt.timeSlot}` : ''}
                                    </span>
                                );
                                if (ctClosed) {
                                    const isManual = cg.callOutcome === 'manual_close';
                                    return (
                                        <span className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                            {isManual ? 'مغلقة يدوياً' : 'مغلقة'}
                                        </span>
                                    );
                                }
                                if (ctStage === 'contacted') return (
                                    <span className="text-[10px] text-amber-700 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                                        <History className="w-3 h-3" /> تم التواصل ({cgLogs.length})
                                    </span>
                                );
                                return null;
                            })();

                            return (
                                <button key={cg.key} onClick={() => setSelectedCustomerKey(cg.key)}
                                    className={`w-full text-right p-2.5 rounded-xl border transition-all flex items-start gap-3 outline-none ${isActive
                                        ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-500/10 shadow-sm'
                                        : isBooked ? 'bg-emerald-50 border-emerald-200'
                                            : ctClosed ? 'bg-slate-50 border-slate-200'
                                                : ctStage === 'contacted' ? 'bg-amber-50/40 border-amber-100'
                                                    : 'bg-white border-gray-100 hover:border-violet-200 hover:bg-slate-50 hover:shadow-sm'}`}>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0 border-2 overflow-hidden relative shadow-sm ${
                                        isBooked ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                                        : ctClosed ? 'bg-slate-100 text-slate-500 border-slate-300'
                                        : ctStage === 'contacted' ? 'bg-amber-50 text-amber-700 border-amber-200'
                                        : 'bg-white text-slate-600 border-slate-200'}`}>
                                        {getInitials(cg.name)}
                                        <div className={`absolute bottom-0 w-full h-1.5 ${cg.entityType === 'client' ? 'bg-sky-500' : 'bg-amber-500'}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <p className={`text-sm font-bold truncate ${
                                                isBooked ? 'text-emerald-800'
                                                : ctClosed ? 'text-slate-400'
                                                : ctStage === 'contacted' ? 'text-amber-800'
                                                : 'text-slate-800'}`}>{cg.name}</p>
                                            {isBooked
                                                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                                : ctClosed
                                                    ? <CheckCircle className="w-4 h-4 text-slate-400 shrink-0" />
                                                    : <Phone className={`w-4 h-4 shrink-0 ${ctStage === 'contacted' ? 'text-amber-400' : 'text-slate-400'}`} />}
                                        </div>
                                        <div className="flex items-center justify-between mt-1 gap-1 flex-wrap">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${cg.entityType === 'client' ? 'bg-sky-50 text-sky-700 border-sky-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                {cg.entityType === 'client' ? 'زبون' : 'مقترح'}
                                            </span>
                                            {cg.openTasks.length > 0 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold border bg-purple-50 text-purple-700 border-purple-100 flex items-center gap-0.5">
                                                    <Layers className="w-2.5 h-2.5" />{cg.openTasks.length}
                                                </span>
                                            )}
                                            {cg.entityType === 'client' ? (
                                                <OwnershipBadge ownership={cg.primaryItem.ownership} />
                                            ) : null}
                                            {otherTeamsCount > 0 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold border bg-cyan-50 text-cyan-700 border-cyan-200">
                                                    +{otherTeamsCount} فرق
                                                </span>
                                            )}
                                            {ctBadge}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* COLUMN 2: Customer detail (55%) */}
                <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm overflow-hidden relative">
                    {selectedCustomer && entityDetails ? (
                        <>
                            {/* Client snapshot */}
                            <div className="px-6 py-5 border-b border-gray-100 bg-white shrink-0">
                                <div className="flex items-start justify-between gap-5">
                                    <div className="flex items-start gap-4 min-w-0">
                                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black shrink-0 border shadow-sm ${
                                            selectedCustomer.entityType === 'client'
                                                ? 'bg-sky-50 text-sky-800 border-sky-100'
                                                : 'bg-amber-50 text-amber-800 border-amber-100'
                                        }`}>
                                            {getInitials(selectedCustomer.name)}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h2 className="text-3xl font-black text-slate-950 leading-tight">{selectedCustomer.name}</h2>
                                                {selectedSnapshotMeta.nickname && (
                                                    <span className="text-sm font-bold text-slate-400">({selectedSnapshotMeta.nickname})</span>
                                                )}
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${
                                                    selectedCustomer.entityType === 'client'
                                                        ? 'bg-sky-50 text-sky-700 border-sky-200'
                                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                                }`}>
                                                    {selectedSnapshotMeta.classification}
                                                </span>
                                                {selectedSnapshotMeta.rating && selectedSnapshotMeta.classification === 'OP' && (
                                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-black border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                        {selectedSnapshotMeta.rating}
                                                    </span>
                                                )}
                                                {selectedCustomer.entityType === 'client' ? (
                                                    <OwnershipBadge ownership={selectedCustomer.primaryItem.ownership} />
                                                ) : null}
                                                {selectedSnapshotMeta.branchName && (
                                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border bg-slate-50 text-slate-600 border-slate-200">
                                                        {selectedSnapshotMeta.branchName}
                                                    </span>
                                                )}
                                                {selectedCustomer.lockedByHrUserName && (
                                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-bold border bg-amber-50 text-amber-700 border-amber-200">
                                                        قيد المتابعة: {selectedCustomer.lockedByHrUserName}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {primarySelectedContact && (
                                        <a
                                            href={`tel:${primarySelectedContact.number}`}
                                            className="h-11 px-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors font-black flex items-center gap-2 shrink-0 shadow-sm"
                                        >
                                            <Phone className="w-4 h-4" />
                                            <span dir="ltr">{primarySelectedContact.number}</span>
                                        </a>
                                    )}
                                </div>

                                <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2">
                                    {selectedSnapshotMeta.occupation && (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                            <p className="text-[10px] font-bold text-slate-400 mb-1">المهنة</p>
                                            <p className="text-sm font-black text-slate-800 truncate">{selectedSnapshotMeta.occupation}</p>
                                        </div>
                                    )}
                                    {selectedSnapshotMeta.spouseOccupation && (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                            <p className="text-[10px] font-bold text-slate-400 mb-1">مهنة الزوج/الزوجة</p>
                                            <p className="text-sm font-black text-slate-800 truncate">{selectedSnapshotMeta.spouseOccupation}</p>
                                        </div>
                                    )}
                                    {selectedSnapshotMeta.sourceChannel && (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                            <p className="text-[10px] font-bold text-slate-400 mb-1">مصدر الزبون</p>
                                            <p className="text-sm font-black text-slate-800 truncate">{selectedSnapshotMeta.sourceChannel}</p>
                                        </div>
                                    )}
                                    {selectedSnapshotMeta.referrersCount > 0 && (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                            <p className="text-[10px] font-bold text-slate-400 mb-1">الوسيط</p>
                                            <p className="text-sm font-black text-slate-800 truncate">
                                                {selectedSnapshotMeta.referrerName || `${selectedSnapshotMeta.referrersCount} وسيط`}
                                                {selectedSnapshotMeta.referrerName && selectedSnapshotMeta.referrersCount > 1 ? ` +${selectedSnapshotMeta.referrersCount - 1}` : ''}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-4">
                                    <div className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
                                        <div className="flex items-start gap-2">
                                            <MapPin className="w-4 h-4 text-sky-500 mt-0.5 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[11px] text-slate-400 font-black mb-1">العنوان المعتمد للتواصل</p>
                                                <p className="text-sm text-slate-900 font-black leading-relaxed">{selectedAddressLabel}</p>
                                                {selectedSnapshotMeta.detailedAddress && (
                                                    <p className="text-xs text-slate-500 font-semibold mt-1 leading-relaxed">{selectedSnapshotMeta.detailedAddress}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <p className="text-[11px] text-slate-400 font-black">أرقام إضافية</p>
                                            {selectedOtherTargets.length > 0 && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-md border border-cyan-100 bg-cyan-50 text-cyan-700 font-black">
                                                    {selectedOtherTargets.length} جهة أخرى اليوم
                                                </span>
                                            )}
                                        </div>
                                        {secondarySelectedContacts.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {secondarySelectedContacts.map(contact => (
                                                    <a
                                                        key={contact.id || contact.number}
                                                        href={`tel:${contact.number}`}
                                                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 text-sm font-bold transition-colors"
                                                    >
                                                        <Phone className="w-3.5 h-3.5" />
                                                        <span dir="ltr">{contact.number}</span>
                                                        {contact.label && <span className="text-[10px] text-slate-500">{contact.label}</span>}
                                                        {contact.hasWhatsApp && <MessageSquare className="w-3.5 h-3.5 text-green-500" />}
                                                    </a>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 font-bold">لا توجد أرقام إضافية.</p>
                                        )}
                                    </div>
                                </div>

                                {(selectedCustomer.openTasks.length > 0 || selectedSnapshotMeta.notes) && (
                                    <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-gray-100 pt-3">
                                        {selectedCustomer.openTasks.map(ot => (
                                            <span key={ot.taskListItemId} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border bg-violet-50 border-violet-100 text-violet-700 font-black">
                                                <Layers className="w-3 h-3" />
                                                {(OPEN_TASK_TYPE_LABELS as Record<string, string>)[ot.openTaskType as OpenTaskType] || ot.openTaskType}
                                                {ot.openTaskReason && <span className="text-violet-400">{(OPEN_TASK_REASON_LABELS as Record<string, string>)[ot.openTaskReason as OpenTaskReason] || ot.openTaskReason}</span>}
                                            </span>
                                        ))}
                                        {selectedSnapshotMeta.notes && (
                                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border bg-slate-50 border-slate-200 text-slate-600 font-bold max-w-full">
                                                <FileText className="w-3 h-3 shrink-0" />
                                                <span className="truncate">{selectedSnapshotMeta.notes}</span>
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Tabs */}
                            <div className="px-6 flex gap-6 border-b border-gray-100 shrink-0 bg-white shadow-sm z-10">
                                {[{ id: 'journey', label: 'سجل الاتصالات', icon: Activity }, { id: 'contracts', label: 'العقود', icon: FileText }, { id: 'visits', label: 'الزيارات', icon: Wrench }, { id: 'openTasks', label: 'المهام المفتوحة', icon: Layers }].map(tab => (
                                    <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                                        className={`py-3.5 text-sm font-bold flex items-center gap-2 relative transition-colors ${activeTab === tab.id ? 'text-violet-800' : 'text-slate-500 hover:text-slate-800'}`}>
                                        <tab.icon className="w-4 h-4" /> {tab.label}
                                        {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-violet-600 rounded-t-full shadow-[0_-2px_4px_rgba(124,58,237,0.5)]" />}
                                    </button>
                                ))}
                            </div>

                            {/* Tab content */}
                            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 custom-scroll relative">
                                {activeTab === 'journey' && (
                                    <>
                                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-200" style={{ transform: 'translateX(-50%)' }} />
                                        <div className="space-y-6 max-w-2xl mx-auto relative z-10">
                                            {journeyEvents.length === 0 ? (
                                                <div className="text-center bg-white border border-dashed border-gray-300 rounded-xl p-8">
                                                    <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                                    <p className="text-sm font-bold text-slate-500">لا توجد أنشطة مسجلة لهذا الزبون بعد</p>
                                                </div>
                                            ) : (
                                                journeyEvents.map((item, idx) => (
                                                    <div key={item.id} className={`flex ${idx % 2 === 0 ? 'flex-row' : 'flex-row-reverse'} w-full items-center justify-between`}>
                                                        <div className="w-5/12" />
                                                        <div className="w-2/12 flex justify-center z-10">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-slate-50 shadow-sm ${item.bg}`}>
                                                                <item.icon className={`w-4 h-4 ${item.color}`} />
                                                            </div>
                                                        </div>
                                                        <div className="w-5/12">
                                                            <div className={`bg-white border text-right border-gray-200 p-4 rounded-xl shadow-sm`}>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <span className="text-xs text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200" dir="ltr">
                                                                        {new Date(item.date).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' })}
                                                                    </span>
                                                                </div>
                                                                {item.content}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </>
                                )}
                                {activeTab === 'contracts' && <div className="text-center p-8"><p className="text-sm font-bold text-slate-500">سجل العقود (قريباً)</p></div>}
                                {activeTab === 'visits' && <div className="text-center p-8"><p className="text-sm font-bold text-slate-500">سجل الزيارات (قريباً)</p></div>}
                                {activeTab === 'openTasks' && (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-lg font-black text-slate-800">جدول المهام المفتوحة</h3>
                                                <p className="text-xs text-slate-500 mt-1">{selectedCustomer?.openTasks.length || 0} مهمة مرتبطة بهذا الزبون</p>
                                            </div>
                                            {openTaskDetailsLoading && <span className="text-xs font-bold text-violet-600 bg-violet-50 border border-violet-100 px-2.5 py-1 rounded-lg">جارٍ التحميل...</span>}
                                        </div>

                                        {openTaskRows.length === 0 ? (
                                            <div className="text-center bg-white border border-dashed border-gray-300 rounded-xl p-8">
                                                <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                                <p className="text-sm font-bold text-slate-500">لا توجد مهام مفتوحة لهذا الزبون</p>
                                            </div>
                                        ) : (
                                            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                                                <table className="w-full text-right">
                                                    <thead className="bg-slate-50 border-b border-gray-100">
                                                        <tr>
                                                            <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">نوع المهمة</th>
                                                            <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">العقد</th>
                                                            <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">السبب</th>
                                                            <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">الأولوية</th>
                                                            <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide text-center">إجراء</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {openTaskRows.map(row => {
                                                            const detailPath = getOpenTaskDetailPath(row.taskType, row.id);
                                                            return (
                                                                <tr key={row.key} className="border-b border-gray-100 last:border-b-0 hover:bg-violet-50/40 transition-colors">
                                                                    <td className="px-4 py-3 text-sm font-bold text-slate-800">{row.taskTypeLabel}</td>
                                                                    <td className="px-4 py-3 text-sm text-slate-600">{row.contractLabel}</td>
                                                                    <td className="px-4 py-3 text-sm text-slate-600">{row.reasonLabel}</td>
                                                                    <td className="px-4 py-3 text-sm text-slate-600">{row.priorityLabel}</td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        {detailPath ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => navigate(detailPath)}
                                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100 transition-colors"
                                                                            >
                                                                                <Eye className="w-3.5 h-3.5" /> عرض التفاصيل
                                                                            </button>
                                                                        ) : (
                                                                            <span className="text-xs text-slate-400 font-bold">-</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Call log save error banner */}
                            {callLogSaveError && (
                                <div className="mx-2 mb-1 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between gap-2 text-xs text-red-700 font-bold">
                                    <span className="flex items-center gap-1.5">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                        {callLogSaveError}
                                    </span>
                                    <button onClick={() => setCallLogSaveError(null)} className="text-red-400 hover:text-red-600">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}

                            {/* Action bar */}
                            <div className="p-2 bg-white border-t border-gray-200 flex gap-2 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)] z-20">
                                <button
                                    onClick={async () => {
                                        if (!(await claimSelectedContactTarget())) return;
                                        if (!entityDetails) return;
                                        const contacts = getEntityContacts(entityDetails as any);
                                        if (contacts.length === 1) {
                                            // Single contact — skip picker, go directly to outcome modal
                                            setPreselectedContactId(contacts[0].id);
                                            setIsOutcomeModalOpen(true);
                                        } else {
                                            setIsContactPickerOpen(true);
                                        }
                                    }}
                                    disabled={isCtClosedForSelected || isLockedByOtherForSelected}
                                    className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-2 border-none rounded-xl transition-all shadow-sm group active:scale-[0.98] ${isCtClosedForSelected || isLockedByOtherForSelected ? 'bg-slate-100 border border-slate-200 text-slate-400 grayscale cursor-not-allowed shadow-none' : 'bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 shadow-violet-500/10'}`}>
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isCtClosedForSelected || isLockedByOtherForSelected ? 'bg-slate-200' : 'bg-white/20'}`}>
                                        <Send className={`w-3.5 h-3.5 ${isCtClosedForSelected || isLockedByOtherForSelected ? 'text-slate-400' : 'text-white'}`} />
                                    </div>
                                    <div className="text-right overflow-hidden">
                                        <p className={`font-black text-[11px] leading-tight truncate ${isCtClosedForSelected ? 'text-slate-500' : 'text-white'}`}>{isCtClosedForSelected ? 'جهة الاتصال مغلقة' : 'تسجيل نتيجة التواصل'}</p>
                                        <p className={`text-[8px] font-bold opacity-70 truncate ${isCtClosedForSelected ? 'text-slate-400' : 'text-violet-100'}`}>{isCtClosedForSelected ? 'لا يمكن تسجيل نتيجة' : 'تحديث الحالة'}</p>
                                    </div>
                                </button>

                                {/* Appointment badge — shown when visit is confirmed */}
                                {selectedAppointment && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 shrink-0">
                                        <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        <div className="text-right">
                                            <p className="font-black text-[10px] text-emerald-700 leading-tight">موعد مؤكد</p>
                                            <p className="text-[9px] font-bold text-emerald-500" dir="ltr">{selectedAppointment.date} {selectedAppointment.timeSlot}</p>
                                        </div>
                                    </div>
                                )}

                                {isLockedByOtherForSelected && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                        <div className="text-right">
                                            <p className="font-black text-[10px] leading-tight">محجوزة</p>
                                            <p className="text-[9px] font-bold">{selectedCustomer.lockedByHrUserName || 'تيلماركتر آخر'}</p>
                                        </div>
                                    </div>
                                )}

                                {canDirectBookSelected && (
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (!(await claimSelectedContactTarget())) return;
                                            setAppointmentMode('direct');
                                            setIsAppointmentModalOpen(true);
                                        }}
                                        title="حجز زيارة بدون تسجيل نتيجة مكالمة جديدة"
                                        className="py-1.5 px-3 flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 transition-all active:scale-[0.98] font-black text-[11px]"
                                    >
                                        <Calendar className="w-4 h-4" />
                                        حجز مباشر
                                    </button>
                                )}

                                {/* Manual close button — only when CT is not yet closed */}
                                {!isCtClosedForSelected && !isLockedByOtherForSelected && (
                                    <button
                                        onClick={() => setIsManualCloseOpen(true)}
                                        title="إغلاق يدوي وإعادة المهمة لقيد الانتظار"
                                        className="py-1.5 px-2.5 flex items-center justify-center rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-500 hover:text-red-700 transition-all active:scale-[0.98]">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            {/* Manual close modal */}
                            {isManualCloseOpen && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                                    onClick={e => { if (e.target === e.currentTarget) { setIsManualCloseOpen(false); setManualCloseReason(''); } }}>
                                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
                                        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                                            <div>
                                                <h3 className="font-bold text-slate-900">إغلاق جهة الاتصال</h3>
                                                <p className="text-xs text-slate-500 mt-0.5">تعود المهمة إلى مرحلة قيد الانتظار</p>
                                            </div>
                                            <button onClick={() => { setIsManualCloseOpen(false); setManualCloseReason(''); }} className="text-slate-400 hover:text-slate-600">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="px-5 py-4">
                                            <label className="block text-xs font-bold text-slate-600 mb-1">سبب الإغلاق (اختياري)</label>
                                            <select
                                                value={manualCloseReason}
                                                onChange={e => setManualCloseReason(e.target.value)}
                                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 bg-white"
                                            >
                                                <option value="">— بدون سبب محدد —</option>
                                                {rejectionReasons.map(r => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
                                            <button
                                                onClick={() => { setIsManualCloseOpen(false); setManualCloseReason(''); }}
                                                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
                                            >إلغاء</button>
                                            <button
                                                onClick={handleManualClose}
                                                disabled={manualCloseSaving}
                                                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60"
                                            >
                                                {manualCloseSaving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                                                إغلاق وإعادة للانتظار
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 bg-slate-50 relative overflow-hidden">
                            <Headset className="w-20 h-20 mb-4 text-violet-100" />
                            <p className="font-bold text-slate-500">يرجى اختيار زبون من قائمة الفريق</p>
                        </div>
                    )}
                </div>

                {/* COLUMN 3: Team situational awareness (25%) */}
                <div className="w-1/4 min-w-[300px] flex flex-col gap-3 relative shrink-0">
                    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm shrink-0">
                        <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-1.5"><Zap className="w-4 h-4 text-amber-500" /> مؤشر أداء التيلماركتر</h3>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-emerald-700 mb-1 leading-tight line-clamp-2">زيارات مجدولة</p>
                                <p className="text-xl font-black text-emerald-700">{totalScheduled}</p>
                            </div>
                            <div className="bg-violet-50 rounded-xl p-3 border border-violet-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-violet-700 mb-1 leading-tight line-clamp-2">جهات مغلقة</p>
                                <p className="text-xl font-black text-violet-700">{closedCount}</p>
                            </div>
                            <div className="bg-sky-50 rounded-xl p-3 border border-sky-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-sky-700 mb-1 leading-tight line-clamp-2">نسبة نجاح الحجز</p>
                                <p className="text-xl font-black text-sky-700">{bookingRate}%</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm shrink-0">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <h3 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
                                <Layers className="w-4 h-4 text-cyan-600" />
                                الوعي عبر الفرق
                            </h3>
                            {crossTeamLoading && <span className="text-[10px] font-bold text-cyan-600">تحميل...</span>}
                        </div>
                        {!selectedCustomer ? (
                            <p className="text-xs text-slate-400 font-bold">اختر زبونا لعرض جهات اليوم.</p>
                        ) : selectedOtherTargets.length === 0 ? (
                            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                                لا توجد جهات أخرى لهذا الزبون اليوم.
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scroll">
                                {selectedOtherTargets.map(target => {
                                    const isClosed = target.status === 'closed';
                                    const outcome = target.latestTelemarketingOutcome || target.latestCallOutcome;
                                    const outcomeLabel = outcome ? getOutcomeDisplay(outcome).label : 'بدون نتيجة';
                                    return (
                                        <div key={target.id} className="rounded-lg border border-cyan-100 bg-cyan-50/50 px-3 py-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-black text-slate-800 truncate">{target.teamKey || 'فريق غير محدد'}</span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${isClosed ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                                    {isClosed ? 'مغلقة' : target.status}
                                                </span>
                                            </div>
                                            <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] font-bold text-slate-500">
                                                <span className="truncate">الموقع: {target.workLocationName || '-'}</span>
                                                <span className="truncate">المهام: {target.taskCount}</span>
                                                <span className="truncate">آخر نتيجة: {outcomeLabel}</span>
                                                <span className="truncate">القفل: {target.lockedByHrUserName || '-'}</span>
                                            </div>
                                            {target.latestVisitId && (
                                                <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                                                    <Calendar className="w-3 h-3" />
                                                    زيارة {target.visitDate || ''} {target.visitTime || ''}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col relative w-full h-full">
                        <div className="absolute inset-0">
                            <TeamAgendaPanel appointments={teamAppointments} date={date} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Message Reply Modal — updates outcome of a previously sent text message */}
            <MessageReplyOutcomeModal
                isOpen={isMessageReplyOpen}
                onClose={() => { setIsMessageReplyOpen(false); setMessageReplyContactId(''); }}
                logId=""
                canBook={canBook}
                onSave={async (outcome, notes) => {
                    setIsMessageReplyOpen(false);
                    await handleSaveOutcome(messageReplyContactId, outcome, notes, {
                        communicationChannel: 'cellular_call',
                        status: 'completed',
                    });
                    setMessageReplyContactId('');
                }}
            />

            {/* Step-1 Contact Picker Modal — user selects which number to call */}
            {isContactPickerOpen && selectedCustomer && entityDetails && (
                <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                    dir="rtl"
                    onClick={e => { if (e.target === e.currentTarget) setIsContactPickerOpen(false); }}
                >
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 bg-violet-50">
                            <div>
                                <h3 className="font-bold text-slate-800 text-base">اختر رقم التواصل</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{selectedCustomer.name}</p>
                            </div>
                            <button onClick={() => setIsContactPickerOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Contact list */}
                        <div className="p-3 space-y-2">
                            {getEntityContacts(entityDetails as any).map(contact => (
                                <button
                                    key={contact.id}
                                    type="button"
                                    onClick={() => {
                                        setPreselectedContactId(contact.id);
                                        setIsContactPickerOpen(false);
                                        setIsOutcomeModalOpen(true);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition-all text-right group active:scale-[0.98]"
                                >
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${contact.hasWhatsApp ? 'bg-green-100' : 'bg-slate-100'}`}>
                                        {contact.hasWhatsApp
                                            ? <MessageSquare className="w-4.5 h-4.5 text-green-600" />
                                            : <Phone className="w-4.5 h-4.5 text-slate-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0 text-right">
                                        <p className="text-sm font-black text-slate-800" dir="ltr">{contact.number}</p>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {contact.label}
                                            {contact.hasWhatsApp && <span className="text-green-600"> · يدعم واتساب</span>}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {contact.isPrimary && (
                                            <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">أساسي</span>
                                        )}
                                        <Send className="w-3.5 h-3.5 text-slate-300 group-hover:text-violet-500 transition-colors" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Service Task Creation Modal — step-2 after service_request outcome */}
            {isServiceTaskOpen && selectedCustomer && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                    dir="rtl"
                    onClick={e => { if (e.target === e.currentTarget) setIsServiceTaskOpen(false); }}
                >
                    <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 bg-indigo-50">
                            <div>
                                <h3 className="font-bold text-slate-800">إنشاء مهمة خدمة</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{selectedCustomer.name}</p>
                            </div>
                            <button onClick={() => setIsServiceTaskOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            {/* Task type — pre-filled, read-only display */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">نوع المهمة</label>
                                <div className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-bold text-indigo-800">
                                    {serviceTaskTypeLabel || serviceTaskType}
                                </div>
                            </div>
                            {/* Notes */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">ملاحظات (اختياري)</label>
                                <textarea
                                    value={serviceTaskNotes}
                                    onChange={e => setServiceTaskNotes(e.target.value)}
                                    placeholder="تفاصيل الطلب..."
                                    rows={2}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none"
                                />
                            </div>
                            {/* Priority */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">الأولوية (اختياري)</label>
                                <div className="flex gap-2">
                                    {[{ v: 'high', label: 'عالية', cls: 'border-red-400 bg-red-500 text-white' },
                                      { v: 'medium', label: 'متوسطة', cls: 'border-amber-400 bg-amber-500 text-white' },
                                      { v: 'low', label: 'منخفضة', cls: 'border-slate-400 bg-slate-500 text-white' }].map(opt => (
                                        <button key={opt.v} type="button"
                                            onClick={() => setServiceTaskPriority(p => p === opt.v ? '' : opt.v)}
                                            className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold transition-all ${serviceTaskPriority === opt.v ? opt.cls : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3 border-t border-slate-100 px-5 py-4">
                            <button onClick={() => setIsServiceTaskOpen(false)}
                                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                                تخطي
                            </button>
                            <button onClick={handleCreateServiceTask} disabled={serviceTaskSaving}
                                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                                {serviceTaskSaving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                                إنشاء المهمة
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals */}
            <OutcomeRecorderModal
                isOpen={isOutcomeModalOpen}
                onClose={() => { setIsOutcomeModalOpen(false); setPreselectedContactId(''); setIsContactPickerOpen(false); }}
                task={selectedCustomer?.primaryItem || null}
                entityDetails={entityDetails}
                canBook={canBook}
                preselectedContactId={preselectedContactId || undefined}
                customerOpenTasks={selectedCustomer?.openTasks}
                onSave={handleSaveOutcome}
            />

            <AppointmentSchedulerModal
                isOpen={isAppointmentModalOpen}
                onClose={() => {
                    setIsAppointmentModalOpen(false);
                    setAppointmentMode('call_result');
                }}
                customerName={selectedCustomer?.name || ''}
                defaultDate={date}
                initialDate={appointmentMode === 'direct' ? directBookingTask?.openTaskExpectedDate || undefined : undefined}
                defaultTime={appointmentMode === 'direct' ? directBookingTask?.openTaskExpectedTime || undefined : undefined}
                customerOpenTasks={selectedCustomer?.openTasks || []}
                entityDetails={entityDetails}
                onSave={handleSaveAppointment}
            />

            {isClientEditModalOpen && selectedCustomer?.entityType === 'client' && entityDetails && (
                <ClientModal
                    isOpen={isClientEditModalOpen}
                    onClose={() => setIsClientEditModalOpen(false)}
                    onSave={(updatedClient: Client) => {
                        updateClient(updatedClient.id, updatedClient).catch(() => {});
                        setIsClientEditModalOpen(false);
                        loadClients();
                    }}
                    initialData={entityDetails as Client}
                    geoUnits={geoUnits}
                />
            )}
        </div>
    );
}
