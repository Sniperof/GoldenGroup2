-- Migration 167: Backfill customer_snapshot and contract_snapshot with existing data
-- Part of TASK 165 snapshot system

-- 1. Backfill customer_snapshot on field_visits
UPDATE field_visits fv
SET customer_snapshot = (
  SELECT jsonb_build_object(
    'name', c.name,
    'firstName', c.first_name,
    'fatherName', c.father_name,
    'lastName', c.last_name,
    'nickname', c.nickname,
    'mobile', c.mobile,
    'contacts', COALESCE(c.contacts, '[]'::jsonb),
    'address', jsonb_build_object(
      'governorate', (
        SELECT jsonb_build_object('id', gu.id, 'name', gu.name)
        FROM geo_units gu
        WHERE gu.id = NULLIF(c.governorate, '')::int
      ),
      'district', (
        SELECT jsonb_build_object('id', gu.id, 'name', gu.name)
        FROM geo_units gu
        WHERE gu.id = NULLIF(c.district, '')::int
      ),
      'subDistrict', (
        WITH RECURSIVE path AS (
          SELECT id, name, level, parent_id FROM geo_units WHERE id = NULLIF(c.neighborhood, '')::int
          UNION ALL
          SELECT gu.id, gu.name, gu.level, gu.parent_id FROM geo_units gu JOIN path ON path.parent_id = gu.id
        )
        SELECT jsonb_build_object('id', id, 'name', name) FROM path WHERE level = 3 LIMIT 1
      ),
      'neighborhood', (
        SELECT jsonb_build_object('id', gu.id, 'name', gu.name)
        FROM geo_units gu
        WHERE gu.id = NULLIF(c.neighborhood, '')::int AND gu.level = 4
      ),
      'detailedAddress', c.detailed_address,
      'gps', jsonb_build_object(
        'lat', (c.gps_coordinates->>'lat')::float,
        'lng', (c.gps_coordinates->>'lng')::float
      )
    ),
    'branch', jsonb_build_object(
      'id', fv.branch_id,
      'name', b.name
    ),
    'waterSource', c.water_source,
    'occupation', c.occupation,
    'spouseOccupation', c.spouse_occupation,
    'rating', c.rating,
    'referrers', COALESCE(c.referrers, '[]'::jsonb)
  )
  FROM clients c
  LEFT JOIN branches b ON b.id = fv.branch_id
  WHERE c.id = fv.client_id
)
WHERE fv.customer_snapshot IS NULL;

-- 2. Backfill contract_snapshot on visit_tasks
UPDATE visit_tasks vt
SET contract_snapshot = (
  SELECT jsonb_build_object(
    'contractId', c.id,
    'contractNumber', c.contract_number,
    'contractDate', c.contract_date,
    'device', jsonb_build_object(
      'modelId', c.device_model_id,
      'modelName', c.device_model_name,
      'serialNumber', c.serial_number,
      'maintenancePlan', c.maintenance_plan
    ),
    'installationAddress', (
      WITH RECURSIVE path AS (
        SELECT id, name, level, parent_id FROM geo_units WHERE id = c.installation_geo_unit_id
        UNION ALL
        SELECT gu.id, gu.name, gu.level, gu.parent_id FROM geo_units gu JOIN path ON path.parent_id = gu.id
      )
      SELECT jsonb_build_object(
        'geoUnit', (
          SELECT jsonb_build_object('id', id, 'name', name)
          FROM geo_units
          WHERE id = c.installation_geo_unit_id
        ),
        'hierarchy', COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object('level', level, 'name', name) ORDER BY level ASC)
            FROM path
          ),
          '[]'::jsonb
        ),
        'addressText', c.installation_address_text,
        'gps', jsonb_build_object(
          'lat', c.installation_lat,
          'lng', c.installation_lng
        )
      )
    ),
    'financials', jsonb_build_object(
      'paymentType', c.payment_type,
      'finalPrice', c.final_price,
      'downPayment', c.down_payment,
      'installmentsCount', c.installments_count,
      'currency', 'SYP'
    ),
    'status', c.status
  )
  FROM contracts c
  WHERE c.id = vt.contract_id
)
WHERE vt.contract_id IS NOT NULL AND vt.contract_snapshot IS NULL;
