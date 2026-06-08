import { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2,
  Edit, Loader2, Package, Plus, Save, Trash2, X,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useSystemListItems } from '../../../hooks/useSystemListItems';

// ── Styles ────────────────────────────────────────────────────────────────────

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";
const sel = `${inp} appearance-none cursor-pointer`;

// ── Types ─────────────────────────────────────────────────────────────────────

type SparePartRaw = {
  id: number; name: string; code: string | null;
  basePrice: number; maintenanceType: 'Periodic' | 'Emergency' | 'Accessory';
};

type SavedPart = {
  id?: number;           // server id once saved
  sparePartId: number | null;
  partNameSnapshot: string;
  partCodeSnapshot: string;
  maintenanceType: string;
  unitPrice: number;
  quantity: number;
  retrieved: boolean;
  placementState: 'installed' | 'customer_stock';
  noRetrievalReasonId: number | null;
  noRetrievalReasonText: string;
};

type DraftPart = {
  sparePartId: number | '';
  partNameSnapshot: string;
  partCodeSnapshot: string;
  maintenanceType: '' | 'Periodic' | 'Emergency' | 'Accessory';
  unitPrice: string;
  quantity: string;
  retrieved: boolean;
  placementState: 'installed' | 'customer_stock';
  noRetrievalReasonId: string;
};

const TYPE_LABELS: Record<string, string> = {
  Periodic:  'صيانة دورية',
  Emergency: 'صيانة طارئة',
  Accessory: 'اكسسوارات',
};
const TYPE_COLORS: Record<string, string> = {
  Periodic:  'bg-sky-50 text-sky-700 border-sky-200',
  Emergency: 'bg-rose-50 text-rose-700 border-rose-200',
  Accessory: 'bg-violet-50 text-violet-700 border-violet-200',
};

function emptyDraft(): DraftPart {
  return { sparePartId: '', partNameSnapshot: '', partCodeSnapshot: '',
           maintenanceType: '', unitPrice: '0', quantity: '1',
           retrieved: true, placementState: 'installed', noRetrievalReasonId: '' };
}
function toSaved(d: DraftPart): SavedPart {
  return {
    sparePartId:         d.sparePartId ? Number(d.sparePartId) : null,
    partNameSnapshot:    d.partNameSnapshot,
    partCodeSnapshot:    d.partCodeSnapshot,
    maintenanceType:     d.maintenanceType,
    unitPrice:           Number(d.unitPrice) || 0,
    quantity:            Number(d.quantity)  || 1,
    retrieved:           d.retrieved,
    placementState:      d.placementState,
    noRetrievalReasonId: d.noRetrievalReasonId ? Number(d.noRetrievalReasonId) : null,
    noRetrievalReasonText: '',
  };
}

// ── PartDraftForm — inline add/edit form ──────────────────────────────────────

interface DraftFormProps {
  draft: DraftPart;
  allParts: SparePartRaw[];
  noRetrievalReasons: { id: number; value: string }[];
  saving: boolean;
  onDraftChange: (d: DraftPart) => void;
  onSave: () => void;
  onCancel: () => void;
}

