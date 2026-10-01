\## 1. Goal Summary



\- فصل نتيجة الاتصال إلى نموذج واضح بدل قائمة مسطحة تخلط: الوصول للرقم، جودة الرقم، قرار الزبون، المتابعة، الصيانة، والحجز.

\- تحسين UX للتيلماركتر بحيث يختار نتيجة مفهومة وموجهة، مع تحديث حالة الرقم فقط عند الحاجة.

\- جعل `call\_logs.outcome` مفيداً للتقارير، لا مجرد `rejected/busy/no\_answer/booked`.

\- الحفاظ على مسار TM الحالي وعدم تعطيل Marketing Visit القادم.

\- تأجيل التحويلات الكبيرة مثل خدمة الزبائن، زيارات التسويق، و VisitTasks.



\## 2. Current Outcome Model Inspection



الملفات المفحوصة:

\- \[OutcomeRecorderModal.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/components/telemarketing/OutcomeRecorderModal.tsx)

\- \[TelemarketerWorkspace.tsx](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/pages/TelemarketerWorkspace.tsx)

\- \[useTelemarketingStore.ts](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/web/src/hooks/useTelemarketingStore.ts)

\- \[types.ts](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/shared/types.ts)

\- \[telemarketing.ts](D:/OneDrive/سطح%20المكتب/golden-crm-clean/packages/api/routes/telemarketing.ts)

\- \[001\_core\_tables.sql](D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/001\_core\_tables.sql)

\- \[045\_contact\_targets.sql](D:/OneDrive/سطح%20المكتب/golden-crm-clean/migrations/045\_contact\_targets.sql)



\*\*القيم الحالية\*\*

\- `CallOutcome = 'no\_answer' | 'busy' | 'rejected' | 'booked'`.

\- هذه القيم hardcoded في `OutcomeRecorderModal`.

\- DB constraint في `telemarketing\_call\_logs.outcome` يسمح فقط بـ:

&#x20; `no\_answer`, `busy`, `rejected`, `booked`.

\- `telemarketing\_task\_list\_items.status` يسمح فقط بـ:

&#x20; `pending`, `called`, `booked`.

\- `telemarketing\_task\_list\_items.call\_outcome` لا يظهر عليه check مستقل في `001\_core\_tables.sql`، لكنه عملياً يعتمد على نفس enum في TS.



\*\*كيف يتغير item.status الآن\*\*

\- `booked` → item status يصبح `booked`.

\- `rejected` → item status يصبح `called`.

\- `no\_answer` أو `busy` → يبقى `pending` حتى 3 محاولات، بعدها يصبح `called`.

\- هذا المنطق في `TelemarketerWorkspace`.



\*\*كيف يتغير contact\_targets.status الآن\*\*

\- `rejected` → `closed`.

\- `no\_answer` أو `busy` → إذا كان `new/queued/in\_call\_list` يصبح `contacted`.

\- `booked` في call log يحدّث `latest\_call\_outcome` فقط.

\- appointment creation هي التي تجعل `contact\_targets.status = booked`.



\*\*booked flow الحالي\*\*

\- المستخدم يسجل outcome = `booked`.

\- الـ item يصبح `booked`.

\- بعدها زر جدولة الموعد يصبح فعالاً.

\- عند إنشاء appointment، contact target يصبح `booked`.



\*\*الفرق بين item.status و call\_outcome\*\*

\- `item.status` هو حالة العمل على العنصر: هل ما زال pending أو صار called أو booked.

\- `call\_outcome` هو آخر نتيجة اتصال.

\- النموذج الحالي يخلط أحياناً: `booked` كـ outcome يجعل item booked قبل وجود appointment فعلي.



\## 3. Phone / Contact Number Model Inspection



\*\*أين تخزن الأرقام؟\*\*

\- `clients.mobile` حقل legacy / canonical.

\- `clients.contacts` JSONB.

\- لا يوجد جدول مستقل للأرقام.



\*\*شكل contact في shared types\*\*

```ts

type ContactStatus = 'active' | 'preferred' | 'out-of-coverage' | 'unused' | 'invalid';



interface ContactEntry {

&#x20; id: string;

&#x20; type: 'mobile' | 'landline' | 'other';

&#x20; number: string;

&#x20; areaCode?: string;

&#x20; label: string;

&#x20; hasWhatsApp: boolean;

&#x20; isPrimary: boolean;

&#x20; status: ContactStatus;

}

```



