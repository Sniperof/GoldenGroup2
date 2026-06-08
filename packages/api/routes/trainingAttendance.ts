import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/**
 * @swagger
 * /api/admin/training-attendance:
 *   get:
 *     tags: [HR → Training Attendance]
 *     summary: Retrieve training attendance records
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: X-Branch-Id
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: courseId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: applicationId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *     responses:
 *       200:
 *         description: Success
 */
router.get('/', async (req, res) => {
  try {
    const { courseId, applicationId, date } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (courseId) { conditions.push(`ta.training_course_id = $${idx++}`); params.push(courseId); }
    if (applicationId) { conditions.push(`ta.application_id = $${idx++}`); params.push(applicationId); }
    if (date) { conditions.push(`ta.attendance_date = $${idx++}`); params.push(date); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ta.id, ta.training_course_id AS "trainingCourseId",
        ta.application_id AS "applicationId",
        ta.attendance_date AS "attendanceDate", ta.status,
        a.first_name AS "firstName", a.last_name AS "lastName"
      FROM training_attendance ta
      JOIN job_applications ja ON ja.id = ta.application_id
      JOIN applicants a ON a.id = ja.applicant_id
      ${where}
      ORDER BY ta.attendance_date DESC, a.last_name, a.first_name`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/training-attendance:
 *   post:
 *     tags: [HR → Training Attendance]
 *     summary: Record single attendance
 *     security:
 *       - bearerAuth: []
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
 *             required: [trainingCourseId, applicationId, attendanceDate, status]
 *             properties:
 *               trainingCourseId:
 *                 type: integer
 *               applicationId:
 *                 type: integer
 *               attendanceDate:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [Present, Absent]
 *     responses:
 *       201:
 *         description: Created
 */
router.post('/', async (req, res) => {
  try {
    const { trainingCourseId, applicationId, attendanceDate, status } = req.body;
    if (!trainingCourseId || !applicationId || !attendanceDate) {
      return res.status(400).json({ error: 'معرّف الدورة والطلب والتاريخ مطلوبة' });
    }
    if (!['Present', 'Absent'].includes(status)) {
      return res.status(400).json({ error: 'حالة الحضور غير صالحة' });
    }

    const { rows } = await pool.query(
      `INSERT INTO training_attendance (training_course_id, application_id, attendance_date, status)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (training_course_id, application_id, attendance_date)
       DO UPDATE SET status = EXCLUDED.status
       RETURNING id, training_course_id AS "trainingCourseId",
         application_id AS "applicationId",
         attendance_date AS "attendanceDate", status`,
      [trainingCourseId, applicationId, attendanceDate, status]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error('Error recording attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/admin/training-attendance/bulk:
 *   post:
 *     tags: [HR → Training Attendance]
 *     summary: Bulk upsert attendance records
 *     security:
 *       - bearerAuth: []
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
 *             required: [trainingCourseId, attendanceDate, records]
 *             properties:
 *               trainingCourseId:
 *                 type: integer
 *               attendanceDate:
 *                 type: string
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [applicationId, status]
 *                   properties:
 *                     applicationId:
 *                       type: integer
 *                     status:
 *                       type: string
 *                       enum: [Present, Absent]
 *     responses:
 *       200:
 *         description: Success
 */
router.post('/bulk', async (req, res) => {
  const client = await pool.connect();
  try {
    const { trainingCourseId, attendanceDate, records } = req.body;
    // records: [{ applicationId, status }]
    if (!trainingCourseId || !attendanceDate || !Array.isArray(records)) {
      return res.status(400).json({ error: 'بيانات الحضور غير مكتملة' });
    }

    await client.query('BEGIN');
    const results = [];
    for (const rec of records) {
      const { rows } = await client.query(
        `INSERT INTO training_attendance (training_course_id, application_id, attendance_date, status)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (training_course_id, application_id, attendance_date)
         DO UPDATE SET status = EXCLUDED.status
         RETURNING id, training_course_id AS "trainingCourseId",
           application_id AS "applicationId",
           attendance_date AS "attendanceDate", status`,
        [trainingCourseId, rec.applicationId, attendanceDate, rec.status]
      );
      results.push(rows[0]);
    }
    await client.query('COMMIT');
    res.json(results);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error bulk recording attendance:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
