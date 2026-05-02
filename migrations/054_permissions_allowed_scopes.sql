-- Add allowed_scopes column to permissions table
ALTER TABLE permissions ADD COLUMN allowed_scopes TEXT[] NOT NULL DEFAULT ARRAY['GLOBAL', 'BRANCH', 'ASSIGNED'];

-- Set GLOBAL-only permissions (admin/branch management - should never be branch-scoped)
UPDATE permissions SET allowed_scopes = ARRAY['GLOBAL'] WHERE key IN (
  'admin.roles.view',
  'admin.roles.manage',
  'admin.system_lists.view',
  'admin.system_lists.manage',
  'branches.view',
  'branches.manage',
  'settings.view',
  'settings.manage',
  'users.branch_assignments.view',
  'users.branch_assignments.manage'
);

-- Set GLOBAL+BRANCH permissions (can be global or branch-level, but not personal/assigned)
UPDATE permissions SET allowed_scopes = ARRAY['GLOBAL', 'BRANCH'] WHERE key IN (
  'departments.view_list',
  'geo.view',
  'geo.manage',
  'candidates.view_list',
  'candidates.create',
  'candidates.edit',
  'candidates.delete',
  'candidates.name_lists.view_list',
  'candidates.name_lists.create',
  'candidates.name_lists.edit',
  'candidates.name_lists.delete',
  'referral_sheets.view_list',
  'referral_sheets.create',
  'referral_sheets.edit',
  'referral_sheets.delete',
  'clients.view_list',
  'clients.view',
  'clients.create',
  'clients.edit',
  'clients.delete',
  'clients.can_be_assigned',
  'contracts.view_list',
  'contracts.create',
  'contracts.edit',
  'contracts.delete',
  'tasks.view_list',
  'tasks.create',
  'tasks.edit',
  'tasks.delete',
  'marketing_visits.view',
  'marketing_visits.update_result'
);

-- The rest remain GLOBAL+BRANCH+ASSIGNED (which is the default)
-- These are: telemarketing.*, jobs.interviews.conduct, jobs.training.be_trainer, planning.schedule.appear

-- Add comment
COMMENT ON COLUMN permissions.allowed_scopes IS 'Scopes allowed for this permission. Super admin configures this. GLOBAL-only for admin functions, GLOBAL+BRANCH for operational, GLOBAL+BRANCH+ASSIGNED for personal.';