BEGIN;

-- «عدد البائع» is not one job title across the company: the seller of a marketing
-- department is a dealer (or a marketing representative), while the seller of a
-- customer-service department is a supervisor — the supervisors are the ones who
-- visit, offer and close, and they are registered under service by design.
--
-- So the seller role is mapped per department TYPE, stored in the type's existing
-- metadata (the same field already carrying `canSelectDevice`), and editable from the
-- system-lists admin screen. A department type with no mapping leaves the column
-- empty rather than zero: «no seller role defined here» is not «zero sellers».
UPDATE public.system_lists
   SET metadata = metadata || jsonb_build_object('sellerJobTitles', jsonb_build_array('ديلر', 'مندوب التسويق')),
       updated_at = NOW()
 WHERE category = 'department_type' AND value = 'تسويق و مبيعات';

UPDATE public.system_lists
   SET metadata = metadata || jsonb_build_object('sellerJobTitles', jsonb_build_array('مشرفة')),
       updated_at = NOW()
 WHERE category = 'department_type' AND value = 'صيانة و خدمة العملاء';

COMMIT;
