# دستور الكيان: الأدوار والصلاحيات (Roles & Permissions Domain Constitution)

> **الحالة (Status):** Active Draft / Authoritative
> **المرجع الأعلى لكل الأدوار الوظيفية، نطاقات الصلاحيات، والسيناريوهات التشغيلية.**
> **التاريخ:** 2026-06-06
> **الإصدار:** 1.0

---

## 1. هوية الكيان (Entity Identity)

- **الاسم العربي:** نظام الأدوار والصلاحيات
- **الاسم الإنجليزي:** Roles & Permissions (RBAC)
- **الجداول الرئيسية:**
  1. `roles` — تعريف الأدوار
  2. `permissions` — تعريف الصلاحيات
  3. `role_permission_grants` — ربط الدور بالصلاحية + نطاقها
  4. `hr_users` — الموظفون (مع `role_id`)
  5. `user_branch_assignments` — ربط الموظف بالفرع
- **الوصف:** نظام التحكم بالوصول (RBAC) المبني على ثلاثة مستويات: الدور (role) + الصلاحية (permission) + النطاق (scope). النطاق يحدد "أي بيانات" يقدر يشوفها الموظف، لا بس "أي شاشات" يقدر يفتحها.
- **الأهمية:** أي خلل بهالنظام بيعني تسريب بيانات فروع تانية، أو موظف بيشوف زباين ما له مسؤول عنن.

---

## 2. المفاهيم الأساسية (Core Concepts)

### 2.1 الدور (Role)

الدور = مجموعة صلاحيات + نطاقات. الدور ما بيربط بالموظف مباشرة — الموظف بياخد دور.

| الدور | الاسم التقني | الوصف |
|-------|-------------|-------|
| **مدير النظام** | `SYSTEM_ADMIN` | كل شي. ما حدود. |
| **مدير الشركة** | `company_manager` | شوف كل الفروع، بس ما يقدر يعدّل بنية النظام (أدوار/صلاحيات). |
| **مدير الفرع** | `branch_manager` | إدارة فرع واحد أو أكتر. مكلف بالتشغيل اليومي. |
| **مشرفة خدمة زبائن** | `CUSTOMER_SERVICE_SUPERVISOR` | مشرفة الفريق الميداني. بتدير المهام والجدولة. |
| **فني صيانة** | `technical` | بيعمل الزيارات وبيسجّل النتائج. |
| **مندوب مبيعات** | `sales` | بيساعد بإغلاق العروض. |
| **تيلماركتر** | `telemarketer` | بيتصل بالزباين وبحجز المواعيد. |
| **متدرب** | `trainee` | بيرافق الفني. بيسجّل حضور بس. |
| **مسؤول الموارد البشرية** | `hr_manager` | بيدير التوظيف والتدريب والمقابلات. |
| **مشرفة المقابلات** | `hr_assistant` | بتدير المقابلات اليومية. |

### 2.2 الصلاحية (Permission)

الصلاحية = فعل على كيان. مثلاً: `clients.view` (عرض الزبون)، `tasks.create` (إنشاء مهمة).

| المجال (Module) | أمثلة الصلاحيات |
|----------------|-----------------|
| `clients` | `view`, `view_list`, `create`, `edit`, `delete` |
| `contracts` | `view_list`, `create`, `edit`, `delete` |
| `tasks` | `view_list`, `create`, `edit`, `delete` |
| `open_tasks` | `view`, `edit` |
| `telemarketing` | `calls.create`, `appointments.create`, `lists.view` |
| `planning` | `view`, `manage`, `schedule.appear` |
| `jobs` | `applications.view_list`, `interviews.conduct`, `training.create` |
| `field_visits` | `view`, `edit` |
| `branches` | `view`, `manage` |
| `settings` | `view`, `manage` |
| `admin` | `roles.view`, `roles.manage`, `system_lists.view`, `system_lists.manage` |

### 2.3 النطاق (Scope)

النطاق بيحدد **أي بيانات** يقدر يشوفها الموظف.

