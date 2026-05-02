import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
    Headset, Phone, FileText, CheckCircle2, History, CreditCard,
    AlertTriangle, Calendar, Send, Zap, User, Clock, CheckCircle,
    MapPin, PlusCircle, MessageSquare, ThumbsUp, Wrench, Activity, Briefcase,
    Search, ChevronLeft, ChevronRight
} from 'lucide-react';
import { api } from '../lib/api';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { useClientStore } from '../hooks/useClientStore';
import { OPEN_TASK_TYPE_LABELS, OPEN_TASK_REASON_LABELS } from '@golden-crm/shared';
import type { OpenTaskType, OpenTaskReason } from '@golden-crm/shared';
import { useTelemarketingStore } from '../hooks/useTelemarketingStore';
import TeamAgendaPanel from '../components/telemarketing/TeamAgendaPanel';
import OutcomeRecorderModal from '../components/telemarketing/OutcomeRecorderModal';
import AppointmentSchedulerModal from '../components/telemarketing/AppointmentSchedulerModal';
import type { DaySchedule, Contract, Visit, Employee, TaskListItem, Appointment } from '../lib/types';
import type { TelemarketingOutcomeCode, GeoUnit } from '@golden-crm/shared';
import { OUTCOME_MAP, getOutcomeMeta, normaliseOutcomeCode, PHONE_STATUS_TO_CONTACT_ENTRY } from '@golden-crm/shared';
import { buildGeoHierarchyLabel } from '../utils/addressUtils';
import { getEntityContacts } from '../lib/contactUtils';

const formatDateKey = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
};

const getToday = () => formatDateKey(new Date());

const shiftDate = (dateStr: string, days: number) => {
    const d = parseDateKey(dateStr);
    d.setDate(d.getDate() + days);
    return formatDateKey(d);
};

