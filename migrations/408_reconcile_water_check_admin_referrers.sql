-- Repair beneficiaries created from a water-check request whose unlinked
-- external mediator was incorrectly coerced to the acting admin as Personal.
-- The original mediator snapshot remains preserved on service_requests.

BEGIN;

UPDATE public.clients c
   SET referrer_type = NULL,
       referrer_id = NULL,
       referrer_name = NULL,
       referrers = '[]'::jsonb
  FROM public.service_requests sr,
       public.hr_users creator
 WHERE sr.request_type = 'water_check'
   AND sr.beneficiary_client_id = c.id
   AND sr.referrer_external IS NOT NULL
   AND sr.referrer_client_id IS NULL
   AND creator.id = c.created_by
   AND c.referrer_type = 'Personal'
   AND NULLIF(TRIM(c.referrer_name), '') = NULLIF(TRIM(creator.name), '')
   AND c.referral_reason = 'طلب فحص المياه ' || sr.public_ref_number
   AND NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(COALESCE(c.referrers, '[]'::jsonb)) item
      WHERE COALESCE(item->>'referrerType', item->>'type') IS DISTINCT FROM 'Personal'
   );

COMMIT;
