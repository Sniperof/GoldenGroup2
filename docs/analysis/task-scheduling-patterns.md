# أنماط الجدولة الزمنية للمهام — `task_type_config.scheduling_pattern`

> **الحالة:** مرجع تصميمي معتمد — أساس لجدول `task_type_config`
> **تاريخ الإنشاء:** 2026-05-17
> **المصدر:** نقاش مباشر مع صاحب المنتج Ibrahim Obaid
> **يخدم:** `RA-G001` (نافذة N) — `G04/T06` (جدول task_type_config) — قاعدة `RA-R001`

---

## 1) المشكلة الجوهرية

عند حفظ نطاق العمل اليومي للفريق، يجب احتساب الزبائن الذين لديهم مهام **ضمن قيد الانتظار** و**ليست لاحقة خارج نافذة N الخاصة بنوعها** (الدستور — `RA-R001`).

لكن قيمة N لا يمكن أن تكون رقماً موحّداً لكل المهام:
- صيانة طارئة → يجب اليوم (N لا تنطبق أصلاً)
- صيانة دورية → موعدها بعد 6 شهور (N = 30 يوم منطقية)
- عرض جهاز → الزبون قال "بعد أسبوعين" (N على expected_date، ليس due_date)

لذا N **معناها** يختلف حسب نمط النوع، وليس فقط **رقمها**.

---

## 2) الأبعاد الثلاثة للسلوك الزمني

كل نوع مهمة يتميز بثلاثة أبعاد مستقلة:

### 2.1 البُعد الأول: هل للمهمة تاريخ مستقبلي مجدول؟
- ❌ لا → المهمة فورية، تظهر فور إنشائها
- ✅ نعم → نحتاج فلتر زمني لاستبعاد البعيدة

### 2.2 البُعد الثاني: على أي حقل نطبّق الفلتر؟
- `due_date` → تاريخ استحقاق صارم
- `expected_date` → موعد متوقع ليّن (من محادثة مع الزبون)
- لا شيء → لا فلتر زمني

### 2.3 البُعد الثالث: ما حجم النافذة الزمنية النموذجية؟
- لا تنطبق → دائماً ضمن النطاق
- صغيرة (3-7 أيام) → الجدولة معروفة بدقة
- كبيرة (15-30 يوم) → الجدولة بعيدة، نحتاج وقتاً للتنسيق المسبق

---

## 3) الأنماط الأربعة المعتمدة

### `immediate` — مهمة فورية
**المعنى:** المهمة لا تُولد قبل الحاجة. لحظة إنشائها = لحظة بدء العمل عليها. لا تاريخ مستقبلي.

**القاعدة:** دائماً ضمن نطاق العمل، N لا تُستخدم.

**أمثلة:**
- `emergency_maintenance` (طارئة — اليوم)
- `parts_sale` (زبون يطلب فلتر)
- `device_retrieval`, `device_repair`, `device_return`
- `device_purchase`, `device_disconnection`, `device_transfer`
- `golden_warranty`, `warranty_cancellation`, `warranty_reactivation`

---

### `short_window` — نافذة قصيرة (3-7 أيام)
**المعنى:** المهمة لها `due_date` مجدول قريب (أيام معدودة). تظهر في نطاق العمل قبل موعدها بأيام قليلة.

**القاعدة:** تدخل النطاق إذا `due_date ≤ today + N` (N صغيرة).

**أمثلة:**
- `device_delivery` (تسليم — N=3)
- `device_installation` (تركيب — N=3)
- `device_activation` (تشغيل — N=3)
- `device_return` (إعادة بعد صيانة — N=3)
- `gift_delivery` (تسليم هدية — N=7)

---

### `long_window` — نافذة طويلة (15-30 يوم)
**المعنى:** المهمة لها `due_date` بعيد (شهور)، نريد إخفاءها حتى تقترب. النافذة كبيرة لإعطاء الفريق وقت تنسيق مسبق مع الزبون.

**القاعدة:** تدخل النطاق إذا `due_date ≤ today + N` (N كبيرة).

**أمثلة:**
- `periodic_maintenance` (صيانة دورية كل 6 شهور — N=30)
- `installment_collection` (قسط شهري — N=15)
- `maintenance_collection` (ذمة صيانة — N=15)
- `device_checkup` (تشييك دوري — N=30)

