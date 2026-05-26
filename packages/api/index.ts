import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { setupSwagger } from './swagger.js';
import { createContext } from './trpc/init.js';
import { NODE_ENV, PORT, CORS_ORIGINS } from './config/env.js';
import { UPLOADS_DIR } from './storage/uploader.js';
import { requireAuth } from './middleware/auth.js';
import { requireNotHQOnly } from './middleware/permission.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import geoUnitsRouter from './routes/geoUnits.js';
import branchesRouter from './routes/branches.js';
import employeesRouter from './routes/employees.js';
import clientsRouter from './routes/clients.js';
import candidatesRouter from './routes/candidates.js';
import referralSheetsRouter from './routes/referralSheets.js';
import routesRouter from './routes/routes.js';
import tasksRouter from './routes/tasks.js';
import contractsRouter from './routes/contracts.js';
import duesRouter from './routes/dues.js';
import deviceModelsRouter from './routes/deviceModels.js';
import installedDevicesRouter from './routes/installedDevices.js';
import sparePartsRouter from './routes/spareParts.js';
import maintenanceRequestsRouter from './routes/maintenanceRequests.js';
import emergencyTicketsRouter from './routes/emergencyTickets.js';
import visitsRouter from './routes/visits.js';
import schedulesRouter from './routes/schedules.js';
import routeAssignmentsRouter from './routes/routeAssignments.js';
import planningRouter from './routes/planning.js';
import contactTargetsRouter from './routes/contactTargets.js';
import telemarketingRouter from './routes/telemarketing.js';
import dashboardRouter from './routes/dashboard.js';
import vacanciesRouter from './routes/vacancies.js';
import publicVacanciesRouter from './routes/publicVacancies.js';
import publicApplicationsRouter from './routes/publicApplications.js';
import adminApplicationsRouter from './routes/adminApplications.js';
import interviewsRouter from './routes/interviews.js';
import trainingCoursesRouter from './routes/trainingCourses.js';
import publicAreasRouter from './routes/publicAreas.js';
import authRouter from './routes/auth.js';
import systemListsRouter from './routes/systemLists.js';
import uploadRouter from './routes/upload.js';
import rolesRouter from './routes/roles.js';
import departmentsRouter from './routes/departments.js';
import openTasksRouter from './routes/openTasks.js';
import workScopesRouter from './routes/workScopes.js';
import fieldVisitsRouter from './routes/fieldVisits.js';
import customerCallsRouter from './routes/customerCalls.js';
import taskTypeConfigRouter from './routes/taskTypeConfig.js';
import emergencyActionTypesRouter from './routes/emergencyActionTypes.js';
import emergencyResultRouter from './routes/emergencyResult.js';
import deviceWarrantiesRouter from './routes/deviceWarranties.js';
import devicePartsRouter from './routes/deviceParts.js';

const app = express();
// Restrict origins when CORS_ORIGINS is set in the environment.
// Falls back to open cors() if unset, preserving current dev behaviour.
app.use(cors(CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined));
app.use(express.json({ limit: '10mb' }));

/**
 * @swagger
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── tRPC — type-safe contract layer (Roles PoC) ───────────────────────────
app.use('/trpc', createExpressMiddleware({ router: appRouter, createContext }));

app.use('/api/auth', authRouter);
app.use('/api/geo-units', geoUnitsRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/referral-sheets', referralSheetsRouter);
app.use('/api/routes', routesRouter);
// ── Branch-only routes ────────────────────────────────────────────────────────
// These modules have no meaning at HQ level. Super admins must pick a branch
// via the branch switcher (X-Branch-Id header) before accessing them.
// Branch-bound users always pass (requireNotHQOnly is a no-op for them).
const branchOnly = [requireAuth, requireNotHQOnly];

app.use('/api/tasks', ...branchOnly, tasksRouter);
app.use('/api/dues', ...branchOnly, duesRouter);
app.use('/api/maintenance-requests', ...branchOnly, maintenanceRequestsRouter);
app.use('/api/emergency-tickets', ...branchOnly, emergencyTicketsRouter);
app.use('/api/visits', ...branchOnly, visitsRouter);
app.use('/api/schedules', ...branchOnly, schedulesRouter);
app.use('/api/route-assignments', ...branchOnly, routeAssignmentsRouter);
app.use('/api/planning', ...branchOnly, planningRouter);
app.use('/api/contact-targets', ...branchOnly, contactTargetsRouter);
app.use('/api/telemarketing', ...branchOnly, telemarketingRouter);
app.use('/api/open-tasks', ...branchOnly, openTasksRouter);
app.use('/api/work-scopes', ...branchOnly, workScopesRouter);
app.use('/api/field-visits', ...branchOnly, fieldVisitsRouter);

// ── Customer call logs (accessible from both HQ and branch contexts) ─────────
app.use('/api/customers', requireAuth, customerCallsRouter);

// ── Shared routes (HQ + branch) ───────────────────────────────────────────────
app.use('/api/contracts', contractsRouter);
app.use('/api/device-models', deviceModelsRouter);
app.use('/api/installed-devices', installedDevicesRouter);
app.use('/api/device-warranties', deviceWarrantiesRouter);
app.use('/api/device-parts', devicePartsRouter);
app.use('/api/spare-parts', sparePartsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin/vacancies', vacanciesRouter);
app.use('/api/public/vacancies', publicVacanciesRouter);
app.use('/api/public/applications', publicApplicationsRouter);
app.use('/api/admin/applications', adminApplicationsRouter);
app.use('/api/admin/interviews', interviewsRouter);
app.use('/api/admin/training-courses', trainingCoursesRouter);
app.use('/api/public/areas', publicAreasRouter);
app.use('/api/system-lists', systemListsRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/admin', rolesRouter);
app.use('/api/admin/task-types', taskTypeConfigRouter);
app.use('/api/admin/emergency-action-types', emergencyActionTypesRouter);
app.use('/api/emergency-result', emergencyResultRouter);

// Serve uploaded files (photos, CVs) — always active
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Swagger API Documentation ─────────────────────────────────────────────────
setupSwagger(app);

// Serve frontend only in production.
// In development, Vite runs independently on port 5000 and proxies /api here.
if (NODE_ENV !== 'development') {
  const distPath = path.resolve(__dirname, '..', 'web', 'dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export async function start() {
  return new Promise<void>((resolve) => {
    app.listen(PORT, '0.0.0.0', () => {
      const isDev = NODE_ENV === 'development';
      console.log(`API server running on http://localhost:${PORT}`);
      if (isDev) {
        console.log(`  mode: development (frontend served by Vite on port 5000)`);
        console.log(`  frontend → http://localhost:5000`);
      } else {
        console.log(`  mode: production (serving built frontend from packages/web/dist)`);
      }
      resolve();
    });
  });
}

const scriptName = process.argv[1] || '';
if (scriptName.includes('index')) {
  start();
}
