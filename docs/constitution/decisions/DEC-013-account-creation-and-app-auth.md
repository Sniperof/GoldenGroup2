# قرار معماري: إنشاء الحساب ومصادقة تطبيق الزبائن

> **رقم القرار:** DEC-013
> **التاريخ:** 2026-07-17
> **الحالة:** مسودة معتمدة للتنفيذ على فرع `Authenticate`
> **الأولوية:** عالية
> **الكيانات المتأثرة:** `service_requests` (نوع جديد)، `app_accounts` (جديد)، `otp_verifications` (جديد)، `clients`، نظام المصادقة (`authService`)، الأدوار والصلاحيات، سجل التدقيق
> **المرجع الثانوي:** وثيقة «Account Creation Epic»، وSwagger المشروع القديم (ABP)

---

## 1. ملخص المشكلة

تطبيق الزبائن (Mobile App) يحتاج مساراً لإنشاء حساب وتسجيل دخول، مبنياً على **ربط استخدام التطبيق بسجل زبون قائم** (`clients`) لا على حسابات مستقلة. النظام الحالي يملك مصادقة **للموظفين فقط** (`username + password + JWT`)، ولا يملك مصادقة للزبائن ولا OTP ولا حساب تطبيق.

الخطر المزدوج المطلوب تجنّبه: (أ) بناء نظام مصادقة موازٍ منفصل يتعارض مع النظام الحالي، و(ب) إعادة بناء قدرات موجودة أصلاً ضمن إطار `service_requests` (المطابقة التقريبية، كشف التكرار، التدقيق، دورة حياة الطلب).

---

## 2. القرار الجوهري

**إنشاء الحساب ليس نظاماً جديداً، بل نوع طلبٍ جديد فوق إطار `service_requests` القائم.**

يُضاف `request_type = 'account_creation'` إلى الإطار الموحّد، فيرث مباشرةً: دورة الحياة، التصعيد، كشف التكرار، المطابقة التقريبية، سجل التدقيق، والأرشفة. ولا يُبنى جديداً إلا الطبقة الرقيقة الخاصة بالمصادقة والحساب.

قاعدة القرار:

> ما هو موجود في الإطار يُعاد استخدامه، ولا يُبنى جديداً إلا: `app_accounts`، وطبقة OTP، و`CheckMobileStatus`، وتوكن الزبون، ومُوجِّه أثرٍ واحد للتفعيل.

---

## 3. دورتا الحياة والعرض المشتقّ

تُفصل ثلاثة مفاهيم لا تُخلط:

| المفهوم | يقوده | القيم |
|---|---|---|
| دورة الطلب | الأدمن | `received → in_review → {completed \| rejected}` (+ قفل تصعيد) |
| دورة الحساب | النظام بعد الموافقة | `Active ⇄ Suspended` |
| عرض الموبايل | محسوب لا مخزّن | Visitor / Pending / Logged-in / Suspended |

عرض الموبايل يُشتقّ من (حالة الحساب + وجود طلب معلّق) عبر نداء واحد `CheckMobileStatus`. الموبايل لا يرى الحالات الداخلية إطلاقاً.

---

## 4. الحالة النهائية العامة `completed`

تُعتمد حالة نجاحٍ ذاتيٍّ عامة `completed` لكل الطلبات التي تكتمل بذاتها دون مهمة ميدانية (إنشاء حساب، شكوى، ترخيص، ترشيح…)، بجانب `promoted` القائمة للطلبات التي يتلوها `open_task`.

الفصل بين ثلاث طبقات:

- **الحالة النهائية**: عامة قليلة العدد (`completed`, `promoted`, `rejected`, `cancelled`).
- **النتيجة (outcome)**: توصيف يُكتب على الطلب، من قائمة `system_lists` حسب `request_type` (نمط `resolve_at_intake` القائم). مثال لإنشاء الحساب: `linked_to_op` / `linked_to_lead` / `linked_to_fop`.
- **الأثر (side-effect)**: فِعلٌ اختياري في كيانات أخرى يُوجَّه حسب `request_type`. أثر `account_creation` = إنشاء/تفعيل `app_account`.

