-- ============================================================
-- 389_candidate_branch_ownership.sql
-- Candidate ownership = exactly one eligible employee OR the branch.
-- Branch ownership is represented by zero candidate_assignments rows.
-- ============================================================

BEGIN;

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  (
    'candidates.assignment.manage',
    'candidates',
    'candidates',
    'assignment_manage',
    'إدارة مسؤولي الأسماء المقترحة',
    97,
    ARRAY['GLOBAL','BRANCH']
  )
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    sub_module = EXCLUDED.sub_module,
    action = EXCLUDED.action,
    display_name = EXCLUDED.display_name,
    display_order = EXCLUDED.display_order,
    allowed_scopes = EXCLUDED.allowed_scopes;

-- Mirror the established client-assignment administrators, then make the two
-- management baselines explicit by stable role name.
INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT source_grant.role_id, target_permission.id, source_grant.scope_type
  FROM public.role_permission_grants source_grant
  JOIN public.permissions source_permission
    ON source_permission.id = source_grant.permission_id
 CROSS JOIN (
   SELECT id FROM public.permissions WHERE key = 'candidates.assignment.manage'
 ) target_permission
 WHERE source_permission.key = 'clients.assignment.manage'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

INSERT INTO public.role_permission_grants (role_id, permission_id, scope_type)
SELECT r.id, p.id, 'BRANCH'
  FROM public.roles r
 CROSS JOIN public.permissions p
 WHERE lower(r.name) IN ('branch_manager', 'company_manager')
   AND p.key = 'candidates.assignment.manage'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET scope_type = EXCLUDED.scope_type,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.candidate_ownership_history (
  id BIGSERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  from_ownership_type VARCHAR(16) NOT NULL
    CHECK (from_ownership_type IN ('PERSONAL', 'BRANCH')),
  from_hr_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  to_ownership_type VARCHAR(16) NOT NULL
    CHECK (to_ownership_type IN ('PERSONAL', 'BRANCH')),
  to_hr_user_id INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  reason VARCHAR(64) NOT NULL,
  changed_by INTEGER REFERENCES public.hr_users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidate_ownership_history_candidate
  ON public.candidate_ownership_history(candidate_id, changed_at DESC);

-- Existing duplicates must be reconciled operationally. This trigger prevents
-- any new candidate from receiving more than one responsible in the meantime.
CREATE OR REPLACE FUNCTION public.enforce_single_candidate_responsible()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.candidate_assignments ca
     WHERE ca.candidate_id = NEW.candidate_id
       AND ca.id <> COALESCE(NEW.id, -1)
  ) THEN
    RAISE EXCEPTION 'candidate % already has a responsible', NEW.candidate_id
      USING ERRCODE = '23505',
            CONSTRAINT = 'candidate_assignments_one_responsible';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_assignments_one_responsible
  ON public.candidate_assignments;
CREATE TRIGGER trg_candidate_assignments_one_responsible
BEFORE INSERT OR UPDATE OF candidate_id
ON public.candidate_assignments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_candidate_responsible();

