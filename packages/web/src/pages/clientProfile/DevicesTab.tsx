// Plan §1: clean table of every device belonging to a customer.
// Each row is a link to /installed-devices/:id (the standalone device page).
//
// The status filter (chips) defaults to "all except discarded" so deactivated
// drafts don't pollute the operational view (DEC-CT-01).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Cpu, ExternalLink } from 'lucide-react';

import { api } from '../../lib/api';
import { DeviceStatusBadge } from '../../components/devices/DeviceStatusBadge';
import { WarrantyStatusBadge } from '../../components/devices/WarrantyStatusBadge';
import { PossessionHolderChip } from '../../components/devices/PossessionHolderChip';

interface Props {
  client: { id: number };
}

interface Filter {
  key: string;
  label: string;
  test: (status: string) => boolean;
}

const FILTERS: Filter[] = [
  { key: 'all',         label: 'الكل',         test: () => true },
  { key: 'active',      label: 'نشطة',         test: s => s === 'active' },
  { key: 'in_workshop', label: 'في الورشة',    test: s => s === 'in_workshop' },
  { key: 'retrieved',   label: 'مستردة',       test: s => s === 'retrieved' },
  { key: 'out_of_service', label: 'خارج الخدمة', test: s => s === 'out_of_service' },
];

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

interface DeviceRow {
  device: any;
  current: any | null;
  warranty: any | null;
}

export function DevicesTab({ client }: Props) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const devices: any[] = await api.installedDevices.list({ customerId: client.id });

      // For each device fan-out small detail fetches (current holder + primary
      // warranty). Bounded by the number of devices a single customer has —
      // typically 1-3 — so an N+1 here is acceptable for now. A bulk endpoint
      // is noted as out-of-scope in the plan.
      const enriched = await Promise.all(devices.map(async (d) => {
        const [currentR, warrantiesR] = await Promise.allSettled([
          api.devicePossession.current(d.id),
          api.deviceWarranties.list(d.id),
        ]);
        const current = currentR.status === 'fulfilled' ? currentR.value : null;
        const warrantyList = warrantiesR.status === 'fulfilled' ? warrantiesR.value : [];
        const warranty =
          warrantyList.find((w: any) => w.warrantyType === 'contract')
          ?? warrantyList.find((w: any) => w.status === 'active')
          ?? warrantyList[0]
          ?? null;
        return { device: d, current, warranty };
      }));
      setRows(enriched);
    } catch (err) {
      console.error('[DevicesTab] fetch failed:', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.key === activeFilter) ?? FILTERS[0];
    return rows.filter(r => f.test(r.device.status));
  }, [rows, activeFilter]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-bold">جاري تحميل الأجهزة...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-100 p-16 text-center flex flex-col items-center justify-center shadow-sm">
        <Cpu className="w-12 h-12 text-slate-300 mb-4" />
        <h4 className="text-base text-slate-600 font-black mb-2">لا توجد أجهزة مسجلة</h4>
        <p className="text-xs text-slate-400 font-bold max-w-md">
          لم يقم هذا الزبون بشراء أي جهاز بعد، أو لم تُسلَّم الأجهزة الخاصة به.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h3 className="text-lg font-black text-slate-800">أجهزة الزبون</h3>
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                activeFilter === f.key
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 font-black sticky top-0">
              <tr>
                <th className="text-right py-3 px-4">الموديل</th>
                <th className="text-right py-3 px-4">الرقم التسلسلي</th>
                <th className="text-right py-3 px-4">الحالة</th>
                <th className="text-right py-3 px-4">الكفالة</th>
                <th className="text-right py-3 px-4">الحائز الحالي</th>
                <th className="text-right py-3 px-4">رقم العقد</th>
                <th className="text-right py-3 px-4">تاريخ التركيب</th>
                <th className="text-right py-3 px-4">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 italic">
                    لا أجهزة تطابق الفلتر الحالي.
                  </td>
                </tr>
              )}
              {filtered.map(({ device, current, warranty }) => (
                <tr
                  key={device.id}
                  onClick={() => navigate(`/installed-devices/${device.id}`)}
                  className="border-t border-slate-50 hover:bg-sky-50/40 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-bold text-slate-800">{device.deviceModelName}</td>
                  <td className="py-3 px-4 font-mono text-slate-600">{device.serialNumber || '—'}</td>
                  <td className="py-3 px-4">
                    <DeviceStatusBadge status={device.status} />
                  </td>
                  <td className="py-3 px-4">
                    <WarrantyStatusBadge
                      status={warranty?.status}
                      cancellationReason={warranty?.cancellationReason}
                      endDate={warranty?.endDate}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <PossessionHolderChip
                      holderType={current?.holderType}
                      reason={current?.reason}
                    />
                  </td>
                  <td className="py-3 px-4">
                    {device.contractNumber ? (
                      <a
                        onClick={(e) => e.stopPropagation()}
                        href={`/contracts/${device.contractId}`}
                        className="font-mono text-sky-600 hover:underline"
                      >
                        #{device.contractNumber}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {fmt(device.installationDate || device.deliveryDate)}
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-sky-600 font-bold">
                      فتح <ExternalLink className="w-3 h-3" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DevicesTab;
