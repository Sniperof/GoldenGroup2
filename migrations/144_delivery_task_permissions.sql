-- 144_delivery_task_permissions.sql
-- Adds open_task_delivery_results table and delivery-family task permissions.
BEGIN;

CREATE TABLE IF NOT EXISTS open_task_delivery_results (
  id                       BIGSERIAL   PRIMARY KEY,
  open_task_id             INTEGER     NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,
  CONSTRAINT uq_open_task_delivery_result UNIQUE (open_task_id),

  outcome                  VARCHAR(50) NOT NULL CHECK (outcome IN (
    'delivered_successfully', 'customer_not_available', 'wrong_address', 'refused_delivery'
  )),
  serial_number            VARCHAR(100),
  device_model_id          INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  delivery_address         TEXT,
  actual_delivery_date     DATE,
  delivered_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  customer_acknowledged    BOOLEAN     NOT NULL DEFAULT FALSE,
  delivery_condition       VARCHAR(50) CHECK (delivery_condition IN (
    'perfect', 'minor_damage', 'missing_accessories'
  )),
  delivery_photos          JSONB       NOT NULL DEFAULT '[]',
  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order)
VALUES
  ('tasks.delivery.view',       'tasks', 'delivery',     'view',   'عرض مهام التسليم والتركيب',  300),
  ('tasks.delivery.create',     'tasks', 'delivery',     'create', 'إنشاء مهمة تسليم يدوي',      301),
  ('tasks.delivery.result',     'tasks', 'delivery',     'result', 'تسجيل نتيجة تسليم',           302),
  ('tasks.installation.create', 'tasks', 'installation', 'create', 'إنشاء مهمة تركيب',            303),
  ('tasks.activation.create',   'tasks', 'activation',  'create', 'إنشاء مهمة تشغيل',            304)
ON CONFLICT (key) DO NOTHING;

COMMIT;
