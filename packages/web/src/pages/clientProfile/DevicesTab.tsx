// Plan §1: clean table of every device belonging to a customer.
// Each row is a link to /installed-devices/:id (the standalone device page).
//
// The status filter (chips) defaults to "all except discarded" so deactivated
// drafts don't pollute the operational view (DEC-CT-01).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Cpu, ExternalLink, Plus, Save, MapPin } from 'lucide-react';
import Modal from '../../components/ui/Modal';

import { api } from '../../lib/api';
import SmartTable, { type ColumnDef } from '../../components/SmartTable';
import { DeviceStatusBadge } from '../../components/devices/DeviceStatusBadge';
import { WarrantyStatusBadge } from '../../components/devices/WarrantyStatusBadge';
import { PossessionHolderChip } from '../../components/devices/PossessionHolderChip';
import GeoSmartSearch, { type GeoSelection } from '../../components/GeoSmartSearch';
import MapPicker from '../../components/MapPicker';
import Select from '../../components/ui/Select';

interface Props {
  client: { id: number; branchId?: number | null };
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

function ExternalDeviceModalV2({
  deviceModelId,
  deviceModels,
  geoUnits,
  geoSelection,
  address,
  mapPosition,
  showMapPicker,
  serial,
  notes,
  error,
  saving,
  loadingOptions,
  onDeviceModelChange,
  onGeoSelectionChange,
  onAddressChange,
  onMapPositionChange,
  onToggleMapPicker,
  onSerialChange,
  onNotesChange,
  onClose,
  onSave,
}: {
  deviceModelId: string;
  deviceModels: any[];
  geoUnits: any[];
  geoSelection: GeoSelection;
  address: string;
  mapPosition: [number, number] | null;
  showMapPicker: boolean;
  serial: string;
  notes: string;
  error: string;
  saving: boolean;
  loadingOptions: boolean;
  onDeviceModelChange: (value: string) => void;
  onGeoSelectionChange: (value: GeoSelection) => void;
  onAddressChange: (value: string) => void;
  onMapPositionChange: (value: [number, number] | null) => void;
  onToggleMapPicker: () => void;
  onSerialChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      isOpen
      onClose={onClose}
      size="xl"
      title="اضافة جهاز خارجي"
      footer={
        <div className="w-full flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">الغاء</button>
          <button type="button" onClick={onSave} disabled={saving || loadingOptions} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ
          </button>
        </div>
      }
    >
        <div className="space-y-4 px-5 py-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <label className="block space-y-1.5">
            <span className="text-sm font-bold text-slate-700">الجهاز</span>
            <Select
              value={deviceModelId}
              onChange={onDeviceModelChange}
              disabled={loadingOptions}
              placeholder={loadingOptions ? 'جاري تحميل اجهزة الفرع...' : 'اختر جهازا من اجهزة الفرع'}
              ariaLabel="جهاز الفرع"
              className="w-full"
              options={[{ value: '', label: loadingOptions ? 'جاري تحميل اجهزة الفرع...' : 'اختر جهازا من اجهزة الفرع' }, ...deviceModels.map(device => ({ value: String(device.id), label: device.nameAr || device.name || device.nameEn || `#${device.id}` }))]}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-bold text-slate-700">الرقم التسلسلي</span>
            <input value={serial} onChange={e => onSerialChange(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500" dir="ltr" />
          </label>
          <GeoSmartSearch
            geoUnits={geoUnits}
            value={geoSelection}
            onChange={onGeoSelectionChange}
            label="عنوان التركيب"
            required
            minSelectableLevel={4}
            placeholder="ابحث عن الحي..."
            disabled={loadingOptions}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-bold text-slate-700">العنوان التفصيلي</span>
            <input value={address} onChange={e => onAddressChange(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <MapPin className="h-3.5 w-3.5" />
                <span>تحديد الموقع GPS</span>
              </label>
              <div className="flex items-center gap-3">
                {mapPosition && (
                  <span className="font-mono text-xs text-slate-400" dir="ltr">
                    {mapPosition[0].toFixed(5)}, {mapPosition[1].toFixed(5)}
                  </span>
                )}
                <button type="button" onClick={onToggleMapPicker} className="text-xs font-semibold text-sky-600 hover:text-sky-500">
                  {showMapPicker ? 'اخفاء الخريطة' : 'اظهار الخريطة'}
                </button>
              </div>
            </div>
            {showMapPicker ? (
              <MapPicker
                position={mapPosition}
                onLocationSelect={(lat, lng) => {
                  if (lat === 0 && lng === 0) onMapPositionChange(null);
                  else onMapPositionChange([lat, lng]);
                }}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                الخريطة اختيارية، ويمكن فتحها لتثبيت موقع الجهاز بدقة.
              </div>
            )}
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-bold text-slate-700">ملاحظات</span>
            <textarea value={notes} onChange={e => onNotesChange(e.target.value)} rows={3} className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
        </div>
    </Modal>
  );
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
  const [externalModalOpen, setExternalModalOpen] = useState(false);
  const [externalDeviceModelId, setExternalDeviceModelId] = useState('');
  const [externalSerial, setExternalSerial] = useState('');
  const [externalGeoSelection, setExternalGeoSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
  const [externalAddress, setExternalAddress] = useState('');
  const [externalMapPosition, setExternalMapPosition] = useState<[number, number] | null>(null);
  const [showExternalMapPicker, setShowExternalMapPicker] = useState(false);
  const [externalNotes, setExternalNotes] = useState('');
  const [savingExternal, setSavingExternal] = useState(false);
  const [externalError, setExternalError] = useState('');
  const [externalDeviceModels, setExternalDeviceModels] = useState<any[]>([]);
  const [externalGeoUnits, setExternalGeoUnits] = useState<any[]>([]);
  const [externalOptionsLoading, setExternalOptionsLoading] = useState(false);

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

  useEffect(() => {
    if (!externalModalOpen || !client.branchId) return;
    let cancelled = false;
    setExternalOptionsLoading(true);
    Promise.all([
      api.deviceModels.list(client.branchId),
      api.geoUnits.list(client.branchId),
    ])
      .then(([deviceModels, geoUnits]) => {
        if (cancelled) return;
        setExternalDeviceModels(deviceModels);
        setExternalGeoUnits(geoUnits);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[DevicesTab] external options failed:', err);
        setExternalDeviceModels([]);
        setExternalGeoUnits([]);
        setExternalError('تعذر تحميل اجهزة الفرع او العناوين المتاحة.');
      })
      .finally(() => {
        if (!cancelled) setExternalOptionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [externalModalOpen, client.branchId]);

  const resetExternalForm = () => {
    setExternalDeviceModelId('');
    setExternalSerial('');
    setExternalGeoSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
    setExternalAddress('');
    setExternalMapPosition(null);
    setShowExternalMapPicker(false);
    setExternalNotes('');
    setExternalError('');
  };

  const saveExternalDevice = async () => {
    const branchId = client.branchId ?? null;
    if (!branchId) {
      setExternalError('لا يمكن إضافة جهاز خارجي قبل تحديد فرع الزبون.');
      return;
    }
    if (!externalDeviceModelId) {
      setExternalError('اسم الجهاز الخارجي مطلوب.');
      return;
    }
    if (!externalSerial.trim()) {
      setExternalError('الرقم التسلسلي مطلوب.');
      return;
    }
    if (!externalGeoSelection.neighborhoodId) {
      setExternalError('عنوان التركيب يجب ان يكون على مستوى الحي.');
      return;
    }
    if (!externalAddress.trim()) {
      setExternalError('العنوان التفصيلي للتركيب مطلوب.');
      return;
    }
    setSavingExternal(true);
    setExternalError('');
    try {
      await api.installedDevices.createExternal({
        customerId: client.id,
        deviceModelId: Number(externalDeviceModelId),
        serialNumber: externalSerial.trim(),
        installationGeoUnitId: Number(externalGeoSelection.neighborhoodId),
        installationAddressText: externalAddress.trim(),
        installationLat: externalMapPosition?.[0] ?? null,
        installationLng: externalMapPosition?.[1] ?? null,
        externalDeviceNotes: externalNotes.trim() || null,
      });
      setExternalModalOpen(false);
      resetExternalForm();
      await fetchData();
    } catch (err: any) {
      setExternalError(err?.message || 'تعذر إضافة الجهاز الخارجي.');
    } finally {
      setSavingExternal(false);
    }
  };

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
      <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center flex flex-col items-center justify-center shadow-sm">
        <Cpu className="w-12 h-12 text-slate-300 mb-4" />
        <h4 className="text-base text-slate-600 font-black mb-2">لا توجد أجهزة مسجلة</h4>
        <p className="text-xs text-slate-400 font-bold max-w-md">
          لم يقم هذا الزبون بشراء أي جهاز بعد، أو لم تُسلَّم الأجهزة الخاصة به.
        </p>
        <button
          type="button"
          onClick={() => { resetExternalForm(); setExternalModalOpen(true); }}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500"
        >
          <Plus className="h-4 w-4" />
          إضافة جهاز خارجي
        </button>
        {externalModalOpen && (
          <ExternalDeviceModalV2
            deviceModelId={externalDeviceModelId}
            deviceModels={externalDeviceModels}
            geoUnits={externalGeoUnits}
            geoSelection={externalGeoSelection}
            address={externalAddress}
            mapPosition={externalMapPosition}
            showMapPicker={showExternalMapPicker}
            serial={externalSerial}
            notes={externalNotes}
            error={externalError}
            saving={savingExternal}
            loadingOptions={externalOptionsLoading}
            onDeviceModelChange={setExternalDeviceModelId}
            onGeoSelectionChange={setExternalGeoSelection}
            onAddressChange={setExternalAddress}
            onMapPositionChange={setExternalMapPosition}
            onToggleMapPicker={() => setShowExternalMapPicker(prev => !prev)}
            onSerialChange={setExternalSerial}
            onNotesChange={setExternalNotes}
            onClose={() => setExternalModalOpen(false)}
            onSave={saveExternalDevice}
          />
        )}
      </div>
    );
  }

  // Columns mirror the original raw table 1:1 (design-only migration to <SmartTable>).
  const columns: ColumnDef<DeviceRow>[] = [
    { key: 'model', label: 'الموديل', render: ({ device }) => <span className="text-sm font-bold text-slate-800">{device.deviceModelName}</span> },
    { key: 'serial', label: 'الرقم التسلسلي', render: ({ device }) => <span className="font-mono text-sm text-slate-600">{device.serialNumber || '—'}</span> },
    { key: 'status', label: 'الحالة', render: ({ device }) => <DeviceStatusBadge status={device.status} /> },
    {
      key: 'warranty', label: 'الكفالة',
      render: ({ warranty }) => <WarrantyStatusBadge status={warranty?.status} cancellationReason={warranty?.cancellationReason} endDate={warranty?.endDate} />,
    },
    { key: 'holder', label: 'الحائز الحالي', render: ({ current }) => <PossessionHolderChip holderType={current?.holderType} reason={current?.reason} /> },
    {
      key: 'contract', label: 'رقم العقد',
      render: ({ device }) => (
        <div>
          <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${device.deviceSource === 'external' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
            {device.deviceSource === 'external' ? 'خارجي' : 'من عقد'}
          </span>
          <br />
          {device.contractNumber ? (
            <a onClick={(e) => e.stopPropagation()} href={`/contracts/${device.contractId}`} className="font-mono text-sm text-sky-600 hover:underline">
              #{device.contractNumber}
            </a>
          ) : <span className="text-sm text-slate-500">—</span>}
        </div>
      ),
    },
    { key: 'installedAt', label: 'تاريخ التركيب', render: ({ device }) => <span className="text-sm text-slate-600">{fmt(device.installationDate || device.deliveryDate)}</span> },
    {
      key: 'action', label: 'الإجراء',
      render: () => <span className="inline-flex items-center gap-1 text-sm text-sky-600 font-bold">فتح <ExternalLink className="w-3 h-3" /></span>,
    },
  ];

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-center justify-end gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => { resetExternalForm(); setExternalModalOpen(true); }}
          className="ml-2 inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
        >
          <Plus className="h-3.5 w-3.5" />
          جهاز خارجي
        </button>
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

      <SmartTable<DeviceRow>
        title="أجهزة الزبون"
        icon={Cpu}
        data={filtered}
        columns={columns}
        getId={({ device }) => device.id}
        onRowClick={({ device }) => navigate(`/installed-devices/${device.id}`)}
        hideFilterBar
        tableMinWidth={1100}
        emptyIcon={Cpu}
        emptyMessage="لا أجهزة تطابق الفلتر الحالي."
      />
      {externalModalOpen && (
        <ExternalDeviceModalV2
          deviceModelId={externalDeviceModelId}
          deviceModels={externalDeviceModels}
          geoUnits={externalGeoUnits}
          geoSelection={externalGeoSelection}
          address={externalAddress}
          mapPosition={externalMapPosition}
          showMapPicker={showExternalMapPicker}
          serial={externalSerial}
          notes={externalNotes}
          error={externalError}
          saving={savingExternal}
          loadingOptions={externalOptionsLoading}
          onDeviceModelChange={setExternalDeviceModelId}
          onGeoSelectionChange={setExternalGeoSelection}
          onAddressChange={setExternalAddress}
          onMapPositionChange={setExternalMapPosition}
          onToggleMapPicker={() => setShowExternalMapPicker(prev => !prev)}
          onSerialChange={setExternalSerial}
          onNotesChange={setExternalNotes}
          onClose={() => setExternalModalOpen(false)}
          onSave={saveExternalDevice}
        />
      )}
    </div>
  );
}

export default DevicesTab;
