\## 1. Goal Summary



\- TM-4 هدفها إضافة \*\*scope حقيقي\*\* فوق صلاحيات التيلماركتر، وليس الاكتفاء بـ `requirePermission`.

\- يجب منع أي مستخدم من رؤية أو تنفيذ اتصال/موعد خارج فرعه أو خارج الفريق/الأهداف المسموحة له.

\- التيلماركتر يعمل على قوائم الفرق التي هو عضو فيها كـ `telemarketer`.

\- المشرفة يجب أن ترى وتنفذ الاتصال على Leads المسندة لها فقط، لكن تنفيذ ذلك يحتاج staging آمن.

\- مدير الفرع يحافظ على workflow توليد ومراجعة قوائم الاتصال داخل فرعه.



\## 2. Current Permission Review



الملفات الأساسية:

\- \[migrations/046\_telemarketing\_permissions\_seeding.sql](D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/046\_telemarketing\_permissions\_seeding.sql)

\- \[packages/api/routes/telemarketing.ts](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/telemarketing.ts)

\- \[packages/api/middleware/permission.ts](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/middleware/permission.ts)

\- \[packages/web/src/App.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/App.tsx)

\- \[packages/web/src/layout/MainLayout.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx)



الصلاحيات الموجودة في TM-1:

| Role | Permissions |

|---|---|

| `SYSTEM\_ADMIN` | كل `telemarketing.\*` بـ `GLOBAL` |

| `ADMIN` | كل `telemarketing.\*` بـ `BRANCH` |

| `BRANCH\_MANAGER` | `targets.view`, `lists.view`, `lists.generate`, `calls.view\_history`, `appointments.view` |

| `TELEMARKETER` | `lists.view`, `calls.create`, `appointments.create`, `calls.view\_history`, `appointments.view` |

| `CUSTOMER\_SERVICE\_SUPERVISOR` | `targets.view`, `lists.view`, `calls.create`, `appointments.create`, `calls.view\_history`, `appointments.view` |



حماية الـ backend الحالية:

| Endpoint | Guard موجود |

|---|---|

| `GET /api/telemarketing/snapshot` | `telemarketing.lists.view` |

| `POST /api/telemarketing/task-lists/upsert` | `telemarketing.lists.generate` |

| `POST /api/telemarketing/task-lists/generate-from-plan` | `telemarketing.lists.generate` |

| `PATCH /api/telemarketing/task-lists/:taskListId/items/:itemId` | `telemarketing.calls.create` |

| `POST /api/telemarketing/call-logs` | `telemarketing.calls.create` |

| `POST /api/telemarketing/appointments` | `telemarketing.appointments.create` |



المشكلة:

\- الـ permissions موجودة، لكن معظم endpoints لا تطبق scope تفصيلي.

\- `snapshot` حالياً يقرأ كل القوائم/المواعيد/السجلات بدون `branch\_id` filter وبدون user/team scope.

\- صفحة `/telemarketer` في \[App.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/App.tsx) محمية فقط بـ login.

\- في \[MainLayout.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/layout/MainLayout.tsx) ظهور رابط التيلماركتر يعتمد على `telemarketer.view`، بينما migration أضافت `telemarketing.lists.view`. هذا mismatch واضح.

\- صفحة Marketing Operations route أيضاً login-only، و API `contact-targets/marketing` branch-only فقط ولا يستخدم `requirePermission('telemarketing.targets.view')`.



\## 3. Current Data Scope Review



مصادر الـ scope الحالية:

| Data | Source |

|---|---|

| `current hr\_user id` | `req.authContext.userId` |

| `branch id` | `req.authContext.actingBranchId` |

| `employee id` | من `hr\_users.employee\_id` |

| team membership | `day\_schedules.teams` JSON |

| list branch/date/team | `telemarketing\_task\_lists.branch\_id/date/team\_key` |

| item target | `telemarketing\_task\_list\_items.contact\_target\_id` |

| contact target supervisor | `contact\_targets.supervisor\_hr\_user\_id` جزئي فقط |

| الحقيقة لتعدد المشرفات | `client\_assignments` |



كيف نعرف إن المستخدم مشرفة الهدف؟

\- القاعدة الصحيحة ليست فقط `contact\_targets.supervisor\_hr\_user\_id`.

\- الصحيح: `contact\_targets.target\_type='client'` و `target\_id=client\_id` ثم وجود row في `client\_assignments` حيث `client\_id = target\_id` و `hr\_user\_id = currentUserId`.



كيف نعرف إن المستخدم تيلماركتر في الفريق؟

\- نقرأ `telemarketing\_task\_lists.date/team\_key`.