\*\*هل يمكن تعدد الأرقام؟\*\*

\- نعم، `contacts: ContactEntry\[]`.



\*\*هل كل رقم له id؟\*\*

\- نعم في JSON الحديث.

\- لكن عند fallback للبيانات القديمة يوجد id اصطناعي: `legacy-fallback`.

\- هذا لا يمكن تحديثه بثقة داخل JSON إلا إذا تم تحويله إلى contact فعلي.



\*\*هل يوجد status لكل رقم؟\*\*

\- نعم: `active`, `preferred`, `out-of-coverage`, `unused`, `invalid`.



\*\*هل يوجد preferred flag؟\*\*

\- يوجد `isPrimary`.

\- ويوجد أيضاً status = `preferred`.

\- هذا يعني أن هناك مفهومين متداخلين: primary للعرض/الرقم الرئيسي، و preferred كحالة.



\*\*هل backend يستطيع تحديث رقم واحد؟\*\*

\- لا يوجد endpoint متخصص لتحديث contact واحد.

\- المتاح حالياً `PUT /api/clients/:id` يحدّث كامل client payload بما فيه `contacts`.

\- الواجهة حالياً تعدل contacts محلياً ثم ترسل `updateClient`.



\*\*أي رقم يستخدمه task list item؟\*\*

\- `telemarketing\_task\_list\_items.contact\_number`.

\- يأتي من `getLeadPhone`: primary contact ثم `lead.mobile` ثم أول contact.

\- هذا يحفظ الرقم كنص، وليس contact id.



\*\*هل يمكن ربط outcome بالرقم المستخدم بدقة؟\*\*

\- جزئياً.

\- الـ modal يرسل `contactId` للواجهة، لكنه لا يُحفظ في call log.

\- call log يحفظ `contact\_label/contact\_number` فقط.

\- لذلك التحديث الدقيق ممكن في الواجهة أثناء الجلسة لأن `selectedContactId` معروف، لكنه غير قابل للتتبع لاحقاً من DB بدون `contact\_id`.



\## 4. Business Outcome Classification



النموذج المقترح:



```ts

outcomeCategory:

&#x20; not\_reached | reached | booked



outcomeCode:

&#x20; no\_answer

&#x20; wrong\_number

&#x20; busy

&#x20; out\_of\_coverage

&#x20; not\_in\_service

&#x20; auto\_disconnected

&#x20; address\_updated

&#x20; currently\_busy

&#x20; interrupted

&#x20; not\_interested

&#x20; company\_customer\_missing\_phone

&#x20; company\_customer\_service\_request

&#x20; other\_company\_not\_interested

&#x20; other\_company\_callback

&#x20; other\_company\_service\_request

&#x20; seen\_offer\_not\_interested

&#x20; seen\_offer\_callback

&#x20; booked\_marketing\_appointment



phoneStatusUpdate:

&#x20; none | preferred | active | out\_of\_coverage | not\_in\_use | wrong\_value



nextAction:

&#x20; retry\_later | close\_target | request\_appointment | transfer\_to\_service | update\_address | needs\_follow\_up | no\_action

```



\*\*Mapping كامل للقائمة\*\*

| نتيجة الاتصال | ملاحظة الاتصال | category | outcomeCode | phoneStatusUpdate | nextAction |

|---|---|---|---|---|---|

| لم يتم التواصل | لم يرد احد على الاتصال | not\_reached | no\_answer | none | retry\_later |

| لم يتم التواصل | رقم موبايل خاطئ | not\_reached | wrong\_number | wrong\_value | needs\_follow\_up |

| لم يتم التواصل | الرقم مشغول | not\_reached | busy | none | retry\_later |

| لم يتم التواصل | الرقم خارج التغطية | not\_reached | out\_of\_coverage | out\_of\_coverage | retry\_later |

| لم يتم التواصل | رقم غير موضوع بالخدمة | not\_reached | not\_in\_service | not\_in\_use | needs\_follow\_up |

| لم يتم التواصل | فصل تلقائي | not\_reached | auto\_disconnected | none | retry\_later |

