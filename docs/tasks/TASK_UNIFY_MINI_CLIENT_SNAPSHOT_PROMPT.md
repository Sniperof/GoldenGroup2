# PROMPT: توحيد Mini ClientSnapshot عبر المشروع

## الهدف
أضف `client_snapshot JSONB` لـ 4 جداول وطبّق MiniClientSnapshot الموحّد على الـ Frontend.

## Migration
```sql
-- migrations/176_add_client_snapshots.sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE emergency_tickets ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
ALTER TABLE telemarketing_appointments ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE field_visits ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
```

## الخطوات

### 1. أنشئ دالة مشتركة
```typescript
// packages/api/services/clientSnapshotService.ts
export interface MiniClientSnapshot {
  fullName: string;          // first + father + last
  classification: string | null;  // LEAD | OP | FOP
  primaryMobile: string;     // clients.mobile
  addressShort: string;        // آخر مستويين من geo_units
  ownershipDisplay: string;  // أول مسؤول + "+N" أو اسم الفرع
  avatar: {
    gender: 'male' | 'female' | null;
    dataQuality: 'Complete' | 'Partial' | 'Minimal' | null;
  };
}

export async function buildMiniClientSnapshot(db: Queryable, clientId: number): Promise<MiniClientSnapshot | null>
```

### 2. عدّل كل Route
- **contracts.ts:**
  - أضف `c.client_snapshot AS "clientSnapshot"` لـ `contractSelect`
  - بعد INSERT/UPDATE بـ `customer_id`، استدعِ `buildMiniClientSnapshot` وحدّث `client_snapshot`
- **emergencyTickets.ts:**
  - نفس المنطق — عند إنشاء/تحديث ticket مع `client_id`
- **telemarketing.ts:**
  - نفس المنطق + ربط `client_id`
- **fieldVisits.ts:**
  - حدّث `customer_snapshot` ليصير `client_snapshot` بنفس الشكل الموحّد

### 3. Backfill
اكتب script SQL أو TypeScript يعبّي `client_snapshot` لكل السجلات الموجودة من `clients` + `geo_units` + `client_assignments`.

### 4. Frontend
- استبدل كل عرض `customerName` flat بـ:
```tsx
<MiniClientSnapshot data={contract.clientSnapshot} />
```
- المكوّن بيعرض:
```
[👩]  أحمد محمد علي  [OP]
0991234567  ·  فيلات غربية — بناية 5
أحمد علي +1
```

### 5. اختبار
- تأكد إن `addressShort` = آخر مستويين متتاليين من geo_units
- تأكد إن `ownershipDisplay` = اسم أول مسؤول + "+N" أو اسم الفرع
- تأكد إن الأرقام Western numerals فقط

## ملفات للقراءة
- `docs/constitution/components/client-snapshot.md` (المستوى الأول)
- `packages/api/routes/openTasks.ts` (buildOpenTaskSnapshots للمرجع)
- `packages/web/src/components/ClientAvatar.tsx`
