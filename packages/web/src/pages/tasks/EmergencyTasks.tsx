import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, UserPlus, Eye, ChevronDown, Search, Filter, AlertTriangle, Clock, CheckCircle, XCircle, ChevronUp, Zap } from 'lucide-react';
import SmartTable from '../../components/SmartTable';
import TicketDetailsModal from '../../components/TicketDetailsModal';
import { useEmergencyStore } from '../../hooks/useEmergencyStore';
import { api } from '../../lib/api';
import type { EmergencyTicket, EmergencyTicketPriority, EmergencyTicketStatus, Employee } from '../../lib/types';

const STATUS_CONFIG: Record<EmergencyTicketStatus, { label: string; color: string; icon: typeof Clock }> = {
    'New': { label: 'جديد', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: Clock },
    'Assigned': { label: 'معيّن', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: UserPlus },
    'In Progress': { label: 'قيد التنفيذ', color: 'bg-purple-50 text-purple-700 border-purple-200', icon: Zap },
    'Completed': { label: 'مكتمل', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle },
    'Cancelled': { label: 'ملغي', color: 'bg-slate-50 text-slate-500 border-slate-200', icon: XCircle },
};

const PRIORITY_CONFIG: Record<EmergencyTicketPriority, { label: string; color: string }> = {
    'Critical': { label: 'حرج', color: 'bg-red-500 text-white' },
    'High': { label: 'عالي', color: 'bg-orange-500 text-white' },
    'Normal': { label: 'عادي', color: 'bg-sky-100 text-sky-700' },
};

const PRIORITY_OPTIONS: EmergencyTicketPriority[] = ['Critical', 'High', 'Normal'];

