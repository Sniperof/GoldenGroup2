import { useEffect, useMemo, useState } from 'react';
import { Gift, Info, Plus, Save, X } from '../../components/ui/icons';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import GiftRecordsTable from '../../components/gifts/GiftRecordsTable';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import {
  giftConditionStatusLabels,
  type GiftBeneficiaryType,
  type GiftConditionStatus,
  type GiftDefinitionPrototype,
  type GiftRecordPrototype,
} from '../../data/giftsPrototype';

type DraftBeneficiaryKind =
  | 'contract_customer'
  | 'customer_referrer'
  | 'employee_referrer'
  | 'personal_referrer';

interface CustomerReferrerOption {
  key: string;
  name: string;
  beneficiaryType: Exclude<DraftBeneficiaryKind, 'contract_customer'>;
  clientId: string | number | null;
  employeeId: string | number | null;
}

interface PromiseConditionOption {
  id: number;
  value: string;
  label: string;
  requiresNotes: boolean;
}

interface GiftPromiseDraft {
  giftDefinitionId: string;
  beneficiaryKind: DraftBeneficiaryKind;
  referrerKey: string;
  conditionId: string;
  conditionStatus: GiftConditionStatus;
  conditionNotes: string;
  quantity: number;
}

function contractCustomerName(contract: any) {
  return contract?.customerName ?? contract?.client?.name ?? 'زبون العقد';
}

function contractCustomerId(contract: any) {
  return contract?.client?.id ?? contract?.clientId ?? null;
}

function customerReferrers(contract: any): CustomerReferrerOption[] {
  const referrers = Array.isArray(contract?.contractReferrers) ? contract.contractReferrers : [];
  return referrers
    .map((referrer: any, index: number) => {
      const type = String(referrer?.referrerType ?? '').toLowerCase();
      const beneficiaryType = type === 'client' || type === 'customer'
        ? 'customer_referrer'
        : type === 'employee'
          ? 'employee_referrer'
          : type === 'personal' || type === 'person'
            ? 'personal_referrer'
            : null;
      if (!beneficiaryType) return null;
      const entityId = referrer?.referrerId ?? referrer?.referralEntityId ?? null;
      return {
        key: String(referrer?.id ?? referrer?.referrerId ?? index),
        name: referrer?.referrerName ?? 'وسيط العقد',
        beneficiaryType,
        clientId: beneficiaryType === 'customer_referrer' ? entityId : null,
        employeeId: beneficiaryType === 'employee_referrer' ? entityId : null,
      };
    })
    .filter((referrer: CustomerReferrerOption | null): referrer is CustomerReferrerOption => referrer != null);
}

