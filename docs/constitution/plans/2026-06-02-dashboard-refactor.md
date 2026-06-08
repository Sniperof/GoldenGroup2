# خطة شاملة — Refactor لـ Branch Manager Dashboard

> **التاريخ:** 2026-06-02
> **النطاق:** [`PlanningContactTargets.tsx`](../../../packages/web/src/pages/planning/PlanningContactTargets.tsx) + endpoint [`/api/planning/assigned-tasks`](../../../packages/api/routes/planning.ts:288)
> **الحالة:** ⏳ في انتظار تأكيد المنتج للأولويات
> **المرجع التشخيصي:** جلسة 2026-06-02 — قراءة كاملة للصفحة (676 سطر) + الـ endpoint (250 سطر) + الـ filter ([`features/contact-targets-eligibility-filter.md`](../features/contact-targets-eligibility-filter.md)).

---

## 0. السياق

شاشة `PlanningContactTargets` هي **لوحة التحكم الرئيسية** لمدير الفرع. يصل إليها عبر:

```
/planning/contact-targets/:teamKey?date=YYYY-MM-DD&label=...
```

تحوي:
- شريط إحصائيات (stat cards): 5 فلاتر — الكل / جاهزة / في القائمة / مغلقة / مستثناة
- زر "توليد قائمة الاتصال" (PRE-GEN) أو "إعادة التوليد" (POST-GEN)
- جدول الزبائن الواحد لكل زبون مع 10 أعمدة
- Modal لتفاصيل المهام لكل زبون عند النقر

**القرار التشخيصي الكبير (PC-G000):** الـ Dashboard يخلط بين كيانين — `open_tasks` (الذي يقرأه) و `contact_targets` (الذي يدّعي تمثيله). هذا الخلط يولّد كل الفجوات التالية.

---

## 1. السيناريوهات الـ 8 لمدير الفرع

| # | السيناريو | متى يحدث | الحالي يدعمه؟ |
|---|---|---|---|
| **S1** | تخطيط الصباح: مراجعة الجاهز، استثناء غير المرغوب، توليد القائمة | بداية اليوم | ✅ مدعوم جزئياً |
| **S2** | متابعة منتصف اليوم: من تواصل التيلماركتر معه، من حُجز موعده، من توقّف | منتصف اليوم | ⚠️ لا فلتر "محجوز" |
| **S3** | إضافة جهات جديدة مكتشَفة بعد التوليد | بعد التوليد | ⚠️ لا عدّاد "X جهة جديدة" |
| **S4** | مراجعة يوم سابق | اليوم التالي | ⚠️ لا تمييز "للقراءة فقط" |
| **S5** | تتبع الزبائن العالقين (محاولات عالية بلا حجز) | أي وقت | ❌ لا فلتر |
| **S6** | تحليل حسب نوع المهمة (device_demo vs collection) | تقرير | ❌ لا فلتر |
| **S7** | بحث عن زبون محدد (استدعاء طارئ) | استدعاء | ❌ لا حقل بحث |
| **S8** | عرض حسب المحطة | تنسيق فريق | ❌ لا فلتر بمحطة |

---

## 2. الـ Gaps الكاملة (20 فجوة UX)

### 🔴 الحرجة — تخفي قرارات تشغيلية

| # | الثغرة | الأثر |
|---|---|---|
| **UX-1** | `summary.booked` يُحسب لكنه لا يُعرض في الـ stat cards | المدير لا يرى عدد المواعيد المحجوزة اليوم — معيار النجاح الأول! |
| **UX-2** | خلط `completed` مع `closed` في فلتر واحد ("مغلقة") | `completed` = نجاح اليوم. `closed` = إقفال إداري قديم. خلطهما يضيع التمييز. |
| **UX-3** | `getPhase()` يصنّف الزبون بأعلى مرحلة فقط | زبون بـ 2 `assigned` + 1 `scheduled` → يظهر في `booked` فقط، فلا تُرى الـ 2 الجاهزة. |
| **UX-4** | بعد التوليد، إضافة جهات جديدة غير مرئية | زر "إعادة التوليد" بدون عدّاد. لا يُعرف هل سيضيف 0 أم 50. |
| **UX-5** | لا timestamp لتاريخ "آخر توليد" | لا يُعرَف متى تم التوليد. |

### 🟡 المهمة — تقلّل الكفاءة

