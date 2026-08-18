import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Send, Users, BellRing, AlertTriangle } from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PageHeader from '../../components/ui/PageHeader';
import Select from '../../components/ui/Select';
import SmartTable from '../../components/SmartTable';
import type { ColumnDef } from '../../components/SmartTable';
import { GeoCascadeFields, useGeoCascade } from '../../components/filters/GeoCascadeFilter';
import { api } from '../../lib/api';
import type {
  BroadcastAudienceInput, BroadcastAudiencePreview, BroadcastDestination, BroadcastRecord,
} from '../../lib/api';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useBranchListScope } from '../../hooks/useBranchListScope';

const DESTINATION_LABELS: Record<'none' | BroadcastDestination, string> = {
  none: 'بدون وجهة (يفتح قائمة الإشعارات)',
  service_request: 'طلب خدمة',
  device: 'جهاز',
  warranty: 'الكفالة',
  complaint: 'شكوى',
  visit: 'زيارة',
};

const DESTINATION_OPTIONS = (Object.keys(DESTINATION_LABELS) as ('none' | BroadcastDestination)[])
  .map((value) => ({ value, label: DESTINATION_LABELS[value] }));

/**
 * The mobile app resolves `warranty` without an id (§E.1 of the contract), so it
 * is the only destination that may be sent bare. Everything else needs the id of
 * the thing it opens, and the API rejects the half-configured case.
 */
const DESTINATIONS_NEEDING_ID: BroadcastDestination[] = [
  'service_request', 'device', 'complaint', 'visit',
];

const MAX_TITLE = 150;
const MAX_MESSAGE = 2000;