---

## 5. إعادة الاستخدام — لا يُعاد بناؤه

القدرات التالية مبنية فعلاً ويُمنع إعادة بنائها:

| القدرة | المصدر القائم |
|---|---|
| السجلات المقترحة (Fuzzy) | `packages/api/services/serviceRequests/fuzzyMatching.ts` (يدعم `sources:'clients'`) |
| مؤشر التكرار + التصعيد التلقائي | `packages/api/services/serviceRequests/duplicateDetection.ts` + `system_settings` |
| pg_trgm | `migrations/245_pg_trgm_for_duplicate_detection.sql` |
| تطبيع الأرقام + صحة الصيغة | `packages/api/utils/contactValidation.ts` (`normalizePhone`, `isValidSyrianMobile`) |
| واجهة السجلات المقترحة | `packages/web/src/components/service-requests/SuggestedMatchesPanel.tsx` |
| دورة الطلب + رفض بيد Audit + قفل التصعيد | `packages/api/services/serviceRequests/stateMachine.ts` |
| سجل التدقيق + الأحداث | `appendAudit` ضمن `service_requests` |

**الجديد فعلاً (النطاق الضيّق):** جدول `app_accounts`، جدول `otp_verifications`، طبقة OTP (محاكاة + منفذ)، `CheckMobileStatus`، توكن الزبون + refresh، مُوجِّه أثر `account_creation`، وربط `request_type='account_creation'` بالإطار.

---

## 6. المصادقة والتوكنز

المصادقة تعتمد OTP بلا كلمة مرور. الـ OTP **تحدٍّ قصير** لا جلسة: صلاحية الرمز 120 ثانية، إعادة إرسال بعد 60 ثانية، حد 5 محاولات، وتُخزَّن **بصمة الرمز** لا الرمز نفسه.

يُعتمد نموذج ثلاثة أعمار:

| البيان | العمر | الغرض | التمثيل |
|---|---|---|---|
| مُعرّف تحقّق قبل الحساب | 10 دقائق، لمرة واحدة | يربط التحقّق بإنشاء الطلب (الزائر بلا حساب) | **مُعرّف مبهم لسجل `otp_verifications` مُتحقَّق** (server-side)، يُستهلك مرة واحدة |
| access token | 60 دقيقة | نداءات التطبيق للزبون المسجّل | JWT |
| refresh token | 60 يوماً | يجدّد access بلا OTP | توكن دوّار مخزّن |

مبرّر اختيار المُعرّف المبهم بدل JWT قبل الحساب: إنشاء الحساب حدثٌ منخفض التكرار، فنكسب الاستهلاك لمرة واحدة والإلغاء الفوري وبصمة تسرّبٍ أدنى، ونعيد استخدام سجل الـ OTP المخزّن أصلاً. الـ JWT يبقى لجلسة ما بعد الدخول لأنها متكرّرة النداءات.

**نظام مصادقة الموظفين الحالي لا يُلمس** (يبقى JWT مفرد 7 أيام). توكن الزبون منفصل ومستقل.

---

## 7. ماذا يحدث بعد موافقة الأدمن (اعتماد الربط)

في **معاملة واحدة** ذرّية:

1. الطلب → `completed` بنتيجة `linked_to_{op|lead|fop}`.
2. فحص التفرّد أولاً: يُمنع إن كان الرقم المطبَّع مرتبطاً بحساب `Active` آخر.
3. مُوجِّه الأثر يُنشئ/يُفعّل `app_account` بحالة `Active`، والرقم المطبَّع (`normalizePhone`) معرّف الدخول.
4. ربط `beneficiary_client_id` على الطلب و`linked_client_record_id` على الحساب.
5. `created_source = 'account_creation'` (أو `'admin'` للمباشر الفردي، `'admin_bulk'` للتفعيل الجماعي).
6. أحداث التدقيق: `account_created`, `account_linked`, `status_changed`, `created_source_set`.
7. لا يُدفع للموبايل أي إشعار؛ نداء `CheckMobileStatus` التالي يعيد `Active` فيُتاح الدخول بـ OTP.

