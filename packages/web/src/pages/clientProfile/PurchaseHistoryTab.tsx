import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, History, Package, Cpu, Wrench, Receipt, BadgeDollarSign } from 'lucide-react';

import { api } from '../../lib/api';

interface Props {
  client: { id: number };
}

interface PurchaseRecord {
  id: string;
  purchaseDate: string | null;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  itemType: string;
  itemId: number | null;
  itemName: string;
  itemCode: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string;
  paymentType: string | null;
  isInstalled: boolean | null;
  oldPartRemoved: boolean | null;
  warrantyContext: string | null;
  warrantyUntil: string | null;
  deviceContext?: {
    contractId?: number | null;
    deviceModelName?: string | null;
  } | null;
  discountInfo?: {
    originalPrice?: number;
    discountAmount?: number;
    finalContractPrice?: number;
  } | null;
  notes?: string | null;
}

interface PurchaseHistoryResponse {
  customerId: number;
  records: PurchaseRecord[];
  summary: {
    totalPurchases: number;
    totalDevices: number;
    totalParts: number;
    totalSpent: number;
  };
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function fmtMoney(value?: number | null, currency = 'SYP') {
  if (value == null) return '—';
  return `${Number(value).toLocaleString('en-US')} ${currency}`;
}

function itemTypeLabel(type: string) {
  switch (type) {
    case 'device': return 'جهاز';
    case 'periodic_part': return 'قطعة دورية';
    case 'emergency_part': return 'قطعة طارئة';
    case 'accessory': return 'اكسسوار';
    default: return type || 'غير محدد';
  }
}

function sourceTypeLabel(type: string) {
  switch (type) {
    case 'contract': return 'عقد';
    case 'emergency_maintenance': return 'مهمة طارئة';
    default: return type || 'غير محدد';
  }
}

function paymentTypeLabel(type?: string | null) {
  switch ((type || '').toLowerCase()) {
    case 'cash': return 'نقدي';
    case 'installment': return 'تقسيط';
    case 'maintenance_paid': return 'مدفوع صيانة';
    default: return type || '—';
  }
}

function warrantyContextLabel(type?: string | null) {
  switch ((type || '').toLowerCase()) {
    case 'contract_warranty': return 'كفالة عقد';
    case 'golden_warranty': return 'الكفالة الذهبية';
    case 'no_warranty': return 'بدون كفالة';
    default: return type || '—';
  }
}

function purchaseIcon(type: string) {
  switch (type) {
    case 'device': return Cpu;
    case 'periodic_part':
    case 'emergency_part': return Wrench;
    case 'accessory': return Package;
    default: return Receipt;
  }
}

export function PurchaseHistoryTab({ client }: Props) {
  const [data, setData] = useState<PurchaseHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'contract' | 'emergency_maintenance'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.customers.getPurchaseHistory(client.id);
      setData(result);
    } catch (err) {
      console.error('[PurchaseHistoryTab] fetch failed:', err);
      setData({ customerId: client.id, records: [], summary: { totalPurchases: 0, totalDevices: 0, totalParts: 0, totalSpent: 0 } });
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const records = useMemo(() => {
    const base = data?.records ?? [];
    if (sourceFilter === 'all') return base;
    return base.filter((record) => record.sourceType === sourceFilter);
  }, [data, sourceFilter]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-bold">جاري تحميل سجل المشتريات...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-black text-slate-800">سجل المشتريات</h3>
          <p className="text-xs text-slate-400 font-bold mt-1">
            سجل تاريخي لكل ما دخل إلى علاقة الزبون مع الشركة عبر العقود والمهام.
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { key: 'all', label: 'الكل' },
            { key: 'contract', label: 'العقود' },
            { key: 'emergency_maintenance', label: 'المهام' },
          ].map((filter) => (
            <button
              key={filter.key}
              onClick={() => setSourceFilter(filter.key as typeof sourceFilter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                sourceFilter === filter.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <SummaryCard
          icon={History}
          label="إجمالي السجلات"
          value={String(data?.summary.totalPurchases ?? 0)}
          accent="text-sky-600"
        />
        <SummaryCard
          icon={Cpu}
          label="إجمالي الأجهزة"
          value={String(data?.summary.totalDevices ?? 0)}
          accent="text-violet-600"
        />
        <SummaryCard
          icon={Package}
          label="إجمالي القطع"
          value={String(data?.summary.totalParts ?? 0)}
          accent="text-amber-600"
        />
        <SummaryCard
          icon={BadgeDollarSign}
          label="القيمة الإجمالية"
          value={fmtMoney(data?.summary.totalSpent ?? 0)}
          accent="text-emerald-600"
        />
      </section>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {records.length === 0 ? (
          <div className="px-6 py-16 text-center text-slate-400">
            <History className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-bold">لا توجد سجلات مشتريات مطابقة للفلاتر الحالية.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {records.map((record) => {
              const Icon = purchaseIcon(record.itemType);
              return (
                <div key={record.id} className="px-5 py-4 hover:bg-slate-50/70 transition-colors">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-slate-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-sm font-black text-slate-800 truncate">{record.itemName}</h4>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-700">
                            {itemTypeLabel(record.itemType)}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">
                            {sourceTypeLabel(record.sourceType)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>{record.sourceLabel}</span>
                          {record.deviceContext?.deviceModelName && (
                            <span>الجهاز: {record.deviceContext.deviceModelName}</span>
                          )}
                          {record.itemCode && <span>الكود: {record.itemCode}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <div className="text-xs text-slate-400 font-bold">{fmtDate(record.purchaseDate)}</div>
                      <div className="text-sm font-black text-slate-800 mt-1">
                        {fmtMoney(record.totalPrice, record.currency)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 mt-4">
                    <MetaPill label="الكمية" value={String(record.quantity)} />
                    <MetaPill label="سعر الوحدة" value={fmtMoney(record.unitPrice, record.currency)} />
                    <MetaPill label="طريقة الدفع" value={paymentTypeLabel(record.paymentType)} />
                    <MetaPill label="حالة التركيب" value={record.isInstalled ? 'تم التركيب' : 'غير مركب'} />
                    <MetaPill label="الكفالة" value={warrantyContextLabel(record.warrantyContext)} />
                    <MetaPill label="حتى" value={fmtDate(record.warrantyUntil)} />
                  </div>

                  {record.discountInfo?.discountAmount ? (
                    <div className="mt-3 text-xs font-bold text-emerald-700">
                      حسم مثبت: {fmtMoney(record.discountInfo.discountAmount, record.currency)}
                    </div>
                  ) : null}

                  {record.notes ? (
                    <div className="mt-3 text-xs text-slate-500">
                      ملاحظات: {record.notes}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${accent}`} />
      </div>
      <div>
        <div className="text-[11px] text-slate-400 font-bold">{label}</div>
        <div className="text-sm font-black text-slate-800 mt-1">{value}</div>
      </div>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
      <div className="text-[10px] text-slate-400 font-bold">{label}</div>
      <div className="text-xs font-black text-slate-700 mt-1">{value || '—'}</div>
    </div>
  );
}

export default PurchaseHistoryTab;
