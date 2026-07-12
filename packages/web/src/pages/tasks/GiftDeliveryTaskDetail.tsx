import { useParams } from 'react-router-dom';
import { Gift } from '../../components/ui/icons';
import TaskDetailLayout from '../../components/tasks/TaskDetailLayout';
import { InfoLine } from '../../components/tasks/shared';
import type { TaskDetailData, TaskTypeExtension } from '../../components/tasks/types';
import GiftDeliveryResultModal from '../../taskTypes/gift_delivery/GiftDeliveryResultModal';

type DisplayValue = string | number;

function toDisplayValue(value: unknown): DisplayValue | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

function firstPresent(...values: unknown[]): DisplayValue | null {
  for (const value of values) {
    const displayValue = toDisplayValue(value);
    if (displayValue !== null) return displayValue;
  }
  return null;
}

function formatApprovedQuantity(task: any) {
  const quantity = firstPresent(task.approvedQuantity, task.approved_quantity);
  if (quantity === null) return '—';
  const unitLabel = firstPresent(task.unitLabel, task.unit_label);
  return unitLabel ? `${quantity} ${unitLabel}` : quantity;
}

function formatGiftRecordId(task: any) {
  return firstPresent(
    task.giftRecordId,
    task.gift_record_id,
    task.sourceContextType === 'gift_records' ? task.sourceContextId : undefined,
    task.source_context_type === 'gift_records' ? task.source_context_id : undefined,
  ) ?? '—';
}

function giftOverviewCard(data: TaskDetailData) {
  const { task } = data;
  const giftName = firstPresent(task.giftName, task.gift_name) ?? '—';
  const beneficiaryName = firstPresent(
    task.giftBeneficiaryName,
    task.gift_beneficiary_name,
    task.clientName,
    task.client_name,
  ) ?? '—';
  return (
    <div className="rounded-lg border border-rose-100 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-black text-rose-900">تفاصيل الهدية</h3>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <InfoLine label="الهدية" value={giftName} />
        <InfoLine label="المستفيد" value={beneficiaryName} />
        <InfoLine label="الكمية المعتمدة" value={formatApprovedQuantity(task)} />
        <InfoLine label="سجل الهدية" value={formatGiftRecordId(task)} />
      </div>
    </div>
  );
}

const giftExtension: TaskTypeExtension = {
  ResultModal: GiftDeliveryResultModal,
  canRecordResultFor: (task) => (task?.taskType ?? task?.task_type) === 'gift_delivery',
  overviewExtraCards: giftOverviewCard,
};

function hasResultFor(data: TaskDetailData): boolean {
  const status = data.task.status;
  return status === 'completed' || status === 'closed' || status === 'cancelled';
}

export default function GiftDeliveryTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);

  return (
    <TaskDetailLayout
      taskId={taskId}
      typeIcon={Gift}
      typeIconColor="text-rose-500"
      backLabel="مهام تسليم الهدايا"
      backHref="/tasks/group/gift-delivery"
      extension={giftExtension}
      hasResultFor={hasResultFor}
    />
  );
}
