import { useEffect, useMemo, useState } from 'react';
import IconButton from '../../components/ui/IconButton';
import { AlertCircle, CheckCircle2, Clock, Loader2, MapPin, Plus, Trash2, Wrench, X, XCircle, Zap } from 'lucide-react';
import { api } from '../../lib/api';
import GeoSmartSearch, { formatGeoUnitLastLevels, type GeoSelection } from '../../components/GeoSmartSearch';
import MapPicker from '../../components/MapPicker';
import PaymentEntriesList, { newEntry, type PaymentEntry } from '../../components/emergency/PaymentEntriesList';
import Select from '../../components/ui/Select';

type InstallationDecision = 'installed_successfully' | 'installation_incomplete' | 'refused_installation';

type AddressDraft = {
  geoSelection: GeoSelection;
  detailedAddress: string;
  mapPosition: [number, number] | null;
  showMap: boolean;
};

type InstallationPartDraft = {
  source: 'customer_stock' | 'company_stock' | 'external_or_manual';
  placement_state: 'installed' | 'customer_stock';
  spare_part_id: string;
  part_name: string;
  part_code: string;
  maintenance_type: string;
  quantity: string;
  unit_price: string;
  customer_stock_id: string;
  customer_stock_origin: string;
  notes: string;
};

const PART_TYPE_LABELS: Record<string, string> = {
  Periodic: 'قطع الصيانة الدورية',
  Emergency: 'قطع الصيانة الطارئة',
  Accessory: 'إكسسوارات',
};

const STOCK_ITEM_TYPE_BY_MAINTENANCE_TYPE: Record<string, string[]> = {
  Periodic: ['periodic_part'],
  Emergency: ['emergency_part'],
  Accessory: ['accessory', 'accessory_part'],
};

const emptyGeoSelection: GeoSelection = { govId: '', regionId: '', subId: '', neighborhoodId: '' };

