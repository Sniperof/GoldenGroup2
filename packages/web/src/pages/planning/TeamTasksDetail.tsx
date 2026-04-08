import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowRight, Users, User, Phone, MapPin, Clock, Calendar,
    AlertTriangle, DollarSign, PhoneCall, RefreshCw, RotateCcw,
    CheckCircle2, XCircle, Shuffle, Ban, Filter,
    Route as RouteIcon, Zap, PhoneMissed, Loader2, Minus
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types & Config                                                      */
/* ------------------------------------------------------------------ */

type TaskType = 'emergency' | 'dues' | 'followup' | 'periodic' | 'returns';
type TaskSource = 'route' | 'direct';
type TeleStatus = 'pending' | 'no_answer' | 'booked' | 'refused';
type FilterTab = 'all' | 'unscheduled' | 'scheduled';

interface TeamTask {
    id: number;
    customerName: string;
    mobile: string;
    taskType: TaskType;
    taskDescription: string;
    source: TaskSource;
    sourceLabel: string;       // "مسار: المنصور" or "تعيين مباشر"
    visitTime: string | null;  // "14:00" or null
    teleStatus: TeleStatus;
    priority: 'high' | 'medium' | 'low';
}

const taskTypeConfig: Record<TaskType, { label: string; icon: any; color: string; bg: string; dot: string }> = {
    emergency: { label: 'طوارئ', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500' },
    dues: { label: 'مستحقات', icon: DollarSign, color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-400' },
    followup: { label: 'متابعة', icon: PhoneCall, color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
    periodic: { label: 'صيانة دورية', icon: RefreshCw, color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
    returns: { label: 'إرجاع', icon: RotateCcw, color: 'text-slate-600', bg: 'bg-slate-100', dot: 'bg-slate-400' },
};

const teleStatusConfig: Record<TeleStatus, { label: string; icon: any; color: string; bg: string; border: string }> = {
    pending: { label: 'بانتظار الاتصال', icon: Loader2, color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
    no_answer: { label: 'لا يرد', icon: PhoneMissed, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    booked: { label: 'تم الحجز', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    refused: { label: 'رفض', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
};

/* ------------------------------------------------------------------ */
/*  Mock Data                                                           */
/* ------------------------------------------------------------------ */

const teamNames: Record<string, { name: string; supervisor: string; technician: string }> = {
    'team_0': { name: 'فريق ليلى أحمد', supervisor: 'ليلى أحمد', technician: 'أحمد علي' },
    'team_1': { name: 'فريق عمر حسن', supervisor: 'عمر حسن', technician: 'محمد جاسم' },
    'solo_0': { name: 'فردي: فاطمة نور', supervisor: '—', technician: 'فاطمة نور' },
};

const mockTeamTasks: TeamTask[] = [
    { id: 1, customerName: 'خالد السامرائي', mobile: '07701234567', taskType: 'emergency', taskDescription: 'عطل مضخة الماء', source: 'route', sourceLabel: 'مسار: المنصور', visitTime: '10:00', teleStatus: 'booked', priority: 'high' },
    { id: 2, customerName: 'نور الدين', mobile: '07709876543', taskType: 'periodic', taskDescription: 'صيانة دورية - تبديل فلاتر', source: 'route', sourceLabel: 'مسار: المنصور', visitTime: '11:30', teleStatus: 'booked', priority: 'medium' },
    { id: 3, customerName: 'سلمى حسين', mobile: '07705551234', taskType: 'followup', taskDescription: 'متابعة بعد صيانة طارئة', source: 'route', sourceLabel: 'مسار: الكرادة', visitTime: null, teleStatus: 'no_answer', priority: 'medium' },
    { id: 4, customerName: 'عبد الرحمن الجبوري', mobile: '07701112233', taskType: 'dues', taskDescription: 'قسط فبراير متأخر', source: 'direct', sourceLabel: 'تعيين مباشر', visitTime: null, teleStatus: 'pending', priority: 'high' },
    { id: 5, customerName: 'ريم عباس', mobile: '07703334455', taskType: 'periodic', taskDescription: 'صيانة دورية - فحص شامل', source: 'route', sourceLabel: 'مسار: المنصور', visitTime: '14:00', teleStatus: 'booked', priority: 'low' },
    { id: 6, customerName: 'فادي الموصلي', mobile: '07706667788', taskType: 'emergency', taskDescription: 'تسريب مياه من الجهاز', source: 'direct', sourceLabel: 'تعيين مباشر', visitTime: null, teleStatus: 'pending', priority: 'high' },
    { id: 7, customerName: 'ياسمين كريم', mobile: '07708889900', taskType: 'returns', taskDescription: 'إرجاع الجهاز - انتهاء العقد', source: 'route', sourceLabel: 'مسار: الكاظمية', visitTime: '16:00', teleStatus: 'booked', priority: 'low' },
    { id: 8, customerName: 'حسين كريم', mobile: '07702223344', taskType: 'followup', taskDescription: 'متابعة رضا الزبون', source: 'direct', sourceLabel: 'تعيين مباشر', visitTime: null, teleStatus: 'refused', priority: 'medium' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function TeamTasksDetail() {
    const { teamKey } = useParams<{ teamKey: string }>();
    const navigate = useNavigate();
    const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
    const [tasks, setTasks] = useState<TeamTask[]>(mockTeamTasks);

    const teamInfo = teamNames[teamKey || 'team_0'] || teamNames['team_0'];

    // Filter
    const filteredTasks = useMemo(() => {
        switch (activeFilter) {
            case 'scheduled': return tasks.filter(t => t.visitTime !== null);
            case 'unscheduled': return tasks.filter(t => t.visitTime === null);
            default: return tasks;
        }
    }, [tasks, activeFilter]);

    // Stats
    const stats = useMemo(() => ({
        total: tasks.length,
        booked: tasks.filter(t => t.teleStatus === 'booked').length,
        pending: tasks.filter(t => t.teleStatus === 'pending').length,
        scheduled: tasks.filter(t => t.visitTime !== null).length,
        unscheduled: tasks.filter(t => t.visitTime === null).length,
    }), [tasks]);

    // Actions
    const handleCancel = (taskId: number) => {
        setTasks(prev => prev.filter(t => t.id !== taskId));
    };

    const handleReassign = (taskId: number) => {
        // Mock: just show feedback
        alert(`سيتم نقل المهمة #${taskId} إلى فريق آخر`);
    };

    const filterTabs: { key: FilterTab; label: string; count: number; icon: any }[] = [
        { key: 'all', label: 'الكل', count: stats.total, icon: Filter },
        { key: 'unscheduled', label: 'غير مجدولة', count: stats.unscheduled, icon: Minus },
        { key: 'scheduled', label: 'مجدولة', count: stats.scheduled, icon: CheckCircle2 },
    ];

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* ─── HEADER ─── */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <div className="flex items-center gap-4 mb-3">
                    <button onClick={() => navigate('/planning/overview')}
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors text-slate-500 hover:text-slate-700 shrink-0">
                        <ArrowRight className="w-4 h-4" />
                    </button>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-bl from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
                        <Users className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-lg font-black text-slate-800">مهام {teamInfo.name}</h1>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> مشرف: <strong className="text-slate-600">{teamInfo.supervisor}</strong></span>
                            <span className="text-gray-300">|</span>
                            <span className="flex items-center gap-1"><User className="w-3 h-3" /> فني: <strong className="text-slate-600">{teamInfo.technician}</strong></span>
                        </div>
                    </div>

                    {/* Stats Badges */}
                    <div className="flex items-center gap-2">
                        <div className="flex flex-col items-center bg-slate-50 rounded-xl border border-gray-200 px-4 py-2 min-w-[70px]">
                            <span className="text-lg font-black text-slate-800">{stats.total}</span>
                            <span className="text-[10px] text-slate-400 font-medium">إجمالي</span>
                        </div>
                        <div className="flex flex-col items-center bg-emerald-50 rounded-xl border border-emerald-200 px-4 py-2 min-w-[70px]">
                            <span className="text-lg font-black text-emerald-600">{stats.booked}</span>
                            <span className="text-[10px] text-emerald-500 font-medium">محجوز</span>
                        </div>
                        <div className="flex flex-col items-center bg-amber-50 rounded-xl border border-amber-200 px-4 py-2 min-w-[70px]">
                            <span className="text-lg font-black text-amber-600">{stats.pending}</span>
                            <span className="text-[10px] text-amber-500 font-medium">قيد الانتظار</span>
                        </div>
                    </div>
                </div>

                {/* ─── FILTER TABS ─── */}
                <div className="flex gap-1.5">
                    {filterTabs.map(tab => {
                        const isActive = activeFilter === tab.key;
                        return (
                            <button key={tab.key} type="button" onClick={() => setActiveFilter(tab.key)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${isActive
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm'
                                    : 'bg-white text-slate-500 border border-transparent hover:bg-gray-50 hover:text-slate-700'}`}>
                                <tab.icon className="w-3.5 h-3.5" />
                                <span>{tab.label}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>{tab.count}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ─── TASK TABLE ─── */}
            <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr className="border-b border-gray-200">
                            <th className="text-right px-5 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">الزبون</th>
                            <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">نوع المهمة</th>
                            <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">المصدر</th>
                            <th className="text-center px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">وقت الزيارة</th>
                            <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">حالة الاتصال</th>
                            <th className="text-center px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wide">إجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        <AnimatePresence>
                            {filteredTasks.map((task, idx) => {
                                const tt = taskTypeConfig[task.taskType];
                                const ts = teleStatusConfig[task.teleStatus];
                                const TtIcon = tt.icon;
                                const TsIcon = ts.icon;

                                return (
                                    <motion.tr
                                        key={task.id}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        transition={{ duration: 0.15, delay: idx * 0.03 }}
                                        className="border-b border-gray-100 hover:bg-sky-50/30 transition-colors group"
                                    >
                                        {/* Customer */}
                                        <td className="px-5 py-3.5">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full shrink-0 ${tt.dot}`} />
                                                <div>
                                                    <p className="text-sm font-bold text-slate-800">{task.customerName}</p>
                                                    <a href={`tel:${task.mobile}`} className="text-[11px] text-sky-600 hover:text-sky-800 flex items-center gap-1 mt-0.5">
                                                        <Phone className="w-3 h-3" />
                                                        <span dir="ltr">{task.mobile}</span>
                                                    </a>
                                                </div>
                                            </div>
                                        </td>

                                        {/* Task Type */}
                                        <td className="px-4 py-3.5">
                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${tt.bg} ${tt.color}`}>
                                                <TtIcon className="w-3.5 h-3.5" />
                                                <span className="text-[11px] font-bold">{tt.label}</span>
                                            </div>
                                        </td>

                                        {/* Source */}
                                        <td className="px-4 py-3.5">
                                            {task.source === 'route' ? (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700">
                                                    <RouteIcon className="w-3.5 h-3.5" />
                                                    <span className="text-[11px] font-bold">{task.sourceLabel}</span>
                                                </div>
                                            ) : (
                                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-orange-700">
                                                    <Zap className="w-3.5 h-3.5" />
                                                    <span className="text-[11px] font-bold">{task.sourceLabel}</span>
                                                </div>
                                            )}
                                        </td>

                                        {/* Visit Time */}
                                        <td className="px-4 py-3.5 text-center">
                                            {task.visitTime ? (
                                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
                                                    <Clock className="w-3.5 h-3.5 text-emerald-600" />
                                                    <span className="text-sm font-black text-emerald-700 font-mono" dir="ltr">{task.visitTime}</span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-300 font-mono text-lg">——</span>
                                            )}
                                        </td>

                                        {/* Tele Status */}
                                        <td className="px-4 py-3.5">
                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${ts.bg} ${ts.border} ${ts.color}`}>
                                                <TsIcon className={`w-3.5 h-3.5 ${task.teleStatus === 'pending' ? 'animate-spin' : ''}`} />
                                                <span className="text-[11px] font-bold">{ts.label}</span>
                                            </div>
                                        </td>

                                        {/* Actions */}
                                        <td className="px-4 py-3.5 text-center">
                                            <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    type="button"
                                                    onClick={() => handleReassign(task.id)}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-[11px] font-medium transition-all"
                                                    title="نقل لفريق آخر"
                                                >
                                                    <Shuffle className="w-3 h-3" />
                                                    <span>نقل</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCancel(task.id)}
                                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-[11px] font-medium transition-all"
                                                    title="إلغاء المهمة"
                                                >
                                                    <Ban className="w-3 h-3" />
                                                    <span>إلغاء</span>
                                                </button>
                                            </div>
                                        </td>
                                    </motion.tr>
                                );
                            })}
                        </AnimatePresence>
                    </tbody>
                </table>

                {filteredTasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Filter className="w-10 h-10 mb-3 opacity-30" />
                        <p className="text-sm font-medium">لا توجد مهام تطابق الفلتر</p>
                    </div>
                )}
            </div>

            {/* ─── FOOTER SUMMARY ─── */}
            <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>عرض <strong className="text-slate-800">{filteredTasks.length}</strong> من <strong className="text-slate-800">{stats.total}</strong> مهمة</span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Progress bar */}
                    <span className="text-[10px] text-slate-400 font-medium">نسبة الجدولة</span>
                    <div className="w-40 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-l from-emerald-400 to-emerald-500 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: stats.total > 0 ? `${(stats.scheduled / stats.total) * 100}%` : '0%' }}
                            transition={{ duration: 0.5 }}
                        />
                    </div>
                    <span className="text-xs font-bold text-emerald-600">{stats.total > 0 ? Math.round((stats.scheduled / stats.total) * 100) : 0}%</span>
                </div>
            </div>
        </div>
    );
}
