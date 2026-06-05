# مهمة عرض الجهاز — `device_demo`

> **القالب المرجعي:** [`features/unified-task-template.md`](../unified-task-template.md)
> **الحالة:** Active — معتمد 2026-06-01 بعد نقاش تفصيلي لنتائج المهمة وأثرها على `open_task` و cascading.
> **الـ display_group:** مهام عرض الجهاز

---

## مدخل مفاهيمي — العلاقة بين `open_task` و `visit_task`

> **`open_task` من نوع `device_demo` للزبون = القصة الكاملة لإقناع هذا الزبون ببيع جهاز.**
> **`visit_task` = محاولة واحدة (فصل) ضمن هذه القصة.**

- القصة الواحدة تحوي **محاولة واحدة أو أكثر** (`visit_tasks` متعدّدة تحت نفس `open_task` عبر `source_open_task_id`).
- لا يجوز أن يكون لزبون أكثر من `open_task` نشط من نوع `device_demo` في آن واحد (يفرضه الفهرس الجزئي الفريد).
- كل `visit_task` جديد عند كل محاولة — لا يُعاد استخدام `visit_task` قديم (D6).
- **نتيجة `visit_task` تجيب على سؤالين:**
  1. **التاريخ:** ما الذي حدث في هذه المحاولة؟ (يُحفظ في `visit_task_results` + side tables)
  2. **المستقبل:** ما الذي يحصل للـ `open_task` الآن؟ (انعكاس على `open_task.status` + موعد جديد إن وُجد)

---

## أ — الهوية

### المحور 1
| البيان | القيمة |
|---|---|
| `task_type` | `device_demo` |
| الاسم العربي | عرض الجهاز |
| الاسم الإنجليزي | Device Demo |
| الوصف | عرض جهاز فلتر مياه على زبون مرشَّح، فحص جودة المياه، وتقديم عرض مالي (نقدي أو تقسيط) بهدف إغلاق بيع. |

### المحور 2 — `task_family`
`marketing`

### المحور 3 — `display_group`
`device_demo` (مهام عرض الجهاز)

### المحور 4 — `visit_family`
`marketing`

---

## ب — الإنشاء

### المحور 5 — `creation_origin` المسموحة
| القيمة | مسموح؟ | السيناريو |
|---|:---:|---|
| `branch_plan` | ✅ | الحالة العادية — مدير الفرع يضع الزبون في الخطة |
| `service_request_call` | ❌ | `device_demo` ليس خدمة |
| `telemarketing_inline_booking` | ✅ | تيليماركتر تضيفها لحظياً ضمن حجز موعد (bypass للخطة) |
| `cascading_during_visit` | ✅ | الفريق يضيفها داخل زيارة `in_progress` للزبون نفسه |
| `manual_creation` | ✅ | إنشاء يدوي من مدير/مشرف |
| `emergency_request` | ❌ | لا علاقة بالطوارئ |
| `system_trigger` | ❌ | لا تتولّد من إغلاق مهمة أخرى |

### المحور 6 — `location_basis`
`client` — العرض يحدث في عنوان الزبون (لا جهاز مرتبط بعد).

### المحور 7 — منطق التاريخ والنافذة

**منطق مزدوج محكوم بحالة المهمة (موجود فعلاً في schema و code — لا تغيير مطلوب):**

| `open_task.status` | التاريخ المرجعي | النافذة |
|---|---|---|
| `open` (وأي حالة غير `needs_follow_up`) | `due_date` (`required_date`) | `task_type_config.planning_window_days` = **7 أيام** |
| `needs_follow_up` | `expected_date` | **يوم واحد ثابت** (DEC-006 D36 — كل أنواع المهام) |

**القيم النهائية في `task_type_config` لـ `device_demo`:**
- `scheduling_pattern = 'short_window'`
- `window_basis = 'due_date'`
- `planning_window_days = 7`

