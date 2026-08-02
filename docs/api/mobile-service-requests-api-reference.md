# مرجع API — طلبات الخدمة من تطبيق الزبائن (Mobile Service Requests)

> **الحالة:** مرجع رسمي · **الإصدار:** 2.1 · **تاريخ التحديث:** 2026-08-02
> **نسخة النموذج الفعّالة:** `water_check.mobile.v2`
> **العقد الحاكم:** `docs/constitution/request-section-contract.md` + `templates/unified-service-request-template.md` §17
> **المرجع الحيّ (Swagger):** `{BASE}/api-docs` — الوسم `App - Service Requests`
> **المرجع الشقيق:** `docs/api/mobile-app-auth-api-reference.md` (المصادقة والملف الشخصي وإنشاء الحساب)

هذا المستند يصف **السلوك الحالي** لبوابة استقبال طلبات الخدمة من التطبيق.

**من أين تبدأ:** إن كنت تبني من الصفر فاقرأ القسم 5 («مصفوفة الحالات») أولاً — فيه كل سيناريو من طرفه إلى طرفه، والأقسام 1–4 مرجع تفصيلي تعود إليه. وإن كان لديك بناء عامل قبل 2026-07-31 فابدأ بالقسم 6 (سجلّ الهجرة): فيه أربعة تغييرات كاسرة للتوافق.

---

## 1. الاصطلاحات

| البند | القيمة |
|---|---|
| الرابط الأساسي `{BASE}` | `http://localhost:3000` (تطوير) — `https://<production-host>` (إنتاج) |
| بادئة المسارات | `{BASE}/api/app/service-requests` |
| الترميز | `application/json` (UTF-8) |
| المصادقة | حسب الحالة: `Authorization: Bearer <accessToken>` للزبون المسجّل، أو `handle` للزائر |

### 1.1 شكل الخطأ

كل استجابة `>= 400` تُعيد:

| الحقل | النوع | الوصف |
|---|---|---|
| `error` | `string` | على مسار الاستقبال: **رمز آلي** (مثل `invalid_form_payload`). على بقية مسارات `/api/app`: رسالة عربية جاهزة للعرض |
| `details.code` | `string` | الرمز الآلي — **افرِّع عليه، لا على نص الرسالة** |
| `details.*` | حسب الحالة | حقول سياقية (`retryAfterSeconds`, `issues`, `fields`, `limit`, `publicRefNumber` …) |

الخطأ الداخلي غير المتوقّع يعيد `500` برسالة عربية عامة ثابتة و`details.code = "internal_error"`. **النص الداخلي لا يصل التطبيق إطلاقاً** — لا تحاول تحليل نصّ الخطأ لاستنتاج السبب.

استثناء واحد مقصود: أخطاء **العنوان الإداري** (§3.3) تعيد رسالة عربية موجّهة للعرض في `error` بلا رمز آلي، لأنها تسمّي المستوى المخالف بدقّة لا يمكن اختصارها في رمز.

---

## 2. `GET /api/app/service-requests/types`

يعيد أنواع الطلبات القابلة للتنفيذ فعلاً من الموبايل (تقاطع سجلّ قاعدة البيانات مع المعالجات المركّبة في الكود). **اقرأه عند الإقلاع ولا تُضمّن الأنواع في التطبيق.**

```json
{ "items": [ {
  "requestType": "water_check",
  "labelAr": "طلب فحص المياه",
  "descriptionAr": "…",
  "formVersion": "water_check.mobile.v1",
  "formSource": "code_seeded",
  "submitterTiers": ["visitor", "customer"],
  "submissionModes": ["for_self", "for_another"]
} ] }
```

| الكود | الحالة |
|---|---|
| `200` | نجاح (قد تكون `items` فارغة إن عُطّلت الأنواع إدارياً — أخفِ زر الطلب) |
| `429` | تجاوز حدّ القراءة |
| `503` | `service_request_registry_unavailable` — أعد المحاولة لاحقاً |

---

## 3. `POST /api/app/service-requests`

بوابة الاستقبال الموحّدة لكل الحالات. **ما تُرسله يختلف جوهرياً حسب الحالة — راجع القسم 5.**

### 3.1 حقول المغلّف

