import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Phone, CheckCircle2, PhoneOff, PhoneMissed, X, Send,
    MessageSquare, PhoneForwarded, UserCheck, PhoneCall,
    MapPin, AlertTriangle, Calendar, Edit3, ChevronDown,
} from 'lucide-react';
import {
    TelemarketingOutcomeCode, OUTCOME_MAP, OUTCOMES_BY_GROUP,
    PHONE_STATUS_LABELS, PHONE_STATUS_TO_CONTACT_ENTRY,
    getOutcomeMeta, normaliseOutcomeCode,
} from '@golden-crm/shared';
import type { PhoneStatusUpdate } from '@golden-crm/shared';
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
    callDateTime?: string;
    /** Phone status to apply to the selected contact (for not_reached outcomes that require it) */
    phoneStatusUpdate?: Exclude<PhoneStatusUpdate, 'none'> | null;
    /** Telemarketer: reject scheduling — returns task to open/pending, marks contact as rejected */
    rejectScheduling?: boolean;
    /** Reason label for rejection (display + log) */
    rejectionReason?: string;
    /** Follow-up due date for follow-up outcomes (currently_busy etc.) */
    followUpDueDate?: string;
    /** Task priority to apply for follow-up outcomes */
    followUpPriority?: 'high' | 'medium' | 'low';
    /** Reason label for follow-up/reschedule */
    rescheduleReason?: string;
}

interface OutcomeRecorderModalProps {
    isOpen: boolean;
    onClose: () => void;
    task?: TaskListItem | null;
    entityDetails: any;
    title?: string;
    /** Pre-selected contact — skips the contact picker when provided */
    preselectedContactId?: string;
    /** Whether the current user has telemarketing.appointments.book permission.
     *  Only relevant for non-free-call (task list) mode; ignored for free calls. */
    canBook?: boolean;
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
        label: 'متابعة لاحقاً',
        isReached: true,
        outcomes: [
            'currently_busy',
            'other_company_callback',
            'seen_offer_callback',
        ],
    },
    {
        key: 'service_request',
        label: 'طلب خدمة',
        isReached: true,
        outcomes: [
            'service_request',
        ],
    },
    {
        key: 'not_interested',
        label: 'غير مهتم',
        isReached: true,
        outcomes: [
            'not_interested',
            'other_company_not_interested',
            'seen_offer_not_interested',
        ],
    },
    {
        key: 'data_update',
        label: 'تعديل بيانات',
        isReached: true,
        outcomes: [
            'address_updated',
            'new_number',
        ],
    },
];

// ── Static reason lists (match DB seeds in migration 098) ─────────────────────

const REJECTION_REASONS = [
    'تجاوز عدد محاولات الاتصال',
    'الرقم خاطئ أو غير صالح',
    'طلب عدم الاتصال به',
    'غير مهتم نهائياً',
    'خارج نطاق الخدمة',
    'أخرى',
];

