# مكون مشترك: لقطة بيانات العقد (ContractSnapshot)

> **النوع:** Shared Data Contract + UI Component  
> **الحالة:** Draft — بانتظار مراجعة Product Owner  
> **النطاق:** عقود البيع `contract_type = sale_contract` بأنواعها الثلاثة: `definitive`, `temporary`, `free`  
> **الهدف:** توحيد قراءة وعرض بيانات العقد في صفحات الزبون، تفاصيل الجهاز، المهام، الزيارات، الفواتير، والطباعة القانونية.  
> **القاعدة:** العقد هو مصدر الحقيقة القانوني والمالي. الجهاز مصدره `installed_devices`. الزبون مصدره `clients`. لا نخلط هذه الحدود داخل snapshot واحد.

---

## 1. التشخيص الحالي

يوجد حالياً `open_tasks.contract_snapshot` ويُبنى داخل:

```ts
packages/api/routes/openTasks.ts
buildOpenTaskSnapshots()
```

لكنه يعاني من ثلاث فجوات:

1. لا يصرّح بشكل واضح بأنواع البيع الثلاثة `definitive / temporary / free`.
2. يضع بعض بيانات الجهاز داخل `contractSnapshot.device`، وهذا مناسب كسياق عقدي، لكنه ليس بديلاً عن `DeviceSnapshot`.
3. لا يوجد contract واضح لمستويات العرض: mini / standard / full.

**النتيجة:** كل شاشة قد تعرض العقد بطريقة مختلفة، وقد تستخدم حقولاً مبعثرة من `contracts` أو `installed_devices` أو `open_tasks.contract_snapshot` بدون قاعدة ثابتة.

---

## 2. مصدر الحقيقة وحدود الكيان

| نوع البيانات | مصدر الحقيقة | تدخل في ContractSnapshot؟ | ملاحظات |
|---|---|---:|---|
| رقم العقد، تاريخه، حالته | `contracts` | نعم | جوهر snapshot |
| نوع العقد | `contracts.contract_type` | نعم | حالياً `sale_contract` فقط في هذا النطاق |
| نوع البيع الفرعي | `contracts.sale_subtype` | نعم | `definitive / temporary / free` |
| البيانات المالية | `contracts` + `contract_installments` + `contract_payment_entries` | نعم | حسب مستوى snapshot |
| بيانات الزبون | `clients` أو `clientSnapshot` | لا، إلا كمرجع مختصر | الزبون له `ClientSnapshot` مستقل |
| بيانات الجهاز الفيزيائية | `installed_devices` أو `DeviceSnapshot` | مرجع مختصر فقط | الجهاز له `DeviceSnapshot` مستقل |
| النسخة القانونية المطبوعة | `contract_documents` | نعم في full فقط | frozen legal copy |
| مصدر البيع والعرض | `contracts.source_*` + pre-offers | نعم | مهم للتتبع |

---

## 3. الأنواع الثلاثة لعقد البيع

### 3.1 `definitive` — عقد بيع قطعي

الغرض: بيع مثبت ونهائي، مع أثر مالي طبيعي.

القواعد:

- يسمح بدفعات وتحصيلات وأقساط.
- يخلق جهازاً بعد الاعتماد.
- يخلق مهمة تسليم جهاز.
- يدخل في كشف حساب الزبون.
- قابل للحالة `completed` عند اكتمال الالتزامات المالية.

### 3.2 `temporary` — عقد مؤقت

الغرض: تسليم/تمليك مؤقت بانتظار الحسم لاحقاً.

القواعد:

- ليس حالة عقد. `temporary` قيمة داخل `sale_subtype`.
- الحالة العامة تبقى ضمن: `draft / active / cancelled / completed / discarded`.
- قد يخلق جهازاً ومسار تسليم، لكن يجب أن تكون الواجهة واضحة أن العلاقة مؤقتة.
- لا يجوز تحويله إلى `definitive` بصمت؛ التحويل يحتاج إجراء واضح وسجل تدقيق.
- snapshot يجب أن يحمل `temporaryPolicy` حتى لا تعرضه الواجهات كبيع قطعي.

### 3.3 `free` — عقد مجاني / هبة / تمليك بلا مقابل

الغرض: تمليك جهاز بلا التزام مالي على الزبون.

القواعد:

- `finalPrice = 0`
- لا أقساط.
- لا دفعات مطلوبة.
- يخلق جهازاً ومهام ما بعد البيع مثل البيع العادي.
- يظهر في تاريخ شراء الزبون كجهاز ممنوح/مجاني وليس كدين.
- snapshot يجب أن يحمل `financials.noFinancialObligations = true`.

---

## 4. مستويات العرض

### 4.1 Mini Contract Snapshot

يستخدم في القوائم والجداول:

- تبويب أجهزة الزبون
- قائمة المهام
- روابط العقود داخل صفحة الجهاز
- سجل الشراء المختصر

