import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { setupSwagger } from './swagger.js';
import { createContext } from './trpc/init.js';
import {
  NODE_ENV,
  PORT,
  CORS_ORIGINS,
  TRUST_PROXY,
  APP_RATE_LIMIT_ENABLED,
  APP_RATE_OTP_SEND,
  APP_RATE_OTP_SEND_WINDOW_S,
  APP_RATE_OTP_VERIFY,
  APP_RATE_OTP_VERIFY_WINDOW_S,
  APP_RATE_MUTATION,
  APP_RATE_MUTATION_WINDOW_S,
  APP_RATE_INTAKE,
  APP_RATE_INTAKE_WINDOW_S,
  APP_RATE_READ,
  APP_RATE_READ_WINDOW_S,
} from './config/env.js';
import { rateLimit } from './middleware/rateLimit.js';
import { UPLOADS_DIR } from './storage/uploader.js';
import { requireAuth } from './middleware/auth.js';
import { requireNotHQOnly } from './middleware/permission.js';
import { apiErrorHandler } from './middleware/apiErrorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import geoUnitsRouter from './routes/geoUnits.js';
import branchesRouter from './routes/branches.js';
import employeesRouter from './routes/employees.js';
import clientsRouter from './routes/clients.js';
import candidatesRouter from './routes/candidates.js';
import referralSheetsRouter from './routes/referralSheets.js';
import routesRouter from './routes/routes.js';
// Legacy `tasks` router unmounted 2026-06-10 — see app.use comment below.
// import tasksRouter from './routes/tasks.js';
import contractsRouter from './routes/contracts.js';
import contractDocumentsRouter from './routes/contractDocuments.js';
import serviceAgreementsRouter from './routes/serviceAgreements.js';
import duesRouter from './routes/dues.js';
import deviceModelsRouter from './routes/deviceModels.js';
import installedDevicesRouter from './routes/installedDevices.js';
import sparePartsRouter from './routes/spareParts.js';
import maintenanceRequestsRouter from './routes/maintenanceRequests.js';
import emergencyTicketsRouter from './routes/emergencyTickets.js';
import serviceRequestsRouter from './routes/serviceRequests.js';
// Legacy `visits` router unmounted 2026-06-10 — replaced by field-visits.
// import visitsRouter from './routes/visits.js';
import schedulesRouter from './routes/schedules.js';
import routeAssignmentsRouter from './routes/routeAssignments.js';
import planningRouter from './routes/planning.js';
import zoneStudyRouter from './routes/zoneStudy.js';
import contactTargetsRouter from './routes/contactTargets.js';
import telemarketingRouter from './routes/telemarketing.js';
import vacanciesRouter from './routes/vacancies.js';
import publicVacanciesRouter from './routes/publicVacancies.js';
import publicApplicationsRouter from './routes/publicApplications.js';
import adminApplicationsRouter from './routes/adminApplications.js';
import interviewsRouter from './routes/interviews.js';
import trainingCoursesRouter from './routes/trainingCourses.js';
import publicAreasRouter from './routes/publicAreas.js';
import authRouter from './routes/auth.js';
import appOtpRouter from './routes/appOtp.js';
import appAccountRouter from './routes/appAccount.js';
import appAuthRouter from './routes/appAuth.js';
import appServiceRequestsRouter from './routes/appServiceRequests.js';
import appDeviceCatalogRouter from './routes/appDeviceCatalog.js';
import appBranchCatalogRouter from './routes/appBranchCatalog.js';
import publicAccountDeletionRouter from './routes/publicAccountDeletion.js';
import adminAccountRequestsRouter from './routes/adminAccountRequests.js';
import adminAppAccountsRouter from './routes/adminAppAccounts.js';
import systemListsRouter from './routes/systemLists.js';
import uploadRouter from './routes/upload.js';
import rolesRouter from './routes/roles.js';
import departmentsRouter from './routes/departments.js';
import openTasksRouter from './routes/openTasks.js';
import workScopesRouter from './routes/workScopes.js';
import fieldVisitsRouter from './routes/fieldVisits.js';
import customerCallsRouter from './routes/customerCalls.js';
import customerPreOffersRouter from './routes/customerPreOffers.js';
import taskTypeConfigRouter from './routes/taskTypeConfig.js';
import emergencyActionTypesRouter from './routes/emergencyActionTypes.js';
import emergencyResultRouter from './routes/emergencyResult.js';
import deviceWarrantiesRouter from './routes/deviceWarranties.js';
import devicePossessionRouter from './routes/devicePossession.js';
import devicePartsRouter from './routes/deviceParts.js';
import systemSettingsRouter from './routes/systemSettings.js';
import giftsRouter from './routes/gifts.js';
import reportsRouter from './routes/reports.js';
import dashboardLayoutRouter from './routes/dashboardLayout.js';