---

## 8. الأدوار والصلاحيات

يُعاد استخدام نظام الأدوار/الصلاحيات القائم، ويُفصل الدوران كما في الوثيقة:

| الإجراء | أدمن التشغيل | مشرف تدقيق الحسابات |
|---|---|---|
| مراجعة + مقارنة | ✅ | ✅ |
| اعتماد الربط | ✅ | ✅ |
| تصعيد يدوي | ✅ | — |
| رفض الطلب | ❌ | ✅ حصراً |
| إيقاف الحساب / إعادة تفعيله | ❌ | ✅ حصراً |
| إنشاء مباشر فردي من سجل الزبون | ❌ | ✅ حصراً |
| تفعيل جماعي (دفعة) | ❌ | ✅ حصراً |

---

## 9. قواعد ثابتة

1. **هدف الربط سجل `clients` فقط** (Lead/FOP/OP)؛ كيان `candidates` المنفصل مستبعَد من الربط.
2. **مفتاح التفرّد** هو الرقم بعد `normalizePhone`؛ حساب `Active` واحد لكل رقم مطبَّع.
3. **إرسال الطلبات لا يتأثر بحالة المستخدم**: الزائر يستطيع إرسال أي نوع طلب؛ البوابة الوحيدة هي التحقّق من الرقم (OTP)، لا حالة الحساب. الطلب غير المرتبط يُخزَّن ببيانات مُرسِلٍ خارجية (`requester_external`) ويُنسب لاحقاً عند الربط.
4. **من ينتظر الموافقة يبقى زائراً** هويةً وصلاحيةً؛ الطلب المعلّق سجلٌّ مربوط بالرقم لا هوية، ويُخفى زر إنشاء الحساب ويُعرض «قيد المراجعة» فقط.
5. **كل ما يُضاف إضافي**: نوع طلب + حالة نهائية جديدان دون لمس مسارات الطوارئ/المياه.
6. **حذف الحساب (متجر غوغل)**: إلزامي عبر مسارين (داخل التطبيق + ويب عام) بتحقّق OTP. يُحذف الوصول (`app_account` soft-delete + إبطال التوكنات + مسح بيانات المصادقة) **لا سجل الزبون `clients`** الذي يُحتفظ به بإفصاح (التزامات قانونية/تجارية). التفاصيل في التوصيف §8.
7. **التفعيل الجماعي (د٢)**: لمشرف التدقيق حصراً، بمدخلين (مجموعة مفلترة بالنطاق أو قائمة معرّفات)، بمبدأ **نجاح جزئي + تقرير** (يتخطّى التعارض والرقم غير الصالح). آمنٌ لأن لا وصول يُمنح دون اجتياز OTP عند أول دخول.
8. **تمييز مصدر الحساب**: `created_source` (تلقائي، غير قابل للتعديل) هو المصدر الوحيد للتفريق بين الحساب المُنشأ بطلب الزبون (`account_creation` وما شابه) والمُنشأ عبر الأدمن (`admin`/`admin_bulk`). لا يُضاف حقلٌ ثنائي مكرّر.
9. **صلاحيات مستقلة**: مفاتيح `account_requests.*` و`app_accounts.*` **منفصلة تماماً** عن `service_requests.*` (نطاق `GLOBAL`، بناء فقط والمنح يدوي، §4.1). التفاصيل في التوصيف §2.1.
10. **جاهزية الإشعارات (خُطّافان فقط، القرار مستقل لاحقاً)**: نحجز نقطة تسجيل رمز دفع الجهاز مرتبطاً بالحساب، ونطلق أحداث نطاق (`account_activated`, `account_suspended`, `account_reactivated`, `account_deleted`) — دون بناء أي منظومة إشعارات (لا توجد خدمة إشعارات في النظام حالياً).

---

## 10. خارج النطاق

