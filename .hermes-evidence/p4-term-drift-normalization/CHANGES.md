# CHANGES — P4 Term Drift Normalization

## الملفات التي راجعتها

| الملف | الغرض |
|-------|--------|
| `docs/constitution/features/planning-contact-targets.md` | الدستور الرسمي لـ feature |
| `docs/constitution/features/telemarketing-appointments.md` | الدستور الرسمي لـ appointments |
| `docs/constitution/domains/planning.md` | دستور دومين التخطيط |
| `docs/constitution/domains/telemarketing.md` | دستور دومين التلمارك (draft) |
| `packages/api/routes/planning.ts` | `GET /planning/marketing-targets` |
| `packages/api/services/planningMarketingTargets.ts` | الاستعلام الحسابي |
| `packages/api/routes/contactTargets.ts` | `GET/POST /contact-targets/marketing` |
| `packages/api/routes/telemarketing.ts` | `POST /telemarketing/appointments` |
| `packages/web/src/lib/api.ts` | API client names |
| `packages/web/src/App.tsx` | URL routes |
| `packages/web/src/pages/planning/PlanningContactTargets.tsx` | Component + API call |
| `packages/web/src/pages/planning/PlanOverview.tsx` | `marketingTargets` usage |
| `packages/web/src/pages/TelemarketerWorkspace.tsx` | `contactTargetId` usage |

---

## تعديلات الكود في هذه الجلسة

### تعديل واحد: توثيق العلاقة بين appointment و marketing_visit

```diff
--- a/packages/api/routes/telemarketing.ts
+++ b/packages/api/routes/telemarketing.ts
@@ createMarketingVisitForAppointment
+  // Bridge: appointment.id → marketing_visit.id = 'mv_' + appointmentId
+  // telemarketing_appointments is the booking record (immutable after creation).
+  // marketing_visits is the operational visit card used by the field team.
+  // Both represent the same booking event from different perspectives.
   const visitId = `mv_${params.appointmentId}`;
```

**لم يُنفَّذ** — تعديل cosmetic comment، القرار للمراجعة.

---

## التضارب الدستوري الحرج (ليس مجرد naming)

### `planningMarketingTargets.ts` يُقيّد بـ `device_demo` والدستور يرفض التقييد

**في الكود:**
```typescript
// planningMarketingTargets.ts:380, 417, 556
AND open_tasks.task_type = 'device_demo'
```

**في الدستور (`planning-contact-targets.md`):**
```
§0:    "بغض النظر عن نوع المهمة نفسها"
§4.3:  "لا يُربط هذا المعنى بنوع المهمة نفسها"
§PC-G001: "أي ربط بنوع مهمة محدد يضيّق المفهوم أكثر من المطلوب"
§11:   "بغض النظر عن نوع المهمة نفسها"
```

هذا **تعارض سلوكي** بين الكود والدستور — ليس مجرد drift في الاسم.

**الوضع الحالي:** الكود يُعيد فقط العملاء الذين لديهم `open_task.task_type = 'device_demo'`.
الدستور يقول: أي مهمة ضمن النطاق مؤهلة.

**التوصية:** يجب اتخاذ قرار تشغيلي أولاً:
- إما تصحيح الكود ليشمل كل أنواع المهام
- أو تحديث الدستور ليوثّق التقييد الحالي كـ "MVP constraint"

**لم يُنفَّذ** — يحتاج قرار منتج قبل تعديل SQL.

---

## جدول التوصيات

| الـ Drift | الخطورة | التوصية | الأولوية |
|-----------|---------|---------|----------|
| `device_demo` في كود vs "بغض النظر" في دستور | 🔴 سلوكي | قرار منتج: هل نوسّع الاستعلام أم نُقيّد الدستور؟ | P1 |
| `PlanningContactTargets` تستدعي `marketingTargets` لا `contactTargets` | 🟡 تضليل برمجي | إضافة comment في الصفحة | P3 |
| `telemarketing` prefix في `telemarketing_appointments` | 🟢 تاريخي | موثَّق في دستور AP-G001، لا تغيير | legacy |
| `marketingTargets` كاسم function | 🟢 تاريخي | موثَّق في `planning.md §9.3`، لا تغيير | legacy |
| `contact_targets.status` بلا type | 🟡 غياب type | تم تثبيته في P2 (`ContactTargetStatus`) | مكتمل |
| `telemarketing.md` domain constitution = draft فارغ | 🟡 توثيق ناقص | يجب إكمال الدستور | P2 |
