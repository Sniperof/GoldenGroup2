# توصيف: إنشاء الحساب ومصادقة تطبيق الزبائن

> **الحالة:** مسودة توصيف — فرع `Authenticate` · **backend الـ auth مكتمل** · **واجهة الأدمن مكتملة**: قسم الطلبات (قائمة/تفاصيل/قرارات) + إدارة الحسابات (بطاقة الحساب في تفاصيل الزبون: تفعيل مباشر/إيقاف/تفعيل + تفعيل جماعي من جدول الزبائن) · متبقٍّ: سياسة duplicate_flag + مزوّد SMS حقيقي
> **القرار الحاكم:** `DEC-013-account-creation-and-app-auth`
> **المرجع الثانوي:** وثيقة «Account Creation Epic» + Swagger القديم (ABP)
> **الجمهور:** فريق الـ Backend + **مطوّر تطبيق الموبايل** (كتالوج الـ API القسم 5)

---

## 1. المبدأ

استخدام التطبيق مرتبطٌ بسجل زبون قائم (`clients`). لا حسابات مستقلة. إنشاء الحساب = نوع طلبٍ `account_creation` فوق إطار `service_requests`، ومصادقةٌ بـ OTP بلا كلمة مرور.

## 2. الأدوار

| الدور | الوصف |
|---|---|
| Visitor | مستخدم تطبيق بلا حساب مفعّل ولا ارتباط. يستطيع إرسال أي طلب بعد تحقّق OTP. |
| زبون مفعّل | `app_account` مرتبط بـ `clients`، تصنيفه (Lead/FOP/OP) مشتقّ من السجل. |
| Admin Operator | مراجعة، مقارنة، اعتماد ربط، تصعيد يدوي. |
| Account Audit Admin | رفض، إيقاف، إعادة تفعيل، إنشاء مباشر. |

الموظف ليس مستخدم تطبيق إطلاقاً — لوحة التحكم فقط.

### 2.1 الصلاحيات المستقلة

صلاحيات هذه الميزة **مستقلة تماماً** عن `service_requests.*` (لا تُشتقّ منها ولا تشاركها)، لتُمنح مراجعة طلبات إنشاء الحساب وتفعيل الحسابات بمعزلٍ عن طلبات المياه/الطوارئ. تتبع الاصطلاح القائم: نطاق `GLOBAL`، بناء المفاتيح فقط (المنح يدوي عبر واجهة الأدوار)، وفصل القرارات الأمنية المختلفة (§4.1).

**module `account_requests`** (مسار الطلب)

| المفتاح | الوصف | الدور |
|---|---|---|
| `account_requests.view` | عرض الطلبات (قائمة + تفاصيل) | Operator+ |
| `account_requests.link` | اعتماد الربط وتفعيل الحساب | Operator+ |
| `account_requests.escalate` | تصعيد يدوي | Operator |
| `account_requests.reject` | رفض الطلب | مدقّق فقط |
| `account_requests.resolve_escalation` | فكّ التصعيد | مدقّق فقط |
| `account_requests.archive` | أرشفة | Operator+ |

**module `app_accounts`** (دورة حياة الحساب)

| المفتاح | الوصف | الدور |
|---|---|---|
| `app_accounts.view` | عرض حسابات التطبيق | Operator+ |
| `app_accounts.create_direct` | إنشاء مباشر فردي | مدقّق فقط |
| `app_accounts.bulk_activate` | تفعيل جماعي | مدقّق فقط |
| `app_accounts.suspend` | إيقاف حساب | مدقّق فقط |
| `app_accounts.reactivate` | إعادة تفعيل | مدقّق فقط |

تُبنى المفاتيح في migration مستقل (BUILD only) في مرحلة التنفيذ؛ يبقى القسم لِمن مُنح فقط.

## 3. نماذج البيانات الجديدة

### 3.1 `app_accounts`

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | BIGSERIAL | — |
| `primary_mobile` | VARCHAR | مطبَّع بـ `normalizePhone`، معرّف الدخول، فريد عند `Active` |
| `status` | VARCHAR | `active` / `suspended` |
| `linked_client_record_id` | INT | FK → `clients(id)`، إلزامي |
| `created_source` | VARCHAR | **تلقائي وغير قابل للتعديل**. `account_creation` (بطلب الزبون) / `water_test_request` / `device_request` / `maintenance_request` / `referral_request` / `golden_warranty_request` (ضمنياً من طلب خدمة) / `admin` (مباشر فردي) / `admin_bulk` (تفعيل جماعي) |
| `created_by_role` | VARCHAR | `system` / `admin` |
| `suspended_by_user_id`, `suspended_reason`, `suspended_at` | — | للإيقاف |
| `deleted_at`, `deletion_source`, `deletion_reason` | — | حذف منطقي (سياسة غوغل) — لا يمسّ `clients` |
| `created_at`, `updated_at` | TIMESTAMPTZ | — |

