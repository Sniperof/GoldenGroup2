const TASK_TYPE_GROUP_BASE: Record<string, string> = {
  device_demo: '/tasks/group/device-demo',
  emergency_maintenance: '/tasks/group/maintenance',
  periodic_maintenance: '/tasks/group/maintenance',
  installment_collection: '/tasks/group/collection',
  device_checkup: '/tasks/group/after-sale-services',
  device_retrieval: '/tasks/group/after-sale-services',
  device_return: '/tasks/group/after-sale-services',
  device_transfer: '/tasks/group/after-sale-services',
  gift_delivery: '/tasks/group/gift-delivery',
  golden_warranty_offer: '/tasks/group/warranty-services',
  golden_warranty_card_delivery: '/tasks/group/warranty-services',
  device_delivery: '/tasks/group/device-delivery',
  device_installation: '/tasks/group/device-installation',
  device_activation: '/tasks/group/device-activation',
  device_disconnection: '/tasks/group/device-disconnection',
};

export function getTaskGroupBasePath(taskType: string | null | undefined) {
  return taskType ? TASK_TYPE_GROUP_BASE[taskType] ?? null : null;
}

export function getOpenTaskDetailPath(taskType: string | null | undefined, taskId: number | string | null | undefined) {
  if (taskId == null || taskId === '') return null;
  const basePath = getTaskGroupBasePath(taskType);
  return basePath ? `${basePath}/${taskId}` : null;
}
