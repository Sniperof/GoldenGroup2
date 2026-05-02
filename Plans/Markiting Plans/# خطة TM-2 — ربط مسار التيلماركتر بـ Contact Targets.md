\# خطة TM-2 — ربط مسار التيلماركتر بـ Contact Targets



\## 1) Goal Summary



\- ربط \*\*بنيوي\*\* بين `contact\_targets` وكل سجلات التيلماركتر (items, call\_logs, appointments) عبر `contact\_target\_id`.

\- جعل `generate-from-plan` يكتب `contact\_target\_id` على عناصر القائمة من البداية.

\- جعل `call-logs` و `appointments` يستنتجان `contact\_target\_id` من backend (لا من frontend).

\- تحديث lifecycle fields في `contact\_targets` تلقائياً: `latest\_task\_list\_item\_id`, `latest\_call\_outcome`, `latest\_appointment\_id`, `status`.

\- عدم لمس visits أو visit\_type أو الـ workspace UI.



\---



\## 2) Current Code Inspection



\### Schema الحالي



\*\*`contact\_targets`\*\* (\[045](migrations/045\_contact\_targets.sql)):

```

id BIGSERIAL PK, branch\_id, target\_type='client', target\_id, target\_stage='lead',

visit\_type='marketing', source\_type='lead', source\_id,

supervisor\_hr\_user\_id, zone\_id,

status ∈ {new, queued, in\_call\_list, contacted, booked, closed, cancelled},

latest\_call\_outcome VARCHAR(50),

latest\_task\_list\_item\_id INTEGER,    ⚠️ نوع خاطئ

latest\_appointment\_id INTEGER,        ⚠️ نوع خاطئ

created\_at, updated\_at

UNIQUE(branch\_id, target\_type, target\_id, visit\_type, source\_type)

```



\*\*`telemarketing\_task\_list\_items`\*\* (\[001:266](migrations/001\_core\_tables.sql)):

```

id VARCHAR(100) PK,  ← ⚠️ نص، ليس INTEGER

task\_list\_id, entity\_type, entity\_id, name, mobile,

contact\_number, contact\_label, address\_text, geo\_unit\_id,

status ∈ {pending, called, booked}, call\_outcome

```

لا يوجد `contact\_target\_id`، ولا `branch\_id` مباشر.



\*\*`telemarketing\_call\_logs`\*\* (\[001:282](migrations/001\_core\_tables.sql) + \[014:107](migrations/014\_branch\_id\_domain\_tables.sql)):

```

id VARCHAR(100) PK, entity\_type, entity\_id, task\_list\_id VARCHAR(100),

team\_key, outcome, contact\_label, contact\_number, notes,

timestamp, called\_by, communication\_method, branch\_id

```

لا يوجد `task\_list\_item\_id` ولا `contact\_target\_id`.



\*\*`telemarketing\_appointments`\*\* (\[001:298](migrations/001\_core\_tables.sql) + 014):

```

id VARCHAR(100) PK,  ← ⚠️ نص، ليس INTEGER

entity\_type, entity\_id, customer\_\*, team\_key, date, time\_slot,

occupation, water\_source, notes, created\_at, created\_by, branch\_id

```

لا يوجد `task\_list\_item\_id` ولا `contact\_target\_id` ولا `visit\_type` ولا `source\_type/source\_id`.



\### الـ flow الحالي



\- \*\*`generate-from-plan`\*\* (\[telemarketing.ts:197](packages/api/routes/telemarketing.ts:197)): يستلم `date` و `teamKey`، يجلب leads من `getPlanningMarketingTargets` (التي ترجع `contactTargetId` بالفعل من JOIN على `contact\_targets`)، ينشئ items بمعرف `${taskListId}\_client\_${entityId}`، ويحدّث `contact\_targets.status='queued'` لكن \*\*لا يربط `contact\_target\_id` على item\*\*.

\- \*\*`call-logs` POST\*\*: لا يستقبل `itemId` ولا `contactTargetId`. الـ frontend يرسل `entityType/entityId/taskListId` فقط.

\- \*\*`appointments` POST\*\*: نفس الشيء — لا `itemId` ولا `contactTargetId`.

\- \*\*منع التكرار\*\* في `generate-from-plan`: حالياً عبر `entity\_id + branch + date + team\_key <>`. صحيح حالياً لأن lead واحد = contact target واحد، لكن ينبغي تحويله إلى `contact\_target\_id` بعد إضافة العمود.