| الحقل | النوع | إلزامي | ملاحظة |
|---|---|---|---|
| `requestType` | `string` | نعم | `water_check` حالياً |
| `submissionMode` | `enum` | نعم | `for_self` أو `for_another` — **حرفياً** |
| `handle` | `uuid` | للزائر فقط | من `otp/verify` بغرض `service_request`؛ لا يُخزَّن في الطلب أبداً |
| `formVersion` | `string \| null` | لا | إن أُرسل وجب أن يطابق نسخة السجلّ، وإلا `409` |

تحديد الهوية، ولا ارتداد بين الحالات:

| ما تُرسله | النتيجة |
|---|---|
| `Authorization: Bearer <accessToken>` صالح | زبون مسجّل — `submitterTier = customer` |
| لا ترويسة + `handle` صالح | زائر موثَّق — `submitterTier = visitor` |
| ترويسة `Authorization` فاسدة أو منتهية | `401` — **لا يُعامَل كزائر إطلاقاً** |
| لا ترويسة ولا `handle` | `400 service_request_verification_required` |

الـ `handle` صالح **10 دقائق من لحظة التحقق**، ويُستهلك عند نجاح الإنشاء فقط. رفض التحقق لا يحرقه — صحّح الجسم وأعد الإرسال بنفس الـ handle.

### 3.2 حقول نموذج `water_check.mobile.v1`

هذه هي **القائمة الكاملة المسموحة**؛ أي مفتاح خارجها يُرفض. عمود «إلزامي» يعتمد على الحالة — راجع القسم 5.

| الحقل | النوع | إلزامي | الحدّ |
|---|---|---|---|
| `firstName` | `string` | **حسب الحالة** | 60 حرفاً |
| `fatherName` | `string \| null` | لا | 60 حرفاً |
| `lastName` | `string` | **حسب الحالة** | 60 حرفاً |
| `phoneNumber` | `string` | **حسب الحالة** | 20 حرفاً، موبايل سوري صالح، يُطبَّع خادمياً |
| `secondaryPhone` | `string \| null` | لا | 20 حرفاً، يُتحقّق منه إن أُرسل |
| `primaryPhoneHasWhatsapp` | `boolean` | لا | يقبل `true/false/"true"/"1"` |
| `secondaryPhoneHasWhatsapp` | `boolean` | لا | كسابقه |
| `governorateId` | `integer` | **نعم دائماً** | معرّف حقيقي من `GET /api/public/areas` |
| `regionId` | `integer \| null` | لا | يجب أن يتبع `governorateId` |
| `subdistrictId` | `integer \| null` | لا | يجب أن يتبع `regionId` |
| `neighborhoodId` | `integer \| null` | لا | يجب أن يتبع `subdistrictId` |
| `detailedAddress` | `string` | **نعم دائماً** | 500 حرف |
| `mapLocation` | `{lat, lng} \| null` | لا | `lat` ‎[-90,90]‎، `lng` ‎[-180,180]‎، **بلا مفاتيح إضافية** |
| `notes` | `string \| null` | لا | 1000 حرف |
| `referrerFirstName` | `string` | **زائر في `for_another` فقط** | 60 حرفاً |
| `referrerFatherName` | `string \| null` | لا | 60 حرفاً |
| `referrerLastName` | `string` | **زائر في `for_another` فقط** | 60 حرفاً |

**الحقول الستة الأولى تصف المستفيد** — لا المُرسِل. في `for_another` هي بيانات الشخص الآخر، وفي `for_self` للزبون المسجّل **تُرفض** لأن الخادم يشتقّها (§5.2).

**حقول `referrer*` تصف المُرسِل نفسه**، ولا تُقبل إلا في حالة واحدة: **زائر** يرسل `for_another`. الزبون المسجّل يُشتقّ اسمه من سجلّه، و`for_self` لا محيل فيه أصلاً — وفي الحالتين تُرفض بـ `400 referrer_fields_not_accepted` مع `details.reason` يفرّق بين السببين (§5.2 و§5.3).

أسماء بديلة مقبولة للتوافق مع البناء القائم: `primaryPhone`/`phone` بدل `phoneNumber`، و`governorate`/`region`/`subdistrict`/`neighborhood` بدل صيغ `…Id`، و`detailed_address`، و`secondary_phone`، و`map_location`/`location`. **البناء الجديد يستعمل الأسماء الأساسية في الجدول.**