قيد التفرّد: فهرس فريد جزئي على `primary_mobile` حيث `status = 'active'`.

**تمييز مصدر الحساب**: `created_source` هو المصدر الوحيد للحقيقة للتفريق بين الحساب المُنشأ **بطلب الزبون** والمُنشأ **عبر الأدمن** — لا يُضاف حقلٌ ثنائي مكرّر. القاعدة المشتقّة: أدمن إذا كانت القيمة `admin`/`admin_bulk`، وإلا فبطلب الزبون. يُعرض شارةً في لوحة التحكم، ولا يُعدَّل يدوياً إطلاقاً.

### 3.2 `otp_verifications`

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | BIGSERIAL | — |
| `handle` | UUID | المُعرّف المبهم الذي يُعاد للعميل |
| `phone` | VARCHAR | مطبَّع |
| `purpose` | VARCHAR | `account_creation` / `login` |
| `code_hash` | VARCHAR | بصمة الرمز لا الرمز |
| `expires_at` | TIMESTAMPTZ | +120 ثانية |
| `attempts` | INT | حد 5 |
| `verified_at` | TIMESTAMPTZ | يُضبط عند نجاح التحقّق |
| `consumed_at` | TIMESTAMPTZ | يُضبط عند استهلاك المُعرّف في `Create`/الدخول |
| `created_at` | TIMESTAMPTZ | — |

### 3.3 `app_refresh_tokens`

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | BIGSERIAL | — |
| `app_account_id` | INT | FK → `app_accounts(id)` |
| `token_hash` | VARCHAR | بصمة الـ refresh لا قيمته |
| `family_id` | UUID | سلسلة الدوران — للكشف عن السرقة |
| `issued_at`, `expires_at` | TIMESTAMPTZ | +60 يوماً |
| `revoked_at`, `replaced_by_id` | — | الدوران/الإبطال |
| `device_label` | VARCHAR | اختياري |

قواعد: كل `refresh` يُصدر صفاً جديداً بنفس `family_id` ويُبطل السابق (`revoked_at` + `replaced_by_id`). إعادة استخدام صفٍّ مُبطَل → إبطال كامل العائلة (سرقة). الإيقاف يُبطل كل صفوف الحساب.

### 3.4 توسعة `service_requests`

`request_type='account_creation'`، حالة نهائية `completed`، ونتائج `linked_to_{op|lead|fop}` في `system_lists`. بيانات النموذج تُخزَّن في `submittedPayload`، وبيانات المُرسِل غير المرتبط في `requester_external`.

## 4. دورة الحياة (مرجع DEC-013 §3)

- **الطلب**: `received → in_review → {completed | rejected}` + قفل تصعيد. الرفض بيد Audit Admin حصراً.
- **الحساب**: `active ⇄ suspended`.
- **عرض الموبايل** (محسوب عبر `CheckMobileStatus`): Visitor / Pending / Logged-in / Suspended.

## 5. كتالوج الـ API

> تُعاد تسمية عمليات Swagger القديمة (ABP `/api/services/app/...`) إلى REST باصطلاح المشروع. المصادقة: مُعرّف تحقّق قبل الحساب، ثم Bearer JWT بعد الدخول.

### 5.1 واجهة التطبيق (Mobile — لمطوّر الموبايل)

