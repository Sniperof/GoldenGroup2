-- Migration 212: seed the contracts.approve permission
-- ----------------------------------------------------------------------
-- Constitution rule (DEC-CT-01 follow-up): a draft contract becomes 'active'
-- only when the closing employee approves it. The approve / reject actions
-- are gated by a dedicated permission so that not every editor can flip the
-- legal state of a contract — only an authorized closer can.
-- ----------------------------------------------------------------------

BEGIN;

INSERT INTO permissions (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES (
  'contracts.approve',
  'contracts',
  'contracts',
  'approve',
  'الموافقة على عقد أو رفضه',
  35,
  ARRAY['GLOBAL', 'BRANCH']
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