\- نقرأ `day\_schedules` لنفس التاريخ.

\- نحلل `team\_X` إلى index.

\- نتحقق أن `current employee\_id` موجود داخل `teams\[index].telemarketers`.



كيف نعرف مدير الفرع؟

\- الأفضل عدم الاعتماد على اسم الدور فقط.

\- عملياً: من لديه `telemarketing.lists.generate` أو `telemarketing.lists.view` بفرع حالي، مع role مثل `BRANCH\_MANAGER`.

\- للتنفيذ الآمن: استخدم permission + branch scope، وليس role string فقط.



هل يمكن تكرار telemarketer/supervisor في أكثر من فريق؟

\- حفظ `day\_schedules` الحالي يمنع تكرار الموظف في أكثر من خانة في نفس اليوم.

\- لكن بسبب JSON وبيانات قديمة، يجب ألا نفترض ذلك دائماً عند authorization. الأفضل التعامل مع الاحتمال نظرياً.



\## 4. Scope Rules Proposal



\### A) Branch Manager



\- يرى كل قوائم الاتصال داخل `actingBranchId`.

\- يستطيع توليد القوائم من الخطة.

\- يرى call history و appointments داخل الفرع.

\- لا أوصي أن ينشئ call logs أو appointments بنفسه في TM-4، لأن migration الحالية لا تعطيه `calls.create` ولا `appointments.create`.

\- إذا المنتج يريد “مدير الفرع يستطيع الاتصال”، فهذا قرار صلاحيات جديد لاحق، وليس ضمن أقل TM-4.



\### B) Telemarketer



\- يرى فقط task lists التي يكون `employee\_id` الخاص به داخل `team.telemarketers\[]` لنفس `date/teamKey`.

\- ينشئ call logs فقط لعناصر داخل قوائم مسموحة له.

\- ينشئ appointments فقط لعناصر داخل قوائم مسموحة له.

\- يرى call history/appointments فقط للعناصر أو القوائم المسموحة له.



\### C) Supervisor



\- لا تعتمد فقط على `contact\_targets.supervisor\_hr\_user\_id`.

\- المشرفة مسموحة إذا كان الـ Lead موجوداً في `client\_assignments` لها.

\- السؤال التصميمي: هل ترى task lists أم queue مستقل؟

\- التوصية: لا نخلطها مباشرة مع task lists في أول TM-4. نجهز backend rule وننفذ queue مستقل في TM-4B/TM-5.



\### D) Admin/System Admin



\- `SYSTEM\_ADMIN` حسب global behavior، مع branch context عندما تكون route branch-only.

\- `ADMIN` داخل الفرع.

\- يجب أن يستمر branch/global behavior الموجود بدون كسره.



\## 5. Workspace Design Options for Supervisor Calling



| Option | Pros | Cons | Data impact | Risk | Complexity | Recommendation |

|---|---|---|---|---|---|---|

| A: نفس TelemarketerWorkspace مع filtering | سريع، UI موجود | صعب لأن workspace مبني حول task lists/teamKey | قليل | خطر تسريب إذا snapshot غير مضبوط | متوسط | مناسب للتيلماركتر، غير مثالي للمشرفة |

| B: Supervisor “My Lead Calls” queue من contact\_targets | أنظف أمنياً، يطابق client\_assignments | يحتاج endpoint/UI جديد | لا يحتاج schema غالباً | أقل تسريب | متوسط | الأفضل للمشرفة |

| C: الاتصال من MarketingOperations | سريع للصفحة العامة | الصفحة إدارية/تشغيلية وقد تكشف أكثر من اللازم | قليل | عالي إذا لم تضبط scope | منخفض-متوسط | غير مفضل كبداية |

| D: Shared ContactWorkQueue component | معماري ممتاز | refactor أكبر | لا يلزم schema | منخفض بعد التنفيذ | أعلى | لاحقاً بعد تثبيت القواعد |



التوصية: TM-4A يحمي workflow الحالي للتيلماركتر ومدير الفرع. TM-4B/5 يبني Supervisor My Leads queue فوق `contact\_targets + client\_assignments`.



\## 6. Backend Authorization Strategy



| Endpoint | Permission | Scope validation |

|---|---|---|

| `GET /telemarketing/snapshot` | `telemarketing.lists.view` | filter by branch/date/user role scope |

| `GET task list` إن أضيف | `telemarketing.lists.view` | list.branch\_id + team membership أو manager/admin |

| `POST /task-lists/generate-from-plan` | `telemarketing.lists.generate` | manager/admin فقط، branch context، team exists for date |

| `PATCH task list item` | `telemarketing.calls.create` | item belongs to allowed list أو supervisor owns target |

