import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/init.js';
import { NODE_ENV, PORT } from './config/env.js';
import { UPLOADS_DIR } from './storage/uploader.js';

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
import sparePartsRouter from './routes/spareParts.js';
import maintenanceRequestsRouter from './routes/maintenanceRequests.js';
import emergencyTicketsRouter from './routes/emergencyTickets.js';
import visitsRouter from './routes/visits.js';
import schedulesRouter from './routes/schedules.js';
import routeAssignmentsRouter from './routes/routeAssignments.js';
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

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
app.use('/api/tasks', tasksRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/dues', duesRouter);
app.use('/api/device-models', deviceModelsRouter);
app.use('/api/spare-parts', sparePartsRouter);
app.use('/api/maintenance-requests', maintenanceRequestsRouter);
app.use('/api/emergency-tickets', emergencyTicketsRouter);
app.use('/api/visits', visitsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/route-assignments', routeAssignmentsRouter);
app.use('/api/telemarketing', telemarketingRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/admin/vacancies', vacanciesRouter);
app.use('/api/public/vacancies', publicVacanciesRouter);
app.use('/api/public/applications', publicApplicationsRouter);
app.use('/api/admin/applications', adminApplicationsRouter);
app.use('/api/admin/interviews', interviewsRouter);
app.use('/api/admin/training-courses', trainingCoursesRouter);
app.use('/api/public/areas', publicAreasRouter);
app.use('/api/system-lists', systemListsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/admin', rolesRouter);

// Serve uploaded files (photos, CVs) — always active
app.use('/uploads', express.static(UPLOADS_DIR));

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