\### Shared types



\[`packages/shared/types.ts`](packages/shared/types.ts):

\- `TaskListItem` ← لا يحتوي `contactTargetId`

\- `CallLog` ← لا يحتوي `contactTargetId`

\- `Appointment` ← لا يحتوي `contactTargetId`



\---



\## 3) Data Model Proposal



\*\*Migration 047\*\* يضيف:



```sql

ALTER TABLE telemarketing\_task\_list\_items

&#x20; ADD COLUMN contact\_target\_id BIGINT REFERENCES contact\_targets(id) ON DELETE SET NULL;



ALTER TABLE telemarketing\_call\_logs

&#x20; ADD COLUMN contact\_target\_id BIGINT REFERENCES contact\_targets(id) ON DELETE SET NULL;



ALTER TABLE telemarketing\_appointments

&#x20; ADD COLUMN contact\_target\_id BIGINT REFERENCES contact\_targets(id) ON DELETE SET NULL;



CREATE INDEX idx\_tm\_items\_contact\_target    ON telemarketing\_task\_list\_items(contact\_target\_id);

CREATE INDEX idx\_tm\_call\_logs\_contact\_target ON telemarketing\_call\_logs(contact\_target\_id);

CREATE INDEX idx\_tm\_appointments\_contact\_target ON telemarketing\_appointments(contact\_target\_id);

```



\*\*Nullability\*\*: `BIGINT NULL` — لازم لأن:

\- السجلات التاريخية لا تملك contact\_target\_id.

\- candidate items لا يوجد لها contact\_target حالياً (target\_type='client' فقط).

\- legacy `upsert` لن يستطيع توفيرها.



\*\*نوع `BIGINT`\*\* لأن `contact\_targets.id` هو `BIGSERIAL`.



\### إصلاح حقول lifecycle في `contact\_targets`



⚠️ \*\*خلل بنيوي حالي\*\*: 

\- `latest\_task\_list\_item\_id INTEGER` — لكن item.id هو `VARCHAR(100)`.

\- `latest\_appointment\_id INTEGER` — لكن appointment.id هو `VARCHAR(100)`.



\*\*اقتراح\*\*: في نفس migration 047 نُغيّر النوعين إلى `VARCHAR(100)` (الجدول جديد ولا توجد بيانات تاريخية بعد):



```sql

ALTER TABLE contact\_targets

&#x20; ALTER COLUMN latest\_task\_list\_item\_id TYPE VARCHAR(100) USING latest\_task\_list\_item\_id::text,

&#x20; ALTER COLUMN latest\_appointment\_id    TYPE VARCHAR(100) USING latest\_appointment\_id::text;

```



\---



\## 4) Lifecycle Rules



| الحدث | تغيير `contact\_targets` |

|---|---|

| \*\*Item يُدخل قائمة\*\* (`generate-from-plan`) | `status: new → queued` (لو كان new). `latest\_task\_list\_item\_id = item.id`. |

| \*\*Call log: `no\_answer` / `busy`\*\* | `latest\_call\_outcome = outcome`. status: `queued → contacted` (لو كانت queued)، وإلا تبقى. |

| \*\*Call log: `rejected`\*\* | `latest\_call\_outcome = 'rejected'`. status → `closed`. |

| \*\*Call log: `booked`\*\* | `latest\_call\_outcome = 'booked'`. status → `contacted` (الحجز نفسه ينقلها لاحقاً إلى booked). |

| \*\*Appointment created\*\* | `latest\_appointment\_id = appointment.id`. status → `booked`. |

| \*\*(مؤجل)\*\* Visit / cancellation | لا يُلمس الآن. |



\*\*ملاحظة\*\*: لا نخفّض الـ status (no downgrades). تحديث `updated\_at = NOW()` مع كل تغيير.



\---



\## 5) generate-from-plan Changes



\- Backend \*\*لا يثق بـ frontend\*\* — لا يستقبل items خام (الـ endpoint أصلاً لا يستقبلها).

\- يجلب `contactTargetId` من `getPlanningMarketingTargets` كما يفعل الآن.

\- \*\*القرار في حال غياب `contactTargetId` للـ Lead\*\*: نسخّر \*\*خياراً آمناً = sync-on-demand\*\*:

&#x20; 1. لو الـ lead مرشح صالح ولا يوجد contact\_target مطابق، يستدعي backend منطقاً مماثلاً لـ `/contact-targets/marketing/sync` لإنشاء contact\_target ثم يستخدم id الناتج.

