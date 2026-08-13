# قرار معماري: الأجهزة والزيارات في تطبيق الزبائن (My Devices / My Visits)

> **رقم القرار:** DEC-017
> **التاريخ:** 2026-08-13
> **الحالة:** ✅ معتمد
> **الأولوية:** 🟡 متوسطة
> **يكمل:** DEC-013 (إنشاء الحساب ومصادقة تطبيق الزبائن) + DEC-004 (دورة حياة الزيارة) + DEC-011 (الزيارة الفورية)
> **الكيانات المتأثرة:** installed_devices, device_models, device_warranties, contracts, field_visits, visit_tasks, employees, app_accounts

---

## 1. ملخص المعضلة

تطبيق الزبائن (`/api/app/*`) يملك حالياً مصادقة كاملة (DEC-013) واستقبال طلبات خدمة موحّد، لكن لا توجد أي شاشة تتيح للزبون رؤية أجهزته المملوكة أو زياراته الميدانية. الاستعلامات الداخلية الموجودة (`routes/installedDevices.ts`, `routes/fieldVisits.ts`) مصمَّمة لطاقم الموظفين ومتشابكة كلياً مع صلاحيات ونطاق الفروع (`requirePermission`, `assertGeoUnitInScope`, ...)، فلا يصح تعريضها مباشرة تحت مصادقة الزبون.

السابقة الوحيدة الموجودة هي استعلامات ضيقة في `appServiceRequests.ts` (تعبئة نموذج طلب صيانة/ضمان) تُظهر أن نمط `requireAppAuth` + `WHERE customer_id = req.appAccount.clientId` يعمل فعلاً بلا أي تشابك صلاحيات — هذا القرار يعمّم هذا النمط إلى شاشتي عرض (read-only) كاملتين: «أجهزتي» و«زياراتي».

---

## 2. القرارات المعتمدة (D-AV1 → D-AV7)

### D-AV1 — النطاق: عرض فقط (read-only)
هذه المرحلة تبني عرضاً فقط. لا إلغاء/إعادة جدولة/تعديل من الزبون على الزيارة أو الجهاز. أي تفاعل كتابي مؤجَّل لمرحلة لاحقة (انظر §5).

### D-AV2 — حالات الزيارة المعروضة للعميل
الحالات الداخلية السبع (DEC-004) تُبسَّط لأربع حالات عميل عبر جدول تحويل ثابت في نقطة الخروج، بلا أي منطق إضافي في الاستعلام:

| الحالة الداخلية | ما يراه العميل |
|---|---|
| `scheduled` | مجدولة |
| `in_progress`, `ended` | قيد التنفيذ |
| `completed`, `closed` | منتهية |
| `not_completed` | لم تكتمل |
| `cancelled` | ملغاة |

`not_completed` تبقى ظاهرة بذاتها (لا تُدمج مع «منتهية») لأن الزبون يحتاج أن يعرف أن الفريق حضر ولم يُنفَّذ شيء.

### D-AV3 — هوية الفريق: مشرف + فني معاً، الفريق الفعلي الحالي، بلا هاتف
تُعرض أسماء **المشرف والفني معاً** (لا فقط أحدهما)، أبداً بلا رقم هاتف الموظف، وأبداً بلا اسم المتدرّب (دوره داخلي بحت).

الاسم المعروض هو **الفريق الفعلي الحالي**، لا اللقطة الأصلية `team_snapshot`: يُعاد استخدام نمط الحل الموجود فعلاً في `routes/fieldVisits.ts` (أسطر ~1085–1188) — `COALESCE(reassigned_supervisor_id, team_snapshot->>'supervisorEmployeeId')` و`COALESCE(reassigned_technician_id, team_snapshot->>'technicianEmployeeId')` ثم `LEFT JOIN employees`. إن تغيّر فريق الزيارة (فريق رديف)، يظهر للزبون الفريق الجديد المُعاد تعيينه.

هذا يتوافق مع مبدأ «هوية الموظف تتبع النطاق ولا تُعرض كتسمية عامة» (`branch-scope-and-visibility-standard.md`) — تطبيق الزبون أوسع نطاق ممكن، والحماية هنا هي حجب رقم الهاتف فقط، مع كشف الاسم لبناء ثقة الزبون بالفريق الزائر (قرار عمل صريح يتجاوز التوصية الأولية بحجب الهوية كاملة).

### D-AV4 — لا شرط ظهور زمني إضافي في الاستعلام
لا تحتاج شاشة «زياراتي» شرط `WHERE` خاص بنافذة «يوم واحد قبل الموعد». هذه النافذة نتيجة طبيعية لآلية الجدولة نفسها في المشروع (نفس نمط `contact_targets`/`needs_follow_up`، DEC-006 D36، `domains/tasks.md:410-414`) — الزيارة لا تُحسم بـ`scheduled_date` فعلي إلا ضمن هذا الأفق أصلاً. الاستعلام يعرض كل زيارات العميل مرتّبة بالتاريخ دون تمييز.

هذا يشمل ضمنياً الزيارات الفورية (`origin_type = 'field_initiated'`, DEC-011): تظهر بمجرد وجودها لأنها تُنشأ مباشرة بحالة `in_progress` دون حاجة لأي معالجة استثنائية.

