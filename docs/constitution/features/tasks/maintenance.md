# مهام الصيانة — `emergency_maintenance` و `periodic_maintenance`

> **القالب المرجعي:** [`features/tasks/device-demo.md`](./device-demo.md)
> **الحالة:** Discussion Draft — افتُتح النقاش 2026-06-03 بعد فحص التنفيذ القائم للطوارئ
> **الـ display_group المقترح:** `maintenance` (يجمع النوعَين في الواجهة)

---

## مدخل مفاهيمي — الصيانة في Golden CRM

> **الصيانة ليست نوعاً واحداً، بل وعاء مشترك تحت عائلة `service` يحوي نوعَين متمايزَين على مستوى `open_tasks` ومتداخلَين حدثياً على مستوى التنفيذ.**

- **`emergency_maintenance`** = استجابة لبلاغ زبون عن عطل في جهاز مُركَّب.
- **`periodic_maintenance`** = زيارة مخطَّطة وفق `maintenance_plan` على العقد + `installed_devices.warranty_visits` المتبقية.

### القاعدة الحاكمة المقترَحة

> النوعان **منفصلان على مستوى `open_tasks`** (لأن المُطلِق والـ lifecycle و capability الفريق مختلفة)،
> **يتقاسمان منظومة النتيجة الميدانية** (`device_technical_states` + actions + parts + financials)،
> **يتفاعلان حدثياً عبر آليتين:**
> 1. تبديل قطعة `maintenance_type='Periodic'` (في أيٍّ من النوعين) ⇒ تأجيل الدورية القادمة.
> 2. اكتشاف عطل أثناء أي زيارة ⇒ يَنضمّ بنداً للائحة الأعطال (`added_during_phase = 'field_discovery'`) داخل نفس المهمة، لا `visit_task` جديد ولا `open_task` جديد.

### لماذا الفصل ضروري دستورياً

| السبب | المرجع |
|---|---|
| capability الفريق محصورة بالطارئة على فريق الطوارئ | DEC-006 D31 (planning.md PL-R011) |
| `creation_origin` متباينة (`emergency_request`/`service_request_call` للطارئة، `system_trigger` للدورية) | DEC-004 D13 |
| `planning_window_days` ضيقة للطارئة وعريضة للدورية | task_type_config |
| مسارات المهمة و`final_decision` متباينة دلالياً بين الطارئة والدورية | حاجة تقارير منفصلة |
| التوحيد يُجبر CHECK constraints مشروطة بـ `creation_origin` | عبء يخالف مبدأ V-R006 |

### لماذا التقاسم في النتيجة منطقي

| العنصر | السبب |
|---|---|
| `device_technical_states` بـ phase pre/post | الجدول موجود ومُصمَّم لكلتا الحالتين |
| `emergency_action_types` (admin) | تصنيف الإجراءات مفيد للنوعين |
| `visit_task_emergency_parts_used.maintenance_type` | تصنيف القطعة لا المهمة — جاهز بنيوياً |
| `visit_task_emergency_financials` | الدورية أيضاً قد تُحصّل مالاً إن تجاوزت تغطية الكفالة |

---

## الإطار التنفيذي الجوهري (مُحسَم 2026-06-04)

> الصيانة في Golden CRM تَعمل بـ **ثلاث طبقات منفصلة لا تَتداخل دلالياً**. هذا الفصل يَحلّ التداخل الذي ظَهر أثناء النقاش بين "طارئة" و"دورية".

### الطبقات الثلاث

#### الطبقة 1 — سبب وجود المهمة (Why)

| نوع المهمة | السبب |
|---|---|
| **طارئة** | الزبون لاحظ شيئاً وأبلغ. نحن نَستجيب لمشكلة بَلَّغ عنها (reactive) |
| **دورية** | الوقت حان حسب جدول صيانة. نحن نَخدم بشكل وقائي (proactive) |

**المفتاح:** الفصل بـ **التريغر** (مَن بدأ الحدث)، لا بـ المحتوى:
- الطارئة بدأها **الزبون** بطلب صيانة (`service_request`).
- الدورية بدأها **النظام** بـ cron من خطة الكفالة.

#### الطبقة 2 — محتوى الزيارة (What)

كل زيارة صيانة تَحوي **لائحتين منفصلتَين** على `visit_task_results`:

| اللائحة | الوصف | تَملأ في الطارئة؟ | تَملأ في الدورية؟ |
|---|---|:---:|:---:|
| **(أ) العمل المخطَّط** | بنود مُسبَقة الإلزام (تبديل قطع، فحوص محدَّدة) | عادةً فارغة | عدّة بنود من template |
| **(ب) التشخيص المكتشَف** | أعطال شَخّصها الفني، من قائمة admin-managed + تفاصيل | بند واحد أو أكثر | اختياري — قد يَكتشف الفني عطلاً أثناء التنفيذ |

**النتيجة:** اكتشاف عطل أثناء دورية **لا يَنشئ open_task جديداً** — يَنضمّ كبند في لائحة (ب) داخل نفس الزيارة. هذا يَلغي مفهوم "cascade مهمة جديدة" تماماً ضمن نفس الجهاز.

#### الطبقة 3 — تصنيف القطع (Money)

كل قطعة في الكاتالوج تَحمل تصنيفاً ثابتاً (`spare_parts.maintenance_type ∈ {Periodic, Emergency, Accessory}`) مستقلاً عن نوع المهمة أو سبب الاستهلاك.

**القاعدة المالية المركَّبة:**

| تصنيف القطعة | كفالة عقد فعّالة؟ | كفالة ذهبية فعّالة؟ | مَن يَدفع |
|---|:---:|:---:|---|
| `Periodic` | ✅ | — | الكفالة (العقد) |
| `Periodic` | ❌ | — | الزبون |
| غير `Periodic` (`Emergency`/`Accessory`) | — | ✅ | الكفالة الذهبية |
| غير `Periodic` | — | ❌ | الزبون |

**المنطق:** كفالة العقد تَلتقط الدوريّات المخطَّطة فقط؛ الكفالة الذهبية تَلتقط المكتشَفات الإضافية؛ بدونهما الزبون يَدفع.

### الأثر على نقاط معلَّقة

التبنّي الصريح للفصل الثلاثي يَحلّ ثلاث نقاط دفعة واحدة:

| النقطة | كيف حُسِمت |
|---|---|
| **P-MAINT-02** (تأجيل دورية حين تُبدَّل قطعة Periodic في طارئة) | طبيعي: قطعة Periodic بُدِّلت ⇒ التاريخ يُسجَّل ⇒ الدورية القادمة تُحسَب من جديد. لا تَنبيه خاص — منطق المالية والتاريخ موحَّد |
| **P-MAINT-04** (cascade emergency داخل دورية) | **لا cascade** — البند يَنضمّ للائحة التشخيص (ب) داخل نفس الزيارة. التصنيف المالي للقطع المُستخدَمة لـ هذا البند يَتبع الطبقة 3 |
| **P-MAINT-06** (الكفالة الذهبية) | تُغطّي القطع غير-Periodic فقط (المكتشَفة). لا تَدخل في الدوريّات المخطَّطة |

### القرار المعماري على `open_task` — لا يَبقى موحَّداً

**القرار:** `open_task` يَحمل **بيانات مُخصَّصة بحسب النوع**، لا يُعامَل ككيان متطابق بنيوياً بين طارئة ودورية.

**الانعكاس:**
- الطارئة تَحمل: `source_service_request_id` + لقطة المشكلة المُبلَّغ عنها + لقطة الـ requester
- الدورية تَحمل: `periodic_cycle_no` + مرجع template العمل المخطَّط لهذه الدورة + بيانات الكفالة المُحَدِّدة للتغطية
- الـ schema يَتسع للنوعَين عبر حقول nullable مُخصَّصة، أو payload JSON مُهيكَل، أو side tables منفصلة لكل نوع

**ما يَبقى موحَّداً عملياً:**
- دورة حياة `open_task` (11 حالة) — موحَّدة
- العلاقة بـ `visit_task` + `visit_task_results` — موحَّدة (الطبقة 2 + 3)
- منطق الإسناد والجدولة — موحَّد

**ما يَختلف:**
- شكل الـ Input المُسجَّل على `open_task` يَختلف بنيوياً
- أي endpoint قراءة تفاصيل open_task يَحتاج discriminator على `task_type` ليَعرف كيف يَقرأ payload المُمَيَّز

### نقاط معلَّقة جديدة بسبب هذا التحوّل

| الرمز | الموضوع |
|---|---|
| **P-MAINT-10** | شكل التمييز على `open_tasks` بحسب النوع | **مُحسَمة (2026-06-04):** **Side tables منفصلة لكل نوع.** `open_tasks` يَبقى موحَّداً ونظيفاً للقراءة العامة. `open_task_emergency_payload` (UNIQUE FK → open_tasks) يَحمل: `source_service_request_id`, `reported_problem_snapshot`, `reported_action_type_id`. `open_task_periodic_payload` يَحمل بيانات الدورية (V2). النمط مُتبَع فعلاً مع `device_demo` (`open_task_pre_offers`) ومأنوس في النظام. توسعة لـ أنواع جديدة لاحقاً = جدول جديد بدون لمس `open_tasks`. |
| **P-MAINT-11** | لائحة "العمل المخطَّط" في الدورية: تُولَّد من template على `device_models` لحظة إنشاء open_task، أم تُحدَّد على الـ open_task مرنة (Operator يَختار)؟ |
| **P-MAINT-12** | فئة admin-managed `diagnosis_problem_types` (لائحة (ب)) | **مُحسَمة (2026-06-04):** `system_lists` فئة جديدة `diagnosis_problem_types`. الأدمن يُديرها من شاشة `/system-lists` الموجودة. لو احتجنا metadata لكل عطل (قطع مقترَحة)، نَستخدم `system_lists.metadata JSONB`. لا جدول مستقل ولا enum صلب. |

---

## ٠ — الاستلام والفرز (Service Requests Intake)

> **القرار المحوري (2026-06-03):** الصيانة الطارئة تبدأ من كيان مستقل `service_requests` يسبق `open_tasks`. كل قنوات الاستلام تُنتج طلب صيانة يخضع لفرز قبل أن يتحوّل (أو لا يتحوّل) إلى مهمة.
>
> **مرجع إثرائي (2026-06-03):** أُثري هذا القسم بمفاهيم من وثيقة تحليل قديمة لطلب الصيانة من تطبيق الموبايل ("طلب صيانة - تطبيق موبايل.txt") — استُفيد منها في القنوات الخارجية، شرائح المستخدم، نموذج الأطراف، مصدر الجهاز، Service Address، Audit Log، Flags، ونموذج الصلاحية الثنائي. **تُرفض كل النقاط التي تخالف الدستور** — أبرزها حالة `Maintenance Visit Scheduled` التي تخلط بين entity boundaries (الطلب يُرقَّى إلى **مهمة** لا زيارة).

### ٠.١ لماذا كيان منفصل عن `open_tasks`

في خارطة Golden CRM القريبة، الطلبات تأتي من قنوات متعدّدة: مكالمة، تطبيق موبايل، موقع إلكتروني، واتساب، زر داخلي. النموذج القديم (الطلب = المهمة مباشرة) يفشل لأن:

| السبب | التفصيل |
|---|---|
| **هوية عامة للزبون** | الزبون يرى "طلبي رقم 5829" — معرّف بسيط، مرئي، عام. لا يرى `open_task.id` الداخلي. |
| **قنوات بلا triager فوري** | طلب موبايل في 2 صباحاً موجود رسمياً لكن لا فني متاح للحظة. الطلب يجلس بأمان كـ `received` حتى يفرزه أحد. لو كان `open_task` مباشرة، لكان معلَّقاً بحالة وسيطة غريبة. |
| **مؤشرات تشغيلية منفصلة** | "كم طلباً استلمنا؟" مختلف عن "كم مهمة نفّذنا؟". الأولى تقيس quality قنوات الاستلام، الثانية quality التنفيذ. |
| **التكرار وحالات spam** | في موبايل، الزبون قد يضغط إرسال 3 مرّات. الكيانات التنفيذية لا تتلوّث — التكرار يبقى في طبقة الفرز. |
| **الاستشارة الفنية قبل الزيارة كحدث أول-طبيعي** | بدل side table على `open_task`، تصير "outcome للفرز" — منطقياً أنظف. |
| **`emergency_tickets` الموجود يصير حالة خاصة** | يُعمَّم ويُستبدَل بـ `service_requests` (نفس الفكرة، نطاق أوسع). |

### ٠.٢ النطاق في V1.0 (مُحسَم)

**طوارئ فقط + قنوات داخلية فقط.**

#### نوع المهمة في V1.0
- ✅ `emergency_maintenance` — كل طارئة جديدة تمرّ عبر `service_request`.
- ❌ `periodic_maintenance` — تبقى cron-only، لا طبقة intake.
- ❌ مهام أخرى (`device_demo` / `collection` / `device_delivery/installation/activation`) — مساراتها ناضجة، لا تدخل service_requests.

#### القنوات في V1.0 — داخلية حصراً

| القناة | V1.0 | الوصف |
|---|:---:|---|
| `phone` | ✅ | الموظف يستلم مكالمة طارئة من الزبون ويُنشئ الطلب نيابة |
| `internal_button` | ✅ | زر floating داخلي للموظفين |
| `client_detail_button` | ✅ | زر "إنشاء صيانة" من شاشة تفاصيل الزبون |
| `admin_manual` | ✅ | إنشاء يدوي من لوحة الأدمن |
| `mobile_app` | 🔒 محجوزة | schema جاهز، لا endpoint، لا UI — توسعة مستقبلية |
| `website` | 🔒 محجوزة | نفس |
| `whatsapp` | 🔒 محجوزة | نفس (bot لاحقاً) |

#### القاعدة الحاكمة للتوسعة

البنية في V1.0 **تُحفَظ** متوافقة مع القنوات الخارجية (CHECK constraints تشمل كل القنوات السبع، schema يحوي كل الحقول، 6 حالات state machine موجودة). الفرق الوحيد: القنوات الخارجية لا تملك endpoints عامة ولا UI ولا auth flow في V1.0.

**لا يُناقش في هذا الإصدار:**
- آلية الـ auth للزائر (Visitor tier)
- OTP / rate-limit / CAPTCHA
- بروتوكول الـ webhooks
- form rules خاصة بـ external tiers
- التعامل مع Visitor tier إجمالاً (مُعلَّق لـ V1.1+)

#### الأثر على الأقسام اللاحقة في هذا القسم

- ٠.١١ (User Tiers) — في V1.0 الفعلي، Visitor tier **غير قابل للوصول** لكنه مُعرَّف schema-wise. الـ Lead/FOP/OP لا يستطيعون التقديم لأنفسهم (لا تطبيق)؛ يقدّم نيابةً عنهم موظفٌ من القنوات الداخلية.
- ٠.١٢ (الأطراف الثلاثة) — تَنطبق كاملةً (موظف قد يُنشئ طلباً لشخص مُحال عبر آخر، أو لزبون مباشر).
- ٠.١٣ (Device Source) — تَنطبق كاملةً.
- ٠.١٧ (Audit Log) — تَنطبق كاملةً.

### ٠.٣ آلة الحالات الست (مُحسَمة)

```
received           ────→  in_review                  (Operator فَتح الطلب — claim)
                              │
                              ├──→  awaiting_customer_info   (ينتظر معلومة/تجربة)
                              │           │
                              │           └──→  in_review     (الزبون ردّ)
                              │
                              ├──→  resolved_at_intake       [terminal — قناة triager-present فقط]
                              ├──→  rejected                 [terminal — Audit Admin حصراً]
                              ├──→  promoted                 [terminal — open_task أُنشئ]
                              └──→  cancelled                [terminal — admin-initiated فقط]
```

| الحالة | المعنى | من يُغيّرها |
|---|---|---|
| `received` | استلام آلي من القناة، لم يُلمَس بعد | النظام آلياً عند الإنشاء |
| `in_review` | Admin Operator فتح الطلب وبدأ مراجعته (claim) — الربط، التحقّق، التشخيص | Admin Operator (`service_requests.review`) |
| `awaiting_customer_info` | معلَّق بانتظار ردّ الزبون (صورة، رقم، تجربة حلّ، استيضاح) | Admin Operator أثناء المراجعة |
| `resolved_at_intake` | حُلَّ هاتفياً / حلّه الزبون ذاتياً / إنذار خاطئ — **يتطلّب قناة بـ triager حيّ** (phone، internal_button، client_detail_button) | Admin Operator |
| `rejected` | غير صالح / مزدوج / spam / خارج النطاق | **`Request Audit Admin` حصراً** (`service_requests.reject`) — راجع ٠.١٦ |
| `promoted` | أُنشئ `open_task` مرتبط، الـ intake انتهى | Admin Operator (`service_requests.promote`) — يستلزم ربطاً مكتملاً |
| `cancelled` | الطلب أُغلق إدارياً (خطأ إدخال / طلب الزبون عبر دعم / مكرَّر بحت) | **admin فقط** — لا يصدر من تطبيق الزبون |

#### دلالة `promoted` بدقة دستورية

