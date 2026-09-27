-- ============================================================
-- 469_certificate_academic_levels.sql
-- ============================================================
-- Certificates («الشهادات», system_lists category 'certificate') now carry an
-- academic level in metadata.level. Applicant↔vacancy matching compares
-- levels (applicant level >= required level = match) instead of a hardcoded
-- table inside the web bundle that didn't know most of the list's values.
--
-- Seeds a default level for the existing certificates. Only fills a MISSING
-- level — a level already set from the reference-lists page is never
-- overwritten, so the migration is safe to rerun. Values are matched with
-- whitespace collapsed because «شهادة  جامعية» is stored with a double space.
-- Admins can adjust any level afterwards from the reference-lists page.
-- ============================================================

BEGIN;

WITH defaults(normalized_value, level) AS (
  VALUES
    ('ابتدائية',      1),
    ('متوسطة',        2),
    ('إعدادية',       2),
    ('شهادة ثانوية',  3),
    ('معهد',          4),
    ('دبلوم',         4),
    ('شهادة جامعية',  5),
    ('بكالوريوس',     5),
    ('ماجستير',       6),
    ('دكتوراه',       7)
)
UPDATE system_lists sl
   SET metadata   = COALESCE(sl.metadata, '{}'::jsonb) || jsonb_build_object('level', d.level),
       updated_at = NOW()
  FROM defaults d
 WHERE sl.category = 'certificate'
   AND btrim(regexp_replace(sl.value, '\s+', ' ', 'g')) = d.normalized_value
   AND NOT (COALESCE(sl.metadata, '{}'::jsonb) ? 'level');

COMMIT;
