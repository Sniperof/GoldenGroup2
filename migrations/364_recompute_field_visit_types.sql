-- D4: field_visits.visit_type is derived from the current visit_tasks families.
-- Only task_family='marketing' is marketing; every other operational family is
-- service. A visit containing both classifications is mixed.
UPDATE visit_tasks vt
   SET task_family = ttc.task_family,
       updated_at = NOW()
  FROM task_type_config ttc
 WHERE ttc.task_type = vt.task_type
   AND vt.task_family IS DISTINCT FROM ttc.task_family;

WITH classified AS (
  SELECT vt.field_visit_id,
         CASE
           WHEN BOOL_OR(vt.task_family = 'marketing')
            AND BOOL_OR(vt.task_family <> 'marketing') THEN 'mixed'
           WHEN BOOL_OR(vt.task_family = 'marketing') THEN 'marketing'
           ELSE 'service'
         END AS visit_type
    FROM visit_tasks vt
   GROUP BY vt.field_visit_id
)
UPDATE field_visits fv
   SET visit_type = classified.visit_type,
       updated_at = NOW()
  FROM classified
 WHERE fv.id = classified.field_visit_id
   AND fv.visit_type IS DISTINCT FROM classified.visit_type;