عند مخالفة النموذج يعود `400 invalid_form_payload` بتفصيل قابل للمعالجة:

```json
{ "error": "invalid_form_payload",
  "details": { "code": "invalid_form_payload",
    "issues": [{ "field": "deviceInfo", "rule": "unknown_field" }],
    "unknownFields": ["deviceInfo"],
    "formVersion": "water_check.mobile.v1" } }
```

قيم `rule`: `unknown_field` · `wrong_type` · `too_long` (مع `limit`) · `out_of_range`.

### 3.3 قواعد العنوان الإداري

المعرّفات الجغرافية تُتحقَّق منها فعلياً بأربع قواعد. المخالفة تعيد `400` برسالة عربية في `error` **اعرضها كما هي** تحت حقل العنوان:

| القاعدة | مثال المخالفة | الرسالة |
|---|---|---|
| الوحدة موجودة | `governorateId: 999999` | «المحافظة: الوحدة الجغرافية غير موجودة» |
| المستوى مطابق | معرّف محافظة في خانة `regionId` | «المنطقة: المستوى الإداري غير مطابق» |
| الابن يتبع أباه | `governorateId: 249` مع `regionId` تتبع 248 | «المنطقة لا تتبع المحافظة المحددة» |
| السلسلة متّصلة بلا فجوات | `neighborhoodId` بلا `subdistrictId` | «لا يمكن تحديد الحي دون تحديد الناحية» |

منتقٍ تتالٍ يبني كل مستوى من `parent_id` المستوى الذي فوقه يستوفي القواعد الأربع تلقائياً. الرفض يعني أن التطبيق أرسل معرّفات من مصدر آخر أو محفوظة من جلسة قديمة — **لا تُرسل معرّفات مخزَّنة محلياً بلا إعادة تحميل الشجرة**.

### 3.4 الاستجابة `201`

```json
{
  "id": 84,
  "publicRefNumber": "SR-20260731-0001",
  "requestType": "water_check",
  "status": "received",
  "duplicateFlag": false,
  "duplicateOfRequestId": null,
  "reviewRequiredFlag": false,
  "periodicAttachmentCandidate": null,
  "branchResolution": {
    "status": "resolved",
    "branchId": 2,
    "geoUnitId": 1,
    "reason": "Resolved from branch geographic coverage.",
    "candidates": [{ "branchId": 2, "branchName": "فرع دمشق" }]
  },
  "requesterAuth": "visitor_otp"
}
```

`publicRefNumber` هو ما تعرضه للزبون وتحفظه محلياً. **لا توجد اليوم نقطة نهاية لاسترجاع طلبات فحص المياه**، فالحفظ المحلي هو المرجع الوحيد.

`branchResolution.status ≠ "resolved"` **ليس فشلاً**: الطلب حُفظ ووُسم للمراجعة اليدوية. اعرض تأكيداً عادياً ولا تُظهر التفصيل للزبون.

`duplicateFlag` و`reviewRequiredFlag` إشارتان داخليتان للمراجع، **لا تعرضهما**: الطلب مقبول في الحالتين.

### 3.5 شكل العنوان المخزَّن (`service_address`)

يهمّك فقط إن كنت تقرأ `service_address` من أي رد:

```json
{ "governorate": 248, "city_or_area": 2, "sub_area": null, "neighborhood": null,
  "geo_unit_id": 2, "detailed_address": "…", "location": null,
  "labels": { "governorate": "دمشق", "city_or_area": "مرج الصافحة",
              "sub_area": null, "neighborhood": null },

  "governorateId": 248, "regionId": 2, "subdistrictId": null,
  "neighborhoodId": null, "detailedAddress": "…", "mapLocation": null }
```

المجموعة الأولى **المعتمَدة**، والثانية مفاتيح توافق قديمة تبقى مؤقتاً لقرّاء الصفوف القديمة. و`labels` أسماء الأماكن **كما كانت لحظة الإرسال** — استعملها للعرض بدل استدعاء شجرة المناطق ومطابقة المعرّفات، فهي لا تتغيّر إن أُعيدت تسمية وحدة لاحقاً.

### 3.6 جدول الأخطاء الكامل

