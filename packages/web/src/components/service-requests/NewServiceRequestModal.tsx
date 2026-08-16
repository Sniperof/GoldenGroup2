// ============================================================
// NewServiceRequestModal — V1.0 simplified intake
// Constitution: maintenance-v1.md §٣ + §١٢
//   - زبون موجود إلزامي (لا walk-in في V1.0)
//   - جهاز من أجهزة الزبون إلزامي
//   - وصف المشكلة إلزامي
//   - حقول العنوان/walk-in مَحذوفة من V1.0 (تُؤخَذ من الجهاز عند promote)
// ============================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, AlertCircle, Loader2, Search, Check } from '../ui/icons';
import { api } from '../../lib/api';
import Select from '../ui/Select';
import Modal from '../ui/Modal';

type Channel = 'internal_button' | 'client_detail_button' | 'admin_manual' | 'phone';

interface Props {
  channel: Channel;
  initialRequestType?: 'emergency_maintenance' | 'device_request' | 'periodic_maintenance' | 'golden_warranty';
  /** Preselected beneficiary client (used by client_detail_button). */
  beneficiaryClientId?: number | null;
  beneficiaryClientName?: string | null;
  contractId?: number | null;
  /** Preselected device (used when opened from a device page). */
  installedDeviceId?: number | null;
  requesterClientId?: number | null;
  requesterClientName?: string | null;
  callContext?: {
    customerId: number;
    contactId?: string | null;
    contactNumber?: string | null;
    contactLabel?: string | null;
    callDate?: string | null;
    taskListItemId?: string | number | null;
    answeredBy?: string | null;
    communicationChannel?: string | null;
    notes?: string | null;
  } | null;
  onClose: () => void;
  onCreated?: (serviceRequestId: number) => void;
}

const CHANNEL_TITLES: Record<Channel, string> = {
  internal_button: 'طلب صيانة جديد',
  client_detail_button: 'طلب صيانة لهذا العميل',
  admin_manual: 'إنشاء طلب صيانة يدوياً',
  phone: 'مكالمة صيانة واردة',
};

interface ClientLite {
  id: number;
  name?: string;
  fullName?: string;
  phone?: string;
  mobile?: string;
}

interface DeviceLite {
  id: number;
  serialNumber?: string | null;
  deviceModelName?: string | null;
  status?: string | null;
  modelSupportsGoldenWarranty?: boolean;
  goldenWarrantyPeriods?: Array<{ months: number; label: string }>;
}

interface CatalogModelLite {
  id: number;
  name?: string;
  nameAr?: string;
  name_ar?: string;
}

interface PurposeLite {
  id: number;
  value: string;
  isActive?: boolean;
  metadata?: { code?: string } | null;
}

interface GeoLite {
  id: number;
  name: string;
  level: number;
  parentId?: number | null;
  parent_id?: number | null;
}