const formatDateArabic = (dateStr: string) => {
    const d = parseDateKey(dateStr);
    return d.toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

type StatusFilter = 'all' | 'remaining' | 'booked' | 'contacted' | 'rejected';

const statusFilterConfig: Record<StatusFilter, { label: string; activeBg: string; activeText: string; inactiveBg: string; inactiveText: string }> = {
    all: { label: 'الكل', activeBg: 'bg-slate-700', activeText: 'text-white', inactiveBg: 'bg-slate-100', inactiveText: 'text-slate-600' },
    remaining: { label: 'معلق', activeBg: 'bg-violet-600', activeText: 'text-white', inactiveBg: 'bg-violet-50', inactiveText: 'text-violet-700' },
    booked: { label: 'محجوز', activeBg: 'bg-emerald-600', activeText: 'text-white', inactiveBg: 'bg-emerald-50', inactiveText: 'text-emerald-700' },
    contacted: { label: 'تم التواصل', activeBg: 'bg-sky-600', activeText: 'text-white', inactiveBg: 'bg-sky-50', inactiveText: 'text-sky-700' },
    rejected: { label: 'مرفوض', activeBg: 'bg-red-600', activeText: 'text-white', inactiveBg: 'bg-red-50', inactiveText: 'text-red-700' },
};

const getStatusGroup = (task: TaskListItem, hasAppointment?: boolean): StatusFilter => {
    if (task.status === 'booked' || hasAppointment) return 'booked';
    if (task.callOutcome) {
        const meta = getOutcomeMeta(task.callOutcome);
        if (meta.closesContactTarget) return 'rejected';
    }
    if (task.status === 'called') return 'contacted';
    return 'remaining';
};

const getOutcomeDisplay = (code: string): { label: string; color: string; bg: string } => {
    const meta = getOutcomeMeta(code);
    const colors: Record<string, { color: string; bg: string }> = {
        no_answer: { color: 'text-orange-700', bg: 'bg-orange-100' },
        busy: { color: 'text-amber-700', bg: 'bg-amber-100' },
        out_of_coverage: { color: 'text-orange-600', bg: 'bg-orange-100' },
        not_in_service: { color: 'text-red-600', bg: 'bg-red-100' },
        wrong_number: { color: 'text-red-700', bg: 'bg-red-100' },
        auto_disconnected: { color: 'text-orange-600', bg: 'bg-orange-100' },
        currently_busy: { color: 'text-amber-700', bg: 'bg-amber-100' },
        interrupted: { color: 'text-amber-600', bg: 'bg-amber-100' },
        not_interested: { color: 'text-red-700', bg: 'bg-red-100' },
        other_company_not_interested: { color: 'text-red-700', bg: 'bg-red-100' },
        seen_offer_not_interested: { color: 'text-red-700', bg: 'bg-red-100' },
        address_updated: { color: 'text-sky-700', bg: 'bg-sky-100' },
        other_company_callback: { color: 'text-violet-700', bg: 'bg-violet-100' },
        seen_offer_callback: { color: 'text-violet-700', bg: 'bg-violet-100' },
        service_request: { color: 'text-indigo-700', bg: 'bg-indigo-100' },
        company_customer_missing_phone: { color: 'text-indigo-700', bg: 'bg-indigo-100' },
        booked_marketing_appointment: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
        rejected: { color: 'text-red-700', bg: 'bg-red-100' },
        booked: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
    };
    return { label: meta.label, ...(colors[code] ?? { color: 'text-slate-700', bg: 'bg-slate-100' }) };
};

const getInitials = (name: string) => name.trim().split(' ').map(n => n[0]).slice(0, 2).join('') || 'U';

const getAppointmentForTask = (task: TaskListItem, appointments: Appointment[], teamKey: string, date: string): Appointment | undefined => {
    return appointments.find(appt =>
        appt.entityType === task.entityType &&
        appt.entityId === task.entityId &&
        appt.teamKey === teamKey &&
        appt.date === date
    );
};

export default function TelemarketerWorkspace() {
    const candidates = useCandidateStore(state => state.candidates);
    const { clients, loadClients, updateClient } = useClientStore();
    const { taskLists, appointments, callLogs, loadData, addCallLog, addAppointment, updateTaskListItemStatus, getTaskList, getAppointmentsForTeamDate } = useTelemarketingStore();

    const [contracts, setContracts] = useState<Contract[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [maintenanceRequests, setMaintenanceRequests] = useState<any[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
    const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
    const [date, setDate] = useState(getToday());
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    const changeDateBy = useCallback((days: number) => {
        setDate(prevDate => shiftDate(prevDate, days));
    }, []);

    const goToToday = useCallback(() => {
        setDate(getToday());
    }, []);

    const previousDayButton = useCallback(() => {
        changeDateBy(-1);
    }, [changeDateBy]);

    const nextDayButton = useCallback(() => {
        changeDateBy(1);
    }, [changeDateBy]);

    useEffect(() => {
        loadClients();
        loadData(date);

        // Clear stale selection while new date data loads
        setSelectedTaskId(null);

        Promise.all([
            api.contracts.list(),
            api.visits.list(),
            api.maintenanceRequests.list(),
            api.employees.list(),
            api.geoUnits.list(),
        ])
            .then(([contractsData, visitsData, maintenanceData, employeesData, geoUnitsData]) => {
                setContracts(contractsData);
                setVisits(visitsData);
                setMaintenanceRequests(maintenanceData);
                setEmployees(employeesData);
                setGeoUnits(geoUnitsData);
            })
            .catch(() => {
                setContracts([]);
                setVisits([]);
                setMaintenanceRequests([]);
                setEmployees([]);
                setGeoUnits([]);
            });
    }, [loadClients, loadData, date]);

    useEffect(() => {
        // Clear old schedule immediately so stale team names don't display
        setCurrentSchedule({ teams: [], solos: [] });
        api.schedules.get(date)
            .then(data => setCurrentSchedule(data || { teams: [], solos: [] }))
            .catch(() => setCurrentSchedule({ teams: [], solos: [] }));
    }, [date]);

    const getEmp = (id: number | null) => employees.find(e => e.id === id) || null;

    const availableTeams = useMemo(() => {
        const teams: { key: string; label: string; type: 'team' | 'solo'; count: number }[] = [];
        currentSchedule.teams.forEach((t, idx) => {
            const sup = getEmp(t.supervisor);
            const count = (t.telemarketers || []).length;
            const label = sup ? `فريق ${sup.name}` : `فريق #${idx + 1}`;
            teams.push({ key: `team_${idx}`, label, type: 'team', count });
        });
        currentSchedule.solos.forEach((s, idx) => {
            const tech = getEmp(s.technician);
            teams.push({ key: `solo_${idx}`, label: tech ? `فردي ${tech.name}` : `فردي #${idx + 1}`, type: 'solo', count: 1 });
        });
        return teams;
    }, [currentSchedule, employees]);

    const [selectedTeamKey, setSelectedTeamKey] = useState<string>('');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    useEffect(() => {
        const validKeys = availableTeams.map(t => t.key);
        if (!validKeys.includes(selectedTeamKey)) {
            setSelectedTeamKey(validKeys[0] || '');
            setSelectedTaskId(null);
        }
    }, [availableTeams, selectedTeamKey]);

    const activeTaskList = useMemo(() => {
        if (!selectedTeamKey) return null;
        return getTaskList(selectedTeamKey, date);
    }, [getTaskList, selectedTeamKey, date, taskLists]);

    const tasks = useMemo(() => {
        const raw = activeTaskList?.items || [];
        return [...raw].sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return 0;
        });
    }, [activeTaskList]);

    const teamAppointments = useMemo(() => getAppointmentsForTeamDate(selectedTeamKey, date), [getAppointmentsForTeamDate, selectedTeamKey, date, appointments]);

    const getTaskAppointment = useCallback((task: TaskListItem) => getAppointmentForTask(task, teamAppointments, selectedTeamKey, date), [teamAppointments, selectedTeamKey, date]);

    const counts = useMemo(() => ({
        remaining: tasks.filter(t => getStatusGroup(t, !!getAppointmentForTask(t, teamAppointments, selectedTeamKey, date)) === 'remaining').length,
        booked: tasks.filter(t => getStatusGroup(t, !!getAppointmentForTask(t, teamAppointments, selectedTeamKey, date)) === 'booked').length,
        contacted: tasks.filter(t => getStatusGroup(t, !!getAppointmentForTask(t, teamAppointments, selectedTeamKey, date)) === 'contacted').length,
        rejected: tasks.filter(t => getStatusGroup(t, !!getAppointmentForTask(t, teamAppointments, selectedTeamKey, date)) === 'rejected').length,
    }), [tasks, teamAppointments, selectedTeamKey, date]);

    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (statusFilter !== 'all') {
            result = result.filter(t => getStatusGroup(t, !!getTaskAppointment(t)) === statusFilter);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t =>
                t.name.toLowerCase().includes(q) ||
                (t.mobile && t.mobile.toLowerCase().includes(q)) ||
                (t.contactNumber && t.contactNumber.toLowerCase().includes(q))
            );
        }
        return result;
    }, [tasks, statusFilter, searchQuery, getTaskAppointment]);

    useEffect(() => {
        if (selectedTaskId && !filteredTasks.some(t => t.id === selectedTaskId)) {
            setSelectedTaskId(filteredTasks[0]?.id || null);
            return;
        }
        if (!selectedTaskId && filteredTasks.length > 0) {
            const firstPending = filteredTasks.find(t => t.status === 'pending') || filteredTasks[0];
            setSelectedTaskId(firstPending.id);
        }
    }, [filteredTasks, selectedTaskId]);

    const [activeTab, setActiveTab] = useState<'journey' | 'contracts' | 'visits'>('journey');
    const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
    const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);

    const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId) || null, [tasks, selectedTaskId]);

    const selectedTaskAppointment = useMemo(() => {
        if (!selectedTask) return null;
        return getAppointmentForTask(selectedTask, teamAppointments, selectedTeamKey, date);
    }, [selectedTask, teamAppointments, selectedTeamKey, date]);

    const isBookedForSelected = useMemo(() => {
        if (!selectedTask) return false;
        return selectedTask.status === 'booked' || selectedTask.callOutcome === 'booked_marketing_appointment' || !!selectedTaskAppointment;
    }, [selectedTask, selectedTaskAppointment]);

    const entityDetails = useMemo(() => {
        if (!selectedTask) return null;
        if (selectedTask.entityType === 'candidate') {
            return candidates.find(c => c.id === selectedTask.entityId);
        }
        return clients.find(c => c.id === selectedTask.entityId);
    }, [selectedTask, candidates, clients]);

    const handleSaveOutcome = async (contactId: string, outcome: TelemarketingOutcomeCode, notes: string, newContactStatus?: string, communicationMethod?: 'phone' | 'whatsapp_text' | 'whatsapp_voice') => {
        if (!selectedTask) return;

        const meta = OUTCOME_MAP[outcome] ?? OUTCOME_MAP['no_answer'];

        const entityContacts = getEntityContacts(entityDetails as any);
        const selectedContact = entityContacts.find(c => c.id === contactId) || entityContacts[0];

        await addCallLog({
            entityType: selectedTask.entityType,
            entityId: selectedTask.entityId,
            taskListId: activeTaskList!.id,
            taskListItemId: selectedTask.id,
            teamKey: selectedTeamKey,
            outcome,
            contactLabel: selectedContact.label,
            contactNumber: selectedContact.number,
            notes,
            communicationMethod
        });

        // Phone status update: only update the specific selected contact
        if (newContactStatus && selectedTask.entityType === 'client') {
            const client = clients.find(c => c.id === selectedTask.entityId);
            if (client && contactId !== 'legacy-fallback') {
                const contactEntry = client.contacts?.find((c: any) => c.id === contactId);
                if (contactEntry) {
                    const updatedContacts = client.contacts.map((c: any) =>
                        c.id === contactId ? { ...c, status: newContactStatus } : c
                    );
                    await updateClient(client.id, { contacts: updatedContacts });
                }
            }
        }

        // Determine item status from outcome mapping
        const newStatus = meta.itemStatusAfterSave;
        await updateTaskListItemStatus(activeTaskList!.id, selectedTask.id, newStatus, outcome);

        // Close outcome recorder modal
        setIsOutcomeModalOpen(false);

        // If the outcome opens appointment flow, show appointment modal
        if (meta.opensAppointment) {
            setIsAppointmentModalOpen(true);
        } else if (newStatus !== 'pending') {
            // Auto-advance to next pending task for non-pending outcomes (unless booking appointment)
            setTimeout(() => {
                const pendingTasks = tasks.filter(t => t.status === 'pending' && t.id !== selectedTask.id);
                if (pendingTasks.length > 0) {
                    setSelectedTaskId(pendingTasks[0].id);
                }
            }, 500);
        }
    };

    const handleSaveAppointment = async (data: { visitTime: string; visitTasks: string[]; waterSource: string; requestedDeviceModelId: number | null; requestedDeviceName: string; technicianNotes: string }) => {
        if (!selectedTask) return;
        await addAppointment({
            entityType: selectedTask.entityType,
            entityId: selectedTask.entityId,
            customerName: selectedTask.name,
            customerAddress: selectedTask.addressText,
            customerMobile: selectedTask.mobile,
            teamKey: selectedTeamKey,
            taskListItemId: selectedTask.id,
            taskListId: activeTaskList!.id,
            date,
            timeSlot: data.visitTime,
            occupation: '',
            waterSource: data.waterSource,
            notes: data.technicianNotes,
            visitTasks: data.visitTasks,
            requestedDeviceModelId: data.requestedDeviceModelId,
            requestedDeviceName: data.requestedDeviceName,
        });

        if (selectedTask.entityType === 'client') {
            await updateClient(selectedTask.entityId, { waterSource: data.waterSource });
        }

        await updateTaskListItemStatus(activeTaskList!.id, selectedTask.id, 'booked', 'booked_marketing_appointment');

        await loadData(date);
    };

    const getEntityCallLogs = () => {
        if (!selectedTask) return [];
        return callLogs.filter(log => log.entityId === selectedTask.entityId && log.entityType === selectedTask.entityType)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    };

    const generateJourneyEvents = () => {
        if (!selectedTask) return [];
        const events: any[] = [];

        if (selectedTask.entityType === 'candidate') {
            const cand = candidates.find(c => c.id === selectedTask.entityId);
            if (cand) {
                events.push({
                    id: 'cand_' + cand.id,
                    date: cand.createdAt,
                    type: 'suggestion',
                    icon: ThumbsUp,
                    color: 'text-amber-600',
                    bg: 'bg-amber-100',
                    content: (
                        <>
                            <p className="text-sm font-bold text-slate-800">تم اقتراح الزبون من قبل الوسيط <span className="text-amber-700">"{cand.referralNameSnapshot || 'غير محدد'}"</span></p>
                            <p className="text-xs text-slate-600 mt-1">المصدر: {cand.referralOriginChannel}</p>
                            <p className="text-xs text-slate-600">رقم الموبايل: <span dir="ltr">{cand.mobile}</span></p>
                        </>
                    )
                });
            }
        }

        if (selectedTask.entityType === 'client') {
            const client = clients.find(c => c.id === selectedTask.entityId);
            if (client) {
                events.push({
                    id: 'client_' + client.id,
                    date: client.createdAt,
                    type: 'suggestion',
                    icon: User,
                    color: 'text-amber-600',
                    bg: 'bg-amber-100',
                    content: (
                        <>
                            <p className="text-sm font-bold text-slate-800">تم تسجيل الزبون في النظام</p>
                            {client.referrerName && <p className="text-xs text-slate-600 mt-1">الوسيط: {client.referrerName}</p>}
                            <p className="text-xs text-slate-600">رقم الموبايل: <span dir="ltr">{client.mobile}</span></p>
                        </>
                    )
                });
            }
        }

        if (selectedTask.entityType === 'client') {
            const taskContracts = contracts.filter(c => c.customerId === selectedTask.entityId);
            taskContracts.forEach(c => {
                events.push({
                    id: 'contract_' + c.id,
                    date: c.contractDate || c.createdAt,
                    type: 'contract',
                    icon: FileText,
                    color: 'text-emerald-600',
                    bg: 'bg-emerald-100',
                    content: (
                        <>
                            <p className="text-sm font-bold text-slate-800">تم شراء جهاز <span className="text-emerald-700">"{c.deviceModelName}"</span> بعقد رقم #{c.contractNumber}</p>
                            <p className="text-xs text-slate-600 mt-1">القيمة: {c.finalPrice.toLocaleString()} ل.س | {c.paymentType === 'cash' ? 'نقدي' : 'أقساط'}</p>
                        </>
                    )
                });
            });
        }

        const taskVisits = visits.filter(v => v.customerId === selectedTask.entityId);
        taskVisits.forEach(v => {
            events.push({
                id: 'visit_' + v.id,
                date: v.date,
                type: 'visit',
                icon: Calendar,
                color: 'text-sky-600',
                bg: 'bg-sky-100',
                content: (
                    <>
                        <p className="text-sm font-bold text-slate-800">تم تنفيذ زيارة {v.outcome === 'Completed' ? 'ناجحة' : 'بالحالة: ' + v.outcome}</p>
                        <p className="text-xs text-slate-600 mt-1">بواسطة الفني: {v.employeeName}</p>
                        {v.notes && <p className="text-xs text-slate-500 mt-1 border border-slate-200 bg-slate-50 p-1.5 rounded">ملاحظات: {v.notes}</p>}
                    </>
                )
            });
        });

        if (selectedTask.entityType === 'client') {
            const taskMaintenance = maintenanceRequests.filter(m => m.customerId === selectedTask.entityId);
            taskMaintenance.forEach(m => {
                events.push({
                    id: 'maint_' + m.id,
                    date: m.requestDate,
                    type: 'maintenance',
                    icon: Zap,
                    color: 'text-orange-600',
                    bg: 'bg-orange-100',
                    content: (
                        <>
                            <p className="text-sm font-bold text-slate-800">تم تنفيذ زيارة صيانة <span className="text-orange-700">"{m.visitType}"</span></p>
                            <p className="text-xs text-slate-600 mt-1">وصف المشكلة: {m.problemDescription}</p>
                            <p className="text-xs text-slate-600">الحالة: {m.resolutionStatus}</p>
                        </>
                    )
                });
            });
        }

        const taskCalls = callLogs.filter(log => log.entityId === selectedTask.entityId && log.entityType === selectedTask.entityType)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        taskCalls.forEach((log, index) => {
            const isWhatsApp = log.communicationMethod?.startsWith('whatsapp');
            const isLatest = index === taskCalls.length - 1;

            events.push({
                id: 'call_' + log.id,
                date: log.timestamp,
                type: 'call',
                icon: isWhatsApp ? MessageSquare : Headset,
                color: 'text-slate-600',
                bg: 'bg-slate-100',
                content: (
                    <>
                        <p className="text-sm font-bold text-slate-800 flex items-center justify-between">
                            <span>محاولة تواصل <span className={`px-1.5 py-0.5 rounded text-[10px] mr-1 ${getOutcomeDisplay(log.outcome).bg} ${getOutcomeDisplay(log.outcome).color}`}>{getOutcomeDisplay(log.outcome).label}</span></span>
                            <span className="text-xs text-slate-500 font-bold bg-slate-100 rounded px-2 py-0.5" dir="ltr">المحاولة {index + 1}</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2" dir="ltr">{log.contactNumber} ({log.contactLabel})</p>
                        {log.notes && <p className="text-xs text-slate-500 mt-2 border border-slate-200 bg-slate-50 p-2.5 rounded shadow-sm">ملاحظات: {log.notes}</p>}

                        {isLatest && !getOutcomeMeta(log.outcome).closesContactTarget && !getOutcomeMeta(log.outcome).opensAppointment && taskCalls.length < 3 && (
                            <button onClick={() => setIsOutcomeModalOpen(true)} className="mt-3 text-xs flex items-center gap-1 text-violet-600 font-bold bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg border border-violet-200 transition-colors w-full justify-center shadow-sm">
                                <Phone className="w-3.5 h-3.5" /> محاولة مرة أخرى
                            </button>
                        )}

                        {isLatest && taskCalls.length >= 3 && !getOutcomeMeta(log.outcome).closesContactTarget && !getOutcomeMeta(log.outcome).opensAppointment && (
                            <div className="mt-3 text-xs font-bold text-amber-700 bg-amber-50 rounded-lg p-3 border border-amber-200 shadow-sm flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    استنفدت 3 محاولات، يرجى المحاولة على رقم آخر.
                                    <button onClick={() => setIsOutcomeModalOpen(true)} className="block mt-1 underline text-amber-600 hover:text-amber-800 transition-colors">تغيير الرقم وتسجيل اتصال جديد</button>
                                </div>
                            </div>
                        )}
                    </>
                )
            });
        });

        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    };

    const journeyEvents = useMemo(() => generateJourneyEvents(), [selectedTask, candidates, clients, contracts, visits, maintenanceRequests, callLogs]);

    const remainingCount = tasks.filter(t => getStatusGroup(t, !!getTaskAppointment(t)) === 'remaining').length;
    const completedCount = tasks.filter(t => getStatusGroup(t, !!getTaskAppointment(t)) !== 'remaining').length;
    const totalScheduled = teamAppointments.length;
    const bookedCount = tasks.filter(t => t.status === 'booked' || t.callOutcome === 'booked_marketing_appointment' || !!getTaskAppointment(t)).length;
    const bookingRate = completedCount > 0 ? Math.round((bookedCount / completedCount) * 100) : 0;

    const isToday = date === getToday();

    const renderEmptyState = (icon: React.ReactNode, message: string) => (
        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 bg-slate-50 relative overflow-hidden p-6">
            {icon}
            <p className="font-bold text-slate-500 text-center mt-3 text-sm">{message}</p>
        </div>
    );

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-100" dir="rtl">
            {/* ─── TOP BAR ─── */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                        <Headset className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-slate-800">إدارة المواعيد <span className="text-slate-400 font-normal text-sm">| Telemarketing</span></h1>
                    </div>
                </div>
                <div className="flex items-center gap-2" dir="rtl">
                    <button
                        type="button"
                        onClick={previousDayButton}
                        title="اليوم السابق"
                        aria-label="اليوم السابق"
                        className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
                    >
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                        <span className="sr-only">اليوم السابق</span>
                    </button>
                    <button
                        type="button"
                        onClick={goToToday}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${isToday ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                        title="العودة إلى اليوم"
                        aria-label="العودة إلى اليوم"
                    >
                        {formatDateArabic(date)}
                    </button>
                    <button
                        type="button"
                        onClick={nextDayButton}
                        title="اليوم التالي"
                        aria-label="اليوم التالي"
                        className="flex items-center gap-1 p-1.5 rounded-lg hover:bg-slate-100 transition-colors border border-slate-200"
                    >
                        <ChevronLeft className="w-4 h-4 text-slate-600" />
                        <span className="sr-only">اليوم التالي</span>
                    </button>
                    <span className="text-[10px] font-bold text-slate-400">اليوم السابق / اليوم / اليوم التالي</span>
                </div>
            </div>

            {/* ─── 3-COLUMN LAYOUT ─── */}
            <div className="flex-1 flex overflow-hidden p-3 gap-3">

                {/* COLUMN 1: Mission Control (20%) */}
                <div className="w-1/5 min-w-[280px] bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm overflow-hidden">
                    {/* Team Selector */}
                    <div className="p-3 border-b border-gray-100 bg-slate-50">
                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">اختر أحد الفرق النشطة</label>
                        <select
                            value={selectedTeamKey}
                            onChange={e => { setSelectedTeamKey(e.target.value); setSelectedTaskId(null); }}
                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none"
                        >
                            {availableTeams.length === 0 && <option value="">لا يوجد فرق</option>}
                            {availableTeams.map(t => (
                                <option key={t.key} value={t.key}>{t.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Status Filter Tabs with Counts */}
                    <div className="px-2 py-2 border-b border-gray-100 flex flex-wrap gap-1">
                        {(Object.keys(statusFilterConfig) as StatusFilter[]).map(filter => {
                            const config = statusFilterConfig[filter];
                            const count = filter === 'all' ? tasks.length : counts[filter];
                            const isActive = statusFilter === filter;
                            return (
                                <button
                                    key={filter}
                                    onClick={() => setStatusFilter(filter)}
                                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all ${isActive ? `${config.activeBg} ${config.activeText} shadow-sm` : `${config.inactiveBg} ${config.inactiveText} hover:opacity-80`}`}
                                >
                                    {config.label} ({count ?? 0})
                                </button>
                            );
                        })}
                    </div>

                    {/* Search Input */}
                    <div className="px-2 py-2 border-b border-gray-100">
                        <div className="relative">
                            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="بحث بالاسم أو الرقم..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pr-8 pl-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:border-violet-400 focus:outline-none bg-white"
                            />
                        </div>
                    </div>

                    {/* Priority Queue Header - Sticky */}
                    <div className="sticky top-0 z-10 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                        <h2 className="text-sm font-black text-slate-700">قائمة المهام</h2>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200">{remainingCount} معلق</span>
                    </div>

                    {/* Task Queue List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scroll" style={{ maxHeight: 'calc(100vh - 380px)' }}>
                        {availableTeams.length === 0 && (
                            renderEmptyState(
                                <AlertTriangle className="w-10 h-10 text-slate-300" />,
                                'لا يوجد جدول فرق لهذا التاريخ'
                            )
                        )}
                        {availableTeams.length > 0 && !activeTaskList && (
                            renderEmptyState(
                                <Calendar className="w-10 h-10 text-slate-300" />,
                                'لم يتم توليد قائمة الاتصال لهذا الفريق بعد'
                            )
                        )}
                        {activeTaskList && filteredTasks.length === 0 && tasks.length > 0 && (
                            renderEmptyState(
                                <Search className="w-10 h-10 text-slate-300" />,
                                'لا توجد نتائج مطابقة للبحث أو الفلتر'
                            )
                        )}
                        {activeTaskList && tasks.length === 0 && (
                            renderEmptyState(
                                <AlertTriangle className="w-10 h-10 text-slate-300" />,
                                'لا يوجد عملاء في قائمة الاتصال'
                            )
                        )}
                        {filteredTasks.map(task => {
                            const isActive = task.id === selectedTaskId;
                            const isProcessed = task.status !== 'pending';
                            const taskLogs = callLogs.filter(l => l.entityId === task.entityId && l.entityType === task.entityType);
                            const taskAppointment = getTaskAppointment(task);
                            const isBooked = task.status === 'booked' || task.callOutcome === 'booked_marketing_appointment' || !!taskAppointment;
                            const statusGroup = getStatusGroup(task, isBooked);

                            return (
                                <button
                                    key={task.id}
                                    onClick={() => setSelectedTaskId(task.id)}
                                    className={`w-full text-right p-2.5 rounded-xl border transition-all flex items-start gap-3 outline-none ${isActive
                                        ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-500/10 shadow-sm'
                                        : isBooked
                                            ? 'bg-emerald-50 border-emerald-200'
                                            : isProcessed
                                                ? 'bg-slate-50 border-transparent'
                                                : 'bg-white border-gray-100 hover:border-violet-200 hover:bg-slate-50 hover:shadow-sm'
                                    }`}
                                >
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0 border-2 overflow-hidden relative shadow-sm ${isBooked ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-white text-slate-600 border-slate-200'}`}>
                                        {getInitials(task.name)}
                                        {task.entityType === 'client' && <div className="absolute bottom-0 w-full h-1.5 bg-sky-500" />}
                                        {task.entityType === 'candidate' && <div className="absolute bottom-0 w-full h-1.5 bg-amber-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <p className={`text-sm font-bold truncate ${isBooked ? 'text-emerald-800' : isProcessed ? 'text-slate-500' : 'text-slate-800'}`}>{task.name}</p>
                                            {isBooked ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : isProcessed ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <Phone className="w-4 h-4 text-slate-400 shrink-0" />}
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${task.entityType === 'client' ? 'bg-sky-50 text-sky-700 border-sky-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                {task.entityType === 'client' ? 'زبون' : 'مقترح'}
                                            </span>
                                            {task.openTaskType && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold border bg-emerald-50 text-emerald-700 border-emerald-100">
                                                    {(OPEN_TASK_TYPE_LABELS[task.openTaskType as OpenTaskType] ?? task.openTaskType)} • {(OPEN_TASK_REASON_LABELS[task.openTaskReason as OpenTaskReason] ?? task.openTaskReason)}
                                                </span>
                                            )}
                                            {isBooked ? (
                                                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3" /> تم الحجز{taskAppointment ? ` ${taskAppointment.timeSlot}` : ''}
                                                </span>
                                            ) : statusGroup === 'rejected' ? (
                                                <span className="text-[10px] text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded border border-red-100">مرفوض</span>
                                            ) : statusGroup === 'contacted' ? (
                                                <span className="text-[10px] text-sky-600 font-bold bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100">تم التواصل</span>
                                            ) : taskLogs.length > 0 ? (
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1 font-bold">
                                                    <History className="w-3 h-3" /> {taskLogs.length} محاولات
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* COLUMN 2: Customer Command Center (55%) */}
                <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm overflow-hidden relative">
                    {selectedTask && entityDetails ? (
                        <>
                            {/* Identity Card Component */}
                            <div className="p-6 border-b border-gray-100 bg-gradient-to-br from-slate-50 to-white flex gap-6 shrink-0 relative overflow-hidden">
                                <div className="w-24 h-24 rounded-2xl bg-white flex items-center justify-center text-3xl font-black text-slate-600 shadow-sm border border-slate-200 relative overflow-hidden shrink-0 z-10">
                                    {getInitials(selectedTask.name)}
                                    <div className={`absolute bottom-0 w-full h-3 ${selectedTask.entityType === 'client' ? 'bg-sky-500' : 'bg-amber-500'}`} />
                                </div>
                                <div className="flex-1 z-10">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h2 className="text-3xl font-black text-slate-800 mb-2">{selectedTask.name}</h2>
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold border shadow-sm ${selectedTask.entityType === 'client' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                                    {selectedTask.entityType === 'client' ? 'زبون مسجل' : 'اسم مقترح (لم يتم تأهيله)'}
                                                </span>
                                                {'occupation' in (entityDetails || {}) && entityDetails.occupation && (
                                                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200 shadow-sm flex items-center gap-1">
                                                        <Briefcase className="w-3.5 h-3.5 text-slate-400" /> {entityDetails.occupation}
                                                    </span>
                                                )}
                                                {selectedTask.entityType === 'client' && 'rating' in entityDetails && entityDetails.rating === 'Committed' && (
                                                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm flex items-center gap-1">
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> ملتزم
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Location Intelligence */}
                                    <div className="flex flex-col gap-1 mt-4 text-sm text-slate-600 font-bold bg-white w-full px-4 py-3 rounded-lg border border-slate-200 shadow-sm">
                                        <div className="flex items-center gap-1.5 text-slate-500">
                                            <MapPin className="w-4 h-4 shrink-0" />
                                            <span>العنوان الكامل:</span>
                                        </div>
                                        <p className="text-slate-800 leading-relaxed mr-5">
                                          {buildGeoHierarchyLabel({
                                            geoUnits,
                                            neighborhoodId: selectedTask?.geoUnitId,
                                            fallback: selectedTask?.addressText,
                                          })}
                                        </p>
                                    </div>

                                    {/* Contact Arsenal */}
                                    <div className="flex flex-wrap items-center gap-3 mt-4">
                                        {getEntityContacts(entityDetails as any).map(contact => (
                                            <a key={contact.id} href={`tel:${contact.number}`} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 transition-colors shadow-sm font-bold">
                                                <Phone className="w-4 h-4" />
                                                <span className="text-base" dir="ltr">{contact.number}</span>
                                                <span className="text-[10px] bg-white text-emerald-800 px-2 py-0.5 rounded border border-emerald-100 shadow-sm">{contact.label}</span>
                                                {contact.isPrimary && <span className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded shadow-sm">أساسي</span>}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                                <div className="absolute left-0 top-0 w-64 h-64 bg-slate-100 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2 opacity-60"></div>
                            </div>

                            {/* Tabs Header */}
                            <div className="px-6 flex gap-6 border-b border-gray-100 shrink-0 bg-white shadow-sm z-10 transition-colors">
                                {[
                                    { id: 'journey', label: 'سجل الاتصالات', icon: Activity },
                                    { id: 'contracts', label: 'العقود', icon: FileText },
                                    { id: 'visits', label: 'الزيارات', icon: Wrench }
                                ].map(tab => (
                                    <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`py-3.5 text-sm font-bold flex items-center gap-2 relative transition-colors ${activeTab === tab.id ? 'text-violet-800' : 'text-slate-500 hover:text-slate-800'}`}>
                                        <tab.icon className="w-4 h-4" /> {tab.label}
                                        {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-violet-600 rounded-t-full shadow-[0_-2px_4px_rgba(124,58,237,0.5)]" />}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 custom-scroll relative">
                                {activeTab === 'journey' && (
                                    <>
                                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-200" style={{ transform: 'translateX(-50%)' }}></div>
                                        <div className="space-y-6 max-w-2xl mx-auto relative z-10">
                                            {journeyEvents.length === 0 ? (
                                                <div className="text-center bg-white border border-dashed border-gray-300 rounded-xl p-8">
                                                    <History className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                                                    <p className="text-sm font-bold text-slate-500">لا توجد أنشطة مسجلة لهذا الزبون بعد</p>
                                                </div>
                                            ) : (
                                                journeyEvents.map((item, idx) => (
                                                    <div key={item.id} className={`flex ${idx % 2 === 0 ? 'flex-row' : 'flex-row-reverse'} w-full items-center justify-between`}>
                                                        <div className="w-5/12"></div>
                                                        <div className="w-2/12 flex justify-center z-10">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-4 border-slate-50 shadow-sm ${item.bg}`}>
                                                                <item.icon className={`w-4 h-4 ${item.color}`} />
                                                            </div>
                                                        </div>
                                                        <div className="w-5/12">
                                                            <div className={`bg-white border text-right border-gray-200 p-4 rounded-xl shadow-sm ${idx % 2 === 0 ? 'mr-0 ml-auto' : 'ml-0 mr-auto'}`}>
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
                                {activeTab === 'contracts' && (
                                    <div className="text-center p-8"><p className="text-sm font-bold text-slate-500">سجل العقود (قريباً)</p></div>
                                )}
                                {activeTab === 'visits' && (
                                    <div className="text-center p-8"><p className="text-sm font-bold text-slate-500">سجل الزيارات (قريباً)</p></div>
                                )}
                            </div>

                            {/* Action Decision Zone */}
                            <div className="p-2 bg-white border-t border-gray-200 flex gap-2 shrink-0 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05),_0_-4px_6px_-2px_rgba(0,0,0,0.02)] z-20">
                                <button
                                    onClick={() => setIsOutcomeModalOpen(true)}
                                    disabled={isBookedForSelected}
                                    className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-2 border-none rounded-xl transition-all shadow-sm group active:scale-[0.98] ${isBookedForSelected ? 'bg-slate-100 border border-slate-200 text-slate-400 grayscale cursor-not-allowed shadow-none' : 'bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 shadow-violet-500/10'}`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isBookedForSelected ? 'bg-slate-200' : 'bg-white/20'}`}>
                                        <Send className={`w-3.5 h-3.5 ${isBookedForSelected ? 'text-slate-400' : 'text-white'}`} />
                                    </div>
                                    <div className="text-right overflow-hidden">
                                        <p className={`font-black text-[11px] leading-tight truncate ${isBookedForSelected ? 'text-slate-500' : 'text-white'}`}>{isBookedForSelected ? 'تم الحجز' : 'تسجيل نتيجة التواصل'}</p>
                                        <p className={`text-[8px] font-bold opacity-70 truncate ${isBookedForSelected ? 'text-slate-400' : 'text-violet-100'}`}>{isBookedForSelected ? 'لا يمكن تسجيل نتيجة' : 'تحديث الحالة'}</p>
                                    </div>
                                </button>

                                <button
                                    onClick={() => {
                                        if (selectedTaskAppointment) return;
                                        setIsAppointmentModalOpen(true);
                                    }}
                                    disabled={!isBookedForSelected || !!selectedTaskAppointment}
                                    className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-2 border-none rounded-xl transition-all group active:scale-[0.98] ${(!isBookedForSelected || !!selectedTaskAppointment)
                                        ? 'bg-slate-100 border border-slate-200 text-slate-400 grayscale cursor-not-allowed shadow-none'
                                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/10 text-white'
                                    }`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${(!isBookedForSelected || !!selectedTaskAppointment) ? 'bg-slate-200' : 'bg-white/20'}`}>
                                        <Calendar className={`w-3.5 h-3.5 ${(!isBookedForSelected || !!selectedTaskAppointment) ? 'text-slate-400' : ''}`} />
                                    </div>
                                    <div className="text-right overflow-hidden">
                                        <p className="font-black text-[11px] leading-tight truncate">{selectedTaskAppointment ? 'تم حجز الموعد' : 'جدولة زيارة التسويق'}</p>
                                        <p className={`text-[8px] font-bold opacity-70 truncate ${(!isBookedForSelected || !!selectedTaskAppointment) ? 'text-slate-400' : 'text-emerald-50'}`}>{selectedTaskAppointment ? selectedTaskAppointment.timeSlot : 'موعد جديد'}</p>
                                    </div>
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 bg-slate-50 relative overflow-hidden">
                            <Headset className="w-20 h-20 mb-4 text-violet-100" />
                            <p className="font-bold text-slate-500">يرجى اختيار زبون من قائمة الفريق</p>
                        </div>
                    )}
                </div>

                {/* COLUMN 3: Team Situational Awareness (25%) */}
                <div className="w-1/4 min-w-[300px] flex flex-col gap-3 relative shrink-0">
                    {/* Metrics Top Card */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm shrink-0">
                        <h3 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-1.5">< Zap className="w-4 h-4 text-amber-500" /> مؤشر أداء التيلماركتر</h3>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-emerald-700 mb-1 leading-tight line-clamp-2">زيارات تمت جدولتها</p>
                                <p className="text-xl font-black text-emerald-700">{totalScheduled}</p>
                            </div>
                            <div className="bg-violet-50 rounded-xl p-3 border border-violet-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-violet-700 mb-1 leading-tight line-clamp-2">مكالمات مكتملة</p>
                                <p className="text-xl font-black text-violet-700">{completedCount}</p>
                            </div>
                            <div className="bg-sky-50 rounded-xl p-3 border border-sky-100 shadow-sm flex flex-col justify-between">
                                <p className="text-[10px] font-bold text-sky-700 mb-1 leading-tight line-clamp-2">نسبة نجاح الحجز</p>
                                <p className="text-xl font-black text-sky-700">{bookingRate}%</p>
                            </div>
                        </div>
                    </div>

                    {/* Team Agenda Timeline Wrapper */}
                    <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col relative w-full h-full">
                        <div className="absolute inset-0">
                            <TeamAgendaPanel appointments={teamAppointments} date={date} />
                        </div>
                    </div>
                </div>

            </div>

            {/* Modals */}
            <OutcomeRecorderModal
                isOpen={isOutcomeModalOpen}
                onClose={() => setIsOutcomeModalOpen(false)}
                task={selectedTask}
                entityDetails={entityDetails}
                onSave={handleSaveOutcome}
            />

            <AppointmentSchedulerModal
                isOpen={isAppointmentModalOpen}
                onClose={() => setIsAppointmentModalOpen(false)}
                task={selectedTask}
                entityDetails={entityDetails}
                defaultDate={date}
                onSave={handleSaveAppointment}
            />

        </div>
    );
}
