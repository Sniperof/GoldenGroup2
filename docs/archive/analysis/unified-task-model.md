# النموذج الموحد للمهام — الخريطة التقنية الشاملة

> **الحالة:** مسودة اعتماد — تستند إلى الكود الفعلي + التحليل المعتمد
> **المدخل:** `device-demo-lifecycle.md` + `task-lifecycle-analysis.md`
> **الغرض:** تقييم نموذج `device_demo` الحالي وتعميم بنيته على كل أنواع المهام العشرة
> **تاريخ الإنشاء:** 2026-05-16

---

## 1) المبدأ المركزي

```
الطبقة المشتركة (open_tasks)        ← تُعرِّف هوية المهمة ودورة حياتها
طبقة الإعداد (task_type_config)     ← تُحدِّد سلوك كل نوع
طبقة النتائج (per-type tables)      ← تُخزِّن تفاصيل النتيجة الخاصة بكل نوع
```

لا يوجد "نوع مهمة = جدول مهمة مستقل". كل المهام تعيش في `open_tasks` وتتفرع عند النتيجة فقط.

---

## 2) الطبقة المشتركة — جدول `open_tasks` (الحالة والمطلوب)

### 2.1 الحقول الموجودة — تبقى كما هي

| الحقل | النوع | الغرض |
|-------|-------|--------|
| `id` | SERIAL PK | المفتاح الأساسي |
| `client_id` | INTEGER FK | الزبون المرتبط بالمهمة |
| `branch_id` | INTEGER FK | الفرع المالك للمهمة |
| `task_type` | VARCHAR(50) | نوع المهمة (device_demo, ...) |
| `task_family` | VARCHAR(50) | عائلة المهمة (marketing, service, ...) |
| `reason` | VARCHAR(100) | سبب الإنشاء (new_lead, follow_up, ...) |
| `due_date` | DATE (nullable) | تاريخ الاستحقاق — null للمهام المفتوحة |
| `priority` | VARCHAR(20) | أولوية المهمة (high/medium/low) |
| `source` | VARCHAR(50) | مصدر الإنشاء (system/manual/referral) |
| `contact_target_id` | INTEGER FK | ربط بجهة الاتصال عند التخطيط |
| `notes` | TEXT | ملاحظات حرة |
| `origin` | VARCHAR(50) | كيف نشأت المهمة (manual_entry/rescheduled/...) |
| `origin_ref_id` | INTEGER | رابط للمهمة الأم عند إعادة الجدولة |
| `assigned_scope_id` | INTEGER | نطاق العمل المسند |
| `assigned_team_key` | VARCHAR(50) | الفريق المسند |
| `client_snapshot` | JSONB | لقطة بيانات الزبون وقت الإنشاء |
| `contract_snapshot` | JSONB | لقطة بيانات العقد إن وجد |
| `team_snapshot` | JSONB | لقطة بيانات الفريق عند الإسناد |
| `created_by` | INTEGER FK | من أنشأ المهمة |
| `created_at` | TIMESTAMPTZ | وقت الإنشاء |
| `updated_at` | TIMESTAMPTZ | آخر تعديل |

### 2.2 حقل `status` — الحالة الحالية مقابل المطلوبة

**الحالة الحالية في الكود (7 قيم):**
```sql
CHECK (status IN (
  'open',              -- مفتوحة
  'in_contact_list',   -- قيد الاتصال ← مدمج مع assigned + in_scheduling
  'scheduled',         -- مجدولة
  'in_visit',          -- ضمن الزيارة ← غير مستخدم فعلياً
  'completed',         -- مكتملة
  'cancelled',         -- ملغاة
  'needs_reschedule'   -- تحتاج إعادة ← سيُستبدل بـ needs_follow_up
))
```

**المطلوب (11 قيمة — من task-lifecycle-analysis.md):**
```sql
CHECK (status IN (
  -- مرحلة 1: قيد الانتظار
  'open',              -- مفتوحة (جديدة، لا سياق سابق)
  'needs_follow_up',   -- بحاجة متابعة (عادت من دورة سابقة)

  -- مرحلة 2: التخطيط
  'assigned',          -- مسندة لفريق / نطاق عمل
  'in_scheduling',     -- قيد الجدولة (جهة اتصال نشطة)
  'scheduled',         -- مجدولة (موعد محجوز)

  -- مرحلة 3: التنفيذ
  'waiting_execution', -- بانتظار التنفيذ (يوم الزيارة حلّ)
  'in_execution',      -- قيد التنفيذ (الفريق عند الزبون)
  'ended',             -- انتهت الزيارة (قبل تسجيل النتيجة)

  -- مرحلة 4: الإغلاق
  'completed',         -- اكتملت (نتيجة مسجّلة)
  'closed',            -- مُغلقة (معتمدة من المراجع — نهائي)

  -- حالة خروج في أي مرحلة
  'cancelled'          -- ملغاة
))
```