export default function ContractGiftsPanel({ contract }: { contract: any }) {
  const { hasPermission } = usePermissions();
  const referrers = useMemo(() => customerReferrers(contract), [contract]);
  const isGiftContract = contract?.saleSubtype === 'free';

  const [records, setRecords] = useState<GiftRecordPrototype[]>([]);
  const [definitions, setDefinitions] = useState<GiftDefinitionPrototype[]>([]);
  const [conditions, setConditions] = useState<PromiseConditionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GiftPromiseDraft>({
    giftDefinitionId: '',
    beneficiaryKind: 'contract_customer',
    referrerKey: '',
    conditionId: '',
    conditionStatus: 'pending',
    conditionNotes: '',
    quantity: 1,
  });

  const canManage = hasPermission('contract_gifts.manage');
  const contractId = contract?.id ?? contract?.contractId ?? null;
  const customerId = contractCustomerId(contract);

  useEffect(() => {
    let active = true;
    if (!contractId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    api.gifts.records.list({ contractId })
      .then(rows => { if (active) setRecords(rows); })
      .catch((err: any) => {
        if (!active) return;
        setRecords([]);
        setLoadError(err?.message ?? 'تعذر تحميل هدايا العقد من الخادم');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // contract?.status: يُعيد الجلب بعد الاعتماد (draft→active) حين تُنشأ السجلات.
  }, [contractId, reloadToken, contract?.status]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.gifts.definitions.list().catch(() => []),
      api.systemLists.getItemsByCode('gift_promise_conditions').catch(() => []),
    ]).then(([defs, conds]) => {
      if (!active) return;
      setDefinitions((defs as GiftDefinitionPrototype[]).filter(d => d.isActive));
      setConditions((conds as any[]).map(item => ({
        id: Number(item.id),
        value: String(item.value ?? ''),
        label: item.label ?? item.value ?? String(item.id),
        requiresNotes: item?.metadata?.requiresNotes === true || item?.value === 'other',
      })));
    });
    return () => { active = false; };
  }, []);

  const preferredDefinition = useMemo(() => (
    definitions.find(d => (isGiftContract ? d.kind === 'gift_contract' : d.kind === 'standard_gift')) ?? definitions[0]
  ), [definitions, isGiftContract]);

  const customerRecords = records.filter(record => record.beneficiaryType === 'contract_customer').length;
  const referrerRecords = records.filter(record => record.beneficiaryType !== 'contract_customer').length;

  function openDialog() {
    setSaveError(null);
    setDraft({
      giftDefinitionId: preferredDefinition?.id != null ? String(preferredDefinition.id) : '',
      beneficiaryKind: 'contract_customer',
      referrerKey: referrers[0]?.key ?? '',
      conditionId: conditions[0]?.id != null ? String(conditions[0].id) : '',
      conditionStatus: 'pending',
      conditionNotes: '',
      quantity: 1,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    if (saving) return;
    setDialogOpen(false);
    setSaveError(null);
  }

  async function addGiftRecord() {
    if (saving) return;
    const selectedDefinition = definitions.find(d => String(d.id) === draft.giftDefinitionId);
    if (!selectedDefinition) { setSaveError('اختر تعريف الهدية'); return; }
    if (!contractId || !contract?.branchId) { setSaveError('بيانات العقد غير مكتملة لإنشاء وعد'); return; }

    const selectedReferrer = referrers.find(referrer => referrer.key === draft.referrerKey);
    const beneficiaryType: GiftBeneficiaryType = draft.beneficiaryKind;
    const beneficiaryName = draft.beneficiaryKind !== 'contract_customer'
      ? selectedReferrer?.name ?? 'وسيط زبون'
      : contractCustomerName(contract);
    const beneficiaryClientId = draft.beneficiaryKind === 'customer_referrer'
      ? selectedReferrer?.clientId ?? null
      : draft.beneficiaryKind === 'contract_customer'
        ? customerId
        : null;
    const beneficiaryEmployeeId = draft.beneficiaryKind === 'employee_referrer'
      ? selectedReferrer?.employeeId ?? null
      : null;

    if (
      ((beneficiaryType === 'contract_customer' || beneficiaryType === 'customer_referrer') && !beneficiaryClientId)
      || (beneficiaryType === 'employee_referrer' && !beneficiaryEmployeeId)
    ) {
      setSaveError('المستفيد الزبون يجب أن يرتبط بسجل زبون معروف');
      return;
    }

    const conditionId = draft.conditionId ? Number(draft.conditionId) : undefined;
    const selectedCondition = conditions.find(c => String(c.id) === draft.conditionId);
    const conditionLabel = selectedCondition?.label;
    if (selectedCondition?.requiresNotes && !draft.conditionNotes.trim()) {
      setSaveError('ملاحظات الشرط إلزامية عند اختيار شرط آخر');
      return;
    }
    const quantity = Math.max(1, Number(draft.quantity) || 1);

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        giftDefinitionId: Number(selectedDefinition.id),
        beneficiaryType,
        beneficiaryClientId,
        beneficiaryEmployeeId,
        beneficiaryName,
        conditionId,
        conditionLabel,
        conditionNotes: draft.conditionNotes.trim() || undefined,
        conditionStatus: 'pending',
        promisedQuantity: quantity,
        quantity,
        sourceBranchId: contract.branchId,
        responsibleBranchId: contract.serviceBranchId ?? contract.branchId,
        contractId,
        customerId,
        source: {
          sourceType: 'contract',
          contractId,
          sourceLabel: draft.beneficiaryKind !== 'contract_customer' ? 'وعد وسيط بيعة من العقد' : 'وعد زبون العقد',
          quantity,
        },
      };
      try {
        await api.gifts.records.create(payload);
      } catch (error: any) {
        if (error?.payload?.code !== 'similar_gift_promises') throw error;
        const similarCount = Number(error.payload?.similarCount) || 0;
        const proceed = window.confirm(
          `تنبيه: يوجد ${similarCount} وعد/وعود غير منتهية مشابهة لهذا المستفيد. هل تريد إنشاء وعد جديد مستقل؟`,
        );
        if (!proceed) throw new Error('تم إيقاف الحفظ بعد تنبيه الوعود المشابهة');
        await api.gifts.records.create({ ...payload, similarPromiseWarningAcknowledged: true });
      }
      setDialogOpen(false);
      setReloadToken(token => token + 1);
    } catch (err: any) {
      setSaveError(err?.message ?? 'تعذر حفظ وعد الهدية على الخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sky-50 p-2 text-sky-700">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">هدايا العقد</h3>
            <p className="mt-1 text-xs leading-6 text-slate-500">
              {loading
                ? 'جاري تحميل هدايا العقد...'
                : loadError ?? 'وعد الهدية ينشأ يدوياً من العقد للزبون صاحب العقد أو لوسيط بيعة من نوع زبون.'}
            </p>
          </div>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openDialog}
            disabled={!contractId}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-sky-200 px-3 text-xs font-bold text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            إضافة وعد هدية
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-bold text-slate-500">وعود زبون العقد</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{customerRecords}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-bold text-slate-500">وعود وسيط زبون</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{referrerRecords}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-bold text-slate-500">إجمالي السجلات</div>
          <div className="mt-1 text-lg font-bold text-slate-900">{records.length}</div>
        </div>
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
        <Info className="mt-1 h-4 w-4 shrink-0" />
        <span>
          تحقق الشرط يدوي، وإنشاء مهمة تسليم الهدية ليس مشروطاً آلياً بحالة تحقق الشرط.
        </span>
      </div>

      <GiftRecordsTable records={records} compact onChanged={() => setReloadToken(token => token + 1)} />

      <Modal
        isOpen={dialogOpen}
        onClose={closeDialog}
        title="إضافة وعد هدية"
        size="2xl"
        bodyClassName="p-5"
        footer={
          <>
            <button
              type="button"
              onClick={closeDialog}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              إلغاء
            </button>
            <button
              type="button"
              onClick={addGiftRecord}
              disabled={
                saving
                || !draft.giftDefinitionId
                || !draft.conditionId
                || (
                  conditions.find(condition => String(condition.id) === draft.conditionId)?.requiresNotes
                  && !draft.conditionNotes.trim()
                )
                || (
                  draft.beneficiaryKind !== 'contract_customer'
                  && !referrers.some(referrer => referrer.beneficiaryType === draft.beneficiaryKind)
                )
              }
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'جاري الحفظ...' : 'إضافة السجل'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" dir="rtl">
          <div className="text-xs font-bold text-slate-500">
            تعريف الهدية
            <Select<string>
              className="mt-1 w-full"
              value={draft.giftDefinitionId}
              onChange={(value) => setDraft(prev => ({ ...prev, giftDefinitionId: value }))}
              placeholder="— اختر تعريفاً —"
              ariaLabel="تعريف الهدية"
              options={definitions.map(definition => ({ value: String(definition.id), label: definition.name }))}
            />
          </div>

          <div className="text-xs font-bold text-slate-500">
            المستفيد
            <Select<string>
              className="mt-1 w-full"
              value={draft.beneficiaryKind}
              onChange={(value) => {
                const beneficiaryKind = value as DraftBeneficiaryKind;
                setDraft(prev => ({
                  ...prev,
                  beneficiaryKind,
                  referrerKey: beneficiaryKind === 'contract_customer'
                    ? ''
                    : referrers.find(referrer => referrer.beneficiaryType === beneficiaryKind)?.key ?? '',
                }));
              }}
              ariaLabel="المستفيد"
              options={[
                { value: 'contract_customer', label: `زبون العقد: ${contractCustomerName(contract)}` },
                { value: 'customer_referrer', label: 'وسيط بيعة من نوع زبون', disabled: !referrers.some(r => r.beneficiaryType === 'customer_referrer') },
                { value: 'employee_referrer', label: 'وسيط بيعة من نوع موظف', disabled: !referrers.some(r => r.beneficiaryType === 'employee_referrer') },
                { value: 'personal_referrer', label: 'وسيط بيعة شخصي', disabled: !referrers.some(r => r.beneficiaryType === 'personal_referrer') },
              ]}
            />
          </div>

          {draft.beneficiaryKind !== 'contract_customer' && (
            <div className="text-xs font-bold text-slate-500 md:col-span-2">
              وسيط البيع
              <Select<string>
                className="mt-1 w-full"
                value={draft.referrerKey}
                onChange={(value) => setDraft(prev => ({ ...prev, referrerKey: value }))}
                ariaLabel="وسيط البيع"
                options={referrers
                  .filter(referrer => referrer.beneficiaryType === draft.beneficiaryKind)
                  .map(referrer => ({ value: referrer.key, label: referrer.name }))}
              />
            </div>
          )}

          <div className="text-xs font-bold text-slate-500">
            شرط/سبب الوعد
            <Select<string>
              className="mt-1 w-full"
              value={draft.conditionId}
              onChange={(value) => setDraft(prev => ({ ...prev, conditionId: value }))}
              ariaLabel="شرط/سبب الوعد"
              options={conditions.map(condition => ({ value: String(condition.id), label: condition.label }))}
            />
          </div>

          <div className="text-xs font-bold text-slate-500">
            حالة تحقق الشرط
            <div className="mt-1 flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
              بانتظار التحقق
            </div>
          </div>

          {conditions.find(condition => String(condition.id) === draft.conditionId)?.requiresNotes && (
            <label className="text-xs font-bold text-slate-500 md:col-span-2">
              ملاحظات الشرط *
              <textarea
                value={draft.conditionNotes}
                onChange={(event) => setDraft(prev => ({ ...prev, conditionNotes: event.target.value }))}
                className="mt-1 min-h-[72px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />
            </label>
          )}

          <label className="text-xs font-bold text-slate-500">
            العدد
            <input
              type="number"
              min={1}
              value={draft.quantity}
              onChange={(event) => setDraft(prev => ({ ...prev, quantity: Number(event.target.value) || 1 }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            />
          </label>
        </div>

        {saveError && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-6 text-rose-700">
            {saveError}
          </div>
        )}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-600">
          يُحفظ الوعد في <span dir="ltr" className="font-mono">gift_records</span> بحالة "وعد"، ويظهر مباشرة في تبويب المستفيد وصفحة إدارة الهدايا.
        </div>
      </Modal>
    </section>
  );
}