---

### `expected_window` — نافذة على الموعد المتوقع
**المعنى:** لا `due_date` صارم، لكن التلمارك يحدد `expected_date` ليّن بناءً على رد الزبون.

**القاعدة:**
- إذا `expected_date IS NULL` → ضمن النطاق دائماً (مفتوحة جاهزة للاتصال)
- إذا `expected_date IS NOT NULL` → تدخل إذا `expected_date ≤ today + N`

**أمثلة:**
- `device_demo` (عرض جهاز — الزبون قال "اتصل بي بعد أسبوع" — N=7)

---

## 4) تمييز جوهري: نمط الجدولة ≠ آلية الإنشاء

**هذا التمييز كان نقطة التحول في النقاش.**

التصنيف `scheduling_pattern` يصف **سلوك المهمة الزمني** في النظام، وليس **كيف وُلدت**.

| الجانب | السؤال | يحدده |
|--------|---------|--------|
| **نمط الجدولة** | كم N؟ على أي حقل؟ متى تظهر؟ | **نوع المهمة** |
| **آلية الإنشاء** | هل تُولد آلياً من سلسلة؟ أم يدوياً؟ | **السياق التشغيلي** |

**هذان الجانبان مستقلان تماماً.**

### أمثلة على الاستقلالية

**`device_delivery` (نمط `short_window`):**
- 🤖 آلي: تُولد عادةً فور إغلاق `device_purchase`
- 👤 يدوي: مدير الفرع يُنشئها لإعادة تسليم بعد رفض، أو تسليم متأخر، أو تسليم منفصل
- **في الحالتين:** N=3، نفس قواعد النافذة

**`gift_delivery` (نمط `short_window`):**
- 🤖 آلي: قد تُولد بعد شراء معيّن
- 👤 يدوي: مدير الفرع يُنشئها لهدية وسيط (الشائع فعلياً)
- **في الحالتين:** N=7، نفس قواعد النافذة

**`installment_collection` (نمط `long_window`):**
- 🤖 آلي: تُولد كل شهر من نظام الأقساط
- 👤 يدوي: محاسب يُنشئها لقسط خارج الجدول
- **في الحالتين:** N=15، نفس قواعد النافذة

**`periodic_maintenance` (نمط `long_window`):**
- 🤖 آلي: تُولد فور إغلاق السابقة
- 👤 يدوي: تقني يُنشئها بعد فحص استثنائي
- **في الحالتين:** N=30، نفس قواعد النافذة

### القاعدة الذهنية

> **النمط يصف السلوك بعد الإنشاء، لا قبله.**
> أي نوع يمكن أن يُنشأ آلياً أو يدوياً، لكن سلوكه في نظام التخطيط واحد.

---

## 5) القاعدة الموحّدة لاحتساب الحمل

```
لكل مهمة في open_tasks:

  IF status NOT IN ('open', 'needs_follow_up'):
    استبعد (ليست في قيد الانتظار)
  
  ELSE:
    حسب scheduling_pattern من task_type_config:
    
    immediate:
      ✅ ضمن النطاق دائماً
    
    short_window أو long_window:
      IF due_date IS NULL:
        ✅ ضمن النطاق (مفتوحة بلا استحقاق)
      ELSE IF due_date <= today + N:
        ✅ ضمن النطاق
      ELSE:
        ❌ خارج النافذة (لاحقة)
    
    expected_window:
      IF expected_date IS NULL:
        ✅ ضمن النطاق دائماً (جاهزة للاتصال)
      ELSE IF expected_date <= today + N:
        ✅ ضمن النطاق
      ELSE:
        ❌ خارج النافذة (وعد ليّن في المستقبل)
```

---

## 6) القيم المعتمدة للـ 20 نوع