| # | الثغرة | الأثر |
|---|---|---|
| **UX-6** | لا bulk select | استثناء 20 زبون = 20 نقرة × 20 API calls |
| **UX-7** | لا فلتر بمحطة | العمود معروض لكن غير قابل للفلترة |
| **UX-8** | لا فلتر بنوع المهمة | بعد DEC-005، جهات الاتصال تحوي أنواع متعدّدة — لا تمييز |
| **UX-9** | لا حقل بحث | لا يمكن إيجاد زبون محدد بسرعة |
| **UX-10** | لا فلتر بعدد المحاولات | الزبائن العالقون (5+ محاولات) مدفونون |
| **UX-11** | الـ sort logic ثابت — لا تخصيص | المدير قد يريد ترتيب بالاسم/المحطة/آخر تواصل |
| **UX-12** | empty state بدون CTA button للصفحة المرتبطة | المدير يضطر للملاحة يدوياً |
| **UX-13** | النقر على السطر يفتح modal مهام — لا رابط لـ ملف الزبون | لا يمكن قراءة سجل الزبون |

### 🟢 التجميلية

| # | الثغرة | الأثر |
|---|---|---|
| **UX-14** | الـ table عرضه min 860px — يتطلب scroll أفقي على mobile | تجربة سيئة على الموبايل |
| **UX-15** | الـ checkbox يبدو interactive في كل المراحل بصرياً | المدير قد يضغط ولا يحدث شيء |
| **UX-16** | "آخر نتيجة" تخلط مصادر اليوم و contact_target قديم بدون تمييز | قيم بأيام مختلفة |
| **UX-17** | لا تمييز للتاريخ في الماضي vs المستقبل | يمكن استثناء/استرجاع في يوم انتهى |
| **UX-18** | `taskListItemStatus` في الـ type لكن لا يُعرض أبداً | dead field |
| **UX-19** | لا tooltips لشرح المراحل دستورياً | المدير الجديد يحتاج وثائق خارجية |
| **UX-20** | لا تمييز للزبائن "عودة" في الـ summary cards | البادج "عودة" داخل الصف فقط |

---

## 3. صلاحية الإحصائيات (10 نقاط)

| # | الإحصائية | الصلاحية | الملاحظة |
|---|---|---|---|
| V-1 | `summary.assigned` | ✅ سليم | يعد الزبائن بـ `taskPhase = 'assigned'` |
| V-2 | `summary.inList` | ✅ سليم | يعد `in_scheduling` |
| V-3 | **`summary.booked`** | ⚠️ **محسوب لكن غير معروض** | الـ Stat strip يتجاهله |
| V-4 | **`summary.closed`** | ⚠️ يخلط `completed` و `closed` | معاني مختلفة — يجب فصلها |
| V-5 | `summary.excluded` | ⚠️ يعد الزبائن فقط لو `assignedCount=0 AND excludedCount>0` | لا يعد المهام المستثناة جزئياً |
| V-6 | **`tabs[0].count = allClients.length`** | ⚠️ مضلل في POST-GENERATION | يحوي فقط المُولَّدة + المستثناة، ليس "كل الجاهزين" |
| V-7 | `client.attemptCount` (مجموع المحاولات) | ⚠️ يخفي التفاصيل | زبون بمهمتين × 3 محاولات يظهر 6 |
| V-8 | `client.assignedCount` vs `client.tasks.length` | ⚠️ تباين خفي | المدير قد يرى "3 مهام" بينما `assignedCount = 0` |
| V-9 | `latestCallOutcome` fallback chain | ⚠️ يخلط مصدرين بدون timestamp | اليوم + contact_targets قديم |
| V-10 | **Phase priority ثابت** (`PHASE_ORDER`) | ⚠️ `completed=closed=4` يدمج النجاح والإقفال الإداري |

---

## 4. الخطة بثلاث طبقات

### الطبقة 1 — إصلاحات سريعة (1-2 يوم)

تركّز على إظهار الإحصائيات المخفية وإصلاح الخلط.

| # | المهمة | الملف | الوقت |
|---|---|---|---|
| L1.1 | إضافة tab/stat لـ "محجوز" (UX-1) | `PlanningContactTargets.tsx` + `tabs` array | 30د |
| L1.2 | فصل tab "مغلقة" إلى "مكتمل" + "مُقفَل" (UX-2, V-4, V-10) | `getPhase()` + `PHASE_META` + summary | 45د |
| L1.3 | عدّاد "X جهة جديدة منذ آخر توليد" (UX-4) | endpoint + UI banner | 1.5س |
| L1.4 | timestamp "آخر توليد" + عرضه في الـ banner (UX-5) | `telemarketing_task_lists.created_at` + UI | 30د |
| L1.5 | تعديل اللبيل في tab "الكل" ليكون أوضح (V-6) | UI label | 15د |
| L1.6 | اختبار 5 سيناريوهات (PRE/POST gen, excluded, booked, completed) | manual | 1س |

**التسليم:** الـ Dashboard يعرض كل الحالات صراحة دون أي مقياس مخفي.

---

### الطبقة 2 — تجربة عمل عالية الإنتاجية (3-5 أيام)

تركّز على السرعة والكفاءة لمدير الفرع.

