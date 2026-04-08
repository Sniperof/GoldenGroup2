import React, { useState, useMemo, useEffect } from 'react';
import {
    Headset, Phone, FileText, CheckCircle2, History, CreditCard,
    AlertTriangle, Calendar, Send, Zap, User, Clock, CheckCircle,
    MapPin, PlusCircle, MessageSquare, ThumbsUp, Wrench, Activity, Briefcase
} from 'lucide-react';
import { api } from '../lib/api';
import { useCandidateStore } from '../hooks/useCandidateStore';
import { useClientStore } from '../hooks/useClientStore';
import { useTelemarketingStore } from '../hooks/useTelemarketingStore';
import TeamAgendaPanel from '../components/telemarketing/TeamAgendaPanel';
import OutcomeRecorderModal from '../components/telemarketing/OutcomeRecorderModal';
import AppointmentSchedulerModal from '../components/telemarketing/AppointmentSchedulerModal';
import type { DaySchedule, CallOutcome, Contract, Visit, Employee } from '../lib/types';
import { getEntityContacts } from '../lib/contactUtils';

const getToday = () => new Date().toISOString().split('T')[0];

const outcomeConfig: Record<CallOutcome, { label: string; color: string; bg: string }> = {
    booked: { label: 'تم الحجز', color: 'text-emerald-700', bg: 'bg-emerald-100' },
    busy: { label: 'مشغول', color: 'text-amber-700', bg: 'bg-amber-100' },
    no_answer: { label: 'لا يرد', color: 'text-orange-700', bg: 'bg-orange-100' },
    rejected: { label: 'مرفوض', color: 'text-red-700', bg: 'bg-red-100' },
};

const getInitials = (name: string) => name.trim().split(' ').map(n => n[0]).slice(0, 2).join('') || 'U';