export default function AppNotifications() {
  const { user, hasPermission } = useAuthStore();
  const canView = user?.isSuperAdmin === true || hasPermission('admin.app_notifications.view');
  const canSend = user?.isSuperAdmin === true || hasPermission('admin.app_notifications.send');
  const branchScope = useBranchListScope();

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [locale, setLocale] = useState<'ar' | 'en'>('ar');
  const [destination, setDestination] = useState<'none' | BroadcastDestination>('none');
  const [destinationId, setDestinationId] = useState('');
  const [clientId, setClientId] = useState('');

  const geo = useGeoCascade({ branchId: branchScope.effectiveBranchId ?? null });

  const [preview, setPreview] = useState<BroadcastAudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<BroadcastRecord[]>([]);

  const audience: BroadcastAudienceInput = useMemo(() => ({
    branchId: branchScope.effectiveBranchId ?? null,
    geoIds: geo.geoIdsCsv ? geo.geoIdsCsv.split(',') : [],
    clientId: clientId.trim() === '' ? null : Number(clientId),
  }), [branchScope.effectiveBranchId, geo.geoIdsCsv, clientId]);

  /**
   * Any change to the audience discards the preview. A stale count is the one
   * thing worse than no count: the operator would confirm a number that no
   * longer describes who receives this.
   */
  useEffect(() => { setPreview(null); }, [audience]);

  const loadHistory = () => {
    api.admin.appNotifications.history()
      .then((res) => setHistory(res.items))
      .catch(() => setHistory([]));
  };
  useEffect(() => { if (canView) loadHistory(); }, [canView]);

  if (!canView && !canSend) return <Navigate to="/" replace />;

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  const needsId = destination !== 'none'
    && DESTINATIONS_NEEDING_ID.includes(destination as BroadcastDestination);
  const textReady = trimmedTitle.length > 0 && trimmedMessage.length > 0
    && trimmedTitle.length <= MAX_TITLE && trimmedMessage.length <= MAX_MESSAGE;
  const destinationReady = !needsId || destinationId.trim().length > 0;
  const composeReady = textReady && destinationReady;

  const runPreview = async () => {
    setError(null);
    setPreviewing(true);
    try {
      setPreview(await api.admin.appNotifications.audiencePreview(audience));
    } catch (err: any) {
      setError(err?.message ?? 'تعذّر حساب عدد المستقبلين');
    } finally {
      setPreviewing(false);
    }
  };

  const doSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await api.admin.appNotifications.send({
        title: trimmedTitle,
        message: trimmedMessage,
        locale,
        destination: destination === 'none' ? null : destination,
        destinationId: needsId ? destinationId.trim() : null,
        audience,
        previewedCount: preview?.accounts ?? null,
      });
      setResult(`تم الإرسال إلى ${res.notificationCount} صندوق، ووصل الدفع إلى ${res.pushed} جهاز.`);
      setTitle('');
      setMessage('');
      setDestination('none');
      setDestinationId('');
      setPreview(null);
      loadHistory();
    } catch (err: any) {
      setError(err?.message ?? 'تعذّر الإرسال');
    } finally {
      setSending(false);
      setConfirmOpen(false);
    }
  };

  const columns: ColumnDef<BroadcastRecord>[] = [
    { key: 'createdAt', label: 'التاريخ', render: (r) => new Date(r.createdAt).toLocaleString('ar') },
    { key: 'title', label: 'العنوان', render: (r) => r.title },
    { key: 'message', label: 'النص', render: (r) => r.message },
    {
      key: 'audience',
      label: 'الجمهور',
      render: (r) => {
        const parts: string[] = [];
        if (r.branchName) parts.push(`فرع ${r.branchName}`);
        if (r.audience?.geoIds?.length) parts.push('منطقة محددة');
        if (r.audience?.clientId) parts.push(`عميل ${r.audience.clientId}`);
        return parts.length > 0 ? parts.join(' — ') : 'كل العملاء';
      },
    },
    {
      key: 'notificationCount',
      label: 'المستقبلون',
      // Both numbers, deliberately: the gap between what was previewed and what
      // was written is the audit question worth answering at a glance.
      render: (r) => (r.previewedCount != null && r.previewedCount !== r.notificationCount
        ? `${r.notificationCount} (المعاينة ${r.previewedCount})`
        : String(r.notificationCount)),
    },
    { key: 'sentBy', label: 'أرسله', render: (r) => r.sentBy ?? '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="إشعارات التطبيق" subtitle="إرسال إشعار حر لعملاء التطبيق وسجل الإرسالات" />

      {canSend && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <BellRing className="w-5 h-5 text-sky-600" /> إشعار جديد
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-600 mb-1">العنوان</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={title}
                maxLength={MAX_TITLE}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="انقطاع خدمة"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">اللغة</label>
              <Select
                value={locale}
                onChange={(value) => setLocale(value)}
                options={[
                  { value: 'ar', label: 'العربية' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1">
              النص <span className="text-slate-400">({trimmedMessage.length}/{MAX_MESSAGE})</span>
            </label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 min-h-24"
              value={message}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="نعتذر عن انقطاع الخدمة في منطقتكم اليوم"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm text-slate-600 mb-1">الوجهة عند النقر</label>
              <Select
                value={destination}
                onChange={(value) => {
                  setDestination(value);
                  setDestinationId('');
                }}
                options={DESTINATION_OPTIONS}
              />
            </div>
            {needsId && (
              <div>
                <label className="block text-sm text-slate-600 mb-1">معرّف الوجهة</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value.replace(/\D/g, ''))}
                  placeholder="رقم الطلب / الجهاز / الشكوى"
                />
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Users className="w-4 h-4" /> الجمهور
            </h4>
            {!branchScope.isSuperAdmin && (
              <p className="text-xs text-slate-500">
                الإرسال محصور بفرعك — لا يمكن مخاطبة عملاء فرع آخر.
              </p>
            )}
            <GeoCascadeFields cascade={geo} />
            <div className="md:w-1/2">
              <label className="block text-sm text-slate-600 mb-1">عميل محدد (اختياري)</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2"
                value={clientId}
                onChange={(e) => setClientId(e.target.value.replace(/\D/g, ''))}
                placeholder="رقم العميل"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {result && (
            <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {result}
            </div>
          )}

          {preview && (
            <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div>سيصل الإشعار إلى <strong>{preview.accounts}</strong> صندوق يخص <strong>{preview.clients}</strong> عميلاً.</div>
              <div className="text-slate-500">
                منهم <strong>{preview.reachableByPush}</strong> لديهم جهاز مسجّل يستقبل تنبيهاً فورياً؛
                والباقي سيرى الإشعار عند فتح التطبيق.
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="secondary" onClick={runPreview} disabled={previewing}>
              {previewing ? 'جارٍ الحساب…' : 'معاينة عدد المستقبلين'}
            </Button>
            {/* Sending is gated on a fresh preview, not merely offered next to it. */}
            <Button onClick={() => setConfirmOpen(true)} disabled={!composeReady || !preview || sending}>
              <Send className="w-4 h-4 ml-1" /> إرسال
            </Button>
          </div>
          {!preview && composeReady && (
            <p className="text-xs text-slate-500">المعاينة مطلوبة قبل الإرسال.</p>
          )}
        </div>
      )}

      <SmartTable
        title="سجل الإرسالات"
        icon={BellRing}
        data={history}
        columns={columns}
        getId={(r) => r.id}
        emptyIcon={BellRing}
        emptyMessage="لا توجد إرسالات بعد"
        defaultSortKey="createdAt"
        defaultSortDir="desc"
      />

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="تأكيد الإرسال"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            سيُرسل هذا الإشعار إلى <strong>{preview?.accounts ?? 0}</strong> صندوق،
            ولا يمكن التراجع عنه بعد الإرسال.
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
            <div className="font-semibold text-slate-800">{trimmedTitle}</div>
            <div className="text-slate-600 whitespace-pre-wrap">{trimmedMessage}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>
              إلغاء
            </Button>
            <Button onClick={doSend} disabled={sending}>
              {sending ? 'جارٍ الإرسال…' : 'تأكيد الإرسال'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
