&#x20;تقرير P1 — Production Schema Alignment Plan



&#x20; التاريخ: 2026-04-25 | الحالة: READ-ONLY — تخطيط فقط



&#x20; ---

&#x20; 1) فحص Migrations الموجودة في الـ Repo



&#x20; migrations/ — 32 ملفاً (بعض الأرقام مكررة)

&#x20; ───────────────────────────────────────────────

&#x20; 001\_core\_tables.sql                            ✓ Applied

&#x20; 002\_job\_tables.sql                             ✓ Applied

&#x20; 003\_hr\_rbac\_tables.sql                         ✓ Applied

&#x20; 004\_column\_additions.sql                       ✓ Applied

&#x20; 005\_constraints\_cleanup.sql                    ✓ Applied

&#x20; 006\_seed\_system\_lists.sql                      ✓ Applied

&#x20; 007\_candidates\_missing\_columns.sql             ✓ Applied

&#x20; 008\_spouse\_occupation.sql                      ✓ Applied (as id=10)

&#x20; 009\_data\_quality.sql                           ✓ Applied (as id=11)

&#x20; 010\_client\_gender.sql                          ○ PENDING

&#x20; 011\_client\_contract\_fields.sql                 ○ PENDING

&#x20; 012\_job\_title\_role\_link.sql                    ○ PENDING

&#x20; 013\_multi\_branch\_identity.sql                  ○ PENDING ⚠️ MAJOR

&#x20; 014\_branch\_id\_domain\_tables.sql                ○ PENDING ⚠️ MAJOR

&#x20; 015\_role\_templates\_seed.sql                    ○ PENDING ⚠️ MAJOR

&#x20; 016\_departments.sql                            ○ PENDING

&#x20; 017\_employee\_profiles.sql                      ○ PENDING ⚠️ CONFLICT (رقم مكرر)

&#x20; 017\_employees\_extended\_profile.sql             ○ PENDING ⚠️ CONFLICT (رقم مكرر)

&#x20; 018\_job\_vacancies\_department.sql               ○ PENDING

&#x20; 019\_authorization\_schema\_preparation.sql       ○ PENDING ⚠️ MAJOR

&#x20; 020\_role\_model\_conflict\_cleanup.sql            ○ PENDING

&#x20; 021\_candidates\_authorization\_enablement.sql    ○ PENDING

&#x20; 022\_referral\_sheets\_authorization\_foundation.  ○ PENDING

&#x20; 023\_referral\_sheets\_ownership\_normalization.   ○ PENDING

&#x20; 024\_clients\_permissions\_seeding.sql            ○ PENDING

&#x20; 025\_clients\_role\_grants\_refinement.sql         ○ PENDING ⚠️ خطرة

&#x20; 026\_contracts\_tasks\_permissions\_seeding.sql    ○ PENDING

&#x20; 027\_contracts\_tasks\_departments\_permissions.   ○ PENDING

&#x20; 028\_user\_branch\_assignment\_permissions.sql     ○ PENDING

&#x20; 029\_system\_admin\_role\_protection.sql           ○ PENDING ⚠️ MAJOR

&#x20; 030\_central\_admin\_permissions\_seeding.sql      ○ PENDING

&#x20; 031\_clients\_assigned\_hr\_user\_id.sql            ○ PENDING ⚠️ CONFLICT (رقم مكرر)

&#x20; 031\_job\_applications\_branch\_backfill.sql       ○ PENDING ⚠️ CONFLICT (رقم مكرر)

&#x20; 032\_interviewer\_assignment\_and\_conduct.sql     ○ PENDING



&#x20; ---

&#x20; 2) Migrations المطبقة على Production



&#x20; آخر migration مطبقة:



&#x20; id=11 | 009\_data\_quality.sql | applied: 2026-04-19



&#x20; ⚠️ تحذير: ملفان مطبقان لا يوجدان في الـ repo الحالي



&#x20; ┌──────────────────────────────┬────────────────────────────────┐

&#x20; │    Applied in production     │       في الـ repo الحالي       │

&#x20; ├──────────────────────────────┼────────────────────────────────┤

&#x20; │ 008\_syrian\_geo\_data.sql      │ غير موجود — ربما أُعيدت تسميته │

&#x20; ├──────────────────────────────┼────────────────────────────────┤

&#x20; │ 009\_cleanup\_system\_lists.sql │ غير موجود — ربما أُعيدت تسميته │

&#x20; └──────────────────────────────┴────────────────────────────────┘



&#x20; هذه الملفات مطبقة بنجاح (geo data الكاملة 322 منطقة، و system\_lists cleanup). الـ runner يتعقب بالـ filename، لذا لن يُعيد تطبيقها.