| العملية | المسار | من | الوصف |
|---|---|---|---|
| حالة الرقم (قبل الدخول) | `GET /api/app/account/status?phone=` | Visitor | يعيد العرض المحسوب بمفتاح الرقم: `visitor` / `pending` / `active` / `suspended`. يحدّد شاشة الزائر. |
| تمهيد الجلسة (عند الفتح) | `GET /api/app/session` | زبون (بتوكن) | يوازي `GET /api/auth/session`. يتحقّق من التوكن **ويعيد قراءة `app_accounts.status`** فيلتقط الإيقاف، ويعيد الوضع + لقطة الملف. `401` → يستخدم الموبايل `refresh`. |
| ملف الزبون | `GET /api/app/me` | زبون (بتوكن) | ملف مُقلَّل البيانات من سجل الزبون المرتبط (اسم/أرقام/عنوان مُحلّ الأسماء/تصنيف/حالة الحساب). الحقول الداخلية لا تُعرَض. |
| إرسال رمز | `POST /api/app/otp/send` | Visitor | `{ phone, purpose }` → توليد رمز + محاكاة الإرسال. صلاحية 120ث. |
| التحقّق | `POST /api/app/otp/verify` | Visitor | `{ phone, code, purpose }` → عند النجاح: `account_creation` يعيد `verificationHandle`؛ `login` يعيد `access + refresh`. |
| إنشاء طلب حساب | `POST /api/app/account-requests` | Visitor | `{ form, verificationHandle }` → يحفظ الطلب `Pending` ويستهلك المُعرّف. |
| إرسال أي طلب خدمة | `POST /api/app/service-requests` | Visitor/زبون | أي نوع طلب؛ يتطلب تحقّق OTP لا حساباً. |
| تجديد التوكن | `POST /api/app/auth/refresh` | زبون | `{ refreshToken }` → access جديد + **refresh جديد (دوران)** ويُبطل القديم. يفحص الحالة (`suspended` → رفض). |
| تسجيل الخروج | `POST /api/app/auth/logout` | زبون | يُبطل الـ refresh الحالي (والعائلة). الموبايل يمسح التوكنين. |
| حذف الحساب (داخل التطبيق) | `POST /api/app/account/delete` | زبون | تحقّق OTP → soft-delete فوري + تسجيل خروج. راجع §8. |
| طلب حذف (ويب عام) | `POST /api/app/account/deletion-request` | عام | مسار الويب: رقم + تحقّق OTP → حذف. لا يشترط تثبيتاً أو دخولاً. |
| تسجيل رمز الجهاز | `POST /api/app/devices/push-token` | زبون | خُطّاف محجوز لمنظومة الإشعارات المستقبلية (لا إرسال الآن). |

### 5.2 واجهة لوحة التحكم (Admin)

| العملية | المسار | من | الوصف |
|---|---|---|---|
| قائمة الطلبات | `GET /api/admin/account-requests` | Operator+ | إعادة استخدام قائمة `service_requests` مفلترة بالنوع. |
| تفاصيل الطلب | `GET /api/admin/account-requests/:id` | Operator+ | بيانات الطلب + التدقيق. |
| السجلات المقترحة | `GET /api/admin/account-requests/:id/suggestions` | Operator+ | إعادة استخدام `fuzzyMatching` (`sources:'clients'`). |
| اعتماد الربط | `POST /api/admin/account-requests/:id/link` | Operator+ | `completed` + تفعيل الحساب (§7 من القرار). |
| تصعيد يدوي | `POST /api/admin/account-requests/:id/escalate` | Operator | قفل تصعيد. |
| رفض | `POST /api/admin/account-requests/:id/reject` | Audit Admin | `{ reasonCode }` → `rejected`. |
| أرشفة | `POST /api/admin/account-requests/:id/archive` | Operator+ | إعادة استخدام. |
| إنشاء مباشر | `POST /api/admin/clients/:id/app-account` | Audit Admin | حساب `Active` بلا طلب (فحص تفرّد). `created_source='admin'`. |
| تفعيل جماعي | `POST /api/admin/app-accounts/bulk-activate` | Audit Admin | `{ mode:'filter'\|'ids', filter?, clientIds? }` → نجاح جزئي + تقرير (أُنشئ/تعارض/رقم غير صالح). `created_source='admin_bulk'`. دفعات كبيرة في الخلفية. |
| إيقاف | `POST /api/admin/app-accounts/:id/suspend` | Audit Admin | `{ reason }`. |
| إعادة تفعيل | `POST /api/admin/app-accounts/:id/reactivate` | Audit Admin | يعيد `Active` (فحص تفرّد). |

## 6. قواعد الـ OTP والمحاكاة

- بصمة الرمز تُخزَّن لا الرمز؛ صلاحية 120ث؛ إعادة إرسال بعد 60ث؛ حد 5 محاولات ثم حظر مؤقت.
- **المحاكاة (dev)**: `SimulatedOtpSender` يعيد الرمز ضمن ردّ `send` (محكوم بمتغيّر بيئة `OTP_PROVIDER=simulated`)، فيُختبر المسار كاملاً بلا هاتف.
- **الإنتاج لاحقاً**: `SmsOtpSender` يُبدَّل بـ `OTP_PROVIDER=sms` دون تغيير أي عقد API. القواعد (التخزين، الصلاحية، المحاولات، المُعرّف) لا تتغيّر.