const DECISION_CARDS: Array<{ value: InstallationDecision; title: string; desc: string; Icon: any; cls: string }> = [
  { value: 'installed_successfully', title: 'تم التركيب', desc: 'تثبيت الموقع وإنشاء مهمة تشغيل', Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { value: 'installation_incomplete', title: 'لم يكتمل', desc: 'تبقى المهمة للمتابعة بتاريخ جديد', Icon: Clock, cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'refused_installation', title: 'رفض التركيب', desc: 'إلغاء المهمة دون تغيير حالة الجهاز', Icon: XCircle, cls: 'border-rose-200 bg-rose-50 text-rose-700' },
];

function deepestGeoId(selection: GeoSelection) {
  return selection.neighborhoodId || selection.subId || selection.regionId || selection.govId || '';
}

function makeAddress(initialGeoUnitId?: number | null, detailedAddress = ''): AddressDraft {
  return {
    geoSelection: initialGeoUnitId ? { ...emptyGeoSelection, neighborhoodId: String(initialGeoUnitId) } : { ...emptyGeoSelection },
    detailedAddress,
    mapPosition: null,
    showMap: false,
  };
}

function formatAddress(geoUnits: any[], draft: AddressDraft) {
  const geoLabel = formatGeoUnitLastLevels(geoUnits, deepestGeoId(draft.geoSelection));
  return [geoLabel, draft.detailedAddress.trim()].filter(Boolean).join('، ');
}

function AddressFields({
  geoUnits,
  value,
  onChange,
}: {
  geoUnits: any[];
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
}) {
  const setPatch = (patch: Partial<AddressDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <GeoSmartSearch
        geoUnits={geoUnits}
        value={value.geoSelection}
        onChange={(geoSelection) => setPatch({ geoSelection })}
        label="موقع التركيب النهائي"
        required
        minSelectableLevel={3}
        placeholder="ابحث عن المحافظة، المنطقة، الناحية أو الحي"
      />
      <label className="block space-y-1.5">
        <span className="text-xs font-bold text-slate-500">العنوان التفصيلي *</span>
        <textarea
          value={value.detailedAddress}
          onChange={(e) => setPatch({ detailedAddress: e.target.value })}
          rows={2}
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
          placeholder="رقم البناء، الطابق، أقرب نقطة دالة..."
        />
      </label>
      <div className="space-y-2">
        <IconButton icon={X} label="إغلاق" onClick={() => setPatch({ showMap: !value.showMap })} />
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {DECISION_CARDS.map(({ value, title, desc, Icon, cls }) => {
              const selected = decision === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDecision(value)}
                  className={`min-h-[108px] rounded-lg border p-3 text-right transition ${
                    selected ? `${cls} shadow-sm ring-2 ring-offset-1 ring-current/20` : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="mb-2 h-5 w-5" />
                  <div className="text-sm font-black">{title}</div>
                  <div className="mt-1 text-xs opacity-80">{desc}</div>
                </button>
              );
            })}
          </div>

          {decision === 'installed_successfully' && (
            <>
              <AddressFields geoUnits={activeGeoUnits} value={finalAddress} onChange={setFinalAddress} />
              <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="flex items-center gap-1 text-xs font-bold text-slate-500">
                    <Zap className="h-3.5 w-3.5" />
                    تاريخ متابعة التشغيل
                  </span>
                  <input type="date" value={activationDueDate} onChange={(e) => setActivationDueDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={customerAcknowledged} onChange={(e) => setCustomerAcknowledged(e.target.checked)} />
                  إقرار الزبون بإتمام التركيب
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">اسم المستلم *</span>
                  <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">توقيع المستلم *</span>
                  <input value={receiverSignature} onChange={(e) => setReceiverSignature(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">قطع التركيب</div>
                    <div className="text-xs text-slate-400">اختيارية، وتظهر ضمن نتيجة التركيب والفاتورة اللاحقة</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setParts((prev) => [...prev, emptyPart()])}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    إضافة قطعة
                  </button>
                </div>
                {parts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs font-semibold text-slate-400">
                    لا توجد قطع مسجلة
                  </div>
                ) : (
                  <div className="space-y-3">
                    {parts.map((part, index) => {
                      const updatePart = (patch: Partial<InstallationPartDraft>) => {
                        setParts((prev) => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
                      };
                      const filteredSpareParts = part.maintenance_type
                        ? spareParts.filter((sp) => sp.maintenanceType === part.maintenance_type)
                        : [];
                      const allowedCustomerItemTypes = part.maintenance_type
                        ? STOCK_ITEM_TYPE_BY_MAINTENANCE_TYPE[part.maintenance_type] ?? []
                        : [];
                      const filteredCustomerStock = part.maintenance_type
                        ? customerStock.filter((stock) => allowedCustomerItemTypes.includes(stock.itemType))
                        : [];
                      return (
                        <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-xs font-black text-slate-500">قطعة #{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => setParts((prev) => prev.filter((_, i) => i !== index))}
                              className="rounded-lg p-1 text-rose-500 hover:bg-rose-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">المصدر</span>
                              <Select<InstallationPartDraft['source']>
                                value={part.source}
                                onChange={(v) => updatePart({
                                  source: v,
                                  spare_part_id: '',
                                  customer_stock_id: '',
                                  part_name: '',
                                  part_code: '',
                                  unit_price: v === 'customer_stock' ? '0' : part.unit_price,
                                  customer_stock_origin: '',
                                })}
                                className="w-full"
                                ariaLabel="المصدر"
                                options={[
                                  { value: 'company_stock', label: 'مخزون الشركة' },
                                  { value: 'customer_stock', label: 'مخزون الزبون' },
                                  { value: 'external_or_manual', label: 'إدخال يدوي' },
                                ]}
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">الحالة</span>
                              <Select<InstallationPartDraft['placement_state']>
                                value={part.placement_state}
                                onChange={(v) => updatePart({ placement_state: v })}
                                className="w-full"
                                ariaLabel="الحالة"
                                options={[
                                  { value: 'installed', label: 'مركبة' },
                                  { value: 'customer_stock', label: 'مسلمة للمخزون' },
                                ]}
                              />
                            </label>
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">نوع القطعة</span>
                              <Select
                                value={part.maintenance_type}
                                onChange={(v) => updatePart({
                                  maintenance_type: v,
                                  spare_part_id: '',
                                  customer_stock_id: '',
                                  part_name: '',
                                  part_code: '',
                                  unit_price: part.source === 'customer_stock' ? '0' : part.unit_price,
                                  customer_stock_origin: '',
                                })}
                                className="w-full"
                                placeholder="اختر النوع"
                                ariaLabel="نوع القطعة"
                                options={[
                                  { value: '', label: 'اختر النوع' },
                                  { value: 'Periodic', label: PART_TYPE_LABELS.Periodic },
                                  { value: 'Emergency', label: PART_TYPE_LABELS.Emergency },
                                  { value: 'Accessory', label: PART_TYPE_LABELS.Accessory },
                                ]}
                              />
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            {part.source === 'customer_stock' ? (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">قطعة من مخزون الزبون</span>
                                <Select
                                  value={part.customer_stock_id}
                                  disabled={!part.maintenance_type}
                                  onChange={(v) => {
                                    const selected = customerStock.find((stock) => String(stock.stockId) === v);
                                    updatePart({
                                      spare_part_id: selected?.itemId ? String(selected.itemId) : '',
                                      customer_stock_id: v,
                                      part_name: selected?.itemName ?? '',
                                      part_code: selected?.itemCode ?? '',
                                      maintenance_type:
                                        selected?.itemType === 'periodic_part' ? 'Periodic'
                                          : selected?.itemType === 'emergency_part' ? 'Emergency'
                                            : 'Accessory',
                                      unit_price: '0',
                                      customer_stock_origin: Array.isArray(selected?.sources)
                                        ? selected.sources.map((source: any) => source.sourceLabel).filter(Boolean).join('، ')
                                        : '',
                                    });
                                  }}
                                  className="w-full"
                                  placeholder={part.maintenance_type ? `اختر من ${PART_TYPE_LABELS[part.maintenance_type]}` : 'اختر نوع القطعة أولاً'}
                                  ariaLabel="قطعة من مخزون الزبون"
                                  options={filteredCustomerStock.map((stock) => ({
                                    value: String(stock.stockId),
                                    label: `${stock.itemName} - المتوفر ${stock.quantityAvailable}`,
                                  }))}
                                />
                              </label>
                            ) : part.source === 'company_stock' ? (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">القطعة</span>
                                <Select
                                  value={part.spare_part_id}
                                  disabled={!part.maintenance_type}
                                  onChange={(v) => {
                                    const selected = spareParts.find((sp) => String(sp.id) === v);
                                    updatePart({
                                      spare_part_id: v,
                                      part_name: selected?.name ?? '',
                                      part_code: selected?.code ?? '',
                                      maintenance_type: selected?.maintenanceType ?? part.maintenance_type,
                                      unit_price: selected?.basePrice != null ? String(selected.basePrice) : part.unit_price,
                                    });
                                  }}
                                  className="w-full"
                                  placeholder={part.maintenance_type ? `اختر من ${PART_TYPE_LABELS[part.maintenance_type]}` : 'اختر نوع القطعة أولاً'}
                                  ariaLabel="القطعة"
                                  options={filteredSpareParts.map((sp) => ({ value: String(sp.id), label: sp.name }))}
                                />
                              </label>
                            ) : (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">اسم القطعة</span>
                                <input value={part.part_name} onChange={(e) => updatePart({ part_name: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                              </label>
                            )}
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">الكمية</span>
                              <input type="number" min="1" value={part.quantity} onChange={(e) => updatePart({ quantity: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <label className="space-y-1.5">
                              <span className="text-xs font-bold text-slate-500">السعر</span>
                              <input type="number" min="0" value={part.unit_price} disabled={part.source === 'customer_stock'} onChange={(e) => updatePart({ unit_price: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
                            </label>
                            {part.source === 'customer_stock' && (
                              <label className="space-y-1.5 md:col-span-2">
                                <span className="text-xs font-bold text-slate-500">أصل القطعة للقراءة فقط</span>
                                <input value={part.customer_stock_origin || 'غير محدد'} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500" />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-800">الدفع والوصل</div>
                    <div className="text-xs text-slate-500">خاص بالقطع المباعة أثناء التركيب. قطع مخزون الزبون تظهر بقيمة معدومة لأنها مدفوعة مسبقا.</div>
                  </div>
                  <button
                    type="button"
                    onClick={printReceipt}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                  >
                    طباعة وصل
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold text-slate-500">نوع الدفع</span>
                    <Select<'cash' | 'installment' | ''>
                      value={paymentType}
                      onChange={(v) => setPaymentType(v)}
                      className="w-full"
                      ariaLabel="نوع الدفع"
                      options={[
                        { value: '', label: 'غير محدد' },
                        { value: 'cash', label: 'كاش' },
                        { value: 'installment', label: 'تقسيط' },
                      ]}
                    />
                  </label>
                  <div className="rounded-lg border border-white bg-white px-3 py-2">
                    <div className="flex justify-between text-xs font-bold text-slate-500">
                      <span>إجمالي القطع</span>
                      <span>{formatSyp(partsTotal)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-xs font-bold text-slate-500">
                      <span>المدفوع</span>
                      <span>{formatSyp(totalPaidSyp)}</span>
                    </div>
                    <div className={`mt-1 flex justify-between border-t pt-1 text-sm font-black ${paymentGap >= 0 ? 'border-emerald-100 text-emerald-700' : 'border-amber-100 text-amber-700'}`}>
                      <span>{paymentGap >= 0 ? 'مغطى' : 'المتبقي'}</span>
                      <span>{paymentGap >= 0 ? formatSyp(paymentGap) : formatSyp(Math.abs(paymentGap))}</span>
                    </div>
                  </div>
                </div>

                <PaymentEntriesList
                  entries={paymentEntries}
                  onChange={setPaymentEntries}
                  grandTotal={partsTotal}
                  label={paymentType === 'installment' ? 'الدفعة الأولى' : 'الدفعات الجزئية'}
                />

                <label className="block space-y-1.5">
                  <span className="text-xs font-bold text-slate-500">ملاحظات الفاتورة</span>
                  <textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    placeholder="تفاصيل الدفع أو ملاحظة على الوصل..."
                  />
                </label>
              </div>
            </>
          )}

          {decision === 'installation_incomplete' && (
            <div className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب عدم الاكتمال</span>
                <Select
                  value={incompleteReasonId}
                  onChange={(v) => setIncompleteReasonId(v)}
                  className="w-full"
                  placeholder="اختر السبب"
                  ariaLabel="سبب عدم الاكتمال"
                  options={incompleteReasons.map((reason) => ({ value: String(reason.id), label: reason.value }))}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">تاريخ المتابعة</span>
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {decision === 'refused_installation' && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <label className="space-y-1.5">
                <span className="text-xs font-bold text-slate-500">سبب الرفض</span>
                <Select
                  value={refusalReasonId}
                  onChange={(v) => setRefusalReasonId(v)}
                  className="w-full"
                  placeholder="اختر السبب"
                  ariaLabel="سبب الرفض"
                  options={refusalReasons.map((reason) => ({ value: String(reason.id), label: reason.value }))}
                />
              </label>
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-500">ملاحظات</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ النتيجة
          </button>
        </div>
      </div>
    </div>
  );
}
