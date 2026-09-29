# TASK: إصلاح getCompanyOwnedClients ليشمل contract installation zones

## المشكلة

مهمة `device_delivery` (أو أي مهمة بـ `location_basis = 'contract'`) بـ zone 267 (contract installation zone):
- `countsByZone` query بيشوفها → count ظهر ✅
- بس `syncAssignedTasks` ما بيعمل assign ❌
- `contact_targets` ما بيتنشأ ❌

السبب: `getCompanyOwnedClients` بيفلتر clients حسب `clients.neighborhood` **فقط**:
```sql
NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
AND c.neighborhood::int = ANY($2::int[])
```

Client neighborhood = 47، بس contract installation zone = 267.
إذا team route = zone 267 → `getCompanyOwnedClients` ما بيلاقي client → sync ما بيصير.

## الملف المستهدف

`packages/api/services/customerOwnership.ts`

## التعديل المطلوب

في `getCompanyOwnedClients` (~سطر 145)، بدّل شرط الـ zone:

### الحالي:
```sql
       AND NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
       AND c.neighborhood::int = ANY($2::int[])
```

### الجديد:
```sql
       AND (
         -- Zone via client neighborhood
         (
           NULLIF(c.neighborhood, '') ~ '^[0-9]+$'
           AND c.neighborhood::int = ANY($2::int[])
         )
         -- OR zone via contract installation address
         OR EXISTS (
           SELECT 1
           FROM contracts ct2
           WHERE ct2.customer_id = c.id
             AND ct2.installation_geo_unit_id = ANY($2::int[])
         )
       )
```

## السبب التقني

Company-owned client = client يلي branch تبعو. Team يلي بيشتغل بمنطقة معينة (zoneIds) لازم تشوف **كل** clients يلي عندهم activity بهاي المنطقة — بغض النظر إذا الـ activity address = client neighborhood أو contract installation zone.

`location_basis = 'contract'` بيعني الـ task zone = `contracts.installation_geo_unit_id`، مش `clients.neighborhood`. فـ `getCompanyOwnedClients` لازم يشمل clients يلي عندهم contract بـ zoneIds.

## Deliverables

- [ ] تعديل `getCompanyOwnedClients` ليشمل contract installation zones
- [ ] Build passed
- [ ] Test: مهمة `device_delivery` بـ zone ≠ client neighborhood → بتظهر بـ work scope → بتتعمل assign → contact_target بيتنشأ