**خريطة الترحيل:**
```
'in_contact_list'   → 'in_scheduling'   (الحالة الأقرب تشغيلياً)
'needs_reschedule'  → 'needs_follow_up' (الاسم الصحيح)
'in_visit'          → 'in_execution'    (الاسم الصحيح)
```

### 2.3 حقول جديدة تُضاف إلى `open_tasks`

| الحقل الجديد | النوع | الغرض |
|-------------|-------|--------|
| `last_waiting_status` | VARCHAR(20) | آخر حالة في قيد الانتظار قبل التخطيط — يُستخدم عند الرجوع |
| `cancellation_reason` | TEXT | سبب الإلغاء — يُحفظ عند التحول لـ cancelled |

**لماذا `last_waiting_status`؟**
عند رجوع المهمة من التخطيط أو التنفيذ، يجب أن تعود لحالتها الأصلية (`open` أو `needs_follow_up`) لا دائماً لـ `open`. هذا الحقل يحفظ تلك الحالة.

---

## 3) طبقة الإعداد — جدول `task_type_config` (جديد)

### 3.1 التعريف

```sql
CREATE TABLE task_type_config (
  task_type                VARCHAR(50)  PRIMARY KEY,
  label_ar                 VARCHAR(100) NOT NULL,       -- الاسم العربي
  task_family              VARCHAR(50)  NOT NULL,       -- العائلة الافتراضية
  has_due_date             BOOLEAN      NOT NULL DEFAULT FALSE,  -- هل لها استحقاق؟
  allow_multiple           BOOLEAN      NOT NULL DEFAULT FALSE,  -- هل يُسمح بأكثر من مهمة لنفس الزبون؟
  planning_window_days     INTEGER,                     -- N: أيام ما قبل الاستحقاق (null = تظهر دائماً)
  requires_device          BOOLEAN      NOT NULL DEFAULT FALSE,  -- هل تحتاج جهاز مرتبط؟
  requires_contract        BOOLEAN      NOT NULL DEFAULT FALSE,  -- هل تحتاج عقد مرتبط؟
  result_table             VARCHAR(100),                -- جدول النتائج الخاص بهذا النوع
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order               INTEGER      NOT NULL DEFAULT 0
);
```

### 3.2 القيم المعروفة حالياً

| task_type | label_ar | task_family | has_due_date | allow_multiple | planning_window | requires_device | requires_contract |
|-----------|----------|-------------|:------------:|:--------------:|:---------------:|:---------------:|:-----------------:|
| `device_demo` | عرض جهاز | marketing | ✗ | ✗ | null | ✓ | ✗ |
| `emergency_maintenance` | صيانة طارئة | emergency | ✗ | ✓ | null | ✗ | ✗ |
| `contract_installment` | ذمة عقد | service | ✓ | ✓ | يُحدد لاحقاً | ✗ | ✓ |
| *(باقي الأنواع)* | — | — | — | — | — | — | — |

> **Gap-T01:** القيم الافتراضية لـ `planning_window_days` لكل نوع غير محددة بعد — تحتاج قرار منتج.

---

## 4) طبقة النتائج — الجداول المخصصة لكل نوع

### 4.1 المبدأ

```
visit_tasks (صف واحد لكل مهمة في زيارة)
    ↓
visit_task_results (نتيجة عامة واحدة: final_decision + reason_code)
    ↓
[جدول نتيجة متخصص] (تفاصيل خاصة بنوع المهمة)
```

### 4.2 الجداول الموجودة

#### لـ `device_demo`:
```
visit_task_device_demo_results
  ├── offer_type (cash | installment)
  ├── offer_amount
  ├── installment_months
  ├── is_device_sold
  ├── sale_reference_number
  ├── contract_id (FK)
  └── closed_by_employee_id

marketing_visit_task_offers (عروض متعددة لنفس المهمة)
  ├── device_model_id
  ├── offer_type
  ├── total_amount
  ├── customer_response (accepted | rejected | extension_requested)
  └── sale_reference_number

open_task_pre_offers (عروض مُعدّة قبل الزيارة)
  └── نفس حقول marketing_visit_task_offers

open_task_devices (أجهزة مرتبطة بالمهمة)
  ├── device_model_id
  ├── device_name_snapshot
  └── quantity
```