&#x20; الـ Migrations الناقصة: 25 migration



&#x20; من 010 إلى 032 (شاملة).



&#x20; ---

&#x20; 3) مقارنة Production Schema مع Target Schema



&#x20; ┌────────────────────────────────┬───────────────────────┬────────────────────┬─────────────────────────────────────────┐

&#x20; │            Feature             │ موجودة في production؟ │ Migration المسؤولة │                  الخطر                  │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ roles.is\_template              │ ❌ لا                 │ 013                │ 🔴 عالٍ — يغيّر كل الـ roles            │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ roles.template\_id              │ ❌ لا                 │ 013                │ 🔴 عالٍ — FK جديد                       │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ roles.branch\_id                │ ❌ لا                 │ 013                │ 🔴 عالٍ — يكسر unique constraint        │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ roles.is\_hidden                │ ❌ لا                 │ 029                │ 🟠 متوسط                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ roles.is\_protected             │ ❌ لا                 │ 029                │ 🟠 متوسط                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ hr\_users.is\_super\_admin        │ ❌ لا                 │ 013                │ 🟠 يجعل sami super admin                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ hr\_users.branch\_id             │ ❌ لا                 │ 013                │ 🟠 nullable — آمن                       │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ user\_branch\_assignments        │ ❌ لا                 │ 019                │ 🟠 جدول جديد — backfill فارغ            │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ role\_permission\_grants         │ ❌ لا                 │ 019                │ 🔴 عالٍ — يغيّر منطق permissions        │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ SYSTEM\_ADMIN role              │ ❌ لا                 │ 029                │ 🟠 إضافة فقط                            │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ clients.branch\_id              │ ❌ لا                 │ 014                │ 🟠 8 clients → غير محدد                 │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ clients.assigned\_hr\_user\_id    │ ❌ لا                 │ 031                │ 🟡 منخفض — nullable                     │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ clients.gender                 │ ❌ لا                 │ 010                │ 🟡 منخفض                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ clients.national\_id            │ ❌ لا                 │ 011                │ 🟡 منخفض                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ employees.branch\_id            │ ❌ لا                 │ 014                │ 🟠 4 موظفين سيُخصَّصون لـ غير محدد خطأً │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ departments table              │ ❌ لا                 │ 016                │ 🟡 جدول جديد                            │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ system\_lists.linked\_role\_id    │ ❌ لا                 │ 012                │ 🟡 منخفض                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ system\_lists.metadata          │ ❌ لا                 │ 016                │ 🟡 منخفض                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ employees\_role\_check (DROP)    │ ✅ موجود (بعد)        │ 012                │ 🟡 إزالة constraint — آمن               │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ job\_vacancies.branch\_id        │ ❌ لا                 │ 014                │ 🟡 6/7 vacancies ستُحوَّل صح            │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ job\_applications.branch\_id     │ ❌ لا                 │ 014                │ 🟡 منخفض                                │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ referral\_sheets.branch\_id      │ ❌ لا                 │ 022                │ 🟡 backfill فارغ (لا users assignments) │

&#x20; ├────────────────────────────────┼───────────────────────┼────────────────────┼─────────────────────────────────────────┤

&#x20; │ interviews.interviewer\_user\_id │ ❌ لا                 │ 032                │ 🟡 منخفض                                │

&#x20; └────────────────────────────────┴───────────────────────┴────────────────────┴─────────────────────────────────────────┘



&#x20; ---

&#x20; 4) تقييم مخاطر تطبيق Migrations



&#x20; 🔴 مخطر 1: الـ Migration Runner يُوقف عند أول خطأ



&#x20; migrate.ts يُشغّل migrations بشكل تسلسلي وإذا فشل واحد process.exit(1). يعني فشل مبكر في 013 سيمنع تطبيق كل شيء بعده.



&#x20; 🔴 مخطر 2: Migration 014 — 4 موظفين سيُخصَّصون لفرع "غير محدد" خطأً



&#x20; employees.branch = 'طرطوس' (4 موظفين)  ≠  branches.name = 'فرع طرطوس'



&#x20; Migration 014 تبحث عن b.name = TRIM(e.branch). القيمة 'طرطوس' لا تساوي 'فرع طرطوس'. النتيجة: 4 موظفين من طرطوس سيحصلون على branch\_id = \[id of 'غير

&#x20;  محدد'] بدلاً من فرع طرطوس.



&#x20; يجب حل هذا قبل تطبيق migration 014.



&#x20; 🔴 مخطر 3: Migration 015 — انفجار Roles Table