| `POST /call-logs` | `telemarketing.calls.create` | load item, derive contact\_target\_id, validate scope before insert |

| `POST /appointments` | `telemarketing.appointments.create` | نفس call log + conflict scoped by branch |

| appointment list داخل snapshot | `telemarketing.appointments.view` | same branch/scope filtering |



Failure behavior:

\- للقراءة: يفضل `404` أو نتيجة فارغة لتجنب كشف وجود item/list.

\- للأفعال المعروفة من UI: `403` مقبول إذا المستخدم authenticated لكن خارج scope.

\- generate: `403`.



\## 7. Snapshot Filtering Strategy



المشكلة الحالية:

\- `snapshot` يرجع task lists/call logs/appointments بدون branch filter.

\- لا يقبل `date`.

\- لا يعرف هل المستخدم مدير/تيلماركتر/مشرفة.



السلوك المقترح:

\- Branch Manager: كل قوائم الفرع، مفلترة اختيارياً حسب `date`.

\- Telemarketer: قوائم الفرق التي هو ضمن `telemarketers\[]` فيها.

\- Supervisor: لا ترجع task-list snapshot في TM-4A إلا إذا كانت أيضاً telemarketer في الفريق. في TM-4B تستخدم endpoint مستقل.

\- Admin: حسب branch/global behavior.



هل يقبل `date`؟

\- نعم. TM-3 أضاف date navigation، لكن store ما زال يستدعي `api.telemarketing.snapshot()` بدون date.

\- أقل تعديل صحيح: `GET /snapshot?date=YYYY-MM-DD`.



هل نقسم snapshot؟

\- مستقبلاً نعم: `task-lists`, `call-logs`, `appointments`.

\- TM-4A يمكن أن يبقى snapshot مع filtering صارم لتقليل التغيير.



\## 8. Call Log Authorization



المطلوب:

1\. Backend يستقبل `taskListId + taskListItemId`.

2\. يحمّل item من `telemarketing\_task\_list\_items`.

3\. يحمّل list من `telemarketing\_task\_lists`.

4\. يستخرج `contact\_target\_id` من item.

5\. يتحقق من الفرع.

6\. يتحقق من scope:

&#x20;  - manager/admin داخل الفرع إذا أعطيناه permission execution، حالياً لا.

&#x20;  - telemarketer عضو في team/date.

&#x20;  - supervisor owns target عبر `client\_assignments`.

7\. بعدها فقط insert.



المتوفر:

\- `taskListItemId` موجود في shared types والواجهة ترسله.

\- `contact\_target\_id` موجود في migration 047.

\- `called\_by` مشتق من `req.authContext.userId`.



الفجوة:

\- لا يوجد scope validation قبل insert حالياً.

\- fallback by entity قد يسمح بعمليات بدون item. يجب تقييده أو استخدامه فقط لمسار supervisor queue لاحقاً.



\## 9. Appointment Authorization



نفس call logs:

\- يجب تحميل item/list قبل الحجز.

\- يجب منع appointment إذا item خارج scope.

\- `created\_by` حالياً مشتق من auth context.

\- `contact\_target\_id` مشتق من item أو fallback.

\- conflict check الحالي يستخدم `team\_key + date + time\_slot` فقط، ويجب أن يشمل `branch\_id` لتجنب cross-branch conflict.



الفجوة:

\- لا يوجد تحقق scope قبل insert.

\- لا يوجد تحقق أن appointment مرتبط بعنصر مسموح.

\- لا يوجد branch في conflict check.



\## 10. Generate List Authorization



التوصية:

\- Branch Manager/Admin فقط.

\- Telemarketer: لا.

\- Supervisor: لا لتوليد team list.

\- endpoint الحالي يستخدم `telemarketing.lists.generate` وهذا مناسب لأن migration لم تمنحه للتيلماركتر/المشرفة.



كيف نتحقق أن team belongs to branch/date؟

\- نقرأ `day\_schedules` حسب date ونستخرج الفريق من `teamKey`.

\- لأن `day\_schedules` لا يحتوي `branch\_id`، نتحقق من employees داخل الفريق أنهم من `actingBranchId`.

\- هذا ليس مثالياً، لكنه أقل تعديل بدون migration.



مخاطر unique:

\- `telemarketing\_task\_lists` عنده `UNIQUE(team\_key, date)` فقط.

\- مع تعدد الفروع، `team\_0` في نفس التاريخ قد يتصادم بين فروع.

\- يجب لاحقاً جعله `UNIQUE(branch\_id, team\_key, date)`.

