import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Plus, Save } from 'lucide-react';

import SmartTable, { type ColumnDef } from '../../../components/SmartTable';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';
import { usePermissions } from '../../../hooks/usePermissions';
import ServiceAgreementForm, {
  emptyServiceAgreementDraft,
  serviceAgreementPayloadFromDraft,
  type ServiceAgreementDraft,
} from '../../../components/devices/ServiceAgreementForm';

type Props = {
  device: any;
  onChanged?: () => void;
};

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: 'مسودة', cls: 'bg-slate-100 text-slate-600' },
  active: { label: 'فعال', cls: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'ملغى', cls: 'bg-rose-100 text-rose-700' },
  completed: { label: 'مكتمل', cls: 'bg-sky-100 text-sky-700' },
  discarded: { label: 'مهمل', cls: 'bg-slate-100 text-slate-500' },
};

export function ServiceAgreementsSection({ device, onChanged }: Props) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('contracts.edit');
  const isExternal = device?.deviceSource === 'external';
  const [agreements, setAgreements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<ServiceAgreementDraft>(() => emptyServiceAgreementDraft());

  const fetchAgreements = useCallback(async () => {
    if (!isExternal || !device?.id) return;
    setLoading(true);
    try {
      const rows = await api.serviceAgreements.list({ installedDeviceId: Number(device.id) });
      setAgreements(Array.isArray(rows) ? rows : []);
    } catch {
      setAgreements([]);
    } finally {
      setLoading(false);
    }
  }, [device?.id, isExternal]);

  useEffect(() => { fetchAgreements(); }, [fetchAgreements]);

  const activeAgreement = useMemo(
    () => agreements.find((agreement) => agreement.status === 'active') ?? null,
    [agreements],
  );

  function openCreate() {
    setDraft(emptyServiceAgreementDraft());
    setError('');
    setOpen(true);
  }

  async function saveAgreement() {
    if (!device?.customerId || !device?.branchId) {
      setError('لا يمكن إنشاء اتفاق خدمة قبل اكتمال الزبون والفرع على الجهاز.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.serviceAgreements.create({
        ...serviceAgreementPayloadFromDraft(draft),
        customerId: Number(device.customerId),
        customerName: device.customerName || `#${device.customerId}`,
        branchId: Number(device.branchId),
        installedDeviceId: Number(device.id),
        externalDeviceModelName: device.deviceModelName ?? null,
        externalDeviceSerial: device.externalDeviceSerial ?? device.serialNumber ?? null,
        externalDeviceNotes: device.externalDeviceNotes ?? null,
      });
      setOpen(false);
      await fetchAgreements();
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || 'تعذر إنشاء اتفاق الخدمة.');
    } finally {
      setSaving(false);
    }
  }

  if (!isExternal) return null;

  const columns: ColumnDef<any>[] = [
    {
      key: 'agreementNumber',
      label: 'رقم الاتفاق',
      render: (agreement) => <span className="font-mono text-sm text-slate-700">{agreement.agreementNumber || `#${agreement.id}`}</span>,
    },
    {
      key: 'status',
      label: 'الحالة',
      render: (agreement) => {
        const status = STATUS_LABEL[agreement.status] ?? { label: agreement.status, cls: 'bg-slate-100 text-slate-600' };
        return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${status.cls}`}>{status.label}</span>;
      },
    },
    { key: 'maintenancePlan', label: 'الخطة', render: (agreement) => <span className="text-sm text-slate-700">{agreement.maintenancePlan || '—'}</span> },
    { key: 'visitsCount', label: 'الزيارات', render: (agreement) => <span className="text-sm text-slate-700">{agreement.visitsCount ?? '—'}</span> },
    { key: 'startDate', label: 'البداية', render: (agreement) => <span className="text-sm text-slate-700">{fmt(agreement.startDate)}</span> },
    { key: 'endDate', label: 'النهاية', render: (agreement) => <span className="text-sm text-slate-700">{fmt(agreement.endDate)}</span> },
  ];

  return (
    <section id="service-agreements" className="scroll-mt-24">
      {loading ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center text-slate-500">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-sky-500" />
          <div className="text-sm font-bold">جاري تحميل اتفاقات الخدمة...</div>
        </div>
      ) : (
        <SmartTable<any>
          title="اتفاق الخدمة"
          subtitle={activeAgreement ? 'هذا الاتفاق هو أساس الصيانة الدورية للجهاز الخارجي' : 'الجهاز الخارجي يحتاج اتفاق خدمة فعالاً للصيانة الدورية'}
          icon={FileText}
          data={agreements}
          columns={columns}
          getId={(agreement) => agreement.id}
          hideFilterBar
          tableMinWidth={760}
          headerActions={
            canEdit && !activeAgreement ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
              >
                <Plus className="h-3.5 w-3.5" />
                إنشاء اتفاق خدمة
              </button>
            ) : undefined
          }
          emptyIcon={FileText}
          emptyMessage="لا يوجد اتفاق خدمة مرتبط بهذا الجهاز."
        />
      )}

      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title="إنشاء اتفاق خدمة"
          subtitle={device?.deviceModelName || `جهاز #${device?.id}`}
          size="2xl"
          footer={
            <div className="flex w-full gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={saveAgreement}
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ
              </button>
            </div>
          }
        >
          <div className="space-y-4 px-5 py-5">
            {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
            <ServiceAgreementForm value={draft} onChange={setDraft} disabled={saving} />
          </div>
        </Modal>
      )}
    </section>
  );
}

export default ServiceAgreementsSection;
