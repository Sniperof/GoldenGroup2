-- GAP-034 Option B: Drop employees.residence free-text column
-- The proper geo FK columns (residence_governorate_id, residence_region_id,
-- residence_sub_area_id, residence_neighborhood_id) already exist with FK → geo_units.
-- The free-text field was built by joining application form inputs with ' - ' separator
-- and cannot be auto-migrated to IDs. Test data only — no data loss concern.

ALTER TABLE employees DROP COLUMN residence;
