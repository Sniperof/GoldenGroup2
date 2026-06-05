// DEC-CT-09 + plan §2: standalone, reusable device profile page.
//
// Reachable from the customer-profile devices tab AND directly via
// /installed-devices/:id (any user with contracts.view_list).
//
// Layout: sticky side-rail jump-links + a vertical stack of 9 sections
// in the order mandated by the constitution (§01-what-is-a-device.md and
// §08-resolved-decisions.md).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, ChevronRight, ArrowLeft, AlertTriangle } from 'lucide-react';

import { api, API_BASE } from '../../lib/api';
import { DeviceStatusBadge } from '../../components/devices/DeviceStatusBadge';
import { WarrantyStatusBadge } from '../../components/devices/WarrantyStatusBadge';
import { PossessionHolderChip } from '../../components/devices/PossessionHolderChip';

import { IdentitySection } from './sections/IdentitySection';
import { OperationalStatusSection } from './sections/OperationalStatusSection';
import { CurrentHolderSection } from './sections/CurrentHolderSection';
import { PossessionHistorySection } from './sections/PossessionHistorySection';
import { WarrantiesSection } from './sections/WarrantiesSection';
import { InstalledPartsSection } from './sections/InstalledPartsSection';
import { LinkedContractSection } from './sections/LinkedContractSection';
import { FinancialSection } from './sections/FinancialSection';
import { TasksSection } from './sections/TasksSection';

const JUMP_LINKS = [
  { id: 'identity',          label: '١. الهوية' },
  { id: 'operational',       label: '٢. الحالة' },
  { id: 'current-holder',    label: '٣. الحيازة الحالية' },
  { id: 'possession-history',label: '٤. سجل الحيازة' },
  { id: 'warranties',        label: '٥. الكفالات' },
  { id: 'parts',             label: '٦. القطع' },
  { id: 'contract',          label: '٧. العقد' },
  { id: 'financial',         label: '٨. المالية' },
  { id: 'tasks',             label: '٩. المهام' },
];

const MISSING_LABELS: Record<string, string> = {
  serialNumber: 'الرقم التسلسلي غير مسجل',
  branchName: 'اسم الفرع غير متاح',
  installationLocation: 'موقع الجهاز غير مكتمل',
  deliveryDate: 'تاريخ التسليم غير مثبت بعد',
  installationDate: 'تاريخ التركيب غير مثبت بعد',
  activatedAt: 'تاريخ التشغيل غير مثبت بعد',
  warrantyTerms: 'شروط الكفالة غير مكتملة',
};

function missingItems(device: any): string[] {
  const missing = device?.missingFields ?? {};
  return Object.keys(missing).map(key => MISSING_LABELS[key] ?? key);
}

