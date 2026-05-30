// DEC-CT-03: unified device status dictionary.
//
// Single source of truth for rendering a device's operational status as a pill.
// Used in both the per-customer DevicesTab and the standalone DeviceProfilePage,
// and consumed from the legacy ContractDetail until that view is retired.

import type { DeviceStatus } from '@golden-crm/shared';

const MAP: Record<string, { cls: string; label: string }> = {
  registered:       { cls: 'bg-indigo-100 text-indigo-700',  label: 'مسجّل' },
  pending_delivery: { cls: 'bg-amber-100 text-amber-700',    label: 'بانتظار التوصيل' },
  delivered:        { cls: 'bg-sky-100 text-sky-700',        label: 'تم التوصيل' },
  installed:        { cls: 'bg-emerald-100 text-emerald-700', label: 'مركّب' },
  active:           { cls: 'bg-green-100 text-green-700',    label: 'نشط' },
  faulty:           { cls: 'bg-red-100 text-red-700',        label: 'معطل' },
  in_workshop:      { cls: 'bg-orange-100 text-orange-700',  label: 'في الورشة' },
  ready:            { cls: 'bg-cyan-100 text-cyan-700',      label: 'جاهز' },
  out_of_service:   { cls: 'bg-gray-100 text-gray-500',      label: 'خارج الخدمة' },
  retrieved:        { cls: 'bg-slate-100 text-slate-600',    label: 'مستردة' },
};

interface Props {
  status?: DeviceStatus | string | null;
  className?: string;
}

export function DeviceStatusBadge({ status, className = '' }: Props) {
  if (!status) {
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 ${className}`}>
        غير محدد
      </span>
    );
  }
  const m = MAP[status as string] ?? { cls: 'bg-slate-100 text-slate-600', label: status as string };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${m.cls} ${className}`}>
      {m.label}
    </span>
  );
}

export default DeviceStatusBadge;
