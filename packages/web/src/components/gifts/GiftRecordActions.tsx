import { useEffect, useState } from 'react';
import { BadgeCheck, CalendarPlus, CheckCircle2, ClipboardCheck, HandHeart, XCircle } from '../ui/icons';
import Modal from '../ui/Modal';
import DateField from '../ui/DateField';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import {
  giftConditionStatusLabels,
  type GiftConditionStatus,
  type GiftRecordPrototype,
} from '../../data/giftsPrototype';

type ActionKind = 'condition' | 'approve' | 'withdraw' | 'task' | 'manual' | 'reopen' | 'cancel';

const actionTitles: Record<ActionKind, string> = {
  condition: 'تحديث تحقق الشرط',
  approve: 'اعتماد الهدية للتسليم',
  withdraw: 'سحب اعتماد الهدية',
  task: 'إنشاء مهمة تسليم الهدية',
  manual: 'تأكيد تسليم يدوي',
  reopen: 'إعادة فتح التسليم اليدوي',
  cancel: 'إلغاء سجل الهدية',
};

function ActionButton({
  icon: Icon,
  label,
  tone,
  onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default function GiftRecordActions({
  record,
  candidateRecords = [],
  onChanged,
}: {
  record: GiftRecordPrototype;
  candidateRecords?: GiftRecordPrototype[];
  onChanged?: () => void;
}) {
  const { hasPermission } = usePermissions();
  const [action, setAction] = useState<ActionKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [conditionStatus, setConditionStatus] = useState<GiftConditionStatus>(record.conditionStatus);
  const [conditionNotes, setConditionNotes] = useState('');
  const [approvedQuantity, setApprovedQuantity] = useState<number>(record.approvedQuantity ?? record.promisedQuantity ?? 1);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [creationReason, setCreationReason] = useState('');
  const [creationReasons, setCreationReasons] = useState<any[]>([]);
  const [manualMethods, setManualMethods] = useState<any[]>([]);
  const [manualMethodId, setManualMethodId] = useState('');
  const [manualAcknowledged, setManualAcknowledged] = useState(false);
  const [selectedTaskRecordIds, setSelectedTaskRecordIds] = useState<Array<string | number>>([record.id]);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  const status = record.status;
  const isClientBeneficiary = record.beneficiaryType === 'contract_customer' || record.beneficiaryType === 'customer_referrer';

  const canVerify = hasPermission('contract_gifts.verify_condition') && (status === 'promised' || status === 'approved_for_delivery');
  const canApprove = hasPermission('contract_gifts.approve_delivery') && status === 'promised';
  const canWithdraw = hasPermission('contract_gifts.approve_delivery') && status === 'approved_for_delivery' && !record.deliveryTaskId;
  const canCreateTask = hasPermission('contract_gifts.create_delivery_task') && status === 'approved_for_delivery' && isClientBeneficiary && !record.deliveryTaskId;
  const canManual = hasPermission('contract_gifts.manual_delivery') && status === 'approved_for_delivery' && !record.deliveryTaskId;
  const canReopen = hasPermission('contract_gifts.reopen_manual_delivery') && status === 'delivered_manually';
  const canCancel = hasPermission('contract_gifts.cancel') && (status === 'promised' || status === 'approved_for_delivery');

  const hasAnyAction = canVerify || canApprove || canWithdraw || canCreateTask || canManual || canReopen || canCancel;
  const taskCompanions = candidateRecords.filter(candidate => (
    candidate.status === 'approved_for_delivery'
    && !candidate.deliveryTaskId
    && candidate.beneficiaryClientId != null
    && String(candidate.beneficiaryClientId) === String(record.beneficiaryClientId)
    && String(candidate.responsibleBranchId ?? candidate.sourceBranchId ?? '') === String(record.responsibleBranchId ?? record.sourceBranchId ?? '')
  ));

  useEffect(() => {
    api.systemLists.getItemsByCode('gift_delivery_creation_reasons')
      .then((items: any) => {
        const list = Array.isArray(items) ? items : [];
        setCreationReasons(list);
        setCreationReason((current) => current || (list[0]?.value ?? ''));
      })
      .catch(() => setCreationReasons([]));
  }, []);

  useEffect(() => {
    api.systemLists.getItemsByCode('gift_manual_delivery_methods')
      .then((items: any) => {
        const list = Array.isArray(items) ? items : [];
        setManualMethods(list);
        setManualMethodId(current => current || String(list[0]?.id ?? ''));
      })
      .catch(() => setManualMethods([]));
  }, []);

  function openAction(kind: ActionKind) {
    setError(null);
    if (kind === 'condition') { setConditionStatus(record.conditionStatus); setConditionNotes(record.conditionNotes ?? ''); }
    if (kind === 'approve') { setApprovedQuantity(record.approvedQuantity ?? record.promisedQuantity ?? 1); setApprovalNotes(''); }
    if (kind === 'withdraw' || kind === 'reopen') setReason('');
    if (kind === 'task') {
      setDueDate('');
      setPriority('medium');
      setCreationReason(creationReasons[0]?.value ?? '');
      setNotes('');
      setSelectedTaskRecordIds([record.id]);
    }
    if (kind === 'manual') {
      setNotes('');
      setManualMethodId(String(manualMethods[0]?.id ?? ''));
      setManualAcknowledged(false);
    }
    if (kind === 'cancel') setReason('');
    setAction(kind);
  }

  function closeAction() {
    if (submitting) return;
    setAction(null);
    setError(null);
  }

  async function submit() {
    if (!action || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (action === 'condition') {
        await api.gifts.records.updateCondition(record.id, {
          conditionStatus,
          conditionNotes: conditionNotes.trim() || undefined,
        });
      } else if (action === 'approve') {
        if (record.conditionStatus === 'not_met' && !approvalNotes.trim()) {
          setError('ملاحظات الاعتماد إلزامية عند اعتماد سجل شرطه غير محقق');
          setSubmitting(false);
          return;
        }
        await api.gifts.records.approve(record.id, { approvedQuantity, approvalNotes: approvalNotes.trim() || undefined });
      } else if (action === 'withdraw') {
        if (!reason.trim()) { setError('سبب سحب الاعتماد إلزامي'); setSubmitting(false); return; }
        await api.gifts.records.withdrawApproval(record.id, { reason: reason.trim() });
      } else if (action === 'task') {
        if (!dueDate) { setError('تاريخ التسليم المطلوب إلزامي'); setSubmitting(false); return; }
        if (creationReasons.length > 0 && !creationReason) {
          setError('سبب إنشاء مهمة تسليم الهدية إلزامي');
          setSubmitting(false);
          return;
        }
        await api.gifts.records.createDeliveryTask(record.id, {
          giftRecordIds: selectedTaskRecordIds.filter(id => String(id) !== String(record.id)),
          dueDate,
          priority,
          creationReason: creationReason || undefined,
          notes: notes.trim() || undefined,
        });
      } else if (action === 'manual') {
        const branchId = Number(record.responsibleBranchId ?? record.sourceBranchId);
        if (!manualMethodId || !branchId || !manualAcknowledged) {
          setError('طريقة التسليم وإقرار الاستلام مطلوبان');
          setSubmitting(false);
          return;
        }
        await api.gifts.records.manualDelivery(record.id, {
          methodId: Number(manualMethodId),
          branchId,
          acknowledged: true,
          notes: notes.trim() || undefined,
        });
      } else if (action === 'reopen') {
        if (!reason.trim()) { setError('سبب إعادة فتح التسليم اليدوي إلزامي'); setSubmitting(false); return; }
        await api.gifts.records.reopenManualDelivery(record.id, { reason: reason.trim() });
      } else if (action === 'cancel') {
        if (!reason.trim()) { setError('سبب الإلغاء إلزامي'); setSubmitting(false); return; }
        await api.gifts.records.cancel(record.id, { reason: reason.trim() });
      }
      setAction(null);
      onChanged?.();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تنفيذ العملية على الخادم');
    } finally {
      setSubmitting(false);
    }
  }

  if (!hasAnyAction) return null;

  return (
    <>
      <div className="flex flex-col gap-2">
        {canVerify && (
          <ActionButton
            icon={BadgeCheck}
            label="تحقق الشرط"
            tone="border-slate-200 text-slate-700 hover:bg-slate-50"
            onClick={() => openAction('condition')}
          />
        )}
        {canApprove && (
          <ActionButton
            icon={CheckCircle2}
            label="اعتماد للتسليم"
            tone="border-sky-200 text-sky-700 hover:bg-sky-50"
            onClick={() => openAction('approve')}
          />
        )}
        {canWithdraw && (
          <ActionButton
            icon={XCircle}
            label="سحب الاعتماد"
            tone="border-amber-200 text-amber-700 hover:bg-amber-50"
            onClick={() => openAction('withdraw')}
          />
        )}
        {canCreateTask && (
          <ActionButton
            icon={CalendarPlus}
            label="إنشاء مهمة تسليم"
            tone="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            onClick={() => openAction('task')}
          />
        )}
        {canManual && (
          <ActionButton
            icon={HandHeart}
            label="تأكيد تسليم يدوي"
            tone="border-teal-200 text-teal-700 hover:bg-teal-50"
            onClick={() => openAction('manual')}
          />
        )}
        {canReopen && (
          <ActionButton
            icon={CalendarPlus}
            label="إعادة فتح التسليم"
            tone="border-amber-200 text-amber-700 hover:bg-amber-50"
            onClick={() => openAction('reopen')}
          />
        )}
        {canCancel && (
          <ActionButton
            icon={XCircle}
            label="إلغاء"
            tone="border-rose-200 text-rose-700 hover:bg-rose-50"
            onClick={() => openAction('cancel')}
          />
        )}
      </div>

      <Modal
        isOpen={action != null}
        onClose={closeAction}
        title={action ? actionTitles[action] : ''}
        size="lg"
        bodyClassName="p-5"
        footer={
          <>
            <button
              type="button"
              onClick={closeAction}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <ClipboardCheck className="h-4 w-4" />
              {submitting ? 'جاري التنفيذ...' : 'تأكيد'}
            </button>
          </>
        }
      >
        <div dir="rtl" className="space-y-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
            <span className="font-bold text-slate-700">{record.giftName}</span>
            {' · '}
            {record.approvedQuantity ?? record.promisedQuantity} {record.unitLabel}
            {' · '}
            المستفيد: {record.beneficiaryName}
          </div>

          {action === 'condition' && (
            <>
              <label className="block text-xs font-bold text-slate-500">
                حالة تحقق الشرط
                <select
                  value={conditionStatus}
                  onChange={(e) => setConditionStatus(e.target.value as GiftConditionStatus)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                >
                  {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-500">
                ملاحظات التحقق (اختياري)
                <textarea
                  value={conditionNotes}
                  onChange={(e) => setConditionNotes(e.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </>
          )}

          {action === 'approve' && (
            <>
              <label className="block text-xs font-bold text-slate-500">
                الكمية المعتمدة (تُجمّد عند الاعتماد)
                <input
                  type="number"
                  min={1}
                  value={approvedQuantity}
                  onChange={(e) => setApprovedQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                />
              </label>
              {record.conditionStatus === 'not_met' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
                  الشرط غير محقق — الاعتماد جائز لكن ملاحظات الاعتماد إلزامية.
                </div>
              )}
              <label className="block text-xs font-bold text-slate-500">
                ملاحظات الاعتماد{record.conditionStatus === 'not_met' ? ' *' : ' (اختياري)'}
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </>
          )}

          {action === 'task' && (
            <>
              {taskCompanions.length > 1 && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <div className="mb-2 text-xs font-bold text-indigo-800">
                    سجلات المستفيد نفسه والفرع نفسه — نتيجة المهمة ستطبق على المجموعة كاملة
                  </div>
                  <div className="space-y-2">
                    {taskCompanions.map(candidate => {
                      const isPrimary = String(candidate.id) === String(record.id);
                      const checked = selectedTaskRecordIds.some(id => String(id) === String(candidate.id));
                      return (
                        <label key={candidate.id} className="flex items-center gap-2 text-xs text-indigo-900">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isPrimary}
                            onChange={(event) => setSelectedTaskRecordIds(current => (
                              event.target.checked
                                ? [...current, candidate.id]
                                : current.filter(id => String(id) !== String(candidate.id))
                            ))}
                          />
                          <span>{candidate.giftName} — {candidate.approvedQuantity ?? candidate.promisedQuantity} {candidate.unitLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <label className="block text-xs font-bold text-slate-500">
                تاريخ التسليم المطلوب
                <DateField
                  value={dueDate}
                  onChange={setDueDate}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                />
              </label>
              <label className="block text-xs font-bold text-slate-500">
                الأولوية
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                >
                  <option value="low">منخفضة</option>
                  <option value="medium">متوسطة</option>
                  <option value="high">عالية</option>
                </select>
              </label>
              {creationReasons.length > 0 && (
                <label className="block text-xs font-bold text-slate-500">
                  سبب إنشاء المهمة
                  <select
                    value={creationReason}
                    onChange={(e) => setCreationReason(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                  >
                    <option value="">— اختر سبب الإنشاء —</option>
                    {creationReasons.map((item: any) => (
                      <option key={item.id ?? item.value} value={item.value}>
                        {item.label || item.value}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-xs font-bold text-slate-500">
                ملاحظات (اختياري)
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </>
          )}

          {action === 'manual' && (
            <>
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-6 text-teal-800">
                التأكيد اليدوي يغلق كامل الكمية المعتمدة بدون إنشاء نتيجة جزئية.
              </div>
              <label className="block text-xs font-bold text-slate-500">
                طريقة التسليم
                <select
                  value={manualMethodId}
                  onChange={(event) => setManualMethodId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                >
                  <option value="">— اختر طريقة التسليم —</option>
                  {manualMethods.map((method: any) => (
                    <option key={method.id} value={method.id}>{method.label ?? method.value}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={manualAcknowledged}
                  onChange={(event) => setManualAcknowledged(event.target.checked)}
                  className="mt-0.5"
                />
                <span>أقر بأن المستفيد استلم كامل الهدية المعتمدة.</span>
              </label>
              <label className="block text-xs font-bold text-slate-500">
                ملاحظات التسليم (اختياري)
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </>
          )}

          {(action === 'withdraw' || action === 'reopen' || action === 'cancel') && (
            <label className="block text-xs font-bold text-slate-500">
              {action === 'withdraw'
                ? 'سبب سحب الاعتماد *'
                : action === 'reopen'
                  ? 'سبب إعادة الفتح *'
                  : 'سبب الإلغاء *'}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
            </label>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-6 text-rose-700">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