&#x20; بعد migration 013، كل الـ 9 roles الحالية تصبح templates. Migration 015 تستنسخها إلى كل فرع:



&#x20; 3 branches × 9 templates = 27 clone roles

&#x20; + 9 templates = 36 roles total (من 9 إلى 36)



&#x20; هذا يؤثر على:

&#x20; - أي UI يعرض قائمة roles

&#x20; - أي query لا تُفلتر على is\_template

&#x20; - دالة clone\_role\_templates\_to\_branch تصبح متاحة كـ PostgreSQL function



&#x20; 🔴 مخطر 4: Migration 025 — قطع صلاحيات samia



&#x20; Migration 025 تبدأ بـ حذف كل role\_permission\_grants المتعلقة بـ clients.\* من كل الـ templates، ثم تُعيد الإضافة فقط لـ roles بأسماء محددة:



&#x20; ADMIN, BRANCH\_MANAGER, HR\_MANAGER, SALES, TELEMARKETER, TECHNICIAN, ACCOUNTANT



&#x20; job\_title\_2546 (role samia) غير موجود في هذه القائمة.



&#x20; النتيجة: بعد migration 025، samia ستفقد كل صلاحيات clients.\* إذا اعتمد الـ runtime على role\_permission\_grants.



&#x20; 🟠 مخطر 5: migration 013 — admin لن يصبح super admin



&#x20; Migration 013:

&#x20; UPDATE hr\_users SET is\_super\_admin = TRUE WHERE role = 'ADMIN'



&#x20; - sami: role = 'ADMIN' → سيصبح super admin ✓

&#x20; - admin: role = 'admin' (lowercase) → لن يصبح super admin ⚠️



&#x20; إذا كان الكود بعد migration 013 يتحقق من is\_super\_admin بدلاً من role = 'admin'، فإن المستخدم admin قد يفقد صلاحياته الكاملة.



&#x20; 🟠 مخطر 6: Migration 019 — user\_branch\_assignments تبدأ فارغة



&#x20; الـ backfill:

&#x20; INSERT INTO user\_branch\_assignments (user\_id, branch\_id, ...)

&#x20; SELECT u.id, u.branch\_id ... FROM hr\_users u WHERE u.branch\_id IS NOT NULL



&#x20; لكن hr\_users.branch\_id يُضاف في migration 013 كـ NULL لكل المستخدمين ولا تُملأ تلقائياً. نتيجة: كل الـ 3 مستخدمين سيكون لديهم

&#x20; user\_branch\_assignments فارغة.



&#x20; إذا كان الـ runtime authorization يعتمد على هذا الجدول لتحديد الوصول، سيُحجب المستخدمون عن الفروع حتى يُضاف لهم assignments يدوياً.



&#x20; 🟡 مخطر 7: الـ Migration runner يُرتّب بـ lexicographic sort



&#x20; الملفات المكررة الأرقام ستُطبَّق بهذا الترتيب:

&#x20; 017\_employee\_profiles.sql              (أولاً - حرف e < حرف e)

&#x20; 017\_employees\_extended\_profile.sql     (ثانياً - extended > profiles)

&#x20; 031\_clients\_assigned\_hr\_user\_id.sql    (أولاً - clients < job)

&#x20; 031\_job\_applications\_branch\_backfill.  (ثانياً)



&#x20; الـ IF NOT EXISTS في 017 تحمي من الفشل — الثانية ستكون no-op للأعمدة المكررة. الـ 031 كلاهما لا يتعارضان.



&#x20; 🟡 مخطر 8: constraints على system\_lists (category, value)



&#x20; Migration 016 تُضيف department\_type items بـ:

&#x20; ON CONFLICT (category, value) DO NOTHING



&#x20; هذا يفترض وجود unique constraint على (category, value). يجب التحقق.



&#x20; ---

&#x20; 5) خطة الترقية الآمنة — P1A إلى P1G



&#x20; ---

&#x20; ✅ P1A — Backup (قبل أي شيء)



&#x20; Queries التحقق قبل:

&#x20; -- عدد الجداول والبيانات الحالية

&#x20; SELECT schemaname, tablename, n\_live\_tup

&#x20; FROM pg\_stat\_user\_tables ORDER BY n\_live\_tup DESC;



&#x20; -- snapshot المستخدمين والـ roles

&#x20; SELECT u.id, u.username, u.role, u.role\_id, r.name AS role\_name

&#x20; FROM hr\_users u LEFT JOIN roles r ON r.id=u.role\_id;



&#x20; الخطوات:

&#x20; # 1. Backup كامل للقاعدة

&#x20; PGPASSWORD='...' pg\_dump -U postgres -h localhost golden\_crm\_db \\

