# Golden CRM - Staging Environment

## Project Overview
Golden CRM is a full-stack HR/CRM system built with:
- **Backend:** Node.js + Express + TypeScript (packages/api)
- **Frontend:** React + Vite + Tailwind CSS (packages/web)
- **Database:** PostgreSQL
- **Package Manager:** pnpm (monorepo with workspaces)

## Architecture
- `packages/api/` - Express API server (entry: packages/api/index.ts)
- `packages/web/` - React frontend (Vite + Tailwind)
- `packages/shared/` - Shared types and utilities
- `migrations/` - SQL migration files (numbered 001-052+)
- `scripts/` - Deployment and utility scripts

## Database
- **Staging DB:** golden_crm_staging on localhost:5432
- **Connection:** via DATABASE_URL in .env file
- **Migrations:** Run with `pnpm run migrate` or manually via psql

## Server
- **Staging runs on:** port 3001
- **PM2 process:** golden-crm-staging
- **Restart:** `pm2 restart golden-crm-staging`
- **Logs:** /var/log/golden-crm/staging/

## Rules
- ALWAYS work in /opt/golden-crm/apps/staging directory
- NEVER touch /opt/golden-crm/app/GoldenGroup2 (that's production!)
- ALWAYS test changes on staging before suggesting production deployment
- Use the staging .env file at /opt/golden-crm/apps/staging/.env
- When modifying files, be precise - read only what's needed, modify only what's specified

## Permissions And Authorization
- Before changing authentication, roles, permissions, scopes, branch filtering, or record ownership, read `docs/constitution/domains/permissions-engineering-standard.md`.
- The mandatory authorization model is `identity + permission + scope + subject = decision`.
- `requirePermission()` is a capability gate only. Record routes must load the subject and authorize its `branchId` and, where applicable, `assignedUserId` through a domain policy.
- Frontend visibility, `localStorage`, textual role names, and JWT branch claims are never sufficient authorization controls.
- Do not introduce new permission behavior independently in REST and tRPC. Put shared decisions in one service/policy and make both surfaces call it.
- `role_permission_grants` is the target source of truth. Do not add new security decisions that depend directly on legacy `role_permissions`.
- Any permission add, delete, rename, or scope change must include its migration/catalog update, backend enforcement, UI usage where relevant, tests, audit inventory, and `صلاحيات_النظام.xlsx` update. Mark additions green and removals red in the workbook.
- Required negative tests include missing permission, wrong branch, and unassigned subject. Required positive tests cover every allowed scope plus the explicit super-admin path.

## Common Commands
```
pnpm install                          # Install dependencies
pnpm --filter @golden-crm/api dev    # Run dev server
pnpm run migrate                      # Run database migrations
pnpm --filter @golden-crm/web build  # Build frontend
pm2 restart golden-crm-staging        # Restart staging server
pm2 logs golden-crm-staging           # Check staging logs
```
