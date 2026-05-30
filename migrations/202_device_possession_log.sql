-- Migration 202: device_possession_log per DEC-CT-09
-- ----------------------------------------------------------------------
-- Reference: docs/constitution/contracts/08-resolved-decisions.md (DEC-CT-09)
--
-- Possession is not a column on installed_devices; it's a historical ledger
-- of (device, holder, start, end, reason) rows. The row with end_at IS NULL
-- is the current holder.
--
-- holder_type enum:    warehouse | technician | customer | workshop | supplier
-- reason enum:         sale_delivery | repair_pickup | temporary_swap
--                      | retrieval | cancellation | transfer
--
-- holder_id is interpreted by holder_type at the application layer
-- (warehouses/employees/clients/external suppliers live in different tables).
-- ----------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS device_possession_log (
  id            SERIAL PRIMARY KEY,
  device_id     INTEGER NOT NULL
                  REFERENCES installed_devices(id) ON DELETE CASCADE,
  holder_type   VARCHAR(20) NOT NULL,
  holder_id     INTEGER,                 -- nullable: e.g. "warehouse" with no specific id
  start_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_at        TIMESTAMPTZ,             -- NULL = current holder
  reason        VARCHAR(30) NOT NULL,
  notes         TEXT,
  created_by    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT device_possession_holder_type_check
    CHECK (holder_type IN ('warehouse', 'technician', 'customer', 'workshop', 'supplier')),

  CONSTRAINT device_possession_reason_check
    CHECK (reason IN ('sale_delivery', 'repair_pickup', 'temporary_swap',
                      'retrieval', 'cancellation', 'transfer')),

  -- start_at must precede end_at when both are present.
  CONSTRAINT device_possession_period_check
    CHECK (end_at IS NULL OR end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS idx_device_possession_device
  ON device_possession_log(device_id);

-- Only one open (current) row per device. Enforced as a partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_device_possession_open_per_device
  ON device_possession_log(device_id)
  WHERE end_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_possession_holder
  ON device_possession_log(holder_type, holder_id);

-- Convenience view: the current holder of each device.
CREATE OR REPLACE VIEW device_current_possession AS
  SELECT device_id, id AS possession_id, holder_type, holder_id, start_at, reason
    FROM device_possession_log
    WHERE end_at IS NULL;

-- Backfill: seed an open row for every existing device.
--
-- Heuristic:
--   delivered / installed / active / faulty / out_of_service → customer
--   in_workshop                                              → workshop (NULL id)
--   retrieved                                                → warehouse (NULL id)
--   pending_delivery / registered / ready (default)          → warehouse (NULL id)
--
-- start_at is the device's installation_date if present, else delivery_date,
-- else created_at — so the ledger starts at the earliest known event.
INSERT INTO device_possession_log
  (device_id, holder_type, holder_id, start_at, reason, notes)
SELECT
  d.id,
  CASE
    WHEN d.status IN ('delivered','installed','active','faulty','out_of_service') THEN 'customer'
    WHEN d.status = 'in_workshop'                                                 THEN 'workshop'
    ELSE 'warehouse'
  END                                                                AS holder_type,
  CASE
    WHEN d.status IN ('delivered','installed','active','faulty','out_of_service') THEN d.customer_id
    ELSE NULL
  END                                                                AS holder_id,
  COALESCE(d.installation_date::timestamptz, d.delivery_date::timestamptz, d.created_at)
                                                                     AS start_at,
  CASE
    WHEN d.status IN ('delivered','installed','active','faulty','out_of_service') THEN 'sale_delivery'
    WHEN d.status = 'in_workshop'                                                 THEN 'repair_pickup'
    WHEN d.status = 'retrieved'                                                   THEN 'retrieval'
    ELSE 'transfer'
  END                                                                AS reason,
  'Backfilled from installed_devices.status by migration 202'        AS notes
FROM installed_devices d
WHERE NOT EXISTS (
  SELECT 1 FROM device_possession_log p WHERE p.device_id = d.id AND p.end_at IS NULL
);

COMMIT;