&#x20;   -F c -f /var/backups/golden\_crm\_db\_P1\_$(date +%Y%m%d\_%H%M%S).dump



&#x20; # 2. تحقق من الـ backup

&#x20; pg\_restore --list /var/backups/golden\_crm\_db\_P1\_\*.dump | wc -l



&#x20; Queries التحقق بعد:

&#x20; -- تأكيد Backup بحجم معقول (يجب أن يكون > 0)

&#x20; \\! ls -lh /var/backups/golden\_crm\_db\_P1\_\*.dump



&#x20; ---

&#x20; ✅ P1B — Pre-Migration Data Fix (قبل تشغيل migrations)



&#x20; المشكلة: 4 موظفين بـ branch='طرطوس' لن يُطابق 'فرع طرطوس' في migration 014.



&#x20; Queries التحقق قبل:

&#x20; -- تأكيد المشكلة

&#x20; SELECT id, name, branch FROM employees WHERE branch = 'طرطوس';

&#x20; -- Expected: 4 rows



&#x20; التحضير (يجب تنفيذه قبل run migrations):

&#x20; -- هذا الـ UPDATE الوحيد المسموح به في P1B

&#x20; -- يُصحح قيمة branch لتتطابق مع branches.name

&#x20; UPDATE employees

&#x20; SET branch = 'فرع طرطوس'

&#x20; WHERE branch = 'طرطوس';



&#x20; Queries التحقق بعد:

&#x20; -- يجب ألا يبقى أي موظف بقيمة 'طرطوس'

&#x20; SELECT id, name, branch FROM employees WHERE branch = 'طرطوس';

&#x20; -- Expected: 0 rows



&#x20; SELECT DISTINCT branch FROM employees;

&#x20; -- Expected: {فرع دمشق, فرع طرطوس}



&#x20; ---

&#x20; ✅ P1C — تشغيل Migrations 010–013 (Structural Only)



&#x20; Scope: 010, 011, 012, 013 — لا تُغيّر بيانات تشغيلية، فقط schema وأعمدة.



&#x20; Queries التحقق قبل:

&#x20; -- تأكيد الأعمدة غير موجودة

&#x20; SELECT column\_name FROM information\_schema.columns

&#x20; WHERE table\_name='roles' AND column\_name IN ('is\_template','branch\_id','template\_id');

&#x20; -- Expected: 0 rows



&#x20; SELECT column\_name FROM information\_schema.columns

&#x20; WHERE table\_name='hr\_users' AND column\_name='is\_super\_admin';

&#x20; -- Expected: 0 rows



&#x20; تشغيل:

&#x20; cd /opt/golden-crm/app/GoldenGroup2

&#x20; # الـ runner يُطبّق فقط الـ pending — سيُطبّق 010, 011, 012, 013

&#x20; # لكن لا نريد تطبيق 014+ الآن

&#x20; # الحل: تشغيل migrations يدوياً واحدة واحدة

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/010\_client\_gender.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/011\_client\_contract\_fields.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/012\_job\_title\_role\_link.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/013\_multi\_branch\_identity.sql



&#x20; ثم تسجيلها يدوياً في schema\_migrations:

&#x20; INSERT INTO schema\_migrations (filename) VALUES

&#x20;   ('010\_client\_gender.sql'),

&#x20;   ('011\_client\_contract\_fields.sql'),

&#x20;   ('012\_job\_title\_role\_link.sql'),

&#x20;   ('013\_multi\_branch\_identity.sql')

&#x20; ON CONFLICT (filename) DO NOTHING;



&#x20; Queries التحقق بعد 013:

&#x20; -- roles كلها أصبحت templates

&#x20; SELECT id, name, is\_template, branch\_id FROM roles ORDER BY id;

&#x20; -- Expected: كل الـ 9 roles بـ is\_template=TRUE, branch\_id=NULL



&#x20; -- sami أصبح super\_admin

&#x20; SELECT id, username, role, is\_super\_admin FROM hr\_users ORDER BY id;

&#x20; -- Expected: sami (role=ADMIN) → is\_super\_admin=TRUE

&#x20; --           admin (role=admin) → is\_super\_admin=FALSE  ← تحقق!



&#x20; -- constraint موجود

&#x20; SELECT conname FROM pg\_constraint

&#x20; WHERE conrelid='roles'::regclass AND conname='roles\_scope\_ck';



&#x20; -- unique index جديد

&#x20; SELECT indexname FROM pg\_indexes WHERE tablename='roles' AND indexname='roles\_name\_branch\_uk';



&#x20; ---