\- لـ TM-4 يمكن توثيق الخطر أو تضمين إصلاح migration إذا أصبح blocker، لكن الطلب يقول لا نقرر migration إلا إذا ضرورية.



\## 11. Contact Target Scope



القاعدة الصحيحة للمشرفة:

\- إذا `contact\_target.target\_type = 'client'`

\- و `contact\_target.target\_id = clients.id`

\- ويوجد `client\_assignments.client\_id = clients.id`

\- و `client\_assignments.hr\_user\_id = current hr\_user id`

\- فهي تملك scope على هذا الهدف.



لماذا لا نستخدم `contact\_targets.supervisor\_hr\_user\_id` فقط؟

\- لأنه يمثل مشرفة واحدة فقط.

\- صفحة عمليات التسويق أصبحت تعرض `supervisors\[]` من `client\_assignments`.

\- Lead قد يكون له أكثر من مشرفة.

\- لذلك `client\_assignments` هو source of truth.



\## 12. Data Model Gaps



| Gap | Required for TM-4? | Can defer? | Risk |

|---|---:|---:|---|

| `assigned\_caller\_hr\_user\_id` on item | لا للتيم-based scope | نعم | لا يمكن queue لشخص بعينه |

| `contact\_target\_supervisors` | لا | نعم | `client\_assignments` كافٍ الآن |

| `branch\_id` in unique task list constraint | ليس فورياً إذا فرع واحد عملياً | نعم بحذر | cross-branch collision |

| `task\_list\_item\_id` in logs/appointments | غير موجود كعمود، لكنه يرسل لحل contact target | يمكن defer | traceability أضعف |

| `contact\_target\_id` on items/logs/appointments | موجود في migration 047 | لا | مهم للـ lifecycle |

| teams stored as JSON | مقبول الآن | نعم | authorization queries أعقد وهشة |

| supervisor queue endpoint | مطلوب للمشرفة إذا نطبقها فعلاً | TM-4B | بدونه supervisor calling غير مكتمل |



\## 13. Minimal TM-4 Implementation Scope



أقترح التقسيم التالي:



\### TM-4A: Secure Existing Team Task-List Workflow

\- Scope helpers في backend.

\- snapshot مفلتر بـ branch/date/user.

\- حماية patch item/call logs/appointments.

\- حماية generate-from-plan كمدير/أدمن فقط.

\- تصحيح frontend API ليطلب snapshot حسب date.

\- إصلاح menu permission mismatch من `telemarketer.view` إلى `telemarketing.lists.view`.



\### TM-4B: Supervisor Calling

\- endpoint مستقل: “My Lead Calls”.

\- يعتمد على `contact\_targets + client\_assignments`.

\- يسمح للمشرفة بتسجيل call log/appointment على contact target خاص بها.

\- لا يخلط المشرفة مع task list team workflow إلا لاحقاً.



لماذا؟

\- لأن مزج supervisor مع task lists الآن قد يفتح تسريب Leads لمشرفات أخريات.

\- TM-4A يغلق التسريب الأخطر فوراً.

\- TM-4B يبني تجربة المشرفة بشكل نظيف.



\## 14. Task Breakdown



| Task | Goal | Files likely |

|---|---|---|

| Task 1: Backend scope helpers | استخراج `hr\_user\_id`, `employee\_id`, branch, role grants, team membership | `packages/api/routes/telemarketing.ts` أو service جديد |

| Task 2: Team membership resolver | قراءة `day\_schedules` وتحليل `team\_X` والتحقق من `telemarketers\[]` | `packages/api/services/telemarketingScope.ts` مقترح |

| Task 3: Snapshot scope/date | جعل snapshot يقبل `date` ويرجع فقط المسموح | `telemarketing.ts`, `api.ts`, `useTelemarketingStore.ts` |

| Task 4: Protect item patch | منع تعديل status/outcome خارج scope | `telemarketing.ts` |

| Task 5: Protect call log creation | تحميل item/list/contact\_target والتحقق قبل insert | `telemarketing.ts` |

| Task 6: Protect appointment creation | نفس call log + branch conflict | `telemarketing.ts` |

| Task 7: Generate-from-plan hardening | تأكيد manager/admin scope والتحقق من team/branch | `telemarketing.ts` |

| Task 8: Frontend route/menu permissions | إصلاح menu permission وربما page guard | `MainLayout.tsx`, `App.tsx` إن لزم |

| Task 9: Supervisor queue design stub | تحليل/تحضير endpoint لاحق بدون خلطه الآن | لا تنفيذ في TM-4A |

| Task 10: TypeScript validation | تشغيل checks | لا ملفات منطقية |



Acceptance criteria المختصرة:

\- Telemarketer لا يرى إلا قوائمه.