| النطاق | المعنى | مثال |
|--------|--------|------|
| **GLOBAL** | كل البيانات بكل الفروع | مدير الشركة بيشوف كل الزباين |
| **BRANCH** | بيانات الفرع الحالي بس | مدير الفرع بيشوف زباين فرعو |
| **ASSIGNED** | بيانات مسندة للموظف شخصياً | الفني بيشوف زباين مسندين له |

---

## 3. السيناريوهات التشغيلية (Operational Scenarios)

### 3.1 السيناريو: مدير الشركة (Company Manager)

> **الغرض:** شوف كل التشغيل بكل الفروع، بس ما تعدّل بنية النظام.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `clients.view_list` | GLOBAL | بيشوف كل زباين الشركة |
| `contracts.view_list` | GLOBAL | بيشوف كل العقود |
| `tasks.view_list` | GLOBAL | بيشوف كل المهام |
| `open_tasks.view` | GLOBAL | بيشوف كل المهام المفتوحة |
| `planning.view` | GLOBAL | بيشوف جداول كل الفروع |
| `branches.view` | GLOBAL | بيشوف كل الفروع |
| `field_visits.view` | GLOBAL | بيشوف كل الزيارات |
| `telemarketing.targets.view` | GLOBAL | بيشوف أهداف التيلماركتر |
| `jobs.applications.view_list` | GLOBAL | بيشوف طلبات التوظيف |
| **ما** **ما** يملك | — | `admin.roles.manage`، `settings.manage`، `branches.manage` |

**السيناريو:** مدير الشركة فاتح التطبيق. بيختار أي فرع من dropdown. بيشوف زباين الفرع، مهامو، زياراتو. بيقدر ينتقل لفرع تاني بنفس الجلسة. بس ما بيقدر يحذف فرع أو يعدّل أدوار.

### 3.2 السيناريو: مدير الفرع (Branch Manager)

> **الغرض:** إدارة فرع واحد أو أكتر. بشوف كل شي بفروعو.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `clients.view_list` | BRANCH | بيشوف زباين فروعو |
| `contracts.view_list` | BRANCH | بيشوف عقود فروعو |
| `tasks.view_list` | BRANCH | بيشوف مهام فروعو |
| `planning.manage` | BRANCH | بيدير جدولة فروعو |
| `planning.view` | BRANCH | بيشوف خطط فروعو |
| `telemarketing.lists.generate` | BRANCH | بيولّد كشوف اتصال لفرعو |
| `telemarketing.targets.view` | BRANCH | بيشوف أهداف الاتصال |
| `branches.view` | BRANCH | بيشوف فروعو |
| `branches.manage` | BRANCH | بيدير تفاصيل فروعو |
| `field_visits.view` | BRANCH | بيشوف زيارات فروعو |
| `field_visits.edit` | BRANCH | بيعدّل نتائج الزيارات |

**السيناريو المهم:** مدير الفرع عنده أكتر من فرع. بيختار "كل الفروع" من الفلتر → بيشوف زباين كل الفروع المربوطة فيه. بس ما بيشوف فروع تانية.

### 3.3 السيناريو: مشرفة خدمة زبائن (Supervisor)

> **الغرض:** إدارة المهام اليومية والفريق الميداني.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `clients.view_list` | ASSIGNED | بيشوف الزباين المسندين لها |
| `clients.create` | BRANCH | بتنشئ زباين جديد بفرعها |
| `clients.edit` | ASSIGNED | بتعدّل زباين مسندين لها |
| `contracts.create` | BRANCH | بتنشئ عقود |
| `planning.schedule.appear` | BRANCH | بتظهر بجدولة الفرق |
| `telemarketing.appointments.create` | BRANCH | بتحجز مواعيد |
| `telemarketing.calls.create` | BRANCH | بتسجّل نتائج اتصال |
| `tasks.create` | BRANCH | بتنشئ مهام |
| `tasks.edit` | BRANCH | بتعدّل مهام |