&#x20; ✅ P1D — تشغيل Migration 014 (Branch ID على كل الجداول)



&#x20; Queries التحقق قبل:

&#x20; -- التأكد أن مشكلة 'طرطوس' محلولة من P1B

&#x20; SELECT COUNT(\*) FROM employees WHERE branch = 'طرطوس';

&#x20; -- Expected: 0



&#x20; -- التأكد من أسماء الفروع الحالية

&#x20; SELECT id, name FROM branches;

&#x20; -- Expected: {1: فرع دمشق, 2: فرع طرطوس}



&#x20; تشغيل:

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/014\_branch\_id\_domain\_tables.sql



&#x20; Queries التحقق بعد:

&#x20; -- فرع غير محدد أُضيف

&#x20; SELECT id, name, status FROM branches ORDER BY id;

&#x20; -- Expected: 3 rows (دمشق, طرطوس, غير محدد)



&#x20; -- employees: التحقق من التوزيع الصحيح

&#x20; SELECT b.name, COUNT(e.id) AS emp\_count

&#x20; FROM employees e JOIN branches b ON b.id=e.branch\_id

&#x20; GROUP BY b.name ORDER BY emp\_count DESC;

&#x20; -- Expected: فرع دمشق=3, فرع طرطوس=6 (2+4 بعد P1B fix), غير محدد=0



&#x20; -- clients: كلهم في غير محدد (لا legacy branch column)

&#x20; SELECT b.name, COUNT(c.id) FROM clients c JOIN branches b ON b.id=c.branch\_id GROUP BY b.name;

&#x20; -- Expected: غير محدد=8



&#x20; -- job\_vacancies: التحقق من mapping صحيح

&#x20; SELECT b.name, v.branch AS legacy, COUNT(\*) FROM job\_vacancies v

&#x20; JOIN branches b ON b.id=v.branch\_id GROUP BY b.name, v.branch;

&#x20; -- Expected: فرع دمشق ← فرع دمشق (5), فرع طرطوس ← فرع طرطوس (2)



&#x20; ---

&#x20; ✅ P1E — تشغيل Migrations 015–018 (Roles Cloning + Departments)



&#x20; ملاحظة: Migration 015 ستُنشئ 27 role clone جديدة (9 templates × 3 branches).



&#x20; Queries التحقق قبل:

&#x20; SELECT COUNT(\*) FROM roles;

&#x20; -- Expected: 9



&#x20; تشغيل:

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/015\_role\_templates\_seed.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/016\_departments.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/017\_employee\_profiles.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/017\_employees\_extended\_profile.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/018\_job\_vacancies\_department.sql



&#x20; Queries التحقق بعد:

&#x20; -- roles: 9 templates + 27 clones = 36

&#x20; SELECT is\_template, COUNT(\*) FROM roles GROUP BY is\_template;

&#x20; -- Expected: TRUE=9, FALSE=27



&#x20; -- clones لكل فرع

&#x20; SELECT b.name, COUNT(r.id) AS clone\_count

&#x20; FROM roles r JOIN branches b ON b.id=r.branch\_id

&#x20; GROUP BY b.name;

&#x20; -- Expected: 3 rows, كل فرع 9 clones



&#x20; -- departments table موجودة

&#x20; SELECT COUNT(\*) FROM information\_schema.tables WHERE table\_name='departments';



&#x20; ---

&#x20; ✅ P1F — تشغيل Migration 019 (Authorization Tables)



&#x20; هذه نقطة التحول الكبيرة — تُنشئ user\_branch\_assignments وrole\_permission\_grants.



&#x20; Queries التحقق قبل:

&#x20; SELECT table\_name FROM information\_schema.tables

&#x20; WHERE table\_name IN ('user\_branch\_assignments','role\_permission\_grants');

&#x20; -- Expected: 0 rows



&#x20; تشغيل:

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/019\_authorization\_schema\_preparation.sql



&#x20; Queries التحقق بعد:

&#x20; -- الجداول أُنشئت

&#x20; SELECT table\_name FROM information\_schema.tables

&#x20; WHERE table\_name IN ('user\_branch\_assignments','role\_permission\_grants');

&#x20; -- Expected: 2 rows



&#x20; -- user\_branch\_assignments فارغة (لأن hr\_users.branch\_id=NULL للجميع)

&#x20; SELECT COUNT(\*) FROM user\_branch\_assignments;

&#x20; -- Expected: 0 — ⚠️ يعني لا أحد معيّن لأي فرع بعد



&#x20; -- role\_permission\_grants مملوءة من role\_permissions

&#x20; SELECT COUNT(\*) FROM role\_permission\_grants;