&#x20; 2. لو فشل الإنشاء (مثلاً الـ client لديه contract/visit) → نُسجّله في `skipped` بسبب `no\_contact\_target`.

&#x20; - \*\*بديل أبسط\*\*: السماح بـ `contact\_target\_id NULL` على item وتسجيل warning. قابل للقبول مرحلياً، لكن \*\*التوصية: sync-on-demand\*\* لإجبار التطابق البنيوي.



\- \*\*منع التكرار\*\*: التحويل إلى `contact\_target\_id`:

&#x20; - الاستعلام الحالي يبحث بـ `entity\_id`. بعد الإضافة، نستخدم `contact\_target\_id` كمصدر الحقيقة عند توفره، مع fallback على `entity\_id` للسجلات القديمة.



\- \*\*lifecycle update\*\*: في نفس transaction، للـ items المُضافة/المُحدّثة:

&#x20; ```sql

&#x20; UPDATE contact\_targets

&#x20; SET status = CASE WHEN status = 'new' THEN 'queued' ELSE status END,

&#x20;     latest\_task\_list\_item\_id = $itemId,

&#x20;     updated\_at = NOW()

&#x20; WHERE id = $contactTargetId;

&#x20; ```



\---



\## 6) Call Log Creation Changes



\*\*التوصية: Option A (Backend resolves from itemId)\*\* — مع fallback على Option C.



\- Frontend يرسل `taskListId + itemId` (إضافة بسيطة).

\- Backend يقرأ `contact\_target\_id` من `telemarketing\_task\_list\_items` بـ `(task\_list\_id, id)`.

\- \*\*لا يثق بأي `contactTargetId` يأتي من frontend\*\*.

\- لو `itemId` غير موجود (مسارات نادرة) → fallback: يحاول الاستنتاج من `(branch\_id, entity\_id, target\_type='client', visit\_type='marketing')` في `contact\_targets`.

\- لو لم يُعثر → يُحفظ `contact\_target\_id = NULL` (لا نرفض الـ call log).



\*\*lifecycle\*\*: بعد الإدراج، تحديث `contact\_targets.latest\_call\_outcome` و status حسب الجدول في §4.



\---



\## 7) Appointment Creation Changes



\*\*التوصية: Option A (Backend resolves from itemId)\*\*.



\- Frontend يرسل `taskListId + itemId` كما في call-logs.

\- Backend يستنتج `contact\_target\_id` من item.

\- Fallback مماثل لـ §6 لو `itemId` مفقود.



\*\*lifecycle\*\*: بعد الإدراج، `contact\_targets.status = 'booked'` و `latest\_appointment\_id = appointment.id`.



\---



\## 8) Shared Types and Frontend Changes



\### `packages/shared/types.ts`

\- `TaskListItem`: أضف `contactTargetId?: number`.

\- `CallLog`: أضف `contactTargetId?: number`، أضف `taskListItemId?: string`.

\- `Appointment`: أضف `contactTargetId?: number`، أضف `taskListItemId?: string`.



\### `packages/web/src/hooks/useTelemarketingStore.ts`

\- `addCallLog`: payload يجب أن يحمل `taskListItemId` (الموجود أصلاً في `selectedTask.id`).

\- `addAppointment`: نفس الشيء.



\### `packages/web/src/pages/TelemarketerWorkspace.tsx`

\- في `handleSaveOutcome`: أرسل `taskListItemId: selectedTask.id` ضمن addCallLog payload.

\- في `handleSaveAppointment`: أرسل `taskListItemId: selectedTask.id` ضمن addAppointment payload.



\### `packages/api/routes/telemarketing.ts`

\- `snapshot` و `PATCH item`: يُرجعان `contactTargetId` ضمن item.

\- `call-logs` POST: يقبل `taskListItemId` (string) ويُرجع `contactTargetId`.

\- `appointments` POST: نفس الشيء.



\---



\## 9) Legacy Endpoint Risk — `POST /task-lists/upsert`



| سؤال | الإجابة |

|---|---|

| هل يستطيع populate `contact\_target\_id`؟ | \*\*لا\*\* بشكل آمن — لأنه يستقبل items خام من frontend. |

| هل يبقى ويُدخل items بـ `null`؟ | نعم، الأقل تخريباً. الـ endpoint محمي بـ `telemarketing.lists.generate` ولا يُستخدم في المسار الحالي. |