#### لـ `emergency_maintenance`:
```
visit_task_emergency_technical_states (التشخيص التقني)
  ├── problem_confirmed
  ├── water_tds_before / water_tds_after
  ├── pump_pressure, membrane_output
  ├── tank_pressure, low/high_pressure_switch
  ├── solenoid_valve, uv_status
  └── technical_notes

visit_task_emergency_parts_used (القطع المستخدمة — متعددة)
  ├── spare_part_id
  ├── part_name_snapshot
  ├── quantity
  └── unit_price

visit_task_emergency_financials (الحساب المالي)
  ├── labor_cost, parts_cost, total_cost
  ├── payment_method
  ├── collected_amount
  └── invoice_notes
```

### 4.3 جداول النتائج المطلوبة للأنواع الجديدة — من PDF

| task_type | result_table المقترح | الحقول الأساسية (من PDF) |
|-----------|---------------------|------------------------|
| `device_purchase` | `visit_task_purchase_results` | contract_id, device_model_id, total_price, currency, first_payment, installments_count |
| `device_delivery` | `visit_task_delivery_results` | device_model_id, serial_snapshot, accessories_delivered[], receipt_number |
| `device_installation` | `visit_task_installation_results` | accessories_used[], accessories_returned[], accessories_given_to_client[], installation_notes |
| `device_activation` | `visit_task_activation_results` | activation_date, tds_before, tds_after, pump_pressure, technical_notes, next_maintenance_date |
| `periodic_maintenance` | `visit_task_periodic_results` | parts_required[], parts_approved[], parts_replaced[], parts_cost, total_cost, collected_amount, discount_amount, discount_reason, discount_by, closed_with |
| `installment_collection` | `visit_task_installment_results` | installment_no, amount_due, amount_collected, payment_method, receipt_number, next_due_date (عند دفع جزئي), delay_days |
| `maintenance_collection` | `visit_task_maint_collection_results` | amount_due, amount_collected, payment_method, receipt_number, delay_days |
| `gift_delivery` | `visit_task_gift_results` | gift_type, gift_description, decision_by, reason, delivered (boolean) |
| `device_checkup` | `visit_task_checkup_results` | technical_state_snapshot, referral_names[] |
| `parts_sale` | `visit_task_parts_sale_results` | parts_sold[], total_amount, collected_amount, closed_with |
| `device_retrieval` | `visit_task_retrieval_results` | device_id, items_retrieved[] (جهاز/خزان/حنفية), closed_with |
| `device_repair` | `visit_task_repair_results` | diagnosis_notes, parts_required[], parts_approved[], parts_replaced[], total_cost, customer_decision (approved/rejected), rejection_reason |
| `device_return` | `visit_task_return_results` | device_id, technical_state_after, installation_notes, activation_date |
| `golden_warranty` | `visit_task_warranty_results` | warranty_duration_months, warranty_price, parts_replaced[], decision_by |
| `warranty_cancellation` | `visit_task_warranty_cancel_results` | reason, decision_by, effective_date |
| `warranty_reactivation` | `visit_task_warranty_reactiv_results` | parts_replaced[], total_cost, collected_amount, technical_state_before, technical_state_after |
| `device_disconnection` | `visit_task_disconnection_results` | reason (سفر/إكساء/نقل), disconnection_date, storage_location |
| `device_transfer` | `visit_task_transfer_results` | from_address, to_address, to_branch_id, transfer_type (same_branch/cross_branch), installation_included |

**جداول موجودة بالفعل (لا تحتاج إنشاء):**
- `device_demo` → `visit_task_device_demo_results` + `marketing_visit_task_offers` + `open_task_devices`
- `emergency_maintenance` → `visit_task_emergency_technical_states` + `visit_task_emergency_parts_used` + `visit_task_emergency_financials`

---

## 5) الجدار الفاصل — النظام القديم (Legacy) مقابل النظام الجديد

### 5.1 جدول `marketing_visits` + `marketing_visit_tasks` (Legacy)

هذه الجداول **لا تزال هي المستخدمة فعلياً** في التطبيق الحالي. جداول `field_visits` + `visit_tasks` + `visit_task_results` أُنشئت في migration 070 كطبقة نظيفة لكنها **غير مُفعَّلة بعد**.

