-- Migration 185: populate referrers JSONB from legacy referrer_name/referrer_id/referrer_type
-- Rule: if referrers is NULL or empty array, and legacy fields have real data, populate it.

UPDATE clients
SET referrers = jsonb_build_array(
  jsonb_build_object(
    'id', referrer_id,
    'name', referrer_name,
    'type', COALESCE(
      CASE referrer_type
        WHEN 'Employee' THEN 'employee'
        WHEN 'Client' THEN 'client'
        WHEN 'Personal' THEN 'personal'
        WHEN 'Customer' THEN 'customer'
        ELSE 'unknown'
      END,
      'unknown'
    )
  )
)
WHERE (referrers IS NULL OR referrers = '[]'::jsonb)
  AND referrer_name IS NOT NULL
  AND referrer_name != ''
  AND referrer_name != 'مجهول'
  AND referrer_name != 'Unknown';

-- Index for fast referrer lookups
CREATE INDEX IF NOT EXISTS idx_clients_referrers ON clients USING gin(referrers);
