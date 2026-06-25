import { useState, useEffect } from 'react';
import { Calendar, Clock, Droplets, FileText, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import { OPEN_TASK_TYPE_LABELS } from '@golden-crm/shared';
import type { OpenTaskType } from '@golden-crm/shared';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

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

const getHourlyVisitSlots = () => Array.from({ length: 24 }, (_, index) => {
    const hour = (9 + index) % 24;
    return `${String(hour).padStart(2, '0')}:00`;
});

const normalizeTimeSlot = (value: string | null | undefined) => String(value || '').slice(0, 5);
const normalizeHourlySlot = (value: string | null | undefined) => {
    const normalized = normalizeTimeSlot(value);
    return getHourlyVisitSlots().includes(normalized) ? normalized : '09:00';
};

export default function AppointmentSchedulerModal({
    isOpen,
    onClose,
    customerName,
    defaultDate,
    defaultTime,
    customerOpenTasks,
    entityDetails,
    onSave,
}: AppointmentSchedulerModalProps) {
    const [visitDate, setVisitDate] = useState(defaultDate || getTomorrow());
    const [visitTime, setVisitTime] = useState('09:00');
    const [waterSource, setWaterSource] = useState('');
    const [technicianNotes, setTechnicianNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [waterSourceOptions, setWaterSourceOptions] = useState<string[]>([]);

    // Reset fields when opening. The page owns the scheduling date.
    useEffect(() => {
        if (isOpen) {
            setVisitDate(defaultDate || getTomorrow());
            setVisitTime(normalizeHourlySlot(defaultTime));
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
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            closeOnBackdrop={false}
            closeOnEsc={!saving}
            title={
                <span className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                        <Calendar className="w-5 h-5 text-emerald-600" />
                    </span>
                    جدولة موعد زيارة تسويقية
                </span>
            }
            subtitle={`${customerName} · ${visitDate || defaultDate}`}
            footer={
                <>
                    <Button variant="ghost" disabled={saving} onClick={onClose}>إلغاء</Button>
                    <Button
                        icon={CheckCircle2}
                        loading={saving}
                        disabled={!isValid || saving}
                        onClick={handleSave}
                    >
                        {saving ? 'جاري الحفظ...' : 'تأكيد موعد الزيارة'}
                    </Button>
                </>
            }
        >
                {/* Body */}
                <div className="p-5 space-y-5">

                    {/* Visit time. The scheduling date is locked by the workspace. */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-emerald-500" />وقت الزيارة <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={visitTime}
                            onChange={setVisitTime}
                            className="w-full"
                            options={getHourlyVisitSlots().map(slot => ({ value: slot, label: slot }))}
                        />
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
        </Modal>
    );
}