| تم التواصل | العنوان مخالف / تم التعديل | reached | address\_updated | active | update\_address |

| تم التواصل | مشغول حاليا | reached | currently\_busy | active | retry\_later |

| تم التواصل | انقطع الاتصال و لم تتم مكالمة | reached | interrupted | active | retry\_later |

| تم التواصل | غير مهتم بالفكرة | reached | not\_interested | active | close\_target |

| تم التواصل | زبون شركة - رقم غير موجود لدينا | reached | company\_customer\_missing\_phone | active | close\_target |

| تم التواصل | زبون شركة - طلب صيانة | reached | company\_customer\_service\_request | active | transfer\_to\_service |

| تم التواصل | عنده جهاز من شركة اخرى و غير مهتم | reached | other\_company\_not\_interested | active | close\_target |

| تم التواصل | عنده جهاز من شركة اخرى و طلب معاودة الاتصال | reached | other\_company\_callback | active | needs\_follow\_up |

| تم التواصل | عنده جهاز من شركة اخرى - طلب صيانة | reached | other\_company\_service\_request | active | transfer\_to\_service |

| تم التواصل | شايف العرض سابقا و بيعرف الشركة غير مهتم | reached | seen\_offer\_not\_interested | active | close\_target |

| تم التواصل | شايف العرض سابقا و طلب معاودة الاتصال لاحقا | reached | seen\_offer\_callback | active | needs\_follow\_up |

| تم التواصل | تم تحديد موعد تسويق APP | booked | booked\_marketing\_appointment | preferred أو none | request\_appointment |



\## 5. Lifecycle Impact Proposal



| outcomeCode | item.status | item.call\_outcome | contact\_target.status | appointment modal | phone status required | notes required | remains callable |

|---|---|---|---|---|---|---|---|

| `no\_answer` | `pending` | `no\_answer` | `contacted` | no | no | no | yes |

| `busy` | `pending` | `busy` | `contacted` | no | no | no | yes |

| `out\_of\_coverage` | `pending` | `out\_of\_coverage` | `contacted` أو `no\_valid\_phone` لاحقاً | no | yes | no | yes if another valid phone |

| `wrong\_number` | `called` أو `pending` if other phone | `wrong\_number` | `contacted` أو `no\_valid\_phone` لاحقاً | no | yes | yes preferred | yes if another valid phone |

| `not\_in\_service` | `called` أو `pending` if other phone | `not\_in\_service` | `contacted` أو `no\_valid\_phone` لاحقاً | no | yes | no | yes if another valid phone |

| `auto\_disconnected` | `pending` | `auto\_disconnected` | `contacted` | no | no | no | yes |

| `currently\_busy` | `pending` | `currently\_busy` | `contacted` | no | optional active | no | yes |

| `interrupted` | `pending` | `interrupted` | `contacted` | no | optional active | no | yes |

| `address\_updated` | `pending` أو `called` | `address\_updated` | `contacted` | no | optional active | yes | yes |

| `not\_interested` | `called` | `not\_interested` | `closed` | no | optional active | no | no |

| `company\_customer\_missing\_phone` | `called` | same | `closed` أو `needs\_review` لاحقاً | no | optional | yes | no |

| `company\_customer\_service\_request` | `called` | same | `closed` أو `transferred` لاحقاً | no | optional active | yes | no marketing call |

| `other\_company\_not\_interested` | `called` | same | `closed` | no | optional active | no | no |

| `other\_company\_callback` | `pending` | same | `contacted` أو `follow\_up` لاحقاً | no | optional active | yes with follow-up time | yes |

| `other\_company\_service\_request` | `called` | same | `closed` أو `transferred` لاحقاً | no | optional active | yes | no marketing call |

| `seen\_offer\_not\_interested` | `called` | same | `closed` | no | optional active | no | no |

| `seen\_offer\_callback` | `pending` | same | `contacted` أو `follow\_up` لاحقاً | no | optional active | yes with follow-up time | yes |

| `booked\_marketing\_appointment` | الأفضل يبقى `pending/contacted` حتى appointment succeeds، أو `booked` مؤقتاً | same | لا يصبح `booked` إلا بعد appointment | yes | optional preferred | no | no after booked |



