\# تقرير مراجعة TM-2



\## 1) Migration 047 Review



| الفحص | النتيجة |

|---|---|

| `contact\_target\_id BIGINT` أُضيف لـ `telemarketing\_task\_list\_items` | ✅ |

| `contact\_target\_id BIGINT` أُضيف لـ `telemarketing\_call\_logs` | ✅ |

| `contact\_target\_id BIGINT` أُضيف لـ `telemarketing\_appointments` | ✅ |

| الأعمدة nullable (`ADD COLUMN IF NOT EXISTS ... BIGINT`) | ✅ |

| FK إلى `contact\_targets(id) ON DELETE SET NULL` | ✅ |

| 3 indexes مُضافة | ✅ |

| `latest\_task\_list\_item\_id` حُوّل إلى `VARCHAR(100)` | ✅ |

| `latest\_appointment\_id` حُوّل إلى `VARCHAR(100)` | ✅ |

| آمن على الصفوف الموجودة (nullable + IF NOT EXISTS) | ✅ |

| idempotent | ✅ |



\*\*الحكم\*\*: ✅ سليمة بالكامل.



\---



\## 2) Shared Types Review



| الفحص | النتيجة |

|---|---|

| `TaskListItem.contactTargetId?: number` | ✅ |

| `CallLog.contactTargetId?: number` | ✅ |

| `CallLog.taskListItemId?: string` | ✅ |

| `Appointment.contactTargetId?: number` | ✅ |

| `Appointment.taskListItemId?: string` | ✅ |

| كل الحقول optional (لا تكسر سجلات تاريخية) | ✅ |



\*\*الحكم\*\*: ✅ سليم.



\---



\## 3) generate-from-plan Review



| الفحص | النتيجة |

|---|---|

| يستقبل `date + teamKey` فقط | ✅ |

| لا يثق بـ items من frontend | ✅ |

| يستخدم `contactTargetId` من `getPlanningMarketingTargets` | ✅ |

| sync-on-demand عبر `resolveOrCreateContactTarget` إذا مفقود | ✅ |

| يُسجّل `no\_contact\_target` في skipped إذا فشل الإنشاء | ✅ |

| يكتب `contact\_target\_id` في INSERT وUPDATE للـ items | ✅ |

| منع التكرار يستخدم `entity\_id` + fallback بـ `contact\_target\_id` | ✅ |

| يُحدّث `contact\_targets.status = queued` (من new) | ✅ |

| يُحدّث `latest\_task\_list\_item\_id` لكل item | ✅ |

| المتغير أعيدت تسميته إلى `pgClient` لتجنب conflict مع `client` DB | ✅ |



\*\*الحكم\*\*: ✅ سليم.



\---



\## 4) Call Log Review



| الفحص | النتيجة |

|---|---|

| يستنتج `contact\_target\_id` من `taskListItemId + taskListId` | ✅ |

| لا يثق بـ `contactTargetId` من frontend | ✅ |

| fallback بـ `resolveContactTargetByEntity` | ✅ |

| يقبل `NULL` للتوافق مع السجلات القديمة | ✅ |

| يُدخل `contact\_target\_id` في INSERT | ✅ |

| يُحدّث `latest\_call\_outcome` | ✅ |

| `rejected` → `status = 'closed'` | ✅ |

| `no\_answer`/`busy` → `contacted` فقط إذا `status IN ('new','queued','in\_call\_list')` | ✅ |

| `booked` call → لا يغيّر status (ينتظر appointment) | ✅ |

| لا downgrade للـ status | ✅ |



\*\*الحكم\*\*: ✅ سليم.



\---



\## 5) Appointment Review



| الفحص | النتيجة | ملاحظة |

|---|---|---|

| يحاول استنتاج `contact\_target\_id` من `taskListItemId + taskListId` | ⚠️ | ‎\*\*المسار لا يعمل\*\* (انظر أدناه) |

| fallback بـ `resolveContactTargetByEntity` | ✅ | يعمل وينتج النتيجة الصحيحة |

| يُدخل `contact\_target\_id` في INSERT | ✅ | |

| يُحدّث `status = 'booked'` | ✅ | |

| يُحدّث `latest\_appointment\_id` | ✅ | |

| لا يُنشئ Visit | ✅ | |



\### ⚠️ Issue #1: Appointment لا يرسل `taskListId`



\*\*الخطورة: منخفضة-متوسطة (functional fallback يعمل)\*\*



Backend يتحقق من `appointment.taskListItemId \&\& appointment.taskListId` في \[telemarketing.ts:743](packages/api/routes/telemarketing.ts:743). لكن:



\- Frontend يرسل `taskListItemId: selectedTask.id` ✅

\- Frontend \*\*لا يرسل\*\* `taskListId` ❌

\- الـ `Appointment` type في shared لا يحتوي `taskListId`

\- الشرط `appointment.taskListItemId \&\& appointment.taskListId` يكون `"value" \&\& undefined` = `false`