| الكود | `details.code` | المعنى | ماذا يفعل التطبيق |
|---|---|---|---|
| `400` | `request_type_required` | `requestType` مفقود | خطأ برمجي |
| `400` | `invalid_form_payload` | مخالفة النموذج — `details.issues` | صحّح الجسم (§3.2) |
| `400` | `missing_required_fields` | حقول إلزامية فارغة — `details.fields` | أبرز الحقول في الاستمارة |
| `400` | `identity_fields_not_accepted` | زبون مسجّل أرسل حقول هوية في `for_self` — `details.fields` | احذفها من الجسم (§5.2) |
| `400` | `referrer_fields_not_accepted` | حقول `referrer*` في حالة لا تقبلها — `details.reason` | احذفها (§5.2 · §5.3) |
| `400` | `missing_referrer_name` | زائر في `for_another` بلا اسم مُرسِل — `details.fields` | أبرز حقلَي اسم المُرسِل (§5.3) |
| `400` | `invalid_phone` / `invalid_secondary_phone` | صيغة الرقم | رسالة تحقق |
| `400` | `verified_phone_does_not_match_beneficiary` | زائر في `for_self` أرسل رقماً غير الذي تحقّق منه | رسالة تحقق (§5.1) |
| `400` | بلا رمز — رسالة عربية | عنوان إداري غير صالح | اعرض `error` كما هو (§3.3) |
| `400` | `service_request_verification_required` | لا توكن ولا handle | أعد رحلة التحقق |
| `400` | `unknown_service_request_verification` | handle غير معروف | أعد رحلة التحقق |
| `400` | `service_request_phone_not_verified` | لم يُتحقّق بعد | أكمل `otp/verify` |
| `400` | `service_request_verification_expired` | مضى أكثر من 10 دقائق | أعد رحلة التحقق |
| `401` | — | توكن دخول غير صالح | جدّد التوكن أو انزل إلى وضع الزائر |
| `403` | `suspended` | الحساب موقوف | انزل إلى وضع الزائر |
| `404` | `unknown_request_type` | نوع غير موجود في السجلّ | أعد قراءة `/types` |
| `404` | `linked_client_record_not_found` | سجلّ الزبون المربوط مفقود | حالة شاذة — سجّلها |
| `409` | `request_type_inactive` | النوع مُعطَّل إدارياً | أعد قراءة `/types` |
| `409` | `service_request_verification_already_used` | handle مستهلك | أعد رحلة التحقق |
| `409` | `unsupported_form_version` | `details.expectedFormVersion` | حدّث التطبيق |
| `409` | `open_request_exists` | طلب مفتوح لنفس رقم المستفيد — `details.publicRefNumber` | اعرض الطلب القائم كمعلومة (§5.3) |
| `409` | `customer_profile_incomplete` | سجلّ الزبون بلا اسم — `details.missing` | وجّه لخدمة الزبائن (§5.2) |
| `413` | `submitted_payload_too_large` | الحمولة تجاوزت السقف | خطأ برمجي |
| `429` | `rate_limited` | حدّ معدّل الطلبات — `details.retryAfterSeconds` | تراجع تدريجي (§4.3) |
| `429` | `daily_request_quota_reached` | تجاوز السقف اليومي للهوية | رسالة «حاول غداً» |
| `501` | `request_type_not_implemented` | النوع بلا معالج | أعد قراءة `/types` |
| `503` | `request_type_configuration_mismatch` | خلل تهيئة خادمية | أعد المحاولة لاحقاً |

---

## 4. الحدود المطبَّقة

طبقتان مستقلّتان تعملان معاً: الأولى **لكل عنوان عميل** ومسار، والثانية **لكل هوية** (رقم أو حساب) محفوظة في قاعدة البيانات فلا يوسّعها إعادة التشغيل.

### 4.1 حدود العنوان

| المسار | الحدّ | النافذة | متغيّر البيئة |
|---|---|---|---|
| `POST /api/app/otp/send` | 5 | 10 دقائق | `APP_RATE_OTP_SEND` |
| `POST /api/app/otp/verify` | 20 | 10 دقائق | `APP_RATE_OTP_VERIFY` |
| `POST /api/app/service-requests` | 10 | ساعة | `APP_RATE_INTAKE` |
| بقية `POST` على `/api/app` | 30 | 10 دقائق | `APP_RATE_MUTATION` |
| كل `GET` على `/api/app` و`/api/public` | 120 | دقيقة | `APP_RATE_READ` |

