-- Migration 113: Add location_basis to task_type_config
-- Determines which geographic point to use when matching a task to a work scope zone.
--
-- 'client'   → use clients.neighborhood (the customer's residential/registered location)
-- 'contract' → use contracts.installation_geo_unit_id (where the device is physically installed)
--
-- Decision rule:
--   Tasks about the customer themselves (demo, checkup, gift, first purchase)
--     → 'client'  (we go where the customer is)
--   Tasks about the installed device (maintenance, collection, service, warranty, delivery)
--     → 'contract' (we go where the device is)

ALTER TABLE task_type_config
  ADD COLUMN IF NOT EXISTS location_basis VARCHAR(20) NOT NULL DEFAULT 'client'
    CHECK (location_basis IN ('client', 'contract'));

-- customer-location tasks (موقع الزبون)
UPDATE task_type_config SET location_basis = 'client'
WHERE task_type IN (
  'device_demo',        -- عرض جهاز — نذهب إلى الزبون
  'device_checkup',     -- تشييك — نذهب إلى الزبون
  'gift_delivery',      -- تسليم هدية — نسلّم للزبون
  'device_purchase'     -- شراء جهاز (توقيع عقد) — في موقع الزبون
);

-- device-location tasks (موقع الجهاز) — default is already 'client', set explicitly
UPDATE task_type_config SET location_basis = 'contract'
WHERE task_type IN (
  'device_delivery',        -- تسليم الجهاز — إلى موقع التركيب
  'device_installation',    -- تركيب الجهاز — موقع التركيب
  'device_activation',      -- تشغيل الجهاز — موقع الجهاز
  'periodic_maintenance',   -- صيانة دورية — موقع الجهاز
  'emergency_maintenance',  -- صيانة طارئة — موقع الجهاز
  'installment_collection', -- تحصيل قسط — موقع الجهاز
  'maintenance_collection', -- تحصيل ذمة صيانة — موقع الجهاز
  'parts_sale',             -- شراء قطعة — موقع الجهاز
  'device_retrieval',       -- سحب الجهاز — موقع الجهاز
  'device_repair',          -- فحص وإصلاح — موقع الشركة أو الزبون حسب نوع الصيانة → الجهاز
  'device_return',          -- إعادة الجهاز بعد الصيانة — موقع الجهاز
  'golden_warranty',        -- منح كفالة ذهبية — مرتبط بالعقد
  'warranty_cancellation',  -- إلغاء الكفالة — مرتبط بالعقد
  'warranty_reactivation',  -- إعادة تفعيل الكفالة — مرتبط بالعقد
  'device_disconnection',   -- توقيف الجهاز — موقع الجهاز
  'device_transfer'         -- نقل الجهاز — موقع الجهاز الجديد
);
