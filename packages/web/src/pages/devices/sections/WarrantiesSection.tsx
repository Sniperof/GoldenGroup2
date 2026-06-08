// DEC-CT-04/05: list of warranties on the device.
// Each row shows type (contract/golden), status enum, activation snapshot,
// end date, and (if cancelled) the reason.

import { WarrantyStatusBadge } from '../../../components/devices/WarrantyStatusBadge';
import { SectionShell } from './SectionShell';

interface Props {
  warranties: any[];
}

function fmt(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-SY'); } catch { return d; }
}

const TYPE_LABEL: Record<string, string> = {
  contract: 'كفالة العقد',
  golden:   'الكفالة الذهبية',
};

export function WarrantiesSection({ warranties }: Props) {
  if (!warranties?.length) {
    return (
      <SectionShell id="warranties" title="الكفالات">
        <p className="text-xs text-slate-400 italic">لا توجد سجلات كفالة لهذا الجهاز.</p>
      </SectionShell>
    );
  }
  return (
    <SectionShell id="warranties" title="الكفالات" subtitle="حالة كل كفالة وتاريخ سريانها ومدتها">
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
