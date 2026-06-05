// ============================================================
// NewServiceRequestModal — universal creator across 4 channels
// Constitution: maintenance.md §٠.٦ + §٠.١٢ + §٠.١٧.أ (walk-in fields)
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, Search, AlertCircle, User, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

type Channel = 'internal_button' | 'client_detail_button' | 'admin_manual' | 'phone';

interface Props {
  channel: Channel;
  /** Preselected beneficiary client (used by client_detail_button). */
  beneficiaryClientId?: number | null;
  beneficiaryClientName?: string | null;
  contractId?: number | null;
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

export default function NewServiceRequestModal({
  channel,
  beneficiaryClientId = null,
  beneficiaryClientName = null,
  contractId = null,
  installedDeviceId = null,
  onClose,
  onCreated,
}: Props) {
  const navigate = useNavigate();
  const isWalkIn = beneficiaryClientId == null;

  // Form state
  const [requesterName, setRequesterName] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [priority, setPriority] = useState<'Critical' | 'High' | 'Normal' | 'Low'>('Normal');
  const [governorate, setGovernorate] = useState('');
  const [detailedAddress, setDetailedAddress] = useState('');

  // Suggested-matches search (٠.١١)
  const [searchPhone, setSearchPhone] = useState('');
  const [matches, setMatches] = useState<{ clients: any[]; candidates: any[] } | null>(null);
  const [searching, setSearching] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [requesterName, requesterPhone, problemDescription, governorate, detailedAddress]);

  // Auto-search as the operator types phone (debounced).
  useEffect(() => {
    if (!isWalkIn || channel !== 'phone' || searchPhone.length < 4) {
      setMatches(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        // Lightweight search — we hit suggestedMatches by abusing a temporary
        // approach: backend exposes only /:id/suggested-matches, so for pre-creation
        // search we hit clients/candidates list endpoints via name/phone.
        // For now we surface no live matches; users see the matches after creation.
        // (Inline search endpoint may be added in future.)
        setMatches(null);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchPhone, channel, isWalkIn]);

  function validate(): string | null {
    if (!problemDescription.trim()) return 'وصف المشكلة إلزامي';
    if (!governorate.trim() || !detailedAddress.trim())
      return 'المحافظة والعنوان التفصيلي إلزاميان (SR-WALKIN-03)';
    if (isWalkIn) {
      if (!requesterName.trim() || !requesterPhone.trim())
        return 'الاسم والهاتف الرئيسي إلزاميان (SR-WALKIN-02)';
    }
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
      const payload = {
        channel,
        problemDescription: problemDescription.trim(),
        priority,
        serviceAddress: {
          governorate: governorate.trim(),
          detailed_address: detailedAddress.trim(),
        },
        beneficiaryClientId,
        contractId,
        installedDeviceId,
        deviceSource: installedDeviceId ? 'company_device' : undefined,
        requesterExternal: isWalkIn
          ? { name: requesterName.trim(), primary_phone: requesterPhone.trim() }
          : null,
        submissionType: 'apply',
        submitterTier: 'staff',
      };
      const res =
        channel === 'admin_manual'
          ? await api.serviceRequests.createInternal(payload)
          : await api.serviceRequests.create(payload);

      if (onCreated) onCreated(res.id);
      else navigate(`/service-requests/${res.id}`);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'فَشل إنشاء الطلب');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[80]" dir="rtl">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[92vh] overflow-auto">
        <header className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{CHANNEL_TITLES[channel]}</h2>
            <div className="text-xs text-gray-500 mt-0.5">
              قناة: <span className="font-medium">{channel}</span>
              {beneficiaryClientName && (
                <>
                  {' · '}
                  <span className="text-blue-700">للعميل: {beneficiaryClientName}</span>
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-2 rounded flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Walk-in requester section (٠.١٧.أ) */}
          {isWalkIn && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-1">
                <User className="h-4 w-4" />
                بيانات صاحب الطلب
                <span className="text-xs text-red-600">*</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={requesterName}
                  onChange={(e) => setRequesterName(e.target.value)}
                  placeholder="الاسم الكامل"
                  className="text-sm border border-gray-300 rounded p-2"
                />
                <input
                  type="tel"
                  value={requesterPhone}
                  onChange={(e) => {
                    setRequesterPhone(e.target.value);
                    setSearchPhone(e.target.value);
                  }}
                  placeholder="الهاتف الرئيسي"
                  className="text-sm border border-gray-300 rounded p-2"
                />
              </div>
              {channel === 'phone' && searchPhone.length >= 4 && (
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Search className="h-3 w-3" />
                  مُطابقات مقترَحة ستَظهر بعد الإنشاء في tab "الربط".
                  {searching && <Loader2 className="h-3 w-3 animate-spin" />}
                </p>
              )}
            </section>
          )}

          {/* Address — required for all (SR-WALKIN-03) */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">
              عنوان الخدمة <span className="text-xs text-red-600">*</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                placeholder="المحافظة (مثل: دمشق)"
                className="text-sm border border-gray-300 rounded p-2"
              />
              <input
                type="text"
                value={detailedAddress}
                onChange={(e) => setDetailedAddress(e.target.value)}
                placeholder="العنوان التفصيلي"
                className="text-sm border border-gray-300 rounded p-2"
              />
            </div>
          </section>

          {/* Problem + priority */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">
              المشكلة <span className="text-xs text-red-600">*</span>
            </h3>
            <textarea
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              placeholder="صَوت الزبون — اكتب ما يَقوله بلا تَفسير (immutable بعد الإنشاء، SR-R008)"
              rows={4}
              className="w-full text-sm border border-gray-300 rounded p-2"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">الأولوية:</span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="text-sm border border-gray-300 rounded p-1.5"
              >
                <option value="Critical">حرجة</option>
                <option value="High">عالية</option>
                <option value="Normal">عادية</option>
                <option value="Low">منخفضة</option>
              </select>
            </div>
          </section>

          {/* Note on linkage flow */}
          {isWalkIn && (
            <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
              💡 بعد الإنشاء يُمكنك ربط الطلب بعميل أو مرشّح من tab "الربط" في صفحة التفاصيل.
              لو لم تَربطه، يَبقى walk-in حتى الـ promote.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 p-3 border-t border-gray-200 bg-gray-50 sticky bottom-0">
          <button
            onClick={onClose}
            className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded"
          >
            إلغاء
          </button>
          <button
            disabled={busy}
            onClick={submit}
            className="text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded flex items-center gap-1"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {busy ? 'جاري الإنشاء...' : 'إنشاء الطلب'}
          </button>
        </footer>
      </div>
    </div>
  );
}
