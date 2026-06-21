import { useState } from 'react';
import { Plus, Phone, User, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import Button from './ui/Button';
import Input from './ui/Input';

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
                    <div className="flex-1">
                        <Input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="الاسم *"
                            leading={<User className="w-3.5 h-3.5" />}
                            inputSize="sm"
                        />
                    </div>
                    <div className="w-36">
                        <Input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="الهاتف"
                            leading={<Phone className="w-3.5 h-3.5" />}
                            dir="ltr"
                            inputSize="sm"
                        />
                    </div>
                </div>
                <Input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="ملاحظة (اختياري)"
                    inputSize="sm"
                />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <Button type="submit" size="sm" loading={saving} icon={Plus}>
                    {saving ? 'جاري الإضافة...' : 'إضافة اقتراح'}
                </Button>
            </form>
        </div>
    );
}