ملاحظة مهمة:

\- حالياً `booked` كـ outcome يجعل item `booked` قبل إنشاء appointment. الأفضل في redesign ألا يصبح `contact\_target.status = booked` إلا بعد نجاح appointment، وهذا موجود حالياً في backend.

\- لكن frontend يجعل item booked قبل appointment. هذا risk UX/consistency.



\## 6. Contact Target Status Gaps



الحالي في migration 045:

\- `new`

\- `queued`

\- `in\_call\_list`

\- `contacted`

\- `booked`

\- `closed`

\- `cancelled`



\*\*statuses المقترحة\*\*

| status | Required now? | Can encode now? | Migration? | MVP decision |

|---|---:|---:|---:|---|

| `follow\_up` | مفيد جداً | نعم عبر `status=contacted` + outcomeCode callback | نعم إذا أضفناه | defer |

| `needs\_review` | مفيد لحالات شركة/عنوان/رقم غريب | نعم عبر latest\_call\_outcome + notes | نعم | defer |

| `transferred` | مطلوب لاحقاً لخدمة الزبائن | حالياً عبر `closed` + outcome service\_request | نعم | defer |

| `no\_valid\_phone` | مفيد إذا كل الأرقام غير صالحة | يمكن حسابه من contacts statuses | نعم | defer |



أسرع MVP:

\- لا نغير `contact\_targets.status`.

\- نستخدم status الحالي:

&#x20; - active/follow-up cases → `contacted`

&#x20; - closed decisions → `closed`

&#x20; - booked → `booked` فقط بعد appointment.

\- نحفظ التفاصيل في `latest\_call\_outcome`/`call\_logs.outcome`.



\## 7. Phone Status Update UX



\*\*متى يظهر تحديث حالة الرقم؟\*\*

\- عند outcomes التي تخص جودة الرقم:

&#x20; - `wrong\_number`

&#x20; - `out\_of\_coverage`

&#x20; - `not\_in\_service`

\- اختيارياً عند:

&#x20; - `booked\_marketing\_appointment` لتمييز الرقم كمفضل.

&#x20; - `currently\_busy/interrupted` لتأكيد active، لكن لا أنصح أن يكون mandatory.



\*\*هل يكون mandatory؟\*\*

\- نعم للأرقام السيئة:

&#x20; - wrong\_number → `wrong\_value`

&#x20; - not\_in\_service → `not\_in\_use`

&#x20; - out\_of\_coverage → `out\_of\_coverage`

\- لا لباقي الحالات.



\*\*قبل أم بعد حفظ call log؟\*\*

\- الأفضل قبل الحفظ في نفس modal، حتى لا نحفظ log ثم نفشل بتحديث الرقم.

\- لكن إذا أردنا أقل تغيير، يمكن حفظ call log أولاً ثم تحديث contact، مع خطر partial update.

\- MVP الأفضل: gather all data first، ثم `onSave`.



\*\*booked هل يجعل الرقم preferred تلقائياً؟\*\*

\- لا تلقائياً في MVP.

\- الأفضل إظهار checkbox: “اجعل هذا الرقم مفضلاً”.

\- إذا الوقت ضيق: لا تغير phone status عند booked.



\## 8. Backend API Proposal for Phone Status



الحالي لا يوجد endpoint متخصص. المتاح `PUT /api/clients/:id`.



\### Option A: endpoint متخصص

`PATCH /api/clients/:clientId/contacts/:contactId/status`



Body:

```json

{

&#x20; "status": "wrong\_value",

&#x20; "isPrimary": false

}

```



مشكلة: قيم المنتج `wrong\_value/not\_in\_use` تختلف عن قيم الكود الحالية `invalid/unused`.



Permission:

\- `clients.edit` أو permission أخف لاحقاً مثل `clients.contacts.edit`.

\- Scope: نفس `canEditClient`.



Files:

\- `packages/api/routes/clients.ts`

\- `packages/shared/types.ts`

\- `packages/web/src/lib/api.ts`



Risk:

\- يحتاج تحديث JSONB safely.

\- جيد على المدى المتوسط.



\### Option B: endpoint JSON عام

`PATCH /api/clients/:clientId/contact-status`



Body:

