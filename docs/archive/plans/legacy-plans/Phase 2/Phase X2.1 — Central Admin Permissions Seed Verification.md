**التحليل**

راجعت المفاتيح المطلوبة في الكود وقاعدة البيانات الفعلية. البيئة المحلية الحالية تحتوي المفاتيح العشرة كلها فعلًا:

- `admin.roles.view`
- `admin.roles.manage`
- `admin.system_lists.view`
- `admin.system_lists.manage`
- `branches.view`
- `branches.manage`
- `geo.view`
- `geo.manage`
- `settings.view`
- `settings.manage`

كما تحققت مباشرة من قاعدة البيانات أن `SYSTEM_ADMIN` يملكها كلها في `role_permission_grants` مع `scope_type = GLOBAL`، وأن صفوف `role_permissions` compatibility موجودة أيضًا.

لكن مراجعة الـ repo نفسها أظهرت فجوة مهمة: لم أجد migration واضحة في المشروع تضمن seed لهذه المجموعة من الصلاحيات في البيئات الجديدة. لذلك **لم يكن هناك نقص في الـ DB الحالية**، لكن كان هناك **نقص في ضمان التهيئة المستقبلية**. لهذا السبب أضفت migration idempotent صغيرة.

**التنفيذ**

أضفت migration واحدة فقط:
- [030_central_admin_permissions_seeding.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/030_central_admin_permissions_seeding.sql>)

هذه migration تقوم بـ:
- ضمان وجود المفاتيح العشرة في جدول `permissions`
- تثبيت metadata الخاصة بها
- منحها فقط لـ `SYSTEM_ADMIN` template role في `role_permission_grants` مع `GLOBAL`
- تحديث `role_permissions` compatibility بدون منح أي دور آخر

لم أعدل:
- UI
- routes
- authorization model
- policies

**التقرير**

الملفات المضافة/المعدلة:
- أُضيف فقط [030_central_admin_permissions_seeding.sql](</D:/OneDrive/سطح المكتب/golden-crm-clean/migrations/030_central_admin_permissions_seeding.sql>)

الصلاحيات التي تم التحقق منها:
- `admin.roles.view`
- `admin.roles.manage`
- `admin.system_lists.view`
- `admin.system_lists.manage`
- `branches.view`
- `branches.manage`
- `geo.view`
- `geo.manage`
- `settings.view`
- `settings.manage`

الصلاحيات التي أُضيفت في migration:
- نفس القائمة أعلاه، لكن بصيغة idempotent `INSERT ... ON CONFLICT`

الـ grants التي أُضيفت في migration:
- كل المفاتيح العشرة إلى `SYSTEM_ADMIN`
- في `role_permission_grants` مع `scope_type = GLOBAL`

هل تم تحديث `role_permissions` compatibility؟
- نعم، في نفس migration، وبشكل idempotent أيضًا

نتيجة verification الفعلية على قاعدة البيانات الحالية:
```json
{
  "required_count": "10",
  "existing_permission_count": "10",
  "system_admin_global_grant_count": "10",
  "legacy_compat_count": "10",
  "missing_permissions": "0",
  "missing_system_admin_grants": "0",
  "missing_legacy_rows": "0"
}
```

الخلاصة النهائية:
- `Missing permissions: 0`
- `Missing SYSTEM_ADMIN grants: 0`
- `Missing legacy compatibility rows: 0`

ملاحظة مهمة:
- البيئة الحالية كانت مكتملة أصلًا
- migration أُضيفت لضمان أن البيئات الجديدة لا تعتمد على وجود هذه المفاتيح “صدفة” خارج الـ repo