import {
  buildClientLifecycleStatusSql,
  buildCustomerOwnershipSelectColumns,
  buildCustomerOwnershipSql,
  mapCustomerOwnership,
} from './customerOwnership.js';

/** Canonical full client projection shared by client-owned and contextual reads. */
export const CLIENT_SELECT = `
  SELECT
    c.id,
    c.first_name AS "firstName",
    c.father_name AS "fatherName",
    c.last_name AS "lastName",
    c.nickname,
    c.name,
    c.mobile,
    c.contacts,
    c.governorate,
    c.district,
    c.neighborhood,
    c.detailed_address AS "detailedAddress",
    c.gps_coordinates AS "gpsCoordinates",
    c.gender,
    c.national_id AS "nationalId",
    c.birth_date AS "birthDate",
    c.mother_name AS "motherName",
    c.national_id_registry AS "nationalIdRegistry",
    c.national_id_issued_by AS "nationalIdIssuedBy",
    c.national_id_issue_date AS "nationalIdIssueDate",
    c.national_id_box AS "nationalIdBox",
    c.occupation,
    c.spouse_occupation AS "spouseOccupation",
    c.data_quality AS "dataQuality",
    c.water_source AS "waterSource",
    c.notes,
    c.rating,
    c.source_channel AS "sourceChannel",
    c.referrer_type AS "referrerType",
    c.referrer_id AS "referrerId",
    c.referrer_name AS "referrerName",
    c.referral_notes AS "referralNotes",
    c.referrers,
    c.referral_entity_id AS "referralEntityId",
    c.referral_date AS "referralDate",
    c.referral_reason AS "referralReason",
    c.referral_sheet_id AS "referralSheetId",
    c.referral_address_text AS "referralAddressText",
    c.created_at AS "createdAt",
    c.is_candidate AS "isCandidate",
    c.target_client AS "targetClient",
    c.candidate_status AS "candidateStatus",
    ${buildClientLifecycleStatusSql('c')} AS "lifecycleStage",
    c.do_not_contact AS "doNotContact",
    c.cooldown_until AS "cooldownUntil",
    c.cooldown_reason AS "cooldownReason",
    c.cooldown_set_by AS "cooldownSetBy",
    c.cooldown_set_at AS "cooldownSetAt",
    c.branch_id AS "branchId",
    b.name AS "branchName",
    c.created_by AS "createdByUserId",
    cb.name AS "createdByUserName",
    COALESCE(rcb.display_name, cb.role) AS "createdByRoleDisplayName",
    COALESCE(
      (SELECT json_agg(json_build_object(
           'userId',          u2.id,
           'userName',        u2.name,
           'roleDisplayName', COALESCE(r2.display_name, u2.role)
         ) ORDER BY ca.assigned_at)
       FROM client_assignments ca
       JOIN hr_users u2  ON u2.id  = ca.hr_user_id
       LEFT JOIN roles r2 ON r2.id = u2.role_id
       WHERE ca.client_id = c.id),
      '[]'::json
    ) AS "assignments",
    ${buildCustomerOwnershipSelectColumns()}
  FROM clients c
  LEFT JOIN branches b   ON b.id  = c.branch_id
  LEFT JOIN hr_users cb  ON cb.id = c.created_by
  LEFT JOIN roles    rcb ON rcb.id = cb.role_id
  ${buildCustomerOwnershipSql({ clientAlias: 'c', branchNameExpression: 'b.name' })}
`;

export function mapClientRow(row: any) {
  const referrers = Array.isArray(row.referrers) && row.referrers.length > 0
    ? row.referrers
    : (row.referrerName
        ? [{
            id: row.referralEntityId ?? null,
            referrerName: row.referrerName,
            referrerType: row.referrerType ?? 'unknown',
            referralEntityId: row.referralEntityId ?? null,
            referralDate: row.referralDate ?? null,
            address: row.referralAddressText ?? null,
          }]
        : []);
  return {
    ...row,
    referrers,
    ownership: mapCustomerOwnership(row),
  };
}
