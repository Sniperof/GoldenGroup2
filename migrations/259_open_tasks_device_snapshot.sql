-- ============================================================
-- 259 — open_tasks.device_snapshot
-- ============================================================
-- Constitution: docs/constitution/components/device-snapshot.md §5.2
-- Stores a historical snapshot of installed_devices at task creation
-- time so the task tab can show device identity + location + warranty
-- without re-resolving the live device (which may have moved/changed).
-- ============================================================

ALTER TABLE public.open_tasks
  ADD COLUMN IF NOT EXISTS device_snapshot JSONB;

COMMENT ON COLUMN public.open_tasks.device_snapshot IS
  'Frozen DeviceSnapshot (see device-snapshot.md §3.2). Built from installed_devices at task creation.';

-- Backfill for existing tasks that already have device_id but no snapshot.
-- Minimal shape — promotes get richer data via the API builder.
-- Backfill open_tasks.contract_id from device when missing (every installed_device has one).
UPDATE public.open_tasks ot
   SET contract_id = d.contract_id
  FROM public.installed_devices d
 WHERE ot.device_id = d.id
   AND ot.contract_id IS NULL
   AND d.contract_id IS NOT NULL;

-- Backfill contract_snapshot for tasks that now have contract_id but no snapshot.
UPDATE public.open_tasks ot
   SET contract_snapshot = jsonb_build_object(
        'contractId',     c.id,
        'contractNumber', c.contract_number,
        'contractDate',   c.contract_date,
        'status',         c.status,
        'saleSubtype',    c.sale_subtype,
        'device', jsonb_build_object(
            'modelId',      c.device_model_id,
            'modelName',    c.device_model_name,
            'serialNumber', d.serial_number,
            'maintenancePlan', c.maintenance_plan,
            'warrantyMonths',  d.warranty_months,
            'warrantyVisits',  d.warranty_visits
        ),
        'installationAddress', jsonb_build_object(
            'geoUnitId',    d.installation_geo_unit_id,
            'geoUnitName',  gu.name,
            'addressText',  d.installation_address_text,
            'lat',          d.installation_lat,
            'lng',          d.installation_lng
        ),
        'financials', jsonb_build_object(
            'paymentType',       c.payment_type,
            'finalPrice',        c.final_price,
            'downPayment',       c.down_payment,
            'installmentsCount', c.installments_count,
            'currency',          'SYP'
        )
   )
   FROM public.contracts c
   LEFT JOIN public.installed_devices d ON d.contract_id = c.id
   LEFT JOIN public.geo_units gu        ON gu.id = d.installation_geo_unit_id
  WHERE ot.contract_id = c.id
    AND ot.contract_snapshot IS NULL;

UPDATE public.open_tasks ot
   SET device_snapshot = jsonb_build_object(
        'id',            d.id,
        'contractId',    d.contract_id,
        'contractNumber', c.contract_number,
        'customerId',    d.customer_id,
        'customerName',  c.customer_name,
        'branchId',      d.branch_id,
        'identity', jsonb_build_object(
            'modelId',       d.device_model_id,
            'modelName',     d.device_model_name,
            'serialNumber',  d.serial_number
        ),
        'lifecycle', jsonb_build_object(
            'status',           d.status,
            'deliveryDate',     d.delivery_date,
            'installationDate', d.installation_date,
            'activatedAt',      d.activated_at
        ),
        'location', jsonb_build_object(
            'geoUnitId',       d.installation_geo_unit_id,
            'geoUnitName',     gu.name,
            'addressText',     d.installation_address_text,
            'lat',             d.installation_lat,
            'lng',             d.installation_lng
        ),
        'warranty', jsonb_build_object(
            'contractWarrantyEndDate', d.contract_warranty_end_date,
            'goldenWarrantyEndDate',   d.golden_warranty_end_date,
            'warrantyMonths',          d.warranty_months,
            'warrantyVisits',          d.warranty_visits
        )
   )
   FROM public.installed_devices d
   LEFT JOIN public.contracts c    ON c.id = d.contract_id
   LEFT JOIN public.geo_units  gu  ON gu.id = d.installation_geo_unit_id
  WHERE ot.device_id = d.id
    AND ot.device_snapshot IS NULL;