| هل يجب رفض الطلب لو `contact\_target\_id` مفقود؟ | \*\*لا الآن\*\* — يكسر مسارات قد تكون قائمة. |

| الأكثر أماناً | \*\*اتركه مع `contact\_target\_id = NULL` صريحاً، ووثّقه كـ legacy ينبغي إزالته\*\* بعد التأكد من عدم وجود callers. |



\*\*الإجراء الموصى به في TM-2\*\*: لا تغيير سلوكي. فقط نضيف INSERT صريح لـ `contact\_target\_id = NULL` لتجنّب TypeScript drift وتأكيد القرار. حذف الـ endpoint = task مستقلة لاحقة.



\---



\## 10) Task Breakdown



\### Task 1 — Migration 047: contact\_target\_id columns + lifecycle field type fix

\- \*\*Goal\*\*: إضافة الأعمدة الثلاثة + indexes + إصلاح أنواع `latest\_task\_list\_item\_id`/`latest\_appointment\_id`.

\- \*\*Files\*\*: `migrations/047\_telemarketing\_contact\_target\_linkage.sql` (جديد).

\- \*\*Change\*\*: ADD COLUMN nullable BIGINT FK + 3 indexes + ALTER COLUMN type fix.

\- \*\*Don't\*\*: لا تعدّل existing rows. لا تضف NOT NULL.

\- \*\*Risk\*\*: low (additive + type fix على جدول جديد).

\- \*\*Acceptance\*\*: 3 columns موجودة، 3 indexes، ALTER ناجح، migration idempotent.



\### Task 2 — Update shared types

\- \*\*Goal\*\*: إضافة الحقول الجديدة كـ optional.

\- \*\*Files\*\*: \[`packages/shared/types.ts`](packages/shared/types.ts).

\- \*\*Change\*\*: `contactTargetId?: number` على TaskListItem/CallLog/Appointment + `taskListItemId?: string` على CallLog/Appointment.

\- \*\*Don't\*\*: لا تجعلها مطلوبة.

\- \*\*Risk\*\*: low.

\- \*\*Acceptance\*\*: TypeScript يجتاز في كلا الـ packages.



\### Task 3 — generate-from-plan: write contact\_target\_id + lifecycle

\- \*\*Goal\*\*: items تحمل `contact\_target\_id`، و`contact\_targets.latest\_task\_list\_item\_id` يُحدّث.

\- \*\*Files\*\*: \[`packages/api/routes/telemarketing.ts:197-385`](packages/api/routes/telemarketing.ts:197).

\- \*\*Change\*\*: 

&#x20; 1. تمرير `contactTargetId` في INSERT/UPDATE للـ items.

&#x20; 2. تحديث منع التكرار بـ `contact\_target\_id` (مع fallback).

&#x20; 3. تحديث UPDATE الـ contact\_targets ليكتب `latest\_task\_list\_item\_id`.

&#x20; 4. عند غياب `contactTargetId` للـ lead → تنفيذ sync-on-demand (الخيار الموصى به).

\- \*\*Don't\*\*: لا تغيّر شكل الـ payload (date+teamKey فقط).

\- \*\*Risk\*\*: medium (transactional logic).

\- \*\*Acceptance\*\*: items جديدة تحمل contact\_target\_id ≠ NULL؛ contact\_targets.status='queued'؛ latest\_task\_list\_item\_id يساوي item.id.



\### Task 4 — Call log creation: derive contact\_target\_id + lifecycle

\- \*\*Goal\*\*: backend يستنتج `contact\_target\_id` من `taskListItemId` ويُحدّث lifecycle.

\- \*\*Files\*\*: \[`packages/api/routes/telemarketing.ts:419-459`](packages/api/routes/telemarketing.ts:419).

\- \*\*Change\*\*:

&#x20; 1. قبول `taskListItemId` في body.

&#x20; 2. SELECT `contact\_target\_id` من `telemarketing\_task\_list\_items WHERE task\_list\_id=$ AND id=$`.

&#x20; 3. fallback على `(branch\_id, entity\_id)`.

&#x20; 4. INSERT `contact\_target\_id`.

&#x20; 5. UPDATE `contact\_targets` بـ `latest\_call\_outcome` و status حسب §4.

\- \*\*Don't\*\*: لا تكسر الطلبات بدون `taskListItemId` — اقبل null.

