import type { ComponentType, ReactNode } from 'react';
import type { VisitResultTaskType } from '@golden-crm/shared';
import { isVisitResultTaskType } from '@golden-crm/shared';
import type { TaskResultModalProps } from '../tasks/types';
import DeviceDemoResultModal from '../../taskTypes/device_demo/DeviceDemoResultModal';
import DeviceActivationResultModal from '../../taskTypes/device_delivery/DeviceActivationResultModal';
import DeviceCheckupResultModal from '../../taskTypes/device_delivery/DeviceCheckupResultModal';
import DeviceDeliveryResultModal from '../../taskTypes/device_delivery/DeviceDeliveryResultModal';
import DeviceDisconnectionResultModal from '../../taskTypes/device_delivery/DeviceDisconnectionResultModal';
import DeviceInstallationResultModal from '../../taskTypes/device_delivery/DeviceInstallationResultModal';
import DeviceRetrievalResultModal from '../../taskTypes/device_delivery/DeviceRetrievalResultModal';
import DeviceReturnResultModal from '../../taskTypes/device_delivery/DeviceReturnResultModal';
import DeviceTransferResultModal from '../../taskTypes/device_delivery/DeviceTransferResultModal';
import EmergencyResultModal from '../../taskTypes/emergency_maintenance/EmergencyResultModal';
import GiftDeliveryResultModal from '../../taskTypes/gift_delivery/GiftDeliveryResultModal';
import GoldenWarrantyOfferModal from '../../taskTypes/golden_warranty_offer/GoldenWarrantyOfferModal';
import GoldenWarrantyCardDeliveryModal from '../../taskTypes/golden_warranty_card_delivery/GoldenWarrantyCardDeliveryModal';
import InstallmentCollectionResultModal from '../../taskTypes/installment_collection/InstallmentCollectionResultModal';

interface VisitTaskResultModalContext {
  visit: any;
  task: any;
  primaryTeam?: any;
  backupTeam?: any;
  onClose: () => void;
  onSaved: () => void;
}

type VisitTaskResultRenderer = (context: VisitTaskResultModalContext) => ReactNode;

function standardModal(Component: ComponentType<TaskResultModalProps>): VisitTaskResultRenderer {
  return ({ visit, task, onClose, onSaved }) => (
    <Component
      key={`${visit.id}:${task.id}`}
      visitId={visit.id}
      taskId={task.id}
      task={task}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

export const VISIT_TASK_RESULT_MODAL_REGISTRY = {
  device_demo: ({ visit, task, onClose, onSaved }) => (
    <DeviceDemoResultModal
      key={`${visit.id}:${task.id}`}
      visitId={visit.id}
      taskId={task.id}
      visit={visit}
      task={task}
      preOffers={task.preOffers ?? task.pre_offers ?? []}
      onClose={onClose}
      onSaved={onSaved}
    />
  ),
  device_checkup: standardModal(DeviceCheckupResultModal),
  device_delivery: standardModal(DeviceDeliveryResultModal),
  device_installation: standardModal(DeviceInstallationResultModal),
  device_activation: standardModal(DeviceActivationResultModal),
  device_disconnection: standardModal(DeviceDisconnectionResultModal),
  device_retrieval: standardModal(DeviceRetrievalResultModal),
  device_return: standardModal(DeviceReturnResultModal),
  device_transfer: standardModal(DeviceTransferResultModal),
  emergency_maintenance: ({ visit, task, primaryTeam, backupTeam, onClose, onSaved }) => (
    <EmergencyResultModal
      key={`${visit.id}:${task.id}`}
      taskId={task.source_open_task_id ?? task.open_task_id ?? task.id}
      visitId={visit.id}
      visitTaskId={task.id}
      maintenanceKind="emergency"
      contractId={task.contract_id ?? null}
      visitTechnicianEmployeeId={primaryTeam?.technician?.id ?? backupTeam?.technician?.id ?? null}
      visitTechnicianName={primaryTeam?.technician?.name ?? backupTeam?.technician?.name ?? null}
      onClose={onClose}
      onSaved={onSaved}
    />
  ),
  periodic_maintenance: ({ visit, task, primaryTeam, backupTeam, onClose, onSaved }) => (
    <EmergencyResultModal
      key={`${visit.id}:${task.id}`}
      taskId={task.source_open_task_id ?? task.open_task_id ?? task.id}
      visitId={visit.id}
      visitTaskId={task.id}
      maintenanceKind="periodic"
      contractId={task.contract_id ?? null}
      visitTechnicianEmployeeId={primaryTeam?.technician?.id ?? backupTeam?.technician?.id ?? null}
      visitTechnicianName={primaryTeam?.technician?.name ?? backupTeam?.technician?.name ?? null}
      onClose={onClose}
      onSaved={onSaved}
    />
  ),
  golden_warranty_offer: standardModal(GoldenWarrantyOfferModal),
  golden_warranty_card_delivery: standardModal(GoldenWarrantyCardDeliveryModal),
  installment_collection: standardModal(InstallmentCollectionResultModal),
  gift_delivery: standardModal(GiftDeliveryResultModal),
} satisfies Record<VisitResultTaskType, VisitTaskResultRenderer>;

export function hasVisitTaskResultModal(taskType: string | null | undefined): taskType is VisitResultTaskType {
  return isVisitResultTaskType(taskType) && taskType in VISIT_TASK_RESULT_MODAL_REGISTRY;
}

export default function VisitTaskResultModalHost(context: VisitTaskResultModalContext) {
  const taskType = context.task?.task_type ?? context.task?.taskType;
  if (!hasVisitTaskResultModal(taskType)) return null;
  return VISIT_TASK_RESULT_MODAL_REGISTRY[taskType](context);
}
