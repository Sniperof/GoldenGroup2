-- 143_device_delivery_results.sql
BEGIN;

CREATE TABLE IF NOT EXISTS visit_task_device_delivery_results (
  id                    BIGSERIAL   PRIMARY KEY,
  visit_task_result_id  BIGINT      NOT NULL REFERENCES visit_task_results(id) ON DELETE CASCADE,
  CONSTRAINT uq_vtdelivery_result UNIQUE (visit_task_result_id),

  -- البيانات المحددة للتسليم
  serial_number         VARCHAR(100),          -- الرقم التسلسلي للجهاز المسلّم
  device_model_id      INTEGER REFERENCES device_models(id) ON DELETE SET NULL,
  delivery_address      TEXT,                   -- عنوان التسليم (من العقد أو يدوي)
  actual_delivery_date  DATE,                   -- تاريخ التسليم الفعلي
  delivered_by_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  customer_acknowledged  BOOLEAN DEFAULT FALSE, -- توقيع/إقرار الزبون
  delivery_photos       JSONB DEFAULT '[]',     -- مصفوفة URLs للصور

  -- الحالة التشغيلية
  delivery_condition    VARCHAR(50) CHECK (delivery_condition IN ('perfect', 'minor_damage', 'missing_accessories')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
