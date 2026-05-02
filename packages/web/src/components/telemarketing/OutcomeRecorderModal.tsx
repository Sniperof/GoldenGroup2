import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Phone, CheckCircle2, PhoneOff, PhoneMissed, X, Send,
    MessageSquare, PhoneForwarded, UserCheck, PhoneCall,
    MapPin, AlertTriangle, Calendar
} from 'lucide-react';
import {
    TelemarketingOutcomeCode, OUTCOME_MAP, OUTCOMES_BY_GROUP,
    PHONE_STATUS_LABELS, PHONE_STATUS_TO_CONTACT_ENTRY,
    getOutcomeMeta, normaliseOutcomeCode,
} from '@golden-crm/shared';
import { TaskListItem, ContactStatus } from '../../lib/types';
import { getEntityContacts } from '../../lib/contactUtils';
import { useAuthStore } from '../../hooks/useAuthStore';

interface OutcomeRecorderModalProps {
    isOpen: boolean;
    onClose: () => void;
    task: TaskListItem | null;
    entityDetails: any;
    onSave: (
        contactId: string,
        outcome: TelemarketingOutcomeCode,
        notes: string,
        newContactStatus?: string,
        communicationMethod?: 'phone' | 'whatsapp_text' | 'whatsapp_voice',
    ) => void;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
    not_reached: <PhoneMissed className="w-4 h-4" />,
    reached: <PhoneCall className="w-4 h-4" />,
    follow_up: <PhoneForwarded className="w-4 h-4" />,
    service_request: <UserCheck className="w-4 h-4" />,
    booked: <Calendar className="w-4 h-4" />,
};