const RESCHEDULE_REASONS = [
    'الزبون مشغول حالياً',
    'طلب المتابعة لاحقاً',
    'لديه جهاز من شركة أخرى',
    'اطّلع على العرض سابقاً',
    'أخرى',
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
    message_sent: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowLocal(): string {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function methodToChannel(
    method: 'cellular' | 'whatsapp',
    cellularSubtype: 'cellular_call' | 'cellular_text',
    whatsappSubtype: 'whatsapp_text' | 'whatsapp_voice',
): CommunicationChannel {
    if (method === 'cellular') return cellularSubtype;
    return whatsappSubtype === 'whatsapp_voice' ? 'whatsapp_call' : 'whatsapp_text';
}

function outcomeIsReached(code: TelemarketingOutcomeCode | null): boolean {
    if (!code) return false;
    const group = OUTCOME_MAP[code]?.group;
    return group !== 'not_reached';
}

// ── Outcome button ────────────────────────────────────────────────────────────

function OutcomeButton({
    code,
    isActive,
    onClick,
}: {
    code: TelemarketingOutcomeCode;
    isActive: boolean;
    onClick: () => void;
}) {
    const meta = OUTCOME_MAP[code];
    if (!meta) return null;
    const colors = OUTCOME_ICON_COLORS[code] || { color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' };
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${isActive
                ? `${colors.bg} ${colors.border} ${colors.color} ring-2 ring-offset-1 ring-violet-300 shadow-sm`
                : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
        >
            <span className="text-sm font-bold">{meta.label}</span>
            {isActive && <CheckCircle2 className="w-4 h-4 shrink-0" />}
        </button>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OutcomeRecorderModal({
    isOpen,
    onClose,
    task,
    entityDetails,
    title,
    preselectedContactId,
    canBook = false,
    onSave,
}: OutcomeRecorderModalProps) {
    const [method, setMethod] = useState<'cellular' | 'whatsapp'>('cellular');
    const [cellularSubtype, setCellularSubtype] = useState<'cellular_call' | 'cellular_text'>('cellular_call');
    const [whatsappSubtype, setWhatsappSubtype] = useState<'whatsapp_text' | 'whatsapp_voice'>('whatsapp_text');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [outcome, setOutcome] = useState<TelemarketingOutcomeCode | null>(null);
    const [notes, setNotes] = useState('');
    const [answeredBy, setAnsweredBy] = useState<AnsweredBy | ''>('');
    const [topLevel, setTopLevel] = useState<'not_reached' | 'reached' | null>(null);
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [callDateTime, setCallDateTime] = useState<string>(nowLocal);
    const [selectedPhoneStatus, setSelectedPhoneStatus] = useState<Exclude<PhoneStatusUpdate, 'none'> | ''>('');
    const [rejectScheduling, setRejectScheduling] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [followUpDueDate, setFollowUpDueDate] = useState('');
    const [followUpPriority, setFollowUpPriority] = useState<'high' | 'medium' | 'low' | ''>('');
    const [rescheduleReason, setRescheduleReason] = useState('');
    const currentUser = useAuthStore((state) => state.user);

    const outcomeMeta = outcome ? OUTCOME_MAP[outcome] : null;
    const isFreeCall = !task;

    useEffect(() => {
        if (isOpen) {
            setMethod('cellular');
            setCellularSubtype('cellular_call');
            setWhatsappSubtype('whatsapp_text');
            setSelectedContactId(preselectedContactId ?? '');
            setOutcome(null);
            setNotes('');
            setAnsweredBy('');
            setTopLevel(null);
            setExpandedGroup(null);
            setCallDateTime(nowLocal());
            setSelectedPhoneStatus('');
            setRejectScheduling(false);
            setRejectionReason('');
            setFollowUpDueDate('');
            setFollowUpPriority('');
            setRescheduleReason('');
        }
    }, [isOpen, task, preselectedContactId]);

    // Auto-populate default phone status when outcome changes
    useEffect(() => {
        if (outcome) {
            const meta = OUTCOME_MAP[outcome];
            if (meta?.requiresPhoneStatusUpdate && meta.defaultPhoneStatus) {
                setSelectedPhoneStatus(meta.defaultPhoneStatus);
            } else {
                setSelectedPhoneStatus('');
            }
        } else {
            setSelectedPhoneStatus('');
        }
    }, [outcome]);

    if (!isOpen || !entityDetails) return null;

    const contacts = getEntityContacts(entityDetails);
    const preselectedContact = contacts.find(c => c.id === preselectedContactId);
    const selectedContact = contacts.find(c => c.id === selectedContactId);
    const relevantContact = preselectedContact || selectedContact;
    const hasWhatsAppTarget = relevantContact?.hasWhatsApp === true;
    const showWhatsAppOption = !relevantContact || hasWhatsAppTarget;

    // Auto-switch to cellular if whatsapp selected but contact doesn't support it
    if (method === 'whatsapp' && relevantContact && !hasWhatsAppTarget) {
        setMethod('cellular');
    }

    const isWhatsAppSelectable = method === 'whatsapp' ? hasWhatsAppTarget : true;

    const requiresNotes = outcomeMeta?.requiresNotes ?? false;
    const isReached = outcomeIsReached(outcome);

    // "من ردّ؟" shown when: method is cellular_call or whatsapp_voice AND outcome is in a "reached" group
    const showAnsweredBy =
        isReached &&
        ((method === 'cellular' && cellularSubtype === 'cellular_call') || (method === 'whatsapp' && whatsappSubtype === 'whatsapp_voice'));

    const isTextMessage =
        (method === 'cellular' && cellularSubtype === 'cellular_text') ||
        (method === 'whatsapp' && whatsappSubtype === 'whatsapp_text');

    const requiresPhoneStatus = !isTextMessage && (outcomeMeta?.requiresPhoneStatusUpdate ?? false);
    const isFollowUpOutcome = !!outcome && ['currently_busy', 'other_company_callback', 'seen_offer_callback'].includes(outcome);
    const isNotReachedOutcome = outcomeMeta?.group === 'not_reached';
    const showRejectScheduling = !isFreeCall && isNotReachedOutcome && !!outcome && !isTextMessage;
    const showFollowUpDate = isFollowUpOutcome && !isTextMessage;

    const requiresRejectionReason = showRejectScheduling && rejectScheduling;

    const canSave =
        !!selectedContactId &&
        (isTextMessage || !!outcome) &&
        isWhatsAppSelectable &&
        (!requiresNotes || notes.trim().length > 0) &&
        (!requiresPhoneStatus || !!selectedPhoneStatus) &&
        (!requiresRejectionReason || !!rejectionReason);

    const handleSave = () => {
        if (!canSave) return;

        const communicationChannel = methodToChannel(method, cellularSubtype, whatsappSubtype);
        const status: 'pending' | 'completed' = isTextMessage ? 'pending' : 'completed';

        // For text messages, auto-set outcome to message_sent
        const finalOutcome = isTextMessage ? 'message_sent' : outcome!;

        const extras: SaveExtras = {
            communicationChannel,
            status,
            answeredBy: answeredBy || undefined,
            callDateTime,
            phoneStatusUpdate: (outcomeMeta?.requiresPhoneStatusUpdate && selectedPhoneStatus)
                ? selectedPhoneStatus as Exclude<PhoneStatusUpdate, 'none'>
                : null,
            rejectScheduling: showRejectScheduling ? rejectScheduling : undefined,
            rejectionReason: (showRejectScheduling && rejectScheduling && rejectionReason) ? rejectionReason : undefined,
            followUpDueDate: showFollowUpDate && followUpDueDate ? followUpDueDate : undefined,
            followUpPriority: showFollowUpDate && followUpPriority ? followUpPriority as 'high' | 'medium' | 'low' : undefined,
            rescheduleReason: showFollowUpDate && rescheduleReason ? rescheduleReason : undefined,
        };

        onSave(selectedContactId, finalOutcome, notes, extras);
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
                            قناة التواصل <span className="text-red-500">*</span>
                        </label>
                        <div className={`grid gap-3 ${showWhatsAppOption ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <button
                                type="button"
                                onClick={() => setMethod('cellular')}
                                className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${method === 'cellular'
                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 ring-2 ring-indigo-200 shadow-sm'
                                    : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
                            >
                                <Phone className="w-5 h-5" />
                                <span className="text-sm font-bold">شبكة</span>
                            </button>
                            {showWhatsAppOption && (
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
                            )}
                        </div>

                        {method === 'cellular' && (
                            <div className="mt-3 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3">
                                <label className="text-xs font-bold text-indigo-800 block">نوع التواصل عبر الشبكة:</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setCellularSubtype('cellular_call')}
                                        className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${cellularSubtype === 'cellular_call'
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                            : 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
                                    >
                                        مكالمة
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCellularSubtype('cellular_text')}
                                        className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all text-xs font-bold ${cellularSubtype === 'cellular_text'
                                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                            : 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}
                                    >
                                        رسالة
                                    </button>
                                </div>
                                <p className="text-[10px] text-indigo-600 font-bold mt-2 bg-white px-2 py-1 rounded border border-indigo-100 w-fit">
                                    الموظف: {currentUser?.name || 'غير معروف'}
                                </p>
                            </div>
                        )}

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
                                    ستُسجّل الرسالة كـ «منتظر رد» — يمكن تعديل النتيجة لاحقاً
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

                    {/* Date/time */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-violet-500" />
                            تاريخ/وقت التواصل
                        </label>
                        <input
                            type="datetime-local"
                            value={callDateTime}
                            onChange={e => setCallDateTime(e.target.value)}
                            className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all"
                        />
                    </div>

                    {/* Outcome selection — two level (hidden for text messages) */}
                    {!isTextMessage && (
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

                        {/* Step 1: top-level choice */}
                        {!topLevel && (
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setTopLevel('not_reached'); setOutcome(null); setExpandedGroup(null); }}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all text-sm font-bold"
                                >
                                    <PhoneMissed className="w-5 h-5" />
                                    لم يتم التواصل
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setTopLevel('reached'); setOutcome(null); setExpandedGroup(null); }}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all text-sm font-bold"
                                >
                                    <PhoneCall className="w-5 h-5" />
                                    تم التواصل
                                </button>
                            </div>
                        )}

                        {/* Step 2a: not-reached outcomes */}
                        {topLevel === 'not_reached' && (
                            <div className="space-y-1.5">
                                {(['no_answer','busy','auto_disconnected','out_of_coverage','wrong_number','not_in_service'] as TelemarketingOutcomeCode[]).map(code => (
                                    <OutcomeButton key={code} code={code} isActive={outcome===code} onClick={() => setOutcome(code)} />
                                ))}
                                <button
                                    type="button"
                                    onClick={() => { setTopLevel(null); setOutcome(null); }}
                                    className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600"
                                >
                                    ← تغيير
                                </button>
                            </div>
                        )}

                        {/* Step 2b: reached sub-groups */}
                        {topLevel === 'reached' && (
                            <div className="space-y-2">
                                {([
                                    { key: 'follow_up', label: 'متابعة لاحقاً', outcomes: ['currently_busy','other_company_callback','seen_offer_callback'] as TelemarketingOutcomeCode[] },
                                    { key: 'service_request', label: 'طلب خدمة', outcomes: ['service_request'] as TelemarketingOutcomeCode[] },
                                    { key: 'not_interested', label: 'غير مهتم', outcomes: ['not_interested','other_company_not_interested','seen_offer_not_interested'] as TelemarketingOutcomeCode[] },
                                    { key: 'data_update', label: 'تعديل بيانات', outcomes: ['address_updated','new_number'] as TelemarketingOutcomeCode[] },
                                    // Booking group: only shown when user has telemarketing.appointments.book permission
                                    ...(!isFreeCall && canBook ? [{ key: 'booked', label: 'حجز موعد زيارة', outcomes: ['booked_marketing_appointment'] as TelemarketingOutcomeCode[] }] : []),
                                ] as { key: string; label: string; outcomes: TelemarketingOutcomeCode[] }[]).map(group => {
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
                                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                            </button>
                                            {isExpanded && (
                                                <div className="p-2 space-y-1.5">
                                                    {group.outcomes.map(code => (
                                                        <OutcomeButton key={code} code={code} isActive={outcome===code} onClick={() => setOutcome(code)} />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => { setTopLevel(null); setOutcome(null); setExpandedGroup(null); }}
                                    className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600"
                                >
                                    ← تغيير
                                </button>
                            </div>
                        )}
                    </div>
                    )}

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

                    {/* Phone status — shown for not_reached outcomes that require it */}
                    {requiresPhoneStatus && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-4 h-4 text-red-500" />
                                حالة الرقم <span className="text-red-500">*</span>
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                                {(Object.entries(PHONE_STATUS_LABELS) as [Exclude<PhoneStatusUpdate, 'none'>, string][]).map(([status, label]) => (
                                    <button
                                        key={status}
                                        type="button"
                                        onClick={() => setSelectedPhoneStatus(status)}
                                        className={`px-3 py-2 rounded-lg border-2 text-xs font-bold transition-all text-right ${selectedPhoneStatus === status
                                            ? 'bg-red-50 border-red-400 text-red-700 ring-2 ring-red-200 shadow-sm'
                                            : 'bg-white border-gray-200 text-slate-600 hover:border-gray-300 hover:bg-gray-50'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {!selectedPhoneStatus && (
                                <p className="text-xs text-red-600 font-bold">يرجى تحديد حالة الرقم قبل الحفظ</p>
                            )}
                        </div>
                    )}

                    {/* ── رفض الجدولة — telemarketer only, not-reached outcomes ── */}
                    {showRejectScheduling && (
                        <div className="rounded-xl border-2 overflow-hidden transition-all border-red-300">
                            <div
                                onClick={() => { setRejectScheduling(v => !v); if (rejectScheduling) setRejectionReason(''); }}
                                className={`cursor-pointer flex items-center gap-3 px-4 py-3 transition-all ${rejectScheduling ? 'bg-red-600' : 'bg-red-50 hover:bg-red-100'}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={rejectScheduling}
                                    onChange={() => {}}
                                    className="w-4 h-4 accent-white shrink-0 pointer-events-none"
                                />
                                <div>
                                    <p className={`text-sm font-black ${rejectScheduling ? 'text-white' : 'text-red-700'}`}>
                                        رفض الجدولة وإغلاق ملف الاتصال
                                    </p>
                                    <p className={`text-xs mt-0.5 ${rejectScheduling ? 'text-red-100' : 'text-red-400'}`}>
                                        يعيد المهمة لحالة الانتظار ويمنع إعادة جدولة هذا الاتصال
                                    </p>
                                </div>
                            </div>
                            {rejectScheduling && (
                                <div className="bg-red-50 px-4 py-3 border-t border-red-200 space-y-2">
                                    <label className="text-xs font-bold text-red-700">سبب الرفض <span className="text-red-500">*</span></label>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {REJECTION_REASONS.map(r => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => setRejectionReason(r)}
                                                className={`px-2.5 py-2 rounded-lg border text-xs font-bold text-right transition-all ${rejectionReason === r
                                                    ? 'bg-red-600 border-red-600 text-white shadow-sm'
                                                    : 'bg-white border-red-200 text-red-700 hover:bg-red-50'}`}
                                            >
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                    {!rejectionReason && (
                                        <p className="text-xs text-red-500 font-bold">يرجى تحديد سبب الرفض</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── متابعة لاحقاً — follow-up outcomes ── */}
                    {showFollowUpDate && (
                        <div className="bg-violet-50 border border-violet-200 rounded-xl overflow-hidden">
                            <div className="px-4 py-2.5 bg-violet-100 border-b border-violet-200">
                                <p className="text-xs font-black text-violet-700">تفاصيل المتابعة</p>
                            </div>
                            <div className="px-4 py-3 space-y-3">
                                {/* Reschedule reason */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-violet-700">سبب المتابعة</label>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {RESCHEDULE_REASONS.map(r => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => setRescheduleReason(r)}
                                                className={`px-2.5 py-2 rounded-lg border text-xs font-bold text-right transition-all ${rescheduleReason === r
                                                    ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                                                    : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}
                                            >
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {/* Follow-up date */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-violet-700 flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5" />
                                        تاريخ المتابعة <span className="text-violet-400 font-normal">(اختياري)</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={followUpDueDate}
                                        onChange={e => setFollowUpDueDate(e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                        className="w-full bg-white border border-violet-200 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                                        dir="ltr"
                                    />
                                </div>
                                {/* Task priority */}
                                {!isFreeCall && (
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-violet-700">أولوية المهمة</label>
                                        <div className="flex gap-2">
                                            {([
                                                { v: 'high',   label: 'عالية',    cls: 'bg-red-500 border-red-500 text-white' },
                                                { v: 'medium', label: 'متوسطة',   cls: 'bg-amber-500 border-amber-500 text-white' },
                                                { v: 'low',    label: 'منخفضة',   cls: 'bg-slate-500 border-slate-500 text-white' },
                                            ] as { v: 'high'|'medium'|'low'; label: string; cls: string }[]).map(opt => (
                                                <button
                                                    key={opt.v}
                                                    type="button"
                                                    onClick={() => setFollowUpPriority(p => p === opt.v ? '' : opt.v)}
                                                    className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold transition-all ${followUpPriority === opt.v
                                                        ? opt.cls
                                                        : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Service request prompt ── */}
                    {outcome === 'service_request' && !isTextMessage && (
                        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5 text-xs text-indigo-700 font-bold flex items-start gap-2">
                            <span className="text-indigo-400 shrink-0 mt-0.5">ℹ</span>
                            <span>وصف نوع الخدمة أو الصيانة المطلوبة في حقل الملاحظات لتسهيل المتابعة</span>
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