**السيناريو:** المشرفة بتفتح صفحة الزباين → بيشوف بس الزباين المسندين لها أو لفريقها. ما بيشوف زباين فريق تاني.

### 3.4 السيناريو: فني صيانة (Technician)

> **الغرض:** تنفيذ الزيارات الميدانية وتسجيل النتائج.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `clients.view` | ASSIGNED | بيشوف الزباين المسندين له |
| `clients.view_list` | ASSIGNED | بيشوف قائمة زباينو |
| `planning.schedule.appear` | BRANCH | بيظهر بجدولة الفرق |
| `jobs.training.be_trainer` | BRANCH | بيقدر يدرب متدربين |
| `field_visits.view` | BRANCH | بيشوف زيارات فريقه |
| `field_visits.edit` | BRANCH | بيسجّل نتيجة الزيارة |

**السيناريو:** الفني بيفتح التطبيق → بيشوف زيارات اليوم. بيوصل للموقع → بيسجّل GPS → بيسجّل نتيجة. ما بيشوف زباين تانيين.

### 3.5 السيناريو: تيلماركتر (Telemarketer)

> **الغرض:** التواصل الهاتفي وحجز المواعيد.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `telemarketing.calls.create` | BRANCH | بتسجّل نتيجة اتصال |
| `telemarketing.calls.view_history` | BRANCH | بتشوف سجل اتصالاتها |
| `telemarketing.appointments.create` | BRANCH | بتحجز مواعيد |
| `telemarketing.appointments.view` | BRANCH | بتشوف مواعيدها |
| `telemarketing.targets.view` | BRANCH | بتشوف أهداف الاتصال |
| `telemarketing.lists.view` | BRANCH | بتشوف كشوف الاتصال |
| `planning.schedule.appear` | BRANCH | بتظهر بجدولة الفرق |

**السيناريو:** التيلماركتر بيفتح `TelemarketerWorkspace` → بيشوف قائمة الزباين المخصصة لفرعها. بيتصل → بيسجّل نتيجة. إذا حجز → بيتحول الزبون لقائمة "محجوز". ما بيشوف زباين فريق تاني.

### 3.6 السيناريو: متدرب (Trainee)

> **الغرض:** مرافقة الفني بالزيارات. صلاحيات محدودة جداً.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `planning.schedule.appear` | BRANCH | بيظهر بجدولة الفرق |

**السيناريو:** المتدرب بيظهر بجدولة الفرق بس. بيرافق الفني. ما عندو صلاحية تسجيل نتيجة أو تعديل.

### 3.7 السيناريو: مسؤول الموارد البشرية (HR Manager)

> **الغرض:** إدارة التوظيف والتدريب.

| الصلاحية | النطاق | السيناريو |
|----------|--------|-----------|
| `jobs.vacancies.view_list` | GLOBAL | بيشوف الوظائف الشاغرة |
| `jobs.vacancies.create` | GLOBAL | بينشئ وظائف |
| `jobs.applications.view_list` | GLOBAL | بيشوف طلبات التوظيف |
| `jobs.applications.hire` | GLOBAL | بيوظّف |
| `jobs.interviews.conduct` | GLOBAL | بيعمل مقابلات |
| `jobs.training.create` | GLOBAL | بينشئ دورات تدريب |
| `jobs.training.view_list` | GLOBAL | بيشوف الدورات |

---

## 4. مصفوفة الصلاحيات الكاملة (Permission Matrix)

### 4.1 الأدوار الأساسية الـ 6

