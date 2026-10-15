# Swagger Documentation Completion Report

This document details the finalization of the Swagger (OpenAPI 3.0) documentation for the Golden CRM staging APIs. All 13 final route files have been fully annotated, registered, and validated.

## Summary of Changes
- All final **13 route files** are annotated with complete OpenAPI 3.0 specifications.
- Registered all 13 files in the `apis` array of `packages/api/swagger.ts`.
- Formatted with headers, query params, request body, and response schemas. No empty schemas.
- Configured security schemes (e.g. `bearerAuth`) correctly for protected endpoints.
- Provided `X-Branch-Id` header across all routes with `required: false`.

---

## Route Modules & Tags Completed

### A. HR Routes
1. **`vacancies.ts`** (Tag: `HR → Vacancies`)
   - `GET /` — List vacancies
   - `GET /:id` — Get vacancy details
   - `POST /` — Create vacancy
   - `PUT /:id` — Update vacancy
   - `PATCH /:id/status` — Update vacancy status
2. **`publicVacancies.ts`** (Tag: `Public → Vacancies`)
   - `GET /` — List public vacancies (Public, no security)
   - `GET /:id` — Get public vacancy by ID (Public, no security)
3. **`interviews.ts`** (Tag: `HR → Interviews`)
   - `GET /` — List interviews
   - `POST /` — Create interview
   - `GET /:id` — Get interview by ID
   - `PUT /:id` — Update interview
   - `DELETE /:id` — Delete interview
   - `GET /:id/history` — Get interview state history
   - `POST /:id/reschedule` — Reschedule interview
4. **`trainingCourses.ts`** (Tag: `HR → Training`)
   - `GET /` — List courses
   - `POST /` — Create course
   - `GET /:id` — Get course details
   - `PUT /:id` — Update course
   - `DELETE /:id` — Delete course
   - `POST /:id/enroll` — Enroll candidates
   - `DELETE /:id/enroll` — Remove enrolled candidates
   - `POST /:id/complete` — Bulk update enrollment status
   - `GET /:id/attendance` — Get attendance logs
   - `POST /:id/attendance` — Record attendance
   - `POST /:id/attendance/bulk` — Record attendance in bulk
5. **`trainingAttendance.ts`** (Tag: `HR → Training Attendance`)
   - `GET /` — List attendance
   - `POST /` — Create attendance
   - `POST /bulk` — Create bulk attendance

### B. Public Routes
6. **`publicApplications.ts`** (Tag: `Public → Applications`)
   - `POST /` — Submit job application (Public, no security)
7. **`publicAreas.ts`** (Tag: `Public → Areas`)
   - `GET /` — List public geographical areas (Public, no security)

### C. Admin Routes
8. **`adminApplications.ts`** (Tag: `Admin → Applications`)
   - `GET /` — List job applications
   - `POST /` — Create manual application
   - `GET /:id` — Get application by ID
   - `PATCH /:id/stage` — Update application stage
   - `PATCH /:id/hire` — Hire candidate
   - `POST /:id/employee` — Create employee from application
   - `PATCH /:id/decision` — Save screening/review decision
   - `PATCH /:id/escalate` — Escalate application
   - `PATCH /:id/resolve-escalation` — Resolve application escalation
   - `PATCH /:id/notes` — Save application evaluation notes
   - `PATCH /:id/archive` — Archive application
   - `GET /:id/audit-logs` — Get application audit trail
   - `DELETE /:id` — Delete application
9. **`roles.ts`** (Tag: `Admin → Roles & Permissions`)
   - `GET /roles` — List system roles
   - `POST /roles` — Create custom role
   - `GET /roles/:id` — Get role details
   - `PUT /roles/:id` — Update role
   - `DELETE /roles/:id` — Delete role
   - `GET /permissions` — List all system permissions
   - `GET /roles/:id/permissions` — Get role permissions
   - `POST /roles/:id/permissions` — Update/assign role permissions
   - `GET /users/:userId/roles` — Get user roles
   - `POST /users/:userId/roles` — Grant roles to user
   - `DELETE /users/:userId/roles/:roleId` — Revoke role from user
   - `GET /users/:userId/grants` — Get direct user permission grants
   - `POST /users/:userId/grants` — Grant direct permission to user
   - `DELETE /users/:userId/grants/:permissionId` — Revoke direct permission from user
10. **`departments.ts`** (Tag: `Admin → Departments`)
    - `GET /` — List departments
    - `GET /:id` — Get department by ID
    - `POST /` — Create department
    - `PUT /:id` — Update department
    - `DELETE /:id` — Delete department
11. **`taskTypeConfig.ts`** (Tag: `Admin → Task Type Config`)
    - `GET /` — List all task type configurations
    - `PATCH /:taskType` — Update task type config mutable fields

### D. System Routes
12. **`customerCalls.ts`** (Tag: `System → Customer Calls`)
    - `GET /:customerId/calls` — Get call logs for a customer
    - `GET /:customerId/calls/stats` — Get call stats by outcome
    - `POST /:customerId/calls` — Record a new call log entry
    - `PATCH /calls/:callId` — Update call log entry by ID
    - `GET /:id/purchase-history` — Get purchase history for a customer
13. **`upload.ts`** (Tag: `System → Upload`)
    - `POST /` — Upload a file (multipart/form-data)

---

## Technical Specifications
- **Total Registered Endpoints:** ~222 endpoints are now fully documented across the CRM system.
- **OpenAPI Version:** 3.0.0
- **Security Scheme:** JWT Bearer Authentication (`bearerAuth`).
- **Global Headers:** `X-Branch-Id` in staging route collections.
