// DEC-CT-05: warranty status enum (pending / active / cancelled / expired)
// + cancellation_reason. The badge surfaces the reason on hover.

import type { WarrantyStatus, WarrantyCancellationReason } from '@golden-crm/shared';

const STATUS_MAP: Record<WarrantyStatus, { cls: string; label: string }> = {
  pending:   { cls: 'bg-slate-100 text-slate-600',     label: 'قبل التفعيل' },
  active:    { cls: 'bg-emerald-100 text-emerald-700', label: 'سارية' },
  cancelled: { cls: 'bg-rose-100 text-rose-700',       label: 'ملغاة' },
  expired:   { cls: 'bg-gray-100 text-gray-500',       label: 'منتهية' },
};

const REASON_LABEL: Record<WarrantyCancellationReason, string> = {
  contract_cancelled: 'سبب الإلغاء: تم إلغاء العقد قبل استيفاء الذمم.',
  device_retrieved:   'سبب الإلغاء: تم استرجاع الجهاز.',
  manual:             'سبب الإلغاء: إلغاء يدوي.',
};

interface Props {
  status?: WarrantyStatus | string | null;
  cancellationReason?: WarrantyCancellationReason | string | null;
  endDate?: string | null;
  className?: string;
}

export function WarrantyStatusBadge({ status, cancellationReason, endDate, className = '' }: Props) {
  if (!status) {
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 ${className}`}>
        لا كفالة
      </span>
    );
  }
  const m = STATUS_MAP[status as WarrantyStatus] ?? { cls: 'bg-slate-100 text-slate-600', label: status as string };
  const reasonLabel = cancellationReason && REASON_LABEL[cancellationReason as WarrantyCancellationReason];

  // Compose tooltip — status + optional reason + optional end date.
  const tooltipParts: string[] = [];
  if (status === 'cancelled' && reasonLabel) tooltipParts.push(reasonLabel);
  if (endDate)                                tooltipParts.push(`تاريخ الانتهاء: ${endDate}`);
  const title = tooltipParts.join('\n') || undefined;

  return (
    <span
      title={title}
      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${m.cls} ${className}`}
    >
      {m.label}
    </span>
  );
}

export default WarrantyStatusBadge;
