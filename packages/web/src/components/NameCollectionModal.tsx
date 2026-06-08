import { useState } from 'react';
import { X, Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

interface Props {
    nameColl: {
        id: number;
        proposed_count: number;
        actual_count: number;
        status: string;
        notes?: string | null;
    };
    onClose: () => void;
    onSaved: (updated: any) => void;
}

export default function NameCollectionModal({ nameColl, onClose, onSaved }: Props) {
    const [actualCount, setActualCount] = useState(String(nameColl.actual_count ?? 0));
    const [notes, setNotes] = useState(nameColl.notes ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const count = Number(actualCount);
        if (!Number.isInteger(count) || count < 0) {
            setError('يجب إدخال عدد صحيح ≥ 0');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const updated = await api.fieldVisits.recordNames(nameColl.id, {
                actual_count: count,
                notes: notes.trim() || undefined,
            });
            onSaved(updated);
            onClose();
        } catch (err: any) {
            setError(err?.message ?? 'فشل في تسجيل الأسماء');
        } finally {
            setSaving(false);
        }
    };

    const count = Number(actualCount);
    const isComplete = Number.isInteger(count) && count >= nameColl.proposed_count;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                        <Users className="w-5 h-5 text-indigo-600" />
                        <h2 className="text-base font-bold text-slate-800">تسجيل الأسماء الفعلية</h2>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-slate-500">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Proposed count (read-only) */}
                    <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
                        <span className="text-sm text-slate-600">العدد المقترح</span>
                        <span className="text-xl font-black text-slate-800">{nameColl.proposed_count}</span>
                    </div>

                    {/* Actual count input */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">العدد الفعلي المجمَّع</label>
                        <input
                            type="number"
                            min="0"
                            value={actualCount}
                            onChange={e => setActualCount(e.target.value)}
                            className="w-full text-center text-2xl font-black border border-gray-300 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {/* Status preview */}
                    {actualCount !== '' && !isNaN(Number(actualCount)) && (
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
                            isComplete
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : count > 0
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-slate-50 text-slate-500 border border-slate-200'
                        }`}>
                            {isComplete ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            <span>{isComplete ? 'مكتمل — العدد المجمَّع يساوي أو يتجاوز المقترح' : count > 0 ? 'جزئي — العدد المجمَّع أقل من المقترح' : 'معلّق'}</span>
                        </div>
                    )}

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">ملاحظات (اختياري)</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={2}
                            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                            placeholder="أي ملاحظات حول عملية التوصيل..."
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">{error}</div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-slate-600 text-sm font-semibold hover:bg-gray-50 transition-colors">
                            إلغاء
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 disabled:opacity-60 transition-colors">
                            {saving ? 'جاري الحفظ...' : 'حفظ'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
