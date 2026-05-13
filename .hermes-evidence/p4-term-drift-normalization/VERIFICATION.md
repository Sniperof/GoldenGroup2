# VERIFICATION — P4 Term Drift Normalization

## منهجية التحقق

1. قراءة الملفات الدستورية الفعلية
2. مقارنة الأسماء الدستورية بالأسماء في الكود
3. استخراج الاقتباسات الحرفية من الدساتير
4. تحديد التعارضات السلوكية (وليس فقط التسميات)

---

## 1. إثبات: الدساتير تُقرّ بالـ Legacy صراحةً

### `marketingTargets` — legacy مُعترف به

```text
planning.md §9.3:
  "جهات الاتصال ذات المهام تأتي عبر api.planning.marketingTargets(date, teamKey)،
   وهو اسم تقني تاريخي للعقد الحسابي فقط."

planning-contact-targets.md §4.3:
  "الاسم التقني الحالي ما يزال يحمل أثرًا تاريخيًا مرتبطًا بالتسويق."
```

### `telemarketing` prefix — legacy مُعترف به

```text
telemarketing-appointments.md §AP-G001:
  "الاسم والحقول الحالية ما تزال تحمل أثرًا تاريخيًا من التليماركتينغ.
   المعنى التشغيلي الحقيقي أوسع: حجز موعد لجهة اتصال تملك مهمة داخل قائمة العمل."
```

---

## 2. إثبات: التعارض السلوكي بين الكود والدستور

### الدستور يقول: أي مهمة مؤهلة

```text
planning-contact-targets.md §0:
  "بغض النظر عن نوع المهمة نفسها"

planning-contact-targets.md §PC-R003:
  "لا تُدرج جهة اتصال إلا إذا كانت تملك مهمة ضمن النطاق"
  (بدون ذكر نوع المهمة)

planning-contact-targets.md §PC-G001:
  "أي ربط بنوع مهمة محدد يضيّق المفهوم أكثر من المطلوب
   ويشوّه وظيفة الملخص.
   إذا وُجدت أي نقاط تنفيذية ما تزال تفترض مسمى تسويقيًا أو نوع مهمة محددًا،
   فيجب اعتبارها فجوة تسمية لا فجوة مفهوم فقط."
```

### الكود يُطبّق: device_demo فقط

```typescript
// planningMarketingTargets.ts — 4 مواضع
AND open_tasks.task_type = 'device_demo'  // line 380
AND mvt.task_type = 'device_demo'         // line 390
AND ot_scope.task_type = 'device_demo'    // line 417
AND open_tasks.task_type = 'device_demo'  // line 556
```

**الاستنتاج:** الكود يُطبّق قيداً يرفضه الدستور. هذا ليس naming drift — هو behavioral drift.

---

## 3. إثبات: من يستدعي كل مصطلح وأين

### `marketingTargets` — الاستدعاءات

| الملف | السطر | الاستخدام |
|-------|-------|-----------|
| `planning.ts` | 7 | `GET /marketing-targets` endpoint |
| `api.ts` | 216 | `api.planning.marketingTargets(date, teamKey)` |
| `PlanningContactTargets.tsx` | 121 | `api.planning.marketingTargets(date, teamKey)` |
| `PlanOverview.tsx` | 168 | `api.planning.marketingTargets(date, card.key)` |
| `RouteAssigner.tsx` | 321 | `api.planning.marketingTargets(date, selectedTeam)` |

**الملاحظة:** `PlanningContactTargets.tsx` يستدعي `marketingTargets` لا `contactTargets` — هذا هو الـ implementation drift المحدد.

### `contact_targets` — الاستدعاءات

| الملف | السطر | الاستخدام |
|-------|-------|-----------|
| `contactTargets.ts` | table + API route | `/api/contact-targets/marketing` |
| `telemarketing.ts` | 150-205 | `resolveOrCreateContactTarget()` |
| `planningMarketingTargets.ts` | 477-479 | JOIN على جدول contact_targets |
| `shared/types.ts` | (جديد من P2) | `ContactTargetStatus` type |

---

## 4. إثبات: `planning-contact-targets` — اسم صحيح دستورياً لكن مُضلّل برمجياً

**الدستور يُعرّف الـ feature كـ:**
```text
"استخراج جهات الاتصال التي لديها مهمة داخل نطاق العمل"
```

**الكود يُسمّي الصفحة كـ:**
```typescript
// App.tsx:81
<Route path="/planning/contact-targets/:teamKey" element={<PlanningContactTargets />} />
```

**البرمجي يقرأ:**
```typescript
// PlanningContactTargets.tsx:121
api.planning.marketingTargets(date, teamKey)  // ← وليس contactTargets
```

**الدستور يُبرّر الـ naming:**
```text
planning-contact-targets.md §4.2:
  "PlanningContactTargets هو الجزء التنفيذي المتخصص الذي يحوّل هذا الملخص
   إلى قائمة جهة اتصال قابلة للتوليد والتنفيذ"
```

→ الاسم `PlanningContactTargets` = "التخطيط لاستهداف جهات الاتصال" (مفهوم)، وليس "عرض جدول contact_targets" (DB).
**الدستور صحيح. الكود مُضلّل لمن يقرأه بدون سياق.**

---

## 5. جدول الـ Drift الكامل مُصنَّفاً

| المصطلح | نوع الـ Drift | مدى الخطورة | مُعترف به في الدستور؟ |
|---------|-------------|------------|---------------------|
| `marketingTargets` كـ function name | Naming (historical) | 🟢 منخفض | ✅ نعم |
| `device_demo` filter في planningMarketingTargets | **Behavioral** | 🔴 عالٍ | ✅ معترف كـ PC-G001 gap |
| `PlanningContactTargets` تستدعي marketingTargets API | Implementation | 🟡 متوسط | ✅ مُبرَّر دستورياً |
| `telemarketing` prefix في table name | Naming (historical) | 🟢 منخفض | ✅ AP-G001 |
| `/contact-targets/marketing` suffix | Naming (filter) | 🟢 منخفض | لا — لكن منطقي |
| `telemarketing.md` domain = draft فارغ | توثيق ناقص | 🟡 متوسط | لا |

---

## 6. الـ legacy الذي يجب أن يُبقى كما هو

| المصطلح | السبب |
|---------|--------|
| `marketingTargets` function name | موثَّق كـ historical في `planning.md`, تغييره يستلزم migration API كامل |
| `telemarketing_appointments` table name | DB migration مكلف، لا قيمة تشغيلية فورية من التغيير |
| `booked` outcome code | يُعالَج بـ `normaliseOutcomeCode()`, لا يُكتَب جديداً |
| `/contact-targets/marketing` route | المعنى واضح: filter لـ marketing targets ضمن contact_targets |

---

## 7. القرار الأهم: الـ behavioral drift في `device_demo`

هذا الـ drift لا يُصنَّف كـ naming — بل كـ gap تشغيلي مُعترف به:

```text
planning-contact-targets.md §PC-G001:
  "إذا وُجدت أي نقاط تنفيذية ما تزال تفترض مسمى تسويقيًا أو نوع مهمة محددًا،
   فيجب اعتبارها فجوة تسمية لا فجوة مفهوم فقط."
```

الدستور يُشير إلى أن هذا معروف ومُصنَّف. لكن الكود لا يزال يُطبّق `device_demo` في 4 مواضع.

**التوصية:** قرار تشغيلي مطلوب:
- Option A: تصحيح SQL لإزالة `device_demo` filter (يوسّع النطاق لجميع أنواع المهام)
- Option B: توثيق الـ `device_demo` constraint في الدستور كـ "MVP decision" لا كـ bug
