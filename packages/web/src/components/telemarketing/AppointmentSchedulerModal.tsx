import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Clock, Droplets, FileText, CheckCircle2, X, Monitor, Loader2 } from 'lucide-react';
import { WORKING_HOURS } from '../../lib/types';
import { api } from '../../lib/api';

interface DeviceModelOption {
    id: number;
    nameAr?: string | null;
    nameEn?: string | null;
    name: string;
}

interface AppointmentSchedulerModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: { id: string; name: string; [k: string]: any } | null;
    entityDetails: any;
    defaultDate: string;
    onSave: (data: {
        visitTime: string;
        visitTasks: string[];
        waterSource: string;
        requestedDeviceModelId: number | null;
        requestedDeviceName: string;
        technicianNotes: string;
    }) => Promise<void>;
}

const VISIT_TASK_OPTIONS = [
    { value: 'device_demo', label: 'عرض جهاز' },
];

const WATER_SOURCE_OPTIONS = [
    { value: 'الاسالة الحكومية', label: 'الاسالة الحكومية' },
    { value: 'شراء قناني معبأة (RO)', label: 'شراء قناني معبأة (RO)' },
    { value: 'ماء بئر / جوفي', label: 'ماء بئر / جوفي' },
    { value: 'تناكر / حوضيات', label: 'تناكر / حوضيات' },
    { value: 'غير معروف', label: 'غير معروف' },
];

export default function AppointmentSchedulerModal({ isOpen, onClose, task, entityDetails, defaultDate, onSave }: AppointmentSchedulerModalProps) {
    const [visitTime, setVisitTime] = useState('');
    const [visitTasks, setVisitTasks] = useState<string[]>(['device_demo']);
    const [waterSource, setWaterSource] = useState('');
    const [selectedDeviceModelId, setSelectedDeviceModelId] = useState<number | null>(null);
    const [requestedDeviceName, setRequestedDeviceName] = useState('');
    const [technicianNotes, setTechnicianNotes] = useState('');
    const [deviceModels, setDeviceModels] = useState<DeviceModelOption[]>([]);
    const [loadingDevices, setLoadingDevices] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setVisitTime('');
            setVisitTasks(['device_demo']);
            setWaterSource(entityDetails?.waterSource || '');
            setSelectedDeviceModelId(null);
            setRequestedDeviceName('');
            setTechnicianNotes('');
        }
    }, [isOpen, entityDetails]);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoadingDevices(true);
        api.deviceModels.list()
            .then((devices: DeviceModelOption[]) => {
                if (!cancelled) setDeviceModels(devices);
            })
            .catch(() => {
                if (!cancelled) setDeviceModels([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingDevices(false);
            });
        return () => { cancelled = true; };
    }, [isOpen]);

    if (!isOpen || !task) return null;

    const isValid = visitTime && visitTasks.length > 0 && waterSource;

    const handleDeviceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (!val) {
            setSelectedDeviceModelId(null);
            setRequestedDeviceName('');
            return;
        }
        const id = Number(val);
        setSelectedDeviceModelId(id);
        const device = deviceModels.find(d => d.id === id);
        setRequestedDeviceName(device?.nameAr || device?.name || '');
    };

    const handleSave = async () => {
        if (!isValid || saving) return;
        setSaving(true);
        try {
            await onSave({
                visitTime,
                visitTasks,
                waterSource,
                requestedDeviceModelId: selectedDeviceModelId,
                requestedDeviceName,
                technicianNotes,
            });
            onClose();
        } catch {
            // Error is handled by the caller; keep modal open so user can retry
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
                {/* Compact header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-emerald-50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Calendar className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">جدولة موعد زيارة تسويقية</h2>
                            <p className="text-xs text-slate-500">{task.name} &middot; {defaultDate}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={saving} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">

                    {/* Visit Time */}
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

                    {/* Visit Tasks */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-emerald-500" />مهام الزيارة <span className="text-red-500">*</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {VISIT_TASK_OPTIONS.map(opt => {
                                const checked = visitTasks.includes(opt.value);
                                return (
                                    <label
                                        key={opt.value}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer transition-colors text-sm font-bold ${
                                            checked
                                                ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                                                : 'bg-slate-50 border-gray-200 text-slate-500 hover:border-emerald-300'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => {
                                                if (checked) return;
                                                setVisitTasks([opt.value]);
                                            }}
                                            className="accent-emerald-600"
                                        />
                                        {opt.label}
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Requested Device */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <Monitor className="w-4 h-4 text-emerald-500" />الجهاز المطلوب عرضه
                        </label>
                        {loadingDevices ? (
                            <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                جاري تحميل قائمة الأجهزة...
                            </div>
                        ) : deviceModels.length > 0 ? (
                            <select
                                value={selectedDeviceModelId ?? ''}
                                onChange={handleDeviceSelect}
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            >
                                <option value="">اختر الجهاز المطلوب عرضه...</option>
                                {deviceModels.map(d => (
                                    <option key={d.id} value={d.id}>{d.nameAr || d.name}</option>
                                ))}
                            </select>
                        ) : (
                            <input
                                type="text"
                                value={requestedDeviceName}
                                onChange={e => setRequestedDeviceName(e.target.value)}
                                placeholder="اكتب اسم الجهاز المطلوب عرضه..."
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm placeholder:text-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            />
                        )}
                    </div>

                    {/* Water Source */}
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