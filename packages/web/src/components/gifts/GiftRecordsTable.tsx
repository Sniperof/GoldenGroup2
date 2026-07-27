import { Link } from 'react-router-dom';
import { CalendarCheck, ClipboardList, Gift, UserRound } from '../ui/icons';
import DataTable from '../ui/DataTable';
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
    <DataTable card minWidth={980}>
          <DataTable.Head>
            <DataTable.Row>
              <DataTable.Th>السجل</DataTable.Th>
              <DataTable.Th>المستفيد</DataTable.Th>
              <DataTable.Th>الهدية</DataTable.Th>
              <DataTable.Th>الشرط</DataTable.Th>
              <DataTable.Th>الحالة</DataTable.Th>
              <DataTable.Th>المصدر</DataTable.Th>
              {!compact && <DataTable.Th>المسؤولية</DataTable.Th>}
              <DataTable.Th>إجراءات لاحقة</DataTable.Th>
            </DataTable.Row>
          </DataTable.Head>
          <DataTable.Body>
            {records.map((record) => (
              <DataTable.Row key={record.id} className="align-top hover:bg-slate-50/70">
                <DataTable.Td>
                  <div className="font-mono text-xs font-bold text-sky-700">{record.id}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                    <CalendarCheck className="h-3.5 w-3.5" />
                    <span>{record.createdAt}</span>
                  </div>
                </DataTable.Td>
                <DataTable.Td>
                  <div className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div>
                      <div className="font-bold text-slate-800">{record.beneficiaryName}</div>
                      <div className="mt-1 text-xs text-slate-500">{giftBeneficiaryTypeLabels[record.beneficiaryType]}</div>
                    </div>
                  </div>
                </DataTable.Td>
                <DataTable.Td>
                  <div className="font-bold text-slate-800">{record.giftName}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    الوعد: {record.promisedQuantity} {record.unitLabel}
                    {record.approvedQuantity != null && (
                      <span> · المعتمد: {record.approvedQuantity} {record.unitLabel}</span>
                    )}
                  </div>
                </DataTable.Td>
                <DataTable.Td>
                  <div className="font-medium text-slate-700">{record.conditionLabel}</div>
                  <div className="mt-2">
                    <Pill className={giftConditionClasses[record.conditionStatus]}>
                      {giftConditionStatusLabels[record.conditionStatus]}
                    </Pill>
                  </div>
                </DataTable.Td>
                <DataTable.Td>
                  <Pill className={giftStatusClasses[record.status]}>{giftStatusLabels[record.status]}</Pill>
                  {record.deliveryTaskId && (
                    <div className="mt-2 text-xs text-indigo-600">
                      مهمة: {record.deliveryTaskId}
                    </div>
                  )}
                </DataTable.Td>
                <DataTable.Td>
                  <div className="space-y-1">
                    {record.sources.map((source) => (
                      <div key={source.id} className="text-xs text-slate-600">
                        <span className="font-bold">{source.label}</span>
                        {source.contractNumber && <span className="text-slate-400"> - {source.contractNumber}</span>}
                      </div>
                    ))}
                  </div>
                </DataTable.Td>
                {!compact && (
                  <DataTable.Td>
                    <div className="text-xs text-slate-500">فرع المصدر: {record.sourceBranchName}</div>
                    <div className="mt-1 text-xs text-slate-500">فرع المسؤولية: {record.responsibleBranchName}</div>
                    <div className="mt-1 font-medium text-slate-700">
                      {record.beneficiaryOwnershipLabel ?? 'حسب ملكية المستفيد'}
                    </div>
                  </DataTable.Td>
                )}
                <DataTable.Td>
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
                    {onChanged && (
                      <GiftRecordActions
                        record={record}
                        candidateRecords={records}
                        onChanged={onChanged}
                      />
                    )}
                  </div>
                </DataTable.Td>
              </DataTable.Row>
            ))}
          </DataTable.Body>
    </DataTable>
  );
}
