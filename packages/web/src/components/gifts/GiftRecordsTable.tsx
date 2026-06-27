import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardList, Gift, UserRound } from 'lucide-react';
import type { GiftRecordPrototype } from '../../data/giftsPrototype';
import {
  giftBeneficiaryTypeLabels,
  giftConditionClasses,
  giftConditionStatusLabels,
  giftStatusClasses,
  giftStatusLabels,
} from '../../data/giftsPrototype';
import GiftRecordActions from './GiftRecordActions';

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
      <Gift className="h-9 w-9 text-slate-300" />
      <p className="text-sm font-bold text-slate-700">لا توجد هدايا مسجلة حالياً</p>
      <p className="max-w-md text-xs leading-6 text-slate-500">
        لا توجد سجلات هدايا مطابقة. يُنشأ الوعد يدوياً من تفاصيل العقد أو الصفحة المركزية.
      </p>
    </div>
  );
}

export default function GiftRecordsTable({
  records,
  compact = false,
  onChanged,
}: {
  records: GiftRecordPrototype[];
  compact?: boolean;
  onChanged?: () => void;
}) {
  if (records.length === 0) return <EmptyState />;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="px-4 py-3">السجل</th>
              <th className="px-4 py-3">المستفيد</th>
              <th className="px-4 py-3">الهدية</th>
              <th className="px-4 py-3">الشرط</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">المصدر</th>
              {!compact && <th className="px-4 py-3">المسؤولية</th>}
              <th className="px-4 py-3">إجراءات لاحقة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record) => (
              <tr key={record.id} className="align-top hover:bg-slate-50/70">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-bold text-sky-700">{record.id}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                    <CalendarCheck className="h-3.5 w-3.5" />
                    <span>{record.createdAt}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div>
                      <div className="font-bold text-slate-800">{record.beneficiaryName}</div>
                      <div className="mt-1 text-xs text-slate-500">{giftBeneficiaryTypeLabels[record.beneficiaryType]}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-800">{record.giftName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {record.approvedQuantity} {record.unitLabel}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-700">{record.conditionLabel}</div>
                  <div className="mt-2">
                    <Pill className={giftConditionClasses[record.conditionStatus]}>
                      {giftConditionStatusLabels[record.conditionStatus]}
                    </Pill>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Pill className={giftStatusClasses[record.status]}>{giftStatusLabels[record.status]}</Pill>
                  {record.deliveryTaskId && (
                    <div className="mt-2 text-xs text-indigo-600">
                      مهمة: {record.deliveryTaskId}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    {record.sources.map((source) => (
                      <div key={source.id} className="text-xs text-slate-600">
                        <span className="font-bold">{source.label}</span>
                        {source.contractNumber && <span className="text-slate-400"> - {source.contractNumber}</span>}
                      </div>
                    ))}
                  </div>
                </td>
                {!compact && (
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500">فرع المصدر: {record.sourceBranchName}</div>
                    <div className="mt-1 text-xs text-slate-500">فرع المسؤولية: {record.responsibleBranchName}</div>
                    <div className="mt-1 font-medium text-slate-700">
                      {record.beneficiaryOwnershipLabel ?? 'حسب ملكية المستفيد'}
                    </div>
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    {record.contractId && (
                      <Link
                        to={`/contracts/${record.contractId}`}
                        className="inline-flex w-fit items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <ClipboardList className="h-3.5 w-3.5" />
                        العقد
                      </Link>
                    )}
                    {onChanged && <GiftRecordActions record={record} onChanged={onChanged} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