&#x20; -- Expected: عدد كبير (كل templates وclones لها grants)



&#x20; SELECT r.name, r.is\_template, COUNT(rpg.id) AS grant\_count

&#x20; FROM roles r

&#x20; LEFT JOIN role\_permission\_grants rpg ON rpg.role\_id=r.id

&#x20; WHERE r.is\_template=TRUE

&#x20; GROUP BY r.id ORDER BY grant\_count DESC;



&#x20; ---

&#x20; ✅ P1G — تشغيل Migrations 020–024 (Cleanup + Permissions)



&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/020\_role\_model\_conflict\_cleanup.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/021\_candidates\_authorization\_enablement.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/022\_referral\_sheets\_authorization\_foundation.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/023\_referral\_sheets\_ownership\_normalization.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/024\_clients\_permissions\_seeding.sql



&#x20; تخطّى migration 025 مؤقتاً — انظر الملاحظة الحمراء أدناه.



&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/026\_contracts\_tasks\_permissions\_seeding.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/027\_contracts\_tasks\_departments\_permissions\_seeding.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/028\_user\_branch\_assignment\_permissions\_seeding.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/029\_system\_admin\_role\_protection.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/030\_central\_admin\_permissions\_seeding.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/031\_clients\_assigned\_hr\_user\_id.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/031\_job\_applications\_branch\_backfill.sql

&#x20; PGPASSWORD='...' psql -U postgres -h localhost -d golden\_crm\_db -f migrations/032\_interviewer\_assignment\_and\_conduct\_permission.sql



&#x20; Queries التحقق بعد 029:

&#x20; -- SYSTEM\_ADMIN موجود

&#x20; SELECT id, name, is\_system, is\_protected, is\_hidden, is\_template, branch\_id

&#x20; FROM roles WHERE name='SYSTEM\_ADMIN';

&#x20; -- Expected: 1 row, is\_protected=TRUE, is\_hidden=TRUE, is\_template=TRUE, branch\_id=NULL



&#x20; -- SYSTEM\_ADMIN لديه كل الـ 62 permissions (61 قديمة + 1 جديدة من 032)

&#x20; SELECT COUNT(\*) FROM role\_permission\_grants rpg

&#x20; JOIN roles r ON r.id=rpg.role\_id

&#x20; WHERE r.name='SYSTEM\_ADMIN' AND r.is\_template=TRUE AND r.branch\_id IS NULL;



&#x20; ---

&#x20; ⚠️ Migration 025 — تحتاج قرار منفصل



&#x20; Migration 025 تحذف كل role\_permission\_grants لـ clients.\* ثم تُعيد الإضافة لقائمة أدوار محددة (ADMIN, BRANCH\_MANAGER, SALES...).



&#x20; المشكلة: samia تمتلك role job\_title\_2546 وليس اسماً في تلك القائمة. بعد المigration، ستفقد صلاحيات clients.



&#x20; الخيارات:

&#x20; 1. اعتماد migration 025 كما هي — وقبوله أن samia ستحتاج إعادة تعيين role جديدة بعدها

&#x20; 2. تعديل migration 025 قبل تطبيقها لإضافة role pattern بدلاً من أسماء hardcoded

&#x20; 3. تطبيقها وتعيين user\_branch\_assignment + role جديد لـ samia يدوياً بعدها



&#x20; ---

&#x20; 6) ربط المستخدمين بالفروع (P1E — User Branch Assignments)



&#x20; بعد تطبيق migration 019، يجب إضافة assignments يدوياً:



&#x20; Queries التحقق قبل:

&#x20; SELECT id, username, role, branch\_id FROM hr\_users;

&#x20; -- Expected: كل branch\_id=NULL



&#x20; Statements الإضافة (بعد P1F):

&#x20; -- sami: مدير النظام — GLOBAL (لا تعيين لفرع محدد يعني GLOBAL)

&#x20; -- admin: كذلك



&#x20; -- samia: مرتبطة بفرع دمشق (نفترض بناءً على السياق — يجب التأكيد)

&#x20; INSERT INTO user\_branch\_assignments (user\_id, branch\_id, is\_primary, status)

&#x20; SELECT u.id, b.id, TRUE, 'active'

&#x20; FROM hr\_users u, branches b

&#x20; WHERE u.username='samia' AND b.name='فرع دمشق'

&#x20; ON CONFLICT (user\_id, branch\_id) DO NOTHING;



&#x20; ⚠️ ملاحظة: قبل إضافة assignments لـ samia، يجب تأكيد أي فرع تتبعه فعلياً من الإدارة.



&#x20; ---

&#x20; 7) إجابات الأسئلة الاستراتيجية