export default function EmergencyTasks() {
    const { tickets, updateTicket, loadTickets } = useEmergencyStore();
    const [assigningId, setAssigningId] = useState<number | null>(null);
    const [priorityEditId, setPriorityEditId] = useState<number | null>(null);
    const [detailTicket, setDetailTicket] = useState<EmergencyTicket | null>(null);
    const [technicians, setTechnicians] = useState<Employee[]>([]);

    useEffect(() => {
        loadTickets();
        api.employees.list()
            .then((employees: Employee[]) => {
                setTechnicians(employees.filter((employee: Employee) => employee.role === 'technician' && employee.status === 'active'));
            })
            .catch((error: unknown) => {
                console.error('Failed to load technicians for emergency tasks:', error);
                setTechnicians([]);
            });
    }, [loadTickets]);

    const newCount = useMemo(() => tickets.filter(t => t.status === 'New').length, [tickets]);

    const handleAssign = useCallback((ticketId: number, techId: number) => {
        updateTicket(ticketId, {
            assignedTechnicianId: techId,
            status: 'Assigned',
        });
        setAssigningId(null);
    }, [updateTicket]);

    const handlePriorityChange = useCallback((ticketId: number, priority: EmergencyTicketPriority) => {
        updateTicket(ticketId, { priority });
        setPriorityEditId(null);
    }, [updateTicket]);

    const columns = useMemo(() => [
        {
            key: 'priority',
            label: 'الأولوية',
            width: '100px',
            sortable: true,
            getValue: (t: EmergencyTicket) => t.priority === 'Critical' ? 0 : t.priority === 'High' ? 1 : 2,
            render: (t: EmergencyTicket) => {
                const cfg = PRIORITY_CONFIG[t.priority];
                const isEditing = priorityEditId === t.id;
                return (
                    <div className="relative">
                        <button
                            onClick={(e) => { e.stopPropagation(); setPriorityEditId(isEditing ? null : t.id); }}
                            className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.color} hover:opacity-80 transition-opacity flex items-center gap-1`}
                        >
                            {cfg.label}
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        <AnimatePresence>
                            {isEditing && (
                                <motion.div
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -5 }}
                                    className="absolute top-full right-0 mt-1 bg-white border rounded-xl shadow-xl z-30 overflow-hidden min-w-[100px]"
                                    onClick={e => e.stopPropagation()}
                                >
                                    {PRIORITY_OPTIONS.map(p => (
                                        <button
                                            key={p}
                                            onClick={() => handlePriorityChange(t.id, p)}
                                            className={`w-full text-right px-3 py-2 text-xs font-bold hover:bg-slate-50 transition-colors ${t.priority === p ? 'bg-sky-50' : ''}`}
                                        >
                                            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${PRIORITY_CONFIG[p].color}`} />
                                            {PRIORITY_CONFIG[p].label}
                                        </button>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                );
            },
        },
        {
            key: 'status',
            label: 'الحالة',
            width: '120px',
            sortable: true,
            render: (t: EmergencyTicket) => {
                const cfg = STATUS_CONFIG[t.status];
                const Icon = cfg.icon;
                return (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${cfg.color} flex items-center gap-1 w-fit`}>
                        <Icon className="w-3.5 h-3.5" />
                        {cfg.label}
                    </span>
                );
            },
        },
        {
            key: 'clientAndDevice',
            label: 'الزبون والجهاز',
            sortable: true,
            getValue: (t: EmergencyTicket) => t.clientName,
            render: (t: EmergencyTicket) => (
                <div>
                    <p className="text-sm font-bold text-slate-800">{t.clientName}</p>
                    <p className="text-xs text-slate-400 truncate">{t.deviceModelName || 'بدون جهاز'}</p>
                </div>
            ),
        },
        {
            key: 'problem',
            label: 'المشكلة',
            render: (t: EmergencyTicket) => (
                <p className="text-xs text-slate-600 truncate max-w-[200px]">{t.problemDescription}</p>
            ),
        },
        {
            key: 'technician',
            label: 'الفني المعيّن',
            width: '140px',
            render: (t: EmergencyTicket) => {
                if (t.assignedTechnicianId) {
                    const tech = technicians.find((employee) => employee.id === t.assignedTechnicianId);
                    return (
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full overflow-hidden border border-emerald-200">
                                <img src={tech?.avatar || ''} alt="" className="w-full h-full object-cover" />
                        </div>
                            <span className="text-xs font-medium text-slate-700">{tech?.name || '—'}</span>
                        </div>
                    );
                }
                return <span className="text-xs text-slate-400">—</span>;
            },
        },
        {
            key: 'createdAt',
            label: 'التاريخ',
            width: '120px',
            sortable: true,
            render: (t: EmergencyTicket) => {
                const d = new Date(t.createdAt);
                return (
                    <div className="text-xs text-slate-500">{d.toLocaleDateString('ar-SY')}
                        <br />
                        <span className="text-[10px] text-slate-400">{d.toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                );
            },
        },
    ], [priorityEditId, handlePriorityChange]);

    const filters = useMemo(() => [
        {
            key: 'priority',
            label: 'الأولوية',
            options: [
                { value: '', label: 'الكل' },
                { value: 'Critical', label: 'حرج' },
                { value: 'High', label: 'عالي' },
                { value: 'Normal', label: 'عادي' },
            ],
        },
        {
            key: 'status',
            label: 'الحالة',
            options: [
                { value: '', label: 'الكل' },
                { value: 'New', label: 'جديد' },
                { value: 'Assigned', label: 'معيّن' },
                { value: 'In Progress', label: 'قيد التنفيذ' },
                { value: 'Completed', label: 'مكتمل' },
                { value: 'Cancelled', label: 'ملغي' },
            ],
        },
    ], []);

    const sortedTickets = useMemo(() =>
        [...tickets].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [tickets]
    );

    return (
        <div className="p-6">
            <SmartTable<EmergencyTicket>
                title="طوارئ الصيانة"
                icon={ShieldAlert}
                data={sortedTickets}
                columns={columns}
                filters={filters}
                searchKeys={['clientName', 'deviceModelName', 'problemDescription'] as (keyof EmergencyTicket)[]}
                searchPlaceholder="بحث بالاسم أو الجهاز أو المشكلة..."
                getId={(t) => t.id}
                emptyIcon={AlertTriangle}
                emptyMessage="لا توجد طلبات طوارئ حالياً"
                headerActions={
                    newCount > 0 ? (
                        <span className="bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
                            {newCount} طلب جديد
                        </span>
                    ) : undefined
                }
                actions={(t) => (
                    <div className="flex items-center gap-1.5">
                        {/* Assign Button */}
                        <div className="relative">
                            <button
                                onClick={(e) => { e.stopPropagation(); setAssigningId(assigningId === t.id ? null : t.id); }}
                                className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${t.status === 'Assigned'
                                    ? 'bg-slate-50 text-slate-400 border-slate-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    }`}
                            >
                                <UserPlus className="w-3.5 h-3.5 inline-block ml-1" />
                                تعيين
                            </button>
                            <AnimatePresence>
                                {assigningId === t.id && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute top-full left-0 mt-1 bg-white border rounded-xl shadow-xl z-30 min-w-[180px] overflow-hidden"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        <p className="text-[10px] text-slate-400 px-3 pt-2 font-bold">اختر الفني</p>
                                        {technicians.map(tech => (
                                            <button
                                                key={tech.id}
                                                onClick={() => handleAssign(t.id, tech.id)}
                                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 transition-colors text-right"
                                            >
                                                <div className="w-6 h-6 rounded-full overflow-hidden border border-gray-200">
                                                    <img src={tech.avatar} alt="" className="w-full h-full object-cover" />
                                                </div>
                                                <span className="text-xs font-medium text-slate-700">{tech.name}</span>
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* View Details */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setDetailTicket(t); }}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg border bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 transition-all"
                        >
                            <Eye className="w-3.5 h-3.5 inline-block ml-1" />
                            تفاصيل
                        </button>
                    </div>
                )}
            />

            {/* Ticket Details Modal */}
            {detailTicket && (
                <TicketDetailsModal
                    ticket={detailTicket}
                    onClose={() => setDetailTicket(null)}
                    onUpdate={(updates: Partial<EmergencyTicket>) => {
                        updateTicket(detailTicket.id, updates);
                        setDetailTicket({ ...detailTicket, ...updates });
                    }}
                />
            )}
        </div>
    );
}
