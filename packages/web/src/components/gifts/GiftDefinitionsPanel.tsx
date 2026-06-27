import { useEffect, useState } from 'react';
import { CheckCircle2, Edit2, Gift, Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import Card, { CardHeader, CardTitle } from '../ui/Card';
import Modal from '../ui/Modal';
import { api } from '../../lib/api';
import {
  giftDefinitionKindLabels,
  type GiftDefinitionKind,
  type GiftDefinitionPrototype,
} from '../../data/giftsPrototype';

type GiftDefinitionDraft = Pick<GiftDefinitionPrototype, 'name' | 'description' | 'kind' | 'defaultUnitLabel' | 'isActive'>;
type DialogMode = 'create' | 'edit';

const emptyDraft: GiftDefinitionDraft = {
  name: '',
  description: '',
  kind: 'standard_gift',
  defaultUnitLabel: 'هدية',
  isActive: true,
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toDraft(definition: GiftDefinitionPrototype): GiftDefinitionDraft {
  return {
    name: definition.name,
    description: definition.description ?? '',
    kind: definition.kind,
    defaultUnitLabel: definition.defaultUnitLabel,
    isActive: definition.isActive,
  };
}

function getDefinitionUsageCount(definition: GiftDefinitionPrototype) {
  return definition.usageCount ?? 0;
}

function mustDeactivateInsteadOfDelete(definition: GiftDefinitionPrototype) {
  return definition.kind === 'gift_contract' || getDefinitionUsageCount(definition) > 0;
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${
      active
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-slate-50 text-slate-500'
    }`}>
      {active ? 'فعال' : 'موقوف'}
    </span>
  );
}

function KindPill({ kind }: { kind: GiftDefinitionKind }) {
  const className = kind === 'gift_contract'
    ? 'border-violet-200 bg-violet-50 text-violet-700'
    : 'border-sky-200 bg-sky-50 text-sky-700';

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}>
      {giftDefinitionKindLabels[kind]}
    </span>
  );
}

function DefinitionForm({
  draft,
  onChange,
}: {
  draft: GiftDefinitionDraft;
  onChange: (draft: GiftDefinitionDraft) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" dir="rtl">
      <label className="text-xs font-bold text-slate-500">
        اسم الهدية
        <input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          placeholder="مثال: فلتر سنة كاملة"
        />
      </label>
      <label className="text-xs font-bold text-slate-500">
        نوع التعريف
        <select
          value={draft.kind}
          onChange={(event) => onChange({ ...draft, kind: event.target.value as GiftDefinitionKind })}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="standard_gift">هدية عادية</option>
          <option value="gift_contract">عقد هدية</option>
        </select>
      </label>
      <label className="text-xs font-bold text-slate-500">
        وحدة العرض الافتراضية
        <input
          value={draft.defaultUnitLabel}
          onChange={(event) => onChange({ ...draft, defaultUnitLabel: event.target.value })}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          placeholder="هدية / عقد"
        />
      </label>
      <label className="text-xs font-bold text-slate-500">
        الحالة
        <select
          value={draft.isActive ? 'active' : 'inactive'}
          onChange={(event) => onChange({ ...draft, isActive: event.target.value === 'active' })}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="active">فعال</option>
          <option value="inactive">موقوف</option>
        </select>
      </label>
      <label className="text-xs font-bold text-slate-500 md:col-span-2">
        وصف اختياري
        <textarea
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          className="mt-1 min-h-[84px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          placeholder="ملاحظات داخلية حول استخدام هذا التعريف"
        />
      </label>
    </div>
  );
}

export default function GiftDefinitionsPanel() {
  const [definitions, setDefinitions] = useState<GiftDefinitionPrototype[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('create');
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [draft, setDraft] = useState<GiftDefinitionDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.gifts.definitions.list()
      .then(rows => {
        if (active) setDefinitions(rows);
      })
      .catch((err: any) => {
        if (!active) return;
        setDefinitions([]);
        setLoadError(err?.message ?? 'تعذر تحميل تعريفات الهدايا من الخادم');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  function openCreateDialog() {
    setDialogMode('create');
    setEditingId(null);
    setDraft(emptyDraft);
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEditDialog(definition: GiftDefinitionPrototype) {
    setDialogMode('edit');
    setEditingId(definition.id);
    setDraft(toDraft(definition));
    setSaveError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setSaving(false);
    setSaveError(null);
  }

  async function saveDefinition() {
    if (!draft.name.trim() || saving) return;

    const payload = {
      name: draft.name.trim(),
      description: draft.description?.trim() || undefined,
      kind: draft.kind,
      defaultUnitLabel: draft.defaultUnitLabel.trim() || 'هدية',
      isActive: draft.isActive,
    };

    setSaving(true);
    setSaveError(null);
    try {
      if (dialogMode === 'edit' && editingId) {
        const updated = await api.gifts.definitions.update(editingId, payload);
        setDefinitions(prev => prev.map(definition => (
          definition.id === editingId ? { ...definition, ...updated } : definition
        )));
        closeDialog();
        return;
      }

      const created = await api.gifts.definitions.create(payload);
      setDefinitions(prev => [...prev, created]);
      closeDialog();
    } catch (err: any) {
      setSaveError(err?.message ?? 'تعذر حفظ تعريف الهدية على الخادم');
    } finally {
      setSaving(false);
    }
  }

  async function removeOrDeactivateDefinition(definition: GiftDefinitionPrototype) {
    if (mustDeactivateInsteadOfDelete(definition)) {
      if (!definition.isActive) return;
      const confirmed = window.confirm('لا يمكن حذف هذا التعريف لأنه عقد هدية أو لديه سجلات وعد/استحقاق. هل تريد إلغاء تفعيله؟');
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm('حذف هذا التعريف نهائياً من النظام؟');
      if (!confirmed) return;
    }

    setSaveError(null);
    try {
      const result = await api.gifts.definitions.delete(definition.id);
      if (result.mode === 'deleted') {
        setDefinitions(prev => prev.filter(item => item.id !== definition.id));
      } else {
        setDefinitions(prev => prev.map(item => (
          item.id === definition.id ? { ...item, isActive: false, updatedAt: today() } : item
        )));
      }
    } catch (err: any) {
      setSaveError(err?.message ?? 'تعذر تنفيذ العملية على الخادم');
    }
  }

  return (
    <div className="space-y-4">
      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>تعريفات الهدايا</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              جدول إداري لتعريف اسم الهدية ونوعها ووحدة عرضها، بدون مخزون أو مستلزمات تسليم.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {loading ? 'جاري تحميل التعريفات...' : loadError ?? 'التعديلات تحفظ على قاعدة البيانات عند توفر الخادم.'}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 hover:bg-sky-50"
          >
            <Plus className="h-4 w-4" />
            إضافة تعريف
          </button>
        </CardHeader>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full text-right text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-4 py-3">التعريف</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3">وحدة العرض</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">الاستخدام</th>
                  <th className="px-4 py-3">آخر تعديل</th>
                  <th className="px-4 py-3">إقرار التسليم</th>
                  <th className="px-4 py-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {definitions.map(definition => {
                  const usageCount = getDefinitionUsageCount(definition);
                  const protectedFromDelete = mustDeactivateInsteadOfDelete(definition);
                  return (
                    <tr key={definition.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-800">{definition.name}</div>
                        {definition.description && (
                          <div className="mt-1 max-w-md text-xs leading-5 text-slate-500">{definition.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <KindPill kind={definition.kind} />
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-700">{definition.defaultUnitLabel}</td>
                      <td className="px-4 py-3">
                        <StatusPill active={definition.isActive} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
                          {usageCount} سجل
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{definition.updatedAt}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          مطلوب
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEditDialog(definition)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            تعديل
                          </button>
                          <button
                            type="button"
                            onClick={() => removeOrDeactivateDefinition(definition)}
                            disabled={protectedFromDelete && !definition.isActive}
                            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                              protectedFromDelete
                                ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                : 'border-rose-200 text-rose-700 hover:bg-rose-50'
                            }`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {protectedFromDelete ? 'إلغاء تفعيل' : 'حذف'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-6 text-slate-600">
        <div className="flex items-start gap-2">
          <Settings2 className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            لا يمكن حذف عقد الهدية ولا أي تعريف لديه وعد أو سجل استحقاق. في هذه الحالات يتم إلغاء التفعيل فقط.
          </span>
        </div>
      </div>

      <Modal
        isOpen={dialogOpen}
        onClose={closeDialog}
        title={dialogMode === 'create' ? 'إضافة تعريف هدية' : 'تعديل تعريف هدية'}
        size="2xl"
        bodyClassName="p-5"
        footer={
          <>
            <button
              type="button"
              onClick={closeDialog}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              إلغاء
            </button>
            <button
              type="button"
              onClick={saveDefinition}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!draft.name.trim() || saving}
            >
              <Save className="h-4 w-4" />
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </>
        }
      >
        <DefinitionForm draft={draft} onChange={setDraft} />
        {saveError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-6 text-rose-700">
            {saveError}
          </div>
        )}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
          لا توجد مستلزمات تسليم قابلة للتخصيص. نجاح التسليم يعتمد فقط على إقرار الزبون بالاستلام.
        </div>
        {draft.kind === 'gift_contract' && (
          <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-6 text-violet-800">
            <div className="flex items-start gap-2">
              <Gift className="mt-1 h-4 w-4 shrink-0" />
              <span>نوع عقد هدية يستخدم للعقود التي تحمل saleSubtype = free، ولا يمكن حذفه لاحقاً بل يمكن إلغاء تفعيله.</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
