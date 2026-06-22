import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Wrench, Boxes, Layers3, CalendarClock, FileStack } from 'lucide-react';

import { api } from '../../lib/api';

interface Props {
  client: { id: number };
}

interface StockSource {
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  receivedAt: string | null;
}

interface StockRecord {
  stockId: string;
  itemType: string;
  itemId: number | null;
  itemName: string;
  itemCode: string | null;
  quantityAvailable: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  sourcesCount: number;
  sources: StockSource[];
}

interface StockResponse {
  customerId: number;
  records: StockRecord[];
  summary: {
    totalUniqueItems: number;
    totalUnits: number;
    periodicItems: number;
    emergencyItems: number;
    accessoryItems: number;
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

function itemTypeLabel(type: string) {
  switch (type) {
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

function stockIcon(type: string) {
  switch (type) {
    case 'periodic_part':
    case 'emergency_part':
      return Wrench;
    case 'accessory':
      return Package;
    default:
      return Boxes;
  }
}

export function PartsStockTab({ client }: Props) {
  const [data, setData] = useState<StockResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | 'periodic_part' | 'emergency_part' | 'accessory'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.customers.getPartsStock(client.id);
      setData(result);
    } catch (err) {
      console.error('[PartsStockTab] fetch failed:', err);
      setData({
        customerId: client.id,
        records: [],
        summary: {
          totalUniqueItems: 0,
          totalUnits: 0,
          periodicItems: 0,
          emergencyItems: 0,
          accessoryItems: 0,
        },
      });
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const records = useMemo(() => {
    const base = data?.records ?? [];
    if (typeFilter === 'all') return base;
    return base.filter((record) => record.itemType === typeFilter);
  }, [data, typeFilter]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-bold">جاري تحميل مخزون الزبون...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-slate-800">مخزون الزبون</h3>
          <p className="text-xs text-slate-400 font-bold mt-1">
            هذا القسم يعرض القطع والملحقات الموجودة حالياً عند الزبون ولم تُركب بعد، والمحتسبة من العقود النافذة فقط.
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[
            { key: 'all', label: 'الكل' },
            { key: 'periodic_part', label: 'دورية' },
            { key: 'emergency_part', label: 'طارئة' },
            { key: 'accessory', label: 'اكسسوارات' },
          ].map((filter) => (
            <button
              key={filter.key}
              onClick={() => setTypeFilter(filter.key as typeof typeFilter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                typeFilter === filter.key
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
        <SummaryCard icon={Boxes} label="أصناف المخزون" value={String(data?.summary.totalUniqueItems ?? 0)} accent="text-sky-600" />
        <SummaryCard icon={Layers3} label="إجمالي الوحدات" value={String(data?.summary.totalUnits ?? 0)} accent="text-violet-600" />
        <SummaryCard icon={Wrench} label="قطع الصيانة" value={String((data?.summary.periodicItems ?? 0) + (data?.summary.emergencyItems ?? 0))} accent="text-amber-600" />
        <SummaryCard icon={Package} label="الاكسسوارات" value={String(data?.summary.accessoryItems ?? 0)} accent="text-emerald-600" />
      </section>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {records.length === 0 ? (
          <div className="px-6 py-16 text-center text-slate-400">
            <Boxes className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-bold">لا توجد قطع غير مركبة مطابقة للفلاتر الحالية.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {records.map((record) => {
              const Icon = stockIcon(record.itemType);
              return (
                <div key={record.stockId} className="px-5 py-4 hover:bg-slate-50/70 transition-colors">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center shrink-0">
                        <Icon className="w-5 h-5 text-slate-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h4 className="text-sm font-black text-slate-800 truncate">{record.itemName}</h4>
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-700">
                            {itemTypeLabel(record.itemType)}
                          </span>
                          {record.itemCode ? (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                              الكود: {record.itemCode}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                          <span>الكمية المتاحة: {record.quantityAvailable}</span>
                          <span>عدد مصادر الإدخال: {record.sourcesCount}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <div className="text-xs text-slate-400 font-bold">آخر إضافة</div>
                      <div className="text-sm font-black text-slate-800 mt-1">
                        {fmtDate(record.lastReceivedAt)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    <MetaPill icon={Layers3} label="الكمية الحالية" value={String(record.quantityAvailable)} />
                    <MetaPill icon={CalendarClock} label="أول إدخال" value={fmtDate(record.firstReceivedAt)} />
                    <MetaPill icon={CalendarClock} label="آخر إدخال" value={fmtDate(record.lastReceivedAt)} />
                    <MetaPill icon={FileStack} label="مصادر الإدخال" value={String(record.sourcesCount)} />
                  </div>

                  {record.sources.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.sources.slice(0, 6).map((source, index) => (
                        <span
                          key={`${record.stockId}-${source.sourceType}-${source.sourceId ?? index}`}
                          className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold"
                        >
                          {sourceTypeLabel(source.sourceType)} · {source.sourceLabel} · {fmtDate(source.receivedAt)}
                        </span>
                      ))}
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
        <div className="text-xs text-slate-400 font-bold">{label}</div>
        <div className="text-sm font-black text-slate-800 mt-1">{value}</div>
      </div>
    </div>
  );
}

function MetaPill({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="text-xs font-black text-slate-700 mt-1">{value || '—'}</div>
    </div>
  );
}

export default PartsStockTab;