> منطق `needs_follow_up` (نافذة يوم واحد قبل `expected_date`) عام لكل أنواع المهام ولا يُضبط لكل نوع على حدة.

### المحور 8 — التفرّد
**لا يُسمح بأكثر من `open_task` نشط من نوع `device_demo` لنفس `client_id`.** يفرضه `idx_open_tasks_unique_active`.

---

## ج — التنفيذ والنتيجة

### المحور 9 — قيم `final_decision` المسموحة (3 قيم مباشرة + محصلة مشتقة)

تُكتب على `visit_task_results.final_decision` لـ `visit_task` من نوع `device_demo`:

| القيمة | اللبيل التشغيلي | الوصف | يحتاج العرض المتعدّد؟ |
|---|---|---|:---:|
| `offer_presented` | تقديم عرض | الفريق قدّم عرضاً واحداً أو أكثر للزبون، ولكل عرض رد محدّد | ✅ |
| `rescheduled` | إعادة جدولة | الفريق وصل لكن لم يتمكّن من تقديم العرض — الزبون طلب موعداً آخر | ❌ |
| `cancelled` | إلغاء | الزيارة لم تتم ولا داعي لمتابعة هذا الزبون | ❌ |

> **قرار 2026-06-02:** لا توجد نتيجة مباشرة باسم `device_sold` في الـ wizard. البيع هو **محصلة مشتقة** من `offer_presented` عندما يملك عرض واحد أو أكثر `customer_response='accepted'`.

---

#### ① `offer_presented` — تقديم عرض (الحالة المركّبة)

**الحقول على Header (`visit_task_device_demo_results`):**
| الحقل | إلزامي | الوصف |
|---|:---:|---|
| `final_decision = 'offer_presented'` | ✅ | محسوب |
| `closed_by_employee_id` | ⚠️ | موظف التسكير إن وُجد |
| `is_device_sold` | ✅ | محسوب — TRUE إن وُجد عرض واحد `accepted` |
| ملاحظات | ❌ | textarea |

**العروض الفرعية (`customer_device_pre_offers` / روابط `open_task_pre_offers`):**
| الحقل | إلزامي | الوصف |
|---|:---:|---|
| `device_model_id` | ✅ | الجهاز المعروض |
| `offer_type` | ✅ | `cash` أو `installment` |
| `quantity` | ✅ | الكمية (default 1) |
| `total_amount` | ✅ | القيمة الكلية |
| `currency` | ✅ | العملة |
| `first_payment_amount` | ⚠️ | إلزامي إذا `installment` |
| `installment_months` | ⚠️ | إلزامي إذا `installment` |
| `discount_percentage` | ❌ | 0-100 |
| `applied_device_discount_id` | ❌ | معرّف الحسم المُطبَّق |
| `customer_response` | ✅ | `accepted` / `rejected` / `extension_requested` |
| `sale_reference_number` | ⚠️ | يُولَّد لكل عرض مقبول ويُستخدم لاحقاً لربطه بالعقد |
| `closed_by_employee_id` | ⚠️ | موظف التسكير إن أُغلِق العرض بواسطة موظف |
| `no_closing_reason_id` | ⚠️ | سبب عدم التسكير عندما لا يوجد موظف تسكير أو عند الرفض |

**الحالات الفرعية الـ 3 لـ `customer_response`:**
| القيمة | اللبيل | المعنى |
|---|---|---|
| `accepted` | تم البيع | الزبون اختار هذا العرض؛ يُولَّد له رقم بيعة ويمكن ربطه بعقد |
| `rejected` | مرفوض | الزبون رفض هذا العرض تحديداً |
| `extension_requested` | طلب مهلة | الزبون طلب وقتاً للتفكير في هذا العرض |

