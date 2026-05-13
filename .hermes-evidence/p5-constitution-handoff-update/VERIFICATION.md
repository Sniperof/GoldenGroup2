# VERIFICATION — P5 Constitution & Handoff Update

## التحقق من أن التحديثات مطابقة للسلوك الفعلي

---

## 1. التحقق من تحديثات `planning-contact-targets.md`

### PC-G001 — تم تحديده كـ decision pending مع مواضع دقيقة

```bash
$ grep -n "PC-G001\|decision pending\|سطور\|380\|417\|556" \
    docs/constitution/features/planning-contact-targets.md

194: **الحالة: decision pending — بحاجة قرار منتج**
[يحتوي مواضع الكود: 380، 390، 417، 556]
```

```bash
$ grep -n "device_demo" \
    packages/api/services/planningMarketingTargets.ts | wc -l

5  ← 4 مواضع في SQL + سطر واحد في unfinished_visit
```

**التطابق**: ✅ الدستور الجديد يُدرج المواضع الفعلية في الكود.

---

### PC-G003 — الإصلاح موثَّق بدقة

```bash
$ grep -n "PC-G003\|ACTIVE_OPEN_TASK_STATUSES\|contactTargets.ts:129" \
    docs/constitution/features/planning-contact-targets.md

215: ### `PC-G003` — `GET /contact-targets/marketing` كان مكسوراً (مُصلَح)
217: [packages/api/routes/contactTargets.ts:129]
```

```bash
$ grep -n "ACTIVE_OPEN_TASK_STATUSES" \
    packages/api/routes/contactTargets.ts

9:  const ACTIVE_OPEN_TASK_STATUSES = ['open', 'assigned', ...]
129: const { rows } = await pool.query(marketingTargetSelect, [branchId, ACTIVE_OPEN_TASK_STATUSES]);
```

**التطابق**: ✅ الدستور يُوثّق الإصلاح وموقعه بدقة.

---

## 2. التحقق من تحديثات `telemarketing-appointments.md`

### AP-R001 — التحديث يعكس السلوك الفعلي

```bash
$ grep -n "السلوك الفعلي\|open_task_id = NULL\|fcc7ccc9" \
    docs/constitution/features/telemarketing-appointments.md

[يتضمن: "الحجز يعمل حتى مع open_task_id = NULL"]
[يتضمن: "الموعد fcc7ccc9 في staging اكتمل كـ completed بدون أي open_task"]
```

```sql
-- إثبات DB مباشر (من p3):
SELECT id, open_task_id, mv.status
FROM telemarketing_appointments ta
JOIN marketing_visits mv ON mv.source_id = ta.id
WHERE ta.entity_id = 2 AND ta.id = 'fcc7ccc9-...';
-- النتيجة: open_task_id=NULL, mv.status='completed'
```

**التطابق**: ✅ الدستور يُدرج الدليل الفعلي من DB.

---

### AP-G002 — المسار الميت موثَّق

```bash
$ grep -n "AP-G002\|task_type\|404\|legacy endpoint" \
    docs/constitution/features/telemarketing-appointments.md

266: **الحالة: مُثبَت في الكود (p3، 2026-05-12) — قرار منتج لازم**
[يتضمن: "إذا وصلت marketing_visit_task بـ task_type ≠ 'device_demo'، يفشل legacy endpoint بـ 404"]
```

```typescript
// marketingVisits.ts:432-436 — الكود الفعلي:
const legacyTask = (visit.tasks || []).find((t: any) => t.taskType === 'device_demo');
if (!legacyTask) {
  return res.status(404).json({ error: 'No device_demo task found on this visit' });
}
```

**التطابق**: ✅ الدستور يُدرج السبب التقني بدقة.

---

## 3. التحقق من الـ Handoff الجديد

### أن المشاكل المُدرَجة في الـ handoff القديم مُحدَّثة بالنتائج

```bash
$ grep -n "8.1\|8.2\|8.3\|lifecycle\|عقد الحجز\|drift" \
    docs/constitution/handoffs/2026-05-11-planning-appointments-handoff.md

144: ### 8.1 Lifecycle الموعد
154: ### 8.2 عقد الحجز
159: ### 8.3 drift المصطلحي
```

الـ handoff القديم §8 يُدرج هذه المشاكل كـ "مفتوحة". الـ handoff الجديد `2026-05-12` يُغلقها بنتائج مُثبَتة.

**التطابق**: ✅ التسلسل متكامل: الـ handoff القديم يُدرج المشاكل، الجديد يُغلقها.

---

## 4. الفصل بين Legacy و Canonical

| العنصر | في الدستور القديم | في الدستور الجديد |
|--------|-----------------|-----------------|
| `marketingTargets` | "اسم تاريخي" (مُجمَل) | **legacy** مع مرجع `planning.md §9.3` |
| `telemarketing` prefix | "أثر تاريخي" (مُجمَل) | **legacy — يبقى تقنياً** مع سبب واضح |
| `PC-G001` device_demo | "فجوة" (غامض) | **decision pending** مع كود locations + خيارات |
| AP-R001 | قاعدة مطلقة | **قاعدة مقصودة + سلوك فعلي منفصل** |

---

## 5. الـ Gaps التي بقيت open — مثبَّتة بوضوح

```bash
$ grep -n "decision pending\|gap معروف\|todo" \
    docs/constitution/handoffs/2026-05-12-p1-p4-findings-handoff.md

Gap-A: device_demo filter — decision pending
Gap-B: contact_target terminal — decision pending
Gap-C: open_task validation — decision pending
Gap-D: task_type مسار ميت — decision pending
Gap-E: telemarketing.md فارغ — todo
```

كل gap له:
- خطورة مُحدَّدة (🔴/🟡/🟢)
- حالة واضحة (decision pending / todo)
- لا يوجد gap "غامض" أو بدون تصنيف

---

## 6. ما الذي لم يتغير (مُثبَت صحيح مسبقاً)

| الملف | السبب |
|-------|--------|
| `planning.md` | §9.3 يُوثّق legacy بالفعل — لا يحتاج تحديثاً |
| `route-assignment.md` | لا علاقة مباشرة بـ p1–p4 |
| `telemarketing.md` domain | draft فارغ — يحتاج عمل منفصل |