## 7. التوكنز وإنفاذ الحالة (مرجع DEC-013 §6)

مُعرّف تحقّق: 10 دقائق، لمرة واحدة. `access`: 60 دقيقة (JWT). `refresh`: 60 يوماً (دوّار). مصادقة الموظفين لا تُلمس.

**إنفاذ الإيقاف**: بما أن الـ access token بلا حالة، لا يكفي فحص الحالة عند الفتح. يجب أن يفحص **middleware توكن الزبون `app_accounts.status` على كل نداء مصادَق** (مع cache قصير)، وإلا بقي الحساب الموقوف قادراً على النداء حتى ينتهي عمر الـ access (≤60 دقيقة). `GET /api/app/session` عند الفتح لتحديث الواجهة؛ والـ middleware للإنفاذ الفعلي.

**اصطلاح الأكواد (لمطوّر الموبايل)**: `401` = مصادقة/انتهاء → استخدم `refresh` بصمت؛ `403 suspended` = الحساب موقوف → اسقط لوضع زائر. لا يُخلط بينهما.

**لحظة الإيقاف**: الـ access القائم يتوقّف فوراً (الـ middleware يرى `suspended`)، والـ `refresh` يُرفض، وتُبطل كل refresh tokens للحساب. **إعادة التفعيل لا تُعيد الجلسات** — دخول جديد بـ OTP.

## 8. حذف الحساب وسياسة الاحتفاظ بالبيانات (متجر غوغل)

متطلّب Google Play: كل تطبيق يتيح إنشاء حساب يجب أن يتيح **حذفه** عبر مسار داخل التطبيق **ومسار ويب عام** قابل للاكتشاف (لا يشترط إعادة تثبيت أو تسجيل دخول)، مع الإفصاح عمّا يُحتفظ به.

**المبدأ**: يُحذف **الوصول (`app_account`)** لا **سجل الزبون (`clients`)**. سجل الزبون يحمل علاقةً تجارية حقيقية (عقود، أجهزة، سجل مالي) تخضع لالتزامات قانونية/محاسبية، فيُحتفظ به بإفصاح — وهو مسموح ضمن السياسة.

| يُحذف أو يُبطل | يُحتفظ به (إفصاح قانوني/تجاري) |
|---|---|
| `app_account` (soft-delete: `deleted_at`) | `clients` (السجل التجاري) |
| كل `app_refresh_tokens` | العقود والأجهزة |
| `otp_verifications` للرقم | السجل المالي وتاريخ الخدمة |
| ارتباط الدخول (الرقم كمعرّف) | الرقم كبيانات تواصل ضمن سجل الزبون |

**التحقّق**: يُشترط تحقّق OTP قبل الحذف (داخل التطبيق أو الويب) منعاً لحذف حساب الغير.
**التنفيذ**: تحقّق → soft-delete فوري لـ `app_account` + إبطال كل التوكنات + مسح بيانات المصادقة. المسار الداخلي فوري ذاتي الخدمة؛ مسار الويب يُنفَّذ فور تحقّق الرقم. كلاهما مدقَّق (`account_deletion_requested`, `account_deleted`).
**بعد الحذف**: يمكن التسجيل من جديد لاحقاً (سجل الزبون باقٍ → `account_creation` جديد). الجلسات القديمة لا تعود.

## 9. معايير القبول (مختصر)

- لا يُحفظ طلب دون تحقّق OTP صالح ضمن نفس المُعرّف.
- طلب معلّق واحد لكل رقم مطبَّع؛ محاولة ثانية تعرض «قيد المراجعة».
- الربط يُنشئ/يفعّل حساباً واحداً مرتبطاً بسجل `clients` واحد، ويضبط `created_source` تلقائياً.
- الرفض والإيقاف وإعادة التفعيل والإنشاء المباشر: من Audit Admin حصراً، وكلها مدقَّقة.
- رقم مرتبط بحساب `Active` آخر يمنع الربط والإنشاء المباشر.
- الزائر يرسل أي طلب خدمة بعد OTP دون حساب.

## 10. خارج النطاق

كما في `DEC-013 §10`.