```json

{

&#x20; "contactId": "abc",

&#x20; "status": "invalid"

}

```



Pros:

\- أسهل.

\- لا يحتاج nested route.



Cons:

\- أقل REST clarity.



\### Option C: reuse client update

\- الواجهة تعدل `contacts` ثم تستدعي `api.clients.update`.

\- هذا موجود فعلياً في `TelemarketerWorkspace`.



Pros:

\- لا backend جديد.

\- أسرع MVP.



Cons:

\- يحتاج client كامل وصلاحية edit.

\- قد يلمس حقولاً كثيرة.

\- خطر race condition.



توصية MVP:

\- استخدم الموجود إذا كان الوقت ضيقاً، لكن نظف mapping.

\- بعد Marketing Visit أضف endpoint متخصص.



\## 9. Outcome Recording API Changes



\### Option A: keep `call\_logs.outcome` as outcomeCode

Pros:

\- أقل تغيير.

\- يحتاج migration لتوسيع DB check فقط.

\- التقارير تصبح أفضل مباشرة.

Cons:

\- category/nextAction تستنتج من mapping في الكود.



\### Option B: structured columns

`outcome\_category`, `outcome\_code`, `phone\_status\_update`, `next\_action`

Pros:

\- تقارير ممتازة.

Cons:

\- migration أكبر، API أكبر، وقت أطول.



\### Option C: JSON metadata

`metadata JSONB`

Pros:

\- مرن وسريع نسبياً.

Cons:

\- أقل صرامة في التقارير.



\### Option D: frontend mapping فقط

Pros:

\- لا migration.

Cons:

\- غير ممكن إذا DB check يمنع القيم الجديدة.

\- سنبقى محصورين بـ 4 outcomes.



التوصية:

\- MVP عملي: توسيع `call\_logs.outcome` و `task\_list\_items.call\_outcome` ليستوعبا `outcomeCode`.

\- لا تضف structured columns الآن.

\- حافظ على mapping ثابت في shared/frontend/backend.



\## 10. Appointment Flow Impact



السلوك الأفضل:

1\. المستخدم يختار `booked\_marketing\_appointment`.

2\. لا نغلق target كـ booked فوراً.

3\. نفتح appointment modal.

4\. إذا appointment نجح:

&#x20;  - نسجل call log booked أو نؤكده.

&#x20;  - item.status = `booked`.

&#x20;  - contact\_target.status = `booked`.

5\. إذا appointment فشل:

&#x20;  - لا يصبح target booked.

&#x20;  - item لا يبقى booked كذباً.



الحالي:

\- outcome booked يحفظ call log ويجعل item booked.

\- بعدها appointment منفصل.

\- إذا appointment فشل، item قد يبقى booked.



توصية MVP:

\- لا تعيد بناء كامل flow الآن.

\- لكن اجعل `booked` outcome يفتح appointment modal مباشرة، واجعل final booked status بعد appointment success إن أمكن.

\- إذا هذا كبير، اتركه مؤقتاً مع تحذير واضح كـ risk قبل Marketing Visit.



\## 11. Reporting Impact



النموذج الجديد يدعم:

\- Reachability: `not\_reached` vs `reached` vs `booked`.

\- Phone quality: `wrong\_number`, `out\_of\_coverage`, `not\_in\_service`.

\- Interest: `not\_interested`, `callback`, `booked`.

\- Booking rate: booked appointments / reached calls.

\- Service transfer: service\_request outcomes.

\- Follow-up: callback later outcomes.



Minimum fields للتقارير:

\- `call\_logs.outcome` كـ outcomeCode.

\- mapping ثابت إلى category/nextAction.

\- `communication\_method`.

\- `contact\_number`.

\- `contact\_target\_id`.

\- `timestamp`.

\- لاحقاً: `phone\_status\_update` أو metadata.



\## 12. Minimal MVP Recommendation



بسبب ضغط الوقت قبل Marketing Visit:



\*\*نفذ الآن\*\*

\- توسيع قائمة النتائج في UI بشكل grouped.

\- استخدام `call\_logs.outcome` كـ `outcomeCode`.

\- توسيع DB check للقيم الجديدة.

\- تحديث frontend lifecycle mapping:

&#x20; - retry outcomes تبقى pending.

