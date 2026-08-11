BEGIN;

CREATE TABLE device_model_sales_branches (
  id BIGSERIAL PRIMARY KEY,
  device_model_id INTEGER NOT NULL REFERENCES device_models(id) ON DELETE RESTRICT,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT device_model_sales_branches_unique UNIQUE (device_model_id, branch_id),
  CONSTRAINT device_model_sales_branches_display_order_check CHECK (display_order >= 0)
);

CREATE INDEX device_model_sales_branches_active_model_idx
  ON device_model_sales_branches (device_model_id, display_order, branch_id)
  WHERE is_active = TRUE;

CREATE INDEX device_model_sales_branches_active_branch_idx
  ON device_model_sales_branches (branch_id, device_model_id)
  WHERE is_active = TRUE;

-- One-time compatibility seed from the former department-based assignment.
-- The independent relation is the source of truth after this migration and is
-- intentionally not synchronized with departments.device_model_ids.
INSERT INTO device_model_sales_branches (device_model_id, branch_id, display_order)
SELECT DISTINCT parsed.device_model_id, d.branch_id, 0
FROM departments d
CROSS JOIN LATERAL (
  SELECT value::INTEGER AS device_model_id
  FROM jsonb_array_elements_text(COALESCE(d.device_model_ids, '[]'::jsonb)) AS item(value)
  WHERE value ~ '^[1-9][0-9]*$'
) parsed
JOIN device_models dm
  ON dm.id = parsed.device_model_id
 AND dm.deleted_at IS NULL
JOIN branches b
  ON b.id = d.branch_id
 AND b.status = 'active'
WHERE d.branch_id IS NOT NULL
ON CONFLICT (device_model_id, branch_id) DO NOTHING;

COMMIT;
