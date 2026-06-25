import { useState, useEffect } from 'react';
import {
    CheckCircle2, Send, PhoneMissed, PhoneCall,
    PhoneForwarded, UserCheck, PhoneOff, Edit3, Calendar, Layers,
} from 'lucide-react';
import { TelemarketingOutcomeCode, OUTCOME_MAP } from '@golden-crm/shared';
import { useSystemList } from '../../hooks/useSystemList';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Unused — kept for API compatibility with parent components */
    logId: string;
    /** canBook enables the "حجز موعد" tile */
    canBook?: boolean;
    onSave: (outcome: TelemarketingOutcomeCode, notes: string) => void;
}

export default function MessageReplyOutcomeModal({ isOpen, onClose, canBook = false, onSave }: Props) {
    const [topLevel, setTopLevel] = useState<'not_reached' | 'reached' | null>(null);
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [outcome, setOutcome] = useState<TelemarketingOutcomeCode | null>(null);
    const [notes, setNotes] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [rescheduleReason, setRescheduleReason] = useState('');
    const [followUpDate, setFollowUpDate] = useState('');
    const [followUpPriority, setFollowUpPriority] = useState<'high' | 'medium' | 'low' | ''>('');

    const { items: rejectionReasons } = useSystemList('telemarketing_rejection_reason');
    const { items: rescheduleReasons } = useSystemList('telemarketing_reschedule_reason');

    useEffect(() => {
        if (isOpen) {
            setTopLevel(null);
            setExpandedGroup(null);
            setOutcome(null);
            setNotes('');
            setRejectionReason('');
            setRescheduleReason('');
            setFollowUpDate('');
            setFollowUpPriority('');
        }
    }, [isOpen]);

    const isFollowUp = outcome === 'currently_busy';
    const canSave = !!outcome;

    const handleSave = () => {
        if (!outcome) return;
        const noteParts: string[] = [];
        if (rejectionReason) noteParts.push(`سبب: ${rejectionReason}`);
        if (rescheduleReason) noteParts.push(`سبب: ${rescheduleReason}`);
        if (followUpDate) noteParts.push(`موعد المتابعة: ${followUpDate}`);
        if (notes) noteParts.push(notes);
        onSave(outcome, noteParts.join(' — '));
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="md"
            closeOnBackdrop={false}
            title={
                <span className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                        <Send className="w-5 h-5 text-amber-600" />
                    </span>
                    تعديل نتيجة الرسالة
                </span>
            }
            subtitle="تم الرد على الرسالة — سجّل النتيجة"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>إلغاء</Button>
                    <Button variant="gold" onClick={handleSave} disabled={!canSave} icon={CheckCircle2}>
                        حفظ النتيجة
                    </Button>
                </>
            }
        >
                {/* Body */}
                <div className="p-5 space-y-4">

                    {/* Outcome selection */}
                    <div className="space-y-3">
                        <label className="text-sm font-bold text-slate-700">
                            نتيجة التواصل <span className="text-red-500">*</span>
                        </label>

                        {/* Step 1 */}
                        {!topLevel && (
                            <div className="grid grid-cols-2 gap-3">
                                <button type="button"
                                    onClick={() => { setTopLevel('not_reached'); setOutcome(null); setExpandedGroup(null); }}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all text-sm font-bold">
                                    <PhoneMissed className="w-5 h-5" />
                                    لم يتم التواصل
                                </button>
                                <button type="button"
                                    onClick={() => { setTopLevel('reached'); setOutcome(null); setExpandedGroup(null); }}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all text-sm font-bold">
                                    <PhoneCall className="w-5 h-5" />
                                    تم التواصل
                                </button>
                            </div>
                        )}

                        {/* Step 2a — not reached (text-appropriate only) */}
                        {topLevel === 'not_reached' && (
                            <div className="space-y-1.5">
                                {(['out_of_coverage', 'wrong_number', 'not_in_service'] as TelemarketingOutcomeCode[]).map(code => (
                                    <button key={code} type="button" onClick={() => setOutcome(code)}
                                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${outcome === code
                                            ? 'bg-red-50 border-red-300 text-red-700 ring-2 ring-offset-1 ring-red-200 shadow-sm'
                                            : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}>
                                        <span className="text-sm font-bold">{OUTCOME_MAP[code].label}</span>
                                        {outcome === code && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                                    </button>
                                ))}
                                <button type="button" onClick={() => { setTopLevel(null); setOutcome(null); }}
                                    className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600">
                                    ← تغيير
                                </button>
                            </div>
                        )}

                        {/* Step 2b — reached flat tiles */}
                        {topLevel === 'reached' && (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    {([
                                        { key: 'follow_up',       code: 'currently_busy' as TelemarketingOutcomeCode,           label: 'متابعة لاحقاً',  icon: PhoneForwarded, active: 'bg-violet-600  border-violet-600  text-white  ring-2 ring-violet-300',  idle: 'bg-violet-50  border-violet-200  text-violet-700  hover:bg-violet-100'  },
                                        { key: 'service_request', code: 'service_request'  as TelemarketingOutcomeCode,          label: 'طلب خدمة',       icon: UserCheck,      active: 'bg-indigo-600  border-indigo-600  text-white  ring-2 ring-indigo-300',  idle: 'bg-indigo-50  border-indigo-200  text-indigo-700  hover:bg-indigo-100'  },
                                        { key: 'not_interested',  code: 'not_interested'  as TelemarketingOutcomeCode,           label: 'غير مهتم',       icon: PhoneOff,       active: 'bg-red-600     border-red-600     text-white  ring-2 ring-red-300',     idle: 'bg-red-50     border-red-200     text-red-700     hover:bg-red-100'     },
                                        { key: 'data_update',     code: null,                                                    label: 'تعديل بيانات',   icon: Edit3,          active: 'bg-sky-600     border-sky-600     text-white  ring-2 ring-sky-300',     idle: 'bg-sky-50     border-sky-200     text-sky-700     hover:bg-sky-100'     },
                                        ...(canBook ? [{ key: 'booked', code: 'booked_marketing_appointment' as TelemarketingOutcomeCode, label: 'حجز موعد زيارة', icon: Calendar, active: 'bg-emerald-600 border-emerald-600 text-white  ring-2 ring-emerald-300', idle: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' }] : []),
                                    ] as { key: string; code: TelemarketingOutcomeCode | null; label: string; icon: any; active: string; idle: string }[]).map(({ key, code, label, icon: Icon, active, idle }) => (
                                        <button key={key} type="button"
                                            onClick={() => {
                                                setExpandedGroup(key);
                                                setRejectionReason('');
                                                if (code) setOutcome(code);
                                                else setOutcome(null);
                                            }}
                                            className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 transition-all text-sm font-bold ${expandedGroup === key ? active : idle}`}>
                                            <Icon className="w-4 h-4 shrink-0" />
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                {/* تعديل بيانات sub-options */}
                                {expandedGroup === 'data_update' && (
                                    <div className="grid grid-cols-2 gap-2 p-3 bg-sky-50 rounded-xl border border-sky-200">
                                        {(['address_updated', 'new_number'] as TelemarketingOutcomeCode[]).map(code => (
                                            <button key={code} type="button" onClick={() => setOutcome(code)}
                                                className={`flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${outcome === code
                                                    ? 'bg-sky-50 border-sky-400 text-sky-700 ring-2 ring-sky-200 shadow-sm'
                                                    : 'bg-white border-slate-100 text-slate-600 hover:border-slate-200 hover:bg-slate-50'}`}>
                                                <span className="text-sm font-bold">{OUTCOME_MAP[code].label}</span>
                                                {outcome === code && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <button type="button" onClick={() => { setTopLevel(null); setOutcome(null); setExpandedGroup(null); setRejectionReason(''); }}
                                    className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600">
                                    ← تغيير
                                </button>
                            </div>
                        )}
                    </div>

                    {/* سبب عدم الاهتمام */}
                    {outcome === 'not_interested' && rejectionReasons.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center justify-between">
                                <span>سبب عدم الاهتمام</span>
                                <span className="text-xs text-slate-400 font-normal">اختياري</span>
                            </label>
                            <div className="grid grid-cols-2 gap-1.5">
                                {rejectionReasons.map(r => (
                                    <button key={r} type="button"
                                        onClick={() => setRejectionReason(v => v === r ? '' : r)}
                                        className={`px-2.5 py-2 rounded-lg border text-xs font-bold text-right transition-all ${rejectionReason === r
                                            ? 'bg-slate-700 border-slate-700 text-white shadow-sm'
                                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* متابعة لاحقاً details */}
                    {isFollowUp && (
                        <div className="bg-violet-50 border border-violet-200 rounded-xl overflow-hidden">
                            <div className="px-4 py-2.5 bg-violet-100 border-b border-violet-200">
                                <p className="text-xs font-black text-violet-700">تفاصيل المتابعة</p>
                            </div>
                            <div className="px-4 py-3 space-y-3">
                                {/* Reschedule reason */}
                                {rescheduleReasons.length > 0 && (
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-violet-700">سبب المتابعة</label>
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {rescheduleReasons.map(r => (
                                                <button key={r} type="button"
                                                    onClick={() => setRescheduleReason(v => v === r ? '' : r)}
                                                    className={`px-2.5 py-2 rounded-lg border text-xs font-bold text-right transition-all ${rescheduleReason === r
                                                        ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                                                        : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}>
                                                    {r}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* Follow-up date */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-violet-700 flex items-center gap-1.5">
                                        <Calendar className="w-3.5 h-3.5" />
                                        الموعد المتوقع <span className="text-violet-400 font-normal">(اختياري)</span>
                                    </label>
                                    <input type="date" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)}
                                        min={new Date().toISOString().split('T')[0]}
                                        className="w-full bg-white border border-violet-200 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none"
                                        dir="ltr" />
                                </div>
                                {/* Priority */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-violet-700">أولوية المهمة</label>
                                    <div className="flex gap-2">
                                        {([
                                            { v: 'high',   label: 'عالية',   cls: 'bg-red-500 border-red-500 text-white' },
                                            { v: 'medium', label: 'متوسطة',  cls: 'bg-amber-500 border-amber-500 text-white' },
                                            { v: 'low',    label: 'منخفضة',  cls: 'bg-slate-500 border-slate-500 text-white' },
                                        ] as { v: 'high'|'medium'|'low'; label: string; cls: string }[]).map(opt => (
                                            <button key={opt.v} type="button"
                                                onClick={() => setFollowUpPriority(p => p === opt.v ? '' : opt.v)}
                                                className={`flex-1 py-2 rounded-lg border-2 text-xs font-bold transition-all ${followUpPriority === opt.v
                                                    ? opt.cls
                                                    : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}>
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-violet-500" />
                            ملاحظات <span className="text-slate-400 font-normal text-xs">(اختياري)</span>
                        </label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)}
                            placeholder="أي تفاصيل إضافية..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm placeholder:text-slate-400 focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none min-h-[72px] resize-none transition-all" />
                    </div>
                </div>
        </Modal>
    );
}
