# TASK: بيانات الأسماء المقترحة ولوائح الأسماء

## الهدف
توحيد وتحسين تجربة "جمع الأسماء" (Name Collections) و"لوائح الأسماء" (Referral Sheets) و"الترشيحات المباشرة" (Direct Suggestions) بحيث:
1. كل اسم مقترح يصير له MiniClientSnapshot (إذا صار زبون)
2. لوائح الأسماء تظهر بوضوح وترتبط بالزيارة
3. التحويل التلقائي من suggestion → candidate → client

## الكيانات الثلاثة

### 1. visit_name_collections (جمع الأسماء بالزيارة)
```sql
CREATE TABLE visit_name_collections (
    id SERIAL PRIMARY KEY,
    visit_task_id INTEGER NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),          -- ← الزبون يلي عم يجمع أسماء
    proposed_count INTEGER NOT NULL DEFAULT 0,          -- العدد المقترح
    actual_count INTEGER NOT NULL DEFAULT 0,            -- العدد الفعلي المجمّع
    referral_sheet_id INTEGER,                          -- ← رابط لـ referral_sheet
    status VARCHAR(50) CHECK (status IN ('pending','partial','completed')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**الحالة الحالية:**
- `client_id` موجود بس ما في `client_snapshot`
- المودال بيعرض بس `proposed_count` vs `actual_count` (رقم صافي)
- **ما في قائمة الأسماء الفعلية**

**المطلوب:**
- أضف `client_snapshot JSONB` (MiniClientSnapshot)
- غيّر المودال ليعرض:
  - معلومات الزبون (MiniClientSnapshot)
  - قائمة الأسماء المجمّعة (إذا موجودة)
  - حالة الإنجاز (pending / partial / completed)

### 2. direct_suggestions (الترشيحات المباشرة)
```sql
CREATE TABLE direct_suggestions (
    id SERIAL PRIMARY KEY,
    visit_task_id INTEGER NOT NULL REFERENCES visit_tasks(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id),           -- ← إذا صار زبون
    name VARCHAR(255) NOT NULL,                         -- الاسم
    phone VARCHAR(50),                                  -- رقم التلفون
    is_direct BOOLEAN DEFAULT TRUE,                       -- ترشيح مباشر من الزبون
    status VARCHAR(50) CHECK (status IN ('pending','contacted','converted')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**الحالة الحالية:**
- بس `name` + `phone` — ما في `client_snapshot`
- الترشيحات معزولة عن `clients` و `candidates`

**المطلوب:**
- أضف `suggester_snapshot JSONB` — MiniClientSnapshot للزبون يلي قدّم الترشيح
- ربط تلقائي: إذا `phone` موجود بـ `clients`، ربط `client_id`
- إضافة زر "تحويل لمرشح" (Convert to Candidate)

### 3. referral_sheets (لوائح الأسماء)
```sql
CREATE TABLE referral_sheets (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER REFERENCES branches(id),
    owner_user_id INTEGER REFERENCES hr_users(id),
    type VARCHAR(50),                                   -- 'client_visit' | 'telemarketing' | 'field_campaign'
    source_client_id INTEGER REFERENCES clients(id),      -- ← الزبون المصدر (إذا من زيارة)
    target_candidates INTEGER NOT NULL DEFAULT 0,       -- العدد المستهدف
    total_candidates INTEGER NOT NULL DEFAULT 0,        -- العدد الفعلي
    status VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**الحالة الحالية:**
- `source_client_id` موجود بس ما في `source_client_snapshot`
- `total_candidates` = عدد صافي — ما في قائمة

**المطلوب:**
- أضف `source_client_snapshot JSONB` (MiniClientSnapshot)
- أضف `candidate_entries JSONB[]` — قائمة المرشحين المرتبطين
- ربط تلقائي بـ `visit_name_collections` و `direct_suggestions`

## الميزات الجديدة المطلوبة

### 1. عرض الزبون بالـ Name Collection Modal
```
┌─────────────────────────────────────────────┐
│  [👨]  أحمد محمد علي  [OP]                  │  ← MiniClientSnapshot
│  0991234567  ·  فيلات غربية — بناية 5       │
│  أحمد علي +1                                │
├─────────────────────────────────────────────┤
│  العدد المقترح: 5                            │
│  العدد الفعلي: [___3____]                   │
│  الحالة: جزئي                              │
├─────────────────────────────────────────────┤
│  الأسماء المجمّعة:                           │
│  1. باسل حميد — 0933111222                  │
│  2. سارة عمر — 0944555666                  │
│  [+ إضافة اسم]                             │
└─────────────────────────────────────────────┘
```

### 2. تحويل تلقائي لـ Candidate
- لما `actual_count >= proposed_count` → status = completed
- لما status = completed → توليد candidates تلقائياً من الأسماء المجمّعة
- ربط كل candidate بـ `referral_sheet_id`

### 3. Direct Suggestions بـ MiniClientSnapshot
```
┌─────────────────────────────────────────────┐
│  الترشيحات المباشرة من:                      │
│  [👨]  أحمد محمد علي  [OP]                  │  ← MiniClientSnapshot
├─────────────────────────────────────────────┤
│  1. باسل حميد — 0933111222 [تحويل لمرشح]   │
│  2. سارة عمر — 0944555666 [تحويل لمرشح]   │
└─────────────────────────────────────────────┘
```

## Migration مطلوبة
```sql
-- migrations/177_name_collections_snapshots.sql
ALTER TABLE visit_name_collections ADD COLUMN IF NOT EXISTS client_snapshot JSONB;
ALTER TABLE direct_suggestions ADD COLUMN IF NOT EXISTS suggester_snapshot JSONB;
ALTER TABLE referral_sheets ADD COLUMN IF NOT EXISTS source_client_snapshot JSONB;
ALTER TABLE referral_sheets ADD COLUMN IF NOT EXISTS candidate_entries JSONB DEFAULT '[]'::jsonb;
```

## Prompt للمنفذ
انظر: `docs/tasks/TASK_NAME_COLLECTIONS_REFERRAL_SHEETS_PROMPT.md`
