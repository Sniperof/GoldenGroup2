# تصحيح: منع إضافة مشرف لفريق الطوارئ (solo)

> **الهدف:** `PATCH /field-visits/:id/team` يقبل حالياً `supervisorEmployeeId` لأي زيارة — بس فريق الطوارئ (`solo`) لا يجوز أن يحتوي مشرفاً.
>
> **السياق:**
> - فريق قياسي (`team`): مشرف + فني (إلزامي) + متدرب + تيلماركتر (اختياري)
> - فريق طوارئ (`solo`): فني فقط (إلزامي) + متدرب + تيلماركتر (اختياري) — **ممنوع مشرف**

---

## الملف المرجعي

| الملف | السطر | اللي فيه |
|-------|-------|---------|
| `packages/api/routes/fieldVisits.ts` | ~676–772 | `PATCH /:id/team` endpoint |

---

## التعديل المطلوب

### المكان

في `fieldVisits.ts` — بعد تحميل الزيارة وبعد التحقق من `status !== 'scheduled'`، وقبل التحقق من أن حقل واحد على الأقل مُرسل.

### الإضافة

```ts
    // Determine if this is a solo (emergency) visit — no supervisor allowed
    const isSolo = !visit.supervisor_employee_id && !visit.team_snapshot?.supervisor;
    if (isSolo && supervisorEmployeeId !== undefined) {
      return res.status(400).json({
        error: 'فريق الطوارئ لا يمكن أن يحتوي مشرفاً — فني فقط',
      });
    }
```

> **ملاحظة:** `visit.supervisor_employee_id` null و `team_snapshot` ما فيه `supervisor` = الزيارة من نوع `solo` (طوارئ). الزيارات القياسية دائماً عندن `supervisor_employee_id`.

---

## Acceptance Criteria

- [ ] `PATCH /field-visits/:id/team` لزيارة قياسية بيقبل `supervisorEmployeeId` ✅
- [ ] `PATCH /field-visits/:id/team` لزيارة طوارئ (`solo`) بـ **يرفض** `supervisorEmployeeId` مع رسالة واضحة
- [ ] `PATCH /field-visits/:id/team` لزيارة طوارئ بيستمر بقبول `technicianEmployeeId` + `traineeEmployeeId` + `telemarketerEmployeeIds`
- [ ] `PATCH /marketing-visits/:id/team` ما يتأثر — هو كيان legacy منفصل

---

**تاريخ الكتابة:** 2026-05-23
**المنفّذ:** (Codex / Claude Code)