`promoted` تعني **حصراً** "أُنشئ `open_task` من نوع `emergency_maintenance` ومُرتبط بـ `linked_open_task_id`". **لا تعني** أن زيارة جُدوِلت — مسار `open_task` بعد ذلك (`open` → `scheduled` → `in_execution` → `completed`) خارج نطاق هذا الكيان كلياً. هذا تصحيح صريح لـ`Maintenance Visit Scheduled` في الوثيقة المرجعية: المرحلة الثانية بعد الطلب هي **مهمة الصيانة لا الزيارة**.

#### المبرّرات

- **`received` منفصل عن `in_review`:** طلب موبايل بـ 2 صباحاً موجود رسمياً لكن بلا triager. **SLA timer يبدأ من `received`، عدّاد "زمن الفرز" يبدأ من `in_review`** — مقاييس منفصلة لقنوات الاستلام مقابل سرعة الفرز.
- **`awaiting_customer_info` ضروري وليس ترفاً:** سيناريو "صوّر العطل وأرسله" يستلزمه. دمجه بـ `in_review` يُضيع التمييز التشغيلي الحاسم بين "أعمل عليه الآن" و"بانتظار رد".
- **`promoted` terminal لا transient:** بمجرد إنشاء `open_task`، الطلب أُنجز من منظور الـ intake.
- **`cancelled` admin-only:** الزبون لا يلغي من تطبيقه (حماية من سوء الاستخدام). الإلغاء أداة تشغيلية للأدمن (طلب تكرّر، خطأ إدخال، طلب الزبون عبر دعم).
- **`resolved_at_intake` مشروط بقناة:** يتطلّب triager حيّ يحاور الزبون. مفصَّل في ٠.٦.

#### `Overdue` ليس حالة (V1.0: لا overdue إلجمالاً)

الوثيقة المرجعية اعتبرت `Overdue` حالة. في V1.0 **نُلغيها كلياً** — لا SLA على `in_review`، لا `overdue_flag` محسوب، لا تنبيهات تجاوز زمن.

الـ Operator يَعمل بـ priority الطلب وحمل العمل اليومي، لا بـ SLA timer. **القاعدة الزمنية الوحيدة في V1.0 هي auto-cancel للـ `awaiting_customer_info` بعد 7 أيام** (راجع ٠.٤.ج).

### ٠.٤ قواعد الانتقال (Transition Rules)

| الرمز | القاعدة |
|---|---|
| **SR-R001** | `received` تنتقل فقط إلى `in_review` (claim بواسطة Operator) أو `cancelled` (admin-initiated فقط، لا قناة عميل) |
| **SR-R002** | `in_review` تنتقل إلى أي من الأربع terminal (`resolved_at_intake` / `rejected` / `promoted` / `cancelled`) أو إلى `awaiting_customer_info` |
| **SR-R003** | `awaiting_customer_info` تعود فقط إلى `in_review` (الزبون ردّ) أو تنتقل إلى `cancelled`. **لا قفز مباشر إلى terminal آخر** — يجب المرور بـ `in_review` للتثبت |
| **SR-R004** | الانتقال إلى `promoted` يستلزم: (١) ربط الـ request بـ client أو candidate (`beneficiary_client_id` أو `beneficiary_candidate_id` غير NULL)، (٢) توفير `installed_device_id` — موجود لـ `company_device`، أو يُنشأ ضمن transaction لـ `external_device` (راجع ٠.١٣)، (٣) إنشاء صف في `open_tasks` ضمن نفس transaction، (٤) حفظ `linked_open_task_id` على الـ request |
| **SR-R005** | الانتقال إلى `resolved_at_intake` يستلزم: (١) `channel` بـ triager-present (ضمن مجموعة محدَّدة في ٠.٦)، (٢) تسجيل `triage_notes` غير فارغة، (٣) `triage_outcome` يحدّد سبب الحلّ |
| **SR-R006** | كل حالة terminal تُلزم `triage_outcome` غير NULL — يُحدّد المخرج التفصيلي ضمن نوع الحالة |
| **SR-R007** | `rejected` تستلزم صلاحية `service_requests.reject` (Request Audit Admin حصراً) — راجع ٠.١٦. الـ Operator لا يستطيع الرفض مباشرةً |
| **SR-R008** | بيانات الزبون المُدخَلة (الاسم، الهاتف، الوصف، المرفقات) **immutable بعد `received`** — لا تعديل من admin أبداً. التصحيحات تُسجَّل كـ internal notes منفصلة (راجع ٠.١٨) |
| **SR-R009** | تفعيل `duplicate_flag` آلياً يُفعِّل `review_required_flag` تلقائياً ويُلزم Audit Admin قبل الرفض |
| **SR-R010** | لا حذف فيزيائي للطلبات. الإقفال يكون عبر terminal state ثم أرشفة ناعمة عبر `archived_at` (راجع ٠.١٨) |
| **SR-R011** | إعادة الفتح من terminal مسموحة بشروط — راجع جدول ٠.٤.ب. `promoted` **غير قابلة لإعادة الفتح** لأن الـ `open_task` المُنشأ هو الكيان الفعَّال؛ أي تعديل لاحق يحدث على open_task لا على الطلب |

### ٠.٤.أ آلية الـ Claim — Non-Exclusive Soft Ownership

**القرار (2026-06-03 — حسم SR-02):** الـ claim **غير حصري** مع **soft ownership** — أي Operator يستطيع فتح أي طلب في `in_review`، لكن `reviewed_by_user_id` يحفظ آخر claimer وكل تحويل يُسجَّل في audit log.

#### المبدأ الحاكم

> الفريق الصغير في الطبقة المركزية يحتاج مرونة لا قفل DB صارم. الـ ownership التزام تشغيلي/أخلاقي يُتتبَّع للمحاسبة، لا قيد تقني يُجبر تسليماً.

#### القواعد

| الرمز | القاعدة |
|---|---|
| **SR-CLAIM-01** | عند انتقال `received` → `in_review`، `reviewed_by_user_id` يُملأ بـ id الـ Operator الذي ضغط claim. `claimed_at` يُملأ معه |
| **SR-CLAIM-02** | أي Operator يحوي `service_requests.review` يستطيع التولّي لاحقاً: يَستبدِل `reviewed_by_user_id` بـ id نفسه. لا قفل DB، لا تأكيد من المالك السابق. الإجراء سريع — يَخدم سيناريوهات الغياب والـ shift handover |
| **SR-CLAIM-03** | كل استبدال لـ `reviewed_by_user_id` يُسجَّل كـ event `claim_transferred` في audit log مع: `previous_owner_id`, `new_owner_id`, `transfer_reason` (اختياري نص حر) |
| **SR-CLAIM-04** | الـ Operator السابق يَستلِم notification عند نقل الـ claim — لتجنّب مفاجآت ولشفافية الفريق |
| **SR-CLAIM-05** | الانتقالات الفرعية (`in_review` → `awaiting_customer_info` → `in_review`) **لا تُغيِّر `reviewed_by_user_id`** — تبقى ملكية الـ claimer الأصلي حتى يحدث transfer صريح |
| **SR-CLAIM-06** | الـ Audit Admin عند تدخّله (escalation، رفض، تجاوز قرار) **لا يَستبدِل `reviewed_by_user_id`** — تدخُّله يُسجَّل بـ events مستقلة (`escalated_to_audit_admin`, `rejected_decision`، إلخ). الـ Operator يبقى المالك التشغيلي |
| **SR-CLAIM-07** | عند `promoted`/`rejected`/`cancelled`/`resolved_at_intake`، `reviewed_by_user_id` يبقى snapshot للـ Operator الأخير المسؤول. لا تنظيف ولا nulling |

#### Dashboard implications

- لائحة "طلباتي" للـ Operator = `WHERE reviewed_by_user_id = :me AND status IN (active states)`.
- لائحة "بلا مالك" = `WHERE status = 'received'` (يحتاج claim).
- لائحة "أعمل عليها" متبادلة بين الفريق — Operator يَرى ما يَملكه + ما لا يَملكه (شفافية).
- زر "تولّي" يَظهر على أي طلب لا يَملكه الـ Operator الحالي.

### ٠.٤.ب مسارات إعادة الفتح (Reopening Paths)

**القرار (2026-06-03 — حسم SR-03):** إعادة الفتح مسموحة بمسارات مختلفة بحسب terminal، لا حظر شامل ولا مسار موحَّد.

| الـ terminal | إعادة الفتح؟ | الصلاحية المطلوبة | السبب الإلزامي |
|---|:---:|---|---|
| `rejected` | ✅ | `service_requests.reject` (Audit Admin حصراً) | إلزامي + من قائمة `reopen_reasons` (تظهر للزبون أنّ تقييم الرفض تغيَّر) |
| `resolved_at_intake` | ✅ | `service_requests.review` (Operator) | إلزامي — السبب الشائع: "العطل تكرَّر بعد النصيحة الهاتفية" أو "تشخيص أوّلي لم يحسم العطل" |
| `cancelled` | ✅ | `service_requests.review` (Operator) | إلزامي — مثلاً: "أُلغي خطأً" أو "الزبون عاد عن قرار الإلغاء" |
| `promoted` | ❌ | — | الـ `open_task` المُنشأ هو الكيان الفعَّال. تعديلات لاحقة على open_task |

**قواعد محكمة للسلوك:**

| الرمز | القاعدة |
|---|---|
| **SR-REOPEN-01** | إعادة الفتح تنقل الحالة من terminal إلى `in_review` مباشرةً (لا إلى `received` لأن العملية قد بدأت سابقاً) |
| **SR-REOPEN-02** | حقول `triage_outcome`/`closed_at`/`rejected_by_user_id` لا تُمسَح — تبقى snapshot لإغلاق سابق. الإغلاق الجديد سيُسجَّل قيمَه فوقها (audit log يحفظ التاريخ) |
| **SR-REOPEN-03** | كل إعادة فتح تُسجَّل كـ event `request_reopened` في audit log مع: السبب المهيكَل، الحالة السابقة، الـ actor |
| **SR-REOPEN-04** | حقل `reopen_count` يُزاد بـ 1 على كل إعادة. لا حد أعلى في V1.0، لكن `reopen_count > 2` يُفعِّل `review_required_flag` آلياً (تنبيه على نمط مشبوه) |
| **SR-REOPEN-05** | إعادة الفتح بعد `archived_at` ممنوعة — يجب إلغاء الأرشفة أولاً (إجراء منفصل بـ نفس صلاحية إعادة الفتح) |

### ٠.٤.ج Auto-Cancel للـ `awaiting_customer_info` (مُحسَمة 2026-06-03)

**القاعدة الوحيدة الزمنية في V1.0:** الطلب الذي يبقى في `awaiting_customer_info` أكثر من **7 أيام** يُلغى آلياً.

#### التفاصيل

| البعد | القيمة |
|---|---|
| المدّة | **7 أيام** من آخر انتقال إلى `awaiting_customer_info` |
| الحالة الجديدة | `cancelled` |
| `triage_outcome` | `customer_no_response` |
| المنفِّذ | cron job يومي (`actor_role = 'system'` في audit log) |
| audit event | `cancelled_by_admin` بـ `actor_role='system'` + `note='auto-cancelled: 7d in awaiting_customer_info'` |

#### قابلية الضبط

المدّة مخزَّنة في `system_settings.service_request_awaiting_auto_cancel_days` (افتراضي 7) — قابلة للتعديل بلا migration.

#### قابلية إعادة الفتح

طلب أُلغي تلقائياً قابل لإعادة الفتح بالقواعد المعتادة (٠.٤.ب) — الـ Operator يستطيع إرجاعه إلى `in_review` لو ردّ الزبون متأخّراً.

#### لا قواعد SLA أخرى

- ❌ لا SLA على `in_review` (لا تنبيه على الـ Operator لإنهاء مراجعة)
- ❌ لا تدرّج بـ priority (Critical/High/Normal لا تُغيِّر المدّة)
- ❌ لا `overdue_flag` محسوب
- ❌ لا تذكيرات يومية للـ Operator عن طلبات `awaiting_customer_info` قبل اليوم السابع

V1.0 يَحفظ البساطة: قاعدة واحدة، آلية واحدة، setting واحد.

### ٠.٥ المخارج الفعّالة + الإلغاء

| المخرج | الحالة | `open_task`؟ | `triage_outcome` المسموحة |
|---|---|---|---|
| **حُلَّ عند الاستلام** | `resolved_at_intake` | ❌ | `resolved_by_advice` \| `customer_self_fixed` \| `false_alarm` \| `info_clarified_no_issue` |
| **رُفض** (Audit Admin) | `rejected` | ❌ | `duplicate` \| `invalid_request` \| `spam` \| `out_of_scope` \| `unverified_caller` \| `device_not_company` (حسب قواعد العمل) |
| **رُقّي إلى مهمة** | `promoted` | ✅ تُنشأ | `needs_field_intervention` (المُحرِّك الوحيد، `linked_open_task_id` يُملأ) |
| **أُلغي إدارياً** | `cancelled` | ❌ | `data_entry_error` \| `customer_withdrew_via_support` \| `redundant_with_existing_task` \| `customer_no_response` (auto، ٠.٤.ج) |

### ٠.٦ القنوات وقواعد الإنشاء والمخارج المسموحة

| القناة | حالة الإنشاء | المُنشئ | `resolved_at_intake` مسموح؟ |
|---|---|---|---|
| `mobile_app` (موبايل) | `received` | الزبون نفسه | ❌ لا triager حيّ |
| `website` (موقع) | `received` | الزبون نفسه | ❌ لا triager حيّ |
| `whatsapp` (bot، مستقبلاً) | `received` | الزبون عبر bot | ❌ لا triager حيّ |
| `phone` (مكالمة طارئة) | `in_review` مباشرةً | الفني المستقبِل (triager) | ✅ |
| `internal_button` (zر floating داخلي) | `in_review` مباشرةً | الموظف المُنشئ | ✅ |
| `client_detail_button` (من تفاصيل الزبون) | `in_review` مباشرةً | الموظف المُنشئ | ✅ |
| `admin_manual` (إنشاء يدوي من لوحة الأدمن) | `in_review` مباشرةً | admin | ✅ |

**القاعدتان الحاكمتان:**
- **قاعدة الحالة الابتدائية:** أي قناة بـ triager حيّ ⇒ `in_review` فوراً. أي قناة آلية ⇒ `received` ينتظر claim.
- **قاعدة `resolved_at_intake`:** متاحة فقط للقنوات الأربع الأخيرة (triager-present). القنوات الثلاث الأولى لا يمكنها الوصول لهذه الحالة — مخارجها الوحيدة `promoted`/`rejected`/`cancelled`.

#### القنوات بحسب الدور

- **خارجية (الزبون يُرسل):** `mobile_app`, `website`, `whatsapp` — تحتاج auth خاص (راجع نقاط معلَّقة) + لا تستهلك صلاحيات داخلية.
- **داخلية (الموظف يُنشئ نيابة):** `phone`, `internal_button`, `client_detail_button`, `admin_manual` — تستهلك `service_requests.create`.

### ٠.٧ بنية الجدول المقترَحة