&#x20; - close outcomes تصبح called/closed.

&#x20; - service outcomes لا تنشئ appointment.

&#x20; - booked يفتح appointment.

\- تحديث حالة الرقم فقط لحالات:

&#x20; - wrong\_number → `invalid`

&#x20; - not\_in\_service → `unused`

&#x20; - out\_of\_coverage → `out-of-coverage`



\*\*لا تنفذ الآن\*\*

\- structured outcome columns.

\- `follow\_up` status migration.

\- service task transfer.

\- phone contact endpoint متخصص إذا كان استخدام `updateClient` كافياً.

\- Visit creation.



\*\*Outcome codes MVP\*\*

\- `no\_answer`

\- `busy`

\- `wrong\_number`

\- `out\_of\_coverage`

\- `not\_in\_service`

\- `auto\_disconnected`

\- `currently\_busy`

\- `interrupted`

\- `not\_interested`

\- `other\_company\_not\_interested`

\- `other\_company\_callback`

\- `seen\_offer\_not\_interested`

\- `seen\_offer\_callback`

\- `service\_request`

\- `address\_updated`

\- `booked\_marketing\_appointment`



اختصار بعض customer rows:

\- اجمع كل طلبات الصيانة تحت `service\_request` في MVP.

\- اجمع company service و other company service تحت نفس الكود، مع notes للتفصيل.



\## 13. Task Breakdown



\### Task 1: Define outcome model constants

Goal: إنشاء mapping واحد للنتائج.

Files likely:

\- `packages/shared/types.ts`

\- ربما ملف جديد shared مثل `telemarketingOutcomes.ts`



Change:

\- توسيع `CallOutcome`.

\- تعريف labels/category/nextAction/phoneStatusUpdate.



Do NOT:

\- لا تضف Visit/VisitTask.



Risk: Medium بسبب DB constraints.



Acceptance:

\- كل outcome له label/category/lifecycle mapping.



\### Task 2: DB constraint migration for outcomes

Goal: السماح بالقيم الجديدة.

Files:

\- `migrations/0xx\_telemarketing\_outcome\_codes.sql`



Change:

\- تحديث check constraint على `telemarketing\_call\_logs.outcome`.

\- إن وجد constraint على `telemarketing\_task\_list\_items.call\_outcome` حدّثه، وإن لم يوجد لا تضف إلا إذا قررنا.



Do NOT:

\- لا تضف structured columns الآن.



Risk: Medium.



Acceptance:

\- old values تبقى valid.

\- new outcome codes تقبل.



\### Task 3: Replace flat modal options with grouped UX

Goal: نتائج مرتبة حسب: لم يتم التواصل / تم التواصل / حجز.

Files:

\- `OutcomeRecorderModal.tsx`



Change:

\- عرض grouped outcome choices.

\- إلزام notes لبعض الحالات.

\- إلزام phone status في number-quality outcomes.



Do NOT:

\- لا تعيد تصميم workspace.



Risk: Medium.



Acceptance:

\- المستخدم لا يرى قائمة مسطحة مربكة.



\### Task 4: Phone status update mapping

Goal: تحديث الرقم المحدد عند نتائج جودة الرقم.

Files:

\- `OutcomeRecorderModal.tsx`

\- `TelemarketerWorkspace.tsx`

\- possibly `contactRules.ts`



Change:

\- map product statuses:

&#x20; - `wrong\_value` → `invalid`

&#x20; - `not\_in\_use` → `unused`

&#x20; - `out\_of\_coverage` → `out-of-coverage`

&#x20; - `preferred` → `preferred`

&#x20; - `active` → `active`



Do NOT:

\- لا تضف endpoint إذا قررنا reuse `updateClient`.



Risk: Medium بسبب JSON contacts.



Acceptance:

\- الرقم المختار فقط تتغير حالته.



\### Task 5: Update frontend lifecycle mapping

Goal: item status حسب outcomeCode.

Files:

\- `TelemarketerWorkspace.tsx`



Change:

\- retry outcomes → `pending`.

\- close outcomes → `called`.

\- booked → appointment flow.

\- service\_request → `called` ولا appointment.



Do NOT:

\- لا تنشئ service task.



Risk: High around booked flow.



Acceptance:

