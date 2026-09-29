# TASK PART A: نقل الـ Permissions + حذف marketingVisits.ts API + حذف MarketingVisit types

> الهدف: حذف كل كود `marketing_visits` من backend و frontend و shared types.
> الخطورة: عالية — أي حذف بدون دقة بيكسر البناء.
> القاعدة: search قبل حذف، verify بعد حذف.

---

## المرحلة 6: نقل الـ Permissions (Permissions Migration)

### 6.1 Backend — احذف أي `requirePermission('marketing_visits.*')` واستبدل بـ `field_visits.*`

**Commands للبحث (لازم تشتغل قبل أي تعديل):**
```bash
cd /opt/golden-crm/apps/staging
grep -r "requirePermission('marketing_visits" packages/api/ --include="*.ts"
```

**النتائج المتوقعة ممكن تكون:**
- `packages/api/routes/marketingVisits.ts` ← **لا تعدّل هذا الملف** (رح ينحذف كامل بـ المرحلة 7)
- `packages/api/routes/openTasks.ts` ← إذا فيه `requirePermission('marketing_visits.view')` أو شي مشابه
- أي ملف تاني لازم يتعدّل

**التعديل:**
```ts
// BEFORE:
requirePermission('marketing_visits.view')

// AFTER:
requirePermission('field_visits.view')
```

> **ملاحظة:** إذا الـ admin panel ما بيعرض `field_visits.*` permissions → ضيفن لـ `RolePermissions.tsx` و `PermissionSettings.tsx`.

### 6.2 Frontend — احذف أي `permission="marketing_visits.*"`

**Commands:**
```bash
grep -r "marketing_visits\." packages/web/src/ --include="*.tsx" --include="*.ts"
```

**التعديل:**
```tsx
// BEFORE:
<PermissionGate permission="marketing_visits.view">

// AFTER:
<PermissionGate permission="field_visits.view">
```

### 6.3 Admin — RolePermissions.tsx + PermissionSettings.tsx

**المطلوب:** أضف `field_visits.*` permissions وعلّم `marketing_visits.*` بـ "legacy — don't use".

```tsx
// في RolePermissions.tsx أضف:
'field_visits.view': { label: 'عرض الزيارات الميدانية', desc: '...' },
'field_visits.update_result': { label: 'تسجيل نتيجة مهمة', desc: '...' },
'field_visits.update_status': { label: 'تحديث حالة الزيارة', desc: '...' },
'field_visits.reschedule': { label: 'إعادة جدولة زيارة', desc: '...' },
'field_visits.cancel': { label: 'إلغاء زيارة', desc: '...' },
```

---

## المرحلة 7: حذف `marketingVisits.ts` API بالكامل + كل references

### 7.1 احذف ملف الـ backend

```bash
rm /opt/golden-crm/apps/staging/packages/api/routes/marketingVisits.ts
```

### 7.2 احذف من index.ts (أو يلي بيسجل routes)

**ابحث عن:**
```bash
grep -n "marketingVisits" /opt/golden-crm/apps/staging/packages/api/index.ts
```

**احذف:**
```ts
// DELETE this import:
import marketingVisitsRouter from './routes/marketingVisits.js';

// DELETE this registration:
app.use('/api/marketing-visits', marketingVisitsRouter);
// أو:
router.use('/marketing-visits', marketingVisitsRouter);
```

### 7.3 احذف من api.ts (frontend API client)

**الملف:** `packages/web/src/lib/api.ts`

**ابحث عن كل الـ block يلي بتبدأ بـ `marketingVisits:`**

**احذف الكامل:**
```ts
// DELETE ALL OF THIS BLOCK:
marketingVisits: {
  list: ...
  get: ...
  updateResult: ...
  updateTaskOutcome: ...
  updateStatus: ...
  reschedule: ...
  cancel: ...
  close: ...
  updateTeam: ...
  assignScope: ...
}
```

### 7.4 احذف components legacy (بعد التأكد)

**ابحث عن الاستدعاء قبل الحذف:**
```bash
grep -r "MarketingVisitResultModal\|MarketingVisitOutcomeModal\|CancelVisitModal\|RescheduleVisitModal" packages/web/src/
```

