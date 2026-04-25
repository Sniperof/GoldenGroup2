import { Router } from 'express';
import pool from '../db.js';
import { insertAuditLog } from '../utils/auditLog.js';
import { requirePermission, resolveTargetBranchId } from '../middleware/permission.js';

const router = Router();

const VACANCY_COLS = `
  jv.id, jv.title, jv.branch,
  jv.branch_id AS "branchId",
  jv.department_id AS "departmentId",
  d.name AS "departmentName",
  jv.governorate, jv.city_or_area AS "cityOrArea", jv.sub_area AS "subArea",
  jv.neighborhood, jv.detailed_address AS "detailedAddress",
  jv.work_type AS "workType", jv.required_gender AS "requiredGender",
  jv.required_age_min AS "requiredAgeMin", jv.required_age_max AS "requiredAgeMax",
  COALESCE(jv.contact_methods, '[]'::jsonb) AS "contactMethods",
  jv.required_certificate AS "requiredCertificate",
  jv.required_major AS "requiredMajor",
  jv.required_experience_years AS "requiredExperienceYears",
  jv.required_skills AS "requiredSkills", jv.responsibilities,
  jv.driving_license_required AS "drivingLicenseRequired",
  jv.vacancy_count AS "vacancyCount",
  jv.start_date AS "startDate", jv.end_date AS "endDate",
  jv.status, jv.created_at AS "createdAt", jv.updated_at AS "updatedAt"
`;

const VACANCY_FROM = `
  FROM job_vacancies jv
  LEFT JOIN departments d ON d.id = jv.department_id
`;

async function assertVacancyBranchAccess(req: any, res: any, vacancyId: string | number): Promise<{ ok: boolean; branchId?: number }> {
  const authContext = req.authContext!;
  const { rows } = await pool.query('SELECT branch_id FROM job_vacancies WHERE id = $1', [vacancyId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'الشاغر غير موجود' });
    return { ok: false };
  }
  if (!authContext.isSuperAdmin && rows[0].branch_id !== authContext.actingBranchId) {
    res.status(403).json({ error: 'غير مسموح' });
    return { ok: false };
  }
  return { ok: true, branchId: rows[0].branch_id };
}

async function ensureVacancyDepartment(client: any, branchId: number, departmentIdRaw: unknown) {
  const departmentId = departmentIdRaw != null ? Number(departmentIdRaw) : null;
  if (!departmentId || !Number.isFinite(departmentId)) {
    return { ok: false, error: 'القسم مطلوب' };
  }

  const { rows } = await client.query(
    'SELECT id FROM departments WHERE id = $1 AND branch_id = $2',
    [departmentId, branchId]
  );

  if (rows.length === 0) {
    return { ok: false, error: 'القسم المحدد لا ينتمي إلى الفرع المختار' };
  }

  return { ok: true, departmentId };
}

async function fetchVacancyById(client: any, vacancyId: string | number) {
  const { rows } = await client.query(
    `SELECT ${VACANCY_COLS} ${VACANCY_FROM} WHERE jv.id = $1`,
    [vacancyId]
  );
  return rows[0] ?? null;
}