```
الحالة الراهنة:
  open_tasks ←→ marketing_visit_tasks ←→ marketing_visits
                      ↑
              هذا هو المسار الفعلي

الهدف المستقبلي (Strangler Fig):
  open_tasks ←→ visit_tasks ←→ field_visits
                      ↑
              هذا هو المسار النظيف
```

**الإجراء المقترح:** لا نغير المسار القديم الآن. نبني عليه بإضافة أنواع المهام الجديدة في نفس البنية، ونُؤجّل نقل legacy إلى المسار الجديد لمرحلة مستقلة.

---

## 6) خريطة المهام العشرين — من مصدر رسمي (PDF مهام الزيارات)

> **المصدر:** وثيقة "مهام الزيارات" المرسلة من الزبون — 9 صفحات، 20 مهمة موثقة.

### 6.1 الجدول الكامل

| # | task_type | label_ar | العائلة | استحقاق | متعدد | يحتاج جهاز | يحتاج عقد |
|---|-----------|----------|---------|:-------:|:-----:|:-----------:|:---------:|
| 1 | `device_demo` | عرض جهاز | marketing | ✗ | ✗ | ✓ | ✗ |
| 2 | `device_purchase` | شراء جهاز (توقيع عقد) | sales | ✗ | ✗ | ✓ | ✓ |
| 3 | `device_delivery` | تسليم الجهاز | delivery | ✓ | ✗ | ✓ | ✓ |
| 4 | `device_installation` | تركيب الجهاز | delivery | ✓ | ✗ | ✓ | ✓ |
| 5 | `device_activation` | تشغيل الجهاز | delivery | ✓ | ✗ | ✓ | ✓ |
| 6 | `periodic_maintenance` | الصيانة الدورية | maintenance | ✓ | ✓ | ✓ | ✓ |
| 7 | `emergency_maintenance` | الصيانة الطارئة | emergency | ✗ | ✓ | ✓ | ✗ |
| 8 | `installment_collection` | تحصيل قسط جهاز | collection | ✓ | ✓ | ✓ | ✓ |
| 9 | `maintenance_collection` | تحصيل ذمة صيانة | collection | ✓ | ✓ | ✓ | ✓ |
| 10 | `gift_delivery` | تسليم هدية | delivery | ✗ | ✓ | ✗ | ✗ |
| 11 | `device_checkup` | تشييك على الجهاز | marketing | ✗ | ✗ | ✓ | ✓ |
| 12 | `parts_sale` | شراء قطعة دون تبديل | service | ✗ | ✓ | ✓ | ✗ |
| 13 | `device_retrieval` | سحب الجهاز للشركة | service | ✗ | ✓ | ✓ | ✗ |
| 14 | `device_repair` | فحص وإصلاح الجهاز بالشركة | service | ✗ | ✓ | ✓ | ✗ |
| 15 | `device_return` | إعادة الجهاز بعد الصيانة | service | ✗ | ✓ | ✓ | ✗ |
| 16 | `golden_warranty` | منح كفالة ذهبية | warranty | ✗ | ✗ | ✓ | ✓ |
| 17 | `warranty_cancellation` | إلغاء الكفالة الأساسية | warranty | ✗ | ✗ | ✓ | ✓ |
| 18 | `warranty_reactivation` | إعادة تفعيل الكفالة الأساسية | warranty | ✗ | ✗ | ✓ | ✓ |
| 19 | `device_disconnection` | توقيف الجهاز مؤقتاً (فك) | service | ✗ | ✗ | ✓ | ✗ |
| 20 | `device_transfer` | نقل الجهاز لعنوان جديد | service | ✗ | ✗ | ✓ | ✗ |

### 6.2 العائلات (task_family) — التوزيع

| العائلة | المهام |
|---------|--------|
| `marketing` | device_demo, device_checkup |
| `sales` | device_purchase |
| `delivery` | device_delivery, device_installation, device_activation, gift_delivery |
| `maintenance` | periodic_maintenance |
| `emergency` | emergency_maintenance |
| `collection` | installment_collection, maintenance_collection |
| `service` | parts_sale, device_retrieval, device_repair, device_return, device_disconnection, device_transfer |
| `warranty` | golden_warranty, warranty_cancellation, warranty_reactivation |

### 6.3 سلاسل المهام — الترابط التشغيلي