> ملاحظة: `CancelVisitModal` و `RescheduleVisitModal` ممكن يكونوا general (مش marketing-specific). تأكد إن `VisitDetailPage.tsx` بيستخدم `api.fieldVisits.cancel/reschedule` قبل ما تحذف.

**الcomponents يلي لازم تُحذف (إذا ما عاد حدا بيستدعيهن):**
- `packages/web/src/components/marketing-visits/MarketingVisitResultModal.tsx`
- `packages/web/src/components/marketing-visits/MarketingVisitOutcomeModal.tsx`
- (اختياري) `packages/web/src/components/marketing-visits/CancelVisitModal.tsx` — إذا موجودة marketing-specific فقط

**لو لقيت استدعاء من `VisitDetailPage.tsx`:**
- تأكد إن `VisitDetailPage.tsx` بيستخدم `api.fieldVisits.*`
- بعديها احذف الـ component القديم

### 7.5 احذف pages legacy (بعد التأكد)

**ابحث عن الاستدعاء:**
```bash
grep -r "MarketingVisitDetailsPage\|MarketingVisitsPage" packages/web/src/
```

**الpages يلي لازم تُحذف (إذا ما عاد حدا بيستدعيهن):**
- `packages/web/src/pages/MarketingVisitDetailsPage.tsx` (replaced by `VisitDetailPage.tsx`)
- `packages/web/src/pages/MarketingVisitsPage.tsx` (replaced by `VisitsListPage.tsx`)

### 7.6 احذف أي route قديم

**الملف:** `packages/web/src/App.tsx` أو يلي بيعرف الـ routes

**ابحث عن:**
```tsx
<Route path="/marketing-visits/:id" element={<MarketingVisitDetailsPage />} />
<Route path="/marketing-visits" element={<MarketingVisitsPage />} />
```

**احذفن.**

---

## المرحلة 8: حذف Shared Types Legacy

### 8.1 `packages/shared/types.ts`

**ابحث عن كل types يلي بتبدأ بـ `MarketingVisit`:**
```bash
grep -n "MarketingVisit\|MarketingVisitTask\|MarketingVisitResult\|MarketingVisitReschedule\|MarketingVisitCancel\|MarketingVisitLifecycle\|MarketingVisitTeamSnapshot\|MarketingVisitType\|MarketingVisitStage\|MarketingVisitStatus\|MarketingVisitCompletionState\|MarketingVisitTaskType\|MarketingVisitTaskStatus\|MarketingVisitTaskResult\|MarketingVisitTaskOutcome\|MarketingVisitSourceType\|MarketingVisitNonCompletionReason\|MARKETING_VISIT_TASK_OUTCOME_LABELS" packages/shared/types.ts
```

**احذف كل interface/type/const يلي بتبدأ بـ `Marketing` أو `MARKETING_VISIT` **إلا إذا:**
- `openTasks.ts` backend بيستخدمهن لسا
- أي ملف تاني backend بيستخدمهن

**ابحث قبل الحذف:**
```bash
grep -r "MarketingVisit\|MarketingVisitTask\|MarketingVisitResult" packages/ --include="*.ts" --include="*.tsx" | grep -v "shared/types.ts" | grep -v "node_modules"
```

> إذا طلع results → ما تحذفش. عدّل الملفات يلي بيستخدموهن أولاً.

### 8.2 Verify build after type deletion

```bash
# Backend:
pnpm --filter @golden-crm/api exec tsc --noEmit

# Frontend:
pnpm --filter @golden-crm/web exec tsc -p tsconfig.typecheck.json --noEmit

# Shared:
pnpm --filter @golden-crm/shared exec tsc --noEmit
```

> أي error = في reference لسا موجود. دور عليه وحلّه.

---

## ملاحظات أمان

1. **لا تحذف أي ملف قبل `grep` تأكد إنه ما حدا بيستدعيه.**
2. **لا تحذف أي type قبل `grep` تأكد إنه ما حدا بيستخدمه.**
3. **بني (build) بعد كل حذف.**
4. **إذا build فاشل → `git checkout` لآخر commit ناجح.**
5. **Commit بعد كل مرحلة ناجحة:**
   ```bash
   git add -A && git commit -m "phase 6: permissions migrated"
   git add -A && git commit -m "phase 7: marketingVisits.ts deleted"
   git add -A && git commit -m "phase 8: MarketingVisit types deleted"
   ```
