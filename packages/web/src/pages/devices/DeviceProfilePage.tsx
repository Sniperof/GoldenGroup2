// DEC-CT-09 + plan §2: standalone, reusable device profile page.
//
// Reachable from the customer-profile devices tab AND directly via
// /installed-devices/:id. Possession sections are backed by their dedicated
// installed_devices.possession.view permission and device-branch policy.
//
// Layout (operational dashboard, 2026-11-20): the header card, then the
// operational strip — the device's journey and four indicators (next
// maintenance, warranty in force, what is owed, open work) — then five tabs.
// Only the active tab is rendered, so sections that load their own data
// (faults, technical health, lifecycle, change log) load when opened. The tab
// is kept in the URL (?tab=).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Loader2, ArrowLeft, AlertTriangle,
  LayoutDashboard, Wrench, Award, UserCheck, History,
} from '../../components/ui/icons';

import ProfileTabsBar from '../../components/ui/ProfileTabsBar';
import ProfileBreadcrumbBar from '../../components/ui/ProfileBreadcrumbBar';
import { usePermissions } from '../../hooks/usePermissions';

import { api, API_BASE, type DeviceOverview } from '../../lib/api';
import { DeviceStatusBadge } from '../../components/devices/DeviceStatusBadge';
import { WarrantyStatusBadge } from '../../components/devices/WarrantyStatusBadge';
import { PossessionHolderChip } from '../../components/devices/PossessionHolderChip';
import type { DevicePossessionEntry } from '@golden-crm/shared';

import { DeviceOverviewStrip } from './sections/DeviceOverviewStrip';
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
import { DeviceLifecycleSection } from './sections/DeviceLifecycleSection';
import { DeviceActivitySection } from './sections/DeviceActivitySection';

type TabId = 'overview' | 'service' | 'warranties' | 'possession' | 'history';

const TABS: Array<{ id: TabId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview',   label: 'نظرة عامة',          icon: LayoutDashboard },
  { id: 'service',    label: 'الخدمة',             icon: Wrench },
  { id: 'warranties', label: 'الكفالات والمالية',  icon: Award },
  { id: 'possession', label: 'الحيازة',            icon: UserCheck },
  { id: 'history',    label: 'السجل',              icon: History },
];

