import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Phone, CheckCircle2, PhoneOff, PhoneMissed, X, Send,
    MessageSquare, PhoneForwarded, UserCheck, PhoneCall,
    MapPin, AlertTriangle, Calendar, Edit3
} from 'lucide-react';
import {
    TelemarketingOutcomeCode, OUTCOME_MAP, OUTCOMES_BY_GROUP,
    PHONE_STATUS_LABELS, PHONE_STATUS_TO_CONTACT_ENTRY,
    getOutcomeMeta, normaliseOutcomeCode,
} from '@golden-crm/shared';
import { TaskListItem, ContactStatus } from '../../lib/types';
import { getEntityContacts } from '../../lib/contactUtils';
import { useAuthStore } from '../../hooks/useAuthStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommunicationChannel =
    | 'cellular_call'
    | 'cellular_text'
    | 'whatsapp_call'
    | 'whatsapp_text';

export type AnsweredBy = 'customer' | 'spouse' | 'child';

export interface SaveExtras {
    answeredBy?: AnsweredBy;
    communicationChannel?: CommunicationChannel;
    status?: 'pending' | 'completed';
    actions?: { type: string; payload?: any }[];
}

interface OutcomeRecorderModalProps {
    isOpen: boolean;
    onClose: () => void;
    task?: TaskListItem | null;
    entityDetails: any;
    title?: string;
    /** Pre-selected contact — skips the contact picker when provided */
    preselectedContactId?: string;
    onSave: (
        contactId: string,
        outcome: TelemarketingOutcomeCode,
        notes: string,
        extras?: SaveExtras,
    ) => void;
}

// ── Free-call outcome layout ──────────────────────────────────────────────────

const FREE_CALL_GROUPS: {
    key: string;
    label: string;
    outcomes: TelemarketingOutcomeCode[];
    isReached: boolean;
}[] = [
    {
        key: 'not_reached',
        label: 'لم يتم التواصل',
        isReached: false,
        outcomes: [
            'no_answer',
            'busy',
            'auto_disconnected',
            'out_of_coverage',
            'wrong_number',
            'not_in_service',
        ],
    },
    {
        key: 'follow_up',
        label: 'تم التواصل — متابعة لاحقاً',
        isReached: true,
        outcomes: [
            'currently_busy',
            'other_company_callback',
            'seen_offer_callback',
        ],
    },
    {
        key: 'service_request',
        label: 'تم التواصل — طلب خدمة',
        isReached: true,
        outcomes: [
            'service_request',
            'company_customer_missing_phone',
        ],
    },
    {
        key: 'not_interested',
        label: 'تم التواصل — غير مهتم',
        isReached: true,
        outcomes: [
            'not_interested',
            'other_company_not_interested',
            'seen_offer_not_interested',
        ],
    },
    {
        key: 'data_update',
        label: 'تم التواصل — تعديل بيانات',
        isReached: true,
        outcomes: [
            'address_updated',
            'new_number',
        ],
    },
];

// ── Icons / colours ───────────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, React.ReactNode> = {
    not_reached: <PhoneMissed className="w-4 h-4" />,
    reached: <PhoneCall className="w-4 h-4" />,
    follow_up: <PhoneForwarded className="w-4 h-4" />,
    service_request: <UserCheck className="w-4 h-4" />,
    booked: <Calendar className="w-4 h-4" />,
    not_interested: <PhoneOff className="w-4 h-4" />,
    data_update: <Edit3 className="w-4 h-4" />,
};

