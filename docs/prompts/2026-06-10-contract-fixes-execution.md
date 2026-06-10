# برومت تنفيذ إصلاحات العقود — 2026-06-10

## السياق

خطة `docs/constitution/plans/2026-06-10-contract-form-fixes.md` معتمدة وتم تنفيذها جزئياً على الـ `working tree` (غير `committed`). لكن قاعدة البيانات `golden_crm_staging` على `localhost:5432` بها `constraint` مكسور على `contracts.status`.

## المشكلة

الـ `contracts_status_check` الحالي بالقاعدة:
```
CHECK (status IN ('active', 'cancelled', 'temporary'))
```

المطلوب (من `001_initial_schema.sql`):
```
CHECK (status IN ('draft', 'active', 'cancelled', 'completed', 'discarded'))
```

بسبب هذا: العقود ما بتتحفظ كـ `draft` (الخطأ: `violates check constraint contracts_status_check`).

## المطلوب التنفيذ

### 1. إصلاح عاجل: `contracts_status_check` مكسور

قاعدة البيانات `golden_crm_staging` على `localhost:5432`:
- الـ `constraint` الحالي: `CHECK (status IN ('active', 'cancelled', 'temporary'))`
- المطلوب: `CHECK (status IN ('draft', 'active', 'cancelled', 'completed', 'discarded'))`

**خطوات:**
```bash
PGPASSWORD=ASMA2026 psql -U golden_crm_staging -h localhost -p 5432 -d golden_crm_staging
```

```sql
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'active', 'cancelled', 'completed', 'discarded'));
```

### 2. تطبيق Migration 266 (Permissions)

```bash
cd /opt/golden-crm/apps/staging
PGPASSWORD=ASMA2026 psql -U golden_crm_staging -h localhost -p 5432 -d golden_crm_staging -f migrations/266_add_contracts_close_and_assign_permissions.sql
```

### 3. Commit التعديلات المعلّقة (Working Tree)

الملفات المعدّلة:
- `packages/web/src/pages/contracts/ContractForm.tsx` — خطة 2026-06-10 (5 أجزاء)
- `packages/api/routes/contracts.ts` — backend validation + saleOwnerId + permissions
- `packages/web/src/components/GeoSmartSearch.tsx` — export buildPath/pathToSelection
- `migrations/266_add_contracts_close_and_assign_permissions.sql` — جديد

```bash
cd /opt/golden-crm/apps/staging
git add -A
git commit -m "feat(contracts): implement 2026-06-10 contract form fixes plan

- Part 1: Draft mode (isValid distinguishes draft vs active)
- Part 2: Restore edit data (geo, discount, warranty, installments, saleOwner)
- Part 3: Legal info tied to payment type (installment=required, cash=optional)
- Part 4: sale_owner_id with auto-fill from demo team + freeze on approve
- Part 5: Add contracts.close + contracts.assign_sale_owner permissions
- Backend: NID 11-digit validation, saleOwnerId permission checks, approve freeze
- GeoSmartSearch: export buildPath/pathToSelection for contract geo restoration
- Fix contracts_status_check DB constraint (was missing draft/completed/discarded)"
```

### 4. Build & Restart

```bash
cd /opt/golden-crm/apps/staging
pnpm --filter @golden-crm/web build
pm2 restart golden-crm-staging
```

---

## ملاحظات فنية

- **لا** تعدل `contracts_status_check` بـ migration file جديد — طبّق مباشرة بـ `psql` لأن الـ constraint مكسور بقاعدة البيانات الحية.
- **Database credentials:** `golden_crm_staging:ASMA2026@localhost:5432/golden_crm_staging`
- **PM2 process:** `golden-crm-staging`
- **Port:** `3001`
- **NEVER touch production** (`/opt/golden-crm/app/GoldenGroup2`)
