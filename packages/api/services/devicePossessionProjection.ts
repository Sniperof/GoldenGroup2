export const DEVICE_POSSESSION_SELECT = `
  dpl.id,
  dpl.device_id,
  dpl.holder_type,
  dpl.holder_id,
  CASE
    WHEN dpl.holder_type = 'customer' THEN holder_customer.name
    WHEN dpl.holder_type = 'technician' THEN holder_technician.name
    WHEN dpl.holder_type = 'workshop' THEN holder_workshop.name
    ELSE NULL
  END AS holder_name,
  dpl.start_at,
  dpl.end_at,
  dpl.reason,
  dpl.notes,
  dpl.created_by,
  dpl.created_at
`;

export const DEVICE_POSSESSION_FROM = `
  FROM device_possession_log dpl
  LEFT JOIN clients holder_customer
    ON dpl.holder_type = 'customer'
   AND holder_customer.id = dpl.holder_id
  LEFT JOIN employees holder_technician
    ON dpl.holder_type = 'technician'
   AND holder_technician.id = dpl.holder_id
  LEFT JOIN branches holder_workshop
    ON dpl.holder_type = 'workshop'
   AND holder_workshop.id = dpl.holder_id
`;

export function mapDevicePossessionRow(row: any) {
  return {
    id: row.id,
    deviceId: row.device_id,
    holderType: row.holder_type,
    holderId: row.holder_id,
    holderName: row.holder_name ?? null,
    startAt: row.start_at,
    endAt: row.end_at,
    reason: row.reason,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