-- Approved rule: when an assignee becomes inactive, open names fall back to
-- branch ownership. Terminal names retain their historical assignment.
CREATE OR REPLACE FUNCTION public.release_open_candidates_for_hr_user(
  target_hr_user_id INTEGER,
  transition_reason VARCHAR
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  affected_candidate_ids INTEGER[];
BEGIN
  SELECT array_agg(DISTINCT ca.candidate_id)
    INTO affected_candidate_ids
    FROM public.candidate_assignments ca
    JOIN public.candidates c ON c.id = ca.candidate_id
   WHERE ca.hr_user_id = target_hr_user_id
     AND c.status NOT IN ('Qualified', 'Junk')
     AND c.converted_to_lead_id IS NULL;

  IF affected_candidate_ids IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.candidate_ownership_history (
    candidate_id, from_ownership_type, from_hr_user_id,
    to_ownership_type, to_hr_user_id, reason, changed_by
  )
  SELECT ca.candidate_id, 'PERSONAL', ca.hr_user_id,
         CASE WHEN next_owner.hr_user_id IS NULL THEN 'BRANCH' ELSE 'PERSONAL' END,
         next_owner.hr_user_id,
         transition_reason,
         NULL
    FROM public.candidate_assignments ca
    JOIN public.candidates c ON c.id = ca.candidate_id
    LEFT JOIN LATERAL (
      SELECT ca2.hr_user_id
        FROM public.candidate_assignments ca2
       WHERE ca2.candidate_id = ca.candidate_id
         AND ca2.hr_user_id <> target_hr_user_id
       ORDER BY ca2.assigned_at, ca2.id
       LIMIT 1
    ) next_owner ON TRUE
   WHERE ca.hr_user_id = target_hr_user_id
     AND c.status NOT IN ('Qualified', 'Junk')
     AND c.converted_to_lead_id IS NULL;

  DELETE FROM public.candidate_assignments ca
   USING public.candidates c
   WHERE ca.candidate_id = c.id
     AND ca.hr_user_id = target_hr_user_id
     AND c.status NOT IN ('Qualified', 'Junk')
     AND c.converted_to_lead_id IS NULL;

  UPDATE public.candidates c
     SET owner_user_id = (
       SELECT ca.hr_user_id
         FROM public.candidate_assignments ca
        WHERE ca.candidate_id = c.id
        ORDER BY ca.assigned_at, ca.id
        LIMIT 1
     )
   WHERE c.id = ANY(affected_candidate_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_candidates_when_hr_user_inactive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_active IS TRUE AND NEW.is_active IS NOT TRUE THEN
    PERFORM public.release_open_candidates_for_hr_user(
      NEW.id,
      'responsible_hr_user_deactivated'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_candidates_when_hr_user_inactive
  ON public.hr_users;
CREATE TRIGGER trg_release_candidates_when_hr_user_inactive
AFTER UPDATE OF is_active
ON public.hr_users
FOR EACH ROW
EXECUTE FUNCTION public.release_candidates_when_hr_user_inactive();

CREATE OR REPLACE FUNCTION public.release_candidates_when_employee_inactive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_hr_user_id INTEGER;
BEGIN
  IF OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
    FOR linked_hr_user_id IN
      SELECT id FROM public.hr_users WHERE employee_id = NEW.id
    LOOP
      PERFORM public.release_open_candidates_for_hr_user(
        linked_hr_user_id,
        'responsible_employee_deactivated'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_candidates_when_employee_inactive
  ON public.employees;
CREATE TRIGGER trg_release_candidates_when_employee_inactive
AFTER UPDATE OF status
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.release_candidates_when_employee_inactive();

-- Operational reconciliation surface. Do not auto-delete historical conflicts.
CREATE OR REPLACE VIEW public.candidate_ownership_reconciliation AS
WITH ownership AS (
  SELECT
    c.id AS candidate_id,
    c.branch_id,
    c.status,
    c.converted_to_lead_id,
    c.owner_user_id AS legacy_owner_user_id,
    COUNT(ca.id)::INTEGER AS assignment_count,
    array_remove(array_agg(ca.hr_user_id ORDER BY ca.assigned_at), NULL) AS assigned_user_ids,
    bool_or(
      ca.id IS NOT NULL AND (
        u.is_active IS NOT TRUE OR
        e.status IS DISTINCT FROM 'active' OR
        u.branch_id IS DISTINCT FROM c.branch_id OR
        NOT EXISTS (
          SELECT 1
            FROM public.role_permission_grants eligibility_rpg
            JOIN public.permissions eligibility_p
              ON eligibility_p.id = eligibility_rpg.permission_id
           WHERE eligibility_rpg.role_id = u.role_id
             AND eligibility_p.key = 'candidates.can_be_assigned'
        )
      )
    ) AS has_ineligible_assignment,
    CASE
      WHEN COUNT(ca.id) = 0 THEN c.owner_user_id IS NOT NULL
      ELSE NOT bool_or(ca.hr_user_id IS NOT DISTINCT FROM c.owner_user_id)
    END AS legacy_owner_mismatch
  FROM public.candidates c
  LEFT JOIN public.candidate_assignments ca ON ca.candidate_id = c.id
  LEFT JOIN public.hr_users u ON u.id = ca.hr_user_id
  LEFT JOIN public.employees e ON e.id = u.employee_id
  GROUP BY c.id, c.branch_id, c.status, c.converted_to_lead_id, c.owner_user_id
)
SELECT
  ownership.*,
  (
    ownership.status IN ('Qualified', 'Junk') OR
    ownership.converted_to_lead_id IS NOT NULL
  ) AS is_terminal,
  (
    ownership.assignment_count > 1 OR
    ownership.legacy_owner_mismatch OR
    (
      ownership.status NOT IN ('Qualified', 'Junk') AND
      ownership.converted_to_lead_id IS NULL AND
      ownership.has_ineligible_assignment
    )
  ) AS requires_reconciliation
FROM ownership;

COMMIT;
