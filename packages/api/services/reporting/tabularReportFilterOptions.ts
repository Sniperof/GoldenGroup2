export type TabularReportFilterOption = { value: string; label: string };

export interface TabularReportFilterOptions {
  supervisors: TabularReportFilterOption[];
  technicians: TabularReportFilterOption[];
  telemarketers: TabularReportFilterOption[];
  visitStatuses: TabularReportFilterOption[];
  taskTypes: TabularReportFilterOption[];
  deviceModels: TabularReportFilterOption[];
  deviceStatuses: TabularReportFilterOption[];
  warrantyStatuses: TabularReportFilterOption[];
  customerRatings: TabularReportFilterOption[];
  contactEmployees: TabularReportFilterOption[];
  candidateStatuses: TabularReportFilterOption[];
  accompanyingTechnicians: TabularReportFilterOption[];
  giftPromiseStatuses: TabularReportFilterOption[];
  contractStatuses: TabularReportFilterOption[];
  contractSellers: TabularReportFilterOption[];
  contractSellerDepartments: TabularReportFilterOption[];
  contractSales: TabularReportFilterOption[];
  collectionOwners: TabularReportFilterOption[];
  saleClosers: TabularReportFilterOption[];
  departmentTypes: TabularReportFilterOption[];
  faultTypes: TabularReportFilterOption[];
  repairTechnicians: TabularReportFilterOption[];
  retrievalTechnicians: TabularReportFilterOption[];
  retrievedDeviceStatuses: TabularReportFilterOption[];
  giftDefinitions: TabularReportFilterOption[];
  callEmployees: TabularReportFilterOption[];
  callOutcomes: TabularReportFilterOption[];
  originBranches: TabularReportFilterOption[];
  routes: TabularReportFilterOption[];
  departments: TabularReportFilterOption[];
  jobTitles: TabularReportFilterOption[];
  taskResults: TabularReportFilterOption[];
  cancellationReasons: TabularReportFilterOption[];
}

function options(value: unknown): TabularReportFilterOption[] {
  return Array.isArray(value) ? value : [];
}

/** Keeps the filter-options endpoint contract stable across every report. */
export function completeTabularReportFilterOptions(
  value: Partial<TabularReportFilterOptions> | null | undefined,
): TabularReportFilterOptions {
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
    originBranches: options(value?.originBranches),
    routes: options(value?.routes),
    departments: options(value?.departments),
    jobTitles: options(value?.jobTitles),
    taskResults: options(value?.taskResults),
    cancellationReasons: options(value?.cancellationReasons),
  };
}