```
service_requests
├── id                     BIGSERIAL PRIMARY KEY
├── public_ref_number      VARCHAR(20) UNIQUE  -- مرئي للزبون — تنسيق SR-YYYYMMDD-NNNN (راجع ٠.٧.أ)
│
│   -- القناة والمصدر
├── channel                VARCHAR(30)         -- CHECK: 7 قنوات ٠.٦ — immutable بعد الإنشاء (SR-R008 ضمناً)
├── application_source     VARCHAR(50)         -- معلومات إضافية عن المصدر (نسخة التطبيق، browser، …)
│
│   -- الأطراف (نموذج ثلاثي — راجع ٠.١٢)
├── requester_user_id      INTEGER FK → hr_users(id)        -- nullable: لـ Visitor من تطبيق
├── requester_external     JSONB                              -- اسم/رقم لو requester غير مسجَّل
├── beneficiary_client_id  INTEGER FK → clients(id)           -- nullable: قد يكون مجهولاً عند الاستلام
├── beneficiary_candidate_id INTEGER FK → candidates(id)      -- nullable: لـ Lead المرتبط
├── beneficiary_external   JSONB                              -- بيانات المستفيد لو غير مربوط
├── referrer_user_id       INTEGER FK → hr_users(id)          -- nullable: عند submission_type='refer_a_candidate'
├── referrer_external      JSONB                              -- بيانات الوسيط لو غير مسجَّل
├── submission_type        VARCHAR(20)        -- CHECK: 'apply' | 'refer_a_candidate'
│
│   -- شريحة المستخدم وقت الإرسال (snapshot — لا تتغيّر مع لاحق ترقية العميل)
├── submitter_tier         VARCHAR(20)        -- CHECK: 'visitor' | 'lead' | 'fop' | 'op' | 'staff'
│
│   -- بيانات العقد والجهاز
├── contract_id            INTEGER FK → contracts(id)         -- nullable: يُملأ أثناء الفرز
├── device_source          VARCHAR(20)        -- CHECK: 'company_device' | 'external_device'
├── installed_device_id    INTEGER FK → installed_devices(id) -- nullable: إلزامي حين device_source='company_device' بعد الربط
├── external_device_name   VARCHAR(255)       -- يُملأ حين device_source='external_device'
├── external_device_serial VARCHAR(100)       -- اختياري حين external
│
│   -- البيانات المرسَلة (immutable بعد received — SR-R008)
├── problem_description    TEXT                NOT NULL    -- صوت الزبون (وثيقة تاريخية، نص حر)
├── requested_action_type_id INTEGER FK → emergency_action_types(id) NULL  -- لقطة تصنيف أوّلي (اختياري)
│                                                                          -- المرجع التشغيلي الفعلي = service_request_problems (٠.١٩)
├── attachments            JSONB DEFAULT '[]'  -- صور/فيديو ≤ 20 ثانية (راجع نقاط معلَّقة)
│
│   -- عنوان الخدمة (snapshot — راجع ٠.١٤)
├── service_address        JSONB              -- governorate/city/sub_area/neighborhood/detailed/gps
│                                              -- يُملأ من العميل لو معروف، أو يُدخل يدوياً للـ Visitor
│
│   -- الفرز والحالة
├── priority               VARCHAR(20)         -- Critical | High | Normal | Low — يُحدَّد أثناء الفرز
├── status                 VARCHAR(30)         -- CHECK: 6 states ٠.٣
├── reviewed_by_user_id    INTEGER FK → hr_users(id) -- Operator الذي claim
├── claimed_at             TIMESTAMPTZ
├── triage_outcome         VARCHAR(50)         -- nullable حتى terminal
├── triage_notes           TEXT
├── linked_open_task_id    INTEGER FK → open_tasks(id) -- يُملأ عند promoted فقط
├── expected_callback_at   TIMESTAMPTZ         -- يُملأ مع awaiting_customer_info
│
│   -- Flags (٠.١٥)
├── duplicate_flag         BOOLEAN DEFAULT FALSE
├── duplicate_of_request_id INTEGER FK → service_requests(id) -- المرجع لو duplicate
├── review_required_flag   BOOLEAN DEFAULT FALSE
│
│   -- الرفض (Audit Admin حصراً)
├── rejected_by_user_id    INTEGER FK → hr_users(id)         -- nullable حتى rejected
├── rejection_reason       VARCHAR(100)                       -- من triage_outcome
│
│   -- الأرشفة (soft)
├── archived_at            TIMESTAMPTZ                        -- nullable: أرشفة لا حذف
├── archived_by_user_id    INTEGER FK → hr_users(id)
│
│   -- إعادة الفتح (SR-REOPEN-04)
├── reopen_count           INTEGER DEFAULT 0 NOT NULL         -- يُزاد +1 على كل إعادة فتح
├── last_reopened_at       TIMESTAMPTZ                        -- آخر مرّة فُتحت فيها
│
│   -- النطاق والتوقيت
│   -- ملاحظة (SR-08): الـ branch_id على الطلب للتتبُّع/التقارير فقط، ليس للـ access control.
│   -- صلاحيات الـ service_requests كلها GLOBAL (٠.١٦). branch_id يُملأ من فرع العميل عند الربط،
│   -- أو من فرع الموظف المُنشئ إن لم يُربَط بعد. لا يحجب الوصول.
├── branch_id              INTEGER FK → branches(id)          -- nullable حتى يحدث ربط؛ tracking فقط
├── created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── closed_at              TIMESTAMPTZ                        -- وقت الوصول إلى terminal
└── updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### Indexes ضرورية

- `(status, created_at DESC)` — لائحة الفرز المركزية (لا تَضمّن branch_id لأن الـ scope `GLOBAL`)
- `(beneficiary_client_id) WHERE status NOT IN (terminal)` — منع تكرار الطلبات النشطة للزبون نفسه
- `(status, created_at) WHERE status IN (active states)` — حساب `overdue_flag` بكفاءة
- `(duplicate_flag) WHERE duplicate_flag = TRUE AND status NOT IN (terminal)` — لائحة الـ duplicates للمراجعة
- `(review_required_flag) WHERE review_required_flag = TRUE` — لائحة المُصعَّدة لـ Audit Admin
- `public_ref_number UNIQUE` — البحث الخارجي
- `(installed_device_id) WHERE status NOT IN (terminal)` — منع طلبات متوازية لنفس الجهاز (P-MAINT-03)
- `(archived_at IS NULL)` — استبعاد المُؤرشف افتراضياً
- `(branch_id, status)` — index ثانوي للتقارير فقط (كم طلباً ربطته بفرع X؟) — لا للـ access

### ٠.٧.أ تنسيق `public_ref_number` (مُحسَمة 2026-06-03)

**التنسيق المعتمَد:** `SR-YYYYMMDD-NNNN`

| الجزء | الوصف |
|---|---|
| `SR-` | prefix ثابت — يُميّز Service Requests عن العقود والمهام والإيصالات |
| `YYYYMMDD` | تاريخ الإنشاء — يُعطي الموظف تعريفاً فورياً لعمر الطلب من قراءة الـ ref |
| `NNNN` | عدّاد يومي 4 أرقام — يُصفَّر كل يوم (00:00:00 وقت السيرفر) |

#### أمثلة

| الـ ref | المعنى |
|---|---|
| `SR-20260603-0001` | أول طلب يوم 3 يونيو 2026 |
| `SR-20260603-0042` | الطلب الثاني والأربعون يوم 3 يونيو 2026 |
| `SR-20260604-0001` | أول طلب يوم 4 يونيو 2026 (العدّاد صُفِّر) |

#### آلية التوليد

```
SELECT 'SR-' || to_char(NOW(), 'YYYYMMDD') || '-' ||
       lpad((COALESCE(
         (SELECT MAX(SUBSTRING(public_ref_number FROM 14 FOR 4)::int)
          FROM service_requests
          WHERE public_ref_number LIKE 'SR-' || to_char(NOW(), 'YYYYMMDD') || '-%'),
         0
       ) + 1)::text, 4, '0')
```

أو أبسط: sequence + lookup. كلتاهما تَعمل بشرط atomic insert.

#### قواعد توليد

| الرمز | القاعدة |
|---|---|
| **SR-REF-01** | الـ ref يُولَّد في DB transaction نفسها التي تُنشئ السطر — لا race conditions |
| **SR-REF-02** | لا collision عبر الفروع لأن صفحة الطلبات `GLOBAL`. الترقيم مركزي على مستوى الشركة |
| **SR-REF-03** | في حال إعادة الفتح، الـ `public_ref_number` **لا يتغيّر** — يبقى snapshot أوّل الإنشاء |
| **SR-REF-04** | الـ NNNN بـ 4 أرقام يَستوعب 9999 طلباً يومياً — كافٍ بفائض كبير. تجاوز هذا الحد ⇒ خطأ صريح (يُلزم تعديل التنسيق لاحقاً) |
| **SR-REF-05** | UNIQUE constraint مع `WHERE archived_at IS NULL` — يَسمح بإعادة الاستخدام النظري بعد الأرشفة (وإن كان مرفوضاً عملياً) |

#### لماذا هذا التنسيق

- **ذو معنى وَجاهي:** الموظف يَستطيع قول "طلبك SR-20260603-0042" للزبون عبر الهاتف بسهولة.
- **المعلومة في الـ ref نفسه:** التاريخ + الترتيب اليومي يَكفيان لمعرفة عمر الطلب بلا استعلام DB.
- **مرئي وسهل القراءة:** بصرف النظر عن لغة الزبون.
- **بدائل مرفوضة:**
  - **Sequential صرف (5829):** سهل لكن بلا معنى، يَستلزم استعلاماً لمعرفة عمر الطلب.
  - **Channel prefix (M-5829, P-5829):** يَكشف المصدر بلا داعٍ.
  - **UUID:** غير صالح للقراءة الهاتفية، يُسبب أخطاء إدخال.

### ٠.٨ العلاقة بـ `open_tasks` (وفصل المركزية عن التوزيع)

#### المبدأ الحاكم

> **الـ intake مركزي (GLOBAL). الـ execution موزَّع (BRANCH).**

`service_requests` تعيش في طبقة مركزية: فريق صغير من Operators و Audit Admins يرى **كل** الطلبات بصرف النظر عن الفرع. لحظة الـ `promoted`، الـ `open_task` المُنشأ يَدخل البنية البَنكية المعتادة للفروع ويُتابَع محلياً.

#### كيف يحدث الانتقال

1. الطلب يُستلَم → يَبقى في النطاق المركزي طوال دورته (`received` → `in_review` → ...).
2. عند الـ `promoted`:
   - `open_tasks.branch_id` يُؤخَذ من `clients.branch_id` للـ `beneficiary` المربوط.
   - `open_tasks.creation_origin = 'emergency_request'` + `open_tasks.source_service_request_id = service_request.id`.
   - الـ `open_task` يَدخل branch-scope الفرع، يُتابَع جدولته وتنفيذه ضمن الفرع.
3. الـ service_request يبقى متاحاً للقراءة (تاريخياً) في الطبقة المركزية، لكن نشاطه ينتهي.

#### نسبة العلاقة وملاحظات

- نسبة **1 → 0..1**: كل service_request يولّد صفر أو open_task واحد فقط.
- `open_tasks.source_service_request_id` (FK جديد) يَخدم الارتجاع من الـ open_task لمعرفة منشئه.
- في شاشة تفاصيل العميل بـ "سجل الطلبات"، يُعرَض كل طلب مع رابط مزدوج: تفاصيل الطلب (مركزي) + المهمة المُنشأة (محلية في الفرع).

### ٠.٩ العلاقة بـ `emergency_tickets` (Legacy)

`emergency_tickets` يصبح **حالة خاصة منسوخة** من `service_requests` (channel='phone'). خطة الترحيل:
1. الـ schema الجديد يُنشأ بالتوازي.
2. الـ frontend ينتقل لاستخدام `service_requests` للقنوات الجديدة (موبايل + موقع).
3. عمليات المكالمة الحالية تُحوَّل تدريجياً.
4. بعد 14 يوم staging stable، `emergency_tickets` يُجمَّد read-only، ثم يُهجَّر بياناته إلى `service_requests` بـ channel='phone'.
5. الجدول القديم يُسقَط.

### ٠.١٠ الاستشارة الفنية (Triage Consultation)

ما ناقشناه في الجلسة السابقة كـ"حدث جانبي على open_task" انتقل **داخل** الـ service_request:
- الاستشارة هي **عملية الفرز نفسها** أثناء `in_review`.
- ملاحظات الاستشارة الحرة + قرار الـ triage_outcome النهائي يُحفَظان في `triage_notes` (نص حر) + `triage_outcome` (مُهيكَل) على الـ service_request.
- **التشخيصات المُهيكَلة تَنتقل لـ `service_request_problems`** (راجع ٠.١٩) — الفني المُشاور يَستطيع إضافة أعطال بـ `added_during_phase = 'technical_consultation'`، وحتى نقل عطل لـ `status = 'resolved_at_intake'` إذا حلّه هاتفياً.
- لا حاجة لجدول `emergency_consultations` المنفصل الذي اقتُرح أمس — `service_requests` + `service_request_problems` يَستوعبان كل معلومات الاستشارة.
- لو احتجنا multiple consultation rounds (`in_review` ⇄ `awaiting_customer_info`)، نُسجّل كل دورة كـ activity في audit log + كل تعديل على لائحة الأعطال كـ event مفصَّل (راجع ٠.١٩.و).

### ٠.١١ شرائح المستخدم (User Tiers) — قواعد التعبئة والصلاحيات

أربع شرائح تستطيع تقديم الطلب — تختلف في قواعد التعبئة والـ auth والمسارات المسموحة:

| الشريحة | تعريف | تعبئة الـ form | auth في القنوات الخارجية | المسارات المتاحة |
|---|---|---|---|---|
| **Visitor** | غير مسجَّل في النظام | يدوياً 100% | بدون (الاسم + هاتف فقط) | مسار العام للصيانة فقط |
| **Lead** (اسم مرشح) | مرشَّح غير مفعَّل (`clients.is_candidate = TRUE`) | آلية مع إمكانية تعديل قبل الإرسال | حساب موبايل أساسي | المسار العام |
| **FOP** (زبون محتمل) | عميل بـ زيارات تسويقية بدون عقد | آلية مع تعديل | حساب | المسار العام |
| **OP** (زبون لديه جهاز) | عميل بـ `installed_devices` نشطة | آلية كاملة | حساب | المسار العام **+ مسار "أجهزتي"** بـ جهاز مختار مُسبقاً |

**قواعد ضرورية:**
- **`submitter_tier` snapshot:** الشريحة لحظة الإرسال تُحفَظ كـ snapshot. ترقية لاحقة لـ Visitor إلى Lead لا تُغيّر `submitter_tier` على الطلب الأصلي (audit trail).
- **`OP من أجهزتي`:** عند الإرسال من شاشة "أجهزتي" لجهاز محدَّد، `installed_device_id` يُملأ تلقائياً + حقول الجهاز لا تظهر في النموذج (موجودة في النظام).
- **منع الإلغاء:** أيٌّ من الشرائح الأربع **لا يستطيع** إلغاء الطلب بعد الإرسال من القنوات الخارجية. التراجع يحدث عبر دعم (مكالمة → admin → `cancelled`).

### ٠.١٢ نموذج الأطراف الثلاثة (Three Parties)

| الطرف | التعريف | يَملأ النموذج؟ | يَستفيد من الزيارة؟ | له صلاحيات معالجة؟ |
|---|---|---|---|---|
| **Requester** (صاحب الطلب) | الذي أرسل النموذج | ✅ | ❌ إن submission_type='refer_a_candidate' | ❌ |
| **Beneficiary** (المستفيد) | الذي ستُجرى عليه الصيانة | ❌ | ✅ | ❌ |
| **Referrer** (الوسيط) | الذي سجَّل نفسه كوسيط على طلب لشخص آخر | ✅ (= Requester) | ❌ | ❌ |

**حالتان حسب `submission_type`:**

- **`submission_type = 'apply'`** (تقديم لنفسي):
  - `requester == beneficiary` — نفس الشخص
  - `referrer_*` كلها NULL
  - حقل "Referrer Information" في النموذج لا يظهر
  
- **`submission_type = 'refer_a_candidate'`** (تقديم لشخص آخر):
  - `requester ≠ beneficiary` — شخصان مختلفان
  - **اختياري:** الـ Requester يفعّل "أن يصبح وسيطاً" ⇒ يصير `referrer_*` يحوي بياناته
  - بيانات الوسيط تظهر في قسم منفصل في النموذج

**قاعدة هامة:** Beneficiary هو من تُربط بياناته للسجل الرسمي (`beneficiary_client_id`/`beneficiary_candidate_id`) لأن المهمة الناتجة تُسجَّل عليه — لا على Requester.

### ٠.١٣ مصدر الجهاز (Device Source)

| القيمة | المعنى | `installed_device_id` |
|---|---|---|
| `company_device` | جهاز اشتراه الزبون من الشركة، مسجَّل في `installed_devices` ومرتبط بـ `contracts` | إلزامي بعد الربط |
| `external_device` | جهاز من خارج الشركة — معترَف به دستورياً في **`contracts/01b §2`** و **DEC-CT-02** كسيناريو خدمة قائم | يُنشأ ضمن خطوة promote (راجع أدناه) |

**قواعد:**
- `device_source` يُحدَّد لحظة الإرسال (Dropdown أو snapshot من شاشة "أجهزتي").
- لـ OP من شاشة "أجهزتي" ⇒ `device_source = 'company_device'` تلقائياً.

#### حسم `external_device` في promote (مرجع: contracts/01b §2 + DEC-CT-02)

`external_device` **يُقبَل ويُرَقَّى** بـ خطوة promote موسَّعة:

1. الـ Operator يربط الـ `beneficiary_client_id` (إلزامي).
2. **يُنشئ `installed_device` خفيفاً** من بيانات الطلب ضمن نفس transaction:
   ```
   installed_devices(
     customer_id     = beneficiary_client_id,
     contract_id     = NULL,                          -- لا بيع، لا عقد
     device_model_id = NULL أو يدوي من الـ Operator,
     device_model_name = service_request.external_device_name,
     serial_number   = service_request.external_device_serial,  -- اختياري
     status          = 'active',                       -- موجود فعلاً لدى الزبون
     installation_geo_unit_id = service_address.geo_unit_id,
     branch_id       = clients.branch_id,
     warranty_*      = NULL                            -- لا كفالة شركة
   )
   ```
3. الـ `open_task` يُنشأ بـ `installed_device_id = installed_device.id`.

**ملاحظة V1.0:** لا نُلزم بـ `service_agreement` لطارئة لمرة واحدة — الـ `installed_device` يكفي. إن أراد الزبون لاحقاً خدمة متكرّرة، يُنشَأ `service_agreement` منفصل يربط بنفس `installed_device` (خارج نطاق هذا الإصدار).

**القاعدة الجديدة الناتجة:** SR-AUTH-02 تُوسَّع — promote يستلزم:
- ربط beneficiary (مرحلة linking)
- و **توفير `installed_device_id`** — إمّا موجود (company_device) أو يُنشأ في نفس transaction (external_device)

### ٠.١٤ Service Address vs Registered Address

**Service Address** هو snapshot على الـ request للعنوان الذي ستُنفَّذ فيه الزيارة. **لا يُعدِّل** `clients.address` الرسمي.

**القاعدة الحاكمة:**
- لـ OP/FOP/Lead: `service_address` يُملأ افتراضياً من `clients.address` لكن **قابل للتعديل قبل الإرسال** (الزبون قد يكون في عنوان مؤقت).
- لـ Visitor: يُدخل يدوياً.
- بعد promote، `open_tasks.service_address` (أو حقل مشابه) يأخذ snapshot من `service_requests.service_address` — هذا يصير عنوان الزيارة الميدانية.

**لماذا snapshot لا FK:** العنوان الرسمي قد يتغيّر لاحقاً بسبب انتقال الزبون؛ snapshot يحفظ "أين كان مفترضاً أن نذهب" بصرف النظر عن تغييرات لاحقة.

### ٠.١٥ Flags (مستقلة عن الـ State Machine)

ثلاثة flags لا تتدخّل في state machine لكن تُغيّر سلوك المعالجة:

| الـ Flag | كيف يُفعَّل | الأثر |
|---|---|---|
| `duplicate_flag` | آلياً عبر fuzzy match على (phone, problem_description) خلال نافذة 72h، أو يدوياً من Operator | يُفعِّل `review_required_flag` تلقائياً (SR-R009) + يُسجَّل `duplicate_of_request_id` |
| `review_required_flag` | آلياً (عند duplicate) أو يدوياً من Operator | يُلزم Audit Admin قبل الرفض (`Operator` لا يستطيع تخطّيها) — كصمّام أمان |
| `archived_at` | يدوياً من Operator/Audit بعد terminal | يُخفي الطلب من اللوائح الافتراضية، يبقى متاحاً في الأرشيف |

**ليست حالات لأن:**
- الـ flag يصف **سمة** للطلب، الحالة تصف **مرحلة**.
- الطلب قد يكون `in_review` ومُعلَّماً `duplicate` ومُعلَّماً `review_required` في نفس اللحظة.
- دمجها في state machine يُؤدي إلى انفجار ست حالات إلى 48 (combinatorial explosion).

### ٠.١٥.أ خوارزمية Duplicate Detection (مُحسَمة 2026-06-03)

**المبدأ:** Fuzzy matching بثلاثة محاور موزونة، عتبة `0.75` لإطلاق `duplicate_flag` آلياً.

#### المحاور والأوزان

| المحور | الوزن | الحساب |
|---|:---:|---|
| **الهاتف** (Requester primary mobile) | **0.50** | exact match = 1.0 · آخر 7 أرقام متطابقة = 0.8 (يُعالج اختلاف `+963` vs `963`) · آخر 6 = 0.5 · غير ذلك = 0 |
| **الجهاز** | **0.25** | نفس `installed_device_id` = 1.0 · نفس `serial_number` = 0.9 · `device_model_name` fuzzy (trigram) = 0.5 · غير ذلك = 0 |
| **المشكلة** (`problem_description`) | **0.25** | PostgreSQL `pg_trgm.similarity()` — يُلتقط تشابه الكلمات المفتاحية بصرف النظر عن صياغة الزبون |

#### الصيغة

```
score = 0.50 × phone_match
      + 0.25 × device_match
      + 0.25 × problem_similarity

