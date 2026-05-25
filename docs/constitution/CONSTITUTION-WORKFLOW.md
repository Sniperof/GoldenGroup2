# دليل العمل مع الدستور — Constitution Workflow Guide

> **هاد الملف = العقد الأساسي بين Product و Engineering.**
> **أي تعديل بيغيّر المعنى أو العقد → لازم يتحدّث الدستور أولاً.**
> **الكود هو المصدر التشغيلي، بس الدستور هو المفهوم المشترك.**

---

## 1. السياق الحالي (Current Context)

### إنجازات الدستور حتى الآن

| # | الكيان | الحالة | الحجم | Test Cases | الثغرات |
|---|--------|--------|-------|------------|---------|
| 1 | الزبائن (Clients) | ✅ | 533 سطر | 12+ | 5 |
| 2 | المرشحون (Candidates) | ✅ | 356 سطر | 11+ | 5 |
| 3 | العقود (Contracts) | ✅ | 526 سطر | 8+ | 5 |
| 4 | المهام المفتوحة (Open Tasks) | ✅ | 366 سطر | 8+ | 5 |
| 5 | التسويق الهاتفي (Telemarketing) | ✅ | 310 سطر | 7+ | 5 |
| 6 | الزيارات الميدانية (Field Visits) | ✅ | 466 سطر | 12+ | 7 |
| 7 | المناطق الجغرافية (Geo Units) | ✅ | 253 سطر | 10+ | 7 |
| 8 | الصلاحيات والأدوار (Permissions) | ✅ | 338 سطر | 12+ | 9 |
| 9 | الفروع (Branches) | ✅ | 267 سطر | 10+ | 5 |
| 10 | الأجهزة والصيانة (Devices) | ⏳ قيد التنفيذ | — | — | — |
| **المجموع** | **10/72** | | **3,415 سطر** | **90+** | **49** |

### الملفات التوثيقية النشطة

```
docs/constitution/
├── README.md                          ← نقطة الدخول
├── INDEX.md                           ← فهرس كل الكيانات (يُحدّث عند إضافة كيان)
├── CROSS-REFERENCE.md                 ← المرجع المتقاطع (حقول مشتركة، علاقات)
├── GAPS-TRACKER.md                    ← متعقب الثغرات (الأهم)
├── project-constitution.md            ← دستور المشروع العام
├── terminology.md                     ← المصطلحات
├── vault-migration-map.md             ← خريطة الترحيل
├── templates/
│   └── entity-constitution.md         ← قالب دستور الكيان (مشتق من Clients)
├── domains/
│   ├── clients.md                     ← ✅
│   ├── candidates.md                  ← ✅
│   ├── contracts.md                   ← ✅
│   ├── open-tasks.md                  ← ✅
│   ├── telemarketing.md             ← ✅
│   ├── field-visits.md              ← ✅
│   ├── geo-units.md                 ← ✅
│   ├── permissions.md               ← ✅
│   ├── branches.md                  ← ✅
│   └── devices-maintenance.md       ← ⏳
└── features/                          ← الميزات (غير مستخدَمة حالياً)
```

---

## 2. آلية العمل (Workflow)

### القاعدة الذهبية

```
أي تعديل يبدأ بتحليل واضح لجزئية محددة.
إذا التعديل يغيّر المعنى أو العقد، نحدّث الدستور أولًا.
الكود الحالي هو الحقيقة التشغيلية، والدساتير تنظّم التغيير والفهم.
```

### خطوات العمل الثابتة

#### لإضافة كيان جديد (Entity Constitution)

```
1. قراءة ALL migrations اللي بتلمس الكيان
2. قراءة ALL route handlers اللي بتخدم الكيان
3. قراءة ALL policy/services اللي بتتحكم بالكيان
4. قراءة shared types
5. كتابة دستور الكيان بالـ 10 أقسام
6. تحديث INDEX.md (صف جديد)
7. تحديث CROSS-REFERENCE.md (حقول مشتركة + علاقات)
8. تحديث GAPS-TRACKER.md (ثغرات جديدة)
9. git commit
```

#### لحل ثغرة (Gap Fix)

