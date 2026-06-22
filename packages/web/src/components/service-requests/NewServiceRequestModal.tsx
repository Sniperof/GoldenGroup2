// ============================================================
// NewServiceRequestModal — V1.0 simplified intake
// Constitution: maintenance-v1.md §٣ + §١٢
//   - زبون موجود إلزامي (لا walk-in في V1.0)
//   - جهاز من أجهزة الزبون إلزامي
//   - وصف المشكلة إلزامي
//   - حقول العنوان/walk-in مَحذوفة من V1.0 (تُؤخَذ من الجهاز عند promote)
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import IconButton from '../ui/IconButton';
import { useNavigate } from 'react-router-dom';
import { X, Send, AlertCircle, Loader2, Search, Check } from 'lucide-react';
import { api } from '../../lib/api';
import Select from '../ui/Select';

type Channel = 'internal_button' | 'client_detail_button' | 'admin_manual' | 'phone';

interface Props {
  channel: Channel;
  /** Preselected beneficiary client (used by client_detail_button). */
  beneficiaryClientId?: number | null;
  beneficiaryClientName?: string | null;
  contractId?: number | null;
  /** Preselected device (used when opened from a device page). */
  installedDeviceId?: number | null;
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
}

export default function NewServiceRequestModal({
  channel,
  beneficiaryClientId: initialClientId = null,
  beneficiaryClientName: initialClientName = null,
  contractId = null,
  installedDeviceId: initialDeviceId = null,
  onClose,
  onCreated,
}: Props) {
  const navigate = useNavigate();

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

  // Form fields
  const [problemDescription, setProblemDescription] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [priority, setPriority] = useState<'Critical' | 'High' | 'Normal' | 'Low'>('Normal');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [clientId, deviceId, problemDescription]);

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
    if (initialClientId != null) return; // preselected — locked
    setClientId(null);
    setClientName(null);
    setDeviceId(null);
    setDevices([]);
  }

  function validate(): string | null {
    if (clientId == null) return 'اختيار زبون موجود إلزامي';
    if (deviceId == null) return 'اختيار جهاز للزبون إلزامي';
    if (!problemDescription.trim()) return 'وصف المشكلة إلزامي';
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
      const payload = {
        channel,
        problemDescription: problemDescription.trim(),
        priority,
        beneficiaryClientId: clientId,
        contractId,
        installedDeviceId: deviceId,
        deviceSource: 'company_device' as const,
        submissionType: 'apply' as const,
        submitterTier: 'staff' as const,
      };
      const res =
        channel === 'admin_manual'
          ? await api.serviceRequests.createInternal(payload)
          : await api.serviceRequests.create(payload);

      // Capture optional call notes as the first internal note on the request.
      const note = callNotes.trim();
      if (note && (res as { id?: number })?.id) {
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

  const isClientLocked = initialClientId != null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" dir="rtl">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[92vh] overflow-auto">
        <header className="flex items-center justify-between p-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{CHANNEL_TITLES[channel]}</h2>
            <div className="text-xs text-slate-500 mt-0.5">
              قناة: <span className="font-medium">{channel}</span>
            </div>
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </header>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 rounded flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* (1) Client — mandatory, from existing only (V1.0) */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              الزبون <span className="text-xs text-red-600">*</span>
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

          {/* (2) Device — mandatory, from client devices */}
          <section className="space-y-2">
            <h3 className="text-base font-bold text-slate-800">
              الجهاز <span className="text-xs text-red-600">*</span>
            </h3>
            {clientId == null ? (
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
                اختر الزبون أولاً لرؤية أجهزته.
              </div>
            ) : loadingDevices ? (
              <div className="text-xs text-slate-500 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> جارٍ تَحميل الأجهزة...
              </div>
            ) : devices.length === 0 ? (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                لا أجهزة مُسجَّلة لهذا الزبون. لا يُمكن إنشاء طلب صيانة بدون جهاز (V1.0).
              </div>
            ) : (
              <Select
                value={deviceId == null ? '' : String(deviceId)}
                onChange={v => setDeviceId(v === '' ? null : Number(v))}
                placeholder="— اختر جهازاً —"
                ariaLabel="الجهاز"
                className="w-full"
                options={devices.map(d => ({
                  value: String(d.id),
                  label: (d.deviceModelName ?? 'جهاز')
                    + (d.serialNumber ? ` · S/N: ${d.serialNumber}` : '')
                    + (d.status ? ` · ${d.status}` : ''),
                }))}
              />
            )}
          </section>

          {/* (3) Problem description — mandatory */}
          <section className="space-y-2">
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
          </section>

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
          <section className="flex items-center gap-2">
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
          </section>

          <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded">
            💡 المرفقات وقائمة الأعطال تُضاف من شاشة تفاصيل الطلب بعد الإنشاء.
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 p-3 border-t border-slate-200 bg-slate-50 sticky bottom-0">
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
        </footer>
      </div>
    </div>
  );
}