```ts
type MiniContractSnapshot = {
  id: number;
  contractNumber: string;
  contractDate: string | null;
  status: 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded';
  contractType: 'sale_contract';
  saleSubtype: 'definitive' | 'temporary' | 'free';
  subtypeLabel: string;
  customerId: number;
  customerName: string;
  finalPrice: number;
  currency: 'SYP';
  deviceLabel: string | null;
};
```

قاعدة العرض:

- السطر الرئيسي: `contractNumber`
- badge أول: `status`
- badge ثاني: `saleSubtype`
- السطر الثانوي: `deviceLabel` + `finalPrice`

---

### 4.2 Standard Contract Snapshot

يستخدم في تبويبات المهام وصفحة الجهاز وسجل الزبون:

```ts
type ContractSnapshot = {
  id: number;
  contractNumber: string;
  contractDate: string | null;
  status: 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded';
  contractType: 'sale_contract';
  saleSubtype: 'definitive' | 'temporary' | 'free';

  parties: {
    customerId: number;
    customerName: string;
    branchId: number | null;
    branchName: string | null;
    closingEmployeeId: number | null;
    closingEmployeeName: string | null;
    saleOwnerId: number | null;
  };

  commercial: {
    saleType: 'tradein' | 'retention' | 'direct' | null;
    saleSource: string | null;
    sourceOpenTaskId: number | null;
    sourceTaskOfferId: number | null;
    saleReferenceNumber: string | null;
  };

  deviceRef: {
    installedDeviceId: number | null;
    deviceModelId: number | null;
    deviceModelName: string | null;
    serialNumber: string | null;
  };

  financials: {
    paymentType: 'cash' | 'installment' | null;
    basePrice: number;
    finalPrice: number;
    downPayment: number;
    installmentsCount: number;
    currency: 'SYP';
    noFinancialObligations: boolean;
  };

  policy: {
    isDefinitive: boolean;
    isTemporary: boolean;
    isFree: boolean;
    requiresFinancialTracking: boolean;
    createsDevice: boolean;
    createsDeliveryTask: boolean;
  };
};
```

---

### 4.3 Full Contract Snapshot

يستخدم في صفحة تفاصيل العقد والطباعة والتدقيق:

```ts
type FullContractSnapshot = ContractSnapshot & {
  buyerIdentity: {
    motherName: string | null;
    nationalIdRegistry: string | null;
    nationalIdIssuedBy: string | null;
    nationalIdIssueDate: string | null;
    nationalIdBox: string | null;
    birthDate: string | null;
    gender: string | null;
  };

  lineItems: Array<{
    id?: number;
    itemType: 'device' | 'accessory' | 'service_fee';
    sparePartId: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isInstalled?: boolean;
  }>;

  paymentEntries: Array<{
    id: number;
    method: string;
    currency: 'SYP' | 'USD';
    amountValue: number;
    amountSyp: number;
    entryType: 'collection' | 'refund';
    paymentDate: string | null;
  }>;

  installments: Array<{
    id: number;
    installmentNumber: number;
    dueDate: string;
    amountSyp: number;
    remainingBalance: number;
    status: string;
  }>;

  legalDocument: {
    frozenDocumentId: number | null;
    templateVersion: string | null;
    frozenAt: string | null;
  };
};
```

---

## 5. Type Policies

### 5.1 Policy builder

كل ContractSnapshot يجب أن يحتوي policy مشتقة، لا نترك الشاشات تعيد اختراعها.

```ts
function buildContractPolicy(saleSubtype: string) {
  return {
    isDefinitive: saleSubtype === 'definitive',
    isTemporary: saleSubtype === 'temporary',
    isFree: saleSubtype === 'free',
    requiresFinancialTracking: saleSubtype !== 'free',
    createsDevice: true,
    createsDeliveryTask: true,
  };
}
```

### 5.2 قواعد مالية حسب النوع

| `saleSubtype` | `finalPrice` | installments | payment entries | customer statement |
|---|---:|---:|---:|---|
| `definitive` | قد يكون > 0 | نعم عند التقسيط | نعم | نعم |
| `temporary` | قد يكون 0 أو قيمة ضمان/اتفاق | حسب قرار العقد | بحذر وبوسم مؤقت | نعم لكن بوسم مؤقت |
| `free` | يجب أن يكون 0 | لا | لا، إلا ملاحظة إدارية غير مالية | لا دين |

---

## 6. API Builder المقترح

نضيف helper موحد:

```ts
export async function buildContractSnapshot(
  db,
  contractId: number,
  options?: { full?: boolean }
): Promise<ContractSnapshot | FullContractSnapshot | null>
```

الاستعلام القياسي:

```sql
SELECT
  c.id,
  c.contract_number,
  c.contract_date,
  c.status,
  c.contract_type,
  c.sale_subtype,
  c.customer_id,
  c.customer_name,
  c.branch_id,
  b.name AS branch_name,
  c.closing_employee_id,
  closer.name AS closing_employee_name,
  c.sale_owner_id,
  c.sale_type,
  c.sale_source,
  c.source_open_task_id,
  c.source_task_offer_id,
  c.sale_reference_number,
  c.installed_device_id,
  c.device_model_id,
  c.device_model_name,
  d.serial_number,
  c.payment_type,
  c.base_price,
  c.final_price,
  c.down_payment,
  c.installments_count
FROM contracts c
LEFT JOIN branches b ON b.id = c.branch_id
LEFT JOIN hr_users closer ON closer.id = c.closing_employee_id
LEFT JOIN installed_devices d ON d.contract_id = c.id
WHERE c.id = $1
```