IF score >= 0.75 AND existing_request.status NOT IN (terminal) THEN
  duplicate_flag = TRUE
  duplicate_of_request_id = id الطلب صاحب أعلى score
  review_required_flag = TRUE  -- بحكم SR-R009
  audit_event: duplicate_flag_set
```

#### نافذة المطابقة

**72 ساعة** من `created_at` للطلب القديم.

**السبب:** نفس العطل قد يُبلَّغ عدة مرّات في 3 أيام (الزبون يتصل ثم يُرسل من تطبيق ثم يَطلب وسيطاً). أبعد من 72h يَحتمل أن يكون عطلاً مختلفاً.

#### فلتر استبعاد

الطلب القديم المُقارَن **يجب** أن يكون `status NOT IN ('rejected', 'cancelled', 'promoted', 'resolved_at_intake')`. السبب: تكرار طلب بعد إغلاق سابق هو سلوك شرعي (الزبون عاد بنفس المشكلة لأن الحل لم ينجح).

#### Pre-requisites تقنية

- إضافة extension `pg_trgm` على DB.
- index `gin` على `problem_description` بـ `gin_trgm_ops` للسرعة:
  ```sql
  CREATE INDEX idx_service_requests_problem_trgm
    ON service_requests USING gin (problem_description gin_trgm_ops);
  ```
- index على آخر 7 أرقام من الهاتف:
  ```sql
  CREATE INDEX idx_service_requests_phone_tail
    ON service_requests ((right(requester_external->>'phone', 7)));
  ```

#### مكان التنفيذ

`services/serviceRequestDuplicates.ts::detectDuplicates(newRequest)` يُستدعى في `POST /service-requests` و `POST /service-requests/internal` **بعد** الـ INSERT (لئلا نمنع إنشاء طلبات شرعية بسبب خطأ في الخوارزمية).

#### قابلية الضبط

العتبة والأوزان قابلتان للضبط من `system_settings` (`service_request_duplicate_threshold`, `service_request_duplicate_phone_weight`, إلخ) — تَسمح بتعديل الحساسية بناءً على ملاحظات تشغيلية بلا migration.

#### ما لا تُحدِّده الخوارزمية

- **القرار النهائي** بأن الطلب فعلاً مكرَّر — يبقى للـ Audit Admin (الـ flag يُصعِّد، لا يُغلق).
- **عتبة "لا تُعرَض حتى ضمن النتائج"** — أي طلب بـ score < 0.5 لا يُعرَض كاقتراح duplicate حتى في الـ UI (تجنّب ضوضاء).

### ٠.١٦ نموذج الصلاحية الثنائي (Two-Tier Authorization)

**قرار 2026-06-03:** اعتُمد نموذج صلاحية ثنائي لفصل سلطة الفرز عن سلطة الإغلاق السلبي.

**قرار مُكمِّل 2026-06-03 (`SR-08`):** كل صلاحيات معالجة الـ service_requests محصورة بـ **`GLOBAL` scope فقط**. لا `BRANCH` scope ولا `ASSIGNED`. الطبقة المركزية ترى وتُعالج كل الطلبات؛ الفروع تَستلِم العمل عند `promoted` عبر `open_tasks` (التي تَدخل BRANCH-scope طبيعياً).

#### مصفوفة الصلاحيات

| الصلاحية | النطاق المسموح | الدور المرجعي | ما يستطيع |
|---|---|---|---|
| `service_requests.create` | **`BRANCH` + `GLOBAL`** | أي موظف داخلي يحوي صلاحية | إنشاء طلب من القنوات الداخلية (نيابة عن الزبون) |
| `service_requests.view` | **`GLOBAL` فقط** | Operator + Audit Admin | رؤية كل الطلبات بصرف النظر عن الفرع |
| `service_requests.review` | **`GLOBAL` فقط** | Admin Operator | claim، link، promote، escalate، add notes، priority، resolved_at_intake |
| `service_requests.reject` | **`GLOBAL` فقط** | Request Audit Admin | الرفض النهائي + اعتماد/تجاوز قرارات Operator |
| `service_requests.promote` | **`GLOBAL` فقط** | Admin Operator | إنشاء `open_task` من الطلب المُربَط |
| `service_requests.archive` | **`GLOBAL` فقط** | Operator + Audit Admin | تفعيل `archived_at` بعد terminal |

#### حدود كل دور

| الدور | لا يستطيع |
|---|---|
| **Admin Operator** | رفض الطلب (`rejected`)، تعديل بيانات الزبون المُرسَلة، تجاوز قرار Audit Admin |
| **Request Audit Admin** | تعديل بيانات الزبون المُرسَلة |
| **أي موظف بـ `create` فقط** | claim، promote، reject، تعديل، أرشفة (لا يحوي إلا الإنشاء) |

#### قواعد حاكمة

| الرمز | القاعدة |
|---|---|
| **SR-AUTH-01** | الرفض المباشر بدون `review_required_flag = TRUE` ممنوع. يجب تفعيل العلَم أولاً (آلياً عبر duplicate أو يدوياً عبر Operator) |
| **SR-AUTH-02** | `Operator` يستطيع `promote` فقط بعد اكتمال: (أ) ربط الـ beneficiary، (ب) توفير `installed_device_id` (موجود أو يُنشأ كـ external — راجع ٠.١٣) |
| **SR-AUTH-03** | `Audit Admin` يستطيع تجاوز قرار Operator (مثلاً إلغاء `awaiting_customer_info` بـ `rejected` مباشرة بعد review) |
| **SR-AUTH-04** | لا أحد يستطيع تعديل بيانات الزبون المُرسَلة (`problem_description`، الأسماء، الهواتف، المرفقات) — إن وجد خطأ يُسجَّل كـ internal note منفصل |
| **SR-AUTH-05** | الإلغاء (`cancelled`) متاح لـ Operator و Audit Admin، لكن يستلزم سبباً مهيكلاً من قائمة معتمدة |
| **SR-AUTH-06** | عند `promote`، يُحسَب `open_tasks.branch_id` آلياً من `beneficiary_client.branch_id` — لا اختيار يدوي للفرع. هذا يحفظ مبدأ "الطلب مركزي، المهمة فرع-محلية" |

### ٠.١٧ Audit Log المُهيكَل

جدول مستقل `service_request_audit_log` يُسجِّل كل تغيير حالة وكل قرار. لا يُعدَّل ولا يُحذَف.

#### الـ Events المعتمَدة (مُلهَمة من الوثيقة المرجعية + إضافات دستورية)

| الـ Event Type | متى يُسجَّل |
|---|---|
| `request_created` | إنشاء جديد من أي قناة |
| `status_changed` | كل انتقال حالة (with old → new) |
| `claimed_by_operator` | انتقال من `received` إلى `in_review` (claim أوّل) |
| `claim_transferred` | استبدال `reviewed_by_user_id` بين Operators (SR-CLAIM-03) — with `previous_owner_id`, `new_owner_id`, optional `transfer_reason` |
| `review_required_flag_set` | تفعيل العلَم آلياً أو يدوياً |
| `duplicate_flag_set` | اكتشاف duplicate (with `duplicate_of_request_id`) |
| `party_linked` | ربط `beneficiary_client_id` أو `beneficiary_candidate_id` |
| `linkage_changed` | تغيير الربط من target إلى آخر (SR-CAND-01) — with `old_target` + `new_target` + `reason` |
| `candidate_created` | إنشاء Candidate جديد أثناء الربط |
| `priority_changed` | تغيير الأولوية |
| `escalated_to_audit_admin` | تصعيد |
| `rejected_decision` | قرار رفض (Audit Admin) — with reason |
| `promoted_to_task` | إنشاء `open_task` جديد (with `linked_open_task_id`) |
| `merged_into_existing_task` | الـ service_request دُمج مع `open_task` قائم (EM-UNIQ-03) — لا open_task جديد أُنشئ |
| `cancelled_by_admin` | إلغاء إداري — with reason |
| `customer_info_requested` | انتقال إلى `awaiting_customer_info` |
| `customer_info_received` | الرجوع من `awaiting_customer_info` |
| `internal_note_added` | إضافة ملاحظة داخلية |
| `archived` | تفعيل `archived_at` |
| `unarchived` | إلغاء `archived_at` (لتمكين إعادة فتح بعد أرشفة — SR-REOPEN-05) |
| `request_reopened` | إعادة فتح من terminal — with `previous_status` + `reopen_reason` (SR-REOPEN-03) |

#### بنية الـ Log

```
service_request_audit_log
├── id              BIGSERIAL PRIMARY KEY
├── service_request_id INTEGER FK → service_requests(id) ON DELETE CASCADE
├── event_type      VARCHAR(50)
├── event_payload   JSONB                -- old/new values, reason codes, refs
├── actor_user_id   INTEGER FK → hr_users(id)
├── actor_role      VARCHAR(50)          -- 'operator' | 'audit_admin' | 'system' | 'customer'
├── note            TEXT                  -- اختياري
└── created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**القواعد:**
- إلحاق-فقط (append-only)، لا UPDATE ولا DELETE.
- العرض في تفاصيل الطلب مرتَّب زمنياً صعوداً.
- متاح للعرض حسب صلاحية `service_requests.view`.

### ٠.١٧.أ حقول walk-in الإلزامية (مُحسَمة 2026-06-03)

عندما يُنشأ الطلب من قناة داخلية لـ شخص غير مسجَّل (`beneficiary_client_id` و `beneficiary_candidate_id` كلاهما NULL)، الحقول التالية إلزامية:

#### الإلزامي

| الحقل | الموقع | لماذا |
|---|---|---|
| **الاسم** | `requester_external.name` | تعريف أساسي |
| **الهاتف الرئيسي** | `requester_external.primary_phone` | تواصل + duplicate detection (وزنه 0.50 من ٠.١٥.أ) |
| **المحافظة** | `service_address.governorate` | تحديد منطقة الخدمة لأغراض التوجيه + التقارير |
| **العنوان التفصيلي** | `service_address.detailed_address` | الموقع الفعلي للزيارة المتوقَّعة |

#### الاختياري

| الحقل | الموقع |
|---|---|
| هاتف ثانوي | `requester_external.secondary_phone` |
| ملاحظات على الـ requester | `requester_external.notes` |
| المنطقة / الناحية / الحي | `service_address.city`, `sub_area`, `neighborhood` |
| إحداثيات GPS | `service_address.lat`, `lng` |

#### بنية الـ JSON المعتمَدة

```json
// requester_external
{
  "name": "محمد أحمد",          // إلزامي
  "primary_phone": "0944xxxxxx", // إلزامي
  "secondary_phone": null,       // اختياري
  "notes": null                  // اختياري
}

// service_address
{
  "governorate": "دمشق",         // إلزامي
  "city": null,                   // اختياري
  "sub_area": null,               // اختياري
  "neighborhood": null,           // اختياري
  "detailed_address": "المزة، بناية 5، طابق 2",  // إلزامي
  "lat": null,                    // اختياري
  "lng": null                     // اختياري
}
```

#### القواعد

| الرمز | القاعدة |
|---|---|
| **SR-WALKIN-01** | `requester_external` إلزامي عندما `requester_user_id IS NULL` (walk-in عبر موظف لشخص غير مسجَّل) |
| **SR-WALKIN-02** | حقلا `requester_external.name` + `requester_external.primary_phone` إلزاميان داخل الـ JSON |
| **SR-WALKIN-03** | حقلا `service_address.governorate` + `service_address.detailed_address` إلزاميان دائماً (للجميع: walk-in أو زبون مسجَّل — هذا الحد الأدنى لتنفيذ زيارة) |
| **SR-WALKIN-04** | `primary_phone` يَخضع لـ pattern check (10 أرقام، يبدأ بـ 0 أو +963 ⇒ يُطبَّق عليه trim + normalize) — أساس صحيح للـ duplicate detection |
| **SR-WALKIN-05** | عند الـ link لـ client/candidate لاحقاً، `requester_external` و `service_address` يَبقَيان snapshot لما أُدخل أصلاً (audit). الـ Operator يَستطيع تعديل `service_address` لاحقاً لو الزبون أعطى عنواناً أوضح، لكن **`requester_external` immutable** (SR-R008) |
| **SR-WALKIN-06** | لـ `beneficiary` المختلف عن `requester` (Submission Type = `refer_a_candidate`)، `beneficiary_external` يَتبع نفس قاعدتَي SR-WALKIN-02 (اسم + هاتف) — لكن العنوان يَأخذ من `service_address` (عنوان واحد للزيارة بصرف النظر عن من أرسل) |

#### لماذا هذه الحقول بالذات

- **الاسم + الهاتف** = الحد الأدنى لاتصال المتابعة + duplicate detection
- **المحافظة** = لا تَنفَع زيارة بدونها (تحدّد فرع التنفيذ المحتمل + التقارير الإقليمية)
- **العنوان التفصيلي** = الفني يَحتاج عنواناً يَستطيع الوصول له. حقول هرمية أصغر (مدينة، حي) قد تَفي إن أُدخلت، لكن السطر التفصيلي هو الضمان

### ٠.١٧.ب التعامل مع Candidate المُنشأ خطأً (مُحسَمة 2026-06-03)

**المبدأ:** Soft handling لا hard delete — الـ Candidate يُعالَج عبر relink من شاشة الطلب، والـ cleanup الفعلي يَتم في شاشة candidates management المستقلة.

#### السيناريوهات الثلاثة

| السيناريو | الحَل |
|---|---|
| (أ) سجل موجود فاتَه الـ Fuzzy Matching | الـ Operator يَستخدم زر "تغيير الربط" على الطلب ⇒ يَفصل الـ Candidate الخاطئ ويَربط بالسجل الصحيح. الـ Candidate الأوّل يَبقى موجوداً (قد يَكون استلم نشاطاً مستقلاً) |
| (ب) بيانات Candidate خاطئة | الـ Operator يَعدّل بيانات الـ Candidate مباشرة (الـ Candidate ليس immutable كـ service_request — هو كيان قابل للتعديل بصلاحياته العادية) |
| (ج) Service request تبيَّن أنه duplicate | يُلغى بـ `triage_outcome='duplicate'` ⇒ الـ Candidate لا يُربَط بشيء ⇒ يَنتج orphan قابل للحذف لاحقاً |

#### القواعد

| الرمز | القاعدة |
|---|---|
| **SR-CAND-01** | عند نقل الـ Operator للربط من Candidate A إلى Candidate B (أو إلى client)، audit log يُسجّل event `linkage_changed` مع `old_target_type/id` + `new_target_type/id` + اختيارياً `reason` |
| **SR-CAND-02** | "Candidate orphan" = `is_candidate = TRUE` AND **لا** service_requests/calls/visits/contracts مرتبطة. يُحسَب view محسوباً، لا flag مخزَّن |
| **SR-CAND-03** | حذف Candidate orphan يَتم عبر شاشة admin مستقلة (clients management)، بصلاحية حذف clients — **خارج نطاق `service_requests` مباشرة**. لا زر حذف Candidate من شاشة الطلب |
| **SR-CAND-04** | الـ Candidate يَبقى متاحاً للربط بطلبات لاحقة حتى لو فُصِل عن طلب سابق — لا قفل |
| **SR-CAND-05** | إنشاء Candidate أثناء الربط يُسجَّل بـ event `candidate_created` (موجود في ٠.١٧). تعديل بياناته بعد الإنشاء يُسجَّل في audit log الخاص بـ clients/candidates، لا audit log الـ service_request |

