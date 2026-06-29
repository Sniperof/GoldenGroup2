import { useEffect, useState } from 'react';
import { Gift, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import {
  giftConditionStatusLabels,
  type GiftConditionStatus,
  type GiftDefinitionPrototype,
} from '../../data/giftsPrototype';

export interface InlineGiftPromiseDraft {
  giftDefinitionId: string;
  conditionLabel: string;
  conditionStatus: GiftConditionStatus;
  quantity: number;
}

interface GiftPromiseInlinePanelProps {
  enabled: boolean;
  sourceType: 'name_list' | 'direct_referral';
  beneficiaryName?: string | null;
  disabledReason?: string;
  // يرفع الوعد المحفوظ للأب ليُنشئه كـ gift_record بعد حفظ اللائحة/الاقتراح.
  onChange?: (promise: InlineGiftPromiseDraft | null) => void;
}

const defaultConditionBySource: Record<GiftPromiseInlinePanelProps['sourceType'], string> = {
  name_list: 'شراء أي اسم مقترح ضمن هذه اللائحة',
  direct_referral: 'شراء الاسم المقترح مباشرة',
};

const sourceLabelByType: Record<GiftPromiseInlinePanelProps['sourceType'], string> = {
  name_list: 'لائحة الأسماء',
  direct_referral: 'الاقتراح المباشر',
};

export default function GiftPromiseInlinePanel({
  enabled,
  sourceType,
  beneficiaryName,
  disabledReason,
  onChange,
}: GiftPromiseInlinePanelProps) {
  const [activeGiftDefinitions, setActiveGiftDefinitions] = useState<GiftDefinitionPrototype[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [savedPromise, setSavedPromise] = useState<InlineGiftPromiseDraft | null>(null);
  const [draft, setDraft] = useState<InlineGiftPromiseDraft>({
    giftDefinitionId: '',
    conditionLabel: defaultConditionBySource[sourceType],
    conditionStatus: 'pending',
    quantity: 1,
  });

  const selectedDefinition = activeGiftDefinitions.find(definition => String(definition.id) === draft.giftDefinitionId);

  useEffect(() => {
    let active = true;
    setDefinitionsLoading(true);
    api.gifts.definitions.list()
      .then(definitions => {
        if (!active) return;
        const activeDefinitions = definitions.filter(definition => definition.isActive);
        setActiveGiftDefinitions(activeDefinitions);
        setDraft(prev => prev.giftDefinitionId
          ? prev
          : { ...prev, giftDefinitionId: activeDefinitions[0]?.id != null ? String(activeDefinitions[0].id) : '' });
      })
      .catch(() => {
        if (active) setActiveGiftDefinitions([]);
      })
      .finally(() => {
        if (active) setDefinitionsLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!enabled && savedPromise) {
      setSavedPromise(null);
      onChange?.(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const savePromise = () => {
    if (!selectedDefinition) return;
    const promise = {
      ...draft,
      quantity: Math.max(1, Number(draft.quantity) || 1),
    };
    setSavedPromise(promise);
    onChange?.(promise);
    setIsAdding(false);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-black text-slate-800">
            <Gift className="h-4 w-4 text-amber-600" />
            وعد هدية من {sourceLabelByType[sourceType]}
          </p>
          <p className="mt-1 text-xs leading-6 text-slate-600">
            {enabled
              ? sourceType === 'name_list'
                ? 'الوعد يشمل أي اسم مقترح ضمن هذه اللائحة عند تحقق شرط الشراء.'
                : 'الوعد يشمل هذا الاقتراح الفردي عند تحقق شرط الشراء.'
              : disabledReason ?? 'إنشاء وعد هدية يتطلب وسيطا من نوع زبون مرتبط بسجل معروف.'}
          </p>
          {beneficiaryName && (
            <p className="mt-1 text-xs font-bold text-amber-800">المستفيد: {beneficiaryName}</p>
          )}
        </div>

        {!savedPromise && (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => setIsAdding(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            إضافة وعد
          </button>
        )}
      </div>

      {isAdding && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">
            تعريف الهدية
            <select
              value={draft.giftDefinitionId}
              onChange={event => setDraft(prev => ({ ...prev, giftDefinitionId: event.target.value }))}
              disabled={definitionsLoading || activeGiftDefinitions.length === 0}
              className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {activeGiftDefinitions.length === 0 && (
                <option value="">{definitionsLoading ? 'جاري تحميل التعريفات...' : 'لا توجد تعريفات هدايا فعالة'}</option>
              )}
              {activeGiftDefinitions.map(definition => (
                <option key={definition.id} value={String(definition.id)}>{definition.name}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-500">
            حالة تحقق الشرط
            <select
              value={draft.conditionStatus}
              onChange={event => setDraft(prev => ({ ...prev, conditionStatus: event.target.value as GiftConditionStatus }))}
              className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-500 md:col-span-2">
            شرط الوعد
            <input
              value={draft.conditionLabel}
              onChange={event => setDraft(prev => ({ ...prev, conditionLabel: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>

          <label className="text-xs font-bold text-slate-500">
            العدد عند الاعتماد
            <input
              type="number"
              min={1}
              value={draft.quantity}
              onChange={event => setDraft(prev => ({ ...prev, quantity: Number(event.target.value) || 1 }))}
              className="mt-1 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </label>

          <div className="flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={savePromise}
              disabled={!selectedDefinition}
              className="h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              حفظ الوعد
            </button>
          </div>
        </div>
      )}

      {savedPromise && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
          <div className="min-w-0 text-xs leading-6">
            <p className="font-bold text-slate-800">{selectedDefinition?.name ?? 'هدية'}</p>
            <p className="text-slate-500">
              {savedPromise.conditionLabel} - {giftConditionStatusLabels[savedPromise.conditionStatus]} - العدد: {savedPromise.quantity}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setSavedPromise(null); onChange?.(null); }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            title="حذف الوعد"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
