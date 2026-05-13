import { useState } from 'react';
import { Plus, Phone, User, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';

interface Suggestion {
    id: number;
    name: string;
    phone?: string | null;
    notes?: string | null;
    status: string;
    created_at: string;
}

interface Props {
    taskId: number;
    suggestions: Suggestion[];
    onAdded: (suggestion: Suggestion) => void;
}

export default function DirectSuggestionForm({ taskId, suggestions, onAdded }: Props) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setError('الاسم مطلوب'); return; }
        setSaving(true);
        setError(null);
        try {
            const added = await api.fieldVisits.addDirectSuggestion(taskId, {
                name: name.trim(),
                phone: phone.trim() || undefined,
                notes: notes.trim() || undefined,
            });
            onAdded(added);
            setName('');
            setPhone('');
            setNotes('');
        } catch (err: any) {
            setError(err?.message ?? 'فشل في إضافة الاقتراح');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3">
            {/* Existing suggestions */}
            {suggestions.length > 0 && (
                <div className="space-y-1.5">
                    {suggestions.map(s => (
                        <div key={s.id}
                            className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                                {s.phone && (
                                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                        <Phone className="w-3 h-3" />
                                        <span dir="ltr">{s.phone}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add form */}
            <form onSubmit={handleAdd} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    إضافة اقتراح مباشر
                </p>
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <User className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="الاسم *"
                            className="w-full pr-8 pl-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                    </div>
                    <div className="w-36 relative">
                        <Phone className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="الهاتف"
                            className="w-full pr-8 pl-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            dir="ltr"
                        />
                    </div>
                </div>
                <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="ملاحظة (اختياري)"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button type="submit" disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 disabled:opacity-60 transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    {saving ? 'جاري الإضافة...' : 'إضافة اقتراح'}
                </button>
            </form>
        </div>
    );
}
