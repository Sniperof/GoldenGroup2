# أعمال معلّقة غير مجدولة — Pending Work

> نُقلت هذه البنود **حرفياً** من قسم «المهام المعلّقة» في الفهرس القديم (`INDEX.md`) بتاريخ 2026-09-29.
> ⚠️ كُتبت في حزيران 2026 وتحتاج تحققاً من صلاحيتها قبل التنفيذ: البند الأول يذكر `telemarketing_appointments` (جدول مقرر حذفه — [TD-001](./tech-debt.md))، والبند الثاني قد يكون متجاوزاً بـ [DEC-007](../decisions/DEC-007-visit-structure-list-and-survey.md) (`referral_sheets` بدل `visit_name_collections`). أرقام الـ migrations المقترحة فيها (176، 177) قديمة.

---

### 🔴 توحيد Mini ClientSnapshot عبر المشروع

> **الحالة:** ⏳ لم يُنفّذ | **الملف:** [archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md](../../archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT.md) | **البرومptz:** [archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md](../../archive/prompts/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md)

**الهدف:** تطبيق Mini ClientSnapshot الموحّد على كل الأماكن يلي بيعرضو بيانات الزبون بشكل مختصر.

**الأماكن المستهدفة:**
| # | الجدول | الـ migration | الـ Frontend | ملاحظات |
|---|---|---|---|---|
| 1 | `contracts` | `ADD client_snapshot JSONB` | جدول العقود | `customer_name` flat → `clientSnapshot` |
| 2 | `emergency_tickets` | `ADD client_snapshot JSONB` | صفحة الطوارئ | `client_name` + `client_address` flat → `clientSnapshot` |
| 3 | `telemarketing_appointments` | `ADD client_id + client_snapshot JSONB` | صفحة المواعيد | `customer_name` flat → `clientSnapshot` |
| 4 | `field_visits` | `UPDATE customer_snapshot shape` | VDP (Visit Detail Page) | `customer_snapshot` موجود بس مش موحّد |

**الـ Migration المقترحة:** `migrations/176_add_client_snapshots.sql`

---

### 🟠 بيانات الأسماء المقترحة ولوائح الأسماء

> **الحالة:** ⏳ لم يُنفّذ | **الملف:** [archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md](../../archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS.md) | **البرومptz:** [archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md](../../archive/prompts/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md)

**الهدف:** تحسين تجربة جمع الأسماء (Name Collections) والترشيحات المباشرة (Direct Suggestions) ولوائح الأسماء (Referral Sheets) بحيث كل اسم مقترح يصير له MiniClientSnapshot.

**الكيانات الثلاثة:**
| # | الكيان | الحالة الحالية | المطلوب |
|---|---|---|---|
| 1 | `visit_name_collections` | `client_id` موجود بس ما في `client_snapshot` | أضف `client_snapshot JSONB` + اعرض MiniClientSnapshot بالمودال |
| 2 | `direct_suggestions` | بس `name` + `phone` — معزولة | أضف `suggester_snapshot JSONB` + ربط تلقائي بـ `clients` |
| 3 | `referral_sheets` | `source_client_id` موجود بس ما في `snapshot` | أضف `source_client_snapshot JSONB` + قائمة المرشحين |

**الميزات الجديدة:**
- عرض الزبون (المجمع) بـ MiniClientSnapshot داخل NameCollectionModal
- قائمة الأسماء المجمّعة بأرقام تلفوناتها
- زر "تحويل لمرشح" (Convert to Candidate) للترشيحات المباشرة
- التحويل التلقائي من NameCollections → Candidates لما `actual_count >= proposed_count`

**الـ Migration المقترحة:** `migrations/177_name_collections_snapshots.sql`

---

### 🔵 المستوى الثالث: Full ClientSnapshot

> **الحالة:** ⏳ لم يُبدأ بعد | **موقع التوثيق:** [components/client-snapshot.md §المستوى الثالث](../components/client-snapshot.md#المستوى-الثالث-full-snapshot)

**الحقول الإضافية (فوق Standard):**
- الجنس (`gender`)
- الرقم الوطني (`nationalId`)
- تاريخ الميلاد (`birthDate`)
- اسم الأم (`motherName`)
- معلومات السجل المدني
- ملاحظات عامة (`notes`)
- Source channel (`sourceChannel`)
- تاريخ التسجيل + مسجّل من قبل مين
- Referral sheet مربوطة

**السياقات:**
- Client Detail Page
- Contract Creation (review step)
- Referral Sheet Detail
