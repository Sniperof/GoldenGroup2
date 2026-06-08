import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Golden CRM API',
      version: '1.0.0',
      description: 'API documentation for Golden CRM staging',
    },
    servers: [
      {
        url: 'http://76.13.133.8:3001',
        description: 'Staging',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: [
    path.join(__dirname, 'index.ts'),
    path.join(__dirname, 'routes', 'auth.ts'),
    path.join(__dirname, 'routes', 'geoUnits.ts'),
    path.join(__dirname, 'routes', 'branches.ts'),
    path.join(__dirname, 'routes', 'employees.ts'),
    path.join(__dirname, 'routes', 'systemLists.ts'),
    path.join(__dirname, 'routes', 'dashboard.ts'),
    path.join(__dirname, 'routes', 'clients.ts'),
    path.join(__dirname, 'routes', 'candidates.ts'),
    path.join(__dirname, 'routes', 'contracts.ts'),
    path.join(__dirname, 'routes', 'deviceModels.ts'),
    path.join(__dirname, 'routes', 'spareParts.ts'),
    path.join(__dirname, 'routes', 'dues.ts'),
    path.join(__dirname, 'routes', 'routes.ts'),
    path.join(__dirname, 'routes', 'referralSheets.ts'),
    path.join(__dirname, 'routes', 'tasks.ts'),
    path.join(__dirname, 'routes', 'visits.ts'),
    path.join(__dirname, 'routes', 'fieldVisits.ts'),
    path.join(__dirname, 'routes', 'schedules.ts'),
    path.join(__dirname, 'routes', 'routeAssignments.ts'),
    path.join(__dirname, 'routes', 'maintenanceRequests.ts'),
    path.join(__dirname, 'routes', 'emergencyTickets.ts'),
    path.join(__dirname, 'routes', 'emergencyResult.ts'),
    path.join(__dirname, 'routes', 'emergencyActionTypes.ts'),
    path.join(__dirname, 'routes', 'contactTargets.ts'),
    path.join(__dirname, 'routes', 'planning.ts'),
    path.join(__dirname, 'routes', 'telemarketing.ts'),
    path.join(__dirname, 'routes', 'openTasks.ts'),
    path.join(__dirname, 'routes', 'workScopes.ts'),
    path.join(__dirname, 'routes', 'vacancies.ts'),
    path.join(__dirname, 'routes', 'publicVacancies.ts'),
    path.join(__dirname, 'routes', 'interviews.ts'),
    path.join(__dirname, 'routes', 'trainingCourses.ts'),
    path.join(__dirname, 'routes', 'trainingAttendance.ts'),
    path.join(__dirname, 'routes', 'publicApplications.ts'),
    path.join(__dirname, 'routes', 'publicAreas.ts'),
    path.join(__dirname, 'routes', 'adminApplications.ts'),
    path.join(__dirname, 'routes', 'roles.ts'),
    path.join(__dirname, 'routes', 'departments.ts'),
    path.join(__dirname, 'routes', 'taskTypeConfig.ts'),
    path.join(__dirname, 'routes', 'customerCalls.ts'),
    path.join(__dirname, 'routes', 'upload.ts'),
  ],
};

const spec = swaggerJsdoc(options);

export function setupSwagger(app: Express) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
}
