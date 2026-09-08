import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import type { GiftDefinitionPrototype, GiftRecordPrototype } from '../../data/giftsPrototype';
import {
  giftConditionClasses,
  giftConditionStatusLabels,
  giftStatusClasses,
  giftStatusLabels,
} from '../../data/giftsPrototype';
import { AlertCircle, Gift, Pencil } from '../ui/icons';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface Props {
  candidateId?: number;
  referralSheetId?: number;
  emptyText?: string;
}

interface PromiseConditionOption {
  id: number;
  value: string;
  label: string;
  requiresNotes: boolean;
}

function canEditBySource(record: GiftRecordPrototype, canEditCandidate: boolean, canEditSheet: boolean): boolean {
  if (record.status !== 'promised') return false;
  if (record.sources.some(source => source.sourceType === 'contract')) return false;
  if (record.sources.some(source => source.sourceType === 'name_list')) return canEditSheet;
  if (record.sources.some(source => source.sourceType === 'candidate')) return canEditCandidate;
  return false;
}

export default function ReferralGiftPromisesPanel({
  candidateId,
  referralSheetId,
  emptyText = 'لا توجد وعود هدايا مسجلة.',
}: Props) {
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canEditCandidate = hasPermission('candidates.edit');
  const canEditSheet = hasAnyPermission('candidates.name_lists.edit');
  const [records, setRecords] = useState<GiftRecordPrototype[]>([]);
  const [definitions, setDefinitions] = useState<GiftDefinitionPrototype[]>([]);
  const [conditions, setConditions] = useState<PromiseConditionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GiftRecordPrototype | null>(null);
  const [giftDefinitionId, setGiftDefinitionId] = useState('');
  const [conditionId, setConditionId] = useState('');
  const [conditionNotes, setConditionNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => (
    candidateId ? { candidateId } : referralSheetId ? { referralSheetId } : {}
  ), [candidateId, referralSheetId]);

  const reload = () => {
    if (!candidateId && !referralSheetId) return Promise.resolve();
    setLoading(true);
    setError(null);
    return api.gifts.records.list(query)
      .then(setRecords)
      .catch((err: any) => {
        setRecords([]);
        setError(err?.message || 'تعذر تحميل وعود الهدايا');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { void reload(); }, [candidateId, referralSheetId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.gifts.definitions.list(),
      api.gifts.promiseConditions.list(),
    ])
      .then(([definitionRows, conditionRows]) => {
        if (!active) return;
        setDefinitions(definitionRows.filter(row => row.isActive));
        setConditions(conditionRows.map(item => ({
          id: Number(item.id),
          value: String(item.value ?? ''),
          label: String(item.label ?? item.value ?? item.id),
          requiresNotes: item.requiresNotes === true,
        })));
      })
      .catch(() => {
        if (active) setDefinitions([]);
        if (active) setConditions([]);
      });
    return () => { active = false; };
  }, []);

  const openEdit = (record: GiftRecordPrototype) => {
    setEditing(record);
    setGiftDefinitionId(String(record.giftDefinitionId ?? ''));
    setConditionId(String(record.conditionId ?? ''));
    setConditionNotes(record.conditionNotes ?? '');
    setQuantity(Math.max(1, Number(record.promisedQuantity) || 1));
    setError(null);
  };

  const save = async () => {
    const selectedCondition = conditions.find(condition => String(condition.id) === conditionId);
    if (!editing || !Number(giftDefinitionId) || !selectedCondition || quantity < 1) return;
    if (selectedCondition.requiresNotes && !conditionNotes.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.gifts.records.updateReferralPromise(editing.id, {
        giftDefinitionId: Number(giftDefinitionId),
        conditionId: Number(conditionId),
        conditionNotes: conditionNotes.trim(),
        promisedQuantity: quantity,
      });
      setEditing(null);
      await reload();
    } catch (err: any) {
      setError(err?.message || 'تعذر تعديل وعد الهدية');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-28 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" /></div>;
  }

  return (
    <>
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">
          {emptyText}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {records.map(record => {
            const editable = canEditBySource(record, canEditCandidate, canEditSheet);
            return (
              <article key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-base font-black text-slate-900"><Gift className="h-4 w-4 text-amber-600" />{record.giftName}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">الكمية الموعودة: {record.promisedQuantity} {record.unitLabel}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${giftStatusClasses[record.status]}`}>{giftStatusLabels[record.status]}</span>
                    {editable && (
                      <button type="button" onClick={() => openEdit(record)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:border-sky-200 hover:text-sky-700" title="تعديل الوعد">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div><span className="block text-xs font-bold text-slate-400">المستفيد</span><span className="font-bold text-slate-700">{record.beneficiaryName}</span></div>
                  <div><span className="block text-xs font-bold text-slate-400">الشرط</span><span className="font-bold text-slate-700">{record.conditionLabel}</span></div>
                  <div><span className="block text-xs font-bold text-slate-400">حالة الشرط</span><span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${giftConditionClasses[record.conditionStatus]}`}>{giftConditionStatusLabels[record.conditionStatus]}</span></div>
                  <div><span className="block text-xs font-bold text-slate-400">المصدر</span><span className="font-bold text-slate-700">{record.sources.map(source => source.label).join('، ') || 'غير محدد'}</span></div>
                </div>
                {!editable && record.status === 'promised' && record.sources.some(source => source.sourceType === 'contract') && (
                  <p className="mt-3 text-xs font-bold text-slate-500">الوعد مرتبط بعقد معتمد وأصبح للقراءة فقط.</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={editing != null}
        onClose={() => { if (!saving) setEditing(null); }}
        title="تعديل وعد الهدية"
        size="lg"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>إلغاء</Button>
            <Button variant="gold" onClick={save} disabled={saving || !Number(giftDefinitionId) || !Number(conditionId) || quantity < 1 || (conditions.find(condition => String(condition.id) === conditionId)?.requiresNotes === true && !conditionNotes.trim())}>
              {saving ? 'جارٍ الحفظ...' : 'حفظ التعديل'}
            </Button>
          </>
        )}
      >
        <div className="space-y-4 p-5" dir="rtl">
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">نوع الهدية</span><select value={giftDefinitionId} onChange={event => setGiftDefinitionId(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">{definitions.map(definition => <option key={definition.id} value={String(definition.id)}>{definition.name}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">شرط الوعد</span><select value={conditionId} onChange={event => { setConditionId(event.target.value); setConditionNotes(''); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">{conditions.map(condition => <option key={condition.id} value={String(condition.id)}>{condition.label}</option>)}</select></label>
          {conditions.find(condition => String(condition.id) === conditionId)?.requiresNotes && <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">ملاحظات الشرط *</span><textarea value={conditionNotes} onChange={event => setConditionNotes(event.target.value)} className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>}
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">الكمية الموعودة</span><input type="number" min={1} value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
          <p className="text-xs font-bold text-slate-500">حالة تحقق الشرط لا تتغير من تعديل الوعد.</p>
        </div>
      </Modal>
    </>
  );
}
