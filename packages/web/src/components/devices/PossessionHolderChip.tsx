// DEC-CT-09: surface the current device holder as a compact chip.
//
// holderType drives the icon + color; reason is shown as a soft secondary line.
// holderName is resolved by the caller (we don't fetch employees/customers here).

import { Warehouse, Wrench, User, Hammer, Building2, HelpCircle } from 'lucide-react';
import type { PossessionHolderType, PossessionReason } from '@golden-crm/shared';

const HOLDER_CONFIG: Record<PossessionHolderType, { Icon: any; cls: string; label: string }> = {
  warehouse:  { Icon: Warehouse, cls: 'bg-slate-100 text-slate-700',     label: 'المستودع' },
  technician: { Icon: Wrench,    cls: 'bg-amber-100 text-amber-700',     label: 'فني' },
  customer:   { Icon: User,      cls: 'bg-emerald-100 text-emerald-700', label: 'الزبون' },
  workshop:   { Icon: Hammer,    cls: 'bg-orange-100 text-orange-700',   label: 'الورشة' },
  supplier:   { Icon: Building2, cls: 'bg-indigo-100 text-indigo-700',   label: 'مورّد' },
};

const REASON_LABEL: Record<PossessionReason, string> = {
  sale_delivery:   'تسليم بيع',
  repair_pickup:   'سحب للصيانة',
  temporary_swap:  'تبديل مؤقت',
  retrieval:       'استرجاع',
  cancellation:    'إلغاء',
  transfer:        'نقل',
};

interface Props {
  holderType?: PossessionHolderType | string | null;
  holderName?: string | null;
  reason?: PossessionReason | string | null;
  className?: string;
  showReason?: boolean;
}

export function PossessionHolderChip({
  holderType,
  holderName,
  reason,
  className = '',
  showReason = false,
}: Props) {
  if (!holderType) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-400 ${className}`}>
        <HelpCircle className="w-3 h-3" /> غير محدد
      </span>
    );
  }
  const cfg = HOLDER_CONFIG[holderType as PossessionHolderType] ?? {
    Icon: HelpCircle, cls: 'bg-slate-100 text-slate-600', label: holderType as string,
  };
  const reasonLabel = reason ? (REASON_LABEL[reason as PossessionReason] ?? reason) : null;

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold ${cfg.cls}`}>
        <cfg.Icon className="w-3 h-3" />
        <span>{cfg.label}{holderName ? ` — ${holderName}` : ''}</span>
      </span>
      {showReason && reasonLabel && (
        <span className="text-xs text-slate-400 font-medium px-1">({reasonLabel})</span>
      )}
    </span>
  );
}

export default PossessionHolderChip;
