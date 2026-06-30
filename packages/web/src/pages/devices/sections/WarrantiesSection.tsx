// DEC-CT-04/05: list of warranties on the device.
// Each row shows type (contract/golden), status enum, activation snapshot,
// end date, and (if cancelled) the reason.
//
// DEC-CT-17: for an ACTIVE device with no active golden warranty, offer a button
// that spawns a `golden_warranty_offer` field task (the entry point for adding a
// golden warranty). The task then surfaces in /tasks/group/warranty-services.

import { useState } from 'react';
import { Award, CreditCard } from 'lucide-react';
import { WarrantyStatusBadge } from '../../../components/devices/WarrantyStatusBadge';
import SmartTable, { type ColumnDef } from '../../../components/SmartTable';
import GoldenWarrantyOfferCreateModal from '../../../taskTypes/golden_warranty_offer/GoldenWarrantyOfferCreateModal';
import GoldenWarrantyCardCreateModal from '../../../taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardCreateModal';

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
  const [open, setOpen] = useState(false);
  if (!device.customerId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
      >
        <Award className="h-3.5 w-3.5" />
        عرض كفالة ذهبية
      </button>
      {open && (
        <GoldenWarrantyOfferCreateModal
          customerId={device.customerId}
          branchId={device.branchId ?? null}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); onCreated?.(); }}
        />
      )}
    </>
  );
}

function CardDeliveryButton({ device, onCreated }: { device: DeviceCtx; onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!device.customerId) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100"
      >
        <CreditCard className="h-3.5 w-3.5" />
        تسليم كرت كفالة
      </button>
      {open && (
        <GoldenWarrantyCardCreateModal
          customerId={device.customerId}
          branchId={device.branchId ?? null}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); onCreated?.(); }}
        />
      )}
    </>
  );
}

export function WarrantiesSection({ warranties, device, onCreated }: Props) {
  const hasActiveGolden = (warranties ?? []).some(w => w.warrantyType === 'golden' && w.status === 'active');
  // Entry point shown only for an active device that has no active golden warranty
  // (DEC-CT-16: one active golden at a time; offer is guarded by the prior ending).
  const canOfferGolden = device?.status === 'active' && !hasActiveGolden;

  const action = device ? (
    <div className="flex items-center gap-2">
      {canOfferGolden && <OfferGoldenButton device={device} onCreated={onCreated} />}
      {hasActiveGolden && <CardDeliveryButton device={device} onCreated={onCreated} />}
    </div>
  ) : undefined;

  // Columns mirror the original raw table 1:1 (design-only migration to <SmartTable>).
  const columns: ColumnDef<any>[] = [
    { key: 'warrantyType', label: 'النوع', render: w => <span className="text-sm font-bold text-slate-700">{TYPE_LABEL[w.warrantyType] ?? w.warrantyType}</span> },
    {
      key: 'status', label: 'الحالة',
      render: w => <WarrantyStatusBadge status={w.status} cancellationReason={w.cancellationReason} endDate={w.endDate} />,
    },
    { key: 'activatedAt', label: 'تاريخ التفعيل', render: w => <span className="text-sm text-slate-700">{fmt(w.activatedAt)}</span> },
    { key: 'endDate', label: 'تاريخ الانتهاء', render: w => <span className="text-sm text-slate-700">{fmt(w.endDate)}</span> },
    { key: 'months', label: 'المدة', render: w => <span className="text-sm text-slate-700">{w.months != null ? `${w.months} شهر` : '—'}</span> },
    { key: 'visits', label: 'الزيارات', render: w => <span className="text-sm text-slate-700">{w.visits ?? '—'}</span> },
  ];

  return (
    <section id="warranties" className="scroll-mt-24">
      <SmartTable<any>
        title="الكفالات"
        subtitle="حالة كل كفالة وتاريخ سريانها ومدتها"
        icon={Award}
        data={warranties ?? []}
        columns={columns}
        getId={w => w.id}
        hideFilterBar
        tableMinWidth={680}
        headerActions={action}
        emptyIcon={Award}
        emptyMessage="لا توجد سجلات كفالة لهذا الجهاز."
      />
    </section>
  );
}

export default WarrantiesSection;
