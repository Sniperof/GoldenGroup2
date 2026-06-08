# TASK: توحيد Mini ClientSnapshot عبر المشروع

## الهدف
تطبيق Mini ClientSnapshot الموحّد (المستوى الأول) على كل الأماكن يلي بيعرضو بيانات الزبون بشكل مختصر.

## Mini ClientSnapshot — تلخيص
```
[👩/👨]  الاسم الكامل  [OP]          ← avatar + name + classification badge
0991234567  ·  العنوان المختصر        ← mobile + addressShort
المسؤول +N  أو  فرع دمشق             ← ownershipDisplay
```

## الأماكن المستهدفة (بالترتيب)

### 1. contracts (العقود)
- **الحالة:** `customer_name` flat text — ما في `client_snapshot`
- **Migration:** نعم — `ALTER TABLE contracts ADD COLUMN client_snapshot JSONB`
- **API:** `buildMiniClientSnapshot()` — دالة مشتركة
- **Frontend:** استبدال `customerName` بـ `MiniClientSnapshot` component

### 2. emergency_tickets (الطوارئ)
- **الحالة:** `client_name` + `client_address` flat text
- **Migration:** نعم — `ALTER TABLE emergency_tickets ADD COLUMN client_snapshot JSONB`
- **GAP:** GAP-002

### 3. telemarketing_appointments (المواعيد)
- **الحالة:** `customer_name` + `customer_mobile` flat text — ما في `client_id`
- **Migration:** نعم — `ALTER TABLE telemarketing_appointments ADD COLUMN client_id INTEGER, ADD COLUMN client_snapshot JSONB`
- **GAP:** GAP-003

### 4. field_visits (الزيارات)
- **الحالة:** `customer_snapshot` موجود بس مش متطابق مع VDP rules
- **Migration:** `ALTER TABLE field_visits ALTER COLUMN customer_snapshot TYPE JSONB` (update shape)
- **GAP:** GAP-004

## Migration موحّدة
```sql
-- migrations/176_add_client_snapshots.sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE emergency_tickets ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
```

## الدالة المشتركة
```typescript
// packages/api/services/clientSnapshotService.ts
export async function buildMiniClientSnapshot(
  db: Queryable,
  clientId: number
): Promise<MiniClientSnapshot> {
  // JOIN clients + geo_units + client_assignments + hr_users
  // Return: { fullName, classification, primaryMobile, addressShort, ownershipDisplay, avatar }
}
```

## Prompt للمنفذ
انظر: `docs/tasks/TASK_UNIFY_MINI_CLIENT_SNAPSHOT_PROMPT.md`
