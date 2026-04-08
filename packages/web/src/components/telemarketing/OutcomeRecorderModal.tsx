import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, CheckCircle2, PhoneOff, PhoneMissed, XCircle, MessageSquare, X, Send } from 'lucide-react';
import { CallOutcome, TaskListItem } from '../../lib/types';
import { getEntityContacts } from '../../lib/contactUtils';
import { useAuthStore } from '../../hooks/useAuthStore';

interface OutcomeRecorderModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: TaskListItem | null;
    entityDetails: any;
    onSave: (contactId: string, outcome: CallOutcome, notes: string, newContactStatus?: string, communicationMethod?: 'phone' | 'whatsapp_text' | 'whatsapp_voice') => void;
}
const outcomeConfig: Record<CallOutcome, { label: string; icon: any; color: string; bg: string; border: string; activeRing: string }> = {
    booked: { label: 'تم الحجز', icon: CheckCircle2, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', activeRing: 'ring-emerald-200' },
    busy: { label: 'مشغول', icon: PhoneOff, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-300', activeRing: 'ring-amber-200' },
    no_answer: { label: 'لا يرد', icon: PhoneMissed, color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-300', activeRing: 'ring-orange-200' },
    rejected: { label: 'مرفوض', icon: XCircle, color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-300', activeRing: 'ring-red-200' },
};

export default function OutcomeRecorderModal({ isOpen, onClose, task, entityDetails, onSave }: OutcomeRecorderModalProps) {
    const [method, setMethod] = useState<'phone' | 'whatsapp'>('phone');
    const [whatsappSubtype, setWhatsappSubtype] = useState<'whatsapp_text' | 'whatsapp_voice'>('whatsapp_text');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [outcome, setOutcome] = useState<CallOutcome | null>(null);
    const [notes, setNotes] = useState('');
    const [step, setStep] = useState<1 | 2>(1);
    const [contactStatus, setContactStatus] = useState<string>('');
    const currentUser = useAuthStore((state) => state.user);

    useEffect(() => {
        if (isOpen) {
            setMethod('phone');
            setWhatsappSubtype('whatsapp_text');
            setSelectedContactId('');
            setOutcome(null);
            setNotes('');
            setStep(1);
            setContactStatus('');
        }
    }, [isOpen, task]);

    if (!isOpen || !task || !entityDetails) return null;

    const contacts = getEntityContacts(entityDetails);
    const hasWhatsAppTarget = contacts.some(c => c.id === selectedContactId && c.hasWhatsApp);
    const isWhatsAppSelectable = method === 'whatsapp' ? hasWhatsAppTarget : true;

    const handleInitialSave = () => {
        if (!selectedContactId || !outcome) return;

        let commMethod: 'phone' | 'whatsapp_text' | 'whatsapp_voice' = 'phone';
        if (method === 'whatsapp') {
            commMethod = whatsappSubtype;
        }

        // Call onSave immediately
        onSave(selectedContactId, outcome, notes, undefined, commMethod);

        if (outcome === 'rejected') {
            setStep(2);
        } else {
            onClose();
        }
    };

    const handleStatusUpdate = () => {
        if (contactStatus) {
            let commMethod: 'phone' | 'whatsapp_text' | 'whatsapp_voice' = 'phone';
            if (method === 'whatsapp') { commMethod = whatsappSubtype; }
            onSave(selectedContactId, outcome as CallOutcome, notes, contactStatus, commMethod);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-violet-50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Send className="w-5 h-5 text-violet-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">تسجيل نتيجة التواصل</h2>
                            <p className="text-xs text-slate-500">{task.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                {step === 1 ? (
                    <div className="p-5 space-y-6">
                        {/* Method Selection */}
                        <div className="space-y-3">
                            <label className="text-sm font-bold text-slate-700">طريقة التواصل <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-2 gap-3">
                                <button type="button" onClick={() => setMethod('phone')}
                                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${method === 'phone' ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-2 ring-indigo-200 shadow-sm' : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}>
                                    <Phone className="w-5 h-5" />
                                    <span className="text-sm font-bold">مكالمة هاتفية</span>
                                </button>
                                <button type="button" onClick={() => setMethod('whatsapp')}
                                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${method === 'whatsapp' ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-200 shadow-sm' : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}>
                                    <MessageSquare className="w-5 h-5" />
                                    <span className="text-sm font-bold">واتساب</span>
                                </button>
                            </div>

                            {method === 'whatsapp' && (
                                <div className="mt-3 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-3">
                                    <label className="text-xs font-bold text-emerald-800 block">نوع التواصل عبر واتساب:</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setWhatsappSubtype('whatsapp_text')}
                                            className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${whatsappSubtype === 'whatsapp_text' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                                            رسالة نصية
                                        </button>
                                        <button type="button" onClick={() => setWhatsappSubtype('whatsapp_voice')}
                                            className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${whatsappSubtype === 'whatsapp_voice' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}>
                                            مكالمة صوتية
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-emerald-600 font-bold mt-2 bg-white px-2 py-1 rounded border border-emerald-100 w-fit">الموظف: {currentUser?.name || 'غير معروف'}</p>
                                </div>
                            )}
                        </div>

                        {/* Contact Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-4 h-4 text-violet-500" />الرقم المستخدم للتواصل <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={selectedContactId}
                                onChange={(e) => setSelectedContactId(e.target.value)}
                                className={`w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all ${method === 'whatsapp' && selectedContactId && !hasWhatsAppTarget ? 'border-red-300 ring-2 ring-red-200 bg-red-50' : ''}`}
                            >
                                <option value="" disabled>-- اختر الرقم --</option>
                                {contacts.map(contact => (
                                    <option key={contact.id} value={contact.id} disabled={method === 'whatsapp' && !contact.hasWhatsApp}>
                                        {contact.label} - {contact.number} {contact.hasWhatsApp ? '(واتساب)' : ''} {method === 'whatsapp' && !contact.hasWhatsApp ? '- لا يدعم واتساب' : ''}
                                    </option>
                                ))}
                            </select>
                            {method === 'whatsapp' && selectedContactId && !hasWhatsAppTarget && (
                                <p className="text-xs text-red-600 font-bold mt-1">هذا الرقم لا يدعم واتساب. يرجى اختيار رقم آخر أو تغيير طريقة التواصل.</p>
                            )}
                        </div>

                        {/* Outcomes */}
                        <div className="space-y-3 opacity-100 transition-opacity" style={{ opacity: selectedContactId && isWhatsAppSelectable ? 1 : 0.5 }}>
                            <label className="text-sm font-bold text-slate-700">نتيجة التواصل <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-2 gap-3">
                                {(Object.keys(outcomeConfig) as CallOutcome[]).map((key) => {
                                    const cfg = outcomeConfig[key];
                                    const isActive = outcome === key;
                                    return (
                                        <button key={key} type="button" onClick={() => setOutcome(key)} disabled={!selectedContactId || !isWhatsAppSelectable}
                                            className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all text-center ${isActive
                                                ? `${cfg.bg} ${cfg.border} ${cfg.color} shadow-sm ring-2 ${cfg.activeRing}`
                                                : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}>
                                            <cfg.icon className={`w-6 h-6 ${isActive ? cfg.color : 'text-gray-400'}`} />
                                            <span className="text-sm font-bold">{cfg.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Notes */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <MessageSquare className="w-4 h-4 text-violet-500" />ملاحظات (اختياري)
                            </label>
                            <textarea
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="أي تفاصيل إضافية حول التواصل..."
                                className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none min-h-[100px] resize-none transition-all"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="p-5 space-y-6">
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                                <PhoneOff className="w-8 h-8 text-red-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">تحديث حالة الرقم (اختياري)</h3>
                            <p className="text-sm text-slate-500 mt-1">تم حفظ نتيجة المكالمة (مرفوضة). هل هناك مشكلة بالرقم؟</p>
                            <p className="font-bold text-slate-800 mt-2" dir="ltr">{contacts.find(c => c.id === selectedContactId)?.number}</p>
                        </div>

                        <div className="space-y-2 pt-2">
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-slate-50 cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <input type="radio" name="c_status" checked={contactStatus === ''} onChange={() => setContactStatus('')} className="w-4 h-4 text-violet-600" />
                                    <span className="font-bold text-sm text-slate-700">لا تغيير في الحالة</span>
                                </div>
                            </label>
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-slate-50 cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <input type="radio" name="c_status" checked={contactStatus === 'Out of Coverage'} onChange={() => setContactStatus('Out of Coverage')} className="w-4 h-4 text-violet-600" />
                                    <span className="font-bold text-sm text-slate-700">خارج التغطية</span>
                                </div>
                            </label>
                            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-slate-50 cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <input type="radio" name="c_status" checked={contactStatus === 'Not Used'} onChange={() => setContactStatus('Not Used')} className="w-4 h-4 text-violet-600" />
                                    <span className="font-bold text-sm text-slate-700">غير مستخدم / مفصول</span>
                                </div>
                            </label>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    {step === 2 ? (
                        <>
                            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors">تخطي</button>
                            <button
                                onClick={handleStatusUpdate}
                                className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold shadow-md shadow-violet-500/20 transition-all"
                            >
                                <CheckCircle2 className="w-4 h-4" /> حدث الحالة وأغلق
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">إلغاء</button>
                            <button
                                onClick={handleInitialSave}
                                disabled={!selectedContactId || !outcome || (method === 'whatsapp' && !hasWhatsAppTarget)}
                                className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-violet-500/20 disabled:shadow-none transition-all"
                            >
                                <CheckCircle2 className="w-4 h-4" />
                                حفظ النتيجة
                            </button>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
