import type { ReportFilterOptions } from './api';

function options(value: unknown): ReportFilterOptions['supervisors'] {
  return Array.isArray(value) ? value : [];
}

/** Protects the UI while the web app and API are on different deployment versions. */
export function normalizeReportFilterOptions(
  value: Partial<ReportFilterOptions> | null | undefined,
): ReportFilterOptions {
  return {
    supervisors: options(value?.supervisors),
    technicians: options(value?.technicians),
    telemarketers: options(value?.telemarketers),
    visitStatuses: options(value?.visitStatuses),
    taskTypes: options(value?.taskTypes),
    deviceModels: options(value?.deviceModels),
    deviceStatuses: options(value?.deviceStatuses),
    warrantyStatuses: options(value?.warrantyStatuses),
    customerRatings: options(value?.customerRatings),
    contactEmployees: options(value?.contactEmployees),
    candidateStatuses: options(value?.candidateStatuses),
    accompanyingTechnicians: options(value?.accompanyingTechnicians),
    giftPromiseStatuses: options(value?.giftPromiseStatuses),
    contractStatuses: options(value?.contractStatuses),
    contractSellers: options(value?.contractSellers),
    contractSellerDepartments: options(value?.contractSellerDepartments),
    contractSales: options(value?.contractSales),
    collectionOwners: options(value?.collectionOwners),
    saleClosers: options(value?.saleClosers),
    departmentTypes: options(value?.departmentTypes),
    faultTypes: options(value?.faultTypes),
    repairTechnicians: options(value?.repairTechnicians),
    retrievalTechnicians: options(value?.retrievalTechnicians),
    retrievedDeviceStatuses: options(value?.retrievedDeviceStatuses),
    giftDefinitions: options(value?.giftDefinitions),
    callEmployees: options(value?.callEmployees),
    callOutcomes: options(value?.callOutcomes),
  };
}