المهام ليست مستقلة دائماً — بعضها يُنشئ بعضاً تلقائياً:

```
device_demo (عرض ناجح)
    ↓ موافقة الزبون على الشراء
device_purchase (توقيع عقد)
    ↓ تلقائياً عند الحجز
device_delivery   ← تُجدَّل (scheduled)
device_installation  ← تُجدَّل (scheduled)
device_activation    ← تُجدَّل (scheduled)
    ↓ عند تشغيل الجهاز → يبدأ عداد الصيانة الدورية
periodic_maintenance (الأولى)  ← تُنشأ بـ due_date = تاريخ التشغيل + N شهر
periodic_maintenance (الثانية) ← تُنشأ بعد إغلاق الأولى
    ...

device_purchase + أقساط
    ↓ لكل قسط محدد في العقد
installment_collection (1) ← due_date = تاريخ القسط
installment_collection (2) ← due_date = تاريخ القسط
    ...

emergency_maintenance (إذا سُحب الجهاز)
    ↓
device_retrieval
    ↓
device_repair
    ↓
device_return
```

**قاعدة origin_ref_id:** كل مهمة تُنشأ من نتيجة مهمة أخرى تحمل `origin_ref_id` يشير للمهمة الأم.

### 6.4 المهام ذات السلوك الخاص

| المهمة | الخاصية |
|--------|---------|
| `device_activation` | تُطلق عداد الصيانة الدورية — يُنشئ أول `periodic_maintenance` |
| `periodic_maintenance` | عند إغلاقها تُنشئ الدورية التالية تلقائياً |
| `installment_collection` | قد يدفع الزبون أكثر أو أقل من القسط — تحتاج منطق تسوية |
| `device_checkup` | تُولّد "لائحة الأسماء المقترحة" — تحتاج كيان منفصل |
| `parts_sale` | النظام يحفظ القطع المشتراة كـ "مخزون الزبون" — تحتاج تتبع |
| `warranty_cancellation` | تُغيّر وضع الكفالة على العقد/الجهاز — تُحدّث كيانات خارجية |

---

## 7) نموذج التوسعة — كيف نُضيف نوع مهمة جديد

### 7.1 الخطوات اللازمة

```
الخطوة 1: تعريف النوع في task_type_config
  → إضافة صف بكل الإعدادات

الخطوة 2: migration لتوسيع القيد
  ALTER TABLE open_tasks DROP CONSTRAINT open_tasks_task_type_check;
  ALTER TABLE open_tasks ADD CONSTRAINT open_tasks_task_type_check
    CHECK (task_type IN (
      'device_demo', 'device_purchase', 'device_delivery',
      'device_installation', 'device_activation',
      'periodic_maintenance', 'emergency_maintenance',
      'installment_collection', 'maintenance_collection',
      'gift_delivery', 'device_checkup', 'parts_sale',
      'device_retrieval', 'device_repair', 'device_return',
      'golden_warranty', 'warranty_cancellation', 'warranty_reactivation',
      'device_disconnection', 'device_transfer'
    ));

الخطوة 3: إنشاء جدول النتائج المخصص (إن احتاج النوع بيانات إضافية)
  CREATE TABLE visit_task_{type}_results (...);

الخطوة 4: تحديث OpenTaskType في shared/types.ts
  export type OpenTaskType =
    | 'device_demo' | 'device_purchase' | 'device_delivery'
    | 'device_installation' | 'device_activation'
    | 'periodic_maintenance' | 'emergency_maintenance'
    | 'installment_collection' | 'maintenance_collection'
    | 'gift_delivery' | 'device_checkup' | 'parts_sale'
    | 'device_retrieval' | 'device_repair' | 'device_return'
    | 'golden_warranty' | 'warranty_cancellation' | 'warranty_reactivation'
    | 'device_disconnection' | 'device_transfer';

الخطوة 5: تحديث OPEN_TASK_TYPE_LABELS في shared/types.ts
  'contract_installment': 'ذمة عقد / قسط'

الخطوة 6: توثيق دستور الفيتشر للنوع الجديد (باستخدام unified-task-scenario-template.md)
```

### 7.2 ما لا يتغير عند إضافة نوع جديد

- جدول `open_tasks` لا يتغير هيكله الأساسي (فقط CHECK constraint)
- دورة الحياة (status machine) هي نفسها لكل الأنواع
- طبقة التخطيط (contact_targets) لا تتغير
- طبقة الزيارة (marketing_visits) لا تتغير
- أي شيء في جداول النتائج يبقى معزولاً ولا يؤثر على البقية

