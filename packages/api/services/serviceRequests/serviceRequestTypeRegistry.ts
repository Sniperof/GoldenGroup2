import type { Pool, PoolClient } from 'pg';
import pool from '../../db.js';

export interface ServiceRequestTypeDefinition {
  requestType: string;
  labelAr: string;
  descriptionAr: string;
  isActive: boolean;
  displayOrder: number;
  defaultFormVersion: string;
  formSource: string;
  channels: string[];
  submitterTiers: string[];
  submissionModes: string[];
  externalPartyPolicy: Record<string, unknown>;
  mismatchPolicy: Record<string, unknown>;
  linkagePolicy: Record<string, unknown>;
  permissionPolicy: Record<string, unknown>;
  auditPolicy: Record<string, unknown>;
}

type RegistryRow = {
  request_type: string;
  label_ar: string;
  description_ar: string;
  is_active: boolean;
  display_order: number;
  default_form_version: string;
  form_source: string;
  channels: unknown;
  submitter_tiers: unknown;
  submission_modes: unknown;
  external_party_policy: unknown;
  mismatch_policy: unknown;
  linkage_policy: unknown;
  permission_policy: unknown;
  audit_policy: unknown;
};

const SELECT_REGISTRY = `
  SELECT request_type, label_ar, description_ar, is_active, display_order,
         default_form_version, form_source, channels, submitter_tiers,
         submission_modes, external_party_policy, mismatch_policy,
         linkage_policy, permission_policy, audit_policy
    FROM public.service_request_type_config`;

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapRow(row: RegistryRow): ServiceRequestTypeDefinition {
  return {
    requestType: row.request_type,
    labelAr: row.label_ar,
    descriptionAr: row.description_ar,
    isActive: row.is_active,
    displayOrder: row.display_order,
    defaultFormVersion: row.default_form_version,
    formSource: row.form_source,
    channels: stringArray(row.channels),
    submitterTiers: stringArray(row.submitter_tiers),
    submissionModes: stringArray(row.submission_modes),
    externalPartyPolicy: object(row.external_party_policy),
    mismatchPolicy: object(row.mismatch_policy),
    linkagePolicy: object(row.linkage_policy),
    permissionPolicy: object(row.permission_policy),
    auditPolicy: object(row.audit_policy),
  };
}

export async function getServiceRequestTypeDefinition(
  requestType: string,
  db: Pool | PoolClient = pool,
): Promise<ServiceRequestTypeDefinition | null> {
  const { rows } = await db.query<RegistryRow>(
    `${SELECT_REGISTRY} WHERE request_type = $1 LIMIT 1`,
    [requestType],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listActiveServiceRequestTypeDefinitions(
  db: Pool | PoolClient = pool,
): Promise<ServiceRequestTypeDefinition[]> {
  const { rows } = await db.query<RegistryRow>(
    `${SELECT_REGISTRY} WHERE is_active = TRUE ORDER BY display_order, request_type`,
  );
  return rows.map(mapRow);
}
