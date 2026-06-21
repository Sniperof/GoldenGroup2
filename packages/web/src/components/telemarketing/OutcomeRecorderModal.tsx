import React, { useState, useEffect } from 'react';
import { useSystemList } from '../../hooks/useSystemList';
import { api } from '../../lib/api';
import { motion } from 'framer-motion';
import {
    Phone, CheckCircle2, PhoneOff, PhoneMissed, X, Send,
    MessageSquare, PhoneForwarded, UserCheck, PhoneCall,
    MapPin, AlertTriangle, Calendar, Edit3, Clock, Droplets, FileText,
} from 'lucide-react';
import IconButton from '../ui/IconButton';
import Select from '../ui/Select';
import {
    TelemarketingOutcomeCode, OUTCOME_MAP, OUTCOMES_BY_GROUP,
    PHONE_STATUS_LABELS, PHONE_STATUS_TO_CONTACT_ENTRY,
    getOutcomeMeta, normaliseOutcomeCode, WORKING_HOURS,
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
    /** Task type selected when outcome = service_request */
    serviceTaskType?: string;
    /** Inline appointment booking data (when outcome = booked_marketing_appointment) */
    visitDate?: string;
    visitTime?: string;
    waterSource?: string;
    technicianNotes?: string;
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
    /** Open tasks for this customer — used to determine if water source is required */
    customerOpenTasks?: Array<{ openTaskType: string | null }>;
    onSave: (
        contactId: string,
        outcome: TelemarketingOutcomeCode,
        notes: string,
        extras?: SaveExtras,
    ) => void | Promise<void>;
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
            'customer_requested_followup', // DEC-006 D39: replaces other_company_callback + seen_offer_callback
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
        outcomes: ['not_interested'],
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

// Reason lists are loaded from system_lists (categories: telemarketing_rejection_reason,
// telemarketing_reschedule_reason). Managed via Admin → إدارة القوائم.

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
    // Legacy (DEC-006 D39): kept so existing call_log rows render with consistent colors
    other_company_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    seen_offer_not_interested: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
    address_updated: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
    new_number: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
    customer_requested_followup: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    other_company_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    seen_offer_callback: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
    service_request: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    company_customer_missing_phone: { color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    booked_marketing_appointment: { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    message_sent: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
    customerOpenTasks = [],
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
    const [saving, setSaving] = useState(false);
    const currentUser = useAuthStore((state) => state.user);
    const { items: rejectionReasons } = useSystemList('telemarketing_rejection_reason');
    const { items: rescheduleReasons } = useSystemList('telemarketing_reschedule_reason');
    const [taskTypeOptions, setTaskTypeOptions] = useState<{ taskType: string; arabicLabel: string }[]>([]);
    const [serviceTaskType, setServiceTaskType] = useState('');
    // ── Inline appointment booking state ─────────────────────────────────────────
    const [visitDate, setVisitDate] = useState('');
    const [visitTime, setVisitTime] = useState('');
    const [apptWaterSource, setApptWaterSource] = useState('');
    const [apptNotes, setApptNotes] = useState('');

    useEffect(() => {
        api.telemarketing.taskTypeOptions()
            .then(data => setTaskTypeOptions(data))
            .catch(() => setTaskTypeOptions([]));
    }, []);

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
            setServiceTaskType('');
            setVisitDate(getTomorrow());
            setVisitTime('');
            setApptWaterSource((entityDetails as any)?.waterSource || '');
            setApptNotes('');
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
    const isFollowUpOutcome = !!outcome && ['currently_busy', 'customer_requested_followup', 'other_company_callback', 'seen_offer_callback'].includes(outcome);
    const isNotReachedOutcome = outcomeMeta?.group === 'not_reached';
    const showRejectScheduling = !isFreeCall && isNotReachedOutcome && !!outcome && !isTextMessage;
    const showFollowUpDate = isFollowUpOutcome && !isTextMessage;

    const requiresRejectionReason = showRejectScheduling && rejectScheduling;

    // Inline booking
    const isBookingOutcome = outcome === 'booked_marketing_appointment' && !isFreeCall;
    const hasDeviceDemo = customerOpenTasks.some(t => t.openTaskType === 'device_demo');
    const bookingValid = !isBookingOutcome || (
        !!visitDate && !!visitTime && (!hasDeviceDemo || !!apptWaterSource)
    );

    const canSave =
        !!(selectedContactId || preselectedContactId) &&
        (isTextMessage || !!outcome) &&
        isWhatsAppSelectable &&
        (!requiresNotes || notes.trim().length > 0) &&
        (!requiresPhoneStatus || !!selectedPhoneStatus) &&
        (!requiresRejectionReason || !!rejectionReason) &&
        bookingValid;

    const handleSave = async () => {
        if (!canSave || saving) return;
        setSaving(true);

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
            serviceTaskType: (finalOutcome === 'service_request' && serviceTaskType) ? serviceTaskType : undefined,
            visitDate:  isBookingOutcome ? visitDate  : undefined,
            visitTime:  isBookingOutcome ? visitTime  : undefined,
            waterSource: isBookingOutcome ? apptWaterSource : undefined,
            technicianNotes: isBookingOutcome && apptNotes ? apptNotes : undefined,
            // rejectionReason is shared by two flows:
            //   1. "رفض الجدولة" checkbox (not-reached outcomes)
            //   2. "غير مهتم" reason picker (reached, telemarketer only)
            rejectionReason: rejectionReason || undefined,
            followUpDueDate: showFollowUpDate && followUpDueDate ? followUpDueDate : undefined,
            followUpPriority: showFollowUpDate && followUpPriority ? followUpPriority as 'high' | 'medium' | 'low' : undefined,
            rescheduleReason: showFollowUpDate && rescheduleReason ? rescheduleReason : undefined,
        };

        try {
            await onSave(selectedContactId || preselectedContactId || '', finalOutcome, notes, extras);
        } finally {
            setSaving(false);
        }
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
                    <IconButton icon={X} label="إغلاق" onClick={onClose} />
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Communication method */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                            <span>قناة التواصل <span className="text-red-500">*</span></span>
                            {preselectedContactId && !relevantContact?.hasWhatsApp && (
                                <span className="text-[10px] text-slate-400 font-normal">واتساب غير متاح لهذا الرقم</span>
                            )}
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

                    {/* Contact selection */}
                    {preselectedContactId ? (
                        /* Contact was pre-selected by clicking a number — show it, don't let user change */
                        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${method === 'whatsapp' ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
                                {method === 'whatsapp' ? (
                                    <MessageSquare className="w-4 h-4 text-emerald-600" />
                                ) : (
                                    <Phone className="w-4 h-4 text-indigo-600" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-slate-400 mb-0.5">الرقم المختار للتواصل</p>
                                <p className="text-sm font-black text-slate-800" dir="ltr">{relevantContact?.number}</p>
                                <p className="text-xs text-slate-500">{relevantContact?.label}</p>
                            </div>
                            {relevantContact?.hasWhatsApp && (
                                <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold border border-green-200 shrink-0">واتساب ✓</span>
                            )}
                        </div>
                    ) : (
                        /* No preselection — show contact picker dropdown */
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Phone className="w-4 h-4 text-violet-500" />
                                الرقم المستخدم للتواصل <span className="text-red-500">*</span>
                            </label>
                            <Select
                                value={selectedContactId}
                                onChange={setSelectedContactId}
                                placeholder="-- اختر الرقم --"
                                ariaLabel="الرقم المستخدم"
                                className="w-full"
                                options={contacts.map(contact => ({
                                    value: contact.id,
                                    label: `${contact.label} - ${contact.number}${contact.hasWhatsApp ? ' (واتساب)' : ''}${method === 'whatsapp' && !contact.hasWhatsApp ? ' - لا يدعم واتساب' : ''}`,
                                    disabled: method === 'whatsapp' && !contact.hasWhatsApp,
                                }))}
                            />
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

                        {/* Step 2b: reached — flat main outcome buttons (no accordion) */}
                        {topLevel === 'reached' && (
                            <div className="space-y-3">
                                {/* 5 main outcome tiles */}
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { key: 'follow_up',       code: 'currently_busy' as TelemarketingOutcomeCode,           label: 'متابعة لاحقاً',   icon: PhoneForwarded, active: 'bg-violet-600  border-violet-600  text-white  ring-2 ring-violet-300',  idle: 'bg-violet-50  border-violet-200  text-violet-700  hover:bg-violet-100'  },
                                        { key: 'service_request', code: 'service_request' as TelemarketingOutcomeCode,           label: 'طلب خدمة',        icon: UserCheck,      active: 'bg-indigo-600  border-indigo-600  text-white  ring-2 ring-indigo-300',  idle: 'bg-indigo-50  border-indigo-200  text-indigo-700  hover:bg-indigo-100'  },
                                        { key: 'not_interested',  code: 'not_interested'  as TelemarketingOutcomeCode,           label: 'غير مهتم',        icon: PhoneOff,       active: 'bg-red-600     border-red-600     text-white  ring-2 ring-red-300',     idle: 'bg-red-50     border-red-200     text-red-700     hover:bg-red-100'     },
                                        { key: 'data_update',     code: null,                                                    label: 'تعديل بيانات',    icon: Edit3,          active: 'bg-sky-600     border-sky-600     text-white  ring-2 ring-sky-300',     idle: 'bg-sky-50     border-sky-200     text-sky-700     hover:bg-sky-100'     },
                                        ...(!isFreeCall && canBook
                                            ? [{ key: 'booked', code: 'booked_marketing_appointment' as TelemarketingOutcomeCode, label: 'حجز موعد زيارة', icon: Calendar,       active: 'bg-emerald-600 border-emerald-600 text-white  ring-2 ring-emerald-300', idle: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' }]
                                            : []),
                                    ] as { key: string; code: TelemarketingOutcomeCode | null; label: string; icon: any; active: string; idle: string }[]).map(({ key, code, label, icon: Icon, active, idle }) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => {
                                                setExpandedGroup(key);
                                                setRejectionReason('');
                                                if (code) setOutcome(code);
                                                else setOutcome(null); // data_update: sub-choice below
                                            }}
                                            className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 transition-all text-sm font-bold ${expandedGroup === key ? active : idle}`}
                                        >
                                            <Icon className="w-4 h-4 shrink-0" />
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                {/* تعديل بيانات sub-options (inline, no accordion) */}
                                {expandedGroup === 'data_update' && (
                                    <div className="grid grid-cols-2 gap-2 p-3 bg-sky-50 rounded-xl border border-sky-200">
                                        <OutcomeButton code="address_updated" isActive={outcome === 'address_updated'} onClick={() => setOutcome('address_updated')} />
                                        <OutcomeButton code="new_number"      isActive={outcome === 'new_number'}      onClick={() => setOutcome('new_number')} />
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={() => { setTopLevel(null); setOutcome(null); setExpandedGroup(null); setRejectionReason(''); }}
                                    className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600"
                                >
                                    ← تغيير
                                </button>
                            </div>
                        )}
                    </div>
                    )}

                    {/* نوع الخدمة المطلوبة — telemarketer only, when service_request is selected */}
                    {outcome === 'service_request' && !isFreeCall && !isTextMessage && taskTypeOptions.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                                <span>نوع الخدمة المطلوبة</span>
                                <span className="text-xs text-slate-400 font-normal">اختياري</span>
                            </label>
                            <Select
                                value={serviceTaskType}
                                onChange={setServiceTaskType}
                                placeholder="— اختر نوع الخدمة —"
                                ariaLabel="نوع الخدمة المطلوبة"
                                className="w-full"
                                options={taskTypeOptions.map(t => ({ value: t.taskType, label: t.arabicLabel }))}
                            />
                        </div>
                    )}

                    {/* ── تفاصيل الموعد — inline booking (expands when حجز موعد is selected) ── */}
                    {isBookingOutcome && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl overflow-hidden">
                            <div className="px-4 py-3 bg-emerald-100 border-b border-emerald-200 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-emerald-700" />
                                <p className="text-sm font-black text-emerald-800">تفاصيل الموعد</p>
                            </div>
                            <div className="px-4 py-4 space-y-4">
                                {/* Date + Time row */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            تاريخ الزيارة <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="date"
                                            value={visitDate}
                                            onChange={e => setVisitDate(e.target.value)}
                                            min={getToday()}
                                            className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none font-mono"
                                            dir="ltr"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            وقت الزيارة <span className="text-red-500">*</span>
                                        </label>
                                        <input
                                            type="time"
                                            value={visitTime}
                                            onChange={e => setVisitTime(e.target.value)}
                                            min={`${String(WORKING_HOURS.start).padStart(2,'0')}:00`}
                                            max={`${String(WORKING_HOURS.end).padStart(2,'0')}:00`}
                                            className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none font-mono"
                                            dir="ltr"
                                        />
                                    </div>
                                </div>

                                {/* Water source — only for device_demo tasks */}
                                {hasDeviceDemo && (
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                                            <Droplets className="w-3.5 h-3.5" />
                                            مصدر المياه <span className="text-red-500">*</span>
                                        </label>
                                        <Select
                                            value={apptWaterSource}
                                            onChange={setApptWaterSource}
                                            placeholder="— اختر مصدر المياه —"
                                            ariaLabel="مصدر المياه"
                                            className="w-full"
                                            options={['الاسالة الحكومية','شراء قناني معبأة (RO)','ماء بئر / جوفي','تناكر / حوضيات','غير معروف'].map(o => ({ value: o, label: o }))}
                                        />
                                    </div>
                                )}

                                {/* Technician notes */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-emerald-800 flex items-center gap-1">
                                        <FileText className="w-3.5 h-3.5" />
                                        ملاحظات للفني
                                        <span className="text-emerald-500 font-normal">(اختياري)</span>
                                    </label>
                                    <textarea
                                        value={apptNotes}
                                        onChange={e => setApptNotes(e.target.value)}
                                        placeholder="أي تعليمات خاصة للفريق الميداني..."
                                        rows={2}
                                        className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none resize-none"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* سبب عدم الاهتمام — telemarketer only, when not_interested is selected */}
                    {outcome === 'not_interested' && !isFreeCall && !isTextMessage && rejectionReasons.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                                <span>سبب عدم الاهتمام</span>
                                <span className="text-xs text-slate-400 font-normal">اختياري</span>
                            </label>
                            <div className="grid grid-cols-2 gap-1.5">
                                {rejectionReasons.map(r => (
                                    <button
                                        key={r}
                                        type="button"
                                        onClick={() => setRejectionReason(v => v === r ? '' : r)}
                                        className={`px-2.5 py-2 rounded-lg border text-xs font-bold text-right transition-all ${rejectionReason === r
                                            ? 'bg-slate-700 border-slate-700 text-white shadow-sm'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </div>
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
                                        {rejectionReasons.map(r => (
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
                                        {rescheduleReasons.map(r => (
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
                                        الموعد المتوقع <span className="text-violet-400 font-normal">(اختياري)</span>
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
                        disabled={!canSave || saving}
                        className={`flex items-center gap-2 px-6 py-2.5 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md disabled:shadow-none transition-all ${
                            isBookingOutcome
                                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                                : 'bg-violet-600 hover:bg-violet-700 shadow-violet-500/20'
                        }`}
                    >
                        {saving
                            ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            : <CheckCircle2 className="w-4 h-4" />}
                        {isTextMessage ? 'إرسال الرسالة'
                            : isBookingOutcome ? 'حجز الموعد وحفظ النتيجة'
                            : 'حفظ النتيجة'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