### 4.2 حدود الهوية

| القاعدة | الافتراضي | الرد | متغيّر البيئة |
|---|---|---|---|
| رسائل تحقق لرقم واحد / 24 ساعة (كل الأغراض) | 10 | `429 daily_cap_reached` | `OTP_DAILY_CAP_PER_PHONE` |
| طلبات فحص مياه مفتوحة لرقم **المستفيد** | 1 | `409 open_request_exists` | `APP_WATER_CHECK_OPEN_PER_PHONE` |
| طلبات فحص مياه من هوية **المُرسِل** / 24 ساعة | 5 | `429 daily_request_quota_reached` | `APP_WATER_CHECK_DAILY_PER_REQUESTER` |
| حجم الحمولة المخزَّنة | 8000 محرف | `413` | `APP_SUBMITTED_PAYLOAD_MAX_CHARS` |

نافذة إعادة إرسال الرمز (60 ثانية) وسقف المحاولات (5) موصوفان في المرجع الشقيق.

### 4.3 قاعدة التعامل مع `429`

الرد يحمل ترويسة `Retry-After` و`details.retryAfterSeconds`. **لا تُعِد المحاولة تلقائياً قبل انقضاء المدة** — إعادة المحاولة الفورية تجدّد الحظر ولا تنجح. اعرض عدّاداً، وميّز في الرسالة بين: `rate_limited` (مؤقت بالثواني)، و`daily_cap_reached` (رسائل التحقق، «حاول غداً»)، و`daily_request_quota_reached` (الطلبات، «حاول غداً»). القيم قابلة للضبط بمتغيّرات بيئة — **اقرأها من الرد ولا تُضمّنها في التطبيق**.

---

## 5. مصفوفة الحالات

المحوران اللذان يحدّدان كل شيء: **من المُرسِل** (زائر موثَّق / زبون مسجّل) و**لمن الطلب** (`for_self` / `for_another`). أربع تركيبات، ولا خامسة.

### 5.0 قبل أي حالة — الإقلاع وبناء العنوان

عند فتح التطبيق: نادِ `GET /api/app/service-requests/types` وتأكّد أن `water_check` موجود قبل إظهار الزر. ثم تحقّق من حالة المستخدم عبر `GET /api/app/session` (زبون مسجّل) أو `GET /api/app/account/status` (زائر).

منتقي العنوان يُبنى من `GET /api/public/areas` تدريجياً: نداء بلا بارامتر يعيد المحافظات، ثم `?parent_id=<id>` لكل مستوى أدنى. **مرّر `activeOnly=true`** — بدونها يعيد المسار وحدات غير نشطة، وطلبها ينتهي غالباً إلى `branchResolution.status = "no_coverage"`.

---

### 5.1 زائر يطلب لنفسه

**من:** شخص بلا حساب، أثبت ملكية رقمه بـ OTP.

**الرحلة:** `otp/send` بغرض `service_request` ← `otp/verify` ← `handle` ← إرسال الطلب خلال 10 دقائق.

```json
POST /api/app/service-requests
{
  "requestType": "water_check",
  "submissionMode": "for_self",
  "handle": "c34b43f1-…",
  "firstName": "ليان", "lastName": "مراد",
  "phoneNumber": "0955000222",
  "governorateId": 248, "regionId": 2,
  "detailedAddress": "شارع بغداد",
  "mapLocation": { "lat": 33.51, "lng": 36.29 }
}
```

**القاعدة الحاكمة:** `phoneNumber` **يجب أن يطابق الرقم الذي تحقّقتَ منه**، وإلا `400 verified_phone_does_not_match_beneficiary`. اقفل حقل الهاتف في الواجهة على الرقم المتحقَّق منه بدل ترك المستخدم يخطئ فيه.

**ما يُخزَّن:** `submitterTier = visitor` · `submission_type = apply` · المُرسِل والمستفيد **لقطة واحدة** لا ربط لها بأي سجلّ · لا محيل.

**أخطاء تخصّ هذه الحالة:** عائلة `service_request_verification_*` و`verified_phone_does_not_match_beneficiary`.

---

### 5.2 زبون مسجّل يطلب لنفسه

**من:** مستخدم دخل بحسابه. **هو المستفيد بحكم التعريف**، فهويته تأتي من سجلّه لا من الجسم.