---

## 8) خريطة التغييرات التقنية المطلوبة

### 8.1 الأولوية العالية (تُغير السلوك الحالي)

| التغيير | الملف / الجدول | الأثر |
|---------|---------------|-------|
| تحديث status CHECK constraint | open_tasks (migration) | قيم status الجديدة |
| إضافة `last_waiting_status` | open_tasks (migration) | منطق الرجوع |
| إضافة `cancellation_reason` | open_tasks (migration) | تتبع سبب الإلغاء |
| إنشاء `task_type_config` | migration جديد | إعدادات لكل نوع |
| تحديث `OpenTaskStatus` | shared/types.ts | قيم TypeScript |
| تحديث `OpenTaskType` | shared/types.ts | الأنواع الجديدة |

### 8.2 الأولوية المتوسطة (لا تؤثر على السلوك الحالي)

| التغيير | الملف / الجدول | الأثر |
|---------|---------------|-------|
| إضافة أنواع مهام جديدة | open_tasks_task_type_check + task_type_config | تفعيل أنواع جديدة |
| إنشاء visit_task_{type}_results | migrations جديدة | تخزين نتائج الأنواع الجديدة |

### 8.3 الأولوية المنخفضة (تحسين — لا يتأثر التطبيق الحالي)

| التغيير | الملف / الجدول | الأثر |
|---------|---------------|-------|
| نقل legacy → field_visits/visit_tasks | migration + API refactor | Strangler Fig |
| API موحدة لكل أنواع المهام | routes/openTasks.ts | بدلاً من routes متشعبة |

---

## 9) أسئلة مفتوحة تحتاج قرار منتج

> **ملاحظة:** P01 أُغلق بعد قراءة PDF مهام الزيارات (20 مهمة رسمية).

| # | الحالة | السؤال | الأثر التقني |
|---|--------|--------|-------------|
| P01 | ✅ مغلق | القائمة الكاملة لأنواع المهام | 20 نوع موثق من PDF |
| P02 | ❓ مفتوح | قيمة N (planning_window_days) لكل نوع مهمة | متى تظهر المهمة في التخطيط |
| P03 | ❓ مفتوح | حقول نتيجة `installment_collection` عند دفع جزئي | منطق التسوية: هل تبقى المهمة مفتوحة؟ تُقسَّم؟ |
| P04 | ❓ مفتوح | كيف يُحسب عداد الصيانة الدورية — N شهر من تاريخ تشغيل أي جهاز؟ | يحدد كيف تُنشأ `periodic_maintenance` تلقائياً |
| P05 | ❓ مفتوح | هل `device_checkup` تحتاج كيان "لائحة أسماء مقترحة" منفصل؟ | إذا نعم: جدول جديد `referral_leads` |
| P06 | ❓ مفتوح | هل `parts_sale` يحتاج تتبع "مخزون الزبون" (قطع مشتراة غير مُستخدمة)؟ | إذا نعم: جدول `client_parts_inventory` |
| P07 | ❓ مفتوح | ما شروط الزيارة الإضافية لكل نوع (GPS، لائحة أسماء...)؟ | يحدد منطق "مكتملة" في المرحلة الرابعة |
| P08 | ❓ مفتوح | عند نقل الجهاز بين فرعين (`device_transfer`) — من يملك المهمة: الفرع القديم أم الجديد؟ | يحدد branch_id والتسليم بين الفروع |

---

## 10) ملخص القرارات المعتمدة

| القرار | المصدر | الحالة |
|--------|--------|--------|
| open_tasks هو الجدول الوحيد للمهام — لا جداول منفصلة لكل نوع | هذا التحليل | معتمد |
| جداول النتائج منفصلة لكل نوع (لا حقول اختيارية في open_tasks) | task-lifecycle-analysis.md | معتمد |
| task_type_config جدول مركزي لإعدادات الأنواع | هذا التحليل | معتمد |
| last_waiting_status حقل في open_tasks (لا يُشتق) | task-lifecycle-analysis.md | معتمد |
| N لكل نوع مهمة مستقل (لا global) | task-lifecycle-analysis.md + قرار المستخدم | معتمد |
| مهمة اليوم هي Legacy layer — لا نكسر marketing_visit_tasks | هذا التحليل | معتمد |
| Strangler Fig: field_visits + visit_tasks جاهزة لكن غير مُفعَّلة | migration 070 | معلّق |