const app = express();
// Restrict origins when CORS_ORIGINS is set in the environment.
// Falls back to open cors() if unset, preserving current dev behaviour.
app.use(cors(CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined));
// `req.ip` feeds the public rate limits. Behind a reverse proxy this must be
// set (TRUST_PROXY=1) or every caller resolves to the proxy address and the
// per-IP windows become one shared bucket for the whole internet.
app.set('trust proxy', TRUST_PROXY);
if (NODE_ENV === 'production' && TRUST_PROXY === false) {
  console.warn(
    '[boot] TRUST_PROXY is unset. If the API sits behind nginx, per-IP rate limits ' +
    'will collapse into a single bucket. Set TRUST_PROXY=1 in production.env.',
  );
}
app.use(express.json({ limit: '10mb' }));

// ── Public mobile surface: coarse per-IP limits ─────────────────────────────
// Applied here, before the routers, so no future /api/app route can be added
// without inheriting a limit. Identity-level caps (per phone / per account)
// are enforced in the DB inside the services.
const appReadLimiter = rateLimit({
  bucket: 'app:read', limit: APP_RATE_READ, windowSeconds: APP_RATE_READ_WINDOW_S,
});
app.use('/api/app/otp/send', rateLimit({
  bucket: 'app:otp:send',
  limit: APP_RATE_OTP_SEND,
  windowSeconds: APP_RATE_OTP_SEND_WINDOW_S,
  message: 'طلبات كثيرة لرمز التحقق. حاول بعد قليل.',
}));
app.use('/api/app/otp/verify', rateLimit({
  bucket: 'app:otp:verify',
  limit: APP_RATE_OTP_VERIFY,
  windowSeconds: APP_RATE_OTP_VERIFY_WINDOW_S,
}));
app.use('/api/app/service-requests', (req, res, next) => (
  req.method === 'GET'
    ? appReadLimiter(req, res, next)
    : rateLimit({
        bucket: 'app:intake',
        limit: APP_RATE_INTAKE,
        windowSeconds: APP_RATE_INTAKE_WINDOW_S,
        message: 'طلبات كثيرة. حاول بعد قليل.',
      })(req, res, next)
));
app.use('/api/app', (req, res, next) => (
  req.method === 'GET'
    ? appReadLimiter(req, res, next)
    : rateLimit({
        bucket: 'app:mutation',
        limit: APP_RATE_MUTATION,
        windowSeconds: APP_RATE_MUTATION_WINDOW_S,
      })(req, res, next)
));
app.use('/api/public', appReadLimiter);
if (!APP_RATE_LIMIT_ENABLED) {
  console.warn('[boot] APP_RATE_LIMIT_ENABLED=false — the public mobile surface is unthrottled.');
}

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
// Customer mobile-app OTP — public (no staff auth). DEC-013 §6.
app.use('/api/app/otp', appOtpRouter);
// Customer mobile-app account status + creation request — public. DEC-013 §2.4.
app.use('/api/app', appAccountRouter);
// Customer session: login / refresh / logout / session bootstrap. DEC-013 §6.
app.use('/api/app', appAuthRouter);
// Mobile service-request intake: visitor OTP or authenticated customer identity.
app.use('/api/app/service-requests', appServiceRequestsRouter);
// Public active company-device catalog for mobile visitors.
app.use('/api/app/catalog/devices', appDeviceCatalogRouter);
// Public mobile branch catalog and branch detail pages.
app.use('/api/app/catalog/branches', appBranchCatalogRouter);
// Public account-deletion web page (Google Play). DEC-013 §8.
app.use('/account-deletion', publicAccountDeletionRouter);
// Web-portal admin review of account-creation requests. DEC-013 §2.5.
app.use('/api/admin/account-requests', adminAccountRequestsRouter);
// Admin direct + bulk app-account activation. DEC-013 §2.5.10.
app.use('/api/admin', adminAppAccountsRouter);
app.use('/api/system-settings', requireAuth, systemSettingsRouter);
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