```
1. قراءة GAP من GAPS-TRACKER.md
2. تحليل root cause بالتفصيل
3. تقرير: هل الحل بيتطلّب تعديل DB؟ API؟ UI؟
4. كتابة prompt للمنفذ (Claude/Codex)
5. مراجعة الـ prompt مع Product Owner (إبراهيم)
6. التنفيذ على staging
7. تحديث GAPS-TRACKER.md: status = ✅ محلول + رقم الـ commit
8. تحديث دستور الكيان المعني (إذا تغيّر العقد)
9. git commit
```

#### لإضافة feature جديدة

```
1. تعريف الـ Feature بالـ Vault (الهيكل، الحقول، الحالات، العلاقات)
2. تحديد الكيانات المتأثرة
3. تحديث الدساتير المتأثرة أولاً
4. كتابة prompt للتنفيذ
5. التنفيذ على staging
6. التحقق من توافق الدستور مع الكود
7. git commit
```

---

## 3. كيفية كتابة الـ Prompts الدقيقة (Prompt Writing Guide)

### القالب العام لـ Prompt دستور كيان

```markdown
# Prompt: Domain Constitution for [EntityName] ([الاسم العربي])

## Objective
بناء الدستور الكامل لكيان [EntityName]. يتبع نفس النموذج والجودة المحددة من pilot clients.

## Output Files
1. docs/constitution/domains/[entity].md
2. تحديث INDEX.md
3. تحديث CROSS-REFERENCE.md
4. تحديث GAPS-TRACKER.md (إذا وجدت ثغرات)

## Step 1: Read ALL Source Files

### A. Database Schema (Migrations)
اقرأ كل migration بيلمس [entity]:
```
[قائمة migrations]
```

### B. API Layer
```
[قائمة ملفات الـ routes + policies + services]
```

### C. Shared Types
```
[قائمة ملفات الأنواع]
```

### D. System Configuration
```
[قائمة migrations للصلاحيات]
```

## Step 2: Build the Constitution Document

اكتب docs/constitution/domains/[entity].md مع الأقسام العشرة:

### Section 1: هوية الكيان (Identity)
- الاسم العربي والإنجليزي
- اسم الجدول
- الوصف (شو بيمثل بالواقع)
- الجداول المرتبطة
- الأهمية

### Section 2: الجدول والحقول (Table & Field Dictionary) ⭐
لكل حقل: اسم، نوع SQL، NULL؟، DEFAULT، Constraints، وصف، مثال
أضف الجداول الفرعية كلها

### Section 3: القيود والقواعد (Constraints & Business Rules) ⭐
وثق على الأقل 5 قواعد:
- قواود الـ DB (CHECK, FK, UNIQUE)
- قواعد العمل (Business Rules)
- منطق الـ API
- قواعد التحويل بين الحالات

### Section 4: العلاقات (Relationships)
ER Diagram بـ Mermaid
جدول العلاقات (نوع، ON DELETE، وصف)

### Section 5: آلة الحالات (State Machine)
رسوم بيانية للـ state transitions
وصف كل حالة وشو بيوصل لها

### Section 6: صلاحيات الوصول (Permission Matrix)
جدول: المفتاح، الاسم العربي، النطاقات، الوصف
⚠️ تحقق من allowed_scopes في الـ DB

### Section 7: عقد API (API Contract)
جدول: Method, Path, Permission, وصف
Query parameters
Request/Response schemas (JSON examples)

### Section 8: حالات الاختبار الشاملة (Test Cases) ⭐
على الأقل 10-12 حالة:
- Happy path
- Validation errors
- Permission denied
- Edge cases
- Cross-branch scenarios

### Section 9: الثغرات والتضاربات (Gaps & Contradictions) ⭐
ابحث عن:
- تضارب بين migrations والـ code
- حقول legacy مش مستخدمة
- missing CHECK constraints
- naming mismatches
- missing endpoints
- soft-delete missing
- JSONB fields بدون validation

### Section 10: تاريخ التغييرات (Schema Changelog)
جدول: تاريخ، migration، التعديل

## Step 3: Update Supporting Files

### INDEX.md
```
| [الكيان] | [domains/entity.md] | ✅ مكتمل | [XX] سطر | [YY]+ | [ZZ] |
```

### CROSS-REFERENCE.md
- أضف الحقول المشتركة
- أضف العلاقات
- حدّث الـ Table Inventory

### GAPS-TRACKER.md
- أضف ثغرات جديدة برقم GAP-XXX
- تبع نفس الصيغة

## Verification Checklist
- [ ] كل الأقسام العشرة موجودة
- [ ] كل الحقول موثقة
- [ ] الـ CHECK constraints موثقة
- [ ] الـ Test Cases ≥ 10
- [ ] الثغرات ≥ 3
- [ ] INDEX, CROSS-REFERENCE, GAPS-TRACKER محدثة
- [ ] TypeScript check يمر
- [ ] pm2 restart ناجح
- [ ] git commit

## Notes for the Executor
1. لا تخترع حقول — اقرأ الكود
2. لا تثق بالتعليقات — الكود هو الحقيقة
3. إذا وجدت تضارب → document it، don't fix it
4. استخدم أنواع SQL exact من migrations
5. الأمثلة واقعية (سورية)
```