### D-AV5 — كل زيارة مرتبطة بالجهاز/العقد المتعلق بها
`field_visits.client_id` هو نطاق العميل، لكن الزيارة الواحدة قد تخصّ جهازاً محدداً من بين عدة أجهزة للعميل. تُربط كل زيارة بجهازها عبر `LEFT JOIN visit_tasks → contracts/installed_devices` لعرض اسم/موديل الجهاز كحقل عرض إضافي على كل زيارة، دون تعقيد منطق الفلترة الأساسي (`WHERE client_id = $1`).

### D-AV6 — «أجهزتي» تعرض كل الأجهزة بجميع حالاتها
بخلاف استعلامات `appServiceRequests.ts` (تستثني `returned`/`disposed` لأنها نماذج تعبئة)، شاشة «أجهزتي» شاشة سجل كامل: تُعرض كل الأجهزة المرتبطة بالعميل دون أي استثناء حالة، مع عرض الحالة (نشط/مُسترجَع/تالف/إلخ) كحقل واضح على كل جهاز.

### D-AV7 — الشكوى بعد الزيارة: مؤجَّلة
ميزة تقديم شكوى بحق فريق الزيارة بعد إتمامها **مؤجَّلة لمرحلة لاحقة**، خارج نطاق هذا القرار. عند بنائها، التوجيه المعتمد هو إعادة استخدام نمط `service_requests` (نوع طلب جديد `visit_complaint` مرتبط بـ`field_visit_id`)، بنفس فلسفة DEC-013 مع `account_creation` — لا جدول شكاوى مستقل جديد.

---

## 3. التأثير على الكود

### 3.1 Migrations
لا يوجد. النماذج (`installed_devices`, `device_warranties`, `field_visits`, `visit_tasks`) جاهزة بالكامل؛ `field_visits.client_id` و`installed_devices.customer_id` يوفّران مفتاح النطاق مباشرة عبر `req.appAccount.clientId` الموجود أصلاً.

### 3.2 Backend
| العنصر | الحالة |
|---|---|
| `routes/appDevices.ts` | 🆕 — `GET /api/app/me/devices`، تحت `requireAppAuth`، يوسّع نمط `appServiceRequests.ts` (`installed_devices` ⋈ `device_models` ⋈ `device_warranties`) بلا استثناء حالة (D-AV6) |
| `routes/appVisits.ts` | 🆕 — `GET /api/app/me/visits`، `WHERE client_id = $1`، تبسيط حالات (D-AV2)، ربط فريق فعلي (D-AV3)، ربط جهاز (D-AV5) |
| `index.ts` | تسجيل الراوترين الجديدين تحت `/api/app` |

### 3.3 Frontend
خارج نطاق هذا المستودع (فريق الموبايل) — يُسلَّم كمرجع API (§4).

---

## 4. التأثير على الدستور

| الملف | التحديث |
|---|---|
| `docs/api/mobile-devices-api-reference.md` | 🆕 مرجع API لـ `GET /me/devices` |
| `docs/api/mobile-visits-api-reference.md` | 🆕 مرجع API لـ `GET /me/visits` |
| `decisions/README.md` | إدراج DEC-017 |

---

## 5. غير المشمول

- الشكوى بعد الزيارة (مؤجَّلة — D-AV7).
- أي كتابة/تعديل من الزبون على الزيارة (إلغاء، إعادة جدولة) أو الجهاز — القرار كله عرض فقط (D-AV1).
- إشعارات فورية (push) عند تغيّر حالة الزيارة أو الجهاز.
- عرض `device_warranty_payments` (بيانات مالية داخلية) في شاشة «أجهزتي».

---

## 6. القرارات اللاحقة المعلّقة

- `P-DEC017-01`: بناء شكوى الزيارة كـ `request_type = 'visit_complaint'` على `service_requests` (يتطلب دستوراً فرعياً خاصاً بالصلاحيات ودورة الـ escalation).
- `P-DEC017-02`: إشعارات الدفع (push notifications) عند تغيّر حالة الزيارة/الجهاز.
- `P-DEC017-03`: هل تحتاج شاشة الأجهزة عرض تاريخ دفعات الضمان الذهبي للزبون، أم تبقى تفصيلاً مالياً داخلياً بحتاً؟

---

## 7. المراجع

- `decisions/DEC-013-account-creation-and-app-auth.md` (حاجز المصادقة `requireAppAuth` + `req.appAccount.clientId`)
- `decisions/DEC-004-visit-task-lifecycle-refinement.md` (الحالات السبع للزيارة)
- `decisions/DEC-011-field-initiated-visit.md` (الزيارة الفورية `in_progress` مباشرة)
- `domains/branch-scope-and-visibility-standard.md` (مبدأ هوية الموظف تتبع النطاق)
- `routes/appServiceRequests.ts` (سابقة نمط الاستعلام العميل-محدود، أسطر ~70–126)
- `routes/fieldVisits.ts` (نمط حل الفريق الفعلي عبر `reassigned_*` + `team_snapshot`، أسطر ~1085–1188)
- `middleware/appAuth.ts` (`requireAppAuth`, `req.appAccount`)
