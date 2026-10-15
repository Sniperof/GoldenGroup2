# 2026-06-10 — خطة إصلاح وتوسعة شاشة العقود

> **الحالة:** معتمدة من صاحب المنتج (Ibrahim Obaid) — 2026-06-10
> **النطاق:** `packages/web/src/pages/contracts/ContractForm.tsx` + `packages/api/routes/contracts.ts` + migration جديد
> **المرجع الأصلي:** `/root/.claude/plans/bubbly-sniffing-widget.md`

## السياق (Context)

شاشة "إضافة/تعديل عقد" (`packages/web/src/pages/contracts/ContractForm.tsx`) فيها عدة مشاكل متراكبة تمنع المستخدم من:
1. **حفظ عقد جديد كمسودة** — رغم أن النموذج صُمم لذلك (DEC-CT-01)، إلا أن قواعد التحقق (`isValid`) تفرض نفس متطلبات العقد المعتمد.
2. **تعديل أي عقد محفوظ** — لأن بيانات الجغرافيا والخصم والكفالة والأقساط لا تُستعاد كلها من استجابة API، فيُفسد التحقق ويُعطل زر الحفظ.
3. **التحكم بقيود البيانات القانونية بشكل منطقي** — حالياً حقلا (الأب + الرقم الوطني) معاملان معاملة استثنائية مقارنة ببقية الحقول، بدون منطق يربط مستوى الإلزام بنمط الدفع.
4. **التمييز بين "بائع" و"مُسكِّر" و"مُدخِل"** — حقل `sale_owner_id` موجود في DB (migration 262) ومدعوم في الـ Backend لكن غير مرئي في الواجهة، ولا يُملأ تلقائياً من فريق العرض، ولا تحكمه صلاحية منفصلة.

**المخرج المُستهدف:** عقد منطقي قابل للحفظ كمسودة، يستعيد كل بياناته عند التعديل، يطبق قيوداً قانونية متّسقة وفق نمط الدفع، يدعم نسبة البيعة لموظف منفصل بصلاحية مستقلة، وخريطة صلاحيات واضحة ومراجَعة.

---

## التشخيص المُثبَّت

### أ. مشكلة المسودة (Draft) — لا يمكن الحفظ كمسودة

**القاعدة الخلفية** (`packages/api/routes/contracts.ts:85-93` — `deriveContractStatus`):
- إن لم يُعيَّن `closingEmployeeId` → `status='draft'`
- إن عُيِّن → `status='active'` (مع كل التأثيرات الجانبية: materialization لـ `installed_devices`، إنشاء `device_delivery` task، تجميد الوثيقة)
- الواجهة تعكس نفس القاعدة (`ContractForm.tsx:843`)

**المشكلة:** `isValid` (`ContractForm.tsx:801-833`) لا يميّز بين الحالتين:
- يفرض على عقد المسودة نفس شرط `paymentType==='cash' → totalPaidSyp ≈ grandTotal`
- ويفرض `installmentsConfirmed === true` لعقد التقسيط
- زر الحفظ (`disabled={!isValid || saving}` السطر 1093) يبقى معطّلاً → **يستحيل حفظ مسودة ناقصة**

### ب. مشكلة استعادة بيانات التعديل

| الحقل | الحالة | المصدر |
|---|---|---|
| `geoSelection.govId/regionId/subId` | ❌ يُقرأ من `c.governorateId/regionId/subDistrictId` — وهذه **غير موجودة** في `contractSelect` (السطور 17-71) | API يُرجع `installationGeoUnitId` فقط (السطر 58)، فيبقى `govId=''` ويسقط `isValid` على السطر 806 |
| `selectedDiscountId` | ❌ يُقرأ من `c.selectedDiscountId` — غير موجود | API يُرجع `discountId` و `appliedDeviceDiscountId` (السطور 27، 31) |
| `warrantyMonths` / `warrantyVisits` | ❌ لا يُستعادان أصلاً، ويُصفِّرهما `useEffect` على السطر 401-404 عند تعيين `deviceModelId` | API يُرجعهما (السطور 65-66) |
| `installmentDrafts` / `installmentsConfirmed` | ❌ لا يُستعادان | API يُرجع `c.installments` (السطور 554-561) — لكن البلوك المرئي (السطور 305-320) يُعالج `paymentEntries` فقط |
| `noClosingReasonId` | ✅ يُستعاد (السطر 273) | OK |
| `closingEmployeeId` | ✅ يُستعاد (السطر 271) | OK |
| `paymentEntries` / `lineItems` | ✅ يُستعادان | OK |

