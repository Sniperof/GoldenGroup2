# Golden CRM — Context Handoff Document

> هذا الملف يُلخّص بنية النظام والقرارات التصميمية والمتطلبات القادمة.
> الهدف: نقل السياق الكامل لجلسة Claude جديدة.

---

## 1. نبذة عن المشروع

**Golden CRM** — نظام إدارة زبائن ومرشحين (CRM) لشركة خدمات.
- **Backend:** Node.js + Express + PostgreSQL
- **Frontend:** React + TypeScript
- **Auth:** JWT + RBAC مخصص (Roles / Permissions / Scopes)
- **Monorepo:** `packages/api` و `packages/web`
- **Migrations:** ملفات SQL مرقّمة في `/migrations/`

---

## 2. بنية الصلاحيات (RBAC)

### الجداول الأساسية

| الجدول | الوظيفة |
|--------|---------|
| `roles` | الأدوار (`ADMIN`, `BRANCH_MANAGER`, `SALES`, `TELEMARKETER`, `HR_MANAGER`…) |
| `permissions` | الصلاحيات (`clients.view`, `clients.edit`, `clients.can_be_assigned`…) |
| `role_permission_grants` | **الجدول الأساسي** — يربط الدور بالصلاحية مع `scope_type` |
| `role_permissions` | جدول legacy (مرآة) — بدون scope |
| `client_assignments` | إسناد الزبائن للمستخدمين (M2M) |
| `candidate_assignments` | إسناد المرشحين للمستخدمين (M2M) |

### نطاقات الصلاحية (Scope Types)

```
GLOBAL   → يرى كل شيء في النظام
BRANCH   → يرى زبائن فرعه فقط
ASSIGNED → يرى فقط الزبائن المسندين له شخصياً
```

### ملفات الصلاحيات الرئيسية

- `packages/api/services/authorizationService.ts` — بناء AuthContext + تقييم الصلاحيات
- `packages/api/policies/clientPolicy.ts` — قواعد الوصول للزبائن
- `packages/web/src/pages/admin/RolePermissions.tsx` — واجهة إدارة الصلاحيات

### مشاكل معمارية مكتشفة

1. **ازدواجية الجداول:** `role_permission_grants` (مع scope) و `role_permissions` (بدون scope) — يجب التوحيد
2. **scope على الدور وليس الزبون:** لا يمكن تحديد نطاق مختلف لكل زبون بصورة منفردة
3. **لا توجد صلاحيات على مستوى الحقل (Field-Level)**
4. **لا يوجد مفهوم "إسناد مؤقت"** في `client_assignments`

---

## 3. دورة حياة الزبون (Lifecycle)

```
Lead → FOP → OP
```

| المرحلة | المعنى | من يرى الزبون |
|---------|--------|--------------|
| Lead | زبون محتمل جديد | المشرفة المسندة (ASSIGNED) |
| FOP | في طور المعالجة | المشرفة المسندة (ASSIGNED) |
| OP | زبون نشط دائم | الفرع كله (BRANCH) — الإسناد يُزال |

---

## 4. جدول client_assignments (الحالي)

```sql
CREATE TABLE client_assignments (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id)  ON DELETE CASCADE,
  hr_user_id  INTEGER NOT NULL REFERENCES hr_users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by INTEGER REFERENCES hr_users(id) ON DELETE SET NULL,
  UNIQUE (client_id, hr_user_id)
);
```

**ما ينقصه:**
- `assignment_type` — دائم أم مؤقت (خط سير)
- `visibility_cutoff_at` — تاريخ انتهاء الإسناد (للأرشفة)
- `expires_after_visit_id` — ارتباط بالزيارة للإسناد المؤقت

---

## 5. المتطلبات الجديدة المطلوب تنفيذها

### 5.1 — تغيير النطاق تلقائياً عند التحوّل إلى OP

**القرار:** عند تحوّل الزبون إلى `OP`:
- تُحذف كل صفوف `client_assignments` الخاصة به
- يُسجَّل `visibility_cutoff_at = NOW()` قبل الحذف (للأرشيف)
- يصبح الزبون مرئياً للفرع كله تلقائياً (عبر BRANCH scope)

**المكان المقترح للتنفيذ:**
- في الـ endpoint الذي يغيّر `lifecycle_stage` إلى `op`
- أو trigger على مستوى قاعدة البيانات

---

### 5.2 — ما ترى المشرفة السابقة بعد التحوّل إلى OP

#### 🟢 تُعرض بدون موافقة ("ما بنته هي")

- اسم الزبون + أرقام التواصل الأساسية
- كل التفاعلات التي سجّلتها هي (زيارات، مكالمات، ملاحظات)
- المرحلة الحالية للزبون (وصل إلى OP)
- تاريخ الإسناد وتاريخ انتهائه
- الحقول التي هي من ملأتها أثناء فترة إسنادها

#### 🟡 تُعرض بموافقة من مدير الفرع

