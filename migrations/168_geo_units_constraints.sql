-- GAP-035: Add CHECK constraint on geo_units.level
-- Actual data has 4 levels (not 3 as originally documented in constitution)
-- Level 1: محافظة | Level 2: منطقة | Level 3: ناحية | Level 4: حي/قرية
ALTER TABLE geo_units
  ADD CONSTRAINT geo_units_level_check CHECK (level IN (1, 2, 3, 4));

-- GAP-039: Replace ON DELETE CASCADE with ON DELETE RESTRICT on parent_id
-- Prevents silent mass-deletion of entire geographic subtrees
ALTER TABLE geo_units
  DROP CONSTRAINT geo_units_parent_id_fkey;

ALTER TABLE geo_units
  ADD CONSTRAINT geo_units_parent_id_fkey
    FOREIGN KEY (parent_id)
    REFERENCES geo_units(id)
    ON DELETE RESTRICT;