const OUTCOME_ICON_COLORS: Record<string, { color: string; bg: string; border: string }> = {
    no_answer: { color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
    busy: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    out_of_coverage: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    not_in_service: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    wrong_number: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    auto_disconnected: { color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    currently_busy: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
    interrupted: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
    not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    other_company_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    seen_offer_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    address_updated: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
    new_number: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
    other_company_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    seen_offer_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    service_request: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    company_customer_missing_phone: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    booked_marketing_appointment: { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function methodToChannel(
    method: 'phone' | 'whatsapp',
    subtype: 'whatsapp_text' | 'whatsapp_voice',
): CommunicationChannel {
    if (method === 'phone') return 'cellular_call';
    return subtype === 'whatsapp_voice' ? 'whatsapp_call' : 'whatsapp_text';
}

function outcomeIsReached(code: TelemarketingOutcomeCode | null): boolean {
    if (!code) return false;
    const group = OUTCOME_MAP[code]?.group;
    return group !== 'not_reached';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutcomeRecorderModal({
    isOpen,
    onClose,
    task,
    entityDetails,
    title,
    preselectedContactId,
    onSave,
}: OutcomeRecorderModalProps) {
    const [method, setMethod] = useState<'phone' | 'whatsapp'>('phone');
    const [whatsappSubtype, setWhatsappSubtype] = useState<'whatsapp_text' | 'whatsapp_voice'>('whatsapp_text');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [outcome, setOutcome] = useState<TelemarketingOutcomeCode | null>(null);
    const [notes, setNotes] = useState('');
    const [answeredBy, setAnsweredBy] = useState<AnsweredBy | ''>('');
    const [expandedGroup, setExpandedGroup] = useState<string | null>('not_reached');
    const currentUser = useAuthStore((state) => state.user);

    const outcomeMeta = outcome ? OUTCOME_MAP[outcome] : null;
    const isFreeCall = !task;

    useEffect(() => {
        if (isOpen) {
            setMethod('phone');
            setWhatsappSubtype('whatsapp_text');
            setSelectedContactId(preselectedContactId ?? '');
            setOutcome(null);
            setNotes('');
            setAnsweredBy('');
            setExpandedGroup('not_reached');
        }
    }, [isOpen, task, preselectedContactId]);

    if (!isOpen || !entityDetails) return null;

    const contacts = getEntityContacts(entityDetails);
    const hasWhatsAppTarget = contacts.some(c => c.id === selectedContactId && c.hasWhatsApp);
    const isWhatsAppSelectable = method === 'whatsapp' ? hasWhatsAppTarget : true;

    const requiresNotes = outcomeMeta?.requiresNotes ?? false;
    const isReached = outcomeIsReached(outcome);

    // "من ردّ؟" shown when: method is phone/whatsapp_voice AND outcome is in a "reached" group
    const showAnsweredBy =
        isReached &&
        (method === 'phone' || (method === 'whatsapp' && whatsappSubtype === 'whatsapp_voice'));

    const isTextMessage = method === 'whatsapp' && whatsappSubtype === 'whatsapp_text';

    const canSave =
        !!selectedContactId &&
        !!outcome &&
        isWhatsAppSelectable &&
        (!requiresNotes || notes.trim().length > 0);

    const handleSave = () => {
        if (!canSave || !outcome) return;

        const communicationChannel = methodToChannel(method, whatsappSubtype);
        const status: 'pending' | 'completed' = isTextMessage ? 'pending' : 'completed';

        const extras: SaveExtras = {
            communicationChannel,
            status,
            answeredBy: answeredBy || undefined,
        };

        onSave(selectedContactId, outcome, notes, extras);
    };

    // ── Outcome groups to render ──────────────────────────────────────────────
    const groupsToRender = isFreeCall
        ? FREE_CALL_GROUPS
        : OUTCOMES_BY_GROUP.map(g => ({
              key: g.key,
              label: g.label,
              isReached: g.key !== 'not_reached',
              outcomes: g.outcomes.map(o => o.code),
          }));

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            dir="rtl"
        >
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
                            <h2 className="text-lg font-bold text-slate-800">{title || 'تسجيل نتيجة التواصل'}</h2>
                            {task?.name && <p className="text-xs text-slate-500">{task.name}</p>}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Communication method */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-700">
                            طريقة التواصل <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => setMethod('phone')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${method === 'phone'
                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-2 ring-indigo-200 shadow-sm'
                                    : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
                            >
                                <Phone className="w-5 h-5" />
                                <span className="text-sm font-bold">مكالمة هاتفية</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setMethod('whatsapp')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${method === 'whatsapp'
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-2 ring-emerald-200 shadow-sm'
                                    : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
                            >
                                <MessageSquare className="w-5 h-5" />
                                <span className="text-sm font-bold">واتساب</span>
                            </button>
                        </div>

                        {method === 'whatsapp' && (
                            <div className="mt-3 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 space-y-3">
                                <label className="text-xs font-bold text-emerald-800 block">نوع التواصل عبر واتساب:</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setWhatsappSubtype('whatsapp_text')}
                                        className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${whatsappSubtype === 'whatsapp_text'
                                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                                            : 'bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                                    >
                                        رسالة نصية
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWhatsappSubtype('whatsapp_voice')}
                                        className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${whatsappSubtype === 'whatsapp_voice'
                                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                                            : 'bg-white border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                                    >
                                        مكالمة صوتية
                                    </button>
                                </div>
                                <p className="text-[10px] text-emerald-600 font-bold mt-2 bg-white px-2 py-1 rounded border border-emerald-100 w-fit">
                                    الموظف: {currentUser?.name || 'غير معروف'}
                                </p>
                            </div>
                        )}

                        {isTextMessage && (
                            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                <p className="text-xs text-amber-700 font-bold">
                                    ستُسجَّل الرسالة كـ «منتظر رد» — يمكن تعديل النتيجة لاحقاً
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Contact selection — hidden when preselected */}
                    {!preselectedContactId && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-4 h-4 text-violet-500" />
                                الرقم المستخدم للتواصل <span className="text-red-500">*</span>
                            </label>
                            <select
                                value={selectedContactId}
                                onChange={(e) => setSelectedContactId(e.target.value)}
                                className={`w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all ${method === 'whatsapp' && selectedContactId && !hasWhatsAppTarget
                                    ? 'border-red-300 ring-2 ring-red-200 bg-red-50'
                                    : ''}`}
                            >
                                <option value="" disabled>-- اختر الرقم --</option>
                                {contacts.map(contact => (
                                    <option
                                        key={contact.id}
                                        value={contact.id}
                                        disabled={method === 'whatsapp' && !contact.hasWhatsApp}
                                    >
                                        {contact.label} - {contact.number}
                                        {contact.hasWhatsApp ? ' (واتساب)' : ''}
                                        {method === 'whatsapp' && !contact.hasWhatsApp ? ' - لا يدعم واتساب' : ''}
                                    </option>
                                ))}
                            </select>
                            {method === 'whatsapp' && selectedContactId && !hasWhatsAppTarget && (
                                <p className="text-xs text-red-600 font-bold mt-1">
                                    هذا الرقم لا يدعم واتساب. يرجى اختيار رقم آخر أو تغيير طريقة التواصل.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Outcome groups */}
                    <div
                        className="space-y-3"
                        style={{
                            opacity: (selectedContactId || preselectedContactId) && isWhatsAppSelectable ? 1 : 0.5,
                            pointerEvents: (selectedContactId || preselectedContactId) && isWhatsAppSelectable ? 'auto' : 'none',
                        }}
                    >
                        <label className="text-sm font-bold text-slate-700">
                            نتيجة التواصل <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-2">
                            {groupsToRender.map(group => {
                                const isExpanded = expandedGroup === group.key;
                                return (
                                    <div key={group.key} className="border border-gray-200 rounded-xl overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedGroup(isExpanded ? null : group.key)}
                                            className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-right"
                                        >
                                            <div className="flex items-center gap-2">
                                                {GROUP_ICONS[group.key] ?? <PhoneCall className="w-4 h-4" />}
                                                <span className="text-sm font-bold text-slate-700">{group.label}</span>
                                            </div>
                                            <svg
                                                className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>
                                        {isExpanded && (
                                            <div className="p-2 space-y-1.5">
                                                {group.outcomes.map(code => {
                                                    const meta = OUTCOME_MAP[code];
                                                    if (!meta) return null;
                                                    const colors = OUTCOME_ICON_COLORS[code] || {
                                                        color: 'text-slate-700',
                                                        bg: 'bg-slate-50',
                                                        border: 'border-slate-200',
                                                    };
                                                    const isActive = outcome === code;
                                                    return (
                                                        <button
                                                            key={code}
                                                            type="button"
                                                            onClick={() => setOutcome(code)}
                                                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${isActive
                                                                ? `${colors.bg} ${colors.border} ${colors.color} ring-2 ring-offset-1 ring-violet-300 shadow-sm`
                                                                : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
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

                    {/* من ردّ؟ — shown for reached calls (phone or whatsapp voice) */}
                    {showAnsweredBy && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">من ردّ؟</label>
                            <div className="flex items-center gap-3">
                                {(
                                    [
                                        { value: 'customer', label: 'الزبون شخصياً' },
                                        { value: 'spouse', label: 'الزوج/الزوجة' },
                                        { value: 'child', label: 'الولد/البنت' },
                                    ] as { value: AnsweredBy; label: string }[]
                                ).map(opt => (
                                    <label
                                        key={opt.value}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border cursor-pointer text-sm font-bold transition-all ${answeredBy === opt.value
                                            ? 'bg-violet-50 border-violet-300 text-violet-700 ring-1 ring-violet-200'
                                            : 'bg-white border-gray-200 text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        <input
                                            type="radio"
                                            name="answeredBy"
                                            value={opt.value}
                                            checked={answeredBy === opt.value}
                                            onChange={() => setAnsweredBy(opt.value)}
                                            className="w-3.5 h-3.5 text-violet-600"
                                        />
                                        {opt.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <MessageSquare className="w-4 h-4 text-violet-500" />
                            ملاحظات{' '}
                            {requiresNotes
                                ? <span className="text-red-500">*</span>
                                : <span className="text-slate-400 font-normal">(اختياري)</span>}
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder={requiresNotes ? 'مطلوب — أدخل التفاصيل هنا...' : 'أي تفاصيل إضافية حول التواصل...'}
                            className={`w-full bg-slate-50 border rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:outline-none min-h-[80px] resize-none transition-all ${requiresNotes && !notes.trim()
                                ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500/20'
                                : 'border-gray-200 focus:border-violet-500 focus:ring-violet-500/20'}`}
                        />
                        {requiresNotes && !notes.trim() && (
                            <p className="text-xs text-amber-600 font-bold">يرجى إدخال ملاحظات لهذه النتيجة</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!canSave}
                        className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-violet-500/20 disabled:shadow-none transition-all"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        {isTextMessage ? 'إرسال الرسالة' : 'حفظ النتيجة'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
