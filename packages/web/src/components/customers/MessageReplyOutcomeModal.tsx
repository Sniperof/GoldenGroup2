import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, X, Send } from 'lucide-react';
import { TelemarketingOutcomeCode, OUTCOME_MAP } from '@golden-crm/shared';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSave: (outcome: TelemarketingOutcomeCode, notes: string) => void;
    logId: string;
}

export default function MessageReplyOutcomeModal({ isOpen, onClose, onSave }: Props) {
    const [outcome, setOutcome] = useState<TelemarketingOutcomeCode | null>(null);
    const [notes, setNotes] = useState('');
    const [step, setStep] = useState<'top' | 'not_reached' | 'reached'>('top');

    if (!isOpen) return null;

    const handleSave = () => {
        if (!outcome) return;
        onSave(outcome, notes);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-amber-50 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm">
                            <Send className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">تعديل نتيجة الرسالة</h2>
                            <p className="text-xs text-slate-500">تم الرد على الرسالة — سجّل النتيجة</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-5">
                    {/* Step 1: top level */}
                    {step === 'top' && (
                        <div className="space-y-3">
                            <label className="text-sm font-bold text-slate-700">نتيجة الرد <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setStep('not_reached')}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all text-sm font-bold"
                                >
                                    لم يتم التواصل
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStep('reached')}
                                    className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all text-sm font-bold"
                                >
                                    تم التواصل
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Step 2: not-reached details (text-message appropriate only) */}
                    {step === 'not_reached' && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">تفاصيل</label>
                            <p className="text-xs text-slate-400">نتائج لا تنطبق على الرسائل (مثل: الرقم مشغول) مخفية</p>
                            {(['out_of_coverage', 'wrong_number', 'not_in_service'] as TelemarketingOutcomeCode[]).map(code => (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => setOutcome(code)}
                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-2 transition-all text-right ${outcome === code
                                        ? 'bg-red-50 border-red-300 text-red-700 ring-2 ring-offset-1 ring-red-300 shadow-sm'
                                        : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
                                >
                                    <span className="text-sm font-bold">{OUTCOME_MAP[code].label}</span>
                                    {outcome === code && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setStep('top')}
                                className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600"
                            >
                                ← تغيير
                            </button>
                        </div>
                    )}

                    {/* Step 2: reached details */}
                    {step === 'reached' && (
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">تفاصيل</label>
                            {([
                                { label: 'متابعة لاحقاً', outcomes: ['currently_busy', 'other_company_callback', 'seen_offer_callback'] as TelemarketingOutcomeCode[] },
                                { label: 'طلب خدمة', outcomes: ['service_request'] as TelemarketingOutcomeCode[] },
                                { label: 'غير مهتم', outcomes: ['not_interested', 'other_company_not_interested', 'seen_offer_not_interested'] as TelemarketingOutcomeCode[] },
                                { label: 'تعديل بيانات', outcomes: ['address_updated', 'new_number'] as TelemarketingOutcomeCode[] },
                            ]).map(grp => (
                                <div key={grp.label} className="border border-gray-200 rounded-xl overflow-hidden">
                                    <div className="px-4 py-2 bg-slate-50 text-xs font-bold text-slate-500">{grp.label}</div>
                                    <div className="p-2 space-y-1">
                                        {grp.outcomes.map(code => (
                                            <button
                                                key={code}
                                                type="button"
                                                onClick={() => setOutcome(code)}
                                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-all text-right text-xs font-bold ${outcome === code
                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 ring-1 ring-emerald-200'
                                                    : 'bg-white border-gray-100 text-slate-600 hover:border-gray-200 hover:bg-gray-50'}`}
                                            >
                                                {OUTCOME_MAP[code].label}
                                                {outcome === code && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => setStep('top')}
                                className="w-full text-xs text-slate-400 font-bold py-2 hover:text-slate-600"
                            >
                                ← تغيير
                            </button>
                        </div>
                    )}

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-700">ملاحظات (اختياري)</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="تفاصيل إضافية..."
                            className="w-full bg-slate-50 border border-gray-200 rounded-xl px-4 py-3 text-sm placeholder:text-gray-400 focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none min-h-[80px] resize-none transition-all"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">
                        إلغاء
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!outcome}
                        className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-xl text-sm font-bold shadow-md shadow-amber-500/20 disabled:shadow-none transition-all"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                        حفظ النتيجة
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