// GET /api/admin/vacancies
router.get('/', requirePermission('jobs.vacancies.view_list'), async (req, res) => {
  try {
    const authContext = req.authContext!;
    const { status, branch, search } = req.query;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (!authContext.isSuperAdmin) {
      conditions.push(`jv.branch_id = $${idx++}`);
      params.push(authContext.actingBranchId);
    } else {
      const hb = Number(req.header('x-branch-id'));
      if (Number.isFinite(hb) && hb > 0) {
        conditions.push(`jv.branch_id = $${idx++}`);
        params.push(hb);
      }
    }

    if (status) { conditions.push(`jv.status = $${idx++}`); params.push(status); }
    if (branch) { conditions.push(`jv.branch = $${idx++}`); params.push(branch); }
    if (search) {
      conditions.push(`(CAST(jv.id AS TEXT) LIKE $${idx} OR jv.title ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT ${VACANCY_COLS} ${VACANCY_FROM} ${where} ORDER BY jv.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching vacancies:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/vacancies/:id
router.get('/:id', requirePermission('jobs.vacancies.view_detail'), async (req, res) => {
  try {
    const vacancyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const check = await assertVacancyBranchAccess(req, res, vacancyId!);
    if (!check.ok) return;

    const vacancy = await fetchVacancyById(pool, vacancyId!);
    if (!vacancy) return res.status(404).json({ error: 'الشاغر غير موجود' });

    const { rows: counts } = await pool.query(
      `SELECT
        COUNT(*) AS applications_count,
        COUNT(*) FILTER (WHERE application_status = 'Final Hired') AS hired_count
       FROM job_applications WHERE job_vacancy_id = $1`,
      [req.params.id]
    );
    const applicationsCount = parseInt(counts[0].applications_count);
    const hiredCount = parseInt(counts[0].hired_count);

    res.json({
      ...vacancy,
      applicationsCount,
      hiredCount,
      remainingSlots: vacancy.vacancyCount - hiredCount,
    });
  } catch (err: any) {
    console.error('Error fetching vacancy:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/vacancies
router.post('/', requirePermission('jobs.vacancies.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = req.body;

    if (!v.title?.trim()) return res.status(400).json({ error: 'عنوان الوظيفة مطلوب' });
    if (!v.vacancyCount || v.vacancyCount <= 0) return res.status(400).json({ error: 'عدد الشواغر يجب أن يكون أكبر من 0' });
    if (!v.startDate) return res.status(400).json({ error: 'تاريخ البداية مطلوب' });
    if (!v.endDate) return res.status(400).json({ error: 'تاريخ النهاية مطلوب' });
    if (new Date(v.startDate) > new Date(v.endDate)) return res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' });

    const targetBranchId = resolveTargetBranchId(req, res, v.branchId);
    if (targetBranchId == null) return;

    const departmentCheck = await ensureVacancyDepartment(client, targetBranchId, v.departmentId);
    if (!departmentCheck.ok) {
      return res.status(400).json({ error: departmentCheck.error });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO job_vacancies (
        title, branch, branch_id, department_id,
        governorate, city_or_area, sub_area, neighborhood, detailed_address,
        work_type, required_gender, required_age_min, required_age_max, contact_methods,
        required_certificate, required_major, required_experience_years,
        required_skills, responsibilities, driving_license_required,
        vacancy_count, start_date, end_date, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'Open')
      RETURNING id`,
      [
        v.title, v.branch || null, targetBranchId, departmentCheck.departmentId,
        v.governorate || null, v.cityOrArea || null, v.subArea || null,
        v.neighborhood || null, v.detailedAddress || null,
        v.workType || null, v.requiredGender || null,
        v.requiredAgeMin || null, v.requiredAgeMax || null,
        JSON.stringify(v.contactMethods || []),
        v.requiredCertificate || null, v.requiredMajor || null,
        v.requiredExperienceYears || null,
        v.requiredSkills || null, v.responsibilities || null,
        v.drivingLicenseRequired || false,
        v.vacancyCount,
        v.startDate, v.endDate,
      ]
    );

    const vacancy = await fetchVacancyById(client, rows[0].id);

    await insertAuditLog(client, {
      entityType: 'job_vacancy',
      entityId: rows[0].id,
      actionType: 'Job Vacancy Created',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      newValue: JSON.stringify({ title: v.title, branchId: targetBranchId, departmentId: departmentCheck.departmentId }),
    });

    await client.query('COMMIT');
    res.json(vacancy);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error creating vacancy:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/admin/vacancies/:id
router.put('/:id', requirePermission('jobs.vacancies.edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = req.body;
    const vacancyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const check = await assertVacancyBranchAccess(req, res, vacancyId!);
    if (!check.ok) {
      client.release();
      return;
    }

    const { rows: appCountRows } = await client.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN current_stage != 'Submitted' THEN 1 ELSE 0 END) AS past_submitted
       FROM job_applications WHERE job_vacancy_id = $1`,
      [vacancyId]
    );
    const total = parseInt(appCountRows[0].total);
    const pastSubmitted = parseInt(appCountRows[0].past_submitted || '0');

    let editTier: 1 | 2 | 3;

    if (total === 0) {
      editTier = 1;
      if (!v.title?.trim()) return res.status(400).json({ error: 'عنوان الوظيفة مطلوب' });
      if (!v.vacancyCount || v.vacancyCount <= 0) return res.status(400).json({ error: 'عدد الشواغر يجب أن يكون أكبر من 0' });
      if (!v.startDate || !v.endDate) return res.status(400).json({ error: 'تواريخ البداية والنهاية مطلوبة' });
      if (new Date(v.startDate) > new Date(v.endDate)) return res.status(400).json({ error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' });

      const departmentCheck = await ensureVacancyDepartment(client, check.branchId!, v.departmentId);
      if (!departmentCheck.ok) {
        return res.status(400).json({ error: departmentCheck.error });
      }

      await client.query('BEGIN');
      await client.query(
        `UPDATE job_vacancies SET
          title=$1, branch=$2, department_id=$3, governorate=$4, city_or_area=$5, sub_area=$6,
          neighborhood=$7, detailed_address=$8, work_type=$9, required_gender=$10,
          required_age_min=$11, required_age_max=$12, contact_methods=$13,
          required_certificate=$14, required_major=$15,
          required_experience_years=$16, required_skills=$17, responsibilities=$18,
          driving_license_required=$19, vacancy_count=$20,
          start_date=$21, end_date=$22, updated_at=NOW()
        WHERE id=$23`,
        [
          v.title, v.branch || null, departmentCheck.departmentId,
          v.governorate || null, v.cityOrArea || null, v.subArea || null,
          v.neighborhood || null, v.detailedAddress || null,
          v.workType || null, v.requiredGender || null,
          v.requiredAgeMin || null, v.requiredAgeMax || null,
          JSON.stringify(v.contactMethods || []),
          v.requiredCertificate || null, v.requiredMajor || null,
          v.requiredExperienceYears || null,
          v.requiredSkills || null, v.responsibilities || null,
          v.drivingLicenseRequired || false,
          v.vacancyCount,
          v.startDate, v.endDate, vacancyId,
        ]
      );
    } else if (pastSubmitted === 0) {
      editTier = 2;
      await client.query('BEGIN');
      await client.query(
        `UPDATE job_vacancies SET
          end_date=$1, responsibilities=$2, required_skills=$3,
          contact_methods=$4, updated_at=NOW()
        WHERE id=$5`,
        [
          v.endDate || null, v.responsibilities || null, v.requiredSkills || null,
          JSON.stringify(v.contactMethods || []), vacancyId,
        ]
      );
    } else {
      editTier = 3;
      await client.query('BEGIN');
      await client.query(
        `UPDATE job_vacancies SET end_date=$1, updated_at=NOW()
        WHERE id=$2`,
        [v.endDate || null, vacancyId]
      );
    }

    const updatedVacancy = await fetchVacancyById(client, vacancyId!);
    if (!updatedVacancy) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الشاغر غير موجود' });
    }

    await insertAuditLog(client, {
      entityType: 'job_vacancy',
      entityId: parseInt(vacancyId as string),
      actionType: 'Job Vacancy Updated',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      newValue: JSON.stringify({ editTier }),
    });

    await client.query('COMMIT');
    res.json({ ...updatedVacancy, editTier });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error updating vacancy:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/vacancies/:id/status
router.patch('/:id/status', requirePermission('jobs.vacancies.change_status'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { status } = req.body;
    if (!['Open', 'Closed', 'Archived'].includes(status)) {
      return res.status(400).json({ error: 'الحالة يجب أن تكون Open أو Closed أو Archived' });
    }

    const vacancyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const check = await assertVacancyBranchAccess(req, res, vacancyId!);
    if (!check.ok) {
      client.release();
      return;
    }

    await client.query('BEGIN');

    const { rows: current } = await client.query(
      'SELECT status FROM job_vacancies WHERE id = $1',
      [vacancyId]
    );
    if (current.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'الشاغر غير موجود' });
    }

    const from = current[0].status;
    if (from === 'Archived') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'لا يمكن تغيير حالة شاغر مؤرشف' });
    }
    if (status === 'Archived' && from !== 'Closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'يجب إغلاق الشاغر قبل أرشفته' });
    }

    const { rows } = await client.query(
      `UPDATE job_vacancies SET status=$1, updated_at=NOW() WHERE id=$2
       RETURNING id, title, status`,
      [status, req.params.id]
    );

    await insertAuditLog(client, {
      entityType: 'job_vacancy',
      entityId: parseInt(req.params.id as string),
      actionType: 'Vacancy Status Changed',
      performedByRole: req.user!.role,
      performedByUserId: req.user!.id,
      oldValue: from,
      newValue: status,
    });

    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error updating vacancy status:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