\- لا يتم حجز موعد لحالات service/not interested.



\### Task 6: Backend lifecycle rules

Goal: `contact\_targets.status` يتغير حسب outcomeCode.

Files:

\- `packages/api/routes/telemarketing.ts`



Change:

\- close outcomes → `closed`.

\- retry/follow-up outcomes → `contacted`.

\- booked outcome لا يجعل status booked إلا appointment.

\- latest\_call\_outcome يحفظ outcomeCode.



Do NOT:

\- لا تضف supervisor direct calling.



Risk: Medium.



Acceptance:

\- contact target lifecycle متسق.



\### Task 7: Keep appointment flow stable

Goal: booked لا يكسر appointment.

Files:

\- `TelemarketerWorkspace.tsx`

\- `AppointmentSchedulerModal.tsx` if needed



Change:

\- فتح appointment بعد booked.

\- status booked بعد appointment success إن أمكن.



Do NOT:

\- لا تنشئ Visit.



Risk: Medium/High.



Acceptance:

\- فشل appointment لا يترك target booked إن أمكن.



\### Task 8: TypeScript and manual validation

Goal: ضمان عدم كسر الواجهة والـ API.

Files:

\- لا ملفات جديدة.



Acceptance:

\- API TS passes.

\- Web TS passes.

\- Manual tests listed below pass.



\## 14. Testing Plan



\- `no\_answer`: يحفظ outcome، item يبقى pending، target يبقى callable.

\- `busy`: يحفظ outcome، item يبقى pending.

\- `wrong\_number`: يطلب phone status، يحدث الرقم إلى `invalid`.

\- `not\_in\_service`: يحدث الرقم إلى `unused`.

\- `out\_of\_coverage`: يحدث الرقم إلى `out-of-coverage`.

\- `not\_interested`: يغلق contact target.

\- `other\_company\_callback`: يبقي الهدف مفتوحاً.

\- `seen\_offer\_callback`: يبقي الهدف مفتوحاً.

\- `service\_request`: لا يفتح appointment ولا ينشئ marketing visit.

\- `booked\_marketing\_appointment`: يفتح appointment modal، وعند نجاح الموعد يصبح target booked.

\- old outcomes `no\_answer/busy/rejected/booked` لا تكسر UI.

\- old call logs تظهر labels fallback.



\## 15. Risks and Open Questions



\- بعض contacts قد تكون legacy fallback بلا id حقيقي.

\- `contact\_number` في task item لا يحفظ `contactId`.

\- تحديث الرقم عبر `updateClient` قد يكون ثقيلاً ويحتاج `clients.edit`.

\- DB outcome check يمنع القيم الجديدة حتى migration.

\- لا يوجد `follow\_up` status حالياً.

\- booked flow الحالي يجعل item booked قبل appointment.

\- service transfer لا يوجد له module الآن.

\- address update يحتاج UI مستقلة أو ربط بتعديل عنوان العميل.

\- هل `preferred` يجب أن يغير `isPrimary` أيضاً أم فقط `status=preferred`؟

\- هل “زبون شركة - رقم غير موجود لدينا” يغلق الهدف أم يحتاج review؟



\## 16. Final Recommendation



النموذج الموصى:

\- `outcomeCode` هو القيمة المحفوظة في `call\_logs.outcome`.

\- `outcomeCategory`, `phoneStatusUpdate`, `nextAction` تكون mapping في shared code في MVP.

\- لا نضيف structured DB columns الآن.

\- نوسع DB check للقيم الجديدة فقط.

\- نستخدم contact statuses الحالية:

&#x20; - `preferred`

&#x20; - `active`

&#x20; - `out-of-coverage`

&#x20; - `unused`

&#x20; - `invalid`



أسرع MVP:

\- grouped outcome UI.

\- outcomeCode موسع.

\- phone status mandatory فقط لأخطاء الرقم.

\- close/follow-up/booked lifecycle mapping.

\- لا Customer Service transfer فعلي.

\- لا Visit creation.



أول مهمة تنفيذية دقيقة:

\*\*Create shared telemarketing outcome model\*\* يحتوي outcome codes + labels + lifecycle mapping + phone status mapping، ثم استخدامه في `OutcomeRecorderModal` بدل `outcomeConfig` الحالي.

