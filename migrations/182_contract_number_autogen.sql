-- 182_contract_number_autogen.sql
-- contract_number كان موجوداً في الجدول لكن بدون توليد تلقائي.
-- هذا الـ migration يُنشئ sequence + trigger لتوليد الرقم عند الإنشاء،
-- ويُعبئ العقود الموجودة بشكل retroactive.

-- Sequence مخصصة لأرقام العقود (تبدأ بعد أكبر id موجود)
CREATE SEQUENCE IF NOT EXISTS contract_number_seq;
SELECT setval('contract_number_seq', (SELECT COALESCE(MAX(id), 0) FROM contracts) + 1, false);

-- دالة توليد رقم العقد
CREATE OR REPLACE FUNCTION fn_set_contract_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_number IS NULL OR NEW.contract_number = '' THEN
    NEW.contract_number := 'C-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('contract_number_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger يُطبّق الدالة قبل كل INSERT
DROP TRIGGER IF EXISTS trg_set_contract_number ON contracts;
CREATE TRIGGER trg_set_contract_number
  BEFORE INSERT ON contracts
  FOR EACH ROW EXECUTE FUNCTION fn_set_contract_number();

-- Backfill للعقود الموجودة التي ليس لها رقم
UPDATE contracts
SET contract_number = 'C-' || TO_CHAR(created_at, 'YYYY') || '-' || LPAD(id::text, 5, '0')
WHERE contract_number IS NULL OR contract_number = '';