const MISSING_LABELS: Record<string, string> = {
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreateComplaint = hasPermission('complaints.create_internal')
    && hasPermission('clients.view_list')
    && (hasPermission('clients.devices.view') || hasPermission('installed_devices.view'));
  const deviceId = Number(id);
  const canViewPossession = hasPermission('installed_devices.possession.view');
  const canManageDeliverySuspension = hasPermission('installed_devices.delivery_suspension.manage');
  const canViewLifecycle = hasPermission('installed_devices.lifecycle.view');
  const canViewActivity = hasPermission('installed_devices.activity_log.view');
  const canEditDetails = hasPermission('installed_devices.edit_details');
  const canManagePossession = hasPermission('installed_devices.possession.manage');

  const visibleTabs = useMemo(
    () => TABS.filter(tab => {
      if (tab.id === 'possession') return canViewPossession;
      if (tab.id === 'history') return canViewLifecycle || canViewActivity;
      return true;
    }),
    [canViewPossession, canViewLifecycle, canViewActivity],
  );
  const requestedTab = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = visibleTabs.some(t => t.id === requestedTab) ? requestedTab! : 'overview';
  const selectTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [loading, setLoading] = useState(true);
  const [device, setDevice] = useState<any | null>(null);
  const [overview, setOverview] = useState<DeviceOverview | null>(null);
  const [contract, setContract] = useState<any | null>(null);
  const [warranties, setWarranties] = useState<any[]>([]);
  const [parts, setParts] = useState<any[]>([]);
  const [possessionLog, setPossessionLog] = useState<DevicePossessionEntry[]>([]);
  const [currentPossession, setCurrentPossession] = useState<DevicePossessionEntry | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  const fetchAll = useCallback(async () => {
    if (!Number.isInteger(deviceId) || deviceId <= 0) return;
    setLoading(true);
    try {
      const dev = await api.installedDevices.get(deviceId);
      setDevice(dev);

      // Fan-out the dependent fetches in parallel — each tolerates its own failure.
      const [overviewR, warrantiesR, partsR, possessionR, currentR, contractR, tasksR] = await Promise.allSettled([
        api.installedDevices.getOverview(deviceId),
        api.deviceWarranties.list(deviceId),
        api.deviceParts.list(deviceId),
        canViewPossession ? api.devicePossession.list(deviceId) : Promise.resolve([]),
        canViewPossession ? api.devicePossession.current(deviceId) : Promise.resolve(null),
        dev?.contractId ? api.contracts.get(dev.contractId) : Promise.resolve(null),
        api.openTasks.listByDevice(deviceId),
      ]);

      setOverview(overviewR.status === 'fulfilled' ? overviewR.value : null);
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
  }, [canViewPossession, deviceId]);

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

  if (loading && !device) {
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

  const missing = missingItems(device);

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
      <div className="flex-1 overflow-y-auto custom-scroll">
        <div className="mx-auto max-w-[1600px] px-4 py-6 space-y-4 sm:px-6 lg:px-8">

      {/* Header card */}
      <header className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{device.deviceModelName || `جهاز #${device.id}`}</h1>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 flex-wrap">
              <span>الرقم التسلسلي:</span>
              {device.serialNumber ? (
                <span className="font-mono font-bold text-slate-700" dir="ltr">{device.serialNumber}</span>
              ) : (
                <span className="font-bold text-amber-700">غير مسجل بعد</span>
              )}
              {device.branchName && <span className="text-slate-400">· فرع {device.branchName}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canCreateComplaint && (
              <button onClick={() => navigate(`/complaints/new?deviceId=${device.id}`)}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100">
                <AlertTriangle className="h-4 w-4" /> تسجيل شكوى على الجهاز
              </button>
            )}
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
                holderName={currentPossession.holderName}
                reason={currentPossession.reason}
              />
            )}
          </div>
        </div>
      </header>

      {/* Operational strip: journey + indicators */}
      <DeviceOverviewStrip device={device} overview={overview} />

      {missing.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-black text-amber-800">بيانات الجهاز تحتاج استكمال</div>
            <div className="text-xs text-amber-700 mt-1 leading-relaxed">
              هذا الجهاز موجود ومربوط بالعقد، لكن بعض معلوماته التشغيلية لم تحفظ بعد:
              {' '}
              <span className="font-bold">{missing.join('، ')}</span>.
            </div>
          </div>
        </div>
      )}

      {/* Tabs — only the active one is rendered */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-slate-200 bg-white px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <ProfileTabsBar tabs={visibleTabs} activeId={activeTab} onChange={selectTab} />
      </div>

      {activeTab === 'overview' && (
        <>
          <IdentitySection device={device} canEditDetails={canEditDetails} onChanged={fetchAll} />
          <OperationalStatusSection
            device={device}
            tasks={tasks}
            canManageDeliverySuspension={canManageDeliverySuspension}
            onTaskCreated={fetchAll}
          />
          <LinkedContractSection contract={contract} apiBase={API_BASE} />
        </>
      )}

      {activeTab === 'service' && (
        <>
          <TasksSection tasks={tasks} deviceId={deviceId} contractId={device.contractId} device={device} onTaskCreated={fetchAll} />
          <ProblemsHistorySection deviceId={deviceId} />
          <TechnicalHealthSection deviceId={deviceId} />
          <InstalledPartsSection contract={contract} deviceParts={parts} onChanged={fetchAll} />
        </>
      )}

      {activeTab === 'warranties' && (
        <>
          <WarrantiesSection
            warranties={warranties}
            device={{ id: device.id, customerId: device.customerId, contractId: device.contractId, branchId: device.branchId, status: device.status }}
            onCreated={fetchAll}
          />
          <ServiceAgreementsSection device={device} onChanged={fetchAll} />
          <FinancialSection contract={contract} customerId={device.customerId ?? null} />
        </>
      )}

      {activeTab === 'possession' && canViewPossession && (
        <>
          <CurrentHolderSection device={device} currentPossession={currentPossession} />
          <PossessionHistorySection
            entries={possessionLog}
            device={{ id: device.id, customerId: device.customerId, customerName: device.customerName, branchId: device.branchId }}
            canManage={canManagePossession}
            onChanged={fetchAll}
          />
        </>
      )}

      {activeTab === 'history' && (
        <>
          {canViewLifecycle && <DeviceLifecycleSection deviceId={deviceId} />}
          {canViewActivity && <DeviceActivitySection deviceId={deviceId} />}
        </>
      )}
        </div>
      </div>
    </div>
  );
}
