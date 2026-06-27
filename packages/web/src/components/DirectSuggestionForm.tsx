import { useEffect, useState } from 'react';
import { Plus, Phone, User, CheckCircle2, Gift, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import {
    giftConditionStatusLabels,
    type GiftConditionStatus,
    type GiftDefinitionPrototype,
} from '../data/giftsPrototype';

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

interface DirectGiftPromiseDraft {
    suggestionId: number | null;
    beneficiaryName: string;
    giftDefinitionId: string;
    conditionLabel: string;
    conditionStatus: GiftConditionStatus;
    quantity: number;
}

interface DirectGiftPromisePreview extends DirectGiftPromiseDraft {
    id: string;
}

export default function DirectSuggestionForm({ taskId, suggestions, onAdded }: Props) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeGiftDefinitions, setActiveGiftDefinitions] = useState<GiftDefinitionPrototype[]>([]);
    const [giftDefinitionsLoading, setGiftDefinitionsLoading] = useState(false);
    const [giftPromises, setGiftPromises] = useState<DirectGiftPromisePreview[]>([]);
    const [isGiftPromiseModalOpen, setIsGiftPromiseModalOpen] = useState(false);
    const [giftPromiseDraft, setGiftPromiseDraft] = useState<DirectGiftPromiseDraft>({
        suggestionId: null,
        beneficiaryName: '',
        giftDefinitionId: '',
        conditionLabel: 'شراء الزبون المقترح مباشرة',
        conditionStatus: 'pending',
        quantity: 1,
    });

    const selectedGiftDefinition = activeGiftDefinitions.find(definition => String(definition.id) === giftPromiseDraft.giftDefinitionId);

    useEffect(() => {
        let active = true;
        setGiftDefinitionsLoading(true);
        api.gifts.definitions.list()
            .then(definitions => {
                if (!active) return;
                const activeDefinitions = definitions.filter(definition => definition.isActive);
                setActiveGiftDefinitions(activeDefinitions);
                setGiftPromiseDraft(prev => prev.giftDefinitionId
                    ? prev
                    : { ...prev, giftDefinitionId: activeDefinitions[0]?.id != null ? String(activeDefinitions[0].id) : '' });
            })
            .catch(() => { if (active) setActiveGiftDefinitions([]); })
            .finally(() => { if (active) setGiftDefinitionsLoading(false); });
        return () => { active = false; };
    }, []);

    const openGiftPromiseModal = (suggestion: Suggestion) => {
        setGiftPromiseDraft({
            suggestionId: suggestion.id,
            beneficiaryName: suggestion.name,
            giftDefinitionId: activeGiftDefinitions[0]?.id != null ? String(activeGiftDefinitions[0].id) : '',
            conditionLabel: 'شراء الزبون المقترح مباشرة',
            conditionStatus: 'pending',
            quantity: 1,
        });
        setIsGiftPromiseModalOpen(true);
    };

    const addGiftPromise = () => {
        if (!selectedGiftDefinition || !giftPromiseDraft.beneficiaryName.trim()) return;
        setGiftPromises(prev => [{
            ...giftPromiseDraft,
            id: `direct-gift-${Date.now()}`,
            beneficiaryName: giftPromiseDraft.beneficiaryName.trim(),
            quantity: Math.max(1, giftPromiseDraft.quantity || 1),
        }, ...prev]);
        setIsGiftPromiseModalOpen(false);
    };

    const removeGiftPromise = (id: string) => {
        setGiftPromises(prev => prev.filter(promise => promise.id !== id));
    };

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
                            <button
                                type="button"
                                onClick={() => openGiftPromiseModal(s)}
                                className="inline-flex h-8 items-center gap-1 rounded-full border border-amber-200 bg-white px-3 text-xs font-bold text-amber-700 hover:bg-amber-50"
                                title="إضافة وعد هدية لهذا الاقتراح"
                            >
                                <Gift className="w-3.5 h-3.5" />
                                وعد هدية
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {giftPromises.length > 0 && (
                <div className="space-y-1.5">
                    {giftPromises.map(promise => {
                        const definition = activeGiftDefinitions.find(item => String(item.id) === promise.giftDefinitionId);
                        return (
                            <div key={promise.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                <Gift className="w-4 h-4 text-amber-600 shrink-0" />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-slate-800">{definition?.name ?? 'هدية'} · {promise.beneficiaryName}</p>
                                    <p className="truncate text-xs text-slate-500">
                                        {promise.conditionLabel} · {giftConditionStatusLabels[promise.conditionStatus]} · {promise.quantity}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeGiftPromise(promise.id)}
                                    className="rounded-full p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                    title="حذف الوعد"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        );
                    })}
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

            <Modal
                isOpen={isGiftPromiseModalOpen}
                onClose={() => setIsGiftPromiseModalOpen(false)}
                title="إضافة وعد هدية لاقتراح مباشر"
                size="lg"
                footer={(
                    <>
                        <Button variant="secondary" onClick={() => setIsGiftPromiseModalOpen(false)}>إلغاء</Button>
                        <Button variant="gold" icon={Gift} onClick={addGiftPromise} disabled={!selectedGiftDefinition || !giftPromiseDraft.beneficiaryName.trim()}>
                            حفظ الوعد
                        </Button>
                    </>
                )}
            >
                <div className="space-y-4 p-5" dir="rtl">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                        الوعد هنا مرتبط بالاقتراح المباشر. عند التنفيذ الخلفي يجب أن يكون الوسيط/المستفيد زبوناً معروفاً حتى يمكن إنشاء مهمة تسليم، وإلا يبقى تأكيد التسليم يدوياً.
                    </div>
                    <label className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-500">المستفيد</span>
                        <input
                            value={giftPromiseDraft.beneficiaryName}
                            onChange={e => setGiftPromiseDraft(prev => ({ ...prev, beneficiaryName: e.target.value }))}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-500">نوع الهدية</span>
                        <select
                            value={giftPromiseDraft.giftDefinitionId}
                            onChange={e => setGiftPromiseDraft(prev => ({ ...prev, giftDefinitionId: e.target.value }))}
                            disabled={giftDefinitionsLoading || activeGiftDefinitions.length === 0}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        >
                            {activeGiftDefinitions.length === 0 && (
                                <option value="">{giftDefinitionsLoading ? 'جاري تحميل التعريفات...' : 'لا توجد تعريفات هدايا فعالة'}</option>
                            )}
                            {activeGiftDefinitions.map(definition => (
                                <option key={definition.id} value={String(definition.id)}>{definition.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-bold text-slate-500">شرط الوعد</span>
                        <input
                            value={giftPromiseDraft.conditionLabel}
                            onChange={e => setGiftPromiseDraft(prev => ({ ...prev, conditionLabel: e.target.value }))}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">حالة تحقق الشرط</span>
                            <select
                                value={giftPromiseDraft.conditionStatus}
                                onChange={e => setGiftPromiseDraft(prev => ({ ...prev, conditionStatus: e.target.value as GiftConditionStatus }))}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                            >
                                {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-500">العدد عند الاعتماد</span>
                            <input
                                type="number"
                                min={1}
                                value={giftPromiseDraft.quantity}
                                onChange={e => setGiftPromiseDraft(prev => ({ ...prev, quantity: Number(e.target.value) || 1 }))}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            />
                        </label>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
