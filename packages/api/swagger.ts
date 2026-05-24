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
  ],
};

const spec = swaggerJsdoc(options);

export function setupSwagger(app: Express) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
}
