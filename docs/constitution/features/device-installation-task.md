# Feature: مهمة تركيب الجهاز (device_installation)

> النوع: `device_installation`
> العائلة: `delivery`
> إلزامية العقد: نعم (`contract_required = TRUE`)
> تاريخ الاستحقاق: لا (`has_due_date = FALSE`) — نستخدم `expected_date` فقط
> `due_date` مخصص للذمم والتحصيل فقط

---

## 1. إنشاء المهمة (Task Creation)

### 1.1 مصادر الإنشاء

| المصدر | متى | من |
|--------|-----|-----|
| **تلقائي من نتيجة التسليم** | لما `device_delivery` تصير `delivered_successfully` | النظام |
| **يدوي من صفحة الزبون** | لما العقد `device_status = 'delivered'` | أي موظف بصلاحية |
| **يدوي من شاشة المهام** | من `PostSaleTasksPage` أو `DeliveryTasks` | مدير الفرع / المشرف |

### 1.2 شروط إظهار زر الإنشاء

- العقد `status = 'active'`
- العقد `device_status = 'delivered'`
- ما في `device_installation` task نشطة (`open`, `needs_follow_up`, `assigned`, `in_scheduling`, `scheduled`) مرتبطة بهاد العقد

### 1.3 حقول الإنشاء (الموظف بيملاهن)

| # | الحقل | إلزامي | مصدره | الوصف |
|---|-------|--------|-------|-------|
| 1 | **العقد** | ✅ | Dropdown — عقود نشطة `delivered` | بيحدد الزبون والجهاز تلقائياً |
| 2 | **الزبون** | ✅ | تلقائي من العقد | غير قابل للتعديل |
| 3 | **الجهاز** | ✅ | تلقائي من العقد (model name) | غير قابل للتعديل |
| 4 | **عنوان التركيب** | ✅ | افتراضي = `installationAddress` من العقد | **قابل للتعديل** |
| 5 | **التاريخ المتوقع** (`expected_date`) | ✅ | الموظف بيحدده مع الزبون | متى الفريق بيجي يركّب؟ |
| 6 | **السبب** (`reason`) | ✅ | Dropdown من `system_lists` (نوع `task_reason`) | الأدمن بيضبط القائمة |
| 7 | **الأولوية** | ❌ | `high` / `medium` / `low` | للتنظيم الداخلي |

### 1.4 ما بنسجل بإنشاء المهمة

| ما نسجله | السبب |
|----------|-------|
| `due_date` | ❌ — مخصص للذمم فقط |
| `notes` | ❌ — ما في ملاحظات وقت الإنشاء |
| فريق التنفيذ | ❌ — بيتعين بمرحلة الجدولة |
| نتائج التركيب | ❌ — الفني بيسجلها بالزيارة |

---

## 2. تبويب تتبع الجهاز (ClientProfile → العقود)

### 2.1 حالة `delivered`

```
┌────────────────────────────────────────┐
│  العقد #1234 — Aqua Pro 7 مراحل        │
│                                        │
│  [تسليم] [تركيب] [تشغيل]              │
│   ✅done     ⏳active   ○hidden         │
│                                        │
│  [إضافة مهمة تركيب] ← زر ظاهر         │
└────────────────────────────────────────┘
```

### 2.2 بعد التركيب الناجح (`installed`)

```
┌────────────────────────────────────────┐
│  العقد #1234 — Aqua Pro 7 مراحل        │
│                                        │
│  [تسليم] [تركيب] [تشغيل]              │
│   ✅done     ✅done     ⏳active        │
│                                        │
│  [إضافة مهمة تشغيل] ← زر ظاهر         │
└────────────────────────────────────────┘
```

---

## 3. نتيجة المهمة (Task Result)

### 3.1 الحقول اللي بيسجلها الفني بالزيارة

| # | الحقل | إلزامي | الوصف |
|---|-------|--------|-------|
| 1 | **النتيجة** (`outcome`) | ✅ | `installation_successful` / `installation_incomplete` / `customer_not_available` / `installation_cancelled` |
| 2 | **سبب عدم الاكتمال** (`installation_incomplete_reason`) | ✅ بس إذا `installation_incomplete` | Dropdown من `system_lists` |
| 3 | **سبب الإلغاء** (`installation_cancel_reason`) | ✅ بس إذا `installation_cancelled` | Dropdown من `system_lists` |
| 4 | **تاريخ المتابعة** (`expected_date`) | ✅ بس إذا `installation_incomplete` | متى بترجعوا تكملوا؟ |
| 5 | **ملاحظات النتيجة** | ❌ | أي تفاصيل إضافية |

### 3.2 تأثير كل نتيجة

