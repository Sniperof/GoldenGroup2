import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Clock, MapPin, Search, Send, X, CheckCircle2, User, FileText, Droplets, Briefcase } from 'lucide-react';
import { TaskListItem, WORKING_HOURS } from '../../lib/types';

interface AppointmentSchedulerModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: TaskListItem | null;
    entityDetails: any;
    defaultDate: string;
    onSave: (visitTime: string, duration: string, occupation: string, waterSource: string, notes: string) => void;
}

export default function AppointmentSchedulerModal({ isOpen, onClose, task, entityDetails, defaultDate, onSave }: AppointmentSchedulerModalProps) {
    const [visitTime, setVisitTime] = useState('');
    const [visitType, setVisitType] = useState('first_visit');
    const [waterSource, setWaterSource] = useState('');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (isOpen && entityDetails) {
            setVisitTime('');
            setVisitType('first_visit');
            setWaterSource(entityDetails.waterSource || '');
            setNotes('');
        }
    }, [isOpen, entityDetails]);

    if (!isOpen || !task || !entityDetails) return null;

    const handleSave = () => {
        if (!visitTime || !waterSource) return;
        const occ = entityDetails.occupation || '';
        onSave(visitTime, visitType, occ, waterSource, notes);
        onClose();
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
                            <h2 className="text-lg font-bold text-slate-800">جدولة موعد زيارة</h2>
                            <p className="text-xs text-slate-500">{task.name} ({defaultDate})</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar">

                    {/* Read Only Client Info */}
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-3">
                        <div className="flex items-start gap-2">
                            <Briefcase className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-bold text-slate-500">المهنة</p>
                                <p className="text-sm font-bold text-slate-800">{entityDetails.occupation || 'غير محددة'}</p>
                            </div>
                        </div>
                        <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-bold text-slate-500">العنوان الكامل</p>
                                <p className="text-sm font-bold text-slate-800">{task.addressText || 'لا يوجد عنوان تفصيلي'}</p>
                            </div>
                        </div>
                    </div>

                    {/* Time & Type */}
                    <div className="grid grid-cols-2 gap-4">
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
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <FileText className="w-4 h-4 text-emerald-500" />نوع الزيارة <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={visitType}
                                onChange={e => setVisitType(e.target.value)}
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                            >
                                <option value="first_visit">أول زيارة (فحص وتحليل)</option>
                                <option value="maintenance">صيانة</option>
                                <option value="periodic">دورية</option>
                            </select>
                        </div>
                    </div>

                    {/* Analytics Info */}
                    <div className="space-y-4 pt-4 border-t border-gray-100">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">بيانات تحليلية متطلبة</h3>

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
                                <option value="الاسالة الحكومية">الاسالة الحكومية</option>
                                <option value="شراء قناني معبأة (RO)">شراء قناني معبأة (RO)</option>
                                <option value="ماء بئر / جوفي">ماء بئر / جوفي</option>
                                <option value="تناكر / حوضيات">تناكر / حوضيات</option>
                                <option value="غير معروف">غير معروف</option>
                            </select>
                        </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2 pt-4 border-t border-gray-100">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-amber-500" />ملاحظات خاصة للفني
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="أي تفاصيل يجب أن يعرفها الفني قبل الزيارة..."
                            className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none min-h-[80px] resize-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">إلغاء</button>
                    <button
                        onClick={handleSave}
                        disabled={!visitTime || !waterSource}
                        className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-500/20 disabled:shadow-none transition-all"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        تأكيد الموعد مع {task.name} {entityDetails.occupation ? `- ${entityDetails.occupation}` : ''}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
