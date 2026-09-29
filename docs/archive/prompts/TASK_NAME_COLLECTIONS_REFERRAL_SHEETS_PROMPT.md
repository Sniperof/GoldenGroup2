# PROMPT: بيانات الأسماء المقترحة ولوائح الأسماء

## الهدف
حسّن تجربة "جمع الأسماء" (Name Collections) و"الترشيحات المباشرة" (Direct Suggestions) و"لوائح الأسماء" (Referral Sheets) بحيث:
1. الزبون (المجمع) يظهر بـ MiniClientSnapshot
2. الأسماء المجمّعة تظهر بقائمة واضحة
3. التحويل التلقائي لـ Candidate

## المكونات

### 1. MiniClientSnapshot في NameCollectionModal
- استخدم `MiniClientSnapshot` component (أو استنسخ المنطق من Clients table)
- اعرض:
  - Avatar (gender + dataQuality)
  - الاسم الكامل + classification badge
  - رقم الموبايل
  - العنوان المختصر (آخر مستويين من geo_units)
  - المسؤول/ين أو الفرع

### 2. قائمة الأسماء المجمّعة
غيّر المودال ليعرض:
```
┌─────────────────────────────────────────────┐
│  [👨]  أحمد محمد علي  [OP]                  │
│  0991234567  ·  فيلات غربية — بناية 5       │
│  أحمد علي +1                                │
├─────────────────────────────────────────────┤
│  العدد المقترح: 5                            │
│  العدد الفعلي: [___3____]                   │
├─────────────────────────────────────────────┤
│  الأسماء المجمّعة (3/5):                     │
│  ┌─────────────────────────────────────┐   │
│  │ 1. باسل حميد                        │   │
│  │    0933111222                       │   │
│  │    [حذف] [تحويل لمرشح]            │   │
│  ├─────────────────────────────────────┤   │
│  │ 2. سارة عمر                        │   │
│  │    0944555666                       │   │
│  │    [حذف] [تحويل لمرشح → تم]       │   │
│  ├─────────────────────────────────────┤   │
│  │ [+ إضافة اسم جديد]                │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 3. Direct Suggestions بـ MiniClientSnapshot
- أضف `suggester_snapshot JSONB` لـ `direct_suggestions`
- املأه من `clients` لما الزبون يقدم ترشيح
- في Visit Detail Page، اعرض قسم:
```
┌─────────────────────────────────────────────┐
│  الترشيحات المباشرة (2)                     │
├─────────────────────────────────────────────┤
│  من: [👨]  أحمد محمد علي  [OP]              │
│  ─────────────────────────────────────────  │
│  1. باسل حميد — 0933111222                  │
│     [تحويل لمرشح]                            │
│  2. سارة عمر — 0944555666                  │
│     [تم التحويل] ← رابط للمرشح #123        │
└─────────────────────────────────────────────┘
```

### 4. Referral Sheets بـ Source Client Snapshot
- أضف `source_client_snapshot JSONB` لـ `referral_sheets`
- املأه لما تولّد من `visit_name_collections`
- اعرض:
```
┌─────────────────────────────────────────────┐
│  لائحة ترشيح #45                            │
│  المصدر: [👨]  أحمد محمد علي  [OP]          │
│  الزيارة: #90145 — 2026-05-20              │
├─────────────────────────────────────────────┤
│  المستهدف: 5  |  الفعلي: 3  |  المتبقي: 2  │
│  ─────────────────────────────────────────  │
│  المرشحون (3):                               │
│  1. باسل حميد — pending                     │
│  2. سارة عمر — contacted                   │
│  3. خالد فهد — converted → زبون #456       │
└─────────────────────────────────────────────┘
```

### 5. التحويل التلقائي لـ Candidate
- لما `visit_name_collections.status = 'completed'`
- و `actual_count >= proposed_count`
- ولّد `candidates` تلقائياً من الأسماء المجمّعة:
```typescript
// packages/api/services/nameCollectionService.ts
async function autoGenerateCandidates(nameCollectionId: number) {
  const names = await getCollectedNames(nameCollectionId);
  for (const name of names) {
    const candidate = await createCandidate({
      name: name.name,
      phone: name.phone,
      source: 'referral_sheet',
      referral_sheet_id: nameCollection.referral_sheet_id,
      status: 'New',
    });
    await linkCandidateToReferralSheet(candidate.id, nameCollection.referral_sheet_id);
  }
}
```

## Migration
```sql
-- migrations/177_name_collections_snapshots.sql
ALTER TABLE visit_name_collections ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE direct_suggestions ADD COLUMN IF NOT EXISTS suggester_snapshot JSONB;
ALTER TABLE referral_sheets ADD COLUMN IF NOT EXISTS source_client_snapshot JSONB;
```

## ملفات للقراءة
- `docs/constitution/components/client-snapshot.md` (Mini Snapshot)
- `packages/web/src/components/NameCollectionModal.tsx`
- `packages/api/routes/fieldVisits.ts` (name collection endpoints)
- `migrations/082_visit_name_collections.sql`
- `migrations/083_direct_suggestions.sql`
- `migrations/022_referral_sheets_authorization_foundation.sql`

## قواعد
- Western numerals فقط
- إذا الاسم فاضي بالـ DB → "غير محدد"
- إذا الموبايل فاضي → "—"
- إذا العنوان فاضي → "—"
- التصنيف badge: LEAD (رمادي), OP (أزرق), FOP (أخضر)