| النتيجة | حالة المهمة | حالة الجهاز (`device_status`) | اللي بيصير بعدها |
|---------|------------|-------------------------------|------------------|
| `installation_successful` | `completed` | `installed` | ➕ يتولد تلقائياً `device_activation` task |
| `installation_incomplete` | `completed` | `delivered` (ما بتتغيّر) | ➕ يتولد `device_installation` task جديدة (متابعة) |
| `customer_not_available` | `completed` | `delivered` | ➕ يتولد `device_installation` task جديدة (متابعة) |
| `installation_cancelled` | `cancelled` | `delivered` | ❌ لا متابعة — قرار نهائي |

> **ملاحظة:** "مكتملة" (`completed`) بتعني "تمت عملية التسجيل" — مو شرط النجاح. النتيجة = سجل المحاولة.

---

## 4. DB Schema

### 4.1 الجدول الأساسي (`open_tasks`)

```sql
client_id       → من العقد
branch_id       → من العقد أو المستخدم
contract_id     → من العقد

task_type       = 'device_installation'
task_family     = 'delivery'
reason          → من system_lists (task_reason)
status          = 'open'

expected_date   → من المستخدم (التاريخ المتوقع)
due_date        = NULL  ← لا يُستخدم للتركيب

priority        → من المستخدم
notes           = NULL  ← لا يُسجل وقت الإنشاء

source          = 'auto_delivery_result' أو 'manual'
created_by      = hr_users.id  (أو NULL للتلقائي)
```

### 4.2 جدول نتيجة التركيب (`open_task_installation_results`) ⚠️

> **الحالة: لم يُنشأ بعد — gap معروف**

```sql
-- Migration مطلوبة
CREATE TABLE open_task_installation_results (
  id SERIAL PRIMARY KEY,
  open_task_id INT NOT NULL REFERENCES open_tasks(id) ON DELETE CASCADE,

  outcome VARCHAR(50) NOT NULL,
  -- 'installation_successful', 'installation_incomplete',
  -- 'customer_not_available', 'installation_cancelled'

  installation_incomplete_reason VARCHAR(100) NULL,
  -- FK → system_lists (type = 'installation_incomplete_reason')

  installation_cancel_reason VARCHAR(100) NULL,
  -- FK → system_lists (type = 'installation_cancel_reason')

  expected_date DATE NULL,
  -- للمتابعة بعد "غير مكتمل"

  notes TEXT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by INT REFERENCES hr_users(id)
);
```

**ليه على `open_task` مباشرة؟**
- `device_installation` مش جزء من التلي ماركتينج
- ما لازم تمرّ بـ `marketing_visit_tasks` (MVP قديم)
- النتيجة مباشرة على المهمة — أسرع وأنظف

---

## 5. العلاقة بالتسليم (Chaining)

```
device_delivery (completed → delivered_successfully)
        │
        ▼
device_installation (auto-created)
        │
        ├──► completed → installation_successful
        │              │
        │              ▼
        │       device_activation (auto-created)
        │
        ├──► completed → installation_incomplete
        │              │
        │              ▼
        │       device_installation (follow-up, new)
        │
        └──► cancelled → installation_cancelled
```

**القاعدة:** كل مهمة post-sale بتولد اللي بعدها تلقائياً عند النجاح، أو بتولد نفسها من جديد عند الفشل (متابعة).

---

## 6. المشاكل المعروفة (Known Issues / Gaps)

### `DI-G001` — جدول `open_task_installation_results` غير موجود
**الحالة: gap فني — migration مطلوبة**

زي ما صار مع `device_delivery` (migration 143)، لازم ننشئ جدول مباشر على `open_tasks`.

**الـ Backend الحالي:**
- `openTasks.ts` سطور ~2288–2453: في `GET /:id/delivery-result` و `POST /:id/delivery-result`
- بس ما في نظير لـ `device_installation`

**المطلوب:**
- Migration: `145_device_installation_results.sql`
- Endpoint: `GET /open-tasks/:id/installation-result`
- Endpoint: `POST /open-tasks/:id/installation-result`
- Frontend: `InstallationResultForm.tsx` + `InstallationResultRenderer.tsx`

### `DI-G002` — الخروج من `marketing_visit_tasks` legacy
**الحالة: gap معماري — مشترك مع `DD-G002`**

`device_installation` ما لها علاقة بالتلي ماركتينج. بس النظام بيحاول يحشرها بنفس الزنجيلة.

**الحل:** نفس الـ pattern تبع `device_delivery` — نتيجة مباشرة على `open_task`.

---

## 7. ملاحظات تنفيذية

- `allow_multiple` لـ `device_installation` = `TRUE` — لأنه ممكن يكون في عدة محاولات تركيب.
- كل follow-up بتكون `device_installation` جديدة — نفس النوع، مهمة جديدة.
- السبب (`reason`) من `system_lists` (نوع `task_reason`) — ديناميكي.
- صلاحية الإنشاء: `tasks.installation.create` (migration 144 موجودة).
- صلاحية النتيجة: `tasks.installation.result` (migration 144 موجودة).

---

**تاريخ الإنشاء:** 2026-05-21
**الحالة:** دستوري معتمد + gaps معروفة
