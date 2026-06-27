import { useEffect, useState } from 'react';
import { Gift, PackageCheck, ShieldCheck } from 'lucide-react';
import Card, { CardHeader, CardTitle } from '../../components/ui/Card';
import GiftRecordsTable from '../../components/gifts/GiftRecordsTable';
import type { GiftRecordPrototype } from '../../data/giftsPrototype';
import { api } from '../../lib/api';
import type { Client } from '../../lib/types';

export default function GiftsTab({ client }: { client: Client }) {
  const [records, setRecords] = useState<GiftRecordPrototype[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.gifts.records.list({ clientId: client.id })
      .then(rows => {
        if (active) setRecords(rows);
      })
      .catch((err: any) => {
        if (!active) return;
        setRecords([]);
        setLoadError(err?.message ?? 'تعذر تحميل هدايا الزبون من الخادم');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client.id, reloadToken]);

  const promisedCount = records.filter(record => record.status === 'promised').length;
  const readyCount = records.filter(record => record.status === 'approved_for_delivery' || record.status === 'delivery_task_created').length;
  const doneCount = records.filter(record => record.status === 'delivered' || record.status === 'delivered_manually').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-500">وعود مفتوحة</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{promisedCount}</div>
            </div>
            <Gift className="h-6 w-6 text-amber-600" />
          </div>
        </Card>
        <Card padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-500">جاهزة للتسليم</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{readyCount}</div>
            </div>
            <PackageCheck className="h-6 w-6 text-sky-600" />
          </div>
        </Card>
        <Card padding="sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-500">تم استلامها</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{doneCount}</div>
            </div>
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
          </div>
        </Card>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>هدايا الزبون</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              {loading ? 'جاري تحميل هدايا الزبون...' : loadError ?? 'يعرض هذا التبويب الوعود والاستحقاقات وما تم استلامه للزبون نفسه أو كوسيط بيعة.'}
            </p>
          </div>
        </CardHeader>
        <GiftRecordsTable records={records} compact onChanged={() => setReloadToken(t => t + 1)} />
      </Card>
    </div>
  );
}
