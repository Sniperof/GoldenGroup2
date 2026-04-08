import { motion } from 'framer-motion';
import { Eye, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import type { Task } from '../lib/types';

const typeConfig = {
    emergency: { color: 'border-red-500', bg: 'bg-red-500/5', label: 'طوارئ', icon: '🔴' },
    dues: { color: 'border-amber-500', bg: 'bg-amber-500/5', label: 'مستحقات', icon: '🟡' },
    periodic: { color: 'border-blue-500', bg: 'bg-blue-500/5', label: 'دورية', icon: '🔵' },
    returns: { color: 'border-purple-500', bg: 'bg-purple-500/5', label: 'إرجاع', icon: '🟣' },
    followup: { color: 'border-emerald-500', bg: 'bg-emerald-500/5', label: 'متابعة', icon: '🟢' },
};

const statusConfig = {
    pending: { label: 'قيد الانتظار', color: 'text-slate-500', icon: Clock },
    'in-progress': { label: 'قيد التنفيذ', color: 'text-blue-600', icon: AlertCircle },
    completed: { label: 'مكتمل', color: 'text-emerald-600', icon: CheckCircle2 },
};

const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ar-SY', { month: 'short', day: 'numeric' });
};

interface TaskCardProps {
    task: Task;
    onView?: (task: Task) => void;
}

export default function TaskCard({ task, onView }: TaskCardProps) {
    const config = typeConfig[task.type];
    const statusInfo = statusConfig[task.status];
    const StatusIcon = statusInfo.icon;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden border-r-4 ${config.color} hover:shadow-md transition-all`}>
            <div className="p-4 flex items-center gap-4">
                {/* Type Icon */}
                <div className={`w-12 h-12 rounded-lg ${config.bg} flex items-center justify-center text-2xl flex-shrink-0`}>
                    {config.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {/* Line 1: Customer Name */}
                    <h3 className="text-slate-900 font-bold text-base mb-0.5 truncate">{task.customerName}</h3>

                    {/* Line 2: Context */}
                    <p className="text-slate-600 text-sm mb-1.5 truncate">{task.context}</p>

                    {/* Line 3: Metadata */}
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                            {task.location}
                        </span>
                        <span>•</span>
                        <span>{formatDate(task.dueDate)}</span>
                    </div>
                </div>

                {/* Right Side: Status or Action */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {task.status === 'completed' ? (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 ${statusInfo.color}`}>
                            <StatusIcon className="w-4 h-4" />
                            <span className="text-xs font-medium">{statusInfo.label}</span>
                        </div>
                    ) : task.status === 'in-progress' ? (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 ${statusInfo.color}`}>
                            <StatusIcon className="w-4 h-4" />
                            <span className="text-xs font-medium">{statusInfo.label}</span>
                        </div>
                    ) : (
                        <button
                            onClick={() => onView?.(task)}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
                        >
                            <Eye className="w-4 h-4" />
                            <span>عرض</span>
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