\- \*\*Risk\*\*: medium.

\- \*\*Acceptance\*\*: call\_log الجديد يحمل contact\_target\_id؛ contact\_targets.latest\_call\_outcome مُحدّث؛ status transitions صحيحة.



\### Task 5 — Appointment creation: derive contact\_target\_id + lifecycle

\- \*\*Goal\*\*: نفس Task 4 للـ appointments.

\- \*\*Files\*\*: \[`packages/api/routes/telemarketing.ts:461-516`](packages/api/routes/telemarketing.ts:461).

\- \*\*Change\*\*:

&#x20; 1. قبول `taskListItemId`.

&#x20; 2. SELECT contact\_target\_id.

&#x20; 3. INSERT contact\_target\_id.

&#x20; 4. UPDATE `contact\_targets.status='booked'` و `latest\_appointment\_id`.

\- \*\*Don't\*\*: لا تنشئ visit. لا تضف visit\_type على appointment.

\- \*\*Risk\*\*: medium.

\- \*\*Acceptance\*\*: appointment يحمل contact\_target\_id؛ contact\_targets.status='booked'؛ latest\_appointment\_id مُحدّث.



\### Task 6 — Snapshot/PATCH endpoints: return contact\_target\_id

\- \*\*Goal\*\*: GET/PATCH endpoints تُرجع `contactTargetId` ضمن items/logs/appointments.

\- \*\*Files\*\*: \[`packages/api/routes/telemarketing.ts`](packages/api/routes/telemarketing.ts) (snapshot SELECTs + PATCH RETURNING).

\- \*\*Change\*\*: إضافة `contact\_target\_id AS "contactTargetId"` في 3 SELECTs + RETURNING في PATCH.

\- \*\*Risk\*\*: low.

\- \*\*Acceptance\*\*: API responses تحمل الحقل.



\### Task 7 — Frontend: pass taskListItemId

\- \*\*Goal\*\*: TelemarketerWorkspace يمرّر `taskListItemId` عند تسجيل call/appointment.

\- \*\*Files\*\*: 

&#x20; - \[`packages/web/src/pages/TelemarketerWorkspace.tsx`](packages/web/src/pages/TelemarketerWorkspace.tsx) (handleSaveOutcome + handleSaveAppointment).

&#x20; - \[`packages/web/src/hooks/useTelemarketingStore.ts`](packages/web/src/hooks/useTelemarketingStore.ts) (addCallLog/addAppointment types).

\- \*\*Change\*\*: إضافة `taskListItemId: selectedTask.id`.

\- \*\*Don't\*\*: لا تعدّل UI components ولا layout.

\- \*\*Risk\*\*: low.

\- \*\*Acceptance\*\*: payload يحمل taskListItemId.



\### Task 8 — Legacy upsert: explicit NULL + comment

\- \*\*Goal\*\*: تثبيت سلوكه دون إصلاح بنيوي.

\- \*\*Files\*\*: \[`packages/api/routes/telemarketing.ts:130-195`](packages/api/routes/telemarketing.ts:130).

\- \*\*Change\*\*: INSERT items يضيف `contact\_target\_id` صريحاً = NULL، تعليق legacy.

\- \*\*Risk\*\*: low.

\- \*\*Acceptance\*\*: لا regression.



\### Task 9 — Verification

\- \*\*Goal\*\*: TypeScript checks + manual end-to-end.

\- \*\*Risk\*\*: low.

\- \*\*Acceptance\*\*: مذكور في §12.



\---



\## 11) Route/API Contract



| Endpoint | Current payload | Proposed payload | FE sends `contactTargetId`? | BE derives? | Response change |

|---|---|---|---|---|---|

| `POST /task-lists/generate-from-plan` | `{date, teamKey}` | بدون تغيير | لا | نعم (من planning) | items in counts; لا تغيير في الشكل |

| `GET /snapshot` | — | بدون تغيير | — | — | items/callLogs/appointments تحمل `contactTargetId` |

| `PATCH /task-lists/:id/items/:id` | `{status, callOutcome}` | بدون تغيير | لا | لا (موجود في item) | RETURNING يحمل `contactTargetId` |

| `POST /call-logs` | `{id, entityType, entityId, taskListId, teamKey, outcome, …}` | + `taskListItemId?: string` | لا | نعم (من item) | يحمل `contactTargetId` |