```json
POST /api/app/service-requests
Authorization: Bearer <accessToken>
{
  "requestType": "water_check",
  "submissionMode": "for_self",
  "governorateId": 248, "regionId": 1,
  "subdistrictId": 35, "neighborhoodId": 137,
  "detailedAddress": "شارع بغداد",
  "notes": "الماء عكر"
}
```

**لا ترسل أي حقل هوية.** الجسم يقتصر على العنوان والملاحظات:

| يُرسَل | يُشتقّ من سجلّ الزبون |
|---|---|
| `submissionMode: "for_self"` | `firstName` · `fatherName` · `lastName` |
| معرّفات الجغرافيا · `detailedAddress` | `phoneNumber` (رقم الدخول) |
| `mapLocation` · `notes` | `secondaryPhone` (أول رقم فعّال غير رئيسي) |
| | `primaryPhoneHasWhatsapp` · `secondaryPhoneHasWhatsapp` |

إرسال أيٍّ من العمود الأيمن **يُرفض صراحةً** — لا يُتجاهَل صامتاً، حتى لا تظنّ أن قيمتك وصلت:

```json
{ "error": "identity_fields_not_accepted",
  "details": { "code": "identity_fields_not_accepted",
    "fields": ["firstName", "lastName", "phoneNumber"],
    "reason": "for_self_customer_identity_is_derived_from_profile" } }
```

**تعبئة الشاشة:** اعرض بيانات المستخدم من `GET /api/app/me` **للقراءة فقط**. ويعيد المسار معرّفات العنوان جاهزة للمنتقي:

```json
"address":    { "governorate": "دمشق", "cityOrArea": "دمشق القديمة",
                "subArea": "الحميدية", "neighborhood": "باب شرقي",
                "detailedAddress": null },
"addressIds": { "governorate": 248, "cityOrArea": 1, "subArea": 35, "neighborhood": 137 },
"geoUnitId":  137
```

| `addressIds` | حقل الطلب |
|---|---|
| `governorate` | `governorateId` |
| `cityOrArea` | `regionId` |
| `subArea` | `subdistrictId` |
| `neighborhood` | `neighborhoodId` |

اضبط المنتقي بهذه القيم ثم دع المستخدم يعدّلها إن كان الفحص في مكان آخر — **مكان الفحص ليس بالضرورة عنوان سكنه**. و**لا تطابق بالأسماء**: الأسماء تتكرّر بين المحافظات وإعادة التسمية تُبطل المطابقة صامتةً. السلسلة مضمونة الاتّصال دائماً فتقبلها قواعد §3.3. و`detailedAddress` غالباً `null` في السجلّ — اترك الحقل فارغاً ليملأه المستخدم، وليس ذلك خطأً.

**ما يُخزَّن:** `submitterTier = customer` · `submission_type = apply` · المُرسِل والمستفيد **مربوطان بسجلّ الزبون** · اللقطة تحمل `identity_source: "client_record"` · لا محيل.

**السجلّ الناقص:** إن كان سجلّ الزبون بلا اسم أول أو كنية يُرفض الطلب بـ `409 customer_profile_incomplete` مع `details.missing`. التطبيق لا يستطيع إصلاحها (تعديل بيانات الزبون خارج نطاقه — DEC-013 §10)، فالرسالة الصحيحة توجيه المستخدم لخدمة الزبائن. والطريق البديل المتاح له فوراً: `for_another` حيث يكتب البيانات يدوياً.

**فائدة:** الاشتقاق يجلب `fatherName` وعلامات واتساب من السجلّ، وهي بيانات لا يعيدها `GET /api/app/me` أصلاً — فالطلب أغنى ممّا يستطيع التطبيق إرساله.

---

### 5.3 طلب لشخص آخر (زائر أو زبون)

**من:** أيّ من الهويتين. المُرسِل هنا ليس المستفيد، بل **محيل** — والحقول الستّة الأولى في §3.2 تصف **الشخص الآخر**، وحقول `referrer*` تصف المُرسِل نفسه.

**اسم المُرسِل يتبع القاعدة نفسها التي يتبعها اسم المستفيد:** يُشتقّ حين يوجد سجلّ، ويُرسَل حين لا يوجد.

#### الزائر — يرسل اسمه