### ج. عدم اتّساق البيانات القانونية

- 9 حقول قانونية في القسم (`ContractForm.tsx:1174-1268`): اسم الأب، الرقم الوطني، الجنس، تاريخ الميلاد، اسم الأم، القيد، أمانة السجل، تاريخ الإصدار، الخانة.
- **حقلان فقط** (الأب + الرقم الوطني) يستخدمان نمط `*Override` ويُفعّلان منطق `needsFatherName`/`needsNationalId`/`legalMissing`/`legalResolved` (السطور 772-775).
- البقية حقول بسيطة بلا أي قيد ولا تنسيق amber.
- الترتيب الحالي: الأب • الرقم • الجنس • الميلاد • الأم • القيد • الأمانة • تاريخ الإصدار • الخانة → الأم بعيدة عن الأب.
- **لا يوجد قيد على طول الرقم الوطني** (لا maxLength في الـ input، لا تحقق في الـ backend).
- **القيد الحالي لا يربطه بنمط الدفع** — منطقياً: العقد الكاش = توثيقي فقط (التزام انتهى)، التقسيط = التزام مالي حي يستوجب الإلزام.

### د. غياب حقل "البائع" (sale_owner_id)

- العمود موجود في DB (`migration 262`) مع `FK` لـ `hr_users` ومُفهرس.
- الـ Backend يقبله في POST (`contracts.ts:731`) — لكن **الواجهة لا ترسله إطلاقاً** (payload في `handleSubmit` ليس فيه `saleOwnerId`).
- لا يوجد منطق auto-fill من فريق العرض رغم وجود `ContractOfferTeamMember` و`offer_team_snapshot` يجمَّد عند الإنشاء (DEC-CT-13).
- **لا توجد صلاحية مخصصة** للسماح بنسبة البيعة لشخص آخر غير المُدخِل.

### هـ. خريطة الصلاحيات الحالية

(من `migrations/001_initial_schema.sql:5289-5360`)

| Permission ID | Key | الفعل | الـ scopes | أين تُفحَص |
|---|---|---|---|---|
| 14 | `contracts.create` | إنشاء | GLOBAL+BRANCH | POST `/contracts` (سطر 660) |
| 16 | `contracts.view_list` | عرض القائمة + التفاصيل | GLOBAL+BRANCH | GET `/contracts`, GET `/:id` |
| 17 | `contracts.edit` | تعديل | GLOBAL+BRANCH | PUT `/:id`, POST `/payment-entries`, POST `/installments`, … |
| 18 | `contracts.delete` | حذف | GLOBAL+BRANCH | DELETE `/:id` |
| 105 | `contracts.approve` | موافقة/رفض | GLOBAL+BRANCH | POST `/:id/approve`, POST `/:id/reject` |

**الفجوات:**
- لا توجد صلاحية للتسكير (closing) منفصلة → أي شخص له `contracts.create` أو `contracts.edit` يقدر يُسكِّر.
- لا توجد صلاحية لـ "نسبة بيعة لشخص آخر" — مطلوب جديد.

---

## القرارات المُعتمدة من صاحب المنتج (2026-06-10)

1. **الحقول القانونية الإلزامية في التقسيط:** الـ 9 جميعاً (الأب، الرقم الوطني، الأم، الجنس، الميلاد، القيد، الأمانة، تاريخ الإصدار، الخانة). الكاش = اختياري كلياً.
2. **صلاحية التسكير:** صلاحية مستقلة **`contracts.close`** — تُتاح للمشرف/مدير الفرع وتكون شرطاً لإظهار حقل "موظف التسكير" وتُحوّل العقد إلى `active`.
3. **القيمة الافتراضية للبائع:** **مسؤول فريق العرض** — يُجلَب دائماً من آخر زيارة عرض جهاز للزبون (سواء كان `saleSource === device_demo_task` أم لا). فقط عندما لا توجد زيارة عرض، يُترك الحقل للاختيار اليدوي من قِبَل من يملك `contracts.assign_sale_owner`.
4. **تجميد `saleOwnerId`:** قابل للتعديل ما دام `status='draft'`، **يُجمَّد لحظة الاعتماد** (Approve) — مثل `offer_team_snapshot` في DEC-CT-13.