| الصلاحية | مدير الشركة | مدير الفرع | مشرفة | فني | تيلماركتر | متدرب |
|----------|:----------:|:----------:|:-----:|:---:|:---------:|:-----:|
| **clients.view_list** | GLOBAL | BRANCH | ASSIGNED | ASSIGNED | — | — |
| **clients.view** | GLOBAL | BRANCH | BRANCH | ASSIGNED | — | — |
| **clients.create** | — | BRANCH | BRANCH | — | — | — |
| **clients.edit** | — | BRANCH | ASSIGNED | ASSIGNED | — | — |
| **clients.delete** | — | BRANCH | — | — | — | — |
| **contracts.view_list** | GLOBAL | BRANCH | ASSIGNED | — | — | — |
| **contracts.create** | — | BRANCH | BRANCH | — | — | — |
| **tasks.view_list** | GLOBAL | BRANCH | BRANCH | — | — | — |
| **tasks.create** | — | BRANCH | BRANCH | — | — | — |
| **tasks.edit** | — | BRANCH | BRANCH | — | — | — |
| **open_tasks.view** | GLOBAL | BRANCH | BRANCH | BRANCH | BRANCH | — |
| **open_tasks.edit** | — | BRANCH | BRANCH | BRANCH | BRANCH | — |
| **planning.view** | GLOBAL | BRANCH | BRANCH | BRANCH | BRANCH | — |
| **planning.manage** | — | BRANCH | BRANCH | — | — | — |
| **planning.schedule.appear** | — | BRANCH | BRANCH | BRANCH | BRANCH | BRANCH |
| **telemarketing.calls.create** | — | — | BRANCH | — | BRANCH | — |
| **telemarketing.appointments.create** | — | — | BRANCH | — | BRANCH | — |
| **telemarketing.targets.view** | GLOBAL | BRANCH | BRANCH | — | BRANCH | — |
| **telemarketing.lists.view** | GLOBAL | BRANCH | BRANCH | — | BRANCH | — |
| **field_visits.view** | GLOBAL | BRANCH | BRANCH | BRANCH | — | — |
| **field_visits.edit** | — | BRANCH | BRANCH | BRANCH | — | — |
| **branches.view** | GLOBAL | BRANCH | BRANCH | — | — | — |
| **branches.manage** | — | BRANCH | — | — | — | — |
| **jobs.vacancies.view_list** | GLOBAL | — | — | — | — | — |
| **jobs.applications.view_list** | GLOBAL | — | — | — | — | — |
| **jobs.interviews.conduct** | GLOBAL | BRANCH | — | BRANCH | — | — |
| **jobs.training.create** | GLOBAL | BRANCH | BRANCH | BRANCH | — | — |
| **settings.view** | — | — | — | — | — | — |
| **settings.manage** | — | — | — | — | — | — |
| **admin.roles.view** | — | — | — | — | — | — |
| **admin.roles.manage** | — | — | — | — | — | — |
| **admin.system_lists.view** | GLOBAL | BRANCH | — | — | — | — |
| **admin.system_lists.manage** | — | — | — | — | — | — |

> **—** = ما عندو هالصلاحية.  
> **GLOBAL** = شوف كل الفروع.  
> **BRANCH** = شوف فرعك بس.  
> **ASSIGNED** = شوف اللي مسندلك بس.

---

## 5. القرارات المعمارية (Architectural Decisions)

### 5.1 لماذا نفصل "مدير الشركة" عن "مدير النظام"؟

| مدير الشركة | مدير النظام (Super Admin) |
|-------------|---------------------------|
| بيشوف كل التشغيل | بيشوف كل شي |
| بيدير الفروع | بيدير **بنية** النظام |
| ما بيقدر يعدّل الأدوار | بيقدر يعدّل الأدوار والصلاحيات |
| ما بيقدر يعدّل إعدادات النظام | بيقدر يعدّل `system_settings` |
| بيقدر يسند موظفين | بيقدر ينشئ roles جديدة |

### 5.2 لماذا "مدير الفرع" بيقدر يشوف أكتر من فرع؟

لو مدير الفرع عنده `branches.view` + `BRANCH` scope بس → بيشوف فرع واحد (الفرع الحالي بالـ UI).  
لو عنده `branches.view` + `GLOBAL` scope → بيشوف كل الفروع.

**الفرق:** النطاق بيتحكم بالبيانات، مش الدور. نفس الدور "مدير فرع" بيقدر يعطي Global أو BRANCH حسب احتياج الشركة.

### 5.3 لماذا "مشرفة" عندها ASSIGNED على `clients.view`؟