const OUTCOME_ICON_COLORS: Record<string, { color: string; bg: string; border: string }> = {
    // Not reached
    no_answer: { color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
    busy: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    out_of_coverage: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    not_in_service: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    wrong_number: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    auto_disconnected: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    // Reached — no appointment
    currently_busy: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    interrupted: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    other_company_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    seen_offer_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    address_updated: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
    // Follow-up
    other_company_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    seen_offer_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    // Service
    service_request: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    company_customer_missing_phone: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    // Booked
    booked_marketing_appointment: { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

export default function OutcomeRecorderModal({ isOpen, onClose, task, entityDetails, onSave }: OutcomeRecorderModalProps) {
    const [method, setMethod] = useState<'phone' | 'whatsapp'>('phone');
    const [whatsappSubtype, setWhatsappSubtype] = useState<'whatsapp_text' | 'whatsapp_voice'>('whatsapp_text');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [outcome, setOutcome] = useState<TelemarketingOutcomeCode | null>(null);
    const [notes, setNotes] = useState('');
    const [phoneStatus, setPhoneStatus] = useState<string>('');
    const [expandedGroup, setExpandedGroup] = useState<string | null>('not_reached');
    const currentUser = useAuthStore((state) => state.user);

    const outcomeMeta = outcome ? OUTCOME_MAP[outcome] : null;

    useEffect(() => {
        if (isOpen) {
            setMethod('phone');
            setWhatsappSubtype('whatsapp_text');
            setSelectedContactId('');
            setOutcome(null);
            setNotes('');
            setPhoneStatus('');
            setExpandedGroup('not_reached');
        }
    }, [isOpen, task]);

    // Auto-set default phone status when selecting a phone-quality outcome
    useEffect(() => {
        if (outcomeMeta?.defaultPhoneStatus) {
            setPhoneStatus(PHONE_STATUS_TO_CONTACT_ENTRY[outcomeMeta.defaultPhoneStatus]);
        } else {
            setPhoneStatus('');
        }
    }, [outcome]);

    if (!isOpen || !task || !entityDetails) return null;

    const contacts = getEntityContacts(entityDetails);
    const hasWhatsAppTarget = contacts.some(c => c.id === selectedContactId && c.hasWhatsApp);
    const isWhatsAppSelectable = method === 'whatsapp' ? hasWhatsAppTarget : true;

    const requiresPhoneStatus = outcomeMeta?.requiresPhoneStatusUpdate ?? false;
    const requiresNotes = outcomeMeta?.requiresNotes ?? false;

    const canSave = !!selectedContactId &&
        !!outcome &&
        isWhatsAppSelectable &&
        (!requiresPhoneStatus || !!phoneStatus) &&
        (!requiresNotes || notes.trim().length > 0);

    const handleSave = () => {
        if (!canSave || !outcome) return;

        let commMethod: 'phone' | 'whatsapp_text' | 'whatsapp_voice' = 'phone';
        if (method === 'whatsapp') {
            commMethod = whatsappSubtype;
        }

        onSave(selectedContactId, outcome, notes, requiresPhoneStatus ? phoneStatus : undefined, commMethod);
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
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-violet-50 shrink-0">
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
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
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

                    {/* Outcome Selection - Grouped */}
                    <div className="space-y-3" style={{ opacity: selectedContactId && isWhatsAppSelectable ? 1 : 0.5, pointerEvents: selectedContactId && isWhatsAppSelectable ? 'auto' : 'none' }}>
                        <label className="text-sm font-bold text-slate-700">نتيجة التواصل <span className="text-red-500">*</span></label>
                        <div className="space-y-2">
                            {OUTCOMES_BY_GROUP.map(group => {
                                const isOpen = expandedGroup === group.key;
                                return (
                                    <div key={group.key} className="border border-gray-200 rounded-xl overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedGroup(isOpen ? null : group.key)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-right"
                                        >
                                            <div className="flex items-center gap-2">
                                                {GROUP_ICONS[group.key]}
                                                <span className="text-sm font-bold text-slate-700">{group.label}</span>
                                            </div>
                                            <svg
                                                className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>
                                        {isOpen && (
                                            <div className="p-2 space-y-1.5">
                                                {group.outcomes.map(outcomeDef => {
                                                    const meta = OUTCOME_MAP[outcomeDef.code];
                                                    const colors = OUTCOME_ICON_COLORS[outcomeDef.code] || { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' };
                                                    const isActive = outcome === outcomeDef.code;
                                                    return (
                                                        <button
                                                            key={outcomeDef.code}
                                                            type="button"
                                                            onClick={() => setOutcome(outcomeDef.code)}
                                                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${isActive
                                                                ? `${colors.bg} ${colors.border} ${colors.color} ring-2 ring-offset-1 ring-violet-300 shadow-sm`
                                                                : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            <span className="text-sm font-bold">{meta.label}</span>
                                                            {isActive && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Phone Status Update (required for phone-quality outcomes) */}
                    {requiresPhoneStatus && outcome && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                تحديث حالة الرقم <span className="text-red-500">*</span>
                            </label>
                            <div className="space-y-1.5">
                                {(Object.keys(PHONE_STATUS_LABELS) as Array<keyof typeof PHONE_STATUS_LABELS>).map(statusKey => (
                                    <label key={statusKey} className="flex items-center justify-between p-2.5 rounded-xl border border-gray-200 hover:bg-slate-50 cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="radio"
                                                name="phoneStatus"
                                                checked={phoneStatus === PHONE_STATUS_TO_CONTACT_ENTRY[statusKey]}
                                                onChange={() => setPhoneStatus(PHONE_STATUS_TO_CONTACT_ENTRY[statusKey])}
                                                className="w-4 h-4 text-violet-600"
                                            />
                                            <span className="font-bold text-sm text-slate-700">{PHONE_STATUS_LABELS[statusKey]}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            {!phoneStatus && (
                                <p className="text-xs text-amber-600 font-bold">يرجى اختيار حالة الرقم لإتمام التسجيل</p>
                            )}
                        </div>
                    )}

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <MessageSquare className="w-4 h-4 text-violet-500" />
                            ملاحظات {requiresNotes ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal">(اختياري)</span>}
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder={requiresNotes ? 'مطلوب — أدخل التفاصيل هنا...' : 'أي تفاصيل إضافية حول التواصل...'}
                            className={`w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:outline-none min-h-[80px] resize-none transition-all ${requiresNotes && !notes.trim() ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/20' : 'border-gray-200 focus:border-violet-500 focus:ring-violet-500/20'}`}
                        />
                        {requiresNotes && !notes.trim() && (
                            <p className="text-xs text-amber-600 font-bold">يرجى إدخال ملاحظات لهذه النتيجة</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">إلغاء</button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-violet-500/20 disabled:shadow-none transition-all"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        حفظ النتيجة
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
