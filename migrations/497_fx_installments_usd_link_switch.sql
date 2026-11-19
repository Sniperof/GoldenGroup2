-- 497 — Global USD-link switch for installment schedules (owner decision 2026-11-19).
--
-- Management decides, for ALL new schedules (contract installments and deferred
-- maintenance installments), whether they are fixed in USD at confirmation
-- (migr 493/495 behaviour) or stay plain SYP like the pre-493 contracts.
-- The decision is frozen per schedule at its first confirmation: switching it
-- later never relinks or unlinks an existing schedule.
--
-- Default 'true' = today's behaviour, so applying this changes nothing.

INSERT INTO public.system_settings (key, value, value_type, category, description)
VALUES ('fx_installments_usd_link_enabled', 'true', 'boolean', 'contracts',
        'ربط جداول الأقساط الجديدة (العقود والصيانة) بالدولار عند تأكيدها. إيقافه يجعل الجداول الجديدة بالليرة فقط، ولا يغيّر الجداول المؤكدة سابقاً.')
ON CONFLICT (key) DO NOTHING;