```json
POST /api/app/service-requests
{
  "requestType": "water_check",
  "submissionMode": "for_another",
  "handle": "c34b43f1-…",

  "firstName": "جار", "lastName": "الطيب",
  "phoneNumber": "0955123123",

  "referrerFirstName": "سالم",
  "referrerFatherName": "أحمد",
  "referrerLastName": "الحلبي",

  "governorateId": 248, "regionId": 2,
  "detailedAddress": "الشارع المقابل"
}
```

`referrerFirstName` و`referrerLastName` **إلزاميان**، وغيابهما يعيد:

```json
{ "error": "missing_referrer_name",
  "details": { "code": "missing_referrer_name",
    "fields": ["referrerFirstName", "referrerLastName"] } }
```

#### الزبون المسجّل — لا يرسل اسمه

يرسل الجسم نفسه **بلا حقول `referrer*`** مع `Authorization: Bearer`، ويُشتقّ اسمه من سجلّه. إرسالها يعيد `400 referrer_fields_not_accepted` بـ `details.reason = "referrer_identity_is_derived_from_profile"`.

#### قواعد مشتركة

**لا قاعدة تطابق هاتف هنا** — رقم المستفيد رقم شخص آخر بطبيعته.

**ما يُخزَّن:** `submitterTier` حسب الهوية · `submission_type = refer_a_candidate` · المستفيد **لقطة غير مربوطة دائماً** · المُرسِل يُسجَّل محيلاً باسمه وهاتفه الموثَّق، وللزبون المسجّل يُربط المحيل بسجلّه أيضاً. ولقطة المحيل تحمل `name_source` (`client_record` أو `submitted`) ليميّز المراجع الاسم المضمون من المُعلَن ذاتياً.

**حدّ يخصّ هذه الحالة:** قاعدة «طلب مفتوح واحد» مبنية على **رقم المستفيد** لا المُرسِل، فقد تصطدم بـ `409 open_request_exists` بسبب طلب أرسله شخص آخر لنفس المستفيد. اعرضه كمعلومة («يوجد طلب قائم لهذا الرقم») لا كفشل.

---

### 5.4 «زائر يطلب لزبون» و«زائر يطلب لزائر» — طلبٌ واحد لا يفرّق بينهما

هذان ليسا حالتين. كلاهما **§5.3 بهوية زائر**، ويخرجان من الـ API **متطابقين تماماً**.

السبب مقصود لا مُهمَل: **الـ API لا يفحص إطلاقاً هل رقم المستفيد يخصّ زبوناً مسجّلاً**. المستفيد يُخزَّن دائماً لقطةً غير مربوطة (`beneficiary_client_id = null`)، والربط بسجلّ داخلي **قرار مراجعٍ بشري لاحق** يعتمد على اقتراحات مطابقة تقريبية. هذا نصّ العقد الحاكم: «الربط قرار مراجعة لا افتراض تلقائي»، و«الاسم الخارجي لا يُدرَج في سجلّ الزبائن لمجرد وصول استمارة».

**ما يعنيه لك عملياً:**

لا تحاول اكتشاف ما إذا كان المستفيد مسجّلاً، ولا تغيّر الشاشة بناءً على ذلك، ولا تتوقّع في الرد أي إشارة إلى أن المستفيد زبون قائم. الرد واحد في الحالتين. وإن أراد المنتج تمييزهما مستقبلاً فذلك يحتاج قراراً معمارياً جديداً، لا تعديلاً في التطبيق.

---

### 5.5 جدول المقارنة السريع

| | زائر · `for_self` | زبون · `for_self` | زائر · `for_another` | زبون · `for_another` |
|---|---|---|---|---|
| المصادقة | `handle` | `Bearer` | `handle` | `Bearer` |
| حقول الهوية في الجسم | **إلزامية** | **مرفوضة** | إلزامية (للمستفيد) | إلزامية (للمستفيد) |
| مصدر هوية المستفيد | الجسم | سجلّ الزبون | الجسم | الجسم |
| تطابق الهاتف مع المتحقَّق منه | **مفروض** | لا ينطبق | لا | لا |
| `submitterTier` | `visitor` | `customer` | `visitor` | `customer` |
| `submission_type` | `apply` | `apply` | `refer_a_candidate` | `refer_a_candidate` |
| المستفيد مربوط بسجلّ؟ | لا | **نعم** | لا | لا |
| المُرسِل محيل؟ | لا | لا | نعم | نعم (مربوط بسجلّه) |
| حقول `referrer*` | مرفوضة | مرفوضة | **إلزامية** | مرفوضة (تُشتقّ) |
| تعبئة مسبقة متاحة؟ | لا | **نعم** (§5.2) | لا | لا |

