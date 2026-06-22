import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Client, DeviceDiscount, DeviceModel, SystemList } from '../../lib/types';
import Select from '../ui/Select';
import IconButton from '../ui/IconButton';

type OfferDraft = {
  deviceModelId: string;
  offerType: '' | 'cash' | 'installment';
  quantity: string;
  unitPrice: string;
  firstPaymentAmount: string;
  installmentMonths: string;
  discountPercentage: string;
  appliedDeviceDiscountId: string;
  closedByEmployeeId: string;
  noClosingReason: string;
};

type Closer = { id: number; name: string };
type Option = { value: string; label: string };
const INPUT_CLASS = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  client: Client;
  onCreated: () => void;
}

function emptyDraft(): OfferDraft {
  return {
    deviceModelId: '',
    offerType: '',
    quantity: '1',
    unitPrice: '',
    firstPaymentAmount: '',
    installmentMonths: '',
    discountPercentage: '',
    appliedDeviceDiscountId: '',
    closedByEmployeeId: '',
    noClosingReason: '',
  };
}

function positiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function money(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : value;
}

export default function StandaloneDeviceOffersModal({ isOpen, onClose, client, onCreated }: Props) {
  const [deviceModels, setDeviceModels] = useState<DeviceModel[]>([]);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [noClosingReasons, setNoClosingReasons] = useState<Option[]>([]);
  const [deviceDiscounts, setDeviceDiscounts] = useState<DeviceDiscount[]>([]);
  const [draft, setDraft] = useState<OfferDraft>(emptyDraft());
  const [offers, setOffers] = useState<OfferDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError('');
    setDraft(emptyDraft());
    setOffers([]);
    Promise.all([
      api.deviceModels.list(),
      api.employees.employeeClosers(),
      api.systemLists.getItemsByCode('no_closing_reasons'),
    ])
      .then(([models, closerRows, noClosingRows]) => {
        setDeviceModels(models);
        setClosers(closerRows);
        const reasons = (noClosingRows as SystemList[])
          .filter(row => row.value?.trim())
          .map(row => ({ value: row.value, label: row.value }));
        setNoClosingReasons(reasons.length > 0 ? reasons : [
          { value: 'متابعة لاحقة', label: 'متابعة لاحقة' },
          { value: 'العميل طلب مهلة', label: 'العميل طلب مهلة' },
          { value: 'سبب سعري', label: 'سبب سعري' },
          { value: 'أخرى', label: 'أخرى' },
        ]);
      })
      .catch((err: any) => setError(err.message || 'فشل في تحميل بيانات العروض'))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    setDeviceDiscounts([]);
    updateDraft('discountPercentage', '');
    updateDraft('appliedDeviceDiscountId', '');
    updateDraft('unitPrice', '');
    if (!draft.deviceModelId) return;
    const model = deviceModels.find(item => String(item.id) === draft.deviceModelId);
    if (model?.basePrice) updateDraft('unitPrice', String(model.basePrice));
    api.deviceModels.getDiscounts(Number(draft.deviceModelId))
      .then(setDeviceDiscounts)
      .catch(() => setDeviceDiscounts([]));
  }, [draft.deviceModelId]);

  const usedDeviceIds = useMemo(() => new Set(offers.map(offer => offer.deviceModelId)), [offers]);
  const availableDevices = deviceModels.filter(model => !usedDeviceIds.has(String(model.id)));

  if (!isOpen) return null;

  function updateDraft(field: keyof OfferDraft, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
  }

  function validate(offer: OfferDraft): string {
    if (!offer.deviceModelId) return 'اختر الجهاز';
    if (!offer.offerType) return 'اختر نوع العرض';
    if (!positiveNumber(offer.unitPrice)) return 'أدخل قيمة العرض';
    if (offer.discountPercentage && !offer.appliedDeviceDiscountId) return 'يجب اختيار الحسم من قائمة حسومات الجهاز';
    if (offer.offerType === 'installment' && (!positiveNumber(offer.firstPaymentAmount) || !positiveInteger(offer.installmentMonths))) {
      return 'استكمل بيانات التقسيط';
    }
    if (!offer.closedByEmployeeId && !offer.noClosingReason) return 'اختر موظف التسكير أو سبب عدم التسكير';
    return '';
  }

  function addOffer() {
    const validationError = validate(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (usedDeviceIds.has(draft.deviceModelId)) {
      setError('هذا الجهاز لديه عرض مثبت بالفعل');
      return;
    }
    setOffers(current => [...current, { ...draft }]);
    setDraft(emptyDraft());
    setDeviceDiscounts([]);
    setError('');
  }

  async function submit() {
    setError('');
    if (offers.length === 0) {
      setError('أضف عرضا واحدا على الأقل');
      return;
    }
    setSaving(true);
    try {
      await api.customers.createPreOffers(client.id, {
        branchId: (client as any).branchId ?? null,
        offers: offers.map(offer => ({
          deviceModelId: Number(offer.deviceModelId),
          offerType: offer.offerType,
          quantity: positiveInteger(offer.quantity) ?? 1,
          totalAmount: positiveNumber(offer.unitPrice) ?? 0,
          firstPaymentAmount: offer.firstPaymentAmount ? positiveNumber(offer.firstPaymentAmount) : null,
          installmentMonths: offer.installmentMonths ? positiveInteger(offer.installmentMonths) : null,
          currency: 'SYP',
          discountPercentage: offer.discountPercentage ? Number(offer.discountPercentage) : null,
          appliedDeviceDiscountId: offer.appliedDeviceDiscountId ? Number(offer.appliedDeviceDiscountId) : null,
          closedByEmployeeId: offer.closedByEmployeeId ? Number(offer.closedByEmployeeId) : null,
          noClosingReason: offer.noClosingReason.trim() || null,
        })),
      });
      onCreated();
    } catch (err: any) {
      setError(err.message || 'فشل في إنشاء عروض الأجهزة');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" dir="rtl">
      <div className="w-full max-w-5xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">إنشاء عروض أجهزة مستقلة</h3>
            <p className="mt-1 text-xs text-slate-500">{client.name}</p>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>

        <div className="max-h-[78vh] space-y-5 overflow-y-auto bg-slate-50/50 px-6 py-6">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800">العرض الجديد</h4>
                    <p className="text-xs text-slate-500">هذه العروض تبقى على الزبون، وستستورد تلقائيا عند إنشاء مهمة عرض جهاز إذا كانت بلا رد أو مؤجلة.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addOffer}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700"
                  >
                    <Plus className="h-4 w-4" />
                    تثبيت العرض
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="الجهاز">
                    <Select
                      value={draft.deviceModelId}
                      onChange={v => updateDraft('deviceModelId', v)}
                      placeholder="اختر الجهاز..."
                      ariaLabel="الجهاز"
                      className="w-full"
                      options={availableDevices.map(model => ({ value: String(model.id), label: model.nameAr || model.name }))}
                    />
                  </Field>
                  <Field label="نوع العرض">
                    <Select
                      value={draft.offerType}
                      onChange={v => updateDraft('offerType', v)}
                      placeholder="اختر..."
                      ariaLabel="نوع العرض"
                      className="w-full"
                      options={[
                        { value: 'cash', label: 'كاش' },
                        { value: 'installment', label: 'تقسيط' },
                      ]}
                    />
                  </Field>
                  <Field label="الكمية">
                    <input type="number" min={1} value={draft.quantity} onChange={e => updateDraft('quantity', e.target.value)} className={INPUT_CLASS} />
                  </Field>
                  <Field label="قيمة العرض">
                    <input type="number" min={0} value={draft.unitPrice} onChange={e => updateDraft('unitPrice', e.target.value)} className={INPUT_CLASS} />
                  </Field>

                  {draft.deviceModelId && (
                    <Field label="حسم الجهاز">
                      <Select
                        value={draft.appliedDeviceDiscountId}
                        onChange={v => {
                          const discount = deviceDiscounts.find(item => String(item.id) === v);
                          updateDraft('appliedDeviceDiscountId', v);
                          updateDraft('discountPercentage', discount ? String(discount.percentage) : '');
                        }}
                        placeholder="بدون حسم"
                        ariaLabel="حسم الجهاز"
                        className="w-full"
                        options={deviceDiscounts.map(discount => ({ value: String(discount.id), label: `${discount.label} (${discount.percentage}%)` }))}
                      />
                      {deviceDiscounts.length === 0 && (
                        <p className="text-xs text-slate-400">لا توجد حسومات فعالة لهذا الجهاز.</p>
                      )}
                    </Field>
                  )}

                  <Field label="موظف التسكير">
                    <Select
                      value={draft.closedByEmployeeId}
                      onChange={v => {
                        updateDraft('closedByEmployeeId', v);
                        if (v) updateDraft('noClosingReason', '');
                      }}
                      placeholder="اختياري"
                      ariaLabel="موظف التسكير"
                      className="w-full"
                      options={closers.map(closer => ({ value: String(closer.id), label: closer.name }))}
                    />
                  </Field>
                  <Field label="سبب عدم التسكير">
                    <Select
                      value={draft.noClosingReason}
                      onChange={v => {
                        updateDraft('noClosingReason', v);
                        if (v) updateDraft('closedByEmployeeId', '');
                      }}
                      disabled={!!draft.closedByEmployeeId}
                      placeholder="بدون سبب"
                      ariaLabel="سبب عدم التسكير"
                      className="w-full"
                      options={noClosingReasons.map(reason => ({ value: reason.value, label: reason.label }))}
                    />
                  </Field>

                  {draft.offerType === 'installment' && (
                    <>
                      <Field label="الدفعة الأولى">
                        <input type="number" min={0} value={draft.firstPaymentAmount} onChange={e => updateDraft('firstPaymentAmount', e.target.value)} className={INPUT_CLASS} />
                      </Field>
                      <Field label="عدد الأشهر">
                        <input type="number" min={1} value={draft.installmentMonths} onChange={e => updateDraft('installmentMonths', e.target.value)} className={INPUT_CLASS} />
                      </Field>
                    </>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-right font-bold">الجهاز</th>
                      <th className="px-4 py-3 text-right font-bold">النوع</th>
                      <th className="px-4 py-3 text-right font-bold">القيمة</th>
                      <th className="px-4 py-3 text-right font-bold">الحالة</th>
                      <th className="px-4 py-3 text-right font-bold">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {offers.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">لا توجد عروض مثبتة بعد.</td></tr>
                    ) : offers.map((offer, index) => {
                      const device = deviceModels.find(model => String(model.id) === offer.deviceModelId);
                      return (
                        <tr key={`${offer.deviceModelId}-${index}`}>
                          <td className="px-4 py-3 font-bold text-slate-800">{device?.nameAr || device?.name || '-'}</td>
                          <td className="px-4 py-3 text-slate-600">{offer.offerType === 'cash' ? 'كاش' : 'تقسيط'}</td>
                          <td className="px-4 py-3 text-slate-600">{money(offer.unitPrice)} SYP</td>
                          <td className="px-4 py-3 text-slate-600">بانتظار الرد</td>
                          <td className="px-4 py-3">
                            <button onClick={() => setOffers(current => current.filter((_, i) => i !== index))} className="text-red-500 hover:text-red-700">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>

              {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving || loading} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ العروض
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="block text-sm font-bold text-slate-700">{label}</span>
      {children}
    </label>
  );
}