---

## الخطة المُعتمدة للتنفيذ

### الجزء 1: إصلاح حفظ المسودة (`isValid`)

**في `ContractForm.tsx:801-833`** — إعادة هيكلة `isValid` لتمييز نمطي الحفظ:

```ts
const isDraftMode = !closingEmployeeId;   // ← نفس قاعدة الـ backend

const isValid = useMemo(() => {
  if (!selectedCustomer) return false;
  if (!deviceModelId) return false;
  if (!serialNumber.trim()) return false;
  if (!geoSelection.govId || !geoSelection.neighborhoodId) return false;

  // المسودة: الحد الأدنى فقط (الزبون + الجهاز + الموقع)
  if (isDraftMode) return true;

  // العقد المعتمد:
  if (legalRequired && !legalAllPresent) return false;  // ← يُحسب من الجزء 3
  if (saleSubtype === 'temporary' || saleSubtype === 'free') return true;
  if (saleSource === 'device_demo_task' && !sourceTaskId.trim()) return false;
  // باقي قيود الدفع كما هي
}, [...]);
```

**النتيجة:** المسودة تُحفظ بأقل المعلومات الضرورية، وتُكتمل عند الاعتماد (Approve).

---

### الجزء 2: إصلاح استعادة بيانات التعديل

**في `ContractForm.tsx:250-321`** — كتلة `existingContract`:

1. **استعادة الجغرافيا:** بناء `geoSelection` كاملاً من `installationGeoUnitId` فقط — استخدام `buildPath` المُصدَّر من `GeoSmartSearch.tsx` ثم `pathToSelection(path)`.
2. **استعادة الخصم:** قراءة `c.discountId ?? c.appliedDeviceDiscountId` بدل `c.selectedDiscountId`.
3. **استعادة الكفالة:** `setWarrantyMonths(Number(c.warrantyMonths) || 0)` + `setWarrantyVisits(...)` — مع تعديل `useEffect` السطر 401-404 ليتجاهل التصفير في وضع `isEdit` عند التحميل الأول (`prevDeviceModelIdRef`).
4. **استعادة الأقساط:**
   ```ts
   if (Array.isArray(c.installments) && c.installments.length > 0) {
     setInstallmentDrafts(c.installments.map(i => ({
       id: i.id,
       installmentNumber: i.installmentNumber,
       dueDate: i.dueDate?.slice(0,10) || '',
       amountSyp: String(i.amountSyp || 0),
     })));
     setInstallmentsConfirmed(c.installments.some(i => i.confirmed));
     setInstallmentCount(String(c.installments.length));
   }
   ```
5. **استعادة `saleOwnerId`:** `setSaleOwnerId(c.saleOwnerId || '')`.

---

### الجزء 3: إصلاح قسم البيانات القانونية

**في `ContractForm.tsx:332-340` + 772-775 + 1174-1268:**

1. **توحيد نمط الحقول:** إلغاء `fatherNameOverride`/`nationalIdOverride` لاستخدام state موحّد لكل الـ 9 حقول، يُملأ عند اختيار الزبون.
2. **قاعدة الإلزام مرتبطة بنمط الدفع:**
   - في وضع التقسيط (active): **كل الـ 9 حقول إلزامية** و amber-styled مع `*`.
   - في وضع الكاش (active): **كلها اختيارية** بلا أي تنسيق amber.
   - في وضع المسودة (draft): **كلها اختيارية** بصرف النظر عن نمط الدفع.
3. **قيد طول الرقم الوطني = 11 رقم:**
   - الواجهة: `<input maxLength={11} inputMode="numeric" pattern="\d{11}" />`.
   - منطق: "إن أدخلت رقماً فيجب أن يكون 11 رقم" — يُطبَّق دائماً عندما الحقل غير فارغ.
   - الـ Backend: تحقق إضافي في `POST /contracts` + `PUT /:id` يرفض رقم وطني طوله ≠ 11 (إن وُجد).