&#x20; ---

&#x20; 1. هل migrations الجديدة مطبقة على production؟



&#x20; لا. آخر migration مطبقة هي 009\_data\_quality.sql بتاريخ 2026-04-19. 25 migration من 010 إلى 032 لم تُطبَّق بعد.



&#x20; ---

&#x20; 2. ما الفجوة بين production واللوكال؟



&#x20; الفجوة كبيرة جداً:

&#x20; - 6 أعمدة ناقصة على roles (is\_template, branch\_id, template\_id, is\_protected, is\_hidden, protected\_reason)

&#x20; - 2 أعمدة ناقصة على hr\_users (is\_super\_admin, branch\_id)

&#x20; - 2 جداول رئيسية غير موجودة (user\_branch\_assignments, role\_permission\_grants)

&#x20; - branch\_id ناقص على 11 جدول تشغيلي

&#x20; - SYSTEM\_ADMIN role غير موجودة

&#x20; - departments table غير موجودة

&#x20; - عشرات الـ permissions الجديدة غير موجودة في role\_permission\_grants



&#x20; ---

&#x20; 3. ما migrations يجب تطبيقها؟



&#x20; كلها (010–032) بالترتيب الموضح في الخطة، ماعدا 025 التي تحتاج قراراً.



&#x20; ---

&#x20; 4. ما migrations قد تكون خطرة؟



&#x20; ┌───────────┬───────────────────────────────────────────────────────────────────────────────────┐

&#x20; │ Migration │                                       الخطر                                       │

&#x20; ├───────────┼───────────────────────────────────────────────────────────────────────────────────┤

&#x20; │ 013       │ يُحوّل كل roles إلى templates — يغيّر منطق الـ authorization إذا كان الكود يُفرّق │

&#x20; ├───────────┼───────────────────────────────────────────────────────────────────────────────────┤

&#x20; │ 014       │ 4 موظفين سيُخصَّصون لفرع خاطئ إذا لم يُصحَّح 'طرطوس' → 'فرع طرطوس' أولاً          │

&#x20; ├───────────┼───────────────────────────────────────────────────────────────────────────────────┤

&#x20; │ 015       │ ينفجر عدد الـ roles من 9 إلى 36                                                   │

&#x20; ├───────────┼───────────────────────────────────────────────────────────────────────────────────┤

&#x20; │ 019       │ user\_branch\_assignments تبدأ فارغة — قد يُحجب المستخدمون                          │

&#x20; ├───────────┼───────────────────────────────────────────────────────────────────────────────────┤

&#x20; │ 025       │ تحذف permissions لـ clients.\* وتُعيدها بقائمة صارمة — samia ستفقد وصولها          │

&#x20; └───────────┴───────────────────────────────────────────────────────────────────────────────────┘



&#x20; ---

&#x20; 5. ما البيانات التي تحتاج backfill؟



&#x20; ┌────────────────────────────────────────┬─────────────────────────────────────────────────────┐

&#x20; │                البيانات                │                        الحل                         │

&#x20; ├────────────────────────────────────────┼─────────────────────────────────────────────────────┤

&#x20; │ employees.branch = 'طرطوس' (4 موظفين)  │ UPDATE يدوي قبل migration 014                       │

&#x20; ├────────────────────────────────────────┼─────────────────────────────────────────────────────┤

&#x20; │ user\_branch\_assignments للمستخدمين     │ INSERT يدوي بعد migration 019                       │

&#x20; ├────────────────────────────────────────┼─────────────────────────────────────────────────────┤

&#x20; │ clients.branch\_id = غير محدد (8 عملاء) │ مراجعة يدوية لاحقة — لا backfill تلقائي             │

&#x20; ├────────────────────────────────────────┼─────────────────────────────────────────────────────┤

&#x20; │ referral\_sheets.branch\_id (12 ورقة)    │ تبقى NULL — لا backfill بدون user assignments أولاً │

&#x20; └────────────────────────────────────────┴─────────────────────────────────────────────────────┘



&#x20; ---

&#x20; 6. هل يمكن ترقية production بدون downtime طويل؟



&#x20; نعم، لكن بشرط:



&#x20; - جميع الـ migrations additive (ADD COLUMN, CREATE TABLE) — لا تغيّر بيانات قائمة بشكل مدمّر

&#x20; - وقت التطبيق المتوقع: 5–15 دقيقة

&#x20; - الخطوة الوحيدة التي تتطلب توقف النظام: migration 015 (clone 27 roles) + migration 019 (إنشاء role\_permission\_grants) لأن الـ app قد يقرأ

&#x20; permissions في منتصف العملية