---

## 7. أين يُخزن ContractSnapshot؟

### 7.1 `open_tasks.contract_snapshot`

يُخزن عند إنشاء أي مهمة مرتبطة بعقد:

- `device_delivery`
- `device_installation`
- `device_activation`
- `installment_collection`
- `dues_collection`
- أي مهمة خدمة مرتبطة بعقد

الهدف: قراءة المهمة تاريخياً حتى لو تغير العقد لاحقاً.

### 7.2 لا نخزنه في `contracts`

لأن `contracts` هو مصدر الحقيقة نفسه.

### 7.3 لا نستخدمه بدل الوثيقة القانونية

`ContractSnapshot` للعرض والتشغيل.  
الوثيقة القانونية المجمدة مصدرها `contract_documents`.

---

## 8. علاقة ContractSnapshot مع ClientSnapshot و DeviceSnapshot

```txt
ClientSnapshot   = من هو الزبون؟
ContractSnapshot = ما هو الاتفاق القانوني/المالي؟
DeviceSnapshot   = ما هو الجهاز الفيزيائي وأين هو الآن؟
```

داخل مهمة تسليم جهاز يجب أن تكون الثلاثة موجودة:

```json
{
  "clientSnapshot": {},
  "contractSnapshot": {},
  "deviceSnapshot": {}
}
```

قاعدة العرض:

- تبويب الزبون يستخدم `ClientSnapshot`
- تبويب العقد يستخدم `ContractSnapshot`
- تبويب الجهاز يستخدم `DeviceSnapshot`

لا يجوز أن يعرض تبويب العقد تفاصيل الموقع الفيزيائي كأنه مصدرها العقد إلا إذا كانت تحت `deviceRef` المختصر.

---

## 9. تطبيق على الأنواع الثلاثة

### 9.1 Definitive

```json
{
  "saleSubtype": "definitive",
  "policy": {
    "isDefinitive": true,
    "requiresFinancialTracking": true,
    "createsDevice": true,
    "createsDeliveryTask": true
  },
  "financials": {
    "finalPrice": 2500000,
    "noFinancialObligations": false
  }
}
```

### 9.2 Temporary

```json
{
  "saleSubtype": "temporary",
  "policy": {
    "isTemporary": true,
    "requiresFinancialTracking": true,
    "createsDevice": true,
    "createsDeliveryTask": true
  },
  "financials": {
    "noFinancialObligations": false
  }
}
```

عرض UI إلزامي:

- badge واضح: `عقد مؤقت`
- تنبيه في التفاصيل: يحتاج حسم لاحق
- لا يظهر كبيع قطعي في تاريخ الشراء

### 9.3 Free

```json
{
  "saleSubtype": "free",
  "policy": {
    "isFree": true,
    "requiresFinancialTracking": false,
    "createsDevice": true,
    "createsDeliveryTask": true
  },
  "financials": {
    "finalPrice": 0,
    "downPayment": 0,
    "installmentsCount": 0,
    "noFinancialObligations": true
  }
}
```

عرض UI إلزامي:

- badge واضح: `مجاني / هبة`
- لا تظهر مطالبات دفع
- لا تظهر أقساط
- يظهر الجهاز ضمن أجهزة الزبون كسجل تمليك بلا مقابل

---

## 10. خطة تطبيق قصيرة

1. إنشاء `buildContractSnapshot()` في API كـ helper منفصل.
2. تعديل `buildOpenTaskSnapshots()` ليستدعي helper بدل بناء contract snapshot داخلياً.
3. إضافة `deviceSnapshot` في نفس مسار إنشاء المهام عند وجود `device_id`.
4. تعديل `TaskContractTab` ليعتمد على shape القياسي.
5. تعديل صفحة تفاصيل الجهاز وPurchase History لاستخدام `MiniContractSnapshot`.
6. توثيق أن `free` لا يولد أي أثر مالي في `customerStatement`.
7. توثيق أن `temporary` يحتاج مسار حسم لاحق ولا يتحول بصمت إلى `definitive`.

---

## 11. Definition of Done

- أي مهمة مرتبطة بعقد تحمل `contract_snapshot` بنفس shape.
- الأنواع الثلاثة تظهر بوضوح في UI بدون منطق متكرر في كل شاشة.
- عقد مجاني لا يظهر كدين ولا يملك أقساطاً.
- عقد مؤقت لا يظهر كبيع قطعي.
- `contractSnapshot.deviceRef` لا يحل محل `DeviceSnapshot`.
- الوثيقة القانونية المجمدة تبقى في `contract_documents` ولا تُستبدل بالـ snapshot.