4. **إعادة ترتيب الـ Grid:**
   ```
   صف 1: اسم الأب        | اسم الأم
   صف 2: الرقم الوطني    | الجنس
   صف 3: تاريخ الميلاد   | القيد
   صف 4: أمانة السجل      | تاريخ منح الهوية
   صف 5: الخانة
   ```

---

### الجزء 4: حقل "البائع" (sale_owner_id) + auto-fill من فريق العرض

**أ. منطق Auto-fill:**

1. إن كان `saleSource === device_demo_task` و`selectedOffer` موجود → استخراج قائد الفريق من `selectedTask.team` أو من `offer_team_snapshot`.
2. وإلا → استدعاء `api.openTasks.listByClient(clientId)` وفلترة آخر `task_type === 'device_demo'` بحالة مكتملة، ثم أخذ قائد الفريق منها.
3. وإلا (لا توجد زيارة عرض إطلاقاً) → يبقى الحقل فارغاً، يظهر للاختيار اليدوي لمن يملك `contracts.assign_sale_owner`، وإلا = المُدخِل نفسه عند الحفظ.

**ب. الواجهة:**

حقل جديد في قسم "تفاصيل البيع":
- إن وُجد قائد فريق مُحدَّد تلقائياً → عرضه كـ badge للقراءة + زر "تغيير" لمن لديه صلاحية `contracts.assign_sale_owner`.
- إن لم يوجد → dropdown بموظفي الفرع (`api.employees.list()`) لمن لديه الصلاحية، وإلا قراءة فقط "المُدخِل نفسه".

**ج. تحميل موظفي الفرع:**
`api.employees.list()` موجود في `packages/web/src/lib/api.ts:135` — الـ Backend يُرشّح بالفعل حسب `x-branch-id`.

**د. إرسال `saleOwnerId` في `handleSubmit`:**
إضافة `saleOwnerId: saleOwnerId ? Number(saleOwnerId) : null` للـ payload.

**هـ. منطق التجميد على الـ Backend:**
- في `PUT /:id`: إذا كانت `prevStatus === 'active'` → تجاهل `c.saleOwnerId` (لا تُحدّثه). يُسمح بالتحديث فقط ما دامت `prevStatus === 'draft'`.
- في `/approve`: إذا أُرسل `saleOwnerId` في body، يُحفَظ كقيمة نهائية مُجمَّدة، وإلا يبقى ما هو محفوظ.

**و. حماية الـ Backend بالصلاحية:**
في POST `/contracts` + PUT `/:id`: إذا كان `c.saleOwnerId` مختلفاً عن المستخدم الحالي، التحقق من `contracts.assign_sale_owner`. إن لم تُتح → 403 أو تجاهل القيمة (يُحدَّد عند التنفيذ).

---

### الجزء 5: الصلاحيات الجديدة

**migration واحد:** `migrations/266_add_contracts_close_and_assign_permissions.sql`

```sql
INSERT INTO permissions
  (key, module, sub_module, action, display_name, display_order, allowed_scopes)
VALUES
  ('contracts.close', 'contracts', 'contracts', 'close',
   'تسكير العقد (تعيين موظف التسكير)', 33, ARRAY['GLOBAL','BRANCH']),
  ('contracts.assign_sale_owner', 'contracts', 'contracts', 'assign_sale_owner',
   'نسبة البيعة لموظف آخر', 25, ARRAY['GLOBAL','BRANCH'])
ON CONFLICT (key) DO NOTHING;

-- منح افتراضي للأدوار (يُحدَّد بعد مراجعة صاحب المنتج للصلاحيات)
```

**نقاط الفحص (enforcement):**
- `contracts.close`: تُفحَص في الـ Frontend لإظهار/إخفاء حقل "موظف التسكير". في الـ Backend تُفحَص في `POST /:id/approve` (مع `contracts.approve` أو بديلاً).
- `contracts.assign_sale_owner`: تُفحَص فقط عندما `saleOwnerId !== autoFilledValue && saleOwnerId !== currentUserId`.

---

## الملفات الحرجة المُتأثرة