export default function TelemarketerWorkspace() {
    // Stores & Data Load
    const candidates = useCandidateStore(state => state.candidates);
    const { clients, loadClients, updateClient } = useClientStore();
    const { taskLists, appointments, callLogs, loadData, addCallLog, addAppointment, updateTaskListItemStatus, getTaskList, getAppointmentsForTeamDate } = useTelemarketingStore();

    const [contracts, setContracts] = useState<Contract[]>([]);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [maintenanceRequests, setMaintenanceRequests] = useState<any[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [currentSchedule, setCurrentSchedule] = useState<DaySchedule>({ teams: [], solos: [] });
    const [date] = useState(getToday());

    useEffect(() => {
        loadClients();
        loadData();

        Promise.all([
            api.contracts.list(),
            api.visits.list(),
            api.maintenanceRequests.list(),
            api.employees.list(),
            api.schedules.get(date),
        ])
            .then(([contractsData, visitsData, maintenanceData, employeesData, scheduleData]) => {
                setContracts(contractsData);
                setVisits(visitsData);
                setMaintenanceRequests(maintenanceData);
                setEmployees(employeesData);
                setCurrentSchedule(scheduleData || { teams: [], solos: [] });
            })
            .catch((error) => {
                console.error('Failed to load telemarketer workspace data:', error);
                setContracts([]);
                setVisits([]);
                setMaintenanceRequests([]);
                setEmployees([]);
                setCurrentSchedule({ teams: [], solos: [] });
            });
    }, [date, loadClients, loadData]);

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
    }, [currentSchedule]);

    const [selectedTeamKey, setSelectedTeamKey] = useState<string>(availableTeams[0]?.key || '');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    useEffect(() => {
        if (!selectedTeamKey && availableTeams[0]?.key) {
            setSelectedTeamKey(availableTeams[0].key);
        }
    }, [availableTeams, selectedTeamKey]);

    // Active Task List
    const activeTaskList = useMemo(() => {
        if (!selectedTeamKey) return null;
        return getTaskList(selectedTeamKey, date);
    }, [getTaskList, selectedTeamKey, date, taskLists]);

    const tasks = useMemo(() => {
        const raw = activeTaskList?.items || [];
        return [...raw].sort((a, b) => {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (a.status !== 'pending' && b.status === 'pending') return 1;
            return 0; // Maintain original order (creation) for same status
        });
    }, [activeTaskList]);

    const remainingCount = tasks.filter(t => t.status === 'pending').length;
    const completedCount = tasks.filter(t => t.status !== 'pending').length;
    const teamAppointments = useMemo(() => getAppointmentsForTeamDate(selectedTeamKey, date), [getAppointmentsForTeamDate, selectedTeamKey, date, appointments]);

    // Auto-select first pending task
    useEffect(() => {
        if (!selectedTaskId && tasks.length > 0) {
            const firstPending = tasks.find(t => t.status === 'pending') || tasks[0];
            setSelectedTaskId(firstPending.id);
        }
    }, [tasks, selectedTaskId]);

    // Workspace UI State
    const [activeTab, setActiveTab] = useState<'journey' | 'calls' | 'contracts' | 'visits'>('journey');
    const [isOutcomeModalOpen, setIsOutcomeModalOpen] = useState(false);
    const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);

    const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId) || null, [tasks, selectedTaskId]);

    const entityDetails = useMemo(() => {
        if (!selectedTask) return null;
        if (selectedTask.entityType === 'candidate') {
            return candidates.find(c => c.id === selectedTask.entityId);
        }
        return clients.find(c => c.id === selectedTask.entityId);
    }, [selectedTask, candidates, clients]);

    const handleSaveOutcome = async (contactId: string, outcome: CallOutcome, notes: string, newContactStatus?: string, communicationMethod?: 'phone' | 'whatsapp_text' | 'whatsapp_voice') => {
        if (!selectedTask) return;

        const entityContacts = getEntityContacts(entityDetails as any);
        const selectedContact = entityContacts.find(c => c.id === contactId) || entityContacts[0];

        await addCallLog({
            entityType: selectedTask.entityType,
            entityId: selectedTask.entityId,
            taskListId: activeTaskList!.id,
            teamKey: selectedTeamKey,
            outcome,
            contactLabel: selectedContact.label,
            contactNumber: selectedContact.number,
            notes,
            calledBy: 1, // mock user
            communicationMethod
        });

        // Determine if we need to auto-set preferred status
        const finalContactStatus = (outcome === 'booked') ? 'مفضل' : newContactStatus;

        // Update contact status if requested or booked
        if (finalContactStatus && selectedTask.entityType === 'client') {
            const client = clients.find(c => c.id === selectedTask.entityId);
            if (client) {
                const updatedContacts = client.contacts.map((c: any) =>
                    c.id === contactId ? { ...c, status: finalContactStatus } : c
                );
                await updateClient(client.id, { contacts: updatedContacts });
            }
        }

        const currentTaskLogs = callLogs.filter(log => log.entityId === selectedTask.entityId && log.entityType === selectedTask.entityType);
        const attempts = currentTaskLogs.length + 1;

        const newStatus = (outcome === 'booked') ? 'booked'
            : (outcome === 'rejected' || attempts >= 3) ? 'called'
                : 'pending';
        await updateTaskListItemStatus(activeTaskList!.id, selectedTask.id, newStatus, outcome);

        if (newStatus !== 'pending') {
            // Auto move to next pending task after small delay
            setTimeout(() => {
                const pendingTasks = tasks.filter(t => t.status === 'pending' && t.id !== selectedTask.id);
                if (pendingTasks.length > 0) {
                    setSelectedTaskId(pendingTasks[0].id);
                }
            }, 500);
        }
    };

    const handleSaveAppointment = async (visitTime: string, duration: string, occupation: string, waterSource: string, notes: string) => {
        if (!selectedTask) return;
        await addAppointment({
            entityType: selectedTask.entityType,
            entityId: selectedTask.entityId,
            customerName: selectedTask.name,
            customerAddress: selectedTask.addressText,
            customerMobile: selectedTask.mobile,
            teamKey: selectedTeamKey,
            date,
            timeSlot: visitTime,
            occupation,
            waterSource,
            notes,
            createdBy: 1
        });

        if (selectedTask.entityType === 'client') {
            await updateClient(selectedTask.entityId, { occupation, waterSource });
        }

        if (selectedTask.status === 'pending') {
            await updateTaskListItemStatus(activeTaskList!.id, selectedTask.id, 'booked', 'booked');
        }
    };

    const getEntityCallLogs = () => {
        if (!selectedTask) return [];
        return callLogs.filter(log => log.entityId === selectedTask.entityId && log.entityType === selectedTask.entityType)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    };

    const generateJourneyEvents = () => {
        if (!selectedTask) return [];
        const events: any[] = [];

        // 1. Suggestion / Candidate creation
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

        // 2. Client Creation
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

        // 3. Contracts
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
                            <p className="text-sm font-bold text-slate-800">⭐ تم شراء جهاز <span className="text-emerald-700">"{c.deviceModelName}"</span> بعقد رقم #{c.contractNumber}</p>
                            <p className="text-xs text-slate-600 mt-1">القيمة: {c.finalPrice.toLocaleString()} ل.س | {c.paymentType === 'cash' ? 'نقدي' : 'أقساط'}</p>
                        </>
                    )
                });
            });
        }

        // 4. Visits
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
                        <p className="text-sm font-bold text-slate-800">📍 تم تنفيذ زيارة {v.outcome === 'Completed' ? 'ناجحة' : 'بالحالة: ' + v.outcome}</p>
                        <p className="text-xs text-slate-600 mt-1">بواسطة الفني: {v.employeeName}</p>
                        {v.notes && <p className="text-xs text-slate-500 mt-1 border border-slate-200 bg-slate-50 p-1.5 rounded">ملاحظات: {v.notes}</p>}
                    </>
                )
            });
        });

        // 5. Maintenance Requests
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
                            <p className="text-sm font-bold text-slate-800">🛠️ تم تنفيذ زيارة صيانة <span className="text-orange-700">"{m.visitType}"</span></p>
                            <p className="text-xs text-slate-600 mt-1">وصف المشكلة: {m.problemDescription}</p>
                            <p className="text-xs text-slate-600">الحالة: {m.resolutionStatus}</p>
                        </>
                    )
                });
            });
        }

        // 6. Call Logs
        const taskCalls = callLogs.filter(log => log.entityId === selectedTask.entityId && log.entityType === selectedTask.entityType)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // sort ascending by date for attempt counting

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
                            <span>محاولة تواصل <span className={`px-1.5 py-0.5 rounded text-[10px] mr-1 ${outcomeConfig[log.outcome]?.bg} ${outcomeConfig[log.outcome]?.color}`}>{outcomeConfig[log.outcome]?.label || log.outcome}</span></span>
                            <span className="text-xs text-slate-500 font-bold bg-slate-100 rounded px-2 py-0.5" dir="ltr">المحاولة {index + 1}</span>
                        </p>
                        <p className="text-xs text-slate-600 mt-2" dir="ltr">{log.contactNumber} ({log.contactLabel})</p>
                        {log.notes && <p className="text-xs text-slate-500 mt-2 border border-slate-200 bg-slate-50 p-2.5 rounded shadow-sm">ملاحظات: {log.notes}</p>}

                        {isLatest && !['booked', 'rejected'].includes(log.outcome) && taskCalls.length < 3 && (
                            <button onClick={() => setIsOutcomeModalOpen(true)} className="mt-3 text-xs flex items-center gap-1 text-violet-600 font-bold bg-violet-50 hover:bg-violet-100 px-3 py-2 rounded-lg border border-violet-200 transition-colors w-full justify-center shadow-sm">
                                <Phone className="w-3.5 h-3.5" /> محاولة مرة أخرى
                            </button>
                        )}

                        {isLatest && taskCalls.length >= 3 && !['booked', 'rejected'].includes(log.outcome) && (
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

        // Sort new to old
        return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    };

    const journeyEvents = useMemo(() => generateJourneyEvents(), [selectedTask, candidates, clients, contracts, visits, maintenanceRequests, callLogs]);

    // Metrics for Col 3
    const totalScheduled = teamAppointments.length;
    const bookingRate = completedCount > 0 ? Math.round((tasks.filter(t => t.status === 'booked').length / completedCount) * 100) : 0;

    return (
        <div className="h-full flex flex-col overflow-hidden bg-slate-100" dir="rtl">
            {/* ─── TOP BAR ─── */}
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                        <Headset className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-slate-800">إدارة المواعيد <span className="text-slate-400 font-normal text-sm">| Telemarketing</span></h1>
                    </div>
                </div>
            </div>

            {/* ─── 3-COLUMN LAYOUT ─── */}
            <div className="flex-1 flex overflow-hidden p-3 gap-3">

                {/* COLUMN 1: Mission Control (20%) */}
                <div className="w-1/5 min-w-[280px] bg-white border border-gray-200 rounded-xl flex flex-col shadow-sm overflow-hidden">
                    {/* Team Selector Topsheet */}
                    <div className="p-3 border-b border-gray-100 bg-slate-50">
                        <label className="text-xs font-bold text-slate-500 mb-1.5 block">اختر أحد الفرق النشطة</label>
                        <select
                            value={selectedTeamKey}
                            onChange={e => setSelectedTeamKey(e.target.value)}
                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none"
                        >
                            {availableTeams.map(t => (
                                <option key={t.key} value={t.key}>{t.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Priority Queue Header - Sticky */}
                    <div className="sticky top-0 z-10 px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                        <h2 className="text-sm font-black text-slate-700">قائمة المهام</h2>
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-violet-100 text-violet-700 border border-violet-200">{remainingCount} معلق</span>
                    </div>

                    {/* Task Queue List - Scrollable Body */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scroll" style={{ maxHeight: 'calc(100vh - 250px)' }}>
                        {tasks.length === 0 && (
                            <div className="text-center p-6 mt-10 opacity-50">
                                <AlertTriangle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                                <p className="text-xs font-bold">لا توجد مهام اتصال</p>
                            </div>
                        )}
                        {tasks.map(task => {
                            const isActive = task.id === selectedTaskId;
                            const isProcessed = task.status !== 'pending';
                            const taskLogs = callLogs.filter(l => l.entityId === task.entityId && l.entityType === task.entityType);

                            return (
                                <button
                                    key={task.id}
                                    onClick={() => setSelectedTaskId(task.id)}
                                    className={`w-full text-right p-2.5 rounded-xl border transition-all flex items-start gap-3 outline-none ${isActive
                                        ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-500/10 shadow-sm'
                                        : task.status === 'booked'
                                            ? 'bg-slate-50 border-transparent opacity-60' // grayed out for booked
                                            : isProcessed
                                                ? 'bg-slate-50 border-transparent'
                                                : 'bg-white border-gray-100 hover:border-violet-200 hover:bg-slate-50 hover:shadow-sm'
                                        }`}
                                >
                                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-sm font-black text-slate-600 shrink-0 border-2 border-slate-200 overflow-hidden relative shadow-sm">
                                        {getInitials(task.name)}
                                        {task.entityType === 'client' && <div className="absolute bottom-0 w-full h-1.5 bg-sky-500" />}
                                        {task.entityType === 'candidate' && <div className="absolute bottom-0 w-full h-1.5 bg-amber-500" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between">
                                            <p className={`text-sm font-bold truncate ${isProcessed ? 'text-slate-500' : 'text-slate-800'}`}>{task.name}</p>
                                            {task.status === 'booked' ? <Calendar className="w-4 h-4 text-slate-400 shrink-0" /> : isProcessed ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> : <Phone className="w-4 h-4 text-slate-400 shrink-0" />}
                                        </div>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${task.entityType === 'client' ? 'bg-sky-50 text-sky-700 border-sky-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                {task.entityType === 'client' ? 'زبون' : 'مقترح'}
                                            </span>
                                            {task.status === 'booked' ? (
                                                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">✅ تم حجز موعد</span>
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
                                        <p className="text-slate-800 leading-relaxed mr-5">{selectedTask.addressText || 'لا يوجد عنوان تفصيلي'}</p>
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
                                    { id: 'journey', label: 'سجل الرحلة', icon: Activity },
                                    { id: 'calls', label: 'سجل التواصل', icon: History },
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
                                {activeTab === 'calls' && (
                                    <div className="flex flex-col border rounded-xl border-gray-200 bg-white shadow-sm overflow-hidden min-h-[400px]">
                                        <div className="flex-1 overflow-y-auto custom-scroll" style={{ maxHeight: '480px' }}>
                                            <table className="w-full text-right border-collapse">
                                                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-gray-200 shadow-sm">
                                                    <tr>
                                                        <th className="px-4 h-12 text-xs font-bold text-slate-600">التاريخ</th>
                                                        <th className="px-4 h-12 text-xs font-bold text-slate-600">القناة</th>
                                                        <th className="px-4 h-12 text-xs font-bold text-slate-600">الرقم</th>
                                                        <th className="px-4 h-12 text-xs font-bold text-slate-600">النتيجة</th>
                                                        <th className="px-4 h-12 text-xs font-bold text-slate-600">ملاحظات</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {getEntityCallLogs().map(log => (
                                                        <tr key={log.id} className="hover:bg-slate-50 transition-colors h-12 group">
                                                            <td className="px-4 py-2 text-sm font-bold text-slate-700" dir="ltr">{new Date(log.timestamp).toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                                            <td className="px-4 py-2 text-sm text-slate-600">{log.communicationMethod?.startsWith('whatsapp') ? 'واتساب' : 'هاتف'}</td>
                                                            <td className="px-4 py-2 text-sm text-slate-600" dir="ltr">{log.contactNumber}</td>
                                                            <td className="px-4 py-2">
                                                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${outcomeConfig[log.outcome]?.bg} ${outcomeConfig[log.outcome]?.color} ${outcomeConfig[log.outcome]?.bg.replace('bg-', 'border-').replace('100', '200')}`}>{outcomeConfig[log.outcome]?.label || log.outcome}</span>
                                                            </td>
                                                            <td className="px-4 py-2 text-sm text-slate-500 truncate max-w-[150px]">{log.notes || '-'}</td>
                                                        </tr>
                                                    ))}
                                                    {getEntityCallLogs().length === 0 && (
                                                        <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400 font-bold">لا يوجد سجل تواصل</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Optional pagination can be added here if needed, but per-entity logs are usually small */}
                                    </div>
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
                                    disabled={selectedTask.status === 'booked'}
                                    className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-2 border-none rounded-xl transition-all shadow-sm group active:scale-[0.98] ${selectedTask.status === 'booked' ? 'bg-slate-100 border border-slate-200 text-slate-400 grayscale cursor-not-allowed shadow-none' : 'bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 shadow-violet-500/10'}`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${selectedTask.status === 'booked' ? 'bg-slate-200' : 'bg-white/20'}`}>
                                        <Send className={`w-3.5 h-3.5 ${selectedTask.status === 'booked' ? 'text-slate-400' : 'text-white'}`} />
                                    </div>
                                    <div className="text-right overflow-hidden">
                                        <p className={`font-black text-[11px] leading-tight truncate ${selectedTask.status === 'booked' ? 'text-slate-500' : 'text-white'}`}>تسجيل نتيجة التواصل</p>
                                        <p className={`text-[8px] font-bold opacity-70 truncate ${selectedTask.status === 'booked' ? 'text-slate-400' : 'text-violet-100'}`}>تحديث الحالة</p>
                                    </div>
                                </button>

                                <button
                                    onClick={() => setIsAppointmentModalOpen(true)}
                                    disabled={selectedTask.status !== 'booked'}
                                    className={`flex-1 py-1.5 px-3 flex items-center justify-center gap-2 border-none rounded-xl transition-all group active:scale-[0.98] ${selectedTask.status !== 'booked'
                                        ? 'bg-slate-100 border border-slate-200 text-slate-400 grayscale cursor-not-allowed shadow-none'
                                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-sm shadow-emerald-500/10 text-white'
                                        }`}
                                >
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${selectedTask.status !== 'booked' ? 'bg-slate-200' : 'bg-white/20'}`}>
                                        <Calendar className={`w-3.5 h-3.5 ${selectedTask.status !== 'booked' ? 'text-slate-400' : ''}`} />
                                    </div>
                                    <div className="text-right overflow-hidden">
                                        <p className="font-black text-[11px] leading-tight truncate">جدولة زيارة التسويق</p>
                                        <p className={`text-[8px] font-bold opacity-70 truncate ${selectedTask.status !== 'booked' ? 'text-slate-400' : 'text-emerald-50'}`}>موعد جديد</p>
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
