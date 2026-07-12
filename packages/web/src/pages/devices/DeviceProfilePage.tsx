// DEC-CT-09 + plan §2: standalone, reusable device profile page.
//
// Reachable from the customer-profile devices tab AND directly via
// /installed-devices/:id (any user with contracts.view_list).
//
// Layout: a sticky top ProfileTabsBar switches between the sections, in the
// order mandated by the constitution (§01-what-is-a-device.md and
// §08-resolved-decisions.md).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Loader2, ArrowLeft, AlertTriangle,
  Fingerprint, Activity, UserCheck, History, Award,
  Puzzle, FileText, Wallet, ClipboardList, HeartPulse, ScrollText,
} from '../../components/ui/icons';

import ProfileTabsBar from '../../components/ui/ProfileTabsBar';
import ProfileBreadcrumbBar from '../../components/ui/ProfileBreadcrumbBar';

import { api, API_BASE } from '../../lib/api';
import { DeviceStatusBadge } from '../../components/devices/DeviceStatusBadge';
import { WarrantyStatusBadge } from '../../components/devices/WarrantyStatusBadge';
import { PossessionHolderChip } from '../../components/devices/PossessionHolderChip';

import { IdentitySection } from './sections/IdentitySection';
import { OperationalStatusSection } from './sections/OperationalStatusSection';
import { CurrentHolderSection } from './sections/CurrentHolderSection';
import { PossessionHistorySection } from './sections/PossessionHistorySection';
import { WarrantiesSection } from './sections/WarrantiesSection';
import { ServiceAgreementsSection } from './sections/ServiceAgreementsSection';
import { InstalledPartsSection } from './sections/InstalledPartsSection';
import { LinkedContractSection } from './sections/LinkedContractSection';
import { FinancialSection } from './sections/FinancialSection';
import { TasksSection } from './sections/TasksSection';
import { ProblemsHistorySection } from './sections/ProblemsHistorySection';
import { TechnicalHealthSection } from './sections/TechnicalHealthSection';

const SECTIONS = [
  { id: 'identity',          label: 'الهوية',          icon: Fingerprint },
  { id: 'operational',       label: 'الحالة',          icon: Activity },
  { id: 'current-holder',    label: 'الحيازة الحالية', icon: UserCheck },
  { id: 'possession-history',label: 'سجل الحيازة',     icon: History },
  { id: 'warranties',        label: 'الكفالات',        icon: Award },
  { id: 'service-agreements',label: 'اتفاق الخدمة',    icon: ScrollText },
  { id: 'parts',             label: 'القطع',           icon: Puzzle },
  { id: 'contract',          label: 'العقد',           icon: FileText },
  { id: 'financial',         label: 'المالية',         icon: Wallet },
  { id: 'tasks',             label: 'المهام',          icon: ClipboardList },
  { id: 'problems',          label: 'سجل الأعطال',     icon: AlertTriangle },
  { id: 'technical-health',  label: 'الصحة الفنية',    icon: HeartPulse },
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
  const isExternal = device?.deviceSource === 'external';
  const ignoredForExternal = new Set(['deliveryDate', 'installationDate', 'activatedAt', 'warrantyTerms']);

  return Object.keys(missing)
    .filter((key) => !(isExternal && ignoredForExternal.has(key)))
    .map(key => MISSING_LABELS[key] ?? key);
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

  // Sticky top tabs: all sections are stacked and scrolled through; the tabs
  // jump to a section and scroll-spy highlights whichever is under the bar.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  useEffect(() => {
    if (!device) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    // The active section is the last one (document order) whose top has scrolled
    // up past the sticky tab bar. MARKER is a viewport y just below breadcrumb +
    // tabs. A scroll listener is used because it fires reliably on user scroll.
    const MARKER = 175;
    const onScroll = () => {
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - MARKER <= 0) current = s.id;
        else break;
      }
      setActiveSection(current);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    // `loading` is included so the effect re-runs once the scroll container is
    // actually mounted (device is set a render before loading flips false).
  }, [device, loading]);

  const handleJump = useCallback((id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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
      <div className="max-w-3xl mx-auto bg-white border border-rose-100 rounded-2xl p-10 text-center">
        <h2 className="text-lg font-bold text-rose-700 mb-2">الجهاز غير موجود</h2>
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

  const isExternalDevice = device?.deviceSource === 'external';

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50" style={{ direction: 'rtl' }}>
      {/* Full-width white breadcrumb bar (fixed above the scroll area) */}
      <ProfileBreadcrumbBar
        items={[
          { label: 'الزبائن', onClick: () => navigate('/clients') },
          {
            label: device.customerName ?? `#${device.customerId}`,
            onClick: device.customerId ? () => navigate(`/clients/${device.customerId}`) : undefined,
          },
          { label: `${device.deviceModelName || `جهاز #${device.id}`} #${device.serialNumber || device.id}` },
        ]}
      />

      {/* Scrollable area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scroll">
        <div className="mx-auto max-w-[1600px] px-4 py-6 space-y-6 sm:px-6 lg:px-8">

      {/* Header card */}
      <header className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{device.deviceModelName || `جهاز #${device.id}`}</h1>
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
              {isExternalDevice
                ? 'هذا جهاز خارجي مستقل عن العقد، لكن بعض معلوماته التشغيلية لم تحفظ بعد:'
                : 'هذا الجهاز موجود ومربوط بالعقد، لكن بعض معلوماته التشغيلية لم تحفظ بعد:'}
              {' '}
              <span className="font-bold">{missingItems(device).join('، ')}</span>.
            </div>
          </div>
        </div>
      )}

      {/* Sticky section tabs — rise on scroll and stop just under the breadcrumb bar */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-white px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ProfileTabsBar tabs={SECTIONS} activeId={activeSection} onChange={handleJump} />
      </div>

        <main className="flex-1 min-w-0 space-y-6">
          <IdentitySection device={device} />
          <OperationalStatusSection device={device} deviceSource={device.deviceSource} tasks={tasks} onTaskCreated={fetchAll} />
          <CurrentHolderSection device={device} currentPossession={currentPossession} />
          <PossessionHistorySection entries={possessionLog} />
          <WarrantiesSection
            warranties={warranties}
            device={{ id: device.id, customerId: device.customerId, contractId: device.contractId, branchId: device.branchId, status: device.status }}
            onCreated={fetchAll}
          />
          <ServiceAgreementsSection device={device} onChanged={fetchAll} />
          <InstalledPartsSection contract={contract} deviceParts={parts} onChanged={fetchAll} />
          <LinkedContractSection contract={contract} deviceSource={device.deviceSource} apiBase={API_BASE} />
          <FinancialSection contract={contract} customerId={device.customerId ?? null} deviceSource={device.deviceSource} />
          <TasksSection tasks={tasks} deviceId={deviceId} contractId={device.contractId} device={device} onTaskCreated={fetchAll} />
          <ProblemsHistorySection deviceId={deviceId} />
          <TechnicalHealthSection deviceId={deviceId} />
        </main>
      </div>
    </div>
  </div>
  );
}
