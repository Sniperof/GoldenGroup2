import { Router } from 'express';
import { createPublicApplication } from '../services/applicationService.js';

const router = Router();

/**
 * @swagger
 * /api/public/applications:
 *   post:
 *     tags: [Public → Applications]
 *     summary: Submit a job application publicly
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [jobVacancyId, applicant]
 *             properties:
 *               jobVacancyId:
 *                 type: integer
 *               applicant:
 *                 type: object
 *                 required: [firstName, lastName, mobileNumber, dob, gender, maritalStatus, governorate, detailedAddress, hasCar]
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   dob:
 *                     type: string
 *                   gender:
 *                     type: string
 *                   maritalStatus:
 *                     type: string
 *                   email:
 *                     type: string
 *                   mobileNumber:
 *                     type: string
 *                   secondaryMobile:
 *                     type: string
 *                   governorate:
 *                     type: string
 *                   cityOrArea:
 *                     type: string
 *                   subArea:
 *                     type: string
 *                   neighborhood:
 *                     type: string
 *                   detailedAddress:
 *                     type: string
 *                   hasCar:
 *                     type: boolean
 *               submissionType:
 *                 type: string
 *                 default: Apply
 *               applicationSource:
 *                 type: string
 *                 default: Website
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', async (req, res) => {
  try {
    const result = await createPublicApplication(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    if (err?.status) {
      return res.status(err.status).json(err.payload ?? { error: err.message });
    }
    console.error('Error submitting application:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