- المشرفة الحالية المسندة للزبون
- بيانات جديدة أضيفت بعد التحوّل (عقود، مدفوعات، وثائق OP)
- ملاحظات سجّلها آخرون بعد التحوّل

#### 🔴 لا تُعرض نهائياً

- قائمة الزبائن الآخرين في الفرع
- جدول خطط الزيارات الجديدة
- بيانات OP حساسة لم تكن موجودة في فترتها

#### آلية التنفيذ

```sql
-- إضافة عمود التاريخ الفاصل في client_assignments
ALTER TABLE client_assignments 
  ADD COLUMN visibility_cutoff_at TIMESTAMPTZ DEFAULT NULL;

-- جدول طلبات الوصول الإضافي
CREATE TABLE client_access_requests (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id),
  requester_id   INTEGER NOT NULL REFERENCES hr_users(id),
  requested_at   TIMESTAMPTZ DEFAULT NOW(),
  approved_by    INTEGER REFERENCES hr_users(id),
  approved_at    TIMESTAMPTZ,
  status         VARCHAR(20) DEFAULT 'PENDING' 
                   CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reason         TEXT
);
```

---

### 5.3 — الإسناد المؤقت عبر خط السير (Route Planning)

**المنطق:**
```
جدولة زيارة → إسناد مؤقت (ROUTE_VISIT) للمشرفة
تسجيل نتيجة الزيارة → حذف الصف تلقائياً
```

**التعديل المطلوب على client_assignments:**

```sql
ALTER TABLE client_assignments 
  ADD COLUMN assignment_type VARCHAR(20) DEFAULT 'PERMANENT'
    CHECK (assignment_type IN ('PERMANENT', 'ROUTE_VISIT'));

ALTER TABLE client_assignments 
  ADD COLUMN expires_after_visit_id INTEGER 
    REFERENCES planning_visits(id) ON DELETE SET NULL;
```

**قواعد عدم التداخل (مضمونة بـ DB constraints):**
- مشرفة A (دائمة) ومشرفة B (مؤقتة عبر خط سير) — لا تتشاركان نفس الصف
- مشرفة B ترى فقط بيانات الزيارة المحددة — لا تاريخ الزبون الكامل
- عند تسجيل نتيجة الزيارة: `DELETE FROM client_assignments WHERE assignment_type = 'ROUTE_VISIT' AND expires_after_visit_id = :visitId`
- لا يمكن لنفس المشرفة أن يكون لها PERMANENT + ROUTE_VISIT للزبون ذاته في آنٍ واحد

---

### 5.4 — حقل الوسيط (Referrer) خارج نطاق الإسناد

**المشكلة:**
المشرفة (ASSIGNED scope) لا ترى الزبائن OP → لا تستطيع اختيار وسيط من بينهم.

**الحل:**
Endpoint مخصص لا يخضع لفلتر الإسناد:

```
GET /clients/referrer-candidates?search=...
```

- يعيد زبائن OP فقط (اسم + هاتف) — بيانات بحث خفيفة فقط
- متاح لكل من لديه `clients.view` بأي scope
- لا يعيد البيانات الحساسة

---

## 6. Migrations المطبّقة حتى الآن

| رقم | الوصف | الحالة |
|-----|-------|--------|
| 001–034 | الأساس | ✅ مطبّق |
| 035–041 | تحسينات متعددة | ✅ مطبّق |
| 042 | `client_assignments` + `candidate_assignments` M2M | ✅ مطبّق |
| 043 | صلاحية `clients.can_be_assigned` | ✅ مطبّق |

---

## 7. ملفات رئيسية للإشارة

```
packages/
├── api/
│   ├── routes/clients.ts                    ← CRUD + قوائم الزبائن
│   ├── services/authorizationService.ts     ← بناء AuthContext
│   ├── policies/clientPolicy.ts             ← قواعد الوصول
│   └── ...
├── web/
│   ├── src/pages/Clients.tsx                ← قائمة الزبائن + الأعمدة
│   ├── src/pages/admin/RolePermissions.tsx  ← إدارة الصلاحيات
│   └── src/components/candidates/
│       └── QualificationModal.tsx           ← مودال التأهيل + smartMatch
migrations/
├── 042_assignments_m2m.sql
└── 043_clients_can_be_assigned_permission.sql
```

---

## 8. القرارات المعلّقة (تحتاج موافقة Product Owner)

| # | السؤال | الخيارات |
|---|--------|---------|
| 1 | هل ننشئ `client_access_requests` الآن أم نبدأ بـ "لقطة مجمّدة فقط"؟ | الآن / لاحقاً |
| 2 | مودول خط السير (Route Planning) — هل هو موجود أم سيُبنى؟ | موجود / جديد |
| 3 | الـ Field-Level Permissions — تُطبَّق الآن أم نبدأ بقائمة حقول حساسة ثابتة؟ | ثابتة الآن / ديناميكية لاحقاً |
