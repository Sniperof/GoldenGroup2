# Prompt: Client Account Statement (كشف حساب الزبون)

## Objective
Implement a unified financial ledger (كشف حساب) inside the Client Profile page. It must display all client financial movements (contract payments + task payments + future installments) in a single chronological table with a running balance.

## Context
- Working directory: `/opt/golden-crm/apps/staging`
- Database: `golden_crm_staging`
- Server: PM2 `golden-crm-staging`, port 3001
- DO NOT touch production. Staging only.
- `git commit` before every file modification.
- Code style: match existing project patterns (React + Vite + Tailwind, Sky Blue theme).
- Language: Arabic UI labels, English code/fields.

## Database Changes

### Migration 1: `migrations/257_create_client_ledger_entries.sql`
```sql
CREATE TABLE client_ledger_entries (
    id              SERIAL PRIMARY KEY,
    client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entry_date      TIMESTAMP WITH TIME ZONE NOT NULL,
    entry_type      VARCHAR(50) NOT NULL CHECK (entry_type IN (
        'contract_payment',
        'maintenance_payment',
        'contract_installment',
        'contract_discount',
        'refund',
        'opening_balance'
    )),
    source_type     VARCHAR(50),  -- 'contract' | 'maintenance_request'
    source_id       INTEGER,
    description     TEXT NOT NULL,
    reference_no    VARCHAR(100),
    debit_amount    DECIMAL(12,2) DEFAULT 0,
    credit_amount   DECIMAL(12,2) DEFAULT 0,
    running_balance DECIMAL(12,2) NOT NULL,
    recorded_by     INTEGER REFERENCES hr_users(id),
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ledger_client_date ON client_ledger_entries(client_id, entry_date);
CREATE INDEX idx_ledger_source ON client_ledger_entries(source_type, source_id);
```

### Migration 2: `migrations/258_seed_ledger_historical.sql`
Backfill ledger from existing tables:
- `contract_payments` → `entry_type = 'contract_payment'`, `source_type = 'contract'`, `credit_amount = payment.amount`
- `financial_transactions` → `entry_type = 'maintenance_payment'`, `source_type = 'maintenance_request'`, `credit_amount = transaction.amount`
- `contract_installments` (future-dated only) → `entry_type = 'contract_installment'`, `source_type = 'contract'`, `debit_amount = installment.amount`

For `running_balance`, calculate chronologically per client.

### Migration 3: `migrations/259_add_ledger_triggers.sql`
Create a PostgreSQL function `recalculate_client_balance(p_client_id INT)` that recalculates `running_balance` for all entries of that client ordered by `entry_date`, `id`.

Create triggers on `contract_payments` and `financial_transactions` so that `INSERT`/`UPDATE`/`DELETE` automatically:
1. Inserts/updates/deletes the corresponding `client_ledger_entries` row.
2. Calls `recalculate_client_balance` for the affected client.

## Backend Changes

### File: `packages/api/routes/clients.ts`

Add endpoint:
```
GET /api/clients/:id/account-statement
Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&types=contract_payment,maintenance_payment,contract_installment
```

Implementation requirements:
- Query `client_ledger_entries` filtered by `client_id` and optional date range + type filter.
- Return JSON with:
  - `summary`: `{ total_owed, total_paid, current_balance, overdue_amount }`
  - `entries`: array sorted by `entry_date ASC, id ASC`
- `overdue_amount` = sum of `debit_amount` for `contract_installment` entries where `entry_date < NOW()` and no corresponding `credit_amount` has covered it.
- Use `auth` middleware.
- Follow the exact error handling pattern used in the existing `clients.ts` routes.

## Frontend Changes

### File: `packages/web/src/lib/api.ts`

Add method:
```typescript
getAccountStatement(id: number, params?: { from?: string; to?: string; types?: string }) => Promise<AccountStatementResponse>
```

### File: `packages/web/src/pages/ClientProfile.tsx`

Add a new tab `كشف الحساب` after the existing tabs.

Create component `AccountStatementTab` inside the same file or in a new file `components/AccountStatementTab.tsx` (whichever matches the project's existing pattern better).

UI Requirements:
1. **Summary Cards** at top (3 cards):
   - `إجمالي العليه` (total_owed) — red color
   - `إجمالي الدفع` (total_paid) — green color
   - `الرصيد الحالي` (current_balance) — red if negative, green if positive

2. **Filter Bar**:
   - Date range: `من` / `إلى` (default: last 6 months to today + next 6 months for future installments)
   - Type filter: `[الكل] [عقود] [مهمات] [أقساط]` — toggle buttons

3. **Data Table** (RTL):
   - Columns: التاريخ | الوصف | المرجع | مدين (عليه) | دائن (دفع) | الرصيد
   - Sort: `entry_date` ascending
   - Row styling:
     - `credit > 0` → green text (`text-emerald-600`)
     - `debit > 0` → red text (`text-red-600`)
     - `entry_type = 'contract_installment'` + `entry_date > today` → gray background (future)
   - Right-click or row click → navigate to source (`contract/:id` or `maintenance/:id`)

4. **Empty State**: `لا توجد حركات مالية مسجلة` with an icon

5. **Loading State**: shimmer skeleton matching the project's existing loading pattern

## Integration Rules
- The `client_ledger_entries` table is the source of truth for the account statement.
- All existing payment flows (contract payment modal, maintenance payment modal) must continue to work as-is. The ledger should be auto-populated via triggers, not by changing frontend logic.
- Do NOT modify the existing `contract_payments` or `financial_transactions` UI logic.
- Use the existing `useToast` hook for error messages.
- Use the existing `api` client for the new endpoint.

## Verification Steps
1. After running migrations, verify: `SELECT COUNT(*) FROM client_ledger_entries` should be > 0 for clients with historical payments.
2. Add a test payment via the existing contract payment modal → check if a new `client_ledger_entries` row appears within 1 second.
3. Open the Client Profile → `كشف الحساب` tab → verify the running balance is correct.
4. Delete the test payment → verify the ledger entry is removed and the balance recalculates.

## Constraints
- STAGING ONLY. Never touch `/opt/golden-crm/app/GoldenGroup2`.
- `git commit` after each migration and after the API + frontend changes.
- Match the existing Tailwind color palette (Sky Blue `sky-500` / `sky-600` for primary buttons).
- All UI labels must be Arabic.
- Maximum decimal precision: `DECIMAL(12,2)`.
- Do NOT use raw SQL in frontend. Use the `api` abstraction.
- If the trigger approach fails or causes recursion issues, switch to API-side `INSERT`/`UPDATE` after the payment API endpoints and document it in the commit message.

## Deliverables
1. `migrations/257_create_client_ledger_entries.sql`
2. `migrations/258_seed_ledger_historical.sql`
3. `migrations/259_add_ledger_triggers.sql`
4. Modified `packages/api/routes/clients.ts`
5. Modified `packages/web/src/lib/api.ts`
6. Modified `packages/web/src/pages/ClientProfile.tsx` (new tab + component)
7. `git commit` messages for each logical group.
8. PM2 server restart after backend changes.