---

### أمثلة على Prompts ناجحة (من التاريخ)

#### Prompt ناجح: Clients (Pilot)
- **الحجم**: 24,135 bytes
- **النتيجة**: 533 سطر، 12 TC، 5 ثغرات
- **السر**: حدد 17 migration + 5 ملفات كود + طلب explicit لـ field dictionary + test cases + gaps

#### Prompt ناجح: Open Tasks
- **الحجم**: 22,557 bytes
- **النتيجة**: 366 سطر، 8 TC، 5 ثغرات
- **السر**: حدد 30 migration + طلب focus على status/phase system + permission naming mismatch

#### Prompt ناجح: Permissions
- **الحجم**: 20,926 bytes
- **النتيجة**: 338 سطر، 12 TC، 9 ثغرات
- **السر**: طلب root cause analysis لـ 4 ثغرات موجودة + allowed_scopes table

### أخطاء Prompts (دروس مستفادة)

| الخطأ | التأثير | الحل |
|-------|---------|------|
| ما حدّدتش الملفات | المنفذ قرا غلط أو نسى migrations | دايماً اعطِ قائمة كاملة |
| ما طلبتش schemas | JSDoc فاضي — بس tags وpaths | اطلب explicit: requestBody, response schema |
| ما طلبتش test cases | منفذ نسى أو كتب 2-3 بس | اطلب "≥ 10 test cases" |
| ما طلبتش gaps | منفذ مرّر تضاربات | اطلب "≥ 5 gaps" + أمثلة |

---

## 4. كيفية توثيق حل Gap (Gap Fix Documentation)

### قواعد توثيق حل الثغرات

#### 1. في GAPS-TRACKER.md

```markdown
### GAP-XXX: [عنوان الثغرة]

| البند | التفصيل |
|---|---|
| **الحالة** | ✅ محلول (تم الحل بـ commit [hash]) |
| **تاريخ الحل** | 2026-05-24 |
| **الـ Commit** | `abc1234` |
| **الحل** | وصف التعديل |
| **الملفات المتأثرة** | migration_X.sql, routes/entity.ts |
| **التحقق** | `pnpm tsc` ✓, `pm2 restart` ✓ |
```

#### 2. في دستور الكيان المعني

أضف قسم فرعي:
```markdown
### 9.X حل الثغرة [GAP-XXX]

تم الحل بتاريخ 2026-05-24:
- التعديل: [وصف]
- الـ Migration: [رقم]
- حالة الـ DB بعد الحل: [وصف]
```

#### 3. في CROSS-REFERENCE.md

حدّث إذا تغيّر شيء:
- حقول جديدة
- علاقات جديدة
- constraints جديدة

---

## 5. كيفية إضافة Feature جديدة (New Feature Documentation)

### القواعد

#### القاعدة 1: التعريف قبل التنفيذ

```
أي Feature جديدة لازم تعريفها بالـ Vault أولاً:
- اسم الـ Feature
- الكيانات المتأثرة
- الحقول الجديدة
- الحالات (states)
- العلاقات
- من بيستخدمها
```

#### القاعدة 2: تحديث الدستور أولاً

```
قبل ما يُكتب سطر كود:
1. حدّد أي كيانات بتتأثر
2. حدّث دساتيرها
3. أضف الـ Feature للـ INDEX
4. وثق الثغرات المحتملة
5. كتب الـ Prompt للتنفيذ
```

#### القاعدة 3: Template Feature Documentation

```markdown
## Feature: [اسم الميزة]

### التعريف
[وصف الميزة وشو بتعمل]

### الكيانات المتأثرة
- [كيان 1]: [التأثير]
- [كيان 2]: [التأثير]

### الحقول الجديدة
| الكيان | الحقل | النوع | NULL? | وصف |
|---|---|---|---|---|
| [جدول] | [حقل] | [نوع] | [yes/no] | [وصف] |

### الحالات (States)
```
[حالة 1] → [حالة 2] → [حالة 3]
```

### العلاقات
```
[كيان A] → [كيان B]
```

### من بيستخدمها
- [دور 1]: [الاستخدام]
- [دور 2]: [الاستخدام]

### الثغرات المحتملة
- [ثغرة 1]: [وصف]
- [ثغرة 2]: [وصف]
```

---

## 6. الكيانات الناقصة (Remaining Entities — 62/72)

### قائمة الكيانات اللي لساتها بدها دستور

| الأولوية | الكيان | # Endpoints | # Migrations | السبب |
|----------|--------|-------------|--------------|-------|
| 🔴 عالية | الطوارئ (Emergency) | 13 | 8+ | مرتبط بـ field_visits + contracts |
| 🔴 عالية | الموظفين (Employees) | 5 | 6+ | Core auth + branch assignment |
| 🟡 متوسطة | التوظيف (HR) | 15+ | 10+ | vacancies, applications, interviews |
| 🟡 متوسطة | الجداول الزمنية (Schedules) | 3 | 5+ | day_schedules, team planning |
| 🟡 متوسطة | الأقسام (Departments) | 5 | 3+ | org structure |
| 🟢 منخفضة | المسارات (Routes) | 5 | 3+ | geo routing |
| 🟢 منخفضة | سجل التدقيق (Audit Logs) | 2 | 2+ | logging |
| 🟢 منخفضة | القوائم النظامية (System Lists) | 5 | 2+ | lookups |

### الكيانات اللي ما لهن جداول (Logic-only)

- Dashboard (statistics aggregation)
- Upload (file handling)
- Public Vacancies / Public Applications (public endpoints)

---

## 7. نماذج جاهزة للاستخدام (Ready-to-Use Templates)

### 7.1 نموذج: كتابة Prompt لكيان جديد

```markdown
أستاذ إبراهيم — هاد البرومت الجاهز للبعث لـ Claude/Codex:

ملف: docs/tasks/TASK_[ENTITY]_CONSTITUTION_PROMPT.md
الهدف: إنشاء دستور كامل لكيان [Entity]
الملفات المطلوب قراءتها: [X] migrations + [Y] routes + [Z] services
الناتج المتوقع: ~[N] سطر + [M] Test Cases + [K] Gaps

بعد التنفيذ:
1. git commit
2. pm2 restart golden-crm-staging
3. تحقق من Swagger UI
4. أرسل walkthrough.md
```

### 7.2 نموذج: تحديث بعد إضافة كيان

```markdown
بعد ما ينتهي المنفذ من كيان جديد:

1. ✅ تأكد من INDEX.md (صف جديد)
2. ✅ تأكد من CROSS-REFERENCE.md (حقول + علاقات)
3. ✅ تأكد من GAPS-TRACKER.md (ثغرات جديدة)
4. ✅ تأكد من git log (commit موجود)
5. ✅ تأكد من pm2 status (online)
```

### 7.3 نموذج: توثيق حل Gap