**قواعد دورة حياة العرض:**
- يمكن إنشاء العروض مسبقاً من تاب العروض، أو من مودل إنشاء المهمة، أو من مودل تسجيل النتيجة. كل هذه المسارات يجب أن تربط العرض بنفس دورة `device_demo`.
- عند تسجيل رد الزبون على العرض (`accepted` / `rejected` / `extension_requested`) يصبح العرض غير قابل لتعديل تفاصيله المالية/الجهازية. التصحيح يتم عبر تعديل النتيجة المصرّح به أو إضافة رد لاحق عندما تسمح دورة المهلة بذلك.
- وجود التسكير إلزامي لكل عرض مُجاب عليه: إمّا `closed_by_employee_id` أو `no_closing_reason_id` حسب الحالة.
- البيع لا يُسجَّل كـ `final_decision`. يظهر كـ `derived_outcome='device_sold'` عندما يوجد عرض مقبول واحد على الأقل.

---

#### ② `rescheduled` — إعادة جدولة

**الحقول على Header:**
| الحقل | إلزامي | الوصف |
|---|:---:|---|
| `final_decision = 'rescheduled'` | ✅ | محسوب |
| `reason_code_id` | ✅ | من فئة `customer_followup_reasons` الموجودة من DEC-006 D39 |
| `closing_notes` | ❌ | textarea |

**الحقول الإضافية على `open_task`:**
- `expected_date` يُملأ من الـ wizard
- `expected_time` يُملأ (إن وُجد)

---

#### ③ `cancelled` — إلغاء

**الحقول على Header:**
| الحقل | إلزامي | الوصف |
|---|:---:|---|
| `final_decision = 'cancelled'` | ✅ | محسوب |
| `reason_code_id` | ✅ | من فئة `visit_cancellation_reasons` (موجودة من DEC-006) |
| `closing_notes` | ⚠️ | إلزامي إذا الـ reason = "أخرى" |

---

### المحور 10 — قيم `reason_code` المسموحة

اعتماد فئات `system_lists` الموجودة قدر الإمكان — **لا فئات خاصة بـ `device_demo`**:

| `final_decision` | فئة `system_lists` | حالة الفئة | إلزامية؟ |
|---|---|---|---|
| `offer_presented` (لكل offer `rejected`) | `offer_refusal_reasons` 🆕 (مشتركة لكل المهام التي تقدّم عروضاً) | تُنشأ من شاشة `/system-lists` عند الحاجة | ⚠️ إلزامية لكل rejected |
| `rescheduled` | `customer_followup_reasons` ✅ موجودة من DEC-006 D39 (مصمَّمة لهذا الغرض بالضبط) | جاهزة | ✅ |
| `cancelled` | `visit_cancellation_reasons` ✅ موجودة من DEC-006 | جاهزة | ✅ |

> **قاعدة الفئات:** لا نولّد فئة خاصة بـ `device_demo`. لو احتاج نوع آخر فئة مماثلة، يُعاد استخدام الفئات الموجودة. الـ admin يضيف القيم من شاشة `/system-lists` (لا seed in migrations).

---

### المحور 11 — Side Tables المخصصة

| الجدول | الغرض | متى يُكتب؟ |
|---|---|---|
| `visit_task_results` | السجل العام (final_decision + reason + closing notes + closed_by) | لكل النتائج الثلاث المباشرة |
| `visit_task_device_demo_results` | تفاصيل الـ Header لمهمة عرض الجهاز | لكل النتائج الثلاث المباشرة |
| `customer_device_pre_offers` | العروض المتعدّدة وردود الزبون لكل واحد | فقط لـ `offer_presented` |
| `open_task_pre_offers` | ربط العروض بالمهمة التي تسببت بها أو عُرضت ضمنها | فقط للعروض المرتبطة بمهمة عرض جهاز |
| `contracts` | العقد الناتج | فقط لـ `offer_presented` بـ 1+ accepted |

**تعديلات مطلوبة على `visit_task_device_demo_results`:**
```sql
ALTER TABLE visit_task_device_demo_results
  ADD COLUMN reason_code_id INTEGER REFERENCES system_lists(id),
  ADD COLUMN closing_notes TEXT;
```

