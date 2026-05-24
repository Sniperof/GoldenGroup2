INSERT INTO permissions (key, module, sub_module, action, display_name)
VALUES ('sales.can_close', 'sales', 'closing', 'close', 'القدرة على تسكير العروض والمبيعات')
ON CONFLICT (key) DO NOTHING;