| # | task_type | scheduling_pattern | window_basis | N |
|---|-----------|:------------------:|:------------:|:-:|
| 1 | `device_demo` | expected_window | expected_date | 7 |
| 2 | `device_purchase` | immediate | none | — |
| 3 | `device_delivery` | short_window | due_date | 3 |
| 4 | `device_installation` | short_window | due_date | 3 |
| 5 | `device_activation` | short_window | due_date | 3 |
| 6 | `periodic_maintenance` | long_window | due_date | 30 |
| 7 | `emergency_maintenance` | immediate | none | — |
| 8 | `installment_collection` | long_window | due_date | 15 |
| 9 | `maintenance_collection` | long_window | due_date | 15 |
| 10 | `gift_delivery` | short_window | due_date | 7 |
| 11 | `device_checkup` | long_window | due_date | 30 |
| 12 | `parts_sale` | immediate | none | — |
| 13 | `device_retrieval` | immediate | none | — |
| 14 | `device_repair` | immediate | none | — |
| 15 | `device_return` | short_window | due_date | 3 |
| 16 | `golden_warranty` | immediate | none | — |
| 17 | `warranty_cancellation` | immediate | none | — |
| 18 | `warranty_reactivation` | immediate | none | — |
| 19 | `device_disconnection` | immediate | none | — |
| 20 | `device_transfer` | immediate | none | — |

---

## 7) سيناريو كامل لتوضيح السلوك

**الزبون أحمد اشترى جهاز بتقسيط 12 شهر:**

| اليوم | الحدث | المهام المؤثرة في نطاق العمل |
|:----:|------|------------------------------|
| 0 | توقيع العقد | `device_purchase` ✅ — وتُولد تلقائياً سلسلة كاملة |
| 1 | صباح اليوم التالي | `device_delivery` (due=يوم 2) ضمن النطاق فقط |
| 2 | تسليم | `device_delivery` ✅ — `device_installation` تأخذ due_date |
| 3 | تركيب | `device_installation` ✅ |
| 4 | تشغيل | `device_activation` ✅ — سلسلة التسليم انتهت |
| 16 | قبل القسط بـ14 يوم | `installment_collection #1` (due=30) خارج النافذة (N=15) |
| 17 | قبل القسط بـ13 يوم | ✅ دخلت النافذة |
| 30 | استحقاق القسط | اتصال + تحصيل |
| 150 | قبل الصيانة بـ30 يوم | `periodic_maintenance` ✅ دخلت النطاق |
| 180 | الصيانة | تنفيذ + توليد الصيانة التالية (due=360) |

---

## 8) القرارات المثبّتة في هذا النقاش

| # | القرار | السبب |
|:-:|--------|------|
| D-SP-01 | استخدام أربعة أنماط (immediate, short_window, long_window, expected_window) | يغطي كل الحالات التشغيلية بدقة |
| D-SP-02 | الأسماء وصفية تصف السلوك لا الأصل | يتجنب الإيحاء الغلط بأن `post_event` تأتي من حدث فقط |
| D-SP-03 | `scheduling_pattern` يصف السلوك بعد الإنشاء، لا آلية الإنشاء | أي نوع يمكن إنشاؤه آلياً أو يدوياً |
| D-SP-04 | `window_basis` حقل منفصل عن `pattern` | لفصل "أي حقل" عن "كم يوم" — يسمح بمرونة لاحقة |
| D-SP-05 | `immediate` لا تستخدم N | تبسيط: لا داعي لتخزين N=0 |
| D-SP-06 | `expected_window` إذا `expected_date IS NULL` تبقى ضمن النطاق | لأن المهمة بلا وعد = جاهزة للاتصال الآن |
| D-SP-07 | `short_window`/`long_window` إذا `due_date IS NULL` تبقى ضمن النطاق | لأن المهمة بلا استحقاق محدد = جاهزة للعمل |

---

## 9) الترابط مع الوثائق الأخرى

- `docs/analysis/task-model.md` — موديل المهمة الموحد + 11 حالة + 4 مراحل
- `docs/constitution/features/route-assignment.md` — قاعدة `RA-R001` و`RA-G001`
- جدول `task_type_config` — يحمل القيم المعتمدة في §6

---

## 10) الفجوات المتبقية بعد هذا التصميم

- **G-SP-01:** آلية تعديل N من واجهة المسؤول (بدلاً من migration كل مرة)
- **G-SP-02:** هل نسمح بتجاوز يدوي للنافذة لمهمة معينة (override)؟
- **G-SP-03:** ماذا لو غيّر صاحب المنتج النمط لاحقاً (مثلاً `device_demo` يصبح `long_window`)؟ — migration بسيطة
