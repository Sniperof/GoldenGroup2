import { useEffect, useMemo, useState } from 'react';
import { Gift, Info, Plus, Save, X } from 'lucide-react';
import Modal from '../../components/ui/Modal';
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

type DraftBeneficiaryKind = 'contract_customer' | 'customer_referrer';

interface CustomerReferrerOption {
  key: string;
  name: string;
  clientId: string | number | null;
}

interface PromiseConditionOption {
  id: number;
  label: string;
}

interface GiftPromiseDraft {
  giftDefinitionId: string;
  beneficiaryKind: DraftBeneficiaryKind;
  referrerKey: string;
  conditionId: string;
  conditionStatus: GiftConditionStatus;
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
    .filter((referrer: any) => {
      const type = String(referrer?.referrerType ?? '').toLowerCase();
      return type === 'client' || type === 'customer';
    })
    .map((referrer: any, index: number) => ({
      key: String(referrer?.id ?? referrer?.referrerClientId ?? referrer?.clientId ?? index),
      name: referrer?.referrerName ?? 'وسيط زبون',
      clientId: referrer?.referrerClientId ?? referrer?.clientId ?? null,
    }));
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
  }, [contractId, reloadToken]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.gifts.definitions.list().catch(() => []),
      api.systemLists.getItemsByCode('gift_promise_conditions').catch(() => []),
    ]).then(([defs, conds]) => {
      if (!active) return;
      setDefinitions((defs as GiftDefinitionPrototype[]).filter(d => d.isActive));
      setConditions((conds as any[]).map(item => ({ id: Number(item.id), label: item.label ?? item.value ?? String(item.id) })));
    });
    return () => { active = false; };
  }, []);

  const preferredDefinition = useMemo(() => (
    definitions.find(d => (isGiftContract ? d.kind === 'gift_contract' : d.kind === 'standard_gift')) ?? definitions[0]
  ), [definitions, isGiftContract]);

  const customerRecords = records.filter(record => record.beneficiaryType === 'contract_customer').length;
  const referrerRecords = records.filter(record => record.beneficiaryType === 'customer_referrer').length;

  function openDialog() {
    setSaveError(null);
    setDraft({
      giftDefinitionId: preferredDefinition?.id != null ? String(preferredDefinition.id) : '',
      beneficiaryKind: 'contract_customer',
      referrerKey: referrers[0]?.key ?? '',
      conditionId: conditions[0]?.id != null ? String(conditions[0].id) : '',
      conditionStatus: isGiftContract ? 'met' : 'pending',
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
    const beneficiaryType: GiftBeneficiaryType = draft.beneficiaryKind === 'customer_referrer'
      ? 'customer_referrer'
      : 'contract_customer';
    const beneficiaryName = draft.beneficiaryKind === 'customer_referrer'
      ? selectedReferrer?.name ?? 'وسيط زبون'
      : contractCustomerName(contract);
    const beneficiaryClientId = draft.beneficiaryKind === 'customer_referrer'
      ? selectedReferrer?.clientId ?? null
      : customerId;

    if (!beneficiaryClientId) {
      setSaveError('المستفيد الزبون يجب أن يرتبط بسجل زبون معروف');
      return;
    }

    const conditionId = draft.conditionId ? Number(draft.conditionId) : undefined;
    const conditionLabel = conditions.find(c => String(c.id) === draft.conditionId)?.label;
    const quantity = Math.max(1, Number(draft.quantity) || 1);

    setSaving(true);
    setSaveError(null);
    try {
      await api.gifts.records.create({
        giftDefinitionId: Number(selectedDefinition.id),
        beneficiaryType,
        beneficiaryClientId,
        beneficiaryName,
        conditionId,
        conditionLabel,
        conditionStatus: draft.conditionStatus,
        approvedQuantity: quantity,
        quantity,
        sourceBranchId: contract.branchId,
        responsibleBranchId: contract.serviceBranchId ?? contract.branchId,
        contractId,
        customerId,
        source: {
          sourceType: 'contract',
          contractId,
          sourceLabel: draft.beneficiaryKind === 'customer_referrer' ? 'وعد وسيط بيعة من العقد' : 'وعد زبون العقد',
          quantity,
        },
      });
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
              disabled={saving || !draft.giftDefinitionId || (draft.beneficiaryKind === 'customer_referrer' && referrers.length === 0)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'جاري الحفظ...' : 'إضافة السجل'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" dir="rtl">
          <label className="text-xs font-bold text-slate-500">
            تعريف الهدية
            <select
              value={draft.giftDefinitionId}
              onChange={(event) => setDraft(prev => ({ ...prev, giftDefinitionId: event.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="">— اختر تعريفاً —</option>
              {definitions.map(definition => (
                <option key={definition.id} value={String(definition.id)}>{definition.name}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-500">
            المستفيد
            <select
              value={draft.beneficiaryKind}
              onChange={(event) => setDraft(prev => ({
                ...prev,
                beneficiaryKind: event.target.value as DraftBeneficiaryKind,
              }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="contract_customer">زبون العقد: {contractCustomerName(contract)}</option>
              <option value="customer_referrer" disabled={referrers.length === 0}>وسيط بيعة من نوع زبون</option>
            </select>
          </label>

          {draft.beneficiaryKind === 'customer_referrer' && (
            <label className="text-xs font-bold text-slate-500 md:col-span-2">
              وسيط البيع الزبون
              <select
                value={draft.referrerKey}
                onChange={(event) => setDraft(prev => ({ ...prev, referrerKey: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                {referrers.map(referrer => (
                  <option key={referrer.key} value={referrer.key}>{referrer.name}</option>
                ))}
              </select>
            </label>
          )}

          <label className="text-xs font-bold text-slate-500">
            شرط/سبب الوعد
            <select
              value={draft.conditionId}
              onChange={(event) => setDraft(prev => ({ ...prev, conditionId: event.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              <option value="">— بدون شرط محدد —</option>
              {conditions.map(condition => (
                <option key={condition.id} value={String(condition.id)}>{condition.label}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-500">
            حالة تحقق الشرط
            <select
              value={draft.conditionStatus}
              onChange={(event) => setDraft(prev => ({ ...prev, conditionStatus: event.target.value as GiftConditionStatus }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
            >
              {Object.entries(giftConditionStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

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