| # | المهمة | الوقت |
|---|---|---|
| L2.1 | حقل بحث live (UX-9) — اسم/هاتف/معرف | 2س |
| L2.2 | فلتر بالمحطة (UX-7) — dropdown يدخل في query params | 1.5س |
| L2.3 | فلتر بنوع المهمة (UX-8) — multi-select من `task_type_config` | 2س |
| L2.4 | فلتر بعدد المحاولات (UX-10) — slider/threshold | 1س |
| L2.5 | Bulk select + bulk exclude/restore (UX-6) — checkbox column + footer toolbar | 3س |
| L2.6 | CTA من empty state لصفحة الخطة (UX-12) | 30د |
| L2.7 | رابط من الـ row لملف الزبون (UX-13) — icon `external link` | 30د |
| L2.8 | تخصيص الـ sort (UX-11) — click على header | 1.5س |

**التسليم:** المدير ينجز عمل ساعة في 10 دقائق.

---

### الطبقة 3 — إعادة المعمارية حول `contact_targets` (1-2 أسبوع)

هذا هو الـ refactor البنيوي الكامل لحل PC-G000.

#### القرار البنيوي
**(أ)** الـ Dashboard يبقى على `open_tasks` لكن يعاد تسميته (`/planning/team-tasks` بدلاً من `/planning/contact-targets`).
**(ب)** يُعاد بناء الـ Dashboard ليُدار على مستوى `contact_targets` بالكامل.

> التوصية: **خيار ب** لأن الاسم يطابق المعنى الدستوري، والكيان `contact_targets` يحوي أصلاً معلومات يومية مجمَّعة.

#### مهام الخيار ب (إن اعتُمد)
| # | المهمة | الوقت |
|---|---|---|
| L3.1 | endpoint جديد `/api/planning/contact-targets-dashboard?date=&teamKey=` يقرأ من `contact_targets` مباشرة | يوم |
| L3.2 | إعادة تعريف الـ phases على مستوى `contact_targets.status` (7 حالات) | نصف يوم |
| L3.3 | إعادة بناء الـ stat cards حسب `closing_reason` (DEC-005 D26) | نصف يوم |
| L3.4 | إعادة بناء الـ row schema — `contact_target_id` مفتاح أساسي، الزبون secondary | يوم |
| L3.5 | عرض legacy `booked` كحالة فرعية من `closed` (للتوافق) | 2س |
| L3.6 | تمييز للتاريخ السابق (UX-17) — read-only mode | 3س |
| L3.7 | عرض GAP/Diff عند `taskListGenerated = TRUE` — كم جديد منذ التوليد | 4س |
| L3.8 | تحسين mobile (UX-14) — card layout بدل table في breakpoints < md | يوم |
| L3.9 | tooltips للمراحل (UX-19) + شرح closing_reason في hover | 3س |
| L3.10 | اختبار end-to-end بـ 8 سيناريوهات S1-S8 | يومان |

**التسليم:** Dashboard دستوري متّسق مع الـ domain الحقيقي.

---

## 5. القرارات المطلوبة قبل التنفيذ

| # | السؤال | الأثر |
|---|---|---|
| **D1** | تأكيد اعتماد الطبقة 1 فوراً؟ | نبدأ التنفيذ |
| **D2** | الطبقة 2 — أيها أولوية: بحث، فلاتر، أم bulk actions؟ | ترتيب التسليم |
| **D3** | الطبقة 3 — خيار (أ) إعادة تسمية أم (ب) إعادة بناء حول `contact_targets`؟ | جوهري معماري |
| **D4** | إذا (ب): هل نحفظ `/planning/team-tasks` كصفحة منفصلة للـ open_tasks-centric view؟ | hybrid model |
| **D5** | فجوة `CT-G-LEVEL-FALLBACK` (الفلتر على الحي فقط): نضيف fallback للناحية أم نُبقي كما هو؟ | بنيوي |

---

## 6. تقدير الوقت الإجمالي

| الطبقة | الوقت |
|---|---|
| الطبقة 1 (سريعة) | 1-2 يوم |
| الطبقة 2 (إنتاجية) | 3-5 أيام |
| الطبقة 3 (معماري) | 7-12 يوم |
| **المجموع** | **11-19 يوم عمل** |

---

## 7. المراجع
- [features/planning-contact-targets.md](../features/planning-contact-targets.md) — الدستور الأم
- [features/contact-targets-eligibility-filter.md](../features/contact-targets-eligibility-filter.md) — قيد الحساب الكامل
- [domains/planning.md](../domains/planning.md) — دومين التخطيط
- [domains/telemarketing.md](../domains/telemarketing.md) — حالات `contact_targets`
- [decisions/DEC-005-contact-targets-filter.md](../decisions/DEC-005-contact-targets-filter.md) — أساس التصميم الحالي
- [decisions/DEC-006-pending-resolutions-round1.md](../decisions/DEC-006-pending-resolutions-round1.md) — D26 closing_reason
