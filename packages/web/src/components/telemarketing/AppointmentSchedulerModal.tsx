import React, { useState, useEffect } from 'react';
import IconButton from '../ui/IconButton';
import { motion } from 'framer-motion';
import { Calendar, Droplets, FileText, CheckCircle2, X, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { OPEN_TASK_TYPE_LABELS } from '@golden-crm/shared';
import type { OpenTaskType } from '@golden-crm/shared';
import Select from '../ui/Select';
import Button from '../ui/Button';
import VisitTimePicker, { isVisitTimeConflict, normalizeVisitTime } from './VisitTimePicker';

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
    defaultTime?: string;
    /** HH:MM times already booked for the same team on this date (conflict guard). */
    bookedTimes?: string[];
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

function getTaskLabel(type: string | null): string {
    if (!type) return 'مهمة غير محددة';
    return (OPEN_TASK_TYPE_LABELS as Record<string, string>)[type as OpenTaskType] || type;
}

function getTomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AppointmentSchedulerModal({
    isOpen,
    onClose,
    customerName,
    defaultDate,
    defaultTime,
    bookedTimes = [],
    customerOpenTasks,
    entityDetails,
    onSave,
}: AppointmentSchedulerModalProps) {
    const [visitDate, setVisitDate] = useState(defaultDate || getTomorrow());
    const [visitTime, setVisitTime] = useState('');
    const [waterSource, setWaterSource] = useState('');
    const [technicianNotes, setTechnicianNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [waterSourceOptions, setWaterSourceOptions] = useState<string[]>([]);

    // Reset fields when opening. The page owns the scheduling date.
    useEffect(() => {
        if (isOpen) {
            setVisitDate(defaultDate || getTomorrow());
            setVisitTime(normalizeVisitTime(defaultTime));
            setWaterSource(entityDetails?.waterSource || '');
            setTechnicianNotes('');

            let active = true;
            const fetchWaterSources = async () => {
                try {
                    const res = await api.systemLists.list({ category: 'water_source', activeOnly: true });
                    if (!active) return;
                    setWaterSourceOptions(res.map((item: any) => item.value));
                } catch {
                    if (active) setWaterSourceOptions([]);
                }
            };
            fetchWaterSources();

            return () => {
                active = false;
            };
        }
    }, [isOpen, entityDetails, customerOpenTasks, defaultDate, defaultTime]);

    if (!isOpen) return null;

    const selectedTasks = customerOpenTasks;
    const includesDeviceDemo = selectedTasks.some(t => t.openTaskType === 'device_demo');

    const timeConflict = isVisitTimeConflict(visitTime, bookedTimes);
    const isValid =
        visitTime &&
        !timeConflict &&
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
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Calendar className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">جدولة موعد زيارة تسويقية</h2>
                            <p className="text-xs text-slate-500">{customerName} &middot; {visitDate || defaultDate}</p>
                        </div>
                    </div>
                    <IconButton icon={X} label="إغلاق" onClick={onClose} disabled={saving} />
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">

                    {/* Visit time. The scheduling date is locked by the workspace. */}
                    <VisitTimePicker
                        value={visitTime}
                        onChange={setVisitTime}
                        bookedTimes={bookedTimes}
                    />

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
                                            <span className="text-xs bg-white border border-emerald-200 rounded px-1.5 py-0.5 text-emerald-700">
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
                            <Select
                                value={waterSource}
                                onChange={setWaterSource}
                                placeholder="-- اختر مصدر المياه --"
                                ariaLabel="مصدر المياه"
                                className="w-full"
                                options={waterSourceOptions.map(option => ({ value: option, label: option }))}
                            />
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
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none min-h-[80px] resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 shrink-0">
                    <Button variant="ghost" disabled={saving} onClick={onClose}>إلغاء</Button>
                    <Button
                        icon={CheckCircle2}
                        loading={saving}
                        disabled={!isValid || saving}
                        onClick={handleSave}
                    >
                        {saving ? 'جاري الحفظ...' : 'تأكيد موعد الزيارة'}
                    </Button>
                </div>
            </motion.div>
        </div>
    );
}
