import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const jobTitles = [
  '\u0645\u062f\u064a\u0631 \u062a\u0646\u0641\u064a\u0630\u064a',
  '\u0645\u062f\u064a\u0631 \u062e\u062f\u0645\u0629 \u0627\u0644\u0632\u0628\u0627\u0626\u0646',
  '\u0633\u0648\u0628\u0631\u0641\u0627\u064a\u0632\u0631',
  '\u062a\u0644\u0645\u0627\u0631\u0643\u062a\u0631',
  '\u062f\u064a\u0644\u0631',
  '\u0645\u0634\u0631\u0641\u0629 \u0645\u0628\u064a\u0639\u0627\u062a',
  '\u0625\u0644\u063a\u0627\u0621',
  '\u062f\u064a\u0632\u0627\u064a\u0646\u0631',
  '\u0628\u0631\u0645\u062c\u0629',
  '\u0623\u0645\u064a\u0646 \u0635\u0646\u062f\u0648\u0642',
  '\u0645\u062f\u064a\u0631 \u0645\u0634\u062a\u0631\u064a\u0627\u062a',
  '\u0645\u062d\u0627\u0633\u0628',
  '\u0645\u0633\u0624\u0648\u0644 \u0645\u0648\u0627\u0631\u062f \u0628\u0634\u0631\u064a\u0629',
  '\u0645\u0646\u0633\u0642 \u0642\u0633\u0645',
  '\u0639\u0644\u0627\u0642\u0627\u062a \u0639\u0627\u0645\u0629',
  '\u0645\u0633\u0624\u0648\u0644 \u0633\u0648\u0634\u0627\u0644 \u0645\u064a\u062f\u064a\u0627',
  '\u0645\u0633\u0624\u0648\u0644 \u0633\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0634\u0631\u0643\u0629',
  '\u0633\u064a\u0644\u0632 \u0628\u0631\u0648\u0645\u0648\u0634\u064a\u0646',
  '\u0645\u062f\u064a\u0631 \u0645\u062d\u0627\u0633\u0628\u0629',
  '\u0633\u0643\u0631\u062a\u064a\u0631\u0629 \u062a\u0646\u0641\u064a\u0630\u064a\u0629',
  '\u0643\u0627\u0641\u062a\u064a\u0631\u064a\u0627',
  '\u0645\u062f\u064a\u0631 \u0645\u0628\u064a\u0639\u0627\u062a',
  '\u0645\u062f\u064a\u0631 \u0641\u0646\u064a',
  '\u0645\u062f\u064a\u0631/\u0629 \u0645\u0648\u0638\u0641\u064a\u0646',
  '\u0646\u0627\u0626\u0628 \u0645\u062c\u0644\u0633 \u0627\u0644\u0627\u062f\u0627\u0631\u0629',
  '\u0645\u062f\u064a\u0631 \u0627\u062f\u0627\u0631\u064a',
  '\u0645\u0633\u0624\u0648\u0644 \u0645\u062a\u0627\u0628\u0639\u0629',
  '\u0641\u0646\u064a \u0643\u0647\u0631\u0628\u0627\u0621',
  '\u0645\u062f\u064a\u0631 \u0645\u0627\u0644\u064a',
];

try {
  for (let index = 0; index < jobTitles.length; index += 1) {
    const title = jobTitles[index];

    const { rows: listRows } = await pool.query(
      `INSERT INTO system_lists (category, value, is_active, display_order)
       VALUES ('job_title', $1, TRUE, $2)
       ON CONFLICT (category, value) DO UPDATE
         SET is_active = TRUE,
             display_order = EXCLUDED.display_order,
             updated_at = NOW()
       RETURNING id`,
      [title, index + 1]
    );

    const listId = listRows[0].id;

    await pool.query(
      `INSERT INTO roles (name, display_name, description, is_active, is_system)
       VALUES ($1, $2, $3, TRUE, FALSE)
       ON CONFLICT (name) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             is_active = TRUE,
             updated_at = NOW()`,
      [
        `job_title_${listId}`,
        title,
        '\u062f\u0648\u0631 \u0625\u062f\u0627\u0631\u064a \u0645\u0631\u062a\u0628\u0637 \u0628\u0639\u0646\u0648\u0627\u0646 \u0648\u0638\u064a\u0641\u064a \u0645\u0646 \u0627\u0644\u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0646\u0638\u0627\u0645\u064a\u0629',
      ]
    );
  }

  const { rows: titleCountRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM system_lists
     WHERE category = 'job_title'
       AND value = ANY($1)`,
    [jobTitles]
  );

  const { rows: roleCountRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM roles
     WHERE display_name = ANY($1)`,
    [jobTitles]
  );

  console.log(
    JSON.stringify(
      {
        syncedJobTitles: titleCountRows[0].count,
        syncedAdministrativeRoles: roleCountRows[0].count,
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