- تفعيل الحساب عبر رمز تفعيل مستقل، وتسجيل الدخول بكلمة مرور.
- تعديل رقم الموبايل الرئيسي بعد الإنشاء.
- تعديل بيانات سجل الزبون من داخل هذه الميزة.
- مزوّد SMS حقيقي في هذه المرحلة (محاكاة مع منفذ قابل للتبديل بمتغيّر بيئة).
- تتبّع حالة الطلب داخل الموبايل عدا عرض «قيد المراجعة».
- تغيير مصادقة الموظفين القائمة.

---

## 11. أثر التنفيذ اللاحق (مراحل)

1. **الأساس** ✅ (migr `365`/`366` — مطبَّقة على dev): جداول `app_accounts` و`otp_verifications` و`app_refresh_tokens` + مفاتيح الصلاحيات المستقلة (`account_requests.*` / `app_accounts.*`). مؤجَّل بوعيٍ: الحالة `completed` (للمرحلة ٣ مع آلة الحالة)، وانحراف registry (شأن منفصل لا يخصّ هذه الميزة).
2. **طبقة OTP** ✅ (منفذ `OtpSender` محاكاةً + `services/otp` + `routes/appOtp.ts` على `/api/app/otp/{send,verify}` + مُعرّف تحقّق مبهم + توثيق Swagger «App - Auth»). القواعد مفعّلة: TTL 120ث، إعادة إرسال 60ث، ٥ محاولات، بصمة الرمز فقط.
3. **مسار الطلب (Public)** ✅ (migr `367` يسجّل نوع `account_creation` في `service_request_type_config` + `services/appAccounts/accountRequestService.ts` + `routes/appAccount.ts` على `GET /api/app/account/status` و`POST /api/app/account-requests`). يستهلك الـ handle، ويفرض تفرّد الرقم وقاعدة الطلب المعلّق، ويحفظ `received` بتدقيق `request_created`. Swagger «App - Account».
4. **لوحة التحكم — API القرارات** ✅ (migr `368` يضيف الحالة `completed` + `routes/adminAccountRequests.ts` على `/api/admin/account-requests`: list/details/suggestions/link/escalate/reject، بصلاحيات `account_requests.*` + Swagger «Admin - Account Requests»). الربط يفعّل `app_account` ويضبط `completed` (أثر §7)، ويعيد استخدام `fuzzyMatching`. **متبقٍّ:** واجهة React (القائمة/التفاصيل/المقارنة) تستهلك هذا الـ API.
5. **الإنشاء المباشر والجماعي** ✅ (`services/appAccounts/adminAppAccountService.ts` + `routes/adminAppAccounts.ts`): `POST /api/admin/clients/:id/app-account` (`created_source='admin'`) و`POST /api/admin/app-accounts/bulk-activate` (filter|ids، **نجاح جزئي + تقرير**، `created_source='admin_bulk'`)، بصلاحيتَي `app_accounts.create_direct`/`bulk_activate`، وتدقيق في `audit_logs` العام، + Swagger «Admin - App Accounts».
6. **الدخول ودورة الحساب** ✅ (النواة): `services/appAccounts/appAuthService.ts` (توكن `access` JWT + `refresh` دوّار مع كشف السرقة وتمييزها عن الخروج via `replaced_by_id`)، `middleware/appAuth.ts` (إنفاذ `status` على كل نداء)، `routes/appAuth.ts` (`/api/app/auth/{login,refresh,logout}` + `/api/app/session`)، والإيقاف/إعادة التفعيل (`/api/admin/app-accounts/:id/{suspend,reactivate}`، الإيقاف يُبطل كل التوكنات).
7. **حذف الحساب (م٦ب)** ✅ (`services/appAccounts/accountDeletionService.ts` + `routes/publicAccountDeletion.ts`): `POST /api/app/account/delete` (داخل التطبيق، `requireAppAuth` + تحقّق OTP) و`POST /api/app/account/deletion-request` (ويب عام) — soft-delete للوصول فقط + إبطال التوكنات + تدقيق، وسجل الزبون يبقى؛ وصفحة ويب عامة على `/account-deletion`. **اكتمل backend الـ auth بالكامل.**

التوصيف التفصيلي وكتالوج الـ API في: `docs/constitution/features/account-creation-and-app-auth.md`.
