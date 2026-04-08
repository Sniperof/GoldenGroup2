import { PoolClient } from 'pg';

export interface AuditLogData {
  entityType: string;
  entityId: number;
  applicationId?: number | null;
  actionType: string;
  performedByRole?: string;
  performedByUserId?: number | null;
  oldValue?: string;
  newValue?: string;
  internalReason?: string;
}

export async function insertAuditLog(client: PoolClient, data: AuditLogData) {
  await client.query(
    `INSERT INTO audit_logs
      (entity_type, entity_id, application_id, action_type, performed_by_role,
       performed_by_user_id, old_value, new_value, internal_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      data.entityType,
      data.entityId,
      data.applicationId ?? null,
      data.actionType,
      data.performedByRole || null,
      data.performedByUserId || null,
      data.oldValue || null,
      data.newValue || null,
      data.internalReason || null,
    ]
  );
}
