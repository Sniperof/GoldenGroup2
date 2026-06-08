الصورة واضحة. أحتاج أرى الكود الفعلي للـ create handler بدقة:

أحتاج أقرأ `assertAssignedHrUserExists` وقسم أكثر من الـ create handler:

---

## التشخيص الكامل

**السبب الجذري:**

```typescript
// getPermissionScope line 193-195: super-admin دائماً GLOBAL
// لكن المشرفة غير super-admin — scope تأتي من grants

assignedHrUserId: createScope === 'GLOBAL' ? null : authContext.userId,
//                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// إذا منح المدير المشرفة grants بـ GLOBAL scope لـ clients.create
// (وهو ما يحدث عندما تُنشأ الأدوار من SYSTEM_ADMIN template)
// → assigned_hr_user_id = NULL → ASSIGNED list لا تراه
```

**السيناريو بالكامل:**

| | clients.create scope | نتيجة CREATE | clients.view_list scope | نتيجة LIST |
|--|--|--|--|--|
| مدير الفرع | BRANCH | `assigned = branchId user` | BRANCH | يرى كل الفرع ✓ |
| المشرفة | **GLOBAL** (من template) | `assigned = NULL` ← bug | ASSIGNED | لا يطابق NULL ✗ |

**`assertAssignedHrUserExists(null)` سطر 167:** يُرجع `{ ok: true, assignedHrUserId: null }` — لذا حتى الـ "provided path" لا ينقذ الوضع.

**الإصلاح:** السطر الوحيد الذي يحتاج تغيير: الـ default في "not provided" case — فقط `isSuperAdmin` الحقيقي يستحق `null`، كل مستخدم آخر يُسند لنفسه دائماً.

الآن تحقق من typecheck:

TypeScript نظيف. الآن تحقق من الكود المعدّل:

---

## التقرير الكامل

### سبب عدم ظهور العميل للمشرفة

المشرفة تملك `clients.create` بـ **GLOBAL scope** (لأن الأدوار تُنشأ من SYSTEM_ADMIN template الذي يمنح كل شيء بـ GLOBAL). الكود القديم:

```typescript
assignedHrUserId: createScope === 'GLOBAL' ? null : authContext.userId
//                                ^^^^^^^^ صحيح للسوبر أدمن، خطأ للمشرفة
```

→ `assigned_hr_user_id = NULL` في DB

لكن `clients.view_list` بـ ASSIGNED scope يفلتر بـ `assigned_hr_user_id = supervisor.userId` → لا تطابق → لا يظهر.

---

### قيمة `assigned_hr_user_id` قبل الإصلاح

```
NULL  ← لأن createScope = 'GLOBAL' رغم أن المستخدمة ليست super-admin
```

---

### التعديل المنفذ — ملف واحد فقط

**`packages/api/routes/clients.ts`** — شرط واحد بدل شرطين:

| الحالة | قبل | بعد |
|--------|-----|-----|
| لم يُرسل `assignedHrUserId` + GLOBAL scope | `null` | `isSuperAdmin ? null : authContext.userId` |
| أُرسل `null`/`''` + non-superAdmin | يتجه لـ `assertAssignedHrUserExists(null)` → NULL | يُسند لـ `authContext.userId` |
| سوبر أدمن + لم يُرسل | `null` | `null` (unchanged) ✓ |
| قيمة صريحة | validate & use | validate & use (unchanged) ✓ |

---

### كيف يعمل CREATE الآن

- **السوبر أدمن بدون تحديد owner** → `assigned_hr_user_id = NULL` (مقصود، HQ entry)
- **المشرفة بدون تحديد owner** → `assigned_hr_user_id = supervisor.userId` ✓
- **المشرفة أرسلت null** → تُجاهل، `assigned_hr_user_id = supervisor.userId` ✓
- **أي مستخدم بقيمة صريحة** → يُتحقق منها ويُستخدم ✓

---

### كيف تعمل LIST ASSIGNED

```sql
WHERE assigned_hr_user_id = $1   -- supervisor.userId
  AND branch_id = ANY($2)        -- allowedBranchIds
```
الآن يطابق لأن `assigned_hr_user_id = supervisor.userId` في DB.

**TypeScript:** `npx tsc --noEmit` → 0 errors ✓