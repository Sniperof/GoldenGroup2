# مكون مشترك: لقطة بيانات المرشح (CandidateSnapshot)

> **النوع:** Shared UI Component  
> **الحالة:** Draft — بانتظار موافقة Product Owner  
> **الهدف:** توحيد عرض بيانات المرشح على 3 مستويات بكل مشروع Golden CRM  
> **القاعدة:** المرشح هو نفسه — الشكل بس هو يلي بيتغيّر حسب السياق  
> **الفرق عن ClientSnapshot:** المرشح ما عندو `gender` (ما في avatar بلون) — بدالو `status` badge + معلومات الإحالة

---

## المستوى الأول: Mini Snapshot (للقوائم والجداول)

### التعريف

لقطة مصغّرة بتظهر بقوائم المرشحين. الهدف: موظف التسويق أو المشرف يعرف **مين المرشح**، **حالتو**، **من وين جاء**، وبينقر عليه للتفاصيل.

**القاعدة الأساسية:**
- العنوان = `address_text` مباشرة (أو `geo_unit.name` إذا `address_text` فاضي)
- الحالة (`status`) **دايماً** تظهر — هاد أهم معلومة عن المرشح
- Western numerals فقط

---

### الحقول (DB → UI)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | كيف بنعرض؟ |
|---|---|---|---|---|---|
| الاسم الكامل | `fullName` | `candidates.first_name` + `candidates.last_name` | `VARCHAR` | ✅ | سطر واحد bold |
| الحالة | `status` | `candidates.status` | `VARCHAR(50)` | ✅ | **badge — أولوية قصوى** |
| رقم الموبايل الرئيسي | `primaryMobile` | `candidates.mobile` | `VARCHAR(50)` | ❌ | Western numerals فقط |
| العنوان المختصر | `addressShort` | `candidates.address_text` أو `geo_units.name` | `TEXT` / `VARCHAR` | ✅ | سطر واحد |
| المصدر | `referralSource` | `candidates.referral_type` + `referral_name_snapshot` | `VARCHAR` | ✅ | "من: اسم المحيل" |
| المسؤول | `ownershipDisplay` | `candidate_assignments` JOIN `hr_users` | — | ✅ | اسم أول مسؤول + "+N" |

---

### الحالة (`status`) — Badge Colors

| الحالة | اللون | المعنى |
|--------|-------|--------|
| `Suggested` | 🔵 أزرق فاتح | مقترح/ميداني — جديد |
| `New` | ⚪ رمادي | يدوي — جديد |
| `Contacted` | 🟡 أصفر | تم الاتصال |
| `FollowUp` | 🟠 برتقالي | بمتابعة |
| `Qualified` | 🟢 أخضر | مؤهل للشراء |
| `Junk` | 🔴 أحمر | مستبعد/غير جدي |

**القاعدة:** الـ badge **دايماً** ظاهر — حتى لو الاسم فاضي.

---

### المصدر (`referralSource`)

| `referral_type` | العرض |
|-----------------|-------|
| `Client` | "عميل: [referral_name_snapshot]" |
| `Employee` | "موظف: [referral_name_snapshot]" |
| `Personal` | "شخصي: [referral_name_snapshot]" |
| `null` | ما بنعرض السطر |

---

### 🎨 مثال واضح (Visual Example)

**البيانات من الـ DB:**
```json
{
  "first_name": "سمير",
  "last_name": "الحموي",
  "mobile": "0933112233",
  "address_text": "حمص، الإنشاءات، شارع البرازيل",
  "status": "Suggested",
  "referral_type": "Client",
  "referral_name_snapshot": "محمود البكري"
}
```

**كيف بيظهر بالـ UI (Mini Snapshot):**
```
┌─────────────────────────────────────────────┐
│  سمير الحموي  [مقترح]                       │  ← bold + status badge
│  0933112233  ·  حمص، الإنشاءات، شارع البرازيل│  ← grey
│  عميل: محمود البكري                         │  ← grey (referral source)
│  علي المحمد +1                              │  ← grey (ownership)
└─────────────────────────────────────────────┘
```

**إذا `status = "Qualified"`:**
```
┌─────────────────────────────────────────────┐
│  باسل عمر  [مؤهل]                           │  ← bold + أخضر badge
│  0944555666  ·  دمشق، المزة                  │
│  موظف: سامي فهد                              │
│  أحمد علي                                   │
└─────────────────────────────────────────────┘
```

**إذا `status = "Junk"`:**
```
┌─────────────────────────────────────────────┐
│  خالد فهد  [مستبعد]                         │  ← bold + أحمر badge ( strikethrough )
│  0955112233  ·  —                            │
└─────────────────────────────────────────────┘
```
> **ملاحظة:** المرشح المستبعد (`Junk`) ممكن يظهر grey-out أو strikethrough حسب السياق.

---

### 📋 السياقات يلي بيستخدم المستوى الأول

| # | السياق / الكيان | الملف بالكود | الحالة | ملاحظات |
|---|---|---|---|---|
| 1 | Candidates List (قائمة المرشحين) | `pages/Candidates.tsx` | ⏳ غير مطبّق | بترجّع `firstName` + `lastName` + `status` flat |
| 2 | Referral Sheet Detail (تفاصيل لائحة الإحالة) | `routes/fieldVisits.ts` + `routes/referralSheets.ts` | ⏳ غير مطبّق | بترجّع أسماء flat من `referral_sheets` |
| 3 | Telemarketing Lists (قوائم التسويق) | `routes/telemarketing.ts` | ⏳ غير مطبّق | بيستخدم `customer_name` flat |
| 4 | Task Assignment (توزيع مهام المرشحين) | `routes/openTasks.ts` | ⏳ غير مطبّق | `clientName` مش `candidateSnapshot` |

---

## المستوى الثاني: Standard Snapshot (لصفحة المرشح وتفاصيل الإحالة)

> **هاد "لب المرشح" — أهم مستوى. بيظهر بصفحة تفاصيل المرشح، صفحة الإحالة، وتفاصيل المهمة المرتبطة.**

### التعريف

لقطة قياسية بتظهر بالسياقات يلي بدهن **تفاصيل كاملة للمرشح** مش بس اسم وحالة. الهدف: موظف التسويق يعرف كل شي عن المرشح قبل ما يتصل فيه.

**الفرق عن المستوى الأول:**
- الاسم بيتفكّك (first + last + nickname)
- قائمة التواصل كاملة (primary + contacts JSONB)
- العنوان كامل (`address_text` أو geo hierarchy)
- معلومات الإحالة بالتفصيل (من وين جاء، ليش، امتى)
- حالة تأكيد الإحالة (`referral_confirmation_status`)
- المهنة
- ملاحظات
- تنبيه التكرار (Duplicate Warning)
- المسؤول/ين
- رابط التحويل لزبون (إذا `converted_to_lead_id` موجود)

---

### الحقول (DB → UI)

#### أ) الهوية الكاملة

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| الاسم الأول | `firstName` | `candidates.first_name` | `VARCHAR(255)` | ✅ | سطر أول bold |
| الكنية | `lastName` | `candidates.last_name` | `VARCHAR(255)` | ✅ | يلحق firstName |
| اللقب | `nickname` | `candidates.nickname` | `VARCHAR(255)` | ✅ | بين قوسين بعد الاسم |
| الحالة | `status` | `candidates.status` | `VARCHAR(50)` | ✅ | **badge جانب الاسم** — ألوان حسب الجدول فوق |

**الاسم الكامل:**
```
firstName + " " + lastName
```
إذا `nickname` موجود:
```
"سمير الحموي (أبو أحمد)"
```

**مثال بالـ UI:**
```
سمير الحموي (أبو أحمد)  [مقترح]             ← bold + status badge
```

---

#### ب) التواصل (Contacts)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| الموبايل الرئيسي | `primaryMobile` | `candidates.mobile` | `VARCHAR(50)` | ❌ | أول سطر، bold |
| قائمة التواصل | `contacts` | `candidates.contacts` | `JSONB` | ✅ | array من `ContactEntry` |

**نفس هيكل `ContactEntry` تبع ClientSnapshot:** `id`, `label`, `number`, `isPrimary`, `hasWhatsApp`, `status`

**قواعد العرض:** نفس ClientSnapshot — كل contact بسطر، Western numerals، grey-out للـ inactive.

---

#### ج) العنوان (Address)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| العنوان النصي | `addressText` | `candidates.address_text` | `TEXT` | ✅ | أولوية — إذا موجود بنعرضو |
| المنطقة الجغرافية | `geoUnit` | `geo_units.name` (FK من `candidates.geo_unit_id`) | `VARCHAR` | ✅ | fallback إذا `address_text` فاضي |

**القاعدة:**
- إذا `address_text` موجود → نعرضو كما هو
- إذا `address_text` فاضي → نعمل lookup بـ `geo_unit_id` → نعرض `geo_units.name`
- إذا الاتنين فاضيين → "—"

---

#### د) معلومات الإحالة (Referral Info)

> هاد الفرق الأكبر عن ClientSnapshot — المرشح عندو "من وين جاء"

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| نوع الإحالة | `referralType` | `candidates.referral_type` | `VARCHAR(100)` | ✅ | "عميل" / "موظف" / "شخصي" |
| اسم المحيل | `referralName` | `candidates.referral_name_snapshot` | `VARCHAR(255)` | ✅ | "من: [الاسم]" |
| معرف المحيل | `referralEntityId` | `candidates.referral_entity_id` | `INTEGER` | ✅ | رابط لـ `clients` أو `hr_users` |
| قناة الإحالة | `referralOriginChannel` | `candidates.referral_origin_channel` | `VARCHAR(100)` | ✅ | badge صغير — PhoneCall / Campaign / WhatsApp |
| سبب الإحالة | `referralReason` | `candidates.referral_reason` | `TEXT` | ✅ | expandable text |
| تاريخ الإحالة | `referralDate` | `candidates.referral_date` | `VARCHAR(50)` | ✅ | تاريخ |
| حالة التأكيد | `referralConfirmationStatus` | `candidates.referral_confirmation_status` | `VARCHAR(50)` | ✅ | badge: Pending / Confirmed / Rejected |
| رقم ورقة الإحالة | `referralSheetId` | `candidates.referral_sheet_id` | `INTEGER` | ✅ | رابط لـ `referral_sheets` |

**قواعد عرض الإحالة:**
- **إذا `referral_type = "Client"`:** أيقونة 👤 + "عميل: [اسم]" + رابط لصفحة الزبون
- **إذا `referral_type = "Employee"`:** أيقونة 🏢 + "موظف: [اسم]" + رابط لصفحة الموظف
- **إذا `referral_type = "Personal"`:** أيقونة 👥 + "شخصي: [اسم]"
- **حالة التأكيد:**
  - `Pending` → 🟡 أصفر
  - `Confirmed` → 🟢 أخضر
  - `Rejected` → 🔴 أحمر (غالباً يرافق `status = "Junk"`)

---

#### ه) المعلومات التشغيلية

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| المهنة | `occupation` | `candidates.occupation` | `VARCHAR(255)` | ✅ | **دائماً تظهر** — "غير محدد" إذا فاضي |
| ملاحظات | `candidateNotes` | `candidates.candidate_notes` | `TEXT` | ✅ | expandable section |

---

#### و) تنبيه التكرار (Duplicate Warning)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| راية التكرار | `duplicateFlag` | `candidates.duplicate_flag` | `BOOLEAN` | ✅ | ⚠️ تنبيه بارز إذا TRUE |
| نوع التكرار | `duplicateType` | `candidates.duplicate_type` | `VARCHAR(50)` | ✅ | "زبون موجود" / "مرشح مكرر" |
| رابط التكرار | `duplicateReferenceId` | `candidates.duplicate_reference_id` | `INTEGER` | ✅ | رابط للسجل المكرر |

**العرض:**
```
⚠️  تنبيه: هاد الرقم موجود بزبون آخر (رابط)
⚠️  تنبيه: مرشح مكرر — رقم #45 (رابط)
```

---

#### ز) التحويل لزبون (Conversion Link)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| محوّل لزبون | `convertedToLeadId` | `candidates.converted_to_lead_id` | `INTEGER` | ✅ | رابط لـ `clients` — "تم التحويل لزبون #123" |

**العرض:**
- إذا `convertedToLeadId` موجود → badge أخضر 🟢 "تم التحويل" + رابط لصفحة الزبون
- إذا فاضي → ما بنعرض شي

---

#### ح) المسؤول/ين (Ownership)

| الحقل بالعربي | اسم الحقل بالكود | مصدره بالـ DB | نوع الـ DB | NULL? | قاعدة العرض |
|---|---|---|---|---|---|
| المسؤول/ين | `assignments` | `candidate_assignments` JOIN `hr_users` + `roles` | — | ✅ | list من `{userId, userName, roleDisplayName}` |

**العرض:** نفس `ownershipDisplay` تبع ClientSnapshot — اسم أول مسؤول + "+N" أو "—"

---

### 🎨 مثال كامل (Standard Snapshot):

**البيانات من الـ DB:**
```json
{
  "first_name": "سمير",
  "last_name": "الحموي",
  "nickname": "أبو أحمد",
  "mobile": "0933112233",
  "contacts": [
    {"label": "عمل", "number": "0113334445", "isPrimary": false, "status": "active"}
  ],
  "address_text": "حمص، الإنشاءات، شارع البرازيل، بناية 8",
  "geo_unit_id": 45,
  "status": "Suggested",
  "referral_type": "Client",
  "referral_name_snapshot": "محمود البكري",
  "referral_entity_id": 102,
  "referral_origin_channel": "PhoneCall",
  "referral_reason": "استعلام مبيعات جهاز مياه",
  "referral_date": "2026-05-10",
  "referral_confirmation_status": "Pending",
  "referral_sheet_id": 15,
  "occupation": "تاجر أقمشة",
  "candidate_notes": "مهتم بأجهزة الفلترة الصناعية",
  "duplicate_flag": false,
  "converted_to_lead_id": null,
  "assignments": [
    {"userId": 7, "userName": "علي المحمد", "roleDisplayName": "مدير تسويق حمص"}
  ]
}
```

**كيف بيظهر بالـ UI (Standard Snapshot):**
```
┌─────────────────────────────────────────────────────────────┐
│  سمير الحموي (أبو أحمد)  [مقترح]                           │  ← bold + status badge
├─────────────────────────────────────────────────────────────┤
│  📞 0933112233                                              │  ← primaryMobile bold
│  💼 عمل: 0113334445                                          │  ← contact[0]
├─────────────────────────────────────────────────────────────┤
│  📍 حمص، الإنشاءات، شارع البرازيل، بناية 8                  │  ← addressText
├─────────────────────────────────────────────────────────────┤
│  📋 معلومات الإحالة:                                         │
│  النوع: عميل — محمود البكري (رابط #102)                     │
│  القناة: PhoneCall                                          │
│  التاريخ: 2026-05-10                                        │
│  السبب: استعلام مبيعات جهاز مياه                            │
│  التأكيد: ⏳ معلّق                                          │  ← Pending badge
│  ورقة الإحالة: #15 (رابط)                                   │
├─────────────────────────────────────────────────────────────┤
│  💼 المهنة: تاجر أقمشة                                       │  ← occupation
├─────────────────────────────────────────────────────────────┤
│  📝 ملاحظات: مهتم بأجهزة الفلترة الصناعية                    │  ← notes
├─────────────────────────────────────────────────────────────┤
│  المسؤول: علي المحمد — مدير تسويق حمص                       │  ← ownershipDisplay
│  الفرع: فرع حمص                                              │  ← branch name
└─────────────────────────────────────────────────────────────┘
```

