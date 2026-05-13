# CHANGES — P5 Constitution & Handoff Update

## الملفات الدستورية التي راجعتها

| الملف | الحالة |
|-------|--------|
| `docs/constitution/features/planning-contact-targets.md` | مُعدَّل |
| `docs/constitution/features/telemarketing-appointments.md` | مُعدَّل |
| `docs/constitution/features/route-assignment.md` | مراجعة فقط — لا تعديل |
| `docs/constitution/domains/planning.md` | مراجعة فقط — لا تعديل (§9.3 يُوثّق legacy بالفعل) |
| `docs/constitution/domains/telemarketing.md` | مراجعة فقط — draft فارغ (Gap-E) |
| `docs/constitution/handoffs/2026-05-11-planning-appointments-handoff.md` | مراجعة — §8 يُدرج المشاكل التي أنهيناها |
| `docs/constitution/handoffs/2026-05-12-p1-p4-findings-handoff.md` | **جديد** — handoff نهائي شامل |

---

## ما الذي غُيّر نصياً

### `planning-contact-targets.md` — قسم 8 (الفجوات)

**إضافة:**
- `PC-G001` أُعيد صياغته من "فجوة عامة" إلى **decision pending** مع:
  - تحديد مواضع الكود بدقة (سطور 380، 390، 417، 556)
  - تقديم Option A (إزالة filter) و Option B (تقييد الدستور)
  - تثبيت أن القيد يبقى حتى صدور قرار منتج
- `PC-G003` **جديد**: توثيق إصلاح p1 (`GET /contact-targets/marketing`) كـ مُصلَح
- `PC-G004` **جديد**: توثيق `contact_target.status` terminal behavior كـ gap معروف

---

### `telemarketing-appointments.md` — قسم 6 (AP-R001) + قسم 9 (الفجوات)

**تحديث `AP-R001`:**
- إضافة annotate للسلوك الفعلي المُثبَت في p3
- الفصل الصريح بين "السلوك المقصود" (يشترط مهمة) و"السلوك الفعلي في الباكند" (لا يشترط)
- وصف الـ UI gate مقابل API gap

**إعادة كتابة قسم 9 (الفجوات):**
- `AP-G001`: التوضيح أن `telemarketing` prefix legacy ويبقى — لا تغيير تقني
- `AP-G002`: إضافة الـ gap الحرج (task_type → مسار ميت مع legacy endpoint)
- `AP-G004` **جديد**: توثيق `PATCH /:id/result` كـ @deprecated
- `AP-G005` **جديد**: توثيق `open_task` silent update behavior

---

### `2026-05-12-p1-p4-findings-handoff.md` — **جديد كلياً**

الـ handoff النهائي يشمل:
1. ما الذي انتهى (p1–p4) مع أدلة موثَّقة
2. الـ gaps المفتوحة مُصنَّفة بخطورة وحالة
3. الـ legacy المُعترف به
4. الملفات المُحدَّثة في الجلسة كاملة
5. ترتيب أولوية القرارات اللازمة

---

## ما الذي تم توضيحه بدل تغييره

| الموضوع | ما ثُبّت |
|---------|---------|
| `planning.md §9.3` | كان يقول "اسم تاريخي" — صحيح ويبقى كما هو |
| `route-assignment.md` | لا علاقة بـ p1–p4 — لا تغيير |
| `telemarketing.md` domain | draft فارغ — لا يُغيَّر بدون إكمال منفصل |
| `AP-G003` في `telemarketing-appointments.md` | نص السلسلة التشغيلية — يبقى مع تحديث طفيف |

---

## تنبيه: الملفات الدستورية غير مُتتبَّعة في git

```
$ git status docs/constitution/
Untracked files: docs/constitution/
```

جميع الملفات في `docs/constitution/` غير مُضافة لـ git tracking. التعديلات على القرص لكنها خارج نطاق git. هذا وضع موجود مسبقاً — لا تغيير في السياسة.