function PartDraftForm({ draft, allParts, noRetrievalReasons, saving, onDraftChange, onSave, onCancel }: DraftFormProps) {
  const set = (key: keyof DraftPart, val: any) => onDraftChange({ ...draft, [key]: val });

  // Parts filtered by selected type
  const filteredParts = draft.maintenanceType
    ? allParts.filter(p => p.maintenanceType === draft.maintenanceType)
    : allParts;

  const selectPart = (partId: number | '') => {
    if (!partId) { set('sparePartId', ''); return; }
    const sp = allParts.find(p => p.id === Number(partId));
    if (!sp) return;
    onDraftChange({
      ...draft,
      sparePartId:      sp.id,
      partNameSnapshot: sp.name,
      partCodeSnapshot: sp.code ?? '',
      maintenanceType:  sp.maintenanceType,
      unitPrice:        String(sp.basePrice),
    });
  };

  const lineTotal = (Number(draft.quantity) || 0) * (Number(draft.unitPrice) || 0);
  const canSave   = draft.partNameSnapshot.trim().length > 0;

  return (
    <div className="rounded-2xl border-2 border-rose-300 bg-rose-50/30 p-4 space-y-3">

      {/* Row 1: نوع القطعة */}
      <div className="space-y-1">
        <label className="block text-xs font-bold text-slate-600">
          نوع القطعة <span className="text-red-400">*</span>
        </label>
        <div className="flex gap-2">
          {(['Periodic', 'Emergency', 'Accessory'] as const).map(t => (
            <button key={t} type="button"
              onClick={() => {
                onDraftChange({ ...draft, maintenanceType: t, sparePartId: '', partNameSnapshot: '', partCodeSnapshot: '', unitPrice: '0' });
              }}
              className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition-all ${
                draft.maintenanceType === t
                  ? `${TYPE_COLORS[t]} border-current`
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: اختيار القطعة */}
      <div className="space-y-1">
        <label className="block text-xs font-bold text-slate-600">القطعة</label>
        <select
          value={draft.sparePartId}
          onChange={e => selectPart(e.target.value ? Number(e.target.value) : '')}
          className={`${sel} ${!draft.maintenanceType ? 'opacity-50 cursor-not-allowed' : ''}`}
          disabled={!draft.maintenanceType}>
          <option value="">
            {!draft.maintenanceType ? '— اختر نوع القطعة أولاً —' : `— اختر من ${TYPE_LABELS[draft.maintenanceType]} —`}
          </option>
          {filteredParts.map(sp => (
            <option key={sp.id} value={sp.id}>
              {sp.name}{sp.code ? ` (${sp.code})` : ''} — {sp.basePrice.toLocaleString()} ل.س
            </option>
          ))}
          <option value="manual">✏️ إدخال يدوي...</option>
        </select>
        {/* Manual name input if not from list */}
        {!draft.sparePartId && draft.partNameSnapshot && (
          <input value={draft.partNameSnapshot}
            onChange={e => set('partNameSnapshot', e.target.value)}
            placeholder="اسم القطعة..."
            className={`${inp} text-sm mt-1`} />
        )}
        {draft.sparePartId === '' && !draft.partNameSnapshot && (
          <input value={draft.partNameSnapshot}
            onChange={e => set('partNameSnapshot', e.target.value)}
            placeholder="أو اكتب اسم القطعة يدوياً..."
            className={`${inp} text-sm mt-1`} />
        )}
      </div>

      {/* Row 3: الكمية + السعر + الإجمالي */}
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-slate-400">الكمية</label>
          <input type="number" min="1" value={draft.quantity}
            onChange={e => set('quantity', e.target.value)}
            className={`${inp} text-sm text-center`} />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-slate-400">سعر الوحدة (ل.س)</label>
          <input type="number" min="0" value={draft.unitPrice}
            onChange={e => set('unitPrice', e.target.value)}
            className={`${inp} text-sm`} />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-slate-400">الإجمالي</label>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-black text-emerald-700 text-center">
            {lineTotal.toLocaleString('ar-SY')}
          </div>
        </div>
      </div>

      {/* Row 4: هل تم سحب القطعة المبدلة؟ */}
      <div className="space-y-1 pt-1 border-t border-rose-100">
        <label className="block text-[11px] font-bold text-slate-600">مصير القطعة الجديدة</label>
        <div className="flex gap-2">
          {[
            { val: 'installed', label: 'تم تركيبها', active: 'bg-sky-600 text-white border-sky-500' },
            { val: 'customer_stock', label: 'سُلّمت ولم تُركب', active: 'bg-violet-600 text-white border-violet-500' },
          ].map(opt => (
            <button key={opt.val} type="button"
              onClick={() => set('placementState', opt.val)}
              className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold border-2 transition-all ${
                draft.placementState === opt.val ? opt.active : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1 border-t border-rose-100">
        <span className="text-[11px] font-bold text-slate-600 shrink-0">هل تم سحب القطعة المبدلة؟</span>
        <div className="flex gap-2">
          {[{ val: true, label: 'نعم ✓', active: 'bg-emerald-500 text-white border-emerald-400' },
            { val: false, label: 'لا ✗',  active: 'bg-red-500 text-white border-red-400' }].map(opt => (
            <button key={String(opt.val)} type="button"
              onClick={() => set('retrieved', opt.val)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold border-2 transition-all ${
                draft.retrieved === opt.val ? opt.active : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reason if not retrieved */}
      {!draft.retrieved && (
        <div className="space-y-1">
          <label className="block text-[10px] font-bold text-rose-600">سبب عدم السحب *</label>
          <select value={draft.noRetrievalReasonId} onChange={e => set('noRetrievalReasonId', e.target.value)}
            className={`${sel} border-rose-200 text-xs`}>
            <option value="">— اختر السبب —</option>
            {noRetrievalReasons.map(r => <option key={r.id} value={r.id}>{r.value}</option>)}
          </select>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl border border-slate-200 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
          إلغاء
        </button>
        <button type="button" onClick={onSave} disabled={saving || !canSave}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 shadow-sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ القطعة
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  taskId: number;
  initialData?: any;
  readOnly?: boolean;
  onSaved: () => void;
  onNext?: () => void;
  onBack?: () => void;
}

export default function MaintenanceActionsForm({ taskId, initialData, readOnly = false, onSaved, onNext, onBack }: Props) {
  const [allParts, setAllParts]         = useState<SparePartRaw[]>([]);
  const [actionTypes, setActionTypes]   = useState<any[]>([]);
  const [actionTypeId, setActionTypeId] = useState(initialData?.actionTypeId ? String(initialData.actionTypeId) : '');
  const [actionsTaken, setActionsTaken] = useState(initialData?.actionsTaken ?? '');
  const [techNotes, setTechNotes]       = useState(initialData?.technicianNotes ?? '');
  const [savedParts, setSavedParts]     = useState<SavedPart[]>([]);
  const [editIndex, setEditIndex]       = useState<number | null>(null);    // index being edited
  const [showAddForm, setShowAddForm]   = useState(false);                 // new part form open
  const [draft, setDraft]               = useState<DraftPart>(emptyDraft());
  const [saving, setSaving]             = useState(false);                 // saving a part
  const [savingMeta, setSavingMeta]     = useState(false);                 // saving actions/notes
  const [error, setError]               = useState('');
  const noRetrievalReasons              = useSystemListItems('part_no_retrieval_reason');

  useEffect(() => {
    Promise.all([
      api.spareParts.list(),
      api.admin.emergencyActionTypes.active(),
      api.emergencyResult.getParts(taskId),
    ]).then(([sp, at, existingParts]) => {
      setAllParts(sp.map((p: any) => ({ ...p, basePrice: Number(p.basePrice) })));
      setActionTypes(at);
      setSavedParts(existingParts.map((p: any) => ({
        id:                  p.id,
        sparePartId:         p.sparePartId ?? null,
        partNameSnapshot:    p.partNameSnapshot,
        partCodeSnapshot:    p.partCodeSnapshot ?? '',
        maintenanceType:     p.maintenanceType ?? '',
        unitPrice:           Number(p.unitPrice),
        quantity:            Number(p.quantity),
        retrieved:           p.retrieved !== false,
        placementState:      p.placementState === 'customer_stock' ? 'customer_stock' : 'installed',
        noRetrievalReasonId: p.noRetrievalReasonId ?? null,
        noRetrievalReasonText: p.noRetrievalReasonText ?? '',
      })));
    }).catch(console.error);
  }, [taskId]);

  // ── Persist parts list silently (no wizard reload) ───────────────────────────
  // Parts are saved immediately on add/edit/delete WITHOUT triggering onSaved(),
  // so the wizard stays on phase 2 and the technician can keep adding parts.
  // onSaved() is only called from handleSaveMeta() when the user finishes the phase.
  const persistParts = async (newParts: SavedPart[]) => {
    await api.emergencyResult.saveParts(taskId, newParts.map(p => ({
      sparePartId:          p.sparePartId,
      partNameSnapshot:     p.partNameSnapshot,
      partCodeSnapshot:     p.partCodeSnapshot || null,
      maintenanceType:      p.maintenanceType || null,
      unitPrice:            p.unitPrice,
      quantity:             p.quantity,
      retrieved:            p.retrieved,
      placementState:       p.placementState,
      noRetrievalReasonId:  p.noRetrievalReasonId,
      noRetrievalReasonText: p.noRetrievalReasonText || null,
    })));
    // intentionally NOT calling onSaved() here
  };

  // ── Save draft as new part ──────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (!draft.partNameSnapshot.trim()) return;
    setSaving(true); setError('');
    try {
      const updated = [...savedParts, toSaved(draft)];
      await persistParts(updated);
      setSavedParts(updated);
      setShowAddForm(false);
      setDraft(emptyDraft());
      // Stay on this phase — no navigation
    } catch (err: any) { setError(err.message || 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  // ── Save edited part ────────────────────────────────────────────────────────
  const handleSaveEdit = async () => {
    if (editIndex === null || !draft.partNameSnapshot.trim()) return;
    setSaving(true); setError('');
    try {
      const updated = savedParts.map((p, i) => i === editIndex ? toSaved(draft) : p);
      await persistParts(updated);
      setSavedParts(updated);
      setEditIndex(null);
      setDraft(emptyDraft());
    } catch (err: any) { setError(err.message || 'فشل الحفظ'); }
    finally { setSaving(false); }
  };

  // ── Delete part ─────────────────────────────────────────────────────────────
  const handleDelete = async (i: number) => {
    setSaving(true); setError('');
    try {
      const updated = savedParts.filter((_, idx) => idx !== i);
      await persistParts(updated);
      setSavedParts(updated);
      if (editIndex === i) { setEditIndex(null); setDraft(emptyDraft()); }
    } catch (err: any) { setError(err.message || 'فشل الحذف'); }
    finally { setSaving(false); }
  };

  // ── Open edit form for existing part ────────────────────────────────────────
  const startEdit = (i: number) => {
    const p = savedParts[i];
    setDraft({
      sparePartId:         p.sparePartId ?? '',
      partNameSnapshot:    p.partNameSnapshot,
      partCodeSnapshot:    p.partCodeSnapshot,
      maintenanceType:     (p.maintenanceType as any) || '',
      unitPrice:           String(p.unitPrice),
      quantity:            String(p.quantity),
      retrieved:           p.retrieved,
      placementState:      p.placementState,
      noRetrievalReasonId: p.noRetrievalReasonId ? String(p.noRetrievalReasonId) : '',
    });
    setEditIndex(i);
    setShowAddForm(false);
  };

  // ── Save meta (action type + notes) ─────────────────────────────────────────
  const handleSaveMeta = async (andNext = false) => {
    setSavingMeta(true); setError('');
    try {
      await api.emergencyResult.saveActions(taskId, {
        // Always null in V1.0 — actions live inside the problems list.
        actionTypeId:    null,
        actionsTaken:    null,
        technicianNotes: techNotes.trim() || null,
        partsUsed:       [],
      });
      onSaved();
      if (andNext && onNext) onNext();
    } catch (err: any) { setError(err.message || 'فشل الحفظ'); }
    finally { setSavingMeta(false); }
  };

  const totalValue = savedParts.reduce((s, p) => s + p.unitPrice * p.quantity, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm" dir="rtl">
      <div className="px-5 py-3.5 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-sm">القطع المستبدلة</h3>
        {(initialData || savedParts.length > 0) && (
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            {savedParts.length > 0 ? `${savedParts.length} قطعة محفوظة` : 'محفوظة ✓'}
          </span>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* نوع الإجراء + وصف الإجراءات — تَمّ التخلّي عنهما (maintenance-v1.md):
            الإجراءات تُمثَّل الآن داخل قسم "إجراء الصيانة" أعلاه (لائحة الأعطال).
            actionTypes / actionTypeId / actionsTaken state يَبقى للـ legacy فقط
            ويُرسَل null عند الحفظ. */}

        {/* ══════════════ القطع المستبدلة ══════════════ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700">
              القطع المستبدلة
              {savedParts.length > 0 && (
                <span className="mr-2 font-normal text-slate-400">({savedParts.length} قطعة)</span>
              )}
            </p>
            {!readOnly && !showAddForm && editIndex === null && (
              <button type="button" onClick={() => { setShowAddForm(true); setDraft(emptyDraft()); }}
                className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 border border-rose-200 rounded-xl px-3 py-1.5 hover:bg-rose-50 transition-colors">
                <Plus className="h-3.5 w-3.5" /> إضافة قطعة
              </button>
            )}
          </div>

          {/* Saved parts list */}
          {savedParts.length === 0 && !showAddForm ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-5 text-center">
              <Package className="h-6 w-6 text-slate-200 mx-auto mb-1" />
              <p className="text-xs text-slate-400">لا توجد قطع — اضغط "إضافة قطعة"</p>
            </div>
          ) : (
            <div className="space-y-2">
              {savedParts.map((p, i) => (
                editIndex === i ? (
                  /* Edit mode for this part */
                  <PartDraftForm key={i}
                    draft={draft} allParts={allParts}
                    noRetrievalReasons={noRetrievalReasons.items}
                    saving={saving}
                    onDraftChange={setDraft}
                    onSave={handleSaveEdit}
                    onCancel={() => { setEditIndex(null); setDraft(emptyDraft()); }}
                  />
                ) : (
                  /* Display row */
                  <div key={i} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${saving ? 'opacity-60' : 'hover:bg-slate-50/60'} transition-colors`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800">{p.partNameSnapshot}</span>
                        {p.maintenanceType && (
                          <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${TYPE_COLORS[p.maintenanceType] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {TYPE_LABELS[p.maintenanceType]}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${
                          p.placementState === 'customer_stock'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : 'bg-sky-50 text-sky-700 border-sky-200'
                        }`}>
                          {p.placementState === 'customer_stock' ? 'مسلّمة وغير مركبة' : 'مركبة'}
                        </span>
                        {!p.retrieved && (
                          <span className="text-[10px] font-bold rounded-full border border-amber-200 bg-amber-50 text-amber-700 px-2 py-0.5">
                            لم تُسحب
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{p.quantity} × {p.unitPrice.toLocaleString()} ل.س</span>
                        <span className="font-bold text-emerald-700">= {(p.quantity * p.unitPrice).toLocaleString()} ل.س</span>
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => startEdit(i)} disabled={saving}
                          className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg transition-colors">
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDelete(i)} disabled={saving}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              ))}

              {/* Add new part form */}
              {showAddForm && (
                <PartDraftForm
                  draft={draft} allParts={allParts}
                  noRetrievalReasons={noRetrievalReasons.items}
                  saving={saving}
                  onDraftChange={setDraft}
                  onSave={handleSaveDraft}
                  onCancel={() => { setShowAddForm(false); setDraft(emptyDraft()); }}
                />
              )}

              {/* Total */}
              {savedParts.length > 0 && !showAddForm && editIndex === null && (
                <div className="flex justify-end mt-2">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-700">إجمالي القطع:</span>
                    <span className="font-black text-emerald-800">{totalValue.toLocaleString('ar-SY')} ل.س</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ملاحظات الفني */}
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-600">ملاحظات الفني</label>
          <textarea value={techNotes} onChange={e => setTechNotes(e.target.value)}
            rows={2} placeholder="ملاحظات إضافية..."
            disabled={readOnly} className={`${inp} resize-none`} />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}

        {/* Footer actions */}
        {!readOnly && (
          <div className="flex gap-2 pt-1">
            {onBack && (
              <button type="button" onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <ArrowRight className="h-4 w-4" /> السابق
              </button>
            )}
            <button type="button" onClick={() => handleSaveMeta(false)} disabled={savingMeta}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
              {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              حفظ
            </button>
            {onNext && (
              <button type="button" onClick={() => handleSaveMeta(true)} disabled={savingMeta}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 shadow-sm">
                {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                حفظ والانتقال للتالي <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