#### Endpoint مقترَح

`POST /service-requests/:id/change-linkage` — بـ body:
```json
{
  "old_link": { "type": "candidate", "id": 123 },
  "new_link": { "type": "client", "id": 456 },
  "reason": "وجد سجل موجود لاحقاً بعد بحث يدوي"
}
```

يَفرض: الـ Operator له `service_requests.review`، الطلب في حالة قابلة للتعديل (`in_review` أو `awaiting_customer_info`)، الـ new_link موجود فعلاً.

#### لماذا soft handling

- الـ Candidate قد يَتلقى نشاطاً مستقلاً (مكالمة، visit، عرض) بين الإنشاء واكتشاف الخطأ. الحذف فيزيائياً يَفقد البيانات
- فصل مسؤوليات نظيف: service_requests تَفرز الطلبات، إدارة الـ candidates شاشة مستقلة لها صلاحيات
- الـ orphan يُكتشَف بسهولة لاحقاً عبر view محسوب — التنظيف الدوري ممكن
- يَتجنّب race conditions (محاولة حذف Candidate أثناء استخدامه في طلب موازٍ)

### ٠.١٨ Immutability وأرشفة لا حذف

**Immutability (SR-R008):**
- بيانات الزبون المُرسَلة من القنوات الخارجية **read-only** بعد `received`.
- لا أحد (Operator/Audit Admin/SuperAdmin) يستطيع تعديلها.
- التصحيحات تُسجَّل كـ internal note في الـ audit log، لا تُعدِّل البيانات الأصلية.
- **الاستثناء الوحيد:** الحقول التي يضيفها فريق التشغيل (priority، triage_notes، حقول الربط) قابلة للتعديل بصلاحياتها.

**أرشفة لا حذف (SR-R010):**
- DELETE فيزيائي ممنوع تماماً على `service_requests` و `service_request_audit_log`.
- الإقفال يحدث عبر terminal state، ثم اختياراً `archived_at` للإخفاء من اللوائح.
- الـ unique constraints (مثل `public_ref_number`) يجب أن تكون `WHERE archived_at IS NULL` ليُسمح بإعادة الاستخدام (وإن كان غير منصوح به).

### ٠.١٩ لائحة الأعطال (Diagnosed Problems)

> **القرار المحوري (2026-06-04):** نَنشئ كياناً مُستقلاً `service_request_problems` يَحمل لائحة الأعطال المُهيكَلة لكل service_request، تَنتقل ملكيته الفعّالة لـ `open_task` عند الـ promote. النمط مُستَوحى من `customer_device_pre_offers` في `device_demo` لكن بدلالة فنية لا تجارية.

#### ٠.١٩.أ الفلسفة

اللائحة هي **ملف تشخيص الجهاز للحالة الراهنة** — تَستمرّ من intake حتى الإغلاق التشغيلي:

| المرحلة | ما يحدث على اللائحة |
|---|---|
| **intake** | عطل أو أكثر يَتدفّق من شكوى الزبون (الـ Operator يَكتب ما يَسمعه أو يَهيكله من تطبيق) |
| **in_review** | الـ Operator يُهيكِل اللائحة (يَختار أنواع من system_lists، يَضيف تفاصيل). الفني المُشاور قد يُضيف أو يَحلّ هاتفياً |
| **promote** | اللائحة تَنتقل لـ `open_task` بربط `open_task_id` على نفس الصفوف (لا نسخ) |
| **visit** | الفني/المشرف يَعمل على كل بند: يَحلّ، يُؤجِّل، أو يَكتشف أعطالاً إضافية |
| **بعد visit** | اللائحة مُغلَقة تشغيلياً — التعديل حصري بـ Audit Admin |

**تمييز جوهري مع pre_offers:**
- العرض شيء قابل للتقديم (catalog مُحضَّر سلفاً)
- العطل **حقيقة مكتشَفة** لها عمر ميداني

كلاهما يَتشاركان نمط "لائحة بنود مع status + derived outcome" لكن دلالياً مختلفان.

#### ٠.١٩.ب Schema

```
service_request_problems
├── -- Parent (dual reference)
├── id                           BIGSERIAL PRIMARY KEY
├── service_request_id           INTEGER FK NOT NULL  -- ثابت، تاريخ النشأة
├── open_task_id                 INTEGER FK NULL      -- يُملأ عند promote
│
├── -- Device & Type
├── installed_device_id          INTEGER FK NOT NULL  -- ربط صريح إلزامي
├── problem_type_id              INTEGER FK → system_lists(id) NOT NULL
│                                                     -- category = 'diagnosis_problem_types'
├── details                      TEXT
│
├── -- Status lifecycle
├── status                       VARCHAR(30) NOT NULL
│       -- CHECK: 'reported' | 'confirmed' | 'resolved_at_intake'
│       --       | 'resolved' | 'deferred' | 'unresolvable_field' | 'cancelled'
│
├── -- Creation metadata
├── created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
├── created_by_user_id           INTEGER FK → hr_users(id) NOT NULL
├── added_during_phase           VARCHAR(30) NOT NULL
│       -- CHECK: 'intake' | 'in_review' | 'technical_consultation' | 'field_discovery'
├── creator_role_snapshot        VARCHAR(50) NOT NULL  -- لقطة الدور وقت الإضافة
│
├── -- Resolution metadata (التمييز الجوهري)
├── resolved_at                  TIMESTAMPTZ NULL
├── resolution_recorded_by_user_id INTEGER FK → hr_users(id) NULL  -- مَن كتب النتيجة
├── repaired_by_employee_id      INTEGER FK → employees(id) NULL   -- مَن أصلح فعلاً
├── resolution_visit_task_id     INTEGER FK → visit_tasks(id) NULL
├── repair_team_snapshot         JSONB NULL                         -- لقطة الفريق
├── resolution_notes             TEXT NULL
│
├── -- Edit tracking
├── last_edited_at               TIMESTAMPTZ NULL
├── last_edited_by_user_id       INTEGER FK NULL
├── edit_count                   INTEGER DEFAULT 0
│
├── -- Soft delete (لا hard delete أبداً)
├── deleted_at                   TIMESTAMPTZ NULL
├── deleted_by_user_id           INTEGER FK NULL
├── deletion_reason              TEXT NULL
│
└── updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

#### ٠.١٩.ج Indexes

- `(service_request_id) WHERE deleted_at IS NULL` — قراءة لائحة طلب
- `(open_task_id) WHERE deleted_at IS NULL` — قراءة لائحة مهمة
- `(installed_device_id, status) WHERE status NOT IN ('cancelled', 'resolved_at_intake')` — لائحة الأعطال المفتوحة لجهاز
- `(problem_type_id, created_at)` — تقارير "كم عطل من نوع X هذا الشهر"
- `(repaired_by_employee_id, resolved_at)` — تقارير أداء الفني
- `(resolution_visit_task_id) WHERE resolution_visit_task_id IS NOT NULL` — ربط الزيارات بالأعطال

#### ٠.١٩.د تمييز "مَن كتب" عن "مَن أصلح"

**القاعدة الحاكمة:** `resolution_recorded_by_user_id ≠ repaired_by_employee_id` مسموح وشائع.

| السيناريو | `recorded_by` | `repaired_by` |
|---|---|---|
| فني واحد يَعمل ويُسجِّل | الفني | الفني (نفسه) |
| المشرف يَكتب النتيجة، الفني عَمِل | المشرف | الفني |
| Audit Admin يُصحِّح بعد إغلاق | Audit Admin | الفني الأصلي (يَبقى) |

**فوائد التمييز:**
- معايير أداء الفني تَعتمد `repaired_by` فقط (لا يُحرَم من الإنجاز لو المشرف كتب النتيجة)
- مَن يُحاسَب على دقّة التوثيق هو `recorded_by`
- التقارير تَستطيع الفصل بين الـ "عمل الفعلي" و "العمل الإداري"

#### ٠.١٩.هـ مصفوفة الصلاحيات (Permission Matrix)

| المرحلة | تعديل التفاصيل/النوع | تغيير status | إضافة عطل جديد | حذف العطل (soft) |
|---|---|---|---|---|
| `service_request.received` | Operator فقط | (تلقائي = `reported`) | Operator | Operator + سبب |
| `service_request.in_review` | Operator + الفني المُشاور | Operator → `resolved_at_intake` | Operator + الفني المُشاور | Operator + سبب |
| بعد promote، قبل بدء visit | Operator (نافذة محدودة) + Audit Admin | Operator → `confirmed` فقط | Operator (نادر) | **ممنوع** — يُلغى بـ `cancelled` فقط |
| أثناء visit نشط | المشرف/الفني من الفريق المُسنَد | المشرف/الفني | المشرف/الفني (`field_discovery`) | **ممنوع** — يُلغى بـ `cancelled` |
| بعد إغلاق visit | **Audit Admin فقط** + سبب صريح + audit trail | **Audit Admin فقط** | ❌ ممنوع | ❌ ممنوع تماماً |

**قواعد إضافية:**

| الرمز | القاعدة |
|---|---|
| **EM-PROB-01** | Soft delete دائماً، لا hard delete على `service_request_problems`. الصف يَبقى ويُخفى بـ `deleted_at` |
| **EM-PROB-02** | العطل المُنتقل لـ `status = 'resolved'` لا يَقبل تغيير status بعد ذلك إلا بـ Audit Admin override |
| **EM-PROB-03** | كل تغيير يُسجَّل في `service_request_audit_log` بـ events مفصَّلة (راجع ٠.١٩.و) |
| **EM-PROB-04** | الـ Audit Admin override يُسجَّل بـ event مُمَيَّز `problem_audit_admin_override` مع `previous_state` + `new_state` + `reason` |
| **EM-PROB-05** | الـ `installed_device_id` على كل عطل يَجب أن يَخصّ نفس `beneficiary_client_id` المربوط بالطلب — لا يُسمح بـ ربط عطل بجهاز لا يَملكه الـ beneficiary |

#### ٠.١٩.و Audit Events للأعطال

تُضاف على `service_request_audit_log` الموجود (٠.١٧):

| Event | متى يُسجَّل | الـ payload |
|---|---|---|
| `problem_added` | إضافة عطل في أي مرحلة | `problem_id`, `problem_type`, `added_during_phase`, `creator_role_snapshot` |
| `problem_edited` | تعديل النوع أو التفاصيل | `problem_id`, `field_changed`, `old_value`, `new_value` |
| `problem_status_changed` | تغيير status | `problem_id`, `old_status`, `new_status`, `reason` |
| `problem_resolution_recorded` | تسجيل النتيجة | `problem_id`, `resolution_recorded_by_user_id`, `repaired_by_employee_id`, `resolution_visit_task_id` |
| `problem_soft_deleted` | حذف ناعم | `problem_id`, `deletion_reason` |
| `problem_restored` | استعادة من soft delete | `problem_id`, `restoration_reason` |
| `problem_audit_admin_override` | تدخّل Audit Admin بعد إغلاق visit | `problem_id`, `previous_state`, `new_state`, `override_reason` |

#### ٠.١٩.ز ربط الحالة الفنية (`device_technical_states`)

**القرار (2026-06-04):** لا FK مباشر بين `service_request_problems` و `device_technical_states`. القياسات تَبقى مربوطة بـ **`visit_task`** (pre + post)، الأعطال مربوطة بـ open_task → visit_task.

**سبب الفصل:** قراءات الجهاز (TDS، ضغط، الممبرين) **مُجمَّعة** — تَعكس تأثير كل الأعطال معاً على الجهاز. لا يُمكن نسب قياس محدَّد لعطل بعينه.

**قاعدة العرض في الواجهة:**
- لكل عطل بحالة `resolved`، نَعرض القياسات pre و post للزيارة التي حلَّته (`resolution_visit_task_id`)
- يُضاف **تنبيه مرئي** صريح:

  > "هذه القياسات تَعكس حالة الجهاز كاملاً وقد تَتأثّر بأعطال أخرى عُولِجت في نفس الزيارة."

- للعطل بحالة `deferred` أو `unresolvable_field`، نَعرض قياسات pre فقط (لا post لأنه لم يُحَل بعد)
- للعطل بحالة `resolved_at_intake`، لا قياسات نَعرضها (لم تَحدث زيارة)

#### ٠.١٩.ح derived_outcome على `open_task` (مُشتقّ، لا يُكتب يدوياً)

كما في `device_demo`:

```
derived_outcome = function(لائحة الأعطال على open_task):
  IF كل الأعطال status = 'resolved' → 'fully_resolved'
  ELIF بعضها 'resolved' وبعضها 'deferred' → 'partially_resolved'
  ELIF كلها 'deferred' → 'all_deferred'
  ELIF بعضها 'unresolvable_field' → 'partially_unresolvable'
  ELIF كلها 'unresolvable_field' → 'fully_unresolvable'
  ELIF كلها 'cancelled' → 'all_cancelled' (نادر)
  ELSE → 'mixed'