---

### 📋 السياقات يلي بيستخدم المستوى الثاني

| # | السياق / الكيان | الملف بالكود | الحالة | ملاحظات |
|---|---|---|---|---|
| 1 | Candidate Detail Page | `pages/CandidateDetail.tsx` (غير موجود!) | ⏳ غير موجود | ما في صفحة تفاصيل مرشح — GAP-001 |
| 2 | Referral Sheet Detail | `routes/fieldVisits.ts` + Frontend | ⏳ غير موحّد | بترجّع أسماء flat |
| 3 | Task Detail (مهمة مرشح) | `routes/openTasks.ts` | ⏳ غير موحّد | `clientSnapshot` مش `candidateSnapshot` |
| 4 | Telemarketing Call Log | `routes/telemarketing.ts` | ⏳ غير موحّد | بيستخدم `customer_name` flat |

---

### ⚠️ الفجوات الحالية

| # | الفجوة | السياق المتأثر | الوضع الحالي | المطلوب |
|---|---|---|---|---|
| 1 | ما في `candidate_snapshot` JSONB بأي جدول | الكل | كل السياقات بتستخدم flat fields | نضيف `candidate_snapshot` لـ `referral_sheets` + `open_tasks` + `telemarketing` |
| 2 | `referral_name_snapshot` = نص ثابت — ما في رابط حي | `referral_sheets` | اسم قديم إذا تغيّر الزبون | نستخدم `referral_entity_id` + `referral_type` لربط حي |
| 3 | `candidate_assignments` M2M ما فيه snapshot | `candidates` | بيعرض assignments منفصلة | نضيف `assignments` لـ `candidateSnapshot` |
| 4 | Duplicate warning ما بيظهر بالـ UI | Candidates list | `duplicate_flag` موجود بس ما بيستعمل | نضيف تنبيه بارز بالـ Mini Snapshot |

---

## المستوى الثالث: Full Snapshot (للصفحات التفصيلية والتحويل)

> **ملاحظة:** رح نناقشو بعد المستوى التاني.

**الحقول الإضافية (فوق Standard):**
- `createdAt` + `createdBy` (من سجّل المرشح)
- `branchId` + `branchName`
- `convertedToLeadId` + رابط كامل للزبون (مع MiniClientSnapshot تبعه)
- تاريخ التحويل (إذا موجود)
- `referral_sheet` كامل (target_candidates, actual_count, status)
- تاريخ التغييرات (status history)
- كل التعيينات (`candidate_assignments` كاملة مع التواريخ)

**السياقات:**
- Candidate Detail Page (لما نبنيها)
- Lead Conversion Flow (تحويل مرشح → زبون)
- Referral Sheet Audit (تدقيق ورقة إحالة)

---

## ⚠️ ملاحظات تنفيذية

### 1. الفرق بين `ClientSnapshot` و `CandidateSnapshot`

| | ClientSnapshot | CandidateSnapshot |
|---|---|---|
| **Avatar** | ✅ gender + dataQuality | ❌ ما في gender — generic icon أو initials |
| **Classification** | LEAD / OP / FOP | ❌ ما في — بدالو `status` |
| **Address** | geo_units hierarchy (4 levels) | address_text أو geo_unit.name |
| **Referral Info** | ❌ ما في | ✅ نوع، اسم، قناة، تأكيد |
| **Duplicate** | ❌ ما في | ✅ flag + type + reference |
| **Conversion** | ❌ ما في | ✅ convertedToLeadId → Client |
| **Contacts** | ✅ JSONB | ✅ JSONB (نفس الهيكل) |

### 2. قاعدة ذهبية: Candidate → Client

> لما المرشح بيتحوّل لزبون (`converted_to_lead_id` موجود)، **الـ CandidateSnapshot بيصير ClientSnapshot** — مش منفصل. المرشح "يندمج" بالزبون.

### 3. Western Numerals
> كل الأرقام — mobile, contact numbers, IDs — Western numerals فقط.
