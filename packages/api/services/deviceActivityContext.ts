// Labels the operation behind a change to installed_devices for the device
// activity log (migration 498). The trigger reads app.device_context first,
// then the request's app.change_context. The setting is transaction-local, so
// call it inside the transaction that writes the device, before the write;
// it ends with the transaction and touches no other log.
export type DeviceChangeContext =
  | 'contract_approved'
  | 'contract_cancelled'
  | 'device_edit'
  | 'device_details_edit'
  | 'possession_transfer'
  | 'external_device_created'
  | 'service_request_promoted'
  | 'installation_task_planned'
  | 'task_completed'
  | 'delivery_suspended'
  | 'delivery_resumed';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export async function labelDeviceChange(
  db: Queryable,
  context: DeviceChangeContext,
  reason?: string | null,
): Promise<void> {
  await db.query(
    `SELECT set_config('app.device_context', $1, true), set_config('app.device_reason', $2, true)`,
    [context, reason?.trim() ?? ''],
  );
}