```

`final_decision` على `visit_task` (resolved/partially_resolved/unresolved/needs_followup/cancelled) يَبقى يَصف **ما حدث في الزيارة بالتحديد** (لا الـ open_task ككل). `derived_outcome` يَصف الحالة العامة.

#### ٠.١٩.ط إضافة الأعطال أثناء الزيارة (Field Discovery)

الفني/المشرف في الميدان يَستطيع إضافة بنود جديدة:
- `added_during_phase = 'field_discovery'`
- `created_by_user_id = الفني/المشرف`
- `creator_role_snapshot = 'technician'` أو `'supervisor'`
- البند يَصير جزءاً من اللائحة بصرف النظر عن مصدره
- يُسجَّل audit event `problem_added` مع التمييز الكامل

**التمييز في الواجهة:** بادج مرئي على البنود المُضافة في الميدان لتمييزها عن المُبلَّغ عنها أصلاً من الزبون.

---

## أ — الهوية

### المحور 1
| البيان | الطارئة | الدورية |
|---|---|---|
| `task_type` | `emergency_maintenance` | `periodic_maintenance` |
| الاسم العربي | صيانة طارئة | صيانة دورية |
| الاسم الإنجليزي | Emergency Maintenance | Periodic Maintenance |
| الوصف | استجابة لبلاغ زبون عن عطل في جهاز مُركَّب لديه — تشخيص + إصلاح + تسوية مالية ميدانية | زيارة مخطَّطة لفحص الجهاز وتبديل القطع المستحقَّة وفق خطة الكفالة |

### المحور 2 — `task_family`
كلاهما **`service`**.

### المحور 3 — `display_group`
كلاهما **`maintenance`** (مجموعة عرض واحدة في الواجهة، مع فلتر النوع الفرعي).

### المحور 4 — `visit_family`
كلاهما **`service`**. زيارة `mixed` ممكنة مع مهام أخرى من العائلة (مثل `device_activation` لتركيب قطعة).

---

## ب — الإنشاء

### المحور 5 — `creation_origin` المسموحة

| القيمة | طارئة | دورية | السيناريو |
|---|:---:|:---:|---|
| `branch_plan` | ❌ | ✅ | مدير الفرع يضمّ الدورية المُولَّدة في خطة اليوم |
| `emergency_request` | ✅ | ❌ | **المسار الوحيد للطارئة (مُحسَم 2026-06-03):** كل `open_task` طارئة تأتي من `service_request` مُرقَّى. لا قناة أخرى |
| `system_trigger` | ❌ | ✅ | cron يولّد دورية وفق `installed_devices.warranty_visits` و `contracts.maintenance_plan` |

#### القيم المحذوفة بعد قرار service_requests + الإطار الثلاثي

- ❌ **`service_request_call`** — كان مساراً مباشراً لإنشاء open_task من مكالمة. الآن المكالمة تُنشئ `service_request` بـ `channel='phone'` و `in_review`، ثم تُرقّى إلى open_task بـ `creation_origin='emergency_request'`.
- ❌ **`telemarketing_inline_booking`** — لا يصلح للطارئة (كان مساراً للديمو). يبقى لـ `device_demo` فقط.
- ❌ **`manual_creation`** — كان مساراً لمدير/مشرف ينشئ مباشرة. الآن يُنشئ `service_request` بـ `channel='admin_manual'` ثم يُرقّيه فوراً.
- ❌ **`cascading_during_visit`** (مُحسَمة 2026-06-04) — أُلغي مع تبنّي الإطار الثلاثي. اكتشاف عطل أثناء أي زيارة يَنضمّ كبند في لائحة الأعطال (`added_during_phase = 'field_discovery'`)، لا يُنشئ open_task جديد ولا visit_task جديد. لو الجهاز ليس له open_task سابق، تُنشأ `service_request` عادية بـ `channel='internal_button'`.

**القاعدة الحاكمة:** `emergency_maintenance.open_task` لا يمكن أن يُنشأ بدون `source_service_request_id` غير NULL. لا استثناءات. يُفرَض بـ CHECK في DB.

### المحور 6 — `location_basis`
كلاهما **`device`** (DEC-005 D27) — عنوان الجهاز من `installed_devices.installation_geo_unit_id`. لا عنوان الزبون ولا عنوان العقد.

### المحور 7 — منطق التاريخ والنافذة

| البُعد | الطارئة | الدورية |
|---|---|---|
| التاريخ المرجعي | `required_date` = تاريخ البلاغ + `due_within_hours` (افتراضي 48h من `emergency_tickets`) | `due_date` = `installation_date + (cycle_no × maintenance_interval_months)` |
| `scheduling_pattern` | `urgent_window` | `wide_window` |
| `window_basis` | `required_date` | `due_date` |
| `planning_window_days` المقترح | 2 | 30 |
| منطق `needs_follow_up` | يوم واحد قبل `expected_date` (DEC-006 D36) | يوم واحد قبل `expected_date` |

### المحور 8 — التفرّد

#### الطارئة — "زبون واحد، جهاز واحد، طلب واحد" (مُحسَمة 2026-06-03)

**الفلسفة:** كل جهاز يَحمل مهمة طارئة واحدة نشطة في أي لحظة. البلاغ الثاني على نفس الجهاز يَنضمّ افتراضياً للمهمة القائمة، لا يَفتح مهمة جديدة.

**القاعدة التقنية:** فهرس جزئي فريد على `(installed_device_id) WHERE status NOT IN ('completed','closed','cancelled') AND task_type = 'emergency_maintenance'`.

#### سيناريو البلاغ الثاني (مرجع P-MAINT-03)

أحمد بلَّغ يوم الإثنين عن عطل في الفلتر. لديه الآن `open_task` نشط + `service_request` بحالة `promoted`. يَتصل يوم الثلاثاء.

عندما يَستلم الموظف الـ `service_request` الجديد ويَربطه بـ أحمد + جهازه، النظام يَكتشف أن جهازه عليه مهمة نشطة قبل أن يَضغط `promote`. تظهر له شاشة قرار بـ **خيارَين فقط**:

| الخيار | متى يَستخدمه | الأثر |
|---|---|---|
| **(أ) إضافة للمهمة القائمة** (الافتراضي) | العطل نفسه، تَطوّر، أو عطل مرتبط على نفس الجهاز يَستطيع الفني نفسه إصلاحه | الـ service_request الجديد يَنتقل لـ `promoted` لكن `linked_open_task_id` يُشير لنفس المهمة القائمة. الـ open_task يَستلم event `additional_report_attached` بـ snapshot من تفاصيل الـ request الثاني (المشكلة، الوقت). لا open_task جديد، لا زيارة إضافية. |
| **(ب) فتح طلب منفصل** (استثناء) | العطل مختلف جوهرياً ويَحتاج فنّياً من تخصّص آخر، أو فترة زمنية مختلفة، أو معدّات مختلفة | يَكسر القاعدة. يَستلزم: سبب صريح من قائمة `emergency_uniqueness_override_reasons` + موافقة Audit Admin قبل الـ promote. |

#### القواعد الحاكمة

| الرمز | القاعدة |
|---|---|
| **EM-UNIQ-01** | فهرس جزئي فريد على `open_tasks` يَمنع وجود مهمتَين طارئَتَين نشطَتَين لنفس `installed_device_id` |
| **EM-UNIQ-02** | عند الـ promote لـ `service_request` لجهاز عليه مهمة نشطة، النظام **يَفرض** اختيار أحد المسارَين أعلاه. لا promote صامت |
| **EM-UNIQ-03** | المسار (أ) — الـ merge — يَنقل الـ service_request لـ `promoted` لكن `linked_open_task_id` يُشير للمهمة القائمة. الـ open_task لا تَنشأ. event `additional_report_attached` يُسجَّل على المهمة القائمة + audit log على الـ service_request يُسجَّل `merged_into_existing_task` |
| **EM-UNIQ-04** | المسار (ب) — الـ split — يُفعِّل `review_required_flag` على الـ service_request ويَتطلّب: (١) سبب من قائمة `emergency_uniqueness_override_reasons` (جديدة، تُنشأ من `/system-lists`) (٢) موافقة `Audit Admin` صريحة عبر `service_requests.reject` (نفس الصلاحية، لأنّ الكسر له خطورة الرفض) |
| **EM-UNIQ-05** | بعد الـ merge، الزبون يَستطيع متابعة كل بلاغاته بـ ref الـ service_request الأخير الذي قدّمه. النظام يَعرض كل الـ requests المرتبطة بنفس open_task كـ "بلاغات متابعة" في تفاصيل المهمة |
| **EM-UNIQ-06** | الـ merge متاح فقط في حالات `service_request.in_review` للـ Operator. لا merge آلي. الـ Operator يَختار بعد فهم السياق |

#### الدورية

**دورية:** فهرس جزئي فريد على `(installed_device_id, periodic_cycle_no)` حيث `status NOT IN ('completed','closed','cancelled')`. يمنع توليد دوريتَين لنفس دورة الكفالة. (نطاق V2+ من حيث intake، لكن القاعدة تَنطبق على cron-generated في V1.0)

---

## ج — التنفيذ والنتيجة

### المحور 9 — قيم `final_decision`

#### الطارئة (5 قيم) — تُكتب على `visit_task_results.final_decision`

| القيمة | اللبيل | الوصف |
|---|---|---|
| `resolved` | محلولة | تم إصلاح العطل المُبلَّغ ميدانياً + قياسات post صحيحة |
| `partially_resolved` | محلولة جزئياً | إصلاح جزئي يحتاج متابعة (قطعة مفقودة من المستودع، عطل ثانوي مكتشف) |
| `unresolved` | لم تُحلَّ | العطل مؤكَّد لكن غير قابل للإصلاح ميدانياً (يتطلّب ورشة، تبديل جهاز) |
| `needs_followup` | تحتاج متابعة | الزبون طلب متابعة بموعد محدَّد (مهلة قطعة، استشارة) |
| `cancelled` | ملغاة | الزيارة لم تتم لسبب |

#### الدورية — مسار المهمة ثم قرار نتيجة التطبيق

الدورية تفصل بين مسار المهمة وبين القرار الفني بعد تطبيق الصيانة. `rescheduled` و`cancelled` ليستا قرارات نتيجة تطبيق؛ هما مساران للمهمة نفسها قبل/بدل تسجيل نتيجة الصيانة.

| مسار المهمة | اللبيل | الوصف |
|---|---|---|
| `apply_maintenance` | تطبيق الصيانة | يدخل الفني wizard نتيجة الصيانة ويسجّل القياسات/الأعمال/القطع/التكاليف. |
| `rescheduled` | إعادة جدولة | نفس المهمة تنتقل لموعد جديد، ولا تُسجَّل نتيجة تطبيق. |
| `cancelled` | إلغاء | إلغاء إداري/تشغيلي للمهمة نفسها، ولا تُسجَّل نتيجة تطبيق. |

| `final_decision` بعد `apply_maintenance` | اللبيل | الوصف |
|---|---|---|
| `completed` | تمت الصيانة | كل البنود اللازمة أُنجزت + قياسات post. |
| `partially_performed` | أُنجزت جزئياً | تم تنفيذ الزيارة/الفحص أو جزء من الصيانة، لكن بقي جزء جوهري غير منفذ، مثل قطعة لازمة رفضها الزبون أو لم تتوفر. |
| `needs_followup` | تحتاج متابعة | توجد متابعة لاحقة مطلوبة بعد تسجيل نتيجة التطبيق. |
| `not_resolved` | لم تُحل | الحالة الفنية لم تُحل رغم محاولة التطبيق أو الفحص. |
| `customer_declined` | رفض الزبون | الزبون رفض الخدمة/الإصلاح بعد عرض التشخيص أو التكاليف. |

#### الحقول المشتركة على Header

| الحقل | إلزامي | الوصف |
|---|:---:|---|
| `final_decision` | ✅ | قرار نتيجة التطبيق حسب النوع؛ في الدورية لا يُكتب إلا بعد مسار `apply_maintenance` |
| `reason_code_id` | ⚠️ | إلزامي لكل ما عدا نتائج الإكمال الصريح (`resolved`/`completed`) |
| `closing_notes` | ❌ | textarea |
| `closed_by_employee_id` | ✅ | الفني المسؤول |

### المحور 10 — قيم `reason_code` المسموحة

| `final_decision` | فئة `system_lists` | الحالة |
|---|---|---|
| `partially_resolved` (طارئة) | `service_partial_reasons` 🆕 | تُنشأ |
| `unresolved` (طارئة) | `service_unresolved_reasons` 🆕 | تُنشأ |
| `needs_followup` (طارئة) | `customer_followup_reasons` ✅ | موجودة (DEC-006 D39) |
| `cancelled` (مسار مهمة) | `visit_cancellation_reasons` ✅ | موجودة (DEC-006) |
| `partially_performed` (دورية) | `periodic_partial_reasons` 🆕 | تُنشأ |
| `needs_followup` (دورية) | `periodic_followup_reasons` 🆕 | تُنشأ |
| `not_resolved` (دورية) | `periodic_not_resolved_reasons` 🆕 | تُنشأ |
| `customer_declined` (دورية) | `periodic_customer_decline_reasons` 🆕 | تُنشأ |
| `rescheduled` (مسار مهمة) | `periodic_reschedule_reasons` 🆕 | تُنشأ |

> **مبدأ الفئات:** إعادة استخدام الموجود قدر الإمكان. الفئات الجديدة تُنشأ من شاشة `/system-lists` لا من migrations.

### المحور 11 — Side Tables (منظومة النتيجة المشتركة)

#### ١١.أ جداول مرتبطة بـ `service_request` → `open_task` (مستوى الـ task)

| الجدول | الغرض | متى يُكتب | الحالة الراهنة |
|---|---|---|---|
| `service_request_problems` (٠.١٩) | لائحة الأعطال المُهيكَلة — تَنشأ على service_request، تَنتقل ملكيتها لـ open_task عند promote | يَبدأ عند intake، يَتطوّر عبر الزيارات | 🆕 جديد |
| `open_task_emergency_payload` (P-MAINT-10) | بيانات الطارئة المُخصَّصة على مستوى open_task (UNIQUE FK 1:1) | عند promote | 🆕 جديد |
| `open_task_periodic_payload` (V2) | بيانات الدورية المُخصَّصة على مستوى open_task | عند توليد cron الدورية | ⏳ V2 |

#### ١١.ب جداول مرتبطة بـ `visit_task_results` (مستوى الزيارة)

| الجدول | الغرض | متى يُكتب | الحالة الراهنة |
|---|---|---|---|
| `visit_task_results` | السجل العام | لكل النتائج | ✅ موجود |
| `device_technical_states` (`phase='pre'`) | قياسات قبل العمل | إلزامي للنوعين عند بدء التنفيذ | ✅ موجود ومُصمَّم لـ pre/post |
| `device_technical_states` (`phase='post'`) | قياسات بعد العمل | إلزامي للنوعين عند الإغلاق (إلا الملغاة) | ✅ موجود |
| `visit_task_maintenance_actions` (إعادة تسمية مقترَحة من `emergency_maintenance_actions`) | ما الذي فعله الفني + إجراءات `emergency_action_types` | عند `resolved`/`completed`/`partially_*` | 🔄 موجود باسم emergency فقط |
| `visit_task_parts_used` (إعادة تسمية مقترَحة من `visit_task_emergency_parts_used`) | القطع المستخدَمة مع `maintenance_type` tag | عند تبديل أي قطعة | 🔄 موجود |
| `visit_task_service_financials` (إعادة تسمية مقترَحة من `visit_task_emergency_financials`) | التسوية المالية | إلزامي للطارئة، شرطي للدورية | 🔄 موجود |

#### ١١.ج العلاقة بين الطبقتين

- لائحة الأعطال (`service_request_problems`) **تَعيش على مستوى open_task** (تَستمرّ عبر زيارات متعدّدة).
- نتيجة كل زيارة (`visit_task_results` + side tables) **تَعمل على اللائحة**: تَحلّ بنوداً، تُؤجِّل أخرى، تُضيف مكتشَفات.
- ربط البند بالزيارة التي أصلحته عبر `service_request_problems.resolution_visit_task_id`.
- القياسات الفنية (`device_technical_states`) تَبقى مربوطة بـ `visit_task_id`، تُعرَض في الواجهة لكل عطل عبر القاعدة المُعتمَدة في ٠.١٩.ز.

#### التحويلات المطلوبة في schema (migrations مرحلية)

- **بدون تغيير بنية:** فقط إعادة تسمية لإزالة لاحقة `emergency` من الجداول التي ستُشارَك. الـ FK والـ CHECK كلها تُنقَل بلا تعديل.
- **إضافة عمود واحد:** `task_type_at_record` على `visit_task_parts_used` و `visit_task_service_financials` للتقارير ("في أي نوع مهمة استُهلكت القطعة"). لا يُستخدم للمنطق.
- **`device_technical_states` بدون تعديل** — `phase` و `open_task_id` و `contract_id` كلها كافية.

### المحور 11.أ — ربط الإجراءات بالقطع

`emergency_action_types` (admin-curated) + `emergency_maintenance_actions.parts_used` JSONB موجودان فعلاً. يُعاد استخدامهما للنوعين بعد إعادة التسمية إلى `service_action_types` و `visit_task_maintenance_actions`.

### المحور 11.ب — منظومة الـ 4 مراحل

التنفيذ القائم في [`emergencyResult.ts`](packages/api/routes/emergencyResult.ts) يستخدم 4 مراحل:
1. `pre-state` → `device_technical_states (phase='pre')`
2. `actions` → `emergency_maintenance_actions`
3. `post-state` → `device_technical_states (phase='post')`
4. `costs` → `emergency_result_costs` + `emergency_result_parts` + `emergency_payment_entries` + `emergency_installments`

**القرار المقترَح:** الإبقاء على نموذج الـ 4 مراحل كـ UX wizard لكلتا الصيانتين (مع تخطّي مرحلة `costs` تلقائياً للدورية المغطّاة بالكفالة).

---

## د — التأثير الجانبي

### المحور 12 — انعكاس النتيجة على `open_task.status`

#### الطارئة

| `final_decision` | `open_task.status` بعد | حقول تُحدَّث |
|---|---|---|
| `resolved` | `completed` | `last_waiting_status` |
| `partially_resolved` | `needs_follow_up` | `expected_date` + سبب |
| `unresolved` | `needs_follow_up` | `expected_date` + سبب + ملاحظة "يحتاج ورشة" |
| `needs_followup` | `needs_follow_up` | `expected_date` + `expected_time` |
| `cancelled` | `cancelled` | `cancellation_reason` |

#### الدورية

| `final_decision` | `open_task.status` بعد | حقول تُحدَّث |
|---|---|---|
| مسار `apply_maintenance` + `completed` | `completed` | `last_periodic_at = closed_at` + توليد الدورية التالية حسب الفترة |
| مسار `apply_maintenance` + `partially_performed` | `completed` أو `needs_follow_up` حسب سياسة المتابعة | حفظ النواقص/رفض الزبون + توليد/متابعة حسب ملف الدورية |
| مسار `apply_maintenance` + `needs_followup` | `needs_follow_up` | `expected_date` + سبب |
| مسار `apply_maintenance` + `not_resolved` | `needs_follow_up` | سبب + ملاحظة فنية |
| مسار `apply_maintenance` + `customer_declined` | `completed` أو `cancelled` حسب سياسة التشغيل | سبب الرفض، لا تُحسب كإكمال كامل |
| مسار `rescheduled` | يبقى مفتوحاً/مجدولاً | `expected_date` جديد |
| مسار `cancelled` | `cancelled` | `cancellation_reason` |

### المحور 13 — Cascading Effects

#### 13.أ — توليد المهام بعد إكمال الطارئة

| المُطلِق | الـ artifact المولَّد |
|---|---|
| `resolved` + قطعة `maintenance_type='Periodic'` بُدِّلت | UPDATE `installed_devices.next_periodic_due_date = closed_at + 6_months` + إلغاء/تأجيل `open_task` دورية مجدولة قائمة |
| `partially_resolved`/`resolved` + `emergency_installments` بُذرت | `open_task` جديدة بـ `task_type='collection'` للقسط الأول، `required_date` من جدول الأقساط |
| `unresolved` + قرار "يحتاج ورشة" | ملاحظة على `emergency_tickets` + open_task جديدة (نوع لاحق `workshop_repair` إن أُدخل) |

#### 13.ب — توليد المهام بعد إكمال الدورية

| المُطلِق | الـ artifact المولَّد |
|---|---|
| مسار `apply_maintenance` + `final_decision IN ('completed','partially_performed')` | `open_task` دورية تالية بـ `task_type='periodic_maintenance'` + `due_date = closed_at + maintenance_interval` |
| مسار `rescheduled` أو `cancelled` | لا توليد لدورية تالية؛ إما تعديل نفس المهمة أو إغلاقها إدارياً |
| اكتشاف عطل أثناء التنفيذ (مُحسَمة 2026-06-04) | بنداً جديد في **لائحة الأعطال** (`added_during_phase = 'field_discovery'`) داخل نفس open_task الدورية. **لا visit_task جديد، لا open_task جديد، لا cascading.** القطع المُستهلَكة لـ هذا البند تَتبع تصنيفها وفق الطبقة 3 |

### المحور 13.أ.ج — آلية تأجيل الدورية المُحفَّزة بالقطع (الجسر الجوهري)

**القاعدة:** عند حفظ صف في `visit_task_parts_used` حيث `maintenance_type = 'Periodic'`، يُنفَّذ:

```
recomputePeriodicSchedule(installed_device_id):
  1. حدّد كل open_tasks دورية نشطة (status NOT IN terminal) لهذا الجهاز.
  2. لكل واحدة منها:
     - إن كان due_date < (today + 6_months):
        → تأجيل due_date إلى (today + 6_months)
        → أو إلغاء واستبدال بـ open_task جديدة بـ due_date الجديد
  3. UPDATE installed_devices.last_periodic_part_replaced_at = NOW().
