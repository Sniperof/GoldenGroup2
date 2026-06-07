-- Fine-grained permissions for sensitive client profile sections.

INSERT INTO public.permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('clients.contacts.view',          'clients', 'profile_contacts',          'view',   'عرض جهات تواصل الزبون',              60, '{GLOBAL,BRANCH}'),
  ('clients.contacts.edit',          'clients', 'profile_contacts',          'edit',   'تعديل جهات تواصل الزبون',             61, '{GLOBAL,BRANCH}'),
  ('clients.call_log.view',          'clients', 'profile_call_log',          'view',   'عرض سجل اتصال الزبون',                62, '{GLOBAL,BRANCH}'),
  ('clients.call_log.create',        'clients', 'profile_call_log',          'create', 'تسجيل اتصال على الزبون',              63, '{GLOBAL,BRANCH}'),
  ('clients.call_log.edit',          'clients', 'profile_call_log',          'edit',   'تعديل سجل اتصال الزبون',               64, '{GLOBAL,BRANCH}'),
  ('clients.visits.view',            'clients', 'profile_visits',            'view',   'عرض زيارات ومهام الزبون',              65, '{GLOBAL,BRANCH}'),
  ('clients.devices.view',           'clients', 'profile_devices',           'view',   'عرض أجهزة الزبون',                     66, '{GLOBAL,BRANCH}'),
  ('clients.device_warranties.view', 'clients', 'profile_device_warranties', 'view',   'عرض كفالات أجهزة الزبون',              67, '{GLOBAL,BRANCH}'),
  ('clients.purchase_history.view',  'clients', 'profile_purchase_history',  'view',   'عرض سجل مشتريات الزبون',               68, '{GLOBAL,BRANCH}'),
  ('clients.parts_stock.view',       'clients', 'profile_parts_stock',       'view',   'عرض مخزون القطع عند الزبون',           69, '{GLOBAL,BRANCH}'),
  ('clients.pre_offers.view',        'clients', 'profile_pre_offers',        'view',   'عرض العروض المسبقة للزبون',            70, '{GLOBAL,BRANCH}'),
  ('clients.network.view',           'clients', 'profile_network',           'view',   'عرض شبكة إحالات الزبون',               71, '{GLOBAL,BRANCH}'),
  ('clients.account_statement.view', 'clients', 'profile_account_statement', 'view',   'عرض كشف حساب الزبون',                  72, '{GLOBAL,BRANCH}'),
  ('clients.contact_control.edit',   'clients', 'profile_contact_control',   'edit',   'تعديل حالة التواصل مع الزبون',          73, '{GLOBAL,BRANCH}')
ON CONFLICT (key) DO NOTHING;
