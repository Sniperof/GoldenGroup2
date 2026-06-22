// DEC-CT-04/05: list of warranties on the device.
// Each row shows type (contract/golden), status enum, activation snapshot,
// end date, and (if cancelled) the reason.
//
// DEC-CT-17: for an ACTIVE device with no active golden warranty, offer a button
// that spawns a `golden_warranty_offer` field task (the entry point for adding a
// golden warranty). The task then surfaces in /tasks/group/warranty-services.

import { useState } from 'react';
import { Award, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { WarrantyStatusBadge } from '../../../components/devices/WarrantyStatusBadge';
import { SectionShell } from './SectionShell';

interface DeviceCtx {
  id: number;
  customerId?: number | null;
  contractId?: number | null;
  branchId?: number | null;
  status?: string | null;
}

interface Props {
  warranties: any[];
  device?: DeviceCtx | null;
  onCreated?: () => void;
}

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

const TYPE_LABEL: Record<string, string> = {
  contract: 'كفالة العقد',
  golden:   'الكفالة الذهبية',
};

function OfferGoldenButton({ device, onCreated }: { device: DeviceCtx; onCreated?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function createOffer() {
    if (!device.customerId) { setErr('لا يمكن إنشاء المهمة: الزبون غير معروف'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.openTasks.create({
        taskType: 'golden_warranty_offer',
        taskFamily: 'warranty',
        clientId: device.customerId,
        installedDeviceId: device.id,
        contractId: device.contractId ?? null,
        ...(device.branchId ? { branchId: device.branchId } : {}),
        creationOrigin: 'manual_creation',
        reason: 'عرض كفالة ذهبية',
      });
      setMsg('تم إنشاء مهمة عرض كفالة ذهبية — تظهر الآن في قسم خدمات الكفالة.');
      onCreated?.();
    } catch (e: any) {
      setErr(e?.message ?? 'فشل إنشاء مهمة العرض');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={createOffer}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Award className="h-3.5 w-3.5" />}
        عرض كفالة ذهبية
      </button>
      {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
    </div>
  );
}

export function WarrantiesSection({ warranties, device, onCreated }: Props) {
  const hasActiveGolden = (warranties ?? []).some(w => w.warrantyType === 'golden' && w.status === 'active');
  // Entry point shown only for an active device that has no active golden warranty
  // (DEC-CT-16: one active golden at a time; offer is guarded by the prior ending).
  const canOfferGolden = device?.status === 'active' && !hasActiveGolden;

  const action = device && canOfferGolden ? <OfferGoldenButton device={device} onCreated={onCreated} /> : undefined;

  if (!warranties?.length) {
    return (
      <SectionShell id="warranties" title="الكفالات" actions={action}>
        <p className="text-xs text-slate-400 italic">لا توجد سجلات كفالة لهذا الجهاز.</p>
      </SectionShell>
    );
  }
  return (
    <SectionShell id="warranties" title="الكفالات" subtitle="حالة كل كفالة وتاريخ سريانها ومدتها" actions={action}>
      <table className="w-full text-xs">
        <thead className="text-slate-400 font-bold">
          <tr className="border-b border-slate-100">
            <th className="text-right py-2 px-2">النوع</th>
            <th className="text-right py-2 px-2">الحالة</th>
            <th className="text-right py-2 px-2">تاريخ التفعيل</th>
            <th className="text-right py-2 px-2">تاريخ الانتهاء</th>
            <th className="text-right py-2 px-2">المدة</th>
            <th className="text-right py-2 px-2">الزيارات</th>
          </tr>
        </thead>
        <tbody>
          {warranties.map(w => (
            <tr key={w.id} className="border-b border-slate-50 last:border-0 align-top">
              <td className="py-3 px-2 font-bold text-slate-700">{TYPE_LABEL[w.warrantyType] ?? w.warrantyType}</td>
              <td className="py-3 px-2">
                <WarrantyStatusBadge
                  status={w.status}
                  cancellationReason={w.cancellationReason}
                  endDate={w.endDate}
                />
              </td>
              <td className="py-3 px-2 text-slate-700">{fmt(w.activatedAt)}</td>
              <td className="py-3 px-2 text-slate-700">{fmt(w.endDate)}</td>
              <td className="py-3 px-2 text-slate-700">{w.months != null ? `${w.months} شهر` : '—'}</td>
              <td className="py-3 px-2 text-slate-700">{w.visits ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionShell>
  );
}

export default WarrantiesSection;
