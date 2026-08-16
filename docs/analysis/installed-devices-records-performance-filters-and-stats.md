# الأجهزة المركّبة — الأداء والفلاتر والإحصائيات

**الحالة:** منفّذ (نفس نمط الزبائن/العقود). **التاريخ:** 2026-07-30.
**النطاق:** صفحة `packages/web/src/pages/devices/InstalledDevicesList.tsx` ومسارها `GET /api/installed-devices` في `packages/api/routes/installedDevices.ts`.
**مرجع مماثل:** [contracts-records-performance-filters-and-stats.md](contracts-records-performance-filters-and-stats.md).

---

## 1. التشخيص (قبل)

الصفحة كانت تُحمّل **كل** الأجهزة ضمن النطاق عبر `api.installedDevices.list` وتفلتر/تفرز/تبحث/تصفّح في المتصفح (SmartTable client-mode). والمسار `GET /` بلا `LIMIT`، مع 5 `LEFT JOIN` + `LATERAL` (اتفاق خدمة ساري) لكل صف. لا وجود لأي widget إحصائي للأجهزة.

## 2. قرار النطاق (محسوم)

الأجهزة **فرعية فقط بالفرع** — لا طبقة ASSIGNED. النطاق `d.branch_id`: super-admin ترويسة `X-Branch-Id` اختيارية، وغيره `actingBranchId`. المسار المصفَّح يحاكي `GET /` عبر لبنة مشتركة `appendInstalledDeviceListScope` (منع drift). كل widgets الأجهزة بصلاحية `installed_devices.view`.

## 3. الفلاتر (منفّذة على `/installed-devices/paged`)

الحالة (11)، المصدر (شركة/خارجي)، الضمان الذهبي (ثنائي)، النوع الفرعي للعقد، موديل الجهاز (ديناميكي)، مدى تاريخ التركيب، اتفاق خدمة ساري (ثنائي)، كفالة توشك على الانتهاء خلال N يوماً. والبحث على الموديل/الرقم التسلسلي/الزبون/رقم العقد.

**مؤجَّل:** التسلسل الجغرافي للموقع (`geoIds`) — المسار يدعمه خادمياً، لكن مكوّن التسلسل الجغرافي مدمج داخل `Clients.tsx` ويحتاج استخراجاً كمكوّن مشترك قبل ربطه هنا.

## 4. الإحصائيات — دومين «الأجهزة» جديد

معزول بـ`appendInstalledDeviceScope`. **المؤشرات القياسية:** `devices.active_base` (القاعدة الحيّة، لقطة)، `devices.installed_in_period` (رُكّبت خلال الفترة)، `devices.golden_active` (ضمان ذهبي، لقطة)، `devices.warranty_expiring` (كفالات تنتهي خلال ٦٠ يوماً، لقطة). **التجميعات:** `by_status` (Donut)، `by_source` (Donut)، `by_model` (Bar)، `by_branch` (Bar)، `installation_trend` (Timeline).

## 5. التنفيذ

المسار `GET /installed-devices/paged` (مُسجَّل قبل `/:id`) + `api.installedDevices.listPaged()` + نوع `PagedInstalledDevices*`. الصفحة أُعيدت بلوحة الفلاتر الموحّدة (FilterField/ActiveFilterChip) ووضع SmartTable الخادمي. `GET /` القديم لم يُلمَس (يخدم `customerId` وبقية المستهلكين). الإحصائيات في الكتالوجين + `widgetRegistry` (قسم «الأجهزة»). لا ترحيلة (لا مخطط جديد).
