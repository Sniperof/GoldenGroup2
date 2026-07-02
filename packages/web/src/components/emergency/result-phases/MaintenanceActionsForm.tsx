import { useEffect, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2,
  Edit, Loader2, Package, Plus, Save, Trash2, X,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useSystemListItems } from '../../../hooks/useSystemListItems';
import Select from '../../ui/Select';
import Card from '../../ui/Card';
import Badge from '../../ui/Badge';

// ── Styles ────────────────────────────────────────────────────────────────────

const inp = "w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 bg-white";
const sel = `${inp} appearance-none cursor-pointer`;

// ── Types ─────────────────────────────────────────────────────────────────────

type SparePartRaw = {
  id: number; name: string; code: string | null;
  basePrice: number; maintenanceType: 'Periodic' | 'Emergency' | 'Accessory';
  isActive?: boolean;
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
  recommendationStatus: 'required' | 'optional';
  customerDecision: 'approved' | 'refused' | 'not_required';
  executionStatus: 'replaced' | 'delivered_to_customer_stock' | 'not_replaced_customer_refused' | 'not_replaced_unavailable' | 'not_replaced_technician_decision';
  customerRefusalReasonId: number | null;
  customerRefusalReasonText: string;
};

type MaintenanceKind = 'emergency' | 'periodic';
type ActiveWarranty = { type: 'contract' | 'golden'; endDate?: string | null } | null;

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
  noRetrievalReasonText: string;
  recommendationStatus: 'required' | 'optional';
  customerDecision: 'approved' | 'refused' | 'not_required';
  executionStatus: 'replaced' | 'delivered_to_customer_stock' | 'not_replaced_customer_refused' | 'not_replaced_unavailable' | 'not_replaced_technician_decision';
  customerRefusalReasonId: string;
  customerRefusalReasonText: string;
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
const EXECUTION_LABELS: Record<SavedPart['executionStatus'], string> = {
  replaced: 'تم الاستبدال',
  delivered_to_customer_stock: 'سُلّمت ولم تُركب',
  not_replaced_customer_refused: 'رفض الزبون',
  not_replaced_unavailable: 'غير متوفرة',
  not_replaced_technician_decision: 'لم تُستبدل بقرار فني',
};
const EXECUTION_COLORS: Record<SavedPart['executionStatus'], string> = {
  replaced: 'bg-sky-50 text-sky-700 border-sky-200',
  delivered_to_customer_stock: 'bg-violet-50 text-violet-700 border-violet-200',
  not_replaced_customer_refused: 'bg-rose-50 text-rose-700 border-rose-200',
  not_replaced_unavailable: 'bg-amber-50 text-amber-700 border-amber-200',
  not_replaced_technician_decision: 'bg-slate-100 text-slate-600 border-slate-200',
};
function isExecutedPart(p: Pick<SavedPart, 'executionStatus'>) {
  return p.executionStatus === 'replaced' || p.executionStatus === 'delivered_to_customer_stock';
}

function emptyDraft(): DraftPart {
  return { sparePartId: '', partNameSnapshot: '', partCodeSnapshot: '',
           maintenanceType: '', unitPrice: '0', quantity: '1',
           retrieved: true, placementState: 'installed', noRetrievalReasonId: '',
           noRetrievalReasonText: '',
           recommendationStatus: 'required', customerDecision: 'approved',
           executionStatus: 'replaced', customerRefusalReasonId: '', customerRefusalReasonText: '' };
}
function toSaved(d: DraftPart): SavedPart {
  const customerDecision =
    d.executionStatus === 'not_replaced_customer_refused'
      ? 'refused'
      : isExecutedPart(d)
        ? 'approved'
        : 'not_required';
  const placementState = d.executionStatus === 'delivered_to_customer_stock' ? 'customer_stock' : 'installed';
  return {
    sparePartId:         d.sparePartId ? Number(d.sparePartId) : null,
    partNameSnapshot:    d.partNameSnapshot,
    partCodeSnapshot:    d.partCodeSnapshot,
    maintenanceType:     d.maintenanceType,
    unitPrice:           Number(d.unitPrice) || 0,
    quantity:            Number(d.quantity)  || 1,
    retrieved:           d.executionStatus === 'replaced' ? d.retrieved : true,
    placementState,
    noRetrievalReasonId: d.executionStatus === 'replaced' && !d.retrieved && d.noRetrievalReasonId ? Number(d.noRetrievalReasonId) : null,
    noRetrievalReasonText: d.executionStatus === 'replaced' && !d.retrieved ? d.noRetrievalReasonText : '',
    recommendationStatus: d.recommendationStatus,
    customerDecision,
    executionStatus: d.executionStatus,
    customerRefusalReasonId: d.customerRefusalReasonId ? Number(d.customerRefusalReasonId) : null,
    customerRefusalReasonText: d.customerRefusalReasonText.trim(),
  };
}