---

## 6. سجلّ الهجرة — لبناء قائم قبل 2026-07-31

أربعة تغييرات كاسرة فقط. الوصف الكامل للسلوك الحالي في الأقسام أعلاه؛ ما يلي **فرقٌ عمّا كان** لا مواصفة.

| # | التغيير | ماذا تفعل | المرجع |
|---|---|---|---|
| 1 | **النموذج صار مغلقاً** — أي مفتاح غير معلَن يُرفض بدل أن يُحفظ | مرّر جسماً حقيقياً على بيئة التطوير وتأكّد من `201`؛ احذف ما يظهر في `unknownFields` | §3.2 |
| 2 | **`submissionMode` حرفي** — `"self"` كانت تُقبل صامتة وتُفسَّر `for_self`، والآن تُرفض | استعمل `for_self` / `for_another` | §3.1 |
| 3 | **قاعدة الطلب المفتوح الواحد** لرقم المستفيد | اعرض `details.publicRefNumber` كمعلومة لا كفشل | §4.2 · §5.3 |
| 4 | **هوية الزبون تُشتقّ في `for_self`** — كانت تُقبل من الجسم | احذف حقول الهوية من هذه الحالة وحدها | §5.2 |
| 5 | **نسخة النموذج صارت `water_check.mobile.v2`** — أُضيف اسم المُرسِل في `for_another`، وهو **إلزامي للزائر** | أضف الحقلين في شاشة «طلب لشخص آخر» للزائر؛ وإن كنت ترسل `formVersion` صراحةً فحدّثها وإلا `409 unsupported_form_version` | §3.2 · §5.3 |

وتغييرات غير كاسرة تحسّن ما لديك بلا تدخّل منك:

`mapLocation` لم يعد يقبل مفتاحاً ثالثاً غير `lat`/`lng` (دقّة، طابع زمني، مصدر). و**العنوان الإداري يُتحقَّق منه فعلاً** بعد أن كان أي عدد موجب يمرّ — منتقٍ تتالٍ سليم لا يتأثّر (§3.3). و`id` و`duplicateOfRequestId` صارا عددين بعد أن كانا يصلان نصّاً، فأي `int.parse` يدوي صار زائداً لا ضارّاً. و`500` صارت رسالة عامة ثابتة بدل نصّ الخطأ الداخلي (§1.1). و`service_address` المخزَّن صار شكلاً واحداً بمفاتيح معتمَدة و`labels` (§3.5). و`GET /api/app/me` صار يعيد `addressIds` و`geoUnitId` (§5.2).

---

## 7. لفريق التشغيل — متغيّرات النشر

| المتغيّر | إلزامي؟ | القيمة |
|---|---|---|
| `TRUST_PROXY` | **نعم خلف nginx** | `1` — بدونه تنهار حدود العنوان في دلو واحد مشترك لأن كل نداء يبدو قادماً من 127.0.0.1 |
| `OTP_PROVIDER` | نعم في الإنتاج | لم يعد يقبل قيمة مجهولة، ويرفض `simulated` في الإنتاج. **الخادم لن يقلع** حتى يُركَّب مرسل حقيقي — وهذا مقصود: البديل السابق كان إقلاعاً سليماً بلا تسليم أي رسالة |
| `APP_RATE_LIMIT_ENABLED` | لا | `false` يعطّل حدود العنوان (لاختبار الحمل فقط)، ويطبع تحذيراً عند الإقلاع |
| بقية `APP_RATE_*` و`APP_WATER_CHECK_*` و`OTP_DAILY_CAP_PER_PHONE` | لا | القيم الافتراضية في جدولي القسم 4؛ `0` يعطّل الحدّ المعني |

حدود العنوان محفوظة **في ذاكرة العملية**: مع PM2 بنمط cluster يصير الحدّ الفعلي (عدد العمّال × الحدّ). مقبول لأنها البوّابة الخارجية الخشنة فقط — قواعد الهوية والمال محفوظة في قاعدة البيانات تحتها.
