import pool from '../../db.js';

export interface PublicAreaItem {
  id: number;
  name: string;
  level: number;
  type: string;
  parentId: number | null;
}

export interface PublicAreaSearchItem extends PublicAreaItem {
  path: PublicAreaItem[];
}

interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

interface GeoRow {
  id: number;
  name: string;
  level: number;
  parent_id: number | null;
}

interface SearchPathRow extends GeoRow {
  match_id: number;
}

const LEVEL_TYPE: Record<number, string> = {
  1: 'governorate',
  2: 'city',
  3: 'sub_area',
  4: 'neighborhood',
};

function toPublicArea(row: GeoRow): PublicAreaItem {
  const level = Number(row.level);
  return {
    id: Number(row.id),
    name: row.name,
    level,
    type: LEVEL_TYPE[level] ?? 'area',
    parentId: row.parent_id == null ? null : Number(row.parent_id),
  };
}

export async function listPublicAreas(
  parentId: number | null,
  db: Queryable = pool,
): Promise<PublicAreaItem[]> {
  const params: any[] = [];
  const relationClause = parentId === null
    ? 'g.level = 1'
    : `g.parent_id = $1
       AND EXISTS (
         SELECT 1 FROM geo_units parent
         WHERE parent.id = $1 AND parent.status = 'active'
       )`;
  if (parentId !== null) params.push(parentId);

  const { rows } = await db.query(
    `SELECT g.id, g.name, g.level, g.parent_id
     FROM geo_units g
     WHERE ${relationClause}
       AND g.status = 'active'
     ORDER BY g.name, g.id`,
    params,
  );

  return (rows as GeoRow[]).map(toPublicArea);
}

/**
 * Builds complete active root-to-match paths. A row whose ancestry is missing
 * (for example because an ancestor is inactive) is deliberately omitted.
 */
export function buildPublicAreaSearchItems(rows: SearchPathRow[]): PublicAreaSearchItem[] {
  const grouped = new Map<number, GeoRow[]>();
  for (const row of rows) {
    const matchId = Number(row.match_id);
    const group = grouped.get(matchId) ?? [];
    group.push(row);
    grouped.set(matchId, group);
  }

  const items: PublicAreaSearchItem[] = [];
  for (const [matchId, rawPath] of grouped) {
    const path = rawPath.map(toPublicArea).sort((a, b) => a.level - b.level);
    const leaf = path[path.length - 1];
    const complete = Boolean(
      leaf
      && leaf.id === matchId
      && path.length === leaf.level
      && path.every((unit, index) => (
        unit.level === index + 1
        && (index === 0 ? unit.parentId === null : unit.parentId === path[index - 1].id)
      )),
    );
    if (!complete) continue;
    items.push({ ...leaf, path });
  }

  return items;
}

export async function searchPublicAreas(
  query: string,
  limit: number,
  db: Queryable = pool,
): Promise<PublicAreaSearchItem[]> {
  // strpos treats %, _ and backslashes as ordinary text, unlike an ILIKE pattern.
  const matches = await db.query(
    `SELECT id, name, level, parent_id
     FROM geo_units
     WHERE status = 'active'
       AND strpos(lower(name), lower($1)) > 0
     ORDER BY
       CASE
         WHEN lower(name) = lower($1) THEN 0
         WHEN strpos(lower(name), lower($1)) = 1 THEN 1
         ELSE 2
       END,
       level,
       name,
       id
     LIMIT $2`,
    [query, limit],
  );

  const matchIds = matches.rows.map((row) => Number(row.id));
  if (matchIds.length === 0) return [];

  const paths = await db.query(
    `WITH RECURSIVE area_paths AS (
       SELECT g.id AS match_id, g.id, g.name, g.level, g.parent_id
       FROM geo_units g
       WHERE g.id = ANY($1::int[]) AND g.status = 'active'

       UNION ALL

       SELECT p.match_id, parent.id, parent.name, parent.level, parent.parent_id
       FROM area_paths p
       JOIN geo_units parent ON parent.id = p.parent_id
       WHERE parent.status = 'active'
     )
     SELECT match_id, id, name, level, parent_id
     FROM area_paths
     ORDER BY match_id, level`,
    [matchIds],
  );

  const byId = new Map(buildPublicAreaSearchItems(paths.rows as SearchPathRow[]).map((item) => [item.id, item]));
  // Preserve the relevance order from the bounded matches query.
  return matchIds.map((id) => byId.get(id)).filter((item): item is PublicAreaSearchItem => Boolean(item));
}