(الأعمدة الموجودة كافية للحالات الأخرى — لا حاجة لتغيير الـ schema الأساسي.)

---

## د — التأثير الجانبي

### المحور 12 — انعكاس النتيجة على `open_task.status`

| `final_decision` | السيناريو | `open_task.status` بعد | حقول إضافية تُحدَّث |
|---|---|---|---|
| `offer_presented` | ≥1 عرض `accepted` | `completed` | `last_waiting_status` |
| `offer_presented` | 0 accepted + ≥1 `extension_requested` | `needs_follow_up` | `expected_date` يُملأ |
| `offer_presented` | كل العروض `rejected` | `completed` | `last_waiting_status` (الوعد أُنجز — قُدّم العرض ورُفض) |
| `rescheduled` | (وحيد) | `needs_follow_up` | `expected_date` + `expected_time` |
| `cancelled` | (وحيد) | `cancelled` | `cancellation_reason` |

> **قاعدة "القصة المستمرة":** الـ `open_task` نفسه يبقى حياً عند `needs_follow_up`. عندما يأتي موعد المتابعة، يُفتح **`visit_task` جديد بالكامل** تحت **نفس `open_task`** — لا يُنشأ `open_task` جديد. هذا هو "تكرار الـ lifecycle" مع توثيق المحاولة السابقة.

### المحور 13 — Cascading Effects

| المُطلِق | الـ artifact المولَّد |
|---|---|
| `offer_presented` بـ 1+ accepted | (أ) عقد جديد في `contracts` <br/> (ب) `open_task` جديد بـ `task_type='device_delivery'` و `creation_origin='system_trigger'` <br/> (ج) عند إكمال delivery: `open_task` جديد بـ `task_type='device_installation'` <br/> (د) عند إكمال installation: `open_task` جديد بـ `task_type='device_activation'` |
| لو `offer_type='installment'` على العرض المقبول | `open_task` جديد بـ `task_type='collection'` للقسط الأول، `required_date` من جدول الأقساط |
| `offer_presented` (0 accepted) | **لا cascading** |
| `rescheduled` | **لا cascading** — فقط `expected_date` يُملأ |
| `cancelled` | **لا cascading** |

> **ملاحظة:** المهام المُولَّدة (`delivery`, `installation`, `activation`, `collection`) هي **`open_tasks` جديدة منفصلة بأنواع مختلفة** — وليست تكراراً لقصة `device_demo`. كل واحدة قصتها الخاصة.

### المحور 13.1 — التصنيف التشغيلي للزبون `FOP`

لا يصبح الزبون `FOP` لمجرد وجود زيارة أو مهمة عرض جهاز. القاعدة المعتمدة:

> الزبون يصبح `FOP` فقط إذا وُجدت مهمة `device_demo` مغلقة إدارياً (`closed`) ونتيجتها `offer_presented`.

البيع الفعلي داخل هذه النتيجة يُقرأ من العروض المقبولة، وليس من قيمة `device_sold` مباشرة. اكتمال الزيارة أو اكتمال النتيجة قبل الإقفال لا يكفي وحده لتصنيف الزبون `FOP`.

### المحور 13.2 — عرض النتيجة في تفاصيل المهمة

- تاب التواصل والمتابعة يعرض التواصل، النشاط، والملاحظات فقط.
- تاب النتيجة يعرض ملخص النتيجة الحالية على مستوى `open_task`، ثم محاولات التنفيذ السابقة كـ `visit_tasks` منفصلة تحت نفس القصة.
- تفاصيل العروض تظهر داخل تاب النتيجة فقط عندما تكون `final_decision='offer_presented'`. في حالات `rescheduled` و `cancelled` تُخفى تفاصيل العروض لأن لها تاباً مستقلاً باسم تفاصيل العرض.
- زر `تسجيل نتيجة الزيارة` يظهر فقط عندما تكون هناك زيارة مرتبطة ومحاولة أحدث بلا نتيجة، وحالة الزيارة تسمح بالتنفيذ (`in_progress` أو `ended`) وحالة `open_task` ليست مغلقة/مكتملة/ملغاة.
- إذا عادت المهمة إلى `needs_follow_up` بسبب إعادة جدولة أو مهلة، لا يُعاد استخدام نفس `visit_task`; عند الموعد التالي تُنشأ محاولة زيارة جديدة تحت نفس `open_task`.

