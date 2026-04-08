import { useState, useEffect } from 'react';
import { X, Calendar, DollarSign, CheckCircle, AlertCircle } from 'lucide-react';
import { useCollectionStore } from '../hooks/useCollectionStore';
import { Due } from '../lib/types';
import { motion, AnimatePresence } from 'framer-motion';

interface CollectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    due: (Due & { customerName: string; mobile: string }) | null;
}

type Outcome = 'Promise to Pay' | 'Refusal' | 'Partial Pay' | null;

export default function CollectionModal({ isOpen, onClose, due }: CollectionModalProps) {
    const { logCollection } = useCollectionStore();
    const [outcome, setOutcome] = useState<Outcome>(null);
    const [promiseDate, setPromiseDate] = useState('');
    const [partialAmount, setPartialAmount] = useState('');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (isOpen) {
            setOutcome(null);
            setPromiseDate('');
            setPartialAmount('');
            setNotes('');
        }
    }, [isOpen, due]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!due || !outcome) return;

        let updates: Parameters<typeof logCollection>[1] = {};

        if (outcome === 'Promise to Pay' && promiseDate) {
            updates.adjustedDate = promiseDate;
            updates.status = 'Pending'; // Remains pending until paid
        } else if (outcome === 'Partial Pay' && partialAmount) {
            const amount = parseFloat(partialAmount);
            if (!isNaN(amount)) {
                updates.remainingBalance = Math.max(0, due.remainingBalance - amount);
                updates.status = updates.remainingBalance === 0 ? 'Paid' : 'Partial';
            }
        } else if (outcome === 'Refusal') {
            // Maybe escalate? For now just log notes.
        }

        logCollection(due.id, updates);
        onClose();
    };

    if (!isOpen || !due) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
                >
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">تسجيل مكالمة تحصيل</h3>
                            <p className="text-sm text-slate-500 mt-1">{due.customerName} - {due.mobile}</p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        {/* Outcome Selection */}
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { id: 'Promise to Pay', label: 'وعد دفع', icon: Calendar },
                                { id: 'Partial Pay', label: 'دفع جزئي', icon: DollarSign },
                                { id: 'Refusal', label: 'رفض', icon: AlertCircle },
                            ].map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => setOutcome(opt.id as Outcome)}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${outcome === opt.id
                                        ? 'border-sky-600 bg-sky-50 text-sky-700'
                                        : 'border-gray-100 hover:border-sky-100 hover:bg-gray-50 text-slate-600'
                                        }`}
                                >
                                    <opt.icon className={`w-6 h-6 ${outcome === opt.id ? 'text-sky-600' : 'text-slate-400'}`} />
                                    <span className="text-xs font-bold">{opt.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Conditional Inputs */}
                        {outcome === 'Promise to Pay' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">تاريخ الوعد</label>
                                <input
                                    type="date"
                                    required
                                    value={promiseDate}
                                    onChange={(e) => setPromiseDate(e.target.value)}
                                    className="w-full p-3 rounded-xl border border-gray-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none text-right"
                                />
                            </div>
                        )}

                        {outcome === 'Partial Pay' && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">المبلغ المدفوع (ل.س)</label>
                                <input
                                    type="number"
                                    required
                                    placeholder="0"
                                    value={partialAmount}
                                    onChange={(e) => setPartialAmount(e.target.value)}
                                    className="w-full p-3 rounded-xl border border-gray-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none text-left ltr"
                                    dir="ltr"
                                />
                                <p className="text-xs text-slate-500 text-left">المتبقي: {due.remainingBalance.toLocaleString()}</p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">ملاحظات</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="w-full p-3 rounded-xl border border-gray-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none min-h-[80px]"
                                placeholder="تفاصيل المكالمة..."
                            />
                        </div>

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-slate-600 font-medium hover:bg-gray-50 transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                type="submit"
                                disabled={!outcome || (outcome === 'Promise to Pay' && !promiseDate) || (outcome === 'Partial Pay' && !partialAmount)}
                                className="flex-1 py-3 px-4 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-sky-200"
                            >
                                حفظ
                            </button>
                        </div>
                    </form>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