```

**مكان التنفيذ المقترَح:** `services/periodicScheduleReflection.ts` يُستدعى من الـ unified result endpoint بعد كل `INSERT` لقطعة Periodic.

**نقطة معلَّقة (P-MAINT-02):** هل 6 أشهر ثابتة لكل القطع، أم تتبع `spare_parts.service_interval_months` المحدَّد لكل قطعة؟

### المحور 13.ب.ج — التصنيف التشغيلي للزبون
لا تأثير من النوعَين على `LEAD/FOP/OP`. الزبون الذي وصل لمرحلة `OP` (لديه عقد) يحتفظ بتصنيفه عبر دورات الصيانة، والتصنيف لا يتدهور بسبب نتائج صيانة سلبية.

---

## هـ — الصلاحيات

### المحور 14

| الفعل | الصلاحية | الدور المرجعي |
|---|---|---|
| إنشاء طارئة يدوياً / من بلاغ | `open_tasks.edit` + `emergency_tickets.create` | تيليماركتر / مدير |
| إنشاء دورية | `system_trigger` فقط — لا واجهة يدوية معتمدة | (cron) |
| تنفيذ طارئة (`field_visits.execute`) | `field_visits.execute` | **فريق طوارئ أو قياسي** (PL-R011 D31) |
| تنفيذ دورية (`field_visits.execute`) | `field_visits.execute` | **فريق قياسي حصراً** (PL-R011 D31) |
| تسجيل النتيجة | `field_visits.execute` | الفني المسؤول |
| الإقفال الإداري النهائي (`closed`) | `field_visits.update_result` | مشرف / مدير |
| فتح `closed` | `field_visits.reopen_closed` | إدارة عليا |
| تعديل `emergency_action_types` (admin list) | `admin.settings.edit` | إدارة عليا |

---

## التنفيذ التقني — Endpoint موحَّد مقترَح

```
POST /field-visits/:visitId/tasks/:taskId/result
```

Body بـ discriminator على `task_type`. خدمة موحَّدة (`visitTaskResultReflection.ts::applyMaintenanceResult`) تكتب:

1. `visit_task_results`
2. `device_technical_states` (`phase='pre'` + `phase='post'` إن لزم)
3. `visit_task_maintenance_actions`
4. `visit_task_parts_used` (مع `maintenance_type` لكل قطعة)
5. `visit_task_service_financials` (للطارئة دائماً، للدورية شرطياً)
6. **Reflection على `open_task.status`** حسب جدول 12
7. **`recomputePeriodicSchedule(installed_device_id)`** إن وُجدت قطعة بـ `maintenance_type='Periodic'`
8. Cascading `open_tasks` (collection للأقساط، periodic للدورية القادمة)
9. `checkAndCompleteVisit(visitId)`

كل ذلك داخل **transaction واحدة**.

### التعامل مع الـ Legacy

الـ endpoints القائمة `PUT /api/emergency-result/:taskId/pre-state | actions | post-state | costs` تبقى عاملةً في فترة انتقالية. بعد جاهزية الـ unified endpoint، يتم:
1. إعادة توجيه الـ frontend wizard للنداء الجديد.
2. الإبقاء على الـ endpoints القديمة في read-only mode للتوافق التاريخي.
3. حذفها بعد 14 يوم staging stable (مماثل لخطة DEC-003 لـ `telemarketing_appointments`).

---

## قائمة الفحص (Release Checklist)

- [ ] صفّان في `task_type_config` للنوعين بـ `task_family='service'`, `location_basis='device'`, `display_group='maintenance'`.
- [ ] `planning_window_days` مختلفة: 2 للطارئة، 30 للدورية.
- [ ] CHECK على `visit_tasks.task_type` يشمل النوعين.
- [ ] إعادة تسمية الجداول المشتركة: `visit_task_emergency_*` → `visit_task_service_*` (3 جداول).
- [ ] إعادة تسمية `emergency_action_types` → `service_action_types` + `emergency_maintenance_actions` → `visit_task_maintenance_actions`.
- [ ] إضافة `task_type_at_record` على `visit_task_parts_used` و `visit_task_service_financials`.
- [ ] CHECK على `visit_task_results.final_decision` يشمل قيم الطارئة وقيم الدورية بعد `apply_maintenance` فقط.
- [ ] فئات `system_lists` الجديدة للنتائج والمسارات: partial/unresolved للطوارئ، و`periodic_partial_reasons` / `periodic_followup_reasons` / `periodic_not_resolved_reasons` / `periodic_customer_decline_reasons` / `periodic_reschedule_reasons` / `periodic_cancellation_reasons` للدورية.
- [ ] فئة `system_lists` جديدة `diagnosis_problem_types` للائحة (ب) — تشخيص الأعطال المكتشَفة (P-MAINT-12).
- [ ] جدول `open_task_emergency_payload` (UNIQUE FK → `open_tasks(id)`) بـ: `source_service_request_id`, `reported_problem_snapshot`, `reported_action_type_id` (P-MAINT-10).
- [ ] خدمة `services/openTaskEmergencyPayload.ts::createFromServiceRequest()` تُستدعى من promote.

#### قائمة فحص لائحة الأعطال (٠.١٩)

- [ ] جدول `service_request_problems` بـ schema قسم ٠.١٩.ب كاملة.
- [ ] CHECK على `status` يشمل الـ 7 قيم (`reported`/`confirmed`/`resolved_at_intake`/`resolved`/`deferred`/`unresolvable_field`/`cancelled`).
- [ ] CHECK على `added_during_phase` يشمل الـ 4 قيم (`intake`/`in_review`/`technical_consultation`/`field_discovery`).
- [ ] CHECK مركَّب: `installed_device_id` يَنتمي لـ `beneficiary_client_id` على الطلب (EM-PROB-05).
- [ ] CHECK: `status = 'resolved'` immutable إلا بـ Audit Admin (EM-PROB-02) — يُفرَض app-level + DB trigger.
- [ ] جميع indexes ٠.١٩.ج مُنشأة.
- [ ] Audit events السبعة (٠.١٩.و) مُضافة لـ `service_request_audit_log.event_type` CHECK.
- [ ] State machine middleware يفرض مصفوفة الصلاحيات (٠.١٩.هـ) بحسب مرحلة الطلب.
- [ ] خدمة `services/serviceRequestProblems.ts` للـ CRUD + reflection على status.
- [ ] خدمة `services/openTaskDerivedOutcome.ts::compute()` تَحسب derived_outcome من اللائحة (٠.١٩.ح).
- [ ] Endpoints:
  - [ ] `POST /service-requests/:id/problems` — إضافة عطل (مع `added_during_phase`).
  - [ ] `PATCH /service-requests/:id/problems/:problemId` — تعديل (تفاصيل/نوع).
  - [ ] `PATCH /service-requests/:id/problems/:problemId/status` — تغيير status.
  - [ ] `POST /service-requests/:id/problems/:problemId/record-resolution` — تسجيل نتيجة (مع `repaired_by_employee_id`).
  - [ ] `DELETE /service-requests/:id/problems/:problemId` — soft delete + reason.
  - [ ] `POST /service-requests/:id/problems/:problemId/restore` — استعادة (Audit Admin).
  - [ ] `POST /service-requests/:id/problems/:problemId/override` — Audit Admin override بعد إغلاق visit.
  - [ ] `GET /open-tasks/:id/problems` — لائحة أعطال المهمة (للزيارة).
- [ ] UI: قاعدة عرض القياسات الفنية على البطاقة لكل عطل مع التنبيه (٠.١٩.ز).
- [ ] UI: بادج "مُكتشَف في الميدان" للأعطال بـ `added_during_phase = 'field_discovery'` (٠.١٩.ط).
- [ ] `services/visitTaskResultReflection.ts::applyMaintenanceResult()` يخدم النوعين بـ discriminator.
- [ ] `services/periodicScheduleReflection.ts` للتأجيل المُحفَّز بالقطع.
- [ ] endpoint `POST /field-visits/:visitId/tasks/:taskId/result` يُكمَل ليخدم النوعين.
- [ ] Cron job يومي لتوليد periodic `open_tasks` من `installed_devices` (warranty_visits + maintenance_plan).
- [ ] الـ 4-phase emergency endpoints القديمة تُعلَّم deprecated مع timeline حذف.
- [ ] الصلاحيات الست موجودة وموثَّقة، PL-R011 D31 يُفرَض في layer التنفيذ.
- [ ] UI wizard يستوعب الـ 4 مراحل للنوعين مع skip تلقائي لـ `costs` على الدورية المغطّاة.

### قائمة فحص إضافية — Service Requests (V1 طوارئ فقط)

#### Schema & Constraints

- [ ] جدول `service_requests` بـ schema قسم ٠.٧ كاملة.
- [ ] CHECK على `status` يشمل الـ 6 حالات من ٠.٣.
- [ ] CHECK على `channel` يشمل القنوات السبع من ٠.٦ — **immutable بعد الإنشاء** (DB trigger يمنع UPDATE).
- [ ] CHECK على `triage_outcome` يشمل القيم الـ 14 من ٠.٥.
- [ ] CHECK على `submission_type ∈ ('apply', 'refer_a_candidate')`.
- [ ] CHECK على `submitter_tier ∈ ('visitor', 'lead', 'fop', 'op', 'staff')`.
- [ ] CHECK على `device_source ∈ ('company_device', 'external_device')`.
- [ ] CHECK مركَّب: `(device_source='external_device' AND installed_device_id IS NULL AND external_device_name IS NOT NULL) OR (device_source='company_device' AND external_device_name IS NULL)`.
- [ ] CHECK مركَّب: `(submission_type='apply' AND beneficiary_client_id = requester_user_id::client_id) OR (submission_type='refer_a_candidate')`.

#### Indexes

- [ ] Index `(status, branch_id, created_at DESC)` للـ dashboard.
- [ ] Index جزئي `(beneficiary_client_id) WHERE status NOT IN (terminal)` — منع التكرار النشط.
- [ ] Index جزئي `(installed_device_id) WHERE status NOT IN (terminal)` — منع طلبات متوازية لنفس الجهاز.
- [ ] Index جزئي `(review_required_flag) WHERE review_required_flag = TRUE`.
- [ ] Index جزئي `(duplicate_flag) WHERE duplicate_flag = TRUE AND status NOT IN (terminal)`.
- [ ] UNIQUE على `public_ref_number WHERE archived_at IS NULL`.
- [ ] Index `(archived_at)` للتفريق بين فعّال ومُؤرشف.

#### Audit Log

- [ ] جدول `service_request_audit_log` بـ schema ٠.١٧.
- [ ] CHECK على `event_type` يشمل الـ 16 event من ٠.١٧.
- [ ] CHECK على `actor_role ∈ ('operator', 'audit_admin', 'system', 'customer')`.
- [ ] Trigger لمنع UPDATE/DELETE على الجدول (append-only).
- [ ] FK ON DELETE CASCADE من `service_request_id`.

#### Roles & Permissions (نموذج الصلاحية الثنائي ٠.١٦)

- [ ] صلاحية `service_requests.view` (BRANCH/GLOBAL) لكل من Operator و Audit Admin.
- [ ] صلاحية `service_requests.create` للقنوات الداخلية (موظف يُنشئ من floating button/تفاصيل زبون).
- [ ] صلاحية `service_requests.review` — Admin Operator حصراً.
- [ ] صلاحية `service_requests.reject` — Request Audit Admin حصراً.
- [ ] صلاحية `service_requests.promote` — Admin Operator (تابعة لـ review).
- [ ] دور `request_audit_admin` كدور جديد في `roles` table أو متفرّع من branch_manager.

#### Application Layer Rules (SR-R001..R010 + SR-AUTH-01..05)

- [ ] State machine middleware يفرض الـ 10 قواعد انتقال (SR-R001..SR-R010).
- [ ] Authorization guard يفرض الـ 5 قواعد صلاحية (SR-AUTH-01..SR-AUTH-05).
- [ ] منطق توليد `public_ref_number` بتنسيق `SR-YYYYMMDD-NNNN` (٠.٧.أ + SR-REF-01..05).
- [ ] خدمة Fuzzy Matching للـ Suggested Records List (`services/serviceRequestMatching.ts`).
- [ ] Extension `pg_trgm` مُمَكَّنة على DB.
- [ ] Index `gin` على `problem_description` بـ `gin_trgm_ops`.
- [ ] Index على آخر 7 أرقام من الهاتف (`right(requester_external->>'phone', 7)`).
- [ ] خدمة Duplicate Detection (`services/serviceRequestDuplicates.ts::detectDuplicates`) — 3 محاور موزونة + عتبة 0.75 — راجع ٠.١٥.أ.
- [ ] مفاتيح `system_settings`: `service_request_duplicate_threshold` (افتراضي 0.75)، `service_request_duplicate_window_hours` (افتراضي 72)، الأوزان الثلاثة (افتراضي 0.50/0.25/0.25).
- [ ] Immutability enforcer — DB trigger أو app-level guard يمنع UPDATE على الحقول المُسمَّاة في SR-R008.
- [ ] Validation للحقول الإلزامية walk-in (٠.١٧.أ + SR-WALKIN-01..06) — server-side قبل INSERT.
- [ ] Phone pattern normalize (10 أرقام، تحويل +963 ⇄ 0).
- [ ] Cron job يومي: auto-cancel للـ `awaiting_customer_info` بعد 7 أيام (٠.٤.ج).
- [ ] Setting `system_settings.service_request_awaiting_auto_cancel_days` (افتراضي 7).

#### Endpoints

- [ ] `POST /service-requests` (public، لـ mobile_app/website بـ rate-limit + OTP إن لزم — P-MAINT-SR-13).
- [ ] `POST /service-requests/internal` (auth، لـ القنوات الداخلية).
- [ ] `POST /service-requests/:id/claim` — Operator يأخذ الطلب لـ in_review.
- [ ] `POST /service-requests/:id/link` — ربط بـ client/candidate (Fuzzy match).
- [ ] `POST /service-requests/:id/request-info` — انتقال إلى awaiting_customer_info.
- [ ] `POST /service-requests/:id/resume-review` — رجوع من awaiting إلى in_review.
- [ ] `POST /service-requests/:id/resolve-at-intake` — مع `triage_outcome`.
- [ ] `POST /service-requests/:id/escalate` — تفعيل `review_required_flag`.
- [ ] `POST /service-requests/:id/reject` — Audit Admin فقط.
- [ ] `POST /service-requests/:id/promote` — إنشاء `open_task` (transaction).
- [ ] `POST /service-requests/:id/cancel` — admin-initiated.
- [ ] `POST /service-requests/:id/archive`.
- [ ] `POST /service-requests/:id/unarchive` — قبل إعادة فتح بعد أرشفة (SR-REOPEN-05).
- [ ] `POST /service-requests/:id/reopen` — مع `reopen_reason` مهيكل + فرض صلاحية حسب terminal السابق (٠.٤.ب).
- [ ] `POST /service-requests/:id/take-over` — Operator يَستبدِل `reviewed_by_user_id` (٠.٤.أ — SR-CLAIM-02).
- [ ] `POST /service-requests/:id/change-linkage` — تغيير الربط (٠.١٧.ب — SR-CAND-01).
- [ ] `POST /service-requests/:id/merge` — دمج مع `open_task` قائم بدل promote جديد (المحور 8 — EM-UNIQ-03). يَستلزم اكتشاف مسبق لمهمة نشطة على نفس الجهاز.
- [ ] فهرس جزئي فريد على `open_tasks.installed_device_id` لـ emergency النشطة (EM-UNIQ-01).
- [ ] فئة `emergency_uniqueness_override_reasons` تُنشأ من `/system-lists` (EM-UNIQ-04).
- [ ] View محسوب لـ Candidate orphan (SR-CAND-02) في شاشة candidates management.
- [ ] `GET /service-requests` (مع فلاتر شاملة).
- [ ] `GET /service-requests/:id` (مع audit_log embedded).
- [ ] `GET /service-requests/:id/suggested-matches` — Fuzzy matching للربط.

#### Migration & Cleanup

- [ ] خطة ترحيل `emergency_tickets` إلى `service_requests` بـ channel='phone' (5 مراحل قسم ٠.٩).
- [ ] frontend: floating button + زر "إنشاء صيانة" من تفاصيل الزبون يُعاد توصيلهما لإنشاء `service_request` بـ `in_review` بدلاً من `open_task` مباشرة.

---

## نقاط معلَّقة للنقاش (Pending Resolutions)

### مهام الصيانة (النوعان)

| الرمز | الموضوع | السؤال |
|---|---|---|
| **P-MAINT-01** | بنية جدول الدورية | هل `installed_devices.warranty_visits` كافٍ لتوليد cron الدورية، أم نحتاج جدول `device_periodic_schedule` لكل (جهاز، قطعة، تاريخ استحقاق)؟ |
| **P-MAINT-02** | مدّة التأجيل بعد تبديل قطعة Periodic | **مُحسَمة (2026-06-04):** ينحلّ تلقائياً بتبنّي الإطار الثلاثي. تبديل قطعة Periodic ⇒ التاريخ يُسجَّل ⇒ الدورية القادمة تُحسَب من جديد. لا تنبيه خاص ولا منطق مختلف بحسب سياق التبديل. راجع "الإطار التنفيذي الجوهري". |
| **P-MAINT-03** | البلاغ الثاني على نفس الجهاز | **مُحسَمة (2026-06-03):** فلسفة "زبون واحد، جهاز واحد، طلب واحد". خياران للموظف عند اكتشاف مهمة قائمة: (أ) دمج (افتراضي، 90% الحالات) (ب) فتح منفصل (استثناء بسبب صريح + موافقة Audit Admin). راجع المحور 8 و EM-UNIQ-01..06. |
| **P-MAINT-04** | cascade emergency داخل دورية | **مُحسَمة (2026-06-04):** **لا cascade**. البند يَنضمّ كـ "تشخيص مكتشَف" في لائحة (ب) داخل نفس الزيارة، لا open_task جديد. التصنيف المالي للقطع المُستخدَمة يَتبع الطبقة 3 (تصنيف القطعة + الكفالات). راجع "الإطار التنفيذي الجوهري". |
| **P-MAINT-05** | توقيت توليد periodic القادمة | عند إكمال السابقة (eager) أم cron يومي (lazy)؟ |
| **P-MAINT-06** | تعامل الكفالة الذهبية | **مُحسَمة جزئياً (2026-06-04):** على مستوى التغطية، الكفالة الذهبية تَلتقط القطع غير-`Periodic` فقط (القطع المكتشَفة في لائحة ب). لا تَدخل في الدوريّات المخطَّطة. التساؤلات المتبقّية حول "زيارات دورية إضافية أم تمديد فترة" تَنطبق فقط على دورية cron-generated، ضمن P-MAINT-05 و P-MAINT-09 (مُؤجَّلَتان لـ V2). |
| **P-MAINT-07** | الدورية المغطّاة مالياً | هل skip تلقائي لـ phase 4 (costs) للدورية ضمن الكفالة، أم تظهر دائماً بـ total = 0 لتوثيق العمالة المجانية؟ |
| **P-MAINT-08** | علاقة `emergency_tickets` بـ open_task | **مُحسَمة (2026-06-03):** `emergency_tickets` يصبح legacy، يُستبدَل بـ `service_requests`. راجع قسم ٠.٩. |
| **P-MAINT-09** | عدم تنفيذ الدورية | تم تصحيح المصطلح: لا يوجد `not_performed` كـ`final_decision` للدورية. عدم التنفيذ قبل التطبيق يُعبَّر بمسار `rescheduled`/`cancelled`، والتعذر بعد التطبيق يُعبَّر بـ`not_resolved`/`customer_declined` حسب الحالة. |

### Service Requests (V1 — طوارئ فقط)

#### النقاط المُحسَمة

| الرمز | الموضوع | الحسم |
|---|---|---|
| **P-MAINT-SR-05** | طلب من زبون غير معروف | **مُحسَمة (2026-06-03):** `beneficiary_client_id`/`beneficiary_candidate_id` NULLABLE عند الإرسال. الـ Operator يربط أثناء `in_review` عبر Suggested Records List (Fuzzy Matching). يستطيع إنشاء Candidate جديد لو لا تطابق. الربط إلزامي قبل `promoted` (SR-R004). |
| **P-MAINT-SR-08** | branch_id resolution | **مُحسَمة (2026-06-03):** صفحة الطلبات `GLOBAL` بالكامل. كل صلاحيات معالجة الـ service_requests (`view/review/reject/promote/archive`) محصورة بـ `GLOBAL` scope. الـ `branch_id` على الطلب tracking-only، لا access-control. عند `promote`، `open_tasks.branch_id` يُحسَب من `beneficiary_client.branch_id` (SR-AUTH-06). راجع ٠.٨ و ٠.١٦. |
| **P-MAINT-SR-12** | `external_device` — يُرَقَّى أم يُرفَض؟ | **مُحسَمة (2026-06-03):** **يُقبَل ويُرَقَّى** بناءً على `contracts/01b §2` و `DEC-CT-02`. خطوة promote موسَّعة تُنشئ `installed_device` خفيفاً (`contract_id = NULL`) من بيانات `external_device_*` ضمن نفس transaction. `service_agreement` غير مطلوب لطارئة لمرة واحدة. راجع ٠.١٣. |
| **P-MAINT-SR-03** | إعادة الفتح بعد terminal | **مُحسَمة (2026-06-03):** مسموحة بمسارات مختلفة. `rejected` تعود بـ صلاحية Audit Admin، `resolved_at_intake` و `cancelled` بـ صلاحية Operator، `promoted` لا تعود (open_task هو الكيان). إعادة الفتح تنقل إلى `in_review` (لا `received`). `reopen_count > 2` يُفعِّل `review_required_flag` آلياً. راجع ٠.٤.ب و SR-REOPEN-01..05. |
| **P-MAINT-SR-02** | claim الطلب | **مُحسَمة (2026-06-03):** Non-exclusive claim مع soft ownership. أي Operator يستطيع التولّي بلا قفل DB، `reviewed_by_user_id` يُحدَّث، event `claim_transferred` يُسجَّل، الـ Operator السابق يَستلِم notification. Audit Admin لا يَستبدِل الـ owner عند تدخّله. راجع ٠.٤.أ و SR-CLAIM-01..07. |
| **P-MAINT-SR-06** | duplicate detection — مفاتيح المطابقة | **مُحسَمة (2026-06-03):** Fuzzy matching بـ 3 محاور موزونة: phone 0.50، device 0.25، problem (pg_trgm) 0.25. عتبة 0.75 لإطلاق `duplicate_flag` آلياً. نافذة 72h. استبعاد الطلبات الـ terminal. قابلية ضبط الأوزان والعتبة من `system_settings`. راجع ٠.١٥.أ. |
| **P-MAINT-SR-01** | SLA الـ in_review | **مُحسَمة (2026-06-03):** **لا SLA في V1.0.** الـ Operator يَعمل بـ priority الطلب وحمل العمل اليومي، لا بـ timer. لا `overdue_flag`، لا تنبيهات تجاوز زمن. راجع ٠.٤.ج. |
| **P-MAINT-SR-07** | SLA الـ awaiting_customer_info | **مُحسَمة (2026-06-03):** auto-cancel بعد **7 أيام** (قابل للضبط من `system_settings`) بـ `triage_outcome='customer_no_response'`. هذه القاعدة الزمنية الوحيدة في V1.0. راجع ٠.٤.ج. |
| **P-MAINT-SR-04** | تنسيق `public_ref_number` | **مُحسَمة (2026-06-03):** تنسيق `SR-YYYYMMDD-NNNN` (مثل `SR-20260603-0042`). prefix ثابت + تاريخ كامل + عدّاد يومي يُصفَّر كل يوم. ذو معنى وَجاهي، مركزي عبر الشركة. راجع ٠.٧.أ و SR-REF-01..05. |
| **P-MAINT-SR-10** | الحقول الإلزامية في walk-in | **مُحسَمة (2026-06-03):** أربعة حقول إلزامية: اسم + هاتف رئيسي (في `requester_external`) + محافظة + عنوان تفصيلي (في `service_address`). راجع ٠.١٧.أ و SR-WALKIN-01..06. |
| **P-MAINT-SR-14** | تراجع عن Candidate خاطئ | **مُحسَمة (2026-06-03):** Soft handling عبر relink من شاشة الطلب (لا hard delete). الـ Candidate orphan يُكتشَف عبر view محسوب، حذفه يَتم من شاشة candidates management المستقلة. event `linkage_changed` للـ audit. راجع ٠.١٧.ب و SR-CAND-01..05. |
| **P-MAINT-SR-09** | endpoints عامة | **مُؤجَّلة لـ V1.1+ (خارج نطاق V1.0):** القنوات الخارجية محجوزة في schema لكن لا تُفعَّل في V1.0. |

#### النقاط المُؤجَّلة لـ V1.1+ (القنوات الخارجية)

> الـ schema يحفظ مساحتها لكن لا نناقشها الآن. تُفتَح عند تفعيل `mobile_app` / `website` / `whatsapp` لاحقاً.

| الرمز | الموضوع |
|---|---|
| **P-MAINT-SR-09** | endpoints عامة بدون auth |
| **P-MAINT-SR-11** | حدود المرفقات (PNG/JPG، فيديو ≤ 20s) |
| **P-MAINT-SR-13** | حماية القنوات العامة (OTP / rate-limit / CAPTCHA) |
| **P-MAINT-SR-15** | Referrer كـ Visitor — Candidate تلقائي؟ |
| (مُتعلِّق بـ Visitor tier) | كل قواعد الـ form الخاصة بـ Visitor — تظهر فقط حين القنوات الخارجية تُفعَّل |

#### النقاط المتبقّية في نطاق V1.0 (قنوات داخلية فقط)

**✅ جميع نقاط V1.0 لـ Service Requests مُحسَمة (2026-06-03).**

البنية والقواعد جاهزة للتنفيذ. أي قرارات لاحقة لـ V1.1+ (القنوات الخارجية، Periodic عبر intake، إلخ) تُضاف ضمن قسم منفصل عند فتحها.

---

## مكتشَفات الفحص (Implementation Audit — 2026-06-03)

من فحص الكود الحالي:

| الموجود | الاسم في الكود | الحالة |
|---|---|---|
| نظام 4 مراحل للطوارئ | `routes/emergencyResult.ts` (1567 سطر) | منفَّذ بالكامل، يربط بـ `open_task_id` (نمط قديم) |
| Side tables طارئة على `visit_task_result_id` | `visit_task_emergency_*` (3 جداول) | منفَّذة، التحوُّل لنموذج DEC-007 |
| Side tables طارئة على `open_task_id` (Legacy) | `emergency_result_costs` + `emergency_result_parts` + `emergency_payment_entries` + `emergency_installments` | تعمل بالتوازي مع الحديثة |
| جدول الإجراءات | `emergency_action_types` + `emergency_maintenance_actions` | admin-curated، جاهز للتوسعة |
| القياسات المشتركة | `device_technical_states` مع `phase CHECK ('pre','post','standalone')` | **جاهز سلفاً لـ pre/post بدون أي تغيير** |
| تصنيف القطعة | `spare_parts.maintenance_type CHECK ('Periodic','Emergency','Accessory')` | **الجسر المطلوب موجود** |
| عدّاد الكفالة | `installed_devices.warranty_visits` + `warranty_months` | موجود |
| Periodic task type | **غير موجود حالياً** كنوع منفصل | يحتاج إضافة |
| Periodic cron generator | **غير موجود** | يحتاج إنشاء |
| `device_periodic_schedule` table | **غير موجود** | يحتاج قرار P-MAINT-01 |
| `service_requests` كطبقة intake عامة | **غير موجود** | يحتاج إنشاء — راجع قسم ٠ |
| `emergency_tickets` كنموذج intake خاص بالمكالمات | موجود | يُهجَّر إلى `service_requests` بـ channel='phone' |
| floating button + زر تفاصيل الزبون لإنشاء طارئة | موجود في الـ frontend | يُعاد توصيله ليُنشئ `service_request` بـ `in_review` بدل `open_task` مباشرة |

**الخلاصة:** البنية التحتية للمنظومة المشتركة موجودة فعلياً. ما ينقص أساساً:
1. تعريف `periodic_maintenance` كـ `task_type` معتمَد.
2. Cron toggle لتوليد periodic open_tasks.
3. آلية `recomputePeriodicSchedule()` المُحفَّزة بالقطع.
4. إعادة تسمية الجداول لإزالة prefix `emergency`.
5. الـ unified result endpoint بـ discriminator.
6. **جدول `service_requests` كاملاً (طبقة intake جديدة) — راجع قسم ٠.**
7. **توصيل القنوات (موبايل، موقع، floating button، زر تفاصيل الزبون) بـ `service_requests` بدل `open_tasks` مباشرة.**

### تحليل Visit Result Wizard الحالي (2026-06-04)

فحص `packages/web/src/components/emergency/EmergencyResultWizard.tsx` يَكشف بنية 4 مراحل مُطابقة لقرار المحور 11.ب:

```
EmergencyResultWizard
├── Phase 1: preState   (TechStateForm phase='pre')
├── Phase 2: actions    (MaintenanceActionsForm)
├── Phase 3: postState  (TechStateForm phase='post')
└── Phase 4: costs      (CostsForm)
```

#### ما يَتطابق مع الدستور (≈70% بنية، 50% data model)

| المحور | الحالة |
|---|---|
| 4 مراحل بنفس الترتيب | ✅ مطابق |
| `device_technical_states` pre + post | ✅ مطابق |
| تصنيف القطع `Periodic`/`Emergency`/`Accessory` | ✅ مطابق (filter dropdown + labels عربية) |
| القطع بـ `retrieved`/`placement_state` + `no_retrieval_reason` | ✅ موجود |
| Auto-save للقطع بدون wizard reload | ✅ UX جيد (MaintenanceActionsForm:308-326) |
| Cost breakdown + discounts + payment + installments | ✅ كامل في CostsForm |
| Action types من `emergency_action_types` (admin-managed) | ✅ يَستخدم `api.admin.emergencyActionTypes.active()` |

#### الفجوات الجوهرية مع الإطار الجديد

| المحور الدستوري الجديد | الحالة في الـ Wizard | شدّة الفجوة |
|---|---|---|
| **لائحة الأعطال المُهيكَلة** (٠.١٩) | ❌ Phase 2 يَستخدم نص حر `actions_taken` + `technician_notes` بدلاً من لائحة بنود | 🔴 جوهرية |
| **status لكل عطل** (resolved/deferred/unresolvable_field) | ❌ القرار `final_decision` على مستوى المهمة كاملة بـ 4 قيم | 🔴 جوهرية |
| **derived_outcome محسوب من الأعطال** (٠.١٩.ح) | ❌ غير موجود. `final_decision` يَدوي من Phase 4 | 🔴 جوهرية |
| **Field Discovery أثناء الزيارة** (٠.١٩.ط) | ❌ غير موجود | 🔴 جوهرية |
| **تمييز `recorded_by` عن `repaired_by`** (٠.١٩.د) | ❌ حقل واحد `closingEmployeeId` فقط | 🟡 متوسطة |
| **ربط القطعة بعطل محدَّد** | ❌ القطع على مستوى المهمة، لا تُربَط بعطل | 🟡 متوسطة |
| **`needs_followup` كقرار يُنشئ مهمة جديدة** | ✅ أُزيل النص المضلل من الواجهة؛ `needs_followup` يعني حاجة متابعة، وليس بحد ذاته قرار cascade. | ✅ |

#### تقدير العمل لجلب الـ wizard للحياد الدستوري

| المهمة | حجم |
|---|---|
| إضافة قسم "لائحة الأعطال" في Phase 2 (بدلاً من actions_taken كنص حر) | متوسط |
| ربط status كل عطل بـ Phase 4 derived_outcome | متوسط |
| إضافة زر "اكتشاف عطل جديد" (Field Discovery) | صغير |
| فصل dropdown `recorded_by` عن `repaired_by` في Phase 2 | صغير |
| ربط القطعة بعطل (إضافة `problem_id` على PartDraftForm) | صغير |
| حذف "needs_followup creates new task" (CostsForm:18) | صغير |
| إعادة هيكلة CostsForm.DECISIONS من اختيار يدوي إلى derived label | متوسط |
| metadata الأعطال (`added_during_phase`, `creator_role_snapshot`) | صغير |

**التقدير الإجمالي:** ~60% reuse من الكود الحالي، 40% rewrite مُركَّز على Phase 2 (لائحة الأعطال) + Phase 4 (derived outcome).

#### السيناريو في scenarios

تَفصيل سيناريو visit_task wizard في [`maintenance-test-scenarios.md`](./maintenance-test-scenarios.md) قسم **I. Visit Task Wizard**.

---

## المراجع
- [القالب الموحَّد](../unified-task-template.md)
- [`features/tasks/device-demo.md`](./device-demo.md) — قالب مرجعي للهيكلة
- [`domains/tasks.md`](../../domains/tasks.md) — دورة الحياة بـ 11 حالة
- [`domains/visits.md`](../../domains/visits.md) — V-R005 cascading، V-R006 نتيجة واحدة لكل visit_task، V-R007 attempts chain
- [`domains/planning.md`](../../domains/planning.md) — PL-R011 capability الفريق (D31)
- [`domains/field-visits.md`](../../domains/field-visits.md) — emergency side tables، 4 phases
- [`decisions/DEC-005-contact-targets-filter.md`](../../decisions/DEC-005-contact-targets-filter.md) — D27 location_basis = device
- [`decisions/DEC-006-pending-resolutions-round1.md`](../../decisions/DEC-006-pending-resolutions-round1.md) — D31 capability emergency، D36 needs_follow_up window، D39 outcomes
- [`decisions/DEC-007-visit-structure-list-and-survey.md`](../../decisions/DEC-007-visit-structure-list-and-survey.md) — انتقال الـ side tables إلى نموذج visit_task_result_id