| `POST /appointments` | `{id, entityType, entityId, customer\*, teamKey, date, timeSlot, …}` | + `taskListItemId?: string` | لا | نعم (من item) | يحمل `contactTargetId` |

| `POST /task-lists/upsert` (legacy) | كما هو | بدون تغيير | لا | لا | items تُحفظ بـ `contact\_target\_id=NULL` صراحة |



\---



\## 12) Testing Plan



1\. ✅ `npx tsc -p packages/api/tsconfig.json --noEmit`

2\. ✅ `npx tsc -p packages/web/tsconfig.json --noEmit`

3\. \*\*Manual\*\*:

&#x20;  - شغّل `generate-from-plan` ➜ تحقق `SELECT id, contact\_target\_id FROM telemarketing\_task\_list\_items WHERE task\_list\_id='tm\_…'`.

&#x20;  - تحقق `SELECT status, latest\_task\_list\_item\_id FROM contact\_targets WHERE id=$`.

&#x20;  - أنشئ call log ➜ تحقق `contact\_target\_id` في الصف، و `contact\_targets.latest\_call\_outcome` = outcome.

&#x20;  - اختبر outcomes الأربعة (`no\_answer`/`busy`/`rejected`/`booked`) واللحظات الانتقالية للـ status.

&#x20;  - أنشئ appointment ➜ تحقق `contact\_target\_id` و `contact\_targets.status='booked'` و `latest\_appointment\_id`.

&#x20;  - افتح Workspace على fixtures قديمة (items بـ `contact\_target\_id=NULL`) ➜ تأكد أن الـ UI لا يكسر.



\---



\## 13) Risks and Open Questions



| المخاطرة | التخفيف |

|---|---|

| سجلات تاريخية بـ `contact\_target\_id=NULL` | nullable column + fallback في الاستعلام |

| Legacy `upsert` لا يستطيع توفير الـ id | NULL صريح + توثيق legacy |

| candidate items (entity\_type='candidate') لا يوجد لها contact\_target | nullable يكفي — التركيز على client فقط حالياً |

| تكرار lead في نفس اليوم/الفرع لفرق متعددة | قائم منعه؛ التحول إلى contact\_target\_id يجعله أدق |

| Appointment يُنشأ خارج item (بشكل افتراضي) | التحقق من selectedTask موجود قبل save في FE؛ fallback على entity\_id لو غير متاح |

| Type mismatch في `contact\_targets.latest\_\*\_id` | إصلاحه في نفس migration 047 |

| sync-on-demand للـ contact\_target الناقص | يحتاج اتخاذ قرار: هل نضيفه فعلياً أم نسمح بـ NULL؟ \*\*سؤال للمستخدم\*\* |



\### أسئلة مفتوحة



1\. \*\*هل نريد sync-on-demand فعلياً في `generate-from-plan`\*\* أم نقبل `contact\_target\_id=NULL` على items عند غياب الـ target؟ التوصية: sync-on-demand (أكثر أماناً).

2\. \*\*هل يُسمح بإغلاق `contact\_target` عند `outcome='rejected'`\*\* أم تبقى `contacted` مع تحديث `latest\_call\_outcome` فقط؟ التوصية: closed (لكن قابل للنقاش).

3\. \*\*`latest\_task\_list\_item\_id` و `latest\_appointment\_id`\*\*: هل نقبل تغيير النوع إلى VARCHAR في migration 047 أم نسجّلها كمشكلة منفصلة؟ التوصية: داخل 047 (الجدول جديد).



\---



\## 14) Final Recommendation — Implementation Order



1\. \*\*Task 1\*\* — Migration 047 (الأساس).

2\. \*\*Task 2\*\* — Shared types (لا يكسر شيئاً).

3\. \*\*Task 6\*\* — Snapshot/PATCH responses (يفتح الباب لـ FE).

4\. \*\*Task 3\*\* — generate-from-plan (المصدر الأول للـ contact\_target\_id).

5\. \*\*Task 4\*\* — Call log + lifecycle.

6\. \*\*Task 5\*\* — Appointment + lifecycle.

7\. \*\*Task 7\*\* — Frontend pass taskListItemId.

8\. \*\*Task 8\*\* — Legacy upsert NULL fix.

9\. \*\*Task 9\*\* — Verification.



\*\*قبل البدء\*\*: أحتاج موافقتك على الأسئلة الثلاثة في §13. الإجابات تحدّد سلوك Task 3 و Task 4.