```markdown
GAP-XXX: [عنوان]
الحالة: ⏳ مفتوحة → 🔄 قيد الحل → ✅ محلولة

الخطوات:
1. اقرأ GAP من GAPS-TRACKER.md
2. حلّل root cause
3. اكتب prompt للمنفذ
4. نفّذ على staging
5. حدّث GAPS-TRACKER.md
6. حدّث دستور الكيان المعني
7. git commit
```

---

## 8. اتفاقية التسمية (Naming Conventions)

### أسماء الملفات

```
docs/constitution/domains/[entity-name].md     ← دستور الكيان
docs/constitution/features/[feature-name].md    ← ميزة (نادر)
docs/constitution/decisions/[date]-[topic].md   ← قرار معماري
docs/tasks/TASK_[ENTITY]_[ACTION]_PROMPT.md     ← prompt للمنفذ
```

### أرقام الثغرات (Gap Numbering)

```
GAP-001 → GAP-099: ثغرات كيانات (Domains)
GAP-100 → GAP-199: ثغرات ميزات (Features)
GAP-200 → GAP-299: ثغرات بنية تحتية (Infrastructure)
GAP-300 → GAP-399: ثغرات أمان (Security)
```

### لغة التوثيق

```
- عناوين السكاشن: عربي
- أسماء الحقول: إنجليزي
- الأكواد: إنجليزي
- الشرح: عربي
- الأمثلة: واقعية سورية
```

---

## 9. قائمة التحقق النهائية (Final Checklist)

قبل ما نعتبر أي كيان "مكتمل":

- [ ] **الدستور**: 10 أقسام كاملة
- [ ] **الحقول**: كل حقل موثق (نوع، NULL، DEFAULT، Constraints، وصف، مثال)
- [ ] **القيود**: CHECK constraints + FK + UNIQUE + Indexes
- [ ] **القواعد**: ≥ 5 Business Rules
- [ ] **العلاقات**: ER Diagram + جدول العلاقات
- [ ] **الحالات**: State Machine مفصل
- [ ] **الصلاحيات**: Permission Matrix + allowed_scopes
- [ ] **الـ API**: كل endpoints + query params + request/response
- [ ] **الاختبارات**: ≥ 10 Test Cases (happy + error + edge + permission)
- [ ] **الثغرات**: ≥ 3 Gaps (أو "None found" مع justification)
- [ ] **الـ INDEX**: صف جديد مضاف
- [ ] **الـ CROSS-REFERENCE**: حقول + علاقات + جداول محدثة
- [ ] **الـ GAPS-TRACKER**: ثغرات جديدة مسجلة
- [ ] **الـ TypeScript**: `pnpm --filter @golden-crm/api exec tsc --noEmit` ✓
- [ ] **الـ PM2**: `pm2 restart golden-crm-staging` ✓
- [ ] **الـ Git**: `git commit -m "docs(constitution): complete [entity] domain constitution"` ✓

---

## 10. ملاحظات للمستقبل (Future Notes)

### أولويات المرحلة القادمة

1. **إكمال الكيانات الأساسية المتبقية**: Emergency, Employees, HR
2. **حل الثغرات العالية**: GAP-001, GAP-002, GAP-006, GAP-017, GAP-020, GAP-022, GAP-027
3. **توحيد naming conventions**: `marketing_visits.*` → `field_visits.*` + `open_tasks.*`
4. **إضافة soft-delete**: لـ contracts, tasks, visits, telemarketing
5. **إصلاح allowed_scopes**: إضافة ASSIGNED للكيانات اللي بتحتاجه

### ملفات مهمة ما بننساهن

| الملف | ليه مهم؟ |
|-------|----------|
| `docs/constitution/GAPS-TRACKER.md` | هاد ملف الحياة — كل الثغرات هون |
| `docs/constitution/INDEX.md` | نقطة الدخول — أي حد بدو يفهم النظام بيبدأ من هون |
| `docs/constitution/CROSS-REFERENCE.md` | المرجع للـ debugging و refactoring |
| `docs/constitution/templates/entity-constitution.md` | القالب — أي كيان جديد بنبدأ منه |

---

> **هاد الملف هيكل الدستور. أي تعديل عليه → يُعلَم إبراهيم أولاً.**