export default function NewServiceRequestModal({
  channel,
  initialRequestType = 'emergency_maintenance',
  beneficiaryClientId: initialClientId = null,
  beneficiaryClientName: initialClientName = null,
  contractId = null,
  installedDeviceId: initialDeviceId = null,
  requesterClientId = null,
  requesterClientName = null,
  callContext = null,
  onClose,
  onCreated,
}: Props) {
  const navigate = useNavigate();
  const [requestType, setRequestType] = useState<'emergency_maintenance' | 'device_request' | 'periodic_maintenance' | 'golden_warranty'>(initialRequestType);
  const [submissionMode, setSubmissionMode] = useState<'for_self' | 'for_another'>('for_self');

  // Linked client (mandatory)
  const [clientId, setClientId] = useState<number | null>(initialClientId);
  const [clientName, setClientName] = useState<string | null>(initialClientName);

  // Client search state (only shown when no preselected client)
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<ClientLite[]>([]);
  const [searchingClients, setSearchingClients] = useState(false);

  // Devices for the selected client (mandatory pick once client is chosen)
  const [deviceId, setDeviceId] = useState<number | null>(initialDeviceId);
  const [devices, setDevices] = useState<DeviceLite[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceSelection, setDeviceSelection] = useState<'registered_device' | 'catalog_model' | 'other'>('registered_device');
  const [catalogModels, setCatalogModels] = useState<CatalogModelLite[]>([]);
  const [catalogModelId, setCatalogModelId] = useState<number | null>(null);
  const [otherDeviceName, setOtherDeviceName] = useState('');
  const [externalSerial, setExternalSerial] = useState('');
  const [geoUnits, setGeoUnits] = useState<GeoLite[]>([]);
  const [governorateId, setGovernorateId] = useState<number | null>(null);
  const [regionId, setRegionId] = useState<number | null>(null);
  const [subdistrictId, setSubdistrictId] = useState<number | null>(null);
  const [neighborhoodId, setNeighborhoodId] = useState<number | null>(null);
  const [detailedAddress, setDetailedAddress] = useState('');

  // Form fields
  const [problemDescription, setProblemDescription] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [priority, setPriority] = useState<'Critical' | 'High' | 'Normal' | 'Low'>('Normal');
  const [deviceRequestPurposes, setDeviceRequestPurposes] = useState<PurposeLite[]>([]);
  const [purposeId, setPurposeId] = useState<number | null>(null);
  const [requestedDeviceModelIds, setRequestedDeviceModelIds] = useState<number[]>([]);
  const [deviceRequestNotes, setDeviceRequestNotes] = useState('');
  const [periodicReasons, setPeriodicReasons] = useState<PurposeLite[]>([]);
  const [periodicReasonId, setPeriodicReasonId] = useState<number | null>(null);
  const [requestedWarrantyMonths, setRequestedWarrantyMonths] = useState<number | null>(null);
  const [beneficiaryContactConsentConfirmed, setBeneficiaryContactConsentConfirmed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [clientId, deviceId, problemDescription, periodicReasonId, governorateId, detailedAddress]);

  useEffect(() => {
    Promise.all([
      api.deviceModels.list(),
      api.geoUnits.listReference(),
      api.systemLists.getItemsByCode('device_request_purpose'),
      api.systemLists.getItemsByCode('periodic_maintenance_request_reasons'),
    ])
      .then(([models, units, purposes, periodicReasonItems]) => {
        setCatalogModels((models as CatalogModelLite[]) ?? []);
        setGeoUnits((units as GeoLite[]) ?? []);
        setDeviceRequestPurposes(((purposes as PurposeLite[]) ?? []).filter((item) => item.isActive !== false));
        setPeriodicReasons(((periodicReasonItems as PurposeLite[]) ?? []).filter((item) => item.isActive !== false));
      })
      .catch(() => undefined);
  }, []);

  // -------- Client search (debounced) --------
  useEffect(() => {
    if (clientId != null) return; // already selected
    if (clientSearch.trim().length < 2) {
      setClientResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearchingClients(true);
      try {
        const list = await api.clients.list();
        const q = clientSearch.trim().toLowerCase();
        const filtered = (list as ClientLite[])
          .filter((c) => {
            const name = (c.fullName ?? c.name ?? '').toLowerCase();
            const phone = String(c.phone ?? c.mobile ?? '');
            return name.includes(q) || phone.includes(clientSearch.trim());
          })
          .slice(0, 12);
        setClientResults(filtered);
      } catch (e) {
        setClientResults([]);
      } finally {
        setSearchingClients(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientSearch, clientId]);

  // -------- Devices for selected client --------
  useEffect(() => {
    if (clientId == null) {
      setDevices([]);
      return;
    }
    let cancelled = false;
    setLoadingDevices(true);
    (async () => {
      try {
        const list = await api.installedDevices.list({ customerId: clientId });
        if (!cancelled) {
          setDevices((list as DeviceLite[]) ?? []);
          // If a single device exists, auto-select to reduce friction
          if (!deviceId && Array.isArray(list) && list.length === 1) {
            setDeviceId((list[0] as DeviceLite).id);
          }
        }
      } finally {
        if (!cancelled) setLoadingDevices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function selectClient(c: ClientLite) {
    setClientId(c.id);
    setClientName(c.fullName ?? c.name ?? `#${c.id}`);
    setClientSearch('');
    setClientResults([]);
    setDeviceId(null);
  }

  function clearClient() {
    if (initialClientId != null && submissionMode === 'for_self') return;
    setClientId(null);
    setClientName(null);
    setDeviceId(null);
    setDevices([]);
  }

  function validate(): string | null {
    if ((requestType === 'periodic_maintenance' || requestType === 'golden_warranty') && !callContext) {
      return 'طلب الصيانة الدورية يُنشأ من نتيجة اتصال التيلماركتر فقط';
    }
    if (clientId == null) return 'اختيار زبون موجود إلزامي';
    if (requestType === 'golden_warranty') {
      if (clientId == null) return 'اختيار المستفيد إلزامي';
      if (deviceId == null) return 'اختيار جهاز فعال ومؤهل للكفالة الذهبية إلزامي';
      const selected = devices.find((device) => device.id === deviceId);
      if (!selected?.modelSupportsGoldenWarranty || selected.status !== 'active') return 'الجهاز المختار غير مؤهل للكفالة الذهبية';
      if (!requestedWarrantyMonths) return 'اختيار مدة الكفالة إلزامي';
      if (!beneficiaryContactConsentConfirmed) return 'تأكيد موافقة التواصل مع المستفيد إلزامي';
      return null;
    }
    if (requestType === 'device_request') {
      if (purposeId == null) return 'اختيار غرض الطلب إلزامي';
      const purpose = deviceRequestPurposes.find((item) => Number(item.id) === purposeId);
      if ((requestedDeviceModelIds.length === 0 || purpose?.metadata?.code === 'other') && !deviceRequestNotes.trim()) {
        return 'الملاحظات إلزامية عند عدم اختيار جهاز أو عند اختيار غرض آخر';
      }
      return null;
    }
    if (deviceSelection === 'registered_device' && deviceId == null) return 'اختيار جهاز للزبون إلزامي';
    if (deviceSelection === 'catalog_model' && catalogModelId == null) return 'اختيار طراز الجهاز إلزامي';
    if (deviceSelection === 'other' && !otherDeviceName.trim()) return 'اسم الجهاز الآخر إلزامي';
    if ((requestType === 'periodic_maintenance' || deviceSelection !== 'registered_device')
      && (!governorateId || !detailedAddress.trim())) {
      return requestType === 'periodic_maintenance'
        ? 'المحافظة والعنوان التفصيلي مطلوبان لطلب الصيانة الدورية'
        : 'المحافظة والعنوان التفصيلي مطلوبان للجهاز الخارجي';
    }
    if (requestType === 'periodic_maintenance' && periodicReasonId == null) return 'سبب طلب الصيانة الدورية إلزامي';
    if (requestType === 'emergency_maintenance' && !problemDescription.trim()) return 'وصف المشكلة إلزامي';
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // V1.0 payload — no walk-in, no service_address, no requesterExternal.
      // serviceAddress is omitted; the backend / promote step will derive it
      // from the device's installation address.
      const payload = requestType === 'device_request' ? {
        requestType,
        channel,
        beneficiaryClientId: clientId,
        requesterClientId: requesterClientId ?? clientId,
        submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' as const : 'apply' as const,
        purposeId,
        deviceModelIds: requestedDeviceModelIds,
        notes: deviceRequestNotes.trim() || null,
      } : requestType === 'golden_warranty' ? {
        requestType,
        channel,
        beneficiaryClientId: clientId,
        requesterClientId: requesterClientId ?? clientId,
        submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' as const : 'apply' as const,
        installedDeviceId: deviceId,
        requestedWarrantyMonths,
        beneficiaryContactConsentConfirmed,
        notes: callNotes.trim() || null,
      } : requestType === 'periodic_maintenance' ? {
        requestType,
        channel,
        reasonId: periodicReasonId,
        beneficiaryClientId: clientId,
        requesterClientId: requesterClientId ?? clientId,
        submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' as const : 'apply' as const,
        reportedDeviceSelection: deviceSelection,
        installedDeviceId: deviceSelection === 'registered_device' ? deviceId : null,
        reportedDeviceModelId: deviceSelection === 'catalog_model' ? catalogModelId : null,
        externalDeviceName: deviceSelection === 'catalog_model'
          ? (catalogModels.find((model) => model.id === catalogModelId)?.nameAr
            ?? catalogModels.find((model) => model.id === catalogModelId)?.name_ar
            ?? catalogModels.find((model) => model.id === catalogModelId)?.name
            ?? null)
          : deviceSelection === 'other' ? otherDeviceName.trim() : null,
        externalDeviceSerial: deviceSelection === 'registered_device' ? null : externalSerial.trim() || null,
        serviceAddress: {
          governorate: String(governorateId),
          governorateId,
          regionId,
          subdistrictId,
          neighborhoodId,
          geo_unit_id: neighborhoodId ?? subdistrictId ?? regionId ?? governorateId,
          detailed_address: detailedAddress.trim(),
          detailedAddress: detailedAddress.trim(),
        },
      } : {
        requestType: 'emergency_maintenance',
        channel,
        problemDescription: problemDescription.trim(),
        priority,
        beneficiaryClientId: clientId,
        contractId,
        installedDeviceId: deviceSelection === 'registered_device' ? deviceId : null,
        deviceSource: deviceSelection === 'registered_device' ? 'company_device' as const : 'external_device' as const,
        reportedDeviceSelection: deviceSelection,
        reportedDeviceModelId: deviceSelection === 'catalog_model' ? catalogModelId : null,
        externalDeviceName: deviceSelection === 'catalog_model'
          ? (catalogModels.find((model) => model.id === catalogModelId)?.nameAr
            ?? catalogModels.find((model) => model.id === catalogModelId)?.name_ar
            ?? catalogModels.find((model) => model.id === catalogModelId)?.name
            ?? null)
          : deviceSelection === 'other' ? otherDeviceName.trim() : null,
        externalDeviceSerial: deviceSelection === 'registered_device' ? null : externalSerial.trim() || null,
        serviceAddress: deviceSelection === 'registered_device' ? null : {
          governorate: String(governorateId),
          governorateId,
          regionId,
          subdistrictId,
          neighborhoodId,
          geo_unit_id: neighborhoodId ?? subdistrictId ?? regionId ?? governorateId,
          detailed_address: detailedAddress.trim(),
          detailedAddress: detailedAddress.trim(),
        },
        requesterClientId: requesterClientId ?? clientId,
        submissionType: submissionMode === 'for_another' ? 'refer_a_candidate' as const : 'apply' as const,
        submitterTier: 'staff' as const,
      };
      const res = callContext
        ? await api.serviceRequests.createInternalWithCall(
          { ...callContext, notes: callNotes.trim() || callContext.notes || null },
          payload,
        )
        : channel === 'admin_manual'
          ? await api.serviceRequests.createInternal(payload)
          : await api.serviceRequests.create(payload);

      // Capture optional call notes as the first internal note on the request.
      const note = callNotes.trim();
      if (note && !callContext && (res as { id?: number })?.id) {
        try {
          await fetch(
            `${(window as any).__API_BASE__ ?? '/api'}/service-requests/${(res as any).id}/notes`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('hr_token') ?? ''}`,
              },
              body: JSON.stringify({ note }),
            },
          );
        } catch {
          // non-blocking
        }
      }

      if (onCreated) onCreated((res as { id: number }).id);
      else navigate(`/service-requests/${(res as { id: number }).id}`);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل إنشاء الطلب');
    } finally {
      setBusy(false);
    }
  }

  const isClientLocked = initialClientId != null && submissionMode === 'for_self';

  function changeSubmissionMode(mode: 'for_self' | 'for_another') {
    setSubmissionMode(mode);
    if (mode === 'for_self') {
      const selfId = requesterClientId ?? initialClientId;
      setClientId(selfId ?? null);
      setClientName(requesterClientName ?? initialClientName ?? null);
    } else {
      setClientId(null);
      setClientName(null);
      setDeviceId(null);
      setDevices([]);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="2xl"
      title={requestType === 'device_request' ? 'طلب جهاز جديد' : CHANNEL_TITLES[channel]}
      subtitle={<>قناة: <span className="font-medium">{channel}</span></>}
      footer={
        <>
          <button
            onClick={onClose}
            className="text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded"
          >
            إلغاء
          </button>
          <button
            disabled={busy}
            onClick={submit}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded flex items-center gap-1"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {busy ? 'جاري الإنشاء...' : 'إنشاء الطلب'}
          </button>
        </>
      }
    >
        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 rounded flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">نوع الطلب</h3>
            <div className={`grid gap-2 ${callContext ? 'grid-cols-4' : 'grid-cols-2'}`}>
              <button
                type="button"
                onClick={() => setRequestType('emergency_maintenance')}
                className={`rounded-xl border p-2 text-sm ${requestType === 'emergency_maintenance' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
              >صيانة طارئة</button>
              <button
                type="button"
                onClick={() => setRequestType('device_request')}
                className={`rounded-xl border p-2 text-sm ${requestType === 'device_request' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
              >طلب جهاز</button>
              {callContext && (
                <button
                  type="button"
                  onClick={() => setRequestType('periodic_maintenance')}
                  className={`rounded-xl border p-2 text-sm ${requestType === 'periodic_maintenance' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
                >صيانة دورية</button>
              )}
              {callContext && (
                <button
                  type="button"
                  onClick={() => { setRequestType('golden_warranty'); setDeviceSelection('registered_device'); }}
                  className={`rounded-xl border p-2 text-sm ${requestType === 'golden_warranty' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200'}`}
                >كفالة ذهبية</button>
              )}
            </div>
          </section>

          {requesterClientId != null && (
            <section className="space-y-2">
              <h3 className="text-base font-bold text-slate-800">مقدم الطلب</h3>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                {requesterClientName ?? `#${requesterClientId}`}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => changeSubmissionMode('for_self')}
                  className={`rounded-xl border p-2 text-sm ${submissionMode === 'for_self' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
                >
                  الخدمة لمقدم الطلب
                </button>
                <button
                  type="button"
                  onClick={() => changeSubmissionMode('for_another')}
                  className={`rounded-xl border p-2 text-sm ${submissionMode === 'for_another' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
                >
                  الخدمة لشخص آخر
                </button>
              </div>
            </section>
          )}

          {/* (1) Client — mandatory, from existing only (V1.0) */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              {submissionMode === 'for_another' ? 'المستفيد' : 'الزبون'} <span className="text-xs text-red-600">*</span>
            </h3>
            {clientId != null ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded p-2 text-sm">
                <span className="flex items-center gap-2 text-green-800">
                  <Check className="h-4 w-4" />
                  {clientName ?? `#${clientId}`}
                </span>
                {!isClientLocked && (
                  <button onClick={clearClient} className="text-xs text-slate-500 hover:text-red-600">
                    تَغيير
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="ابحث بالاسم أو الهاتف (حرفين فأكثر)"
                    className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 pr-10 focus:border-sky-500 focus:outline-none transition-colors"
                  />
                </div>
                {searchingClients && (
                  <div className="text-xs text-slate-500 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    جارٍ البحث...
                  </div>
                )}
                {clientResults.length > 0 && (
                  <ul className="border border-slate-200 rounded divide-y divide-slate-100 max-h-48 overflow-auto">
                    {clientResults.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => selectClient(c)}
                          className="w-full text-right p-2 text-sm hover:bg-blue-50"
                        >
                          <div className="font-medium text-slate-800">
                            {c.fullName ?? c.name ?? `#${c.id}`}
                          </div>
                          <div className="text-xs text-slate-500">
                            {c.phone ?? c.mobile ?? '— لا هاتف —'}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {clientSearch.trim().length >= 2 && !searchingClients && clientResults.length === 0 && (
                  <div className="text-xs text-slate-500">لا نتائج. (إنشاء زبون جديد خارج نطاق V1.0)</div>
                )}
              </div>
            )}
          </section>

          {requestType === 'device_request' && (
            <section className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-800">غرض الطلب <span className="text-xs text-red-600">*</span></h3>
                <Select
                  value={purposeId == null ? '' : String(purposeId)}
                  onChange={(value) => setPurposeId(value ? Number(value) : null)}
                  placeholder="اختر غرض الطلب"
                  ariaLabel="غرض طلب الجهاز"
                  options={deviceRequestPurposes.map((purpose) => ({ value: String(purpose.id), label: purpose.value }))}
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-800">الأجهزة المهتم بها <span className="text-xs font-normal text-slate-500">(اختياري)</span></h3>
                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-auto rounded-xl border border-slate-200 bg-white p-2 md:grid-cols-2">
                  {catalogModels.map((model) => {
                    const checked = requestedDeviceModelIds.includes(model.id);
                    const label = model.nameAr ?? model.name_ar ?? model.name ?? `#${model.id}`;
                    return (
                      <label key={model.id} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setRequestedDeviceModelIds((current) => checked
                            ? current.filter((id) => id !== model.id)
                            : [...current, model.id])}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-800">ملاحظات</h3>
                <textarea
                  value={deviceRequestNotes}
                  onChange={(event) => setDeviceRequestNotes(event.target.value)}
                  placeholder="إلزامية عند عدم اختيار جهاز أو عند اختيار غرض آخر"
                  rows={3}
                  className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                />
              </div>
            </section>
          )}

          {(requestType === 'emergency_maintenance' || requestType === 'periodic_maintenance' || requestType === 'golden_warranty') && <>
          {requestType === 'periodic_maintenance' && (
            <section className="space-y-2">
              <h3 className="text-base font-bold text-slate-800">سبب طلب الصيانة الدورية <span className="text-xs text-red-600">*</span></h3>
              <Select
                value={periodicReasonId == null ? '' : String(periodicReasonId)}
                onChange={(value) => setPeriodicReasonId(value ? Number(value) : null)}
                placeholder="اختر سبب الطلب"
                ariaLabel="سبب طلب الصيانة الدورية"
                options={periodicReasons.map((reason) => ({ value: String(reason.id), label: reason.value }))}
              />
            </section>
          )}
          {requestType === 'golden_warranty' && (
            <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <p className="text-sm font-bold text-amber-900">طلب كفالة ذهبية لجهاز واحد</p>
              <p className="text-xs text-amber-800">اختر الجهاز أولاً؛ ستظهر المدد التي يدعمها طراز هذا الجهاز حصراً.</p>
              <Select
                value={requestedWarrantyMonths == null ? '' : String(requestedWarrantyMonths)}
                onChange={(value) => setRequestedWarrantyMonths(value ? Number(value) : null)}
                placeholder="اختر مدة الكفالة"
                ariaLabel="مدة الكفالة الذهبية المطلوبة"
                options={(devices.find((device) => device.id === deviceId)?.goldenWarrantyPeriods ?? [])
                  .map((period) => ({ value: String(period.months), label: period.label }))}
              />
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={beneficiaryContactConsentConfirmed}
                  onChange={(event) => setBeneficiaryContactConsentConfirmed(event.target.checked)}
                />
                <span>أؤكد موافقة المستفيد على التواصل معه بخصوص هذا الطلب.</span>
              </label>
              <p className="text-xs text-slate-600">المدة تقفل مع الطلب ولا يمكن للموظف أو نتيجة المهمة تغييرها. السعر لا يسجل هنا.</p>
            </section>
          )}
          {/* (2) Device — registered, catalog, or another reported device */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              الجهاز <span className="text-xs text-red-600">*</span>
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                ['registered_device', 'جهاز مسجل'],
                ['catalog_model', 'من أجهزة الشركة'],
                ['other', 'جهاز آخر'],
              ] as const).filter(([value]) => requestType !== 'golden_warranty' || value === 'registered_device').map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setDeviceSelection(value); setDeviceId(null); }}
                  className={`rounded-xl border p-2 text-xs ${deviceSelection === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {deviceSelection === 'registered_device' && (clientId == null ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
                اختر الزبون أولاً لرؤية أجهزته.
              </div>
            ) : loadingDevices ? (
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> جارٍ تَحميل الأجهزة...
              </div>
            ) : devices.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                لا أجهزة مُسجَّلة لهذا الزبون. اختر «من أجهزة الشركة» أو «جهاز آخر».
              </div>
            ) : (
              <Select
                value={deviceId == null ? '' : String(deviceId)}
                onChange={v => { setDeviceId(v === '' ? null : Number(v)); setRequestedWarrantyMonths(null); }}
                placeholder="— اختر جهازاً —"
                ariaLabel="الجهاز"
                className="w-full"
                options={devices
                  .filter((d) => requestType !== 'golden_warranty'
                    || (d.status === 'active' && d.modelSupportsGoldenWarranty && (d.goldenWarrantyPeriods?.length ?? 0) > 0))
                  .map(d => ({
                  value: String(d.id),
                  label: (d.deviceModelName ?? 'جهاز')
                    + (d.serialNumber ? ` · S/N: ${d.serialNumber}` : '')
                    + (d.status ? ` · ${d.status}` : ''),
                }))}
              />
            ))}
            {deviceSelection === 'catalog_model' && (
              <Select
                value={catalogModelId == null ? '' : String(catalogModelId)}
                onChange={(value) => setCatalogModelId(value ? Number(value) : null)}
                placeholder="اختر طراز الجهاز"
                ariaLabel="طراز الجهاز"
                className="w-full"
                options={catalogModels.map((model) => ({
                  value: String(model.id),
                  label: model.nameAr ?? model.name_ar ?? model.name ?? `#${model.id}`,
                }))}
              />
            )}
            {deviceSelection === 'other' && (
              <input
                value={otherDeviceName}
                onChange={(event) => setOtherDeviceName(event.target.value)}
                placeholder="اكتب اسم الجهاز الموجود لدى المستفيد"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
              />
            )}
            {deviceSelection !== 'registered_device' && (
              <>
                <input
                  value={externalSerial}
                  onChange={(event) => setExternalSerial(event.target.value)}
                  placeholder="الرقم التسلسلي إن وجد"
                  className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Select
                    value={governorateId == null ? '' : String(governorateId)}
                    onChange={(value) => { setGovernorateId(value ? Number(value) : null); setRegionId(null); setSubdistrictId(null); setNeighborhoodId(null); }}
                    placeholder="المحافظة"
                    ariaLabel="المحافظة"
                    options={geoUnits.filter((unit) => unit.level === 1).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={regionId == null ? '' : String(regionId)}
                    onChange={(value) => { setRegionId(value ? Number(value) : null); setSubdistrictId(null); setNeighborhoodId(null); }}
                    placeholder="المدينة أو المنطقة"
                    ariaLabel="المدينة أو المنطقة"
                    options={geoUnits.filter((unit) => unit.level === 2 && Number(unit.parentId ?? unit.parent_id) === governorateId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={subdistrictId == null ? '' : String(subdistrictId)}
                    onChange={(value) => { setSubdistrictId(value ? Number(value) : null); setNeighborhoodId(null); }}
                    placeholder="الناحية"
                    ariaLabel="الناحية"
                    options={geoUnits.filter((unit) => unit.level === 3 && Number(unit.parentId ?? unit.parent_id) === regionId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={neighborhoodId == null ? '' : String(neighborhoodId)}
                    onChange={(value) => setNeighborhoodId(value ? Number(value) : null)}
                    placeholder="الحي"
                    ariaLabel="الحي"
                    options={geoUnits.filter((unit) => unit.level === 4 && Number(unit.parentId ?? unit.parent_id) === subdistrictId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                </div>
                <textarea
                  value={detailedAddress}
                  onChange={(event) => setDetailedAddress(event.target.value)}
                  placeholder="العنوان التفصيلي لموقع الجهاز المبلّغ عنه"
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                />
              </>
            )}
            {requestType === 'periodic_maintenance' && deviceSelection === 'registered_device' && (
              <>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Select
                    value={governorateId == null ? '' : String(governorateId)}
                    onChange={(value) => { setGovernorateId(value ? Number(value) : null); setRegionId(null); setSubdistrictId(null); setNeighborhoodId(null); }}
                    placeholder="المحافظة"
                    ariaLabel="المحافظة"
                    options={geoUnits.filter((unit) => unit.level === 1).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={regionId == null ? '' : String(regionId)}
                    onChange={(value) => { setRegionId(value ? Number(value) : null); setSubdistrictId(null); setNeighborhoodId(null); }}
                    placeholder="المدينة أو المنطقة"
                    ariaLabel="المدينة أو المنطقة"
                    options={geoUnits.filter((unit) => unit.level === 2 && Number(unit.parentId ?? unit.parent_id) === governorateId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={subdistrictId == null ? '' : String(subdistrictId)}
                    onChange={(value) => { setSubdistrictId(value ? Number(value) : null); setNeighborhoodId(null); }}
                    placeholder="الناحية"
                    ariaLabel="الناحية"
                    options={geoUnits.filter((unit) => unit.level === 3 && Number(unit.parentId ?? unit.parent_id) === regionId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                  <Select
                    value={neighborhoodId == null ? '' : String(neighborhoodId)}
                    onChange={(value) => setNeighborhoodId(value ? Number(value) : null)}
                    placeholder="الحي"
                    ariaLabel="الحي"
                    options={geoUnits.filter((unit) => unit.level === 4 && Number(unit.parentId ?? unit.parent_id) === subdistrictId).map((unit) => ({ value: String(unit.id), label: unit.name }))}
                  />
                </div>
                <textarea
                  value={detailedAddress}
                  onChange={(event) => setDetailedAddress(event.target.value)}
                  placeholder="العنوان التفصيلي المطلوب للخدمة"
                  rows={2}
                  className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                />
              </>
            )}
          </section>

          {/* (3) Problem description — mandatory */}
          {requestType === 'emergency_maintenance' && <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              وصف المشكلة <span className="text-xs text-red-600">*</span>
            </h3>
            <textarea
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              placeholder="صَوت الزبون — اكتب ما يَقوله بلا تَفسير (immutable بعد الإنشاء، SR-R008)"
              rows={3}
              className="w-full text-sm border border-slate-300 rounded p-2"
            />
          </section>}

          </>}

          {/* (4) Call notes — optional (stored as first internal note) */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">ملاحظات على المكالمة</h3>
            <textarea
              value={callNotes}
              onChange={(e) => setCallNotes(e.target.value)}
              placeholder="ملاحظات داخلية للموظف المُستلِم (اختياري)"
              rows={2}
              className="w-full text-sm border border-slate-300 rounded p-2"
            />
          </section>

          {/* (5) Priority */}
          {requestType === 'emergency_maintenance' && <section className="flex items-center gap-2">
            <span className="text-xs text-slate-500">الأولوية:</span>
            <Select<'Critical' | 'High' | 'Normal' | 'Low'>
              value={priority}
              onChange={setPriority}
              ariaLabel="الأولوية"
              size="sm"
              options={[
                { value: 'Critical', label: 'حرجة' },
                { value: 'High', label: 'عالية' },
                { value: 'Normal', label: 'عادية' },
                { value: 'Low', label: 'منخفضة' },
              ]}
            />
          </section>}

          <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded">
            {requestType === 'device_request'
              ? 'طلب الجهاز لا يقبل صوراً أو فيديو أو مرفقات.'
              : requestType === 'periodic_maintenance'
                ? 'طلب الصيانة الدورية لا يقبل صوراً أو فيديو أو مرفقات.'
                : '💡 المرفقات وقائمة الأعطال تُضاف من شاشة تفاصيل الطلب بعد الإنشاء.'}
          </p>
        </div>
    </Modal>
  );
}