// ── PartDraftForm — inline add/edit form ──────────────────────────────────────

interface DraftFormProps {
  draft: DraftPart;
  allParts: SparePartRaw[];
  maintenanceKind: MaintenanceKind;
  activeWarranty: ActiveWarranty;
  noRetrievalReasons: { id: number; value: string }[];
  customerRefusalReasons: { id: number; value: string }[];
  saving: boolean;
  onDraftChange: (d: DraftPart) => void;
  onSave: () => void;
  onCancel: () => void;
}

function isPartCoveredByWarranty(
  maintenanceKind: MaintenanceKind,
  activeWarranty: ActiveWarranty,
  partType: DraftPart['maintenanceType'] | SparePartRaw['maintenanceType'],
) {
  if (!activeWarranty) return false;
  if (activeWarranty.type === 'golden') return partType === 'Emergency' || partType === 'Periodic';
  return maintenanceKind === 'emergency' && partType === 'Emergency';
}

function PartDraftForm({ draft, allParts, maintenanceKind, activeWarranty, noRetrievalReasons, customerRefusalReasons, saving, onDraftChange, onSave, onCancel }: DraftFormProps) {
  const set = (key: keyof DraftPart, val: any) => {
    if (key === 'executionStatus' && val !== 'replaced') {
      onDraftChange({
        ...draft,
        executionStatus: val,
        retrieved: true,
        noRetrievalReasonId: '',
        noRetrievalReasonText: '',
      });
      return;
    }
    onDraftChange({ ...draft, [key]: val });
  };

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
      unitPrice:        isPartCoveredByWarranty(maintenanceKind, activeWarranty, sp.maintenanceType)
        ? '0'
        : String(sp.basePrice),
    });
  };

  const lineTotal = isExecutedPart(draft) ? (Number(draft.quantity) || 0) * (Number(draft.unitPrice) || 0) : 0;
  const canSave   = draft.partNameSnapshot.trim().length > 0;
  const coveredByWarranty = isPartCoveredByWarranty(maintenanceKind, activeWarranty, draft.maintenanceType);

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
        <Select
          value={draft.sparePartId === '' ? '' : String(draft.sparePartId)}
          onChange={v => selectPart(v === '' || v === 'manual' ? '' : Number(v))}
          disabled={!draft.maintenanceType}
          placeholder={!draft.maintenanceType ? '— اختر نوع القطعة أولاً —' : `— اختر من ${TYPE_LABELS[draft.maintenanceType]} —`}
          ariaLabel="القطعة"
          className="w-full"
          options={[
            ...filteredParts.map(sp => ({
              value: String(sp.id),
              label: `${sp.name}${sp.code ? ` (${sp.code})` : ''}${sp.isActive === false ? ' — غير نشطة' : ''} — ${sp.basePrice.toLocaleString()} ل.س`,
            })),
            { value: 'manual', label: '✏️ إدخال يدوي...' },
          ]}
        />
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
          <label className="block text-xs font-bold text-slate-400">الكمية</label>
          <input type="number" min="1" value={draft.quantity}
            onChange={e => set('quantity', e.target.value)}
            className={`${inp} text-sm text-center`} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-400">سعر الوحدة (ل.س)</label>
          <input type="number" min="0" value={draft.unitPrice}
            onChange={e => set('unitPrice', e.target.value)}
            className={`${inp} text-sm`} />
          {coveredByWarranty && (
            <p className="text-xs font-bold text-sky-600">صفر افتراضياً ضمن الكفالة</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-400">الإجمالي</label>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-black text-emerald-700 text-center">
            {lineTotal.toLocaleString('ar-SY')}
          </div>
        </div>
      </div>

      {/* Row 4: توصية الفني */}
      <div className="space-y-1 pt-1 border-t border-rose-100">
        <label className="block text-xs font-bold text-slate-600">توصية الفني</label>
        <div className="flex gap-2">
          {[
            { val: 'required', label: 'لازمة للإصلاح', active: 'bg-rose-600 text-white border-rose-500' },
            { val: 'optional', label: 'اختيارية / وقائية', active: 'bg-slate-700 text-white border-slate-600' },
          ].map(opt => (
            <button key={opt.val} type="button"
              onClick={() => set('recommendationStatus', opt.val)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                draft.recommendationStatus === opt.val ? opt.active : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Row 5: قرار التنفيذ */}
      <div className="space-y-1 pt-1 border-t border-rose-100">
        <label className="block text-xs font-bold text-slate-600">قرار القطعة</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { val: 'replaced', label: 'تم الاستبدال', active: 'bg-sky-600 text-white border-sky-500' },
            { val: 'delivered_to_customer_stock', label: 'سُلّمت ولم تُركب', active: 'bg-violet-600 text-white border-violet-500' },
            { val: 'not_replaced_customer_refused', label: 'رفض الزبون', active: 'bg-rose-600 text-white border-rose-500' },
            { val: 'not_replaced_unavailable', label: 'غير متوفرة', active: 'bg-amber-500 text-white border-amber-400' },
            { val: 'not_replaced_technician_decision', label: 'لم تُستبدل بقرار فني', active: 'bg-slate-600 text-white border-slate-500' },
          ] as const).map(opt => (
            <button key={opt.val} type="button"
              onClick={() => set('executionStatus', opt.val)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                draft.executionStatus === opt.val ? opt.active : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {draft.executionStatus === 'replaced' && (
        <div className="flex items-center gap-3 pt-1 border-t border-rose-100">
          <span className="text-xs font-bold text-slate-600 shrink-0">هل تم سحب القطعة المبدلة؟</span>
          <div className="flex gap-2">
            {[{ val: true, label: 'نعم', active: 'bg-emerald-500 text-white border-emerald-400' },
              { val: false, label: 'لا',  active: 'bg-red-500 text-white border-red-400' }].map(opt => (
              <button key={String(opt.val)} type="button"
                onClick={() => set('retrieved', opt.val)}
                className={`px-3 py-1 rounded-lg text-xs font-bold border-2 transition-all ${
                  draft.retrieved === opt.val ? opt.active : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.executionStatus === 'replaced' && !draft.retrieved && (
        <div className="space-y-1">
          <label className="block text-xs font-bold text-rose-600">سبب عدم السحب *</label>
          <Select
            value={draft.noRetrievalReasonId}
            onChange={v => set('noRetrievalReasonId', v)}
            placeholder="— اختر السبب —"
            ariaLabel="سبب عدم السحب"
            className="w-full"
            options={noRetrievalReasons.map(r => ({ value: String(r.id), label: r.value }))}
          />
        </div>
      )}

      {draft.executionStatus === 'not_replaced_customer_refused' && (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="block text-xs font-bold text-rose-600">سبب رفض الزبون</label>
            <Select
              value={draft.customerRefusalReasonId}
              onChange={v => set('customerRefusalReasonId', v)}
              placeholder="— اختر السبب —"
              ariaLabel="سبب رفض الزبون"
              className="w-full"
              options={customerRefusalReasons.map(r => ({ value: String(r.id), label: r.value }))}
            />
          </div>
          <input value={draft.customerRefusalReasonText}
            onChange={e => set('customerRefusalReasonText', e.target.value)}
            placeholder="ملاحظة إضافية عن الرفض..."
            className={`${inp} text-sm`} />
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
  maintenanceKind?: MaintenanceKind;
  activeWarranty?: ActiveWarranty;
}

export default function MaintenanceActionsForm({ taskId, initialData, readOnly = false, onSaved, onNext, onBack, maintenanceKind = 'emergency', activeWarranty = null }: Props) {
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
  const customerRefusalReasons          = useSystemListItems('part_customer_refusal_reason');

  useEffect(() => {
    Promise.all([
      api.spareParts.list({ includeInactive: true }),
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
        recommendationStatus: p.recommendationStatus === 'optional' ? 'optional' : 'required',
        customerDecision: ['approved', 'refused', 'not_required'].includes(p.customerDecision) ? p.customerDecision : 'approved',
        executionStatus: ['replaced', 'delivered_to_customer_stock', 'not_replaced_customer_refused', 'not_replaced_unavailable', 'not_replaced_technician_decision'].includes(p.executionStatus)
          ? p.executionStatus
          : (p.placementState === 'customer_stock' ? 'delivered_to_customer_stock' : 'replaced'),
        customerRefusalReasonId: p.customerRefusalReasonId ?? null,
        customerRefusalReasonText: p.customerRefusalReasonText ?? '',
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
      recommendationStatus: p.recommendationStatus,
      customerDecision:     p.customerDecision,
      executionStatus:      p.executionStatus,
      customerRefusalReasonId: p.customerRefusalReasonId,
      customerRefusalReasonText: p.customerRefusalReasonText || null,
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
      noRetrievalReasonText: p.noRetrievalReasonText || '',
      recommendationStatus: p.recommendationStatus,
      customerDecision: p.customerDecision,
      executionStatus: p.executionStatus,
      customerRefusalReasonId: p.customerRefusalReasonId ? String(p.customerRefusalReasonId) : '',
      customerRefusalReasonText: p.customerRefusalReasonText,
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

  const totalValue = savedParts.reduce((s, p) => s + (isExecutedPart(p) ? p.unitPrice * p.quantity : 0), 0);

  return (
    <Card padding="none" className="overflow-hidden" dir="rtl">
      <div className="px-5 py-3.5 border-b border-slate-100 bg-rose-50/50 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-base">توصيات وقطع الصيانة</h3>
        {(initialData || savedParts.length > 0) && (
          <Badge variant="success" size="sm">
            {savedParts.length > 0 ? `${savedParts.length} قطعة محفوظة` : 'محفوظة ✓'}
          </Badge>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* نوع الإجراء + وصف الإجراءات — تَمّ التخلّي عنهما (maintenance-v1.md):
            الإجراءات تُمثَّل الآن داخل قسم "إجراء الصيانة" أعلاه (لائحة الأعطال).
            actionTypes / actionTypeId / actionsTaken state يَبقى للـ legacy فقط
            ويُرسَل null عند الحفظ. */}

        {/* ══════════════ توصيات وقطع الصيانة ══════════════ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700">
              توصيات وقطع الصيانة
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
                    maintenanceKind={maintenanceKind}
                    activeWarranty={activeWarranty}
                    noRetrievalReasons={noRetrievalReasons.items}
                    customerRefusalReasons={customerRefusalReasons.items}
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
                          <span className={`text-xs font-bold rounded-full border px-2 py-0.5 ${TYPE_COLORS[p.maintenanceType] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                            {TYPE_LABELS[p.maintenanceType]}
                          </span>
                        )}
                        <span className={`text-xs font-bold rounded-full border px-2 py-0.5 ${
                          EXECUTION_COLORS[p.executionStatus]
                        }`}>
                          {EXECUTION_LABELS[p.executionStatus]}
                        </span>
                        {p.recommendationStatus === 'required' && (
                          <span className="text-xs font-bold rounded-full border border-rose-200 bg-rose-50 text-rose-700 px-2 py-0.5">
                            لازمة
                          </span>
                        )}
                        {p.customerDecision === 'refused' && (
                          <span className="text-xs font-bold rounded-full border border-red-200 bg-red-50 text-red-700 px-2 py-0.5">
                            رفض الزبون
                          </span>
                        )}
                        {p.executionStatus === 'replaced' && !p.retrieved && (
                          <span className="text-xs font-bold rounded-full border border-amber-200 bg-amber-50 text-amber-700 px-2 py-0.5">
                            لم تُسحب
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{p.quantity} × {p.unitPrice.toLocaleString()} ل.س</span>
                        {isExecutedPart(p) ? (
                          <span className="font-bold text-emerald-700">= {(p.quantity * p.unitPrice).toLocaleString()} ل.س</span>
                        ) : (
                          <span className="font-bold text-slate-400">لا تدخل في التكلفة أو المخزون</span>
                        )}
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
                  maintenanceKind={maintenanceKind}
                  activeWarranty={activeWarranty}
                  noRetrievalReasons={noRetrievalReasons.items}
                  customerRefusalReasons={customerRefusalReasons.items}
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
                    <span className="text-xs font-bold text-emerald-700">إجمالي القطع المنفذة:</span>
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
    </Card>
  );
}