\- Telemarketer لا يستطيع إنشاء log/appointment لقائمة فريق آخر.

\- Branch manager يرى الفرع ويولد القوائم.

\- Supervisor لا ترى Leads غير مسندة لها.

\- Cross-branch ممنوع.

\- Snapshot لا يرجع كل البيانات.



\## 15. Endpoint Scope Matrix



| Endpoint | Permission | Branch Manager | Telemarketer | Supervisor | Admin | Required data | Notes |

|---|---|---|---|---|---|---|---|

| `GET /snapshot?date=` | `lists.view` | all branch | own teams only | defer/own queue | branch/global | branch, hr\_user, employee, schedule | الحالي يتسرب |

| `POST /task-lists/generate-from-plan` | `lists.generate` | allowed | denied | denied | allowed | branch, date, teamKey, schedule | no raw items |

| `POST /task-lists/upsert` | `lists.generate` | legacy only | denied | denied | admin only | branch | يفضل عدم استخدامه |

| `PATCH /task-lists/:id/items/:itemId` | `calls.create` | recommend no unless permission granted | own team item | own target if enabled | allowed | item/list/target | يحتاج scope |

| `POST /call-logs` | `calls.create` | recommend no | own team item | own target | allowed | item/list/target | derive contact\_target |

| `POST /appointments` | `appointments.create` | recommend no | own team item | own target | allowed | item/list/target | conflict by branch |

| `GET contact-targets/marketing` | `targets.view` | all branch | probably no | own assigned only if used | allowed | branch + assignments | حالياً بلا requirePermission |



\## 16. Testing Plan



\- Branch manager يرى كل قوائم الفرع فقط.

\- Branch manager يستطيع `generate-from-plan`.

\- Telemarketer يرى فقط team lists التي هو داخل `telemarketers\[]` لها في ذلك التاريخ.

\- Telemarketer لا يستطيع PATCH item لفريق آخر.

\- Telemarketer لا يستطيع create call log لفريق آخر.

\- Telemarketer لا يستطيع create appointment لفريق آخر.

\- Supervisor لا ترى Leads مشرفة أخرى.

\- Supervisor ترى Lead إذا كانت موجودة في `client\_assignments`.

\- `generate-from-plan` مرفوض للتيلماركتر.

\- `generate-from-plan` مرفوض للمشرفة.

\- cross-branch snapshot/action مرفوض.

\- old rows with `contact\_target\_id = null` لا تكسر snapshot.

\- appointment conflict لا يتأثر بقوائم فرع آخر.

\- route/menu لا يظهر لمن لا يملك `telemarketing.lists.view`.



\## 17. Risks and Open Questions



\- تعدد المشرفات للـ Lead يعني أن `contact\_targets.supervisor\_hr\_user\_id` ليس كافياً.

\- `day\_schedules` بدون `branch\_id` يجعل team ownership حسب الفرع غير مثالي.

\- `team\_key` مثل `team\_0` غير مستقر إذا تغير ترتيب الفرق.

\- unique الحالي `team\_key + date` خطر مع تعدد الفروع.

\- هل المشرفة يجب أن تعمل من نفس TelemarketerWorkspace أم queue مستقل؟

\- هل مدير الفرع يجب أن يسجل اتصالات فعلاً أم يراجع فقط؟

\- هل Leads المسندة للمشرفة لكن غير موجودة في قائمة اليوم تظهر لها؟

\- legacy upsert يحذف ويعيد الإدخال، وهذا خطر على outcomes.

\- frontend حالياً يعتمد snapshot شامل، ويحتاج date-aware loading.



\## 18. Final Recommendation



التوصية النهائية:



\- نفذ TM-4 على مرحلتين.

\- TM-4A أولاً: backend scope guards لمسار القوائم الحالي، مع snapshot مفلتر، وحماية call logs/appointments، وتصحيح menu/frontend date loading.

\- أجّل Supervisor Calling إلى TM-4B أو TM-5 كـ “My Lead Calls” queue مبني على `contact\_targets + client\_assignments`.

\- لا تضف `assigned\_caller\_id` الآن إلا إذا قرر المنتج أن القوائم تسند لأشخاص محددين لا لفريق.

\- لا تنشئ Visit أو VisitTask ضمن TM-4.



أول task تنفيذي مقترح:

`Create telemarketing scope helper service` لاستخراج `currentHrUserId`, `currentEmployeeId`, والتحقق من `canAccessTaskList`, `canAccessTaskListItem`, و `ownsContactTarget`. هذا هو حجر الأساس؛ بعده تصبح حماية snapshot/call logs/appointments مباشرة وآمنة.

