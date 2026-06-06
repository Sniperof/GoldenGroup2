import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, Droplets, FileText, CheckCircle2, X, Loader2 } from 'lucide-react';
import { WORKING_HOURS } from '../../lib/types';
import { OPEN_TASK_TYPE_LABELS } from '@golden-crm/shared';
import type { OpenTaskType } from '@golden-crm/shared';

export interface CustomerOpenTask {
    taskListItemId: string;
    openTaskId: number | null;
    openTaskType: string | null;
    openTaskReason: string | null;
    openTaskStatus: string | null;
    openTaskExpectedDate?: string | null;
    openTaskExpectedTime?: string | null;
}

export interface SelectedTaskEntry {
    taskListItemId: string;
    openTaskId: number | null;
    taskType: string;
}

interface AppointmentSchedulerModalProps {
    isOpen: boolean;
    onClose: () => void;
    customerName: string;
    defaultDate: string;
    initialDate?: string;
    defaultTime?: string;
    /** All open tasks belonging to this customer in the current task list */
    customerOpenTasks: CustomerOpenTask[];
    entityDetails: any;
    onSave: (data: {
        visitDate: string;
        visitTime: string;
        selectedTaskEntries: SelectedTaskEntry[];
        waterSource: string;
        requestedDeviceModelId: number | null;
        requestedDeviceName: string;
        technicianNotes: string;
    }) => Promise<void>;
}

const WATER_SOURCE_OPTIONS = [
    { value: 'الاسالة الحكومية', label: 'الاسالة الحكومية' },
    { value: 'شراء قناني معبأة (RO)', label: 'شراء قناني معبأة (RO)' },
    { value: 'ماء بئر / جوفي', label: 'ماء بئر / جوفي' },
    { value: 'تناكر / حوضيات', label: 'تناكر / حوضيات' },
    { value: 'غير معروف', label: 'غير معروف' },
];

function getTaskLabel(type: string | null): string {
    if (!type) return 'مهمة غير محددة';
    return (OPEN_TASK_TYPE_LABELS as Record<string, string>)[type as OpenTaskType] || type;
}

function getTomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AppointmentSchedulerModal({
    isOpen,
    onClose,
    customerName,
    defaultDate,
    initialDate,
    defaultTime,
    customerOpenTasks,
    entityDetails,
    onSave,
}: AppointmentSchedulerModalProps) {
    const [visitDate, setVisitDate] = useState(getTomorrow());
    const [visitTime, setVisitTime] = useState('');
    const [waterSource, setWaterSource] = useState('');
    const [technicianNotes, setTechnicianNotes] = useState('');
    const [saving, setSaving] = useState(false);

    // Reset fields when opening — default date is tomorrow.
    useEffect(() => {
        if (isOpen) {
            setVisitDate(initialDate || getTomorrow());
            setVisitTime(defaultTime || '');
            setWaterSource(entityDetails?.waterSource || '');
            setTechnicianNotes('');
        }
    }, [isOpen, entityDetails, customerOpenTasks, initialDate, defaultTime]);

    if (!isOpen) return null;

    const selectedTasks = customerOpenTasks;
    const includesDeviceDemo = selectedTasks.some(t => t.openTaskType === 'device_demo');

    const isValid =
        visitTime &&
        selectedTasks.length > 0 &&
        (!includesDeviceDemo || !!waterSource);

    const handleSave = async () => {
        if (!isValid || saving) return;
        setSaving(true);
        try {
            const selectedTaskEntries: SelectedTaskEntry[] = selectedTasks.map(t => ({
                taskListItemId: t.taskListItemId,
                openTaskId: t.openTaskId,
                taskType: t.openTaskType || 'device_demo',
            }));
            await onSave({
                visitDate,
                visitTime,
                selectedTaskEntries,
                waterSource: includesDeviceDemo ? waterSource : '',
                requestedDeviceModelId: null,
                requestedDeviceName: '',
                technicianNotes,
            });
            onClose();
        } catch {
            // Caller handles error; keep modal open for retry.
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Calendar className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">جدولة موعد زيارة تسويقية</h2>
                            <p className="text-xs text-slate-500">{customerName} &middot; {visitDate || defaultDate}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={saving} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">

                    {/* Visit Date + Time — side by side */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Calendar className="w-4 h-4 text-emerald-500" />تاريخ الزيارة <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="date"
                                value={visitDate}
                                onChange={e => setVisitDate(e.target.value)}
                                min={getToday()}
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 font-mono"
                                dir="ltr"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Clock className="w-4 h-4 text-emerald-500" />وقت الزيارة <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="time"
                                value={visitTime}
                                onChange={e => setVisitTime(e.target.value)}
                                min={`${WORKING_HOURS.start.toString().padStart(2, '0')}:00`}
                                max={`${WORKING_HOURS.end.toString().padStart(2, '0')}:00`}
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 font-mono"
                                dir="ltr"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-emerald-500" />
                            المهام المرتبطة بهذا الموعد
                        </label>
                        {customerOpenTasks.length === 0 ? (
                            <p className="text-sm text-slate-400 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                                لا توجد مهام مفتوحة مرتبطة بهذا الزبون
                            </p>
                        ) : (
                            <div className="text-sm text-slate-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-2">
                                {customerOpenTasks.map(task => (
                                    <div key={task.taskListItemId} className="flex items-center justify-between gap-3">
                                        <span className="font-bold">{getTaskLabel(task.openTaskType)}</span>
                                        {task.openTaskReason && (
                                            <span className="text-[10px] bg-white border border-emerald-200 rounded px-1.5 py-0.5 text-emerald-700">
                                                {task.openTaskReason}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {includesDeviceDemo && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Droplets className="w-4 h-4 text-blue-500" />مصدر المياه الحالي <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={waterSource}
                                onChange={e => setWaterSource(e.target.value)}
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            >
                                <option value="">-- اختر مصدر المياه --</option>
                                {WATER_SOURCE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Technician Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-amber-500" />ملاحظات خاصة للفني
                        </label>
                        <textarea
                            value={technicianNotes}
                            onChange={e => setTechnicianNotes(e.target.value)}
                            placeholder="أي تفاصيل يجب أن يعرفها الفريق قبل الزيارة..."
                            className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none min-h-[80px] resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">إلغاء</button>
                    <button
                        onClick={handleSave}
                        disabled={!isValid || saving}
                        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 disabled:shadow-none transition-all"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {saving ? 'جاري الحفظ...' : 'تأكيد موعد الزيارة'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