\*\*الأثر\*\*: المسار الأولي (`resolveContactTargetFromItem`) لا يعمل أبداً للـ appointments. الـ fallback `resolveContactTargetByEntity` يعمل بشكل صحيح بسبب unique constraint على `contact\_targets(branch\_id, target\_type, target\_id, visit\_type, source\_type)` — لذلك النتيجة الوظيفية سليمة.



\*\*الإصلاح المطلوب\*\*: في `TelemarketerWorkspace.tsx` handleSaveAppointment، إضافة `taskListId: activeTaskList!.id` ضمن الـ payload. بديلاً، إضافة `taskListId?: string` إلى `Appointment` shared type أو معالجته في backend.



\---



\## 6) Frontend Review



| الفحص | النتيجة |

|---|---|

| `handleSaveOutcome` يرسل `taskListItemId: selectedTask.id` | ✅ |

| `handleSaveOutcome` يرسل `taskListId: activeTaskList!.id` | ✅ |

| `handleSaveAppointment` يرسل `taskListItemId: selectedTask.id` | ✅ |

| `handleSaveAppointment` يرسل `taskListId` | ❌ (Issue #1) |

| لا يرسل `contactTargetId` كمصدر حقيقة | ✅ |

| UI يعمل مع `contactTargetId=null` على سجلات تاريخية | ✅ |

| TypeScript يجتاز في API وWeb | ✅ |



\---



\## 7) Legacy Upsert Review



| الفحص | النتيجة |

|---|---|

| الـ endpoint موجود | ✅ |

| يكتب `contact\_target\_id = NULL` صراحة | ✅ |

| موثّق كـ legacy بتعليق واضح | ✅ |

| لم يُحذف ولم يُكسر | ✅ |



\*\*الحكم\*\*: ✅ سليم.



\---



\## 8) Regression / Out-of-Scope Review



| الفحص | النتيجة |

|---|---|

| لا FOP أُضيف | ✅ |

| لا OP أُضيف | ✅ |

| لا Visit أُنشئ | ✅ |

| لا VisitTask أُنشئ | ✅ |

| لا Marketing Visit تم تنفيذه | ✅ |

| لا إعادة تصميم للـ Workspace | ✅ |

| لا date navigation أُضيف | ✅ |

| لا supervisor/team scope أُضيف | ✅ |

| الملفات المعدّلة متوقعة ولا توجد ملفات غريبة | ✅ |



\---



\## 9) Risk Review



| المخاطرة | التقييم |

|---|---|

| \*\*Type mismatch\*\*: `ANY($1::int\[])` مع `BIGSERIAL` IDs في \[generate-from-plan](packages/api/routes/telemarketing.ts:541) و\[duplicate check](packages/api/routes/telemarketing.ts:405) | ⚠️ \*\*منخفضة جداً\*\* — PostgreSQL يعمل implicit cast. لو IDs تجاوزت `2^31` يحصل overflow، لكن عملياً مستحيل. يمكن تصحيحه إلى `::bigint\[]` لاحقاً. |

| \*\*null contact\_target\_id\*\* على سجلات تاريخية | ✅ آمن — كل الحقول nullable، كل الاستعلامات تتعامل مع null |

| \*\*Transaction consistency\*\* في generate-from-plan | ✅ كل شيء ضمن `BEGIN/COMMIT` |

| \*\*Lifecycle status downgrade\*\*: rejected يمكن أن يحوّل `booked → closed` | ⚠️ \*\*منخفضة\*\* — سلوك مقبول تجارياً (الزبون رفض بعد الحجز) |

| \*\*Duplicate prevention\*\* | ✅ يجمع بين `entity\_id` و `contact\_target\_id` |

| \*\*Appointment بدون taskListId\*\* (Issue #1) | ⚠️ متوسطة — fallback يعمل |

| \*\*sync-on-demand\*\* قد ينشئ contact\_target لزبون لديه contract/visit | ⚠️ \*\*منخفضة\*\* — ON CONFLICT يحدّث بدلاً من إدخال مكرر، وعملياً `getPlanningMarketingTargets` يُفلتر هؤلاء مسبقاً |

| \*\*Branch safety\*\* | ✅ `branchId` من authContext فقط |



\---



\## 10) Final Review Result



\### \*\*PASS WITH WARNINGS\*\*



\### قائمة المشاكل



| # | الخطورة | الوصف | الإصلاح |

|---|---|---|---|

| 1 | \*\*متوسطة\*\* | Appointment endpoint لا يتلقى `taskListId` من frontend — المسار الأولي لاستنتاج `contact\_target\_id` معطّل | إضافة `taskListId: activeTaskList!.id` في `handleSaveAppointment` |

| 2 | \*\*منخفضة جداً\*\* | `ANY($1::int\[])` بدلاً من `::bigint\[]` في استعلامين | تصحيح إلى `::bigint\[]` |



\### التوصية



\*\*TM-2 مقبولة ويمكن المتابعة إلى TM-3\*\* بعد إصلاح Issue #1 (سطر واحد في frontend). الـ fallback يعمل ويُنتج النتيجة الصحيحة حالياً، لكن الإصلاح ضروري لضمان أن المسار الأولي (الأدق) يعمل فعلياً.



Issue #2 يمكن تأجيلها لأنها لا تؤثر عملياً.