// Legacy unmounts (2026-06-10): /api/tasks and /api/visits were the only
// routes still touching the `tasks` and `visits` tables. Frontend consumers
// were deleted in the same change. The DROP TABLE migration follows the
// 14-day staging soak window per the constitution's Phase 11 plan.
// app.use('/api/tasks',  ...branchOnly, tasksRouter);
// app.use('/api/visits', ...branchOnly, visitsRouter);
app.use('/api/dues', ...branchOnly, duesRouter);
app.use('/api/maintenance-requests', ...branchOnly, maintenanceRequestsRouter);
app.use('/api/emergency-tickets', ...branchOnly, emergencyTicketsRouter);
// service_requests intake (٠.١٦ — GLOBAL by design, no branch context required)
app.use('/api/service-requests', requireAuth, serviceRequestsRouter);
app.use('/api/schedules', ...branchOnly, schedulesRouter);
app.use('/api/route-assignments', ...branchOnly, routeAssignmentsRouter);
app.use('/api/planning/zone-study', ...branchOnly, zoneStudyRouter);
app.use('/api/planning', ...branchOnly, planningRouter);
app.use('/api/contact-targets', ...branchOnly, contactTargetsRouter);
app.use('/api/telemarketing', ...branchOnly, telemarketingRouter);
app.use('/api/open-tasks', ...branchOnly, openTasksRouter);
app.use('/api/work-scopes', ...branchOnly, workScopesRouter);
app.use('/api/field-visits', ...branchOnly, fieldVisitsRouter);

// ── Customer call logs (accessible from both HQ and branch contexts) ─────────
app.use('/api/customers', requireAuth, customerCallsRouter);
app.use('/api/customers', requireAuth, customerPreOffersRouter); // pre-offers tab

// ── Shared routes (HQ + branch) ───────────────────────────────────────────────
app.use('/api/contracts', contractsRouter);
app.use('/api/contracts', contractDocumentsRouter); // DEC-CT-14, DEC-CT-15
app.use('/api/gifts', requireAuth, giftsRouter);
app.use('/api/service-agreements', serviceAgreementsRouter); // DEC-CT-02
app.use('/api/device-models', deviceModelsRouter);
app.use('/api/installed-devices', installedDevicesRouter);
app.use('/api/device-warranties', deviceWarrantiesRouter);
app.use('/api/devices', devicePossessionRouter); // DEC-CT-09
app.use('/api/device-parts', devicePartsRouter);
app.use('/api/spare-parts', sparePartsRouter);
// reporting-analytics §1.3 — unified metrics surface + per-user dashboard layout.
// Scope is enforced inside metricsService via each metric's own permission.
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/me', requireAuth, dashboardLayoutRouter);
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

// Keep every unhandled REST failure JSON-shaped; domain services should still
// translate expected failures (such as conflicts) before they reach this guard.
app.use(apiErrorHandler);

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
      // DEC-005 D26: launch daily contact_targets cleanup job after the
      // listener is up so a failing job never blocks the server from booting.
      void import('./services/contactTargetsCleanupJob.js').then((mod) =>
        mod.startContactTargetsCleanupJob(),
      );
      void import('./services/vacancyExpiryJob.js').then((mod) =>
        mod.startVacancyExpiryJob(),
      );
      // DEC-006 D38: three-tier escalation for undocumented visits.
      void import('./services/visitEscalationJob.js').then((mod) =>
        mod.startVisitEscalationJob(),
      );
      resolve();
    });
  });
}

const scriptName = process.argv[1] || '';
if (scriptName.includes('index')) {
  start();
}