&#x20; التوصية: تطبيق بـ maintenance window قصير (15 دقيقة) أثناء ساعات الذروة المنخفضة.



&#x20; ---

&#x20; 7. ما الخطة التنفيذية الآمنة بالترتيب؟



&#x20; P1A: Backup الكامل                           \[ضروري]

&#x20; P1B: إصلاح employees.branch = 'فرع طرطوس'   \[قبل migrations]

&#x20; P1C: تطبيق 010-013 (schema only)            \[آمن]

&#x20; P1D: تطبيق 014 (branch\_id)                  \[بعد P1B)

&#x20; P1E: تطبيق 015-018 (clones + departments)   \[وقت ترقية]

&#x20; P1F: تطبيق 019 (auth tables)                \[نقطة التحول]

&#x20; P1G: تطبيق 020-024, 026-032                 \[تدريجي]

&#x20;      → تخطّي 025 حتى قرار samia

&#x20; P1H: إضافة user\_branch\_assignments يدوياً   \[بعد P1F]

&#x20; P1I: قرار migration 025 + تطبيقها           \[آخر خطوة]



&#x20; ---

&#x20; 8. Queries التحقق الشاملة (Pre/Post)



&#x20; -- ===== PRE-MIGRATION SNAPSHOT =====

&#x20; SELECT 'roles\_count' AS metric, COUNT(\*)::TEXT AS value FROM roles

&#x20; UNION ALL

&#x20; SELECT 'hr\_users\_count', COUNT(\*)::TEXT FROM hr\_users

&#x20; UNION ALL

&#x20; SELECT 'permissions\_count', COUNT(\*)::TEXT FROM permissions

&#x20; UNION ALL

&#x20; SELECT 'role\_permissions\_count', COUNT(\*)::TEXT FROM role\_permissions

&#x20; UNION ALL

&#x20; SELECT 'employees\_count', COUNT(\*)::TEXT FROM employees

&#x20; UNION ALL

&#x20; SELECT 'clients\_count', COUNT(\*)::TEXT FROM clients

&#x20; UNION ALL

&#x20; SELECT 'branches\_count', COUNT(\*)::TEXT FROM branches;



&#x20; -- ===== POST-MIGRATION VERIFICATION =====

&#x20; -- 1. Schema integrity

&#x20; SELECT column\_name FROM information\_schema.columns

&#x20; WHERE table\_name='roles'

&#x20; ORDER BY ordinal\_position;



&#x20; -- 2. SYSTEM\_ADMIN exists and protected

&#x20; SELECT name, is\_system, is\_protected, is\_hidden, is\_template

&#x20; FROM roles WHERE name='SYSTEM\_ADMIN';



&#x20; -- 3. Users not locked out

&#x20; SELECT u.id, u.username, u.role, u.is\_super\_admin,

&#x20;        u.branch\_id, u.role\_id,

&#x20;        r.name AS role\_name, r.is\_template

&#x20; FROM hr\_users u LEFT JOIN roles r ON r.id=u.role\_id;



&#x20; -- 4. User branch assignments

&#x20; SELECT u.username, b.name AS branch, uba.is\_primary, uba.status

&#x20; FROM user\_branch\_assignments uba

&#x20; JOIN hr\_users u ON u.id=uba.user\_id

&#x20; JOIN branches b ON b.id=uba.branch\_id;



&#x20; -- 5. samia still has permissions after migration 025

&#x20; SELECT p.key FROM role\_permission\_grants rpg

&#x20; JOIN roles r ON r.id=rpg.role\_id

&#x20; JOIN permissions p ON p.id=rpg.permission\_id

&#x20; WHERE r.name='job\_title\_2546' AND r.is\_template=TRUE;



&#x20; -- 6. No orphaned branch data

&#x20; SELECT COUNT(\*) AS clients\_without\_branch FROM clients WHERE branch\_id IS NULL;

&#x20; SELECT COUNT(\*) AS employees\_without\_branch FROM employees WHERE branch\_id IS NULL;



&#x20; ---

&#x20; ملخص تنفيذي



&#x20; Production متأخرة بـ 25 migration عن الـ local code.

&#x20; أكبر المخاطر: 3 migrations رئيسية (013, 014, 025).

&#x20; الـ 013 و 014 آمنتان بشرط إصلاح 'طرطوس' أولاً.

&#x20; الـ 025 تحتاج قراراً مستقلاً بشأن صلاحيات samia.

&#x20; الترقية ممكنة بـ downtime لا يتجاوز 15 دقيقة.

&#x20; user\_branch\_assignments ستبدأ فارغة — تحتاج seed يدوي بعدها.