| الملف | التغيير |
|---|---|
| `packages/web/src/pages/contracts/ContractForm.tsx` | كل الأجزاء 1+2+3+4 — ≈90% من التعديلات |
| `packages/web/src/lib/api.ts` | (إن لزم) helper جديد لموظفي الفرع |
| `packages/api/routes/contracts.ts` | (الجزء 3) تحقق طول الرقم الوطني، (الجزء 4) حماية `saleOwnerId` بصلاحية + تجميد عند Approve |
| `packages/shared/types.ts` | `saleOwnerId` موجود في `Contract` (السطر 909) ✅ |
| `migrations/266_add_contracts_close_and_assign_permissions.sql` | **جديد** — `contracts.close` + `contracts.assign_sale_owner` |
| `packages/web/src/components/GeoSmartSearch.tsx` | لا تعديل — نُعيد استخدام `buildPath` (موجود السطر 54) |

---

## دوال/utilities موجودة سنُعيد استخدامها

- `buildPath(unit, unitsMap)` — `packages/web/src/components/GeoSmartSearch.tsx:54`
- `pathToSelection(path)` — نفس الملف السطر 67
- `deriveContractStatus()` — `packages/api/routes/contracts.ts:85`
- `api.employees.list()` — `packages/web/src/lib/api.ts:136`
- `ContractOfferTeamMember` — `packages/shared/types.ts:808`
- `requirePermission(...)` middleware — `packages/api/middleware/permission.ts`

---

## التحقق (Verification)

### A. اختبار المسودة
1. فتح `/contracts/new`، اختيار زبون + جهاز + موقع فقط، **بدون** موظف تسكير وبدون دفعات → زر الحفظ **مُفعَّل** والعقد يُحفظ بـ `status='draft'`.
2. التحقق عبر `psql`:
   ```sql
   SELECT id, status, closing_employee_id, draft_device_payload
   FROM contracts ORDER BY id DESC LIMIT 1;
   ```
3. زر "اعتماد" في `ContractDetail.tsx:160-258` يستدعي `POST /:id/approve` → العقد يصير `active`.

### B. اختبار التعديل
1. فتح عقد قائم بحالة draft عبر `/contracts/:id/edit` → كل الحقول مُستعادة بصرياً:
   - الجغرافيا (المحافظة → الحي ظاهرة)
   - الخصم محدد
   - الكفالة (الأشهر + الزيارات) معروضة
   - جدول الأقساط ظاهر ومؤكَّد إن كان مؤكَّداً
   - حقل البائع يعرض المُسنَد
2. زر "حفظ" مُفعَّل من اللحظة الأولى دون لمس أي حقل.

### C. اختبار البيانات القانونية
1. عقد كاش (active): كل الحقول القانونية بلا `*`، بلا amber → يُحفظ بدون أي إلزام.
2. عقد تقسيط (active): الـ 9 جميعاً مع `*` و amber → الحفظ يفشل حتى تكتمل.
3. إدخال رقم وطني بطول ≠ 11 → خطأ من Frontend + Backend.

### D. اختبار البائع + الصلاحية
1. مستخدم بصلاحية `contracts.create` فقط (بدون `contracts.assign_sale_owner`):
   - الحقل يعرض القائد التلقائي أو "المُدخِل نفسه" — للقراءة فقط.
2. مستخدم بالصلاحيتين:
   - يقدر يغيِّر النسبة لأي موظف في الفرع.
   - التحقق: `SELECT sale_owner_id FROM contracts WHERE id = …`.
3. تعديل عقد `active`: حقل البائع للقراءة (مُجمَّد بعد Approve).

### E. اختبار الصلاحيات
مصفوفة لكل دور رئيسي (تيليماركتر، كاشير، مشرف، مدير فرع، أدمن) للتحقق من قبول/رفض كل route.

### F. خطوات التشغيل
```bash
pnpm run migrate            # تطبيق migration 266
pnpm --filter @golden-crm/web build
pm2 restart golden-crm-staging
pm2 logs golden-crm-staging
```

---

## القرارات المعلَّقة (للحوار في جلسة لاحقة)

- المنح الافتراضي للأدوار للصلاحيتين الجديدتين (`contracts.close`، `contracts.assign_sale_owner`).
- هل `POST /:id/approve` يستوجب `contracts.approve` فقط، أم `contracts.close` كذلك، أم أيٌّ منهما؟
- مراجعة شاملة لمصفوفة صلاحيات العقود (الـ 5 الأصلية + الجديدتين).