export default function DeviceProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deviceId = Number(id);

  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<any | null>(null);
  const [contract, setContract] = useState<any | null>(null);
  const [warranties, setWarranties] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [possessionLog, setPossessionLog] = useState<any[]>([]);
  const [currentPossession, setCurrentPossession] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  const fetchAll = useCallback(async () => {
    if (!Number.isInteger(deviceId) || deviceId <= 0) return;
    setLoading(true);
    try {
      const dev = await api.installedDevices.get(deviceId);
      setDevice(dev);

      // Fan-out the dependent fetches in parallel — each tolerates its own failure.
      const [warrantiesR, partsR, possessionR, currentR, contractR, tasksR] = await Promise.allSettled([
        api.deviceWarranties.list(deviceId),
        api.deviceParts.list(deviceId),
        api.devicePossession.list(deviceId),
        api.devicePossession.current(deviceId),
        dev?.contractId ? api.contracts.get(dev.contractId) : Promise.resolve(null),
        dev?.customerId ? api.openTasks.listByClient(dev.customerId) : Promise.resolve([]),
      ]);

      setWarranties(warrantiesR.status === 'fulfilled' ? warrantiesR.value : []);
      setParts(partsR.status === 'fulfilled' ? partsR.value : []);
      setPossessionLog(possessionR.status === 'fulfilled' ? possessionR.value : []);
      setCurrentPossession(currentR.status === 'fulfilled' ? currentR.value : null);
      setContract(contractR.status === 'fulfilled' ? contractR.value : null);
      setTasks(tasksR.status === 'fulfilled' ? tasksR.value : []);
    } catch (err) {
      console.error('[DeviceProfilePage] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // The "primary" warranty for the header badge: prefer contract warranty,
  // fall back to whichever is active, fall back to first row.
  const headerWarranty = useMemo(() => {
    if (!warranties.length) return null;
    return (
      warranties.find(w => w.warrantyType === 'contract')
      ?? warranties.find(w => w.status === 'active')
      ?? warranties[0]
    );
  }, [warranties]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-4" />
        <p className="text-sm font-bold">جاري تحميل الجهاز...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="max-w-3xl mx-auto bg-white border border-rose-100 rounded-3xl p-10 text-center">
        <h2 className="text-base font-black text-rose-700 mb-2">الجهاز غير موجود</h2>
        <p className="text-xs text-slate-500 mb-4">قد يكون قد حُذف، أو ليس لديك صلاحية للاطلاع عليه.</p>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl px-4 py-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> رجوع
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-xs text-slate-500 font-medium">
        <button
          onClick={() => navigate('/clients')}
          className="hover:text-sky-600 hover:underline"
        >
          الزبائن
        </button>
        <ChevronRight className="w-3 h-3 -scale-x-100" />
        <button
          onClick={() => device.customerId && navigate(`/clients/${device.customerId}`)}
          className="hover:text-sky-600 hover:underline"
        >
          {device.customerName ?? `#${device.customerId}`}
        </button>
        <ChevronRight className="w-3 h-3 -scale-x-100" />
        <span className="text-slate-700 font-bold">
          {device.deviceModelName || `جهاز #${device.id}`} #{device.serialNumber || device.id}
        </span>
      </nav>

      {/* Header card */}
      <header className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black text-slate-800">{device.deviceModelName || `جهاز #${device.id}`}</h1>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
              <span>الرقم التسلسلي:</span>
              {device.serialNumber ? (
                <span className="font-mono font-bold text-slate-700" dir="ltr">{device.serialNumber}</span>
              ) : (
                <span className="font-bold text-amber-700">غير مسجل بعد</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DeviceStatusBadge status={device.status} />
            {headerWarranty && (
              <WarrantyStatusBadge
                status={headerWarranty.status}
                cancellationReason={headerWarranty.cancellationReason}
                endDate={headerWarranty.endDate}
              />
            )}
            {currentPossession && (
              <PossessionHolderChip
                holderType={currentPossession.holderType}
                reason={currentPossession.reason}
              />
            )}
          </div>
        </div>
      </header>

      {missingItems(device).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-black text-amber-800">بيانات الجهاز تحتاج استكمال</div>
            <div className="text-xs text-amber-700 mt-1 leading-relaxed">
              هذا الجهاز موجود ومربوط بالعقد، لكن بعض معلوماته التشغيلية لم تحفظ بعد:
              {' '}
              <span className="font-bold">{missingItems(device).join('، ')}</span>.
            </div>
          </div>
        </div>
      )}

      {/* Side rail + sections */}
      <div className="flex gap-6">
        <aside className="hidden lg:block w-48 shrink-0">
          <nav className="sticky top-20 space-y-1 text-xs">
            {JUMP_LINKS.map(j => (
              <a
                key={j.id}
                href={`#${j.id}`}
                className="block px-3 py-2 rounded-xl text-slate-600 hover:bg-slate-100 hover:text-slate-800 font-bold"
              >
                {j.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 space-y-6">
          <IdentitySection device={device} />
          <OperationalStatusSection device={device} onTaskCreated={fetchAll} />
          <CurrentHolderSection device={device} currentPossession={currentPossession} />
          <PossessionHistorySection entries={possessionLog} />
          <WarrantiesSection warranties={warranties} />
          <InstalledPartsSection contract={contract} deviceParts={parts} onChanged={fetchAll} />
          <LinkedContractSection contract={contract} apiBase={API_BASE} />
          <FinancialSection contract={contract} customerId={device.customerId ?? null} />
          <TasksSection tasks={tasks} deviceId={deviceId} contractId={device.contractId} />
        </main>
      </div>
    </div>
  );
}