المشرفة بتتعامل مع زباين محددين. ما بيصح تشوف كل زباين الفرع. ASSIGNED بيضمن إنها تشوف بس:
- زباين مسندين لها شخصياً (عبر `client_assignments`)
- زباين مسندين لفريقها (عبر `team_snapshot`)

### 5.4 لماذا "فني" عندها BRANCH على `field_visits.edit`؟

الفني بيقدر يسجّل نتيجة أي زيارة بفريقه، مش بس الزيارات المسندة له. هاد لأن الفريق ممكن يتغير باليوم.

---

## 6. الثغرات والتضاربات (Gaps)

| # | الثغرة | الحل |
|---|--------|------|
| GAP-001 | دور `company_manager` ما موجود بـ `roles` table | لازم ينشأ يدوياً من `/admin/roles` |
| GAP-002 | `sales` (مندوب مبيعات) صلاحياتو محدودة جداً | يحتاج تعريف واضح: بيع + إغلاق |
| GAP-003 | `technical_as` (فني صيانة تركيب) صلاحياتو 0 | يا إما نحذف الدور يا نعطي صلاحيات |
| GAP-004 | `trainee` بس `planning.schedule.appear` | محتاج صلاحية مرافقة (shadow) |
| GAP-005 | ما في صلاحية `clients.installments.view` | لازم تضاف للـ `permissions` table |
| GAP-006 | ما في صلاحية `reports.view` | لازم تضاف للأدوار الإدارية |

---

## 7. عقد API (API Contract)

### 7.1 endpoints الرئيسية

| Method | Path | الصلاحية | الوصف |
|--------|------|----------|-------|
| GET | `/api/admin/roles` | `admin.roles.view` | قائمة الأدوار |
| GET | `/api/admin/roles/:id/permissions` | `admin.roles.view` | صلاحيات الدور |
| PUT | `/api/admin/roles/:id/permissions` | `admin.roles.manage` | تعديل صلاحيات الدور |
| GET | `/api/admin/permissions` | `admin.roles.view` | قائمة كل الصلاحيات |
| GET | `/api/admin/permissions/scopes` | `admin.roles.view` | النطاقات الممكنة |
| GET | `/api/admin/hr-users` | `admin.roles.view` | الموظفين |
| POST | `/api/admin/hr-users` | `admin.roles.manage` | إنشاء موظف |
| PUT | `/api/admin/hr-users/:id` | `admin.roles.manage` | تعديل موظف |

---

## 8. تاريخ التغييرات (Schema Changelog)

| التاريخ | التغيير | الملف |
|---------|---------|-------|
| 2026-05-02 | Seed أولي للأدوار + صلاحيات | `migrations/001_initial_schema.sql` |
| 2026-05-02 | `CUSTOMER_SERVICE_SUPERVISOR` | `migrations/033_customer_service_supervisor_role_seed.sql` |
| 2026-05-03 | `technical` + `telemarketer` | `migrations/062_roles_team_slot_type.sql` |
| 2026-05-04 | `technical_as` | `migrations/062_roles_team_slot_type.sql` |
| 2026-05-11 | `hr_assistant` | `migrations/059_recruitment_permissions_complete.sql` |
| 2026-05-24 | `trainee` + `sales` | `migrations/062_roles_team_slot_type.sql` |
| 2026-06-02 | `hr_manager` | Seed يدوي |
| 2026-06-06 | توثيق الأدوار بالدستور | `domains/roles-and-permissions.md` |

---

## 9. المراجع

- `domains/permissions.md` — تفاصيل `permissions` table
- `domains/clients.md` — كيف الإسناد بيشتغل (`client_assignments`)
- `domains/planning.md` — جدولة الفرق والـ `team_snapshot`
- `domains/telemarketing.md` — `contact_targets` والنطاق
- `plans/permissions-view-strategy.md` — خطة العرض والنطاق (ملف منفصل)
- `decisions/DEC-005-contact-targets-filter.md` — النطاق الجغرافي
