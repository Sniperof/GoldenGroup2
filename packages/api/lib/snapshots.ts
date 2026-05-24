/**
 * Utility functions for building frozen snapshots of customer and contract data
 * Part of TASK 165
 */

/**
 * Internal recursive helper returning the path from a geo unit to its root parent (Governorate).
 * Returns array sorted from bottom (Neighborhood) to top (Governorate).
 */
export async function getGeoUnitHierarchy(
  pool: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  geoUnitId: number | string | null | undefined
): Promise<Array<{ id: number; name: string; level: number }> | null> {
  if (geoUnitId == null || String(geoUnitId).trim() === '') return null;
  const unitId = Number(geoUnitId);
  if (!Number.isInteger(unitId)) return null;

  try {
    const { rows } = await pool.query(
      `WITH RECURSIVE geo_path AS (
        SELECT id, name, level, parent_id
        FROM geo_units
        WHERE id = $1
        UNION ALL
        SELECT gu.id, gu.name, gu.level, gu.parent_id
        FROM geo_units gu
        JOIN geo_path gp ON gp.parent_id = gu.id
      )
      SELECT id, name, level FROM geo_path ORDER BY level DESC`,
      [unitId]
    );
    if (rows.length === 0) return null;
    return rows.map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      level: Number(r.level)
    }));
  } catch (err) {
    console.error(`[snapshots] getGeoUnitHierarchy error for ID ${geoUnitId}:`, err);
    return null;
  }
}

/**
 * Builds the customer_snapshot JSONB structure for a client, resolving the full geo hierarchy.
 */
export async function buildCustomerSnapshot(
  pool: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  clientId: number | string,
  branchId?: number | null
): Promise<any> {
  const id = Number(clientId);
  if (!Number.isInteger(id)) return null;

  try {
    const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
    if (clientRows.length === 0) return null;
    const client = clientRows[0];

    let governorate = null;
    let district = null;
    let subDistrict = null;
    let neighborhood = null;

    if (client.neighborhood && String(client.neighborhood).trim() !== '') {
      const hierarchy = await getGeoUnitHierarchy(pool, client.neighborhood);
      if (hierarchy) {
        governorate = hierarchy.find(g => g.level === 1) || null;
        district = hierarchy.find(g => g.level === 2) || null;
        subDistrict = hierarchy.find(g => g.level === 3) || null;
        neighborhood = hierarchy.find(g => g.level === 4) || null;
      }
    }

    if (!governorate && client.governorate && String(client.governorate).trim() !== '') {
      const { rows: govRows } = await pool.query('SELECT id, name, level FROM geo_units WHERE id = $1', [Number(client.governorate)]);
      if (govRows.length > 0) governorate = { id: Number(govRows[0].id), name: String(govRows[0].name), level: 1 };
    }
    if (!district && client.district && String(client.district).trim() !== '') {
      const { rows: disRows } = await pool.query('SELECT id, name, level FROM geo_units WHERE id = $1', [Number(client.district)]);
      if (disRows.length > 0) district = { id: Number(disRows[0].id), name: String(disRows[0].name), level: 2 };
    }

    let branch = null;
    const finalBranchId = branchId != null ? branchId : client.branch_id;
    if (finalBranchId) {
      const { rows: branchRows } = await pool.query('SELECT id, name FROM branches WHERE id = $1', [finalBranchId]);
      if (branchRows.length > 0) {
        branch = { id: Number(branchRows[0].id), name: String(branchRows[0].name) };
      }
    }

    const contacts = Array.isArray(client.contacts) ? client.contacts : [];
    const referrers = Array.isArray(client.referrers) ? client.referrers : [];

    // Parse gps
    let gps = null;
    if (client.gps_coordinates) {
      const gpsObj = typeof client.gps_coordinates === 'string'
        ? (() => { try { return JSON.parse(client.gps_coordinates); } catch { return null; } })()
        : client.gps_coordinates;
      if (gpsObj && typeof gpsObj === 'object') {
        gps = {
          lat: gpsObj.lat != null ? Number(gpsObj.lat) : null,
          lng: gpsObj.lng != null ? Number(gpsObj.lng) : null
        };
      }
    }

    return {
      name: client.name,
      firstName: client.first_name,
      fatherName: client.father_name,
      lastName: client.last_name,
      nickname: client.nickname,
      mobile: client.mobile,
      contacts: contacts,
      address: {
        governorate: governorate ? { id: governorate.id, name: governorate.name } : null,
        district: district ? { id: district.id, name: district.name } : null,
        subDistrict: subDistrict ? { id: subDistrict.id, name: subDistrict.name } : null,
        neighborhood: neighborhood ? { id: neighborhood.id, name: neighborhood.name } : null,
        detailedAddress: client.detailed_address ?? '',
        gps: gps
      },
      branch: branch,
      waterSource: client.water_source,
      occupation: client.occupation,
      spouseOccupation: client.spouse_occupation,
      rating: client.rating,
      referrers: referrers
    };
  } catch (err) {
    console.error(`[snapshots] buildCustomerSnapshot error for client ${clientId}:`, err);
    return null;
  }
}

/**
 * Builds the contract_snapshot JSONB structure for a contract, resolving installation geo units.
 */
export async function buildContractSnapshot(
  pool: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> },
  contractId: number | string
): Promise<any> {
  const id = Number(contractId);
  if (!Number.isInteger(id)) return null;

  try {
    const { rows } = await pool.query(
      `SELECT c.*, gu.name AS installation_geo_unit_name
       FROM contracts c
       LEFT JOIN geo_units gu ON gu.id = c.installation_geo_unit_id
       WHERE c.id = $1`,
      [id]
    );
    if (rows.length === 0) return null;
    const contract = rows[0];

    const hierarchy = await getGeoUnitHierarchy(pool, contract.installation_geo_unit_id);
    const sortedHierarchy = hierarchy ? [...hierarchy].sort((a, b) => a.level - b.level) : [];

    const installationAddress = {
      geoUnit: contract.installation_geo_unit_id ? {
        id: Number(contract.installation_geo_unit_id),
        name: contract.installation_geo_unit_name ?? ''
      } : null,
      hierarchy: sortedHierarchy.map(h => ({
        level: Number(h.level),
        name: String(h.name)
      })),
      addressText: contract.installation_address_text ?? '',
      gps: {
        lat: contract.installation_lat ? Number(contract.installation_lat) : null,
        lng: contract.installation_lng ? Number(contract.installation_lng) : null
      }
    };

    let contractDateStr = null;
    if (contract.contract_date) {
      if (contract.contract_date instanceof Date) {
        contractDateStr = contract.contract_date.toISOString().split('T')[0];
      } else {
        contractDateStr = String(contract.contract_date).split('T')[0];
      }
    }

    return {
      contractId: Number(contract.id),
      contractNumber: contract.contract_number,
      contractDate: contractDateStr,
      device: {
        modelId: contract.device_model_id != null ? Number(contract.device_model_id) : null,
        modelName: contract.device_model_name ?? '',
        serialNumber: contract.serial_number ?? '',
        maintenancePlan: contract.maintenance_plan ?? ''
      },
      installationAddress,
      financials: {
        paymentType: contract.payment_type,
        finalPrice: Number(contract.final_price) || 0,
        downPayment: Number(contract.down_payment) || 0,
        installmentsCount: Number(contract.installments_count) || 0,
        currency: 'SYP'
      },
      status: contract.status
    };
  } catch (err) {
    console.error(`[snapshots] buildContractSnapshot error for contract ${contractId}:`, err);
    return null;
  }
}