---

## هـ — الصلاحيات

### المحور 14
| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| إنشاء `open_task` يدوياً | `open_tasks.edit` | مدير الفرع / تيليماركتر |
| تنفيذ `visit_task` ميدانياً | `field_visits.execute` | **مشرف الفريق القياسي** (V-R011 — لا يُنفَّذ بفريق طوارئ) |
| تسجيل النتيجة | `field_visits.execute` | مشرف الفريق المسؤول |
| الإقفال الإداري النهائي (`closed`) | `field_visits.update_result` | مشرف / مدير |
| فتح `closed` | `field_visits.reopen_closed` | إدارة عليا |

---

## التنفيذ التقني — Endpoint موحَّد

```
POST /field-visits/:visitId/tasks/:taskId/result
```

Body موحَّد بـ discriminator على `final_decision`. الـ service الواحد يكتب:
1. `visit_task_results`
2. `visit_task_device_demo_results`
3. `customer_device_pre_offers` + `open_task_pre_offers` (إن لزم)
4. `contracts` (إن لزم)
5. Reflection على `open_task.status`
6. Cascading `open_tasks` جديدة
7. `checkAndCompleteVisit(visitId)` لإنهاء الزيارة آلياً عند استيفاء الشروط

الكل داخل transaction واحدة.

> **ملاحظة عن الـ Wizard:** الـ wizard الحالي في [`MarketingVisitOutcomeModal.tsx`](../../../../packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx) يعتمد 3 نتائج مباشرة فقط. البيع يظهر ضمن خطوة العروض كرد زبون على عرض محدد، ثم يُشتق كـ `derived_outcome` عند وجود عرض مقبول.

---

## قائمة الفحص (Release Checklist)

- [x] صف في `task_type_config` بقيم: `task_type='device_demo'`, `task_family='marketing'`, `location_basis='client'`.
- [ ] إضافة `display_group='device_demo'` لـ `task_type_config` (migration).
- [ ] إضافة `lead_window_days=7` (migration).
- [x] CHECK constraint على `visit_tasks.task_type` يشمل `device_demo`.
- [x] side table `visit_task_device_demo_results` موجودة.
- [ ] إضافة `reason_code_id` + `closing_notes` على side table (migration).
- [ ] CHECK على `visit_task_results.final_decision` يشمل القيم الثلاث المباشرة: `offer_presented`, `rescheduled`, `cancelled`.
- [ ] فئة `offer_refusal_reasons` تُنشأ من شاشة `/system-lists` (لا migration).
- [ ] `services/visitTaskResultReflection.ts` يحوي `applyDeviceDemoResult()`.
- [ ] endpoint `POST /field-visits/:visitId/tasks/:taskId/result` يستدعي الـ service.
- [ ] الـ wizard الحالي معاد توصيله للـ endpoint الجديد.
- [ ] `TaskResultTab` يقرأ النتيجة الجديدة بدلاً من القيم القديمة.
- [x] الصلاحيات الأربع موجودة.

---

## المراجع
- [القالب الموحَّد](../unified-task-template.md)
- [`domains/tasks.md`](../../domains/tasks.md) — دورة الحياة بـ 11 حالة
- [`domains/visits.md`](../../domains/visits.md) — نموذج الزيارة
- [`domains/open-tasks.md`](../../domains/open-tasks.md) — schema تفصيلي
- [`decisions/DEC-007-visit-structure-list-and-survey.md`](../../decisions/DEC-007-visit-structure-list-and-survey.md) — `final_decision` كحارس إكمال الزيارة
