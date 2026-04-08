import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Phone, MapPin, Eye, Users, Clock, CheckCircle2,
    AlertTriangle, DollarSign, Wrench, RotateCcw, MessageSquare,
    Calendar, ChevronLeft, Pause, UserCheck, Monitor, Loader2
} from 'lucide-react';
import type { Task } from '../lib/types';
import { api } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

const typeConfig: Record<string, { label: string; icon: any; color: string; bg: string; border: string; dot: string }> = {
    emergency: { label: 'طوارئ', icon: AlertTriangle, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500' },
    dues: { label: 'مستحقات', icon: DollarSign, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
    periodic: { label: 'دورية', icon: Wrench, color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
    returns: { label: 'إرجاع', icon: RotateCcw, color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500' },
    followup: { label: 'متابعة', icon: MessageSquare, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
};

const statusConfig: Record<string, { label: string; style: string; icon: any }> = {
    pending: { label: 'قيد الانتظار', style: 'bg-gray-50 text-slate-600 border-gray-200', icon: Clock },
    'in-progress': { label: 'قيد التنفيذ', style: 'bg-blue-50 text-blue-700 border-blue-200', icon: AlertTriangle },
    completed: { label: 'مكتمل', style: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
};

const formatDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ar-SY', { month: 'short', day: 'numeric', year: 'numeric' });

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface Customer360ModalProps {
    isOpen: boolean;
    onClose: () => void;
    customerName: string | null;
    onTaskAction?: (taskId: number, action: 'assign' | 'postpone' | 'close') => void;
}

type ModalTab = 'overview' | 'devices' | 'history';

/* ------------------------------------------------------------------ */
/*  Task Action Buttons                                                 */
/* ------------------------------------------------------------------ */

function TaskActions({ task, onAction }: { task: Task; onAction?: (taskId: number, action: 'assign' | 'postpone' | 'close') => void }) {
    if (task.status === 'completed') return null;
    return (
        <div className="flex items-center gap-1.5">
            <button
                onClick={(e) => { e.stopPropagation(); onAction?.(task.id, 'assign'); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100 text-[11px] font-medium transition-colors"
            >
                <UserCheck className="w-3 h-3" />
                <span>تعيين فريق</span>
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onAction?.(task.id, 'postpone'); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 text-[11px] font-medium transition-colors"
            >
                <Pause className="w-3 h-3" />
                <span>تأجيل</span>
            </button>
            <button
                onClick={(e) => { e.stopPropagation(); onAction?.(task.id, 'close'); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-[11px] font-medium transition-colors"
            >
                <CheckCircle2 className="w-3 h-3" />
                <span>إغلاق</span>
            </button>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Task Row                                                            */
/* ------------------------------------------------------------------ */

function TaskRow({ task, onAction }: { task: Task; onAction?: Customer360ModalProps['onTaskAction'] }) {
    const tc = typeConfig[task.type];
    const sc = statusConfig[task.status];
    const TypeIcon = tc.icon;

    return (
        <div className={`rounded-lg border ${tc.border} ${tc.bg} p-3 space-y-2`}>
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-7 h-7 rounded-lg ${tc.bg} border ${tc.border} flex items-center justify-center shrink-0`}>
                        <TypeIcon className={`w-3.5 h-3.5 ${tc.color}`} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${tc.color}`}>{tc.label}</span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${sc.style}`}>{sc.label}</span>
                        </div>
                        <p className="text-sm text-slate-700 font-medium truncate">{task.context}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
                    <Calendar className="w-3 h-3" />
                    <span>{formatDate(task.dueDate)}</span>
                </div>
            </div>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="w-3 h-3" />
                    <span>{task.location}</span>
                </div>
                <TaskActions task={task} onAction={onAction} />
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

export default function Customer360Modal({ isOpen, onClose, customerName, onTaskAction }: Customer360ModalProps) {
    const [activeTab, setActiveTab] = useState<ModalTab>('overview');
    const [allTasks, setAllTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && customerName) {
            setLoading(true);
            api.tasks.list()
                .then(data => setAllTasks(data))
                .catch(console.error)
                .finally(() => setLoading(false));
        }
    }, [isOpen, customerName]);

    const customerTasks = useMemo(() => {
        if (!customerName) return [];
        return allTasks.filter(t => t.customerName === customerName);
    }, [customerName, allTasks]);

    const activeTasks = useMemo(() => customerTasks.filter(t => t.status !== 'completed'), [customerTasks]);
    const completedTasks = useMemo(() => customerTasks.filter(t => t.status === 'completed'), [customerTasks]);

    // Group tasks by device/context for the "By Device" tab
    const deviceGroups = useMemo(() => {
        const groups = new Map<string, Task[]>();
        customerTasks.forEach(t => {
            const existing = groups.get(t.context) || [];
            existing.push(t);
            groups.set(t.context, existing);
        });
        return Array.from(groups.entries());
    }, [customerTasks]);

    // Stats
    const stats = useMemo(() => ({
        total: customerTasks.length,
        active: activeTasks.length,
        completed: completedTasks.length,
        emergency: customerTasks.filter(t => t.type === 'emergency').length,
        dues: customerTasks.filter(t => t.type === 'dues').length,
        periodic: customerTasks.filter(t => t.type === 'periodic').length,
    }), [customerTasks, activeTasks, completedTasks]);

    // Find the first task to get location info
    const firstTask = customerTasks[0];

    const tabs: { id: ModalTab; label: string; icon: any }[] = [
        { id: 'overview', label: 'نظرة عامة', icon: Eye },
        { id: 'devices', label: 'حسب الجهاز', icon: Monitor },
        { id: 'history', label: 'السجل', icon: Clock },
    ];

    if (!isOpen || !customerName) return null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ opacity: 0, x: 60 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 60 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed top-0 left-0 h-full w-[560px] bg-white shadow-2xl z-50 flex flex-col"
                        style={{ direction: 'rtl' }}
                    >
                        {/* -------- Header -------- */}
                        <div className="bg-gradient-to-l from-sky-600 to-sky-700 text-white p-5 shrink-0">
                            <div className="flex items-start justify-between mb-4">
                                <div>
                                    <p className="text-sky-200 text-xs font-medium mb-1">ملف الزبون الشامل</p>
                                    <h2 className="text-xl font-bold">{customerName}</h2>
                                </div>
                                <button onClick={onClose} className="text-white/60 hover:text-white transition-colors mt-0.5">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="flex items-center gap-4 text-sky-100 text-xs">
                                {firstTask && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="w-3 h-3" />
                                        {firstTask.location}
                                    </span>
                                )}
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeTasks.length > 0 ? 'bg-red-500/20 text-red-100 border border-red-400/30' : 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/30'}`}>
                                    {activeTasks.length > 0 ? `${activeTasks.length} مهام نشطة` : 'لا مهام نشطة'}
                                </span>
                            </div>

                            {/* Quick Stats */}
                            <div className="flex items-center gap-3 mt-4">
                                {[
                                    { label: 'الكل', value: stats.total, style: 'bg-white/15' },
                                    { label: 'نشط', value: stats.active, style: 'bg-orange-500/25' },
                                    { label: 'مكتمل', value: stats.completed, style: 'bg-emerald-500/25' },
                                ].map(s => (
                                    <div key={s.label} className={`${s.style} rounded-lg px-3 py-1.5 text-center min-w-[60px]`}>
                                        <p className="text-lg font-black">{s.value}</p>
                                        <p className="text-[10px] text-sky-200">{s.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* -------- Tabs -------- */}
                        <div className="border-b border-gray-200 flex gap-1 px-4 pt-3 shrink-0 bg-gray-50">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all relative top-[1px] ${activeTab === tab.id
                                        ? 'bg-white text-sky-600 border border-gray-200 border-b-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-gray-100'
                                        }`}
                                >
                                    <tab.icon className="w-3.5 h-3.5" />
                                    <span>{tab.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* -------- Content -------- */}
                        <div className="flex-1 overflow-y-auto custom-scroll p-5 space-y-4">

                            {/* ====== OVERVIEW TAB ====== */}
                            {activeTab === 'overview' && (
                                <div className="space-y-4">
                                    {/* Type breakdown */}
                                    <div className="grid grid-cols-3 gap-2">
                                        {Object.entries(typeConfig).map(([key, cfg]) => {
                                            const count = customerTasks.filter(t => t.type === key).length;
                                            if (count === 0) return null;
                                            const TypeIcon = cfg.icon;
                                            return (
                                                <div key={key} className={`${cfg.bg} ${cfg.border} border rounded-xl p-3 text-center`}>
                                                    <TypeIcon className={`w-5 h-5 ${cfg.color} mx-auto mb-1`} />
                                                    <p className={`text-lg font-black ${cfg.color}`}>{count}</p>
                                                    <p className="text-[10px] text-slate-500">{cfg.label}</p>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Active tasks header */}
                                    {activeTasks.length > 0 && (
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                                المهام النشطة ({activeTasks.length})
                                            </h3>
                                            <div className="space-y-2">
                                                {activeTasks.map(t => (
                                                    <TaskRow key={t.id} task={t} onAction={onTaskAction} />
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {activeTasks.length === 0 && (
                                        <div className="text-center py-10 text-slate-400">
                                            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
                                            <p className="font-medium">لا توجد مهام نشطة</p>
                                            <p className="text-xs">جميع مهام هذا الزبون مكتملة</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ====== BY DEVICE TAB ====== */}
                            {activeTab === 'devices' && (
                                <div className="space-y-4">
                                    {deviceGroups.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400">
                                            <Monitor className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                                            <p className="font-medium">لا توجد أجهزة مسجّلة</p>
                                        </div>
                                    ) : (
                                        deviceGroups.map(([device, tasks]) => {
                                            const activeCount = tasks.filter(t => t.status !== 'completed').length;
                                            return (
                                                <div key={device} className="rounded-xl border border-gray-200 overflow-hidden">
                                                    {/* Device Header */}
                                                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center">
                                                                <Monitor className="w-4 h-4 text-sky-600" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-800">{device}</p>
                                                                <p className="text-[10px] text-slate-400">{tasks.length} مهام</p>
                                                            </div>
                                                        </div>
                                                        {activeCount > 0 && (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-200">
                                                                {activeCount} نشطة
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Tasks under this device */}
                                                    <div className="p-3 space-y-2">
                                                        {tasks.map(t => (
                                                            <TaskRow key={t.id} task={t} onAction={onTaskAction} />
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}

                            {/* ====== HISTORY TAB ====== */}
                            {activeTab === 'history' && (
                                <div className="space-y-1">
                                    {customerTasks.length === 0 ? (
                                        <div className="text-center py-10 text-slate-400">
                                            <Clock className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                                            <p className="font-medium">لا يوجد سجل</p>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            {/* Timeline line */}
                                            <div className="absolute right-3.5 top-0 bottom-0 w-px bg-gray-200" />

                                            {customerTasks
                                                .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime())
                                                .map((t, idx) => {
                                                    const tc = typeConfig[t.type];
                                                    const sc = statusConfig[t.status];
                                                    return (
                                                        <div key={t.id} className="relative flex items-start gap-4 py-3">
                                                            {/* Timeline dot */}
                                                            <div className={`relative z-10 w-7 h-7 rounded-full ${tc.dot} flex items-center justify-center shrink-0 shadow-sm`}>
                                                                <tc.icon className="w-3.5 h-3.5 text-white" />
                                                            </div>

                                                            {/* Content */}
                                                            <div className="flex-1 bg-white rounded-lg border border-gray-100 p-3 shadow-sm">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`text-xs font-bold ${tc.color}`}>{tc.label}</span>
                                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${sc.style}`}>{sc.label}</span>
                                                                    </div>
                                                                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                                                                        <Calendar className="w-2.5 h-2.5" />
                                                                        {formatDate(t.dueDate)}
                                                                    </span>
                                                                </div>
                                                                <p className="text-sm text-slate-700">{t.context}</p>
                                                                <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400">
                                                                    <MapPin className="w-2.5 h-2.5" />
                                                                    <span>{t.location}</span>
                                                                </div>

                                                                {t.status !== 'completed' && (
                                                                    <div className="mt-2 pt-2 border-t border-gray-50">
                                                                        <TaskActions task={t} onAction={onTaskAction} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
