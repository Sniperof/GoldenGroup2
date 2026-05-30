

export interface GeoUnit {
    id: number;
    name: string;
    level: number;
    parentId: number | null;
    status?: 'active' | 'inactive';
}

export interface RoutePoint {
    geoUnitId: number;
    level: number;
    order: number;
}

export interface Route {
    id: number;
    name: string;
    points: RoutePoint[];
    status: string;
}

export type ReferralType = 'Personal' | 'Client' | 'Employee' | 'Unknown';
export type ReferralOriginChannel = 'Acquaintance' | 'PhoneCall' | 'SocialMedia' | 'Campaign' | 'App';
export type ClientRating = 'Committed' | 'NotCommitted' | 'Undefined';

export interface ReferralSheetStats {
    totalCandidates: number;
    targetCandidates?: number;
    qualityPercentage: number;
    conversionPercentage: number;
}

export interface ReferralSheet {
    id: number;
    referralType: ReferralType;
    referralEntityId: number | null;
    referralNameSnapshot: string;
    referralAddressText: string;
    referralOriginChannel: ReferralOriginChannel;
    referralNotes?: string;
    referralDate: string;
    ownerUserId: number;
    assignedHrUserId?: number | null;
    assignedHrUserName?: string | null;
    branchId?: number | null;
    branchName?: string | null;
    status: 'New' | 'In-Progress' | 'Completed' | 'Archived';
    stats: ReferralSheetStats;
    createdAt: string;
    createdBy: number;
}

export type CandidateStatus = 'Prospect' | 'Suggested' | 'FollowUp' | 'Contacted' | 'Qualified' | 'Junk';
export type ReferralConfirmationStatus = 'Pending' | 'Confirmed' | 'Rejected';
export type DuplicateType = 'Candidate' | 'Client' | 'Both';

export interface Candidate {
    id: number;
    firstName: string | null;
    lastName?: string;
    nickname: string | null;
    mobile: string;
    occupation?: string;
    contacts?: ContactEntry[];
    addressText: string;
    geoUnitId: number | null;
    ownerUserId: number;
    status: CandidateStatus;
    referralSheetId: number | null;
    referralDate: string;
    referralReason: string;
    referralType: ReferralType;
    referralOriginChannel: ReferralOriginChannel;
    referralNameSnapshot: string;
    referralEntityId: number | null;
    referralConfirmationStatus: ReferralConfirmationStatus;
    candidateNotes?: string;
    duplicateFlag: boolean;
    duplicateType: DuplicateType | null;
    duplicateReferenceId: number | null;
    convertedToLeadId: number | null;
    assignments?: CandidateAssignment[];
    createdByUserId?: number | null;
    createdByUserName?: string | null;
    createdByRoleDisplayName?: string | null;
    branchId?: number | null;
    branchName?: string | null;
    createdAt: string;
    createdBy: number;
}

export type EmployeeRole = 'supervisor' | 'technician' | 'telemarketer' | 'trainee';

export interface Employee {
    id: number;
    employeeNumber?: number | null;
    name: string;
    firstName?: string | null;
    fatherName?: string | null;
    lastName?: string | null;
    role: EmployeeRole | null;
    mobile: string;
    contacts?: ContactEntry[];
    birthDate?: string | null;
    gender?: 'male' | 'female' | null;
    maritalStatus?: string | null;
    militaryService?: string | null;
    branchId?: number | null;
    branch?: string | null;
    departmentId?: number | null;
    departmentName?: string | null;
    residence?: string | null;
    residenceShort?: string | null;
    residenceGovernorateId?: number | null;
    residenceGovernorate?: string | null;
    residenceRegionId?: number | null;
    residenceRegion?: string | null;
    residenceSubAreaId?: number | null;
    residenceSubArea?: string | null;
    residenceNeighborhoodId?: number | null;
    residenceNeighborhood?: string | null;
    detailedAddress?: string | null;
    status: 'active' | 'vacation' | 'suspended' | 'terminated';
    canAppearInSchedule?: boolean;
    teamSlotType?: 'SUPERVISOR' | 'TECHNICIAN' | 'TRAINEE' | 'TELEMARKETER' | null;
    avatar?: string;
    jobTitle?: string | null;
    academicQualification?: string | null;
    specialization?: string | null;
    yearsOfExperience?: number | null;
    drivingLicense?: boolean | null;
    jobSkills?: string | null;
    foreignLanguages?: string[];
    hireDate?: string | null;
    startWorkDate?: string | null;
    contractType?: string | null;
    workType?: string | null;
    previousEmployment?: string | null;
    directManagerId?: number | null;
    directManagerName?: string | null;
    referrerType?: ReferralType | string | null;
    sourceChannel?: ReferralOriginChannel | string | null;
    referrerName?: string | null;
    referralNotes?: string | null;
    createdAt?: string;
}

export interface EmployeeSystemAccount {
    id: number;
    username: string;
    isActive: boolean;
    roleId: number | null;
    roleDisplayName: string | null;
}

export interface EmployeeJobTask {
    id: number;
    roleId: number;
    title: string;
    description: string | null;
    displayOrder: number;
    isActive: boolean;
}

export interface EmployeeDetail extends Employee {
    systemAccount: EmployeeSystemAccount | null;
    jobTasks: EmployeeJobTask[];
    hiringApplication: JobApplicationDetail | null;
}

export interface EmployeeManagerCandidate {
  id: number;
  name: string;
  jobTitle: string | null;
  departmentId: number | null;
  departmentName: string | null;
  roleDisplayName: string | null;
  isRecommendedManager: boolean;
}

export type BranchContactType = 'email' | 'phone' | 'mobile' | 'website';
export type BranchDepartment = 'customer_service' | 'hr' | 'management' | 'accounting' | 'other';

export interface BranchContact {
  id: string;            // client-side UUID for keying
  type: BranchContactType;
  department: BranchDepartment;
  value: string;         // the actual email/phone/url value
  label?: string;        // optional extra note
}

export interface Branch {
    id: number;
    name: string;
    locationGeoId?: number | null;
    locationGeoName?: string;
    detailedAddress?: string | null;
    coveredGeoIds: number[];
    contactInfo: BranchContact[];
    status: 'active' | 'inactive';
    createdAt: string;
}

export type ContactType = 'mobile' | 'landline' | 'other';
export type ContactStatus = 'active' | 'preferred' | 'out-of-coverage' | 'unused' | 'invalid';

export interface ContactEntry {
    id: string;
    type: ContactType;
    number: string;
    areaCode?: string;
    label: string;
    hasWhatsApp: boolean;
    isPrimary: boolean;
    status: ContactStatus;
}

export interface ClientReferrer {
    id: string;
    referrerType: string;
    referralEntityId: number | null;
    referrerName: string;
    sourceChannel: string;
    referralDate: string;
    referralReason: string;
    referralSheetId?: number | null;
}

export interface ClientAssignment {
    userId: number;
    userName: string;
    roleDisplayName: string | null;
}

export type CustomerOwnershipType =
    | 'personal_single_supervisor'
    | 'personal_single_technician'
    | 'personal_multi'
    | 'company_branch'
    | 'company_global';

export type CompanyOwnershipScope = 'branch' | 'global';

export type EffectiveOwnershipReason =
    | 'personal_assignment_active'
    | 'company_default_unassigned'
    | 'company_default_non_owner_assignments_ignored'
    | 'company_reclaimed_op_fop';

export interface PersonalOwnershipAssignment {
    userId: number;
    userName: string;
    roleDisplayName: string | null;
    teamSlotType: 'SUPERVISOR' | 'TECHNICIAN';
    employeeId: number | null;
}

export interface CustomerOwnership {
    ownerType: CustomerOwnershipType;
    ownerLabel: string;
    personalAssignments: PersonalOwnershipAssignment[];
    companyOwnershipScope: CompanyOwnershipScope;
    effectiveOwnershipReason: EffectiveOwnershipReason;
}

export interface CandidateAssignment {
    userId: number;
    userName: string;
    roleDisplayName: string | null;
}

export interface Client {
    id: number;
    firstName: string;
    fatherName: string;
    lastName: string;
    nickname?: string;
    name: string;
    mobile: string;
    contacts: ContactEntry[];
    governorate: string;
    district: string;
    neighborhood: string;
    detailedAddress?: string;
    gpsCoordinates?: { lat: number; lng: number };
    gender?: 'male' | 'female';
    nationalId?: string;
    birthDate?: string;
    motherName?: string | null;
    nationalIdRegistry?: string | null;
    nationalIdIssuedBy?: string | null;
    nationalIdIssueDate?: string | null;
    nationalIdBox?: string | null;
    occupation?: string;
    spouseOccupation?: string;
    dataQuality?: 'correct' | 'incorrect' | 'needs_edit';
    waterSource?: string;
    notes?: string;
    rating?: ClientRating;
    sourceChannel?: string;
    referrerType?: string;
    referrerId?: number;
    referrerName?: string;
    referralNotes?: string;
    referralEntityId?: number | null;
    referralDate?: string;
    referralReason?: string;
    referralSheetId?: number | null;
    referralAddressText?: string;
    branchId?: number | null;
    branchName?: string | null;
    assignments?: ClientAssignment[];
    ownership?: CustomerOwnership;
    createdByUserId?: number | null;
    createdByUserName?: string | null;
    createdByRoleDisplayName?: string | null;
    referrers?: ClientReferrer[];
    createdAt: string;
    isCandidate?: boolean;
    targetClient?: string;
    candidateStatus?: string;
}

export interface SmartMatchVisibleClient {
    id: number;
    name: string;
    phone: string;
    branchName: string | null;
    assignedUserName: string | null;
}

export type ClientSmartMatchResponse =
    | {
        status: 'NO_MATCH';
        matched: false;
        visible: false;
        normalizedPhone: string;
        message: string;
    }
    | {
        status: 'MATCH_VISIBLE';
        matched: true;
        visible: true;
        normalizedPhone: string;
        client: SmartMatchVisibleClient;
    }
    | {
        status: 'MATCH_RESTRICTED';
        matched: true;
        visible: false;
        normalizedPhone: string;
        reason: 'OUT_OF_SCOPE';
        message: string;
    };

export interface Visit {
    id: string;
    date: string;
    customerId: number;
    employeeId: number;
    employeeName: string;
    outcome: 'Pending' | 'Completed' | 'Cancelled';
    notes?: string;
}

export type MarketingVisitType = 'marketing';

export type MarketingVisitStage =
    | 'scheduled'
    | 'in_visit'
    | 'ended'
    | 'cancelled'
    | 'needs_reschedule';

export type MarketingVisitCompletionState =
    | 'completed'
    | 'not_completed'
    | null;

export type MarketingVisitStatus =
    | MarketingVisitStage
    | Exclude<MarketingVisitCompletionState, null>;

// General status for field_visits (the core visit table).
// Superset of MarketingVisitStatus — adds 'ended' and 'in_progress'.
// ended   = field execution finished, awaiting result recording.
// completed = all visit_tasks have recorded final results (auto-set by rule).
// Marketing visits skip 'ended' because result recording and visit completion are one step.
// Emergency visits go: scheduled → ended (result recorded) → completed (auto via rule).
export type FieldVisitStatus =
    | 'scheduled'
    | 'in_progress'
    | 'ended'
    | 'completed'
    | 'not_completed'
    | 'postponed_by_company'
    | 'postponed_by_customer'
    | 'cancelled'
    | 'needs_reschedule';

export type MarketingVisitTaskType =
  | 'device_demo' | 'device_purchase' | 'device_delivery' | 'device_installation'
  | 'device_activation' | 'periodic_maintenance' | 'emergency_maintenance'
  | 'installment_collection' | 'maintenance_collection' | 'gift_delivery'
  | 'device_checkup' | 'parts_sale' | 'device_retrieval' | 'device_repair'
  | 'device_return' | 'golden_warranty' | 'warranty_cancellation'
  | 'warranty_reactivation' | 'device_disconnection' | 'device_transfer';

export type MarketingVisitTaskStatus = 'pending' | 'completed' | 'not_completed';

export type MarketingVisitTaskResult =
    | 'cash_offer_closed'
    | 'installment_offer_closed'
    | 'cash_offer_not_closed'
    | 'installment_offer_not_closed'
    | 'demo_not_completed';

export type MarketingVisitTaskOutcome =
  | 'offer_presented'
  | 'device_sold'
  | 'rescheduled'
  | 'cancelled';

export const MARKETING_VISIT_TASK_OUTCOME_LABELS: Record<MarketingVisitTaskOutcome, string> = {
  offer_presented: 'تقديم عرض (بدون بيع)',
  device_sold: 'تم البيع',
  rescheduled: 'إعادة جدولة الزيارة',
  cancelled: 'إلغاء الزيارة',
};

export type MarketingVisitSourceType = 'telemarketing_appointment';

export type MarketingVisitNonCompletionReason =
    | 'no_entry_to_home'
    | 'customer_unavailable'
    | 'wrong_address'
    | 'customer_refused_visit'
    | 'financial_not_ready'
    | 'company_reason'
    | 'other';

export interface MarketingVisitTeamSnapshot {
    supervisorEmployeeId?: number | null;
    technicianEmployeeId?: number | null;
    traineeEmployeeId?: number | null;
    telemarketerEmployeeIds?: number[];
}

export interface MarketingVisitTask {
    id: string;
    visitId: string;
    taskType: MarketingVisitTaskType;
    status: MarketingVisitTaskStatus;
    result?: MarketingVisitTaskResult | null;
    offers?: MarketingVisitTaskOfferInput[] | null;
    cashOfferAmount?: number | null;
    installmentAmount?: number | null;
    installmentMonths?: number | null;
    closedByEmployeeId?: number | null;
    resultNotes?: string | null;
    contractId?: number | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    currency?: string | null;
    discountPercentage?: number | null;
    soldDeviceModelId?: number | null;
    soldDeviceModelName?: string | null;
    offeredDeviceModelId?: number | null;
    offeredDeviceModelName?: string | null;
    noClosingReason?: string | null;
    outcome?: MarketingVisitTaskOutcome | null;
    offerType?: 'cash' | 'installment' | null;
    hasDiscount?: boolean | null;
    isDeviceSold?: boolean | null;
    appliedDeviceDiscountId?: number | null;
    saleReferenceNumber?: string | null;
    cancellationReasonId?: number | null;
    cancellationReasonName?: string | null;
    rescheduleReasonId?: number | null;
    rescheduleReasonName?: string | null;
    followUpDueDate?: string | null;
    cancellationReason?: string | null;
    rescheduleReason?: string | null;
    sourceOpenTaskId?: number | null;
    openTaskPriority?: 'high' | 'medium' | 'low' | null;
    openTaskDueDate?: string | null;
}

export interface MarketingVisit {
    id: string;
    branchId: number;
    clientId: number;
    visitType: MarketingVisitType;
    status: MarketingVisitStatus;
    scheduledDate: string;
    scheduledTime: string;
    sourceType: MarketingVisitSourceType;
    sourceId: string;
    contactTargetId?: number | null;
    taskListId?: string | null;
    taskListItemId?: string | null;
    teamKey?: string | null;
    requestedDeviceModelId?: number | null;
    requestedDeviceName?: string | null;
    waterSource?: string | null;
    technicianNotes?: string | null;
    customerName?: string | null;
    customerAddress?: string | null;
    customerMobile?: string | null;
    clientNickname?: string | null;
    clientOccupation?: string | null;
    clientGender?: 'male' | 'female' | null;
    clientDataQuality?: 'correct' | 'incorrect' | 'needs_edit' | null;
    clientRating?: 'Committed' | 'NotCommitted' | 'Undefined' | null;
    clientContacts?: ContactEntry[] | null;
    clientGovernorate?: string | null;
    clientDistrict?: string | null;
    clientNeighborhood?: string | null;
    clientDetailedAddress?: string | null;
    clientGpsCoordinates?: { lat: number; lng: number } | null;
    branchName?: string | null;
    ownership?: CustomerOwnership;
    referrerName?: string | null;
    supervisorEmployeeId?: number | null;
    technicianEmployeeId?: number | null;
    traineeEmployeeId?: number | null;
    teamSnapshot?: MarketingVisitTeamSnapshot | null;
    workRouteCount?: number | null;
    additionalAreaCount?: number | null;
    task?: MarketingVisitTask | null;
    tasks?: MarketingVisitTask[];
    createdBy?: number | null;
    completedBy?: number | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface MarketingVisitTaskOfferInput {
    deviceModelId: number;
    offerType: 'cash' | 'installment';
    quantity: number;
    totalAmount: number;
    firstPaymentAmount?: number | null;
    installmentMonths?: number | null;
    currency: string;
    discountPercentage?: number | null;
    appliedDeviceDiscountId?: number | null;
    closedByEmployeeId?: number | null;
    noClosingReason?: string | null;
    customerResponse: 'accepted' | 'rejected' | 'extension_requested' | null;
    rejectionReasonId?: number | null;
    extensionReasonId?: number | null;
    extensionDueDate?: string | null;
    saleReferenceNumber?: string | null;
    contractId?: number | null;
}

export interface MarketingVisitResultUpdateRequest {
    status: MarketingVisitStatus;
    outcome?: MarketingVisitTaskOutcome;
    taskResult?: MarketingVisitTaskResult | null;
    offers?: MarketingVisitTaskOfferInput[] | null;
    offerType?: 'cash' | 'installment' | null;
    cashOfferAmount?: number | null;
    installmentAmount?: number | null;
    installmentMonths?: number | null;
    currency?: string | null;
    discountPercentage?: number | null;
    closedByEmployeeId?: number | null;
    noClosingReason?: string | null;
    soldDeviceModelId?: number | null;
    offeredDeviceModelId?: number | null;
    rescheduleReasonId?: number | null;
    followUpDueDate?: string | null;
    cancellationReasonId?: number | null;
    nonCompletionReason?: MarketingVisitNonCompletionReason | null;
    notes?: string | null;
}

export interface MarketingVisitTaskOutcomeRequest extends Omit<MarketingVisitResultUpdateRequest, 'status' | 'taskResult' | 'nonCompletionReason'> {}

export interface MarketingVisitLifecycleTaskUpdate {
    openTaskId: number;
    priority: 'high' | 'medium' | 'low';
    dueDate?: string | null;
}

export interface MarketingVisitRescheduleRequest {
    rescheduleReasonId: number;
    notes?: string | null;
    taskUpdates: MarketingVisitLifecycleTaskUpdate[];
}

export interface MarketingVisitCancelRequest {
    cancellationReasonId: number;
    notes?: string | null;
    taskUpdates: MarketingVisitLifecycleTaskUpdate[];
}

export interface TeamSlot {
    supervisor: number | null;
    technician: number | null;
    telemarketers?: number[];
    trainee?: number | null;
}

export interface EmergencySlot {
    technician: number | null;
    trainee?: number | null;
    telemarketers?: number[];
}

/** @deprecated Use EmergencySlot */
export type SoloSlot = EmergencySlot;

export interface DaySchedule {
    teams: TeamSlot[];
    solos: EmergencySlot[];
}

export interface RouteComposition {
    routeId: number;
    startIdx: number;
    endIdx: number;
    direction: 'forward' | 'reverse';
}

export interface RouteAssignmentData {
    routes: RouteComposition[];
    extraZones: number[];
    stationOrder?: number[];
}

export interface Task {
    id: number;
    type: 'emergency' | 'dues' | 'periodic' | 'returns' | 'followup';
    customerName: string;
    context: string;
    location: string;
    dueDate: string;
    status: 'pending' | 'in-progress' | 'completed';
    priority?: 'high' | 'medium' | 'low';
}

export interface DeviceModel {
    id: number;
    name: string;
    brand: string;
    nameAr?: string | null;
    nameEn: string;
    category: 'منزلي' | 'صناعي' | 'تجاري';
    maintenanceInterval: '3 أشهر' | '6 أشهر' | '1 سنة';
    basePrice: number;
    supportedVisitTypes: ('تسليم' | 'تركيب' | 'صيانة' | 'تعليم')[];
    isGoldenWarranty?: boolean;
    goldenWarrantyPeriods?: Array<{ months: number; label: string }>;
    warrantyPeriods?: Array<{ months: number; label: string; visits: number }>;
    isFeatured?: boolean;
    description?: string | null;
    descriptionEn?: string | null;
    images?: Array<{ id: string; name: string; url: string }>;
    primaryImageId?: string | null;
    videos?: Array<{ id: string; name: string; url: string }>;
    documents?: Array<{ id: string; name: string; url: string }>;
    code?: string | null;
}

export interface DeviceDiscount {
  id: number;
  deviceModelId: number;
  label: string;
  percentage: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdBy?: number | null;
  createdAt?: string;
}

// Contract status — unified per DEC-CT-01.
// `temporary` is no longer a status; it lives in `saleSubtype` instead.
//   draft      — created without closing_employee_id
//   active     — closing_employee_id assigned (legally bound)
//   completed  — all installments settled (financial closure)
//   cancelled  — was active, then explicitly cancelled
//   discarded  — was draft, rejected before activation
export type ContractStatus = 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded';
export type SaleSubtype = 'definitive' | 'temporary' | 'free';
export type SaleType = 'tradein' | 'retention' | 'direct';
// DEC-CT-02: `maintenance_contract` has been extracted into the independent
// `service_agreements` entity. The literal is retained in this union for
// backward compatibility with existing web state and read paths only —
// the DB CHECK constraint (migration 207) rejects any new insert/update
// with this value. New code MUST use ServiceAgreement instead.
//
// @deprecated maintenance_contract — use ServiceAgreement (see shared types below).
export type ContractType = 'sale_contract' | 'maintenance_contract';

// Device status dictionary — unified per DEC-CT-03.
// Legacy `under_maintenance`/`disconnected` mapped via migration 199.
export type DeviceStatus =
  | 'registered'
  | 'pending_delivery'
  | 'delivered'
  | 'installed'
  | 'active'
  | 'faulty'
  | 'in_workshop'
  | 'ready'
  | 'out_of_service'
  | 'retrieved';

// Warranty status — per DEC-CT-05 (replaces is_active).
export type WarrantyStatus = 'pending' | 'active' | 'cancelled' | 'expired';
export type WarrantyCancellationReason = 'contract_cancelled' | 'device_retrieved' | 'manual';

// DEC-CT-02: independent service agreement for third-party devices we maintain.
export type ServiceAgreementStatus = 'draft' | 'active' | 'cancelled' | 'completed' | 'discarded';

export interface ServiceAgreement {
  id: number;
  agreementNumber?: string | null;
  customerId: number;
  customerName: string;
  branchId?: number | null;
  agreementDate: string;
  externalDeviceModelName?: string | null;
  externalDeviceSerial?: string | null;
  externalDeviceNotes?: string | null;
  maintenancePlan?: string | null;
  visitsCount?: number | null;
  feeSyp: number;
  status: ServiceAgreementStatus;
  startDate?: string | null;
  endDate?: string | null;
  closingEmployeeId?: number | null;
  createdBy?: number | null;
  /** id of the legacy contracts row this agreement was migrated from (DEC-CT-02). */
  legacyContractId?: number | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// DEC-CT-09: device possession ledger.
export type PossessionHolderType = 'warehouse' | 'technician' | 'customer' | 'workshop' | 'supplier';
export type PossessionReason     = 'sale_delivery' | 'repair_pickup' | 'temporary_swap'
                                  | 'retrieval' | 'cancellation' | 'transfer';

export interface DevicePossessionEntry {
  id: number;
  deviceId: number;
  holderType: PossessionHolderType;
  holderId: number | null;
  startAt: string;
  endAt: string | null;
  reason: PossessionReason;
  notes?: string | null;
  createdBy?: number | null;
  createdAt: string;
}
export type SaleSource = string;
export type PaymentType = 'cash' | 'installment';
export type MaintenancePlan = '3' | '6' | '12';

export interface ContractLineItem {
    id?: number;
    contractId?: number;
    itemType: 'device' | 'accessory' | 'service_fee';
    sparePartId?: number | null;
    description?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    isInstalled?: boolean;
}

/** DEC-CT-13 — a single member of the frozen offer-team snapshot on a contract. */
export interface ContractOfferTeamMember {
    employeeId: number;
    name: string;
    role?: string | null;
}

export interface ContractDiscountSnapshot {
    id: number;
    label: string;
    percentage: number;
}

export type DueType = 'Installment' | 'Maintenance Fee' | 'Down Payment';
export type DueStatus = 'Pending' | 'Partial' | 'Paid' | 'Overdue';

export interface Due {
    id: number;
    contractId: number;
    type: DueType;
    scheduledDate: string;
    adjustedDate: string;
    originalAmount: number;
    remainingBalance: number;
    assignedTelemarketerId: number | null;
    status: DueStatus;
    escalated: boolean;
}

// DEC-CT-08: entry_type distinguishes collection (default) from refund.
// Amount remains positive; semantics flow from entry_type.
export type PaymentEntryType = 'collection' | 'refund';

export interface ContractPaymentEntry {
    id: number;
    contractId: number;
    method: 'cash' | 'sham_cash' | 'syriatel_cash' | 'mtn_cash' | 'alharam' | 'bank_transfer' | 'barter';
    currency: 'SYP' | 'USD';
    amountValue: number;
    exchangeRate?: number | null;
    amountSyp: number;
    referenceNumber?: string;
    barterName?: string;
    barterValueSyp?: number;
    receivedByEmployeeId?: number | null;
    receivedAt: string;
    notes?: string;
    /** DEC-CT-08 — defaults to 'collection' if omitted. */
    entryType?: PaymentEntryType;
    /** DEC-CT-06 — allocation target. Null for down-payments / generic refunds. */
    installmentId?: number | null;
}

export interface ContractInstallment {
    id: number;
    contractId: number;
    installmentNumber: number;
    dueDate: string;
    amountSyp: number;
    status: 'pending' | 'paid' | 'partial' | 'overdue';
    paidAmount: number;
    remainingBalance: number;
    confirmed: boolean;
    /** DEC-CT-12 — per-installment collection owner. */
    collectionOwnerId?: number | null;
}

export interface Contract {
    id: number;
    contractNumber: string;
    customerId: number;
    customerName: string;
    contractDate: string;
    sourceVisit?: string | null;
    deviceModelId: number;
    deviceModelName: string;
    serialNumber: string;
    maintenancePlan: MaintenancePlan;
    basePrice: number;
    finalPrice: number;
    paymentType: PaymentType;
    downPayment: number;
    installmentsCount: number;
    dues: Due[];
    deliveryDate: string;
    installationDate: string;
    status: ContractStatus;
    saleType?: SaleType | null;
    saleSource?: SaleSource | null;
    discountId?: number | null;
    discount?: ContractDiscountSnapshot | null;
    lineItems?: ContractLineItem[];
    deviceStatus?: DeviceStatus;
    paymentEntries?: ContractPaymentEntry[];
    installments?: ContractInstallment[];
    closingEmployeeId?: number | null;
    closingDate?: string | null;
    /** DEC-CT-11 — deal originator, distinct from closing employee. */
    saleOwnerId?: number | null;
    /** DEC-CT-13 — JSON snapshot of the offer team, frozen at contract creation. */
    offerTeamSnapshot?: ContractOfferTeamMember[] | null;
    invoiceNotes?: string | null;
    receiptNumber?: string | null;
    createdAt: string;
    branchId?: number;
    // Installation address — specific to this contract/device, different from client address
    installationGeoUnitId?: number | null;
    installationAddressText?: string | null;
    installationLat?: number | null;
    installationLng?: number | null;
    appliedDeviceDiscountId?: number | null;
    buyerMotherName?: string | null;
    buyerNationalIdRegistry?: string | null;
    buyerNationalIdIssuedBy?: string | null;
    buyerNationalIdIssueDate?: string | null;
    buyerNationalIdBox?: string | null;
    buyerBirthDate?: string | null;
    buyerGender?: 'male' | 'female' | null;
    // Task/offer traceability (migration 138)
    sourceOpenTaskId?: number | null;
    sourceTaskOfferId?: number | null;
    saleReferenceNumber?: string | null;
    contractType?: ContractType | null;
    noClosingReasonId?: number | null;
    saleSubtype?: SaleSubtype | null;
}

export type MaintenancePartType = 'Periodic' | 'Emergency' | 'Accessory';

export interface SparePart {
    id: number;
    name: string;
    code: string;
    basePrice: number;
    maintenanceType: MaintenancePartType;
    compatibleDeviceIds: number[];
}

export interface DevicePartCompatibility {
    deviceModelId: number;
    sparePartId: number;
}

export interface MaintenanceRequest {
    id: number;
    requestDate: string;
    customerId: number;
    customerName: string;
    contractId: number;
    deviceModelName: string;
    priority: 'Critical' | 'High' | 'Normal';
    problemDescription: string;
    technicianId?: number;
    telemarketerId?: number;
    lastFollowUpDate?: string;
    resolutionStatus: 'Completed' | 'Pending' | 'Postponed' | 'Solved Remote';
    visitType: 'Periodic' | 'Emergency';
    location: string;
    notes?: string;
    technicalReport?: {
        water: { sourceType: string; inputPressure: number; tdsBefore: number; tdsAfter: number };
        components: { pumpPressure: number; membraneOutput: 'Good' | 'Weak' | 'Dead'; flowRestrictor: number; tankPressure: number };
        electrical: { lowPressureSwitch: string; highPressureSwitch: string; solenoidValve: string; uvStatus: string };
        technicianNotes: string;
        recommendations: string;
    };
}

/**
 * Canonical status values for the contact_targets table.
 * 'in_call_list' is a legacy alias for 'queued' — still handled in transition
 * guards but never written by current code. 'cancelled' appears only in UI
 * labels and has no write path.
 */
export type ContactTargetStatus =
  | 'new'           // created, not yet added to a call list
  | 'queued'        // added to today's call list via generate-from-plan
  | 'contacted'     // call made, no appointment booked
  | 'booked'        // appointment created — terminal for telemarketing flow
  | 'closed';       // not interested / service request / no action needed

export type CallOutcome =
  // Legacy (kept for backward compatibility)
  | 'no_answer'
  | 'busy'
  | 'rejected'
  | 'booked'
  // Group 1: Not reached
  | 'out_of_coverage'
  | 'not_in_service'
  | 'wrong_number'
  | 'auto_disconnected'
  // Group 2: Reached — no appointment
  | 'currently_busy'
  | 'interrupted'
  | 'not_interested'
  | 'other_company_not_interested'
  | 'seen_offer_not_interested'
  | 'address_updated'
  // Group 3: Reached — follow-up
  | 'other_company_callback'
  | 'seen_offer_callback'
  // Group 4: Reached — service / transfer
  | 'service_request'
  | 'company_customer_missing_phone'
  // Group 5: Appointment booking
  | 'booked_marketing_appointment'
  // Free call specific
  | 'new_number'
  // Text message
  | 'message_sent';

export interface TaskListItem {
    id: string;
    entityType: 'candidate' | 'client';
    entityId: number;
    name: string;
    mobile: string;
    contactNumber?: string;
    contactLabel?: string;
    addressText: string;
    geoUnitId: number | null;
    status: 'pending' | 'called' | 'booked';
    callOutcome?: CallOutcome;
    contactTargetId?: number;
    openTaskId: number | null;
    openTaskReason: string | null;
    openTaskType: string | null;
    openTaskStatus: string | null;
    ownership?: CustomerOwnership | null;
}

export interface TaskList {
    id: string;
    teamKey: string;
    date: string;
    items: TaskListItem[];
    createdAt: string;
}

export interface CallLog {
    id: string;
    entityType: 'candidate' | 'client';
    entityId: number;
    taskListId: string;
    teamKey: string;
    outcome: CallOutcome;
    contactLabel?: string;
    contactNumber?: string;
    notes: string;
    timestamp: string;
    calledBy?: number;
    communicationMethod?: 'phone' | 'cellular_text' | 'whatsapp_text' | 'whatsapp_voice';
    contactTargetId?: number;
    taskListItemId?: string;
}

export interface Appointment {
    id: string;
    entityType: 'candidate' | 'client';
    entityId: number;
    customerName: string;
    customerAddress: string;
    customerMobile: string;
    teamKey: string;
    date: string;
    timeSlot: string;
    occupation: string;
    waterSource: string;
    notes: string;
    visitTasks: string[];
    requestedDeviceModelId?: number | null;
    requestedDeviceName?: string;
    createdAt: string;
    createdBy?: number;
    contactTargetId?: number;
    taskListItemId?: string;
    taskListId?: string;
    marketingVisitId?: string | null;
    openTaskId?: number | null;
}

export const WORKING_HOURS = { start: 9, end: 17, slotMinutes: 60 };

export type EmergencyTicketStatus =
    | 'New'
    | 'Assigned'
    | 'In Progress'
    | 'Completed'
    | 'Cancelled'
    | OpenTaskStatus;
export type EmergencyTicketPriority = 'Critical' | 'High' | 'Normal';

export interface EmergencyTicket {
    id: number;
    clientId: number;
    clientName: string;
    clientAddress: string;
    clientRating: ClientRating;
    contractId: number | null;
    deviceModelName: string | null;
    problemDescription: string;
    callNotes?: string;
    attachments: string[];
    callReceiver: string | null;
    priority: EmergencyTicketPriority;
    status: EmergencyTicketStatus;
    assignedTechnicianId: number | null;
    openTaskId: number | null;
    createdAt: string;
}

export interface SystemList {
    id: number;
    category: string;
    value: string;
    isActive: boolean;
    displayOrder: number;
    linkedRoleId?: number | null;
    linkedRoleName?: string | null;
    /** Arbitrary metadata stored as JSONB. For department_type: { canSelectDevice: boolean } */
    metadata?: Record<string, unknown>;
}

export interface Department {
    id: number;
    name: string;
    branchId: number;
    departmentTypeId: number | null;
    departmentTypeName: string | null;
    /** Parsed metadata from the department_type system list item */
    departmentTypeMetadata: Record<string, unknown> | null;
    /** Array of device_model IDs associated with this department */
    deviceModelIds: number[];
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    employeeCount: number;
}

// ─────────────────────────────────────────
// Job Applications Epic
// ─────────────────────────────────────────

export type VacancyStatus = 'Open' | 'Closed' | 'Archived';
export type SubmissionType = 'Apply' | 'Refer a Candidate';
export type ApplicationSource = 'Mobile App' | 'Website' | 'External Platforms' | 'Internal';
export type ApplicationStage = 'Submitted' | 'Shortlisted' | 'Interview' | 'Training' | 'Final Decision';
export type ApplicationStatus =
  | 'New' | 'In Review' | 'Qualified' | 'Rejected'
  | 'Interview Scheduled' | 'Interview Completed' | 'Interview Failed'
  | 'Approved'
  | 'Training Scheduled' | 'Training Started' | 'Training Completed' | 'Retraining'
  | 'Passed'
  | 'Final Hired' | 'Final Rejected' | 'Retreated';

// ── New separated fields ──
export type StageStatus = 'Pending' | 'Under Review' | 'Ready' | 'Scheduled' | 'Completed' | 'In Progress' | 'Awaiting Decision';
export type Decision = 'Qualified' | 'Approved' | 'Passed' | 'Hired' | 'Rejected' | 'Failed' | 'Retraining' | 'Retreated';

export type ReferrerType = ReferralType | 'Customer';
export type ApplicantSegment = 'OP' | 'FOP' | 'Lead' | 'Visitor';

export interface JobVacancy {
  id: number;
  title: string;
  branch: string;
  branchId?: number | null;
  departmentId?: number | null;
  departmentName?: string | null;
  governorate: string | null;
  cityOrArea: string | null;
  subArea: string | null;
  neighborhood: string | null;
  detailedAddress: string | null;
  workType: string | null;
  requiredGender: string | null;
  requiredAgeMin: number | null;
  requiredAgeMax: number | null;
  contactMethods: BranchContact[];  // selected from branch contacts
  requiredCertificate: string | null;
  requiredMajor: string | null;
  requiredExperienceYears: number | null;
  requiredSkills: string | null;
  responsibilities: string | null;
  drivingLicenseRequired: boolean;
  hasCarRequired: boolean;
  vacancyCount: number;
  startDate: string;
  endDate: string;
  status: VacancyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: number;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  maritalStatus: string;
  email: string | null;
  mobileNumber: string;
  secondaryMobile: string | null;
  hasWhatsappPrimary?: boolean;
  hasWhatsappSecondary?: boolean;
  governorate: string;
  cityOrArea: string;
  subArea: string;
  neighborhood: string;
  detailedAddress: string;
  academicQualification: string;
  specialization?: string | null;
  previousEmployment: string;
  drivingLicense: string | boolean | null;
  hasCar?: boolean | null;
  expectedSalary: number | null;
  computerSkills: string | null;
  foreignLanguages: string | null;
  yearsOfExperience: number;
  cvUrl: string | null;
  photoUrl: string | null;
  applicantSegment: ApplicantSegment | null;
  createdAt: string;
}

export interface JobReferrer {
  id: number;
  type: ReferrerType;
  employeeId: number | null;
  referralEntityId?: number | null;
  fullName: string;
  lastName: string | null;
  mobileNumber: string;
  governorate: string | null;
  cityOrArea: string | null;
  subArea: string | null;
  neighborhood: string | null;
  detailedAddress: string | null;
  referrerWork: string | null;
  referrerNotes: string | null;
}

export interface JobApplication {
  id: number;
  jobVacancyId: number;
  applicantId: number;
  referrerId: number | null;
  branchId?: number | null;
  submissionType: SubmissionType;
  applicationSource: ApplicationSource;
  enteredByUserId: number | null;
  enteredByName: string | null;
  currentStage: ApplicationStage;
  applicationStatus: ApplicationStatus;
  stageStatus: StageStatus;
  decision: Decision | null;
  duplicateFlag: boolean;
  hiredEmployeeId: number | null;
  isEscalated: boolean;
  escalatedAt: string | null;
  internalNotes: string | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  entityType: string;
  entityId: number;
  applicationId: number | null;
  actionType: string;
  performedByRole: string | null;
  performedByUserId: number | null;
  oldValue: string | null;
  newValue: string | null;
  internalReason: string | null;
  timestamp: string;
}

export interface Interview {
  id: number;
  applicationId: number;
  interviewType: 'HR Interview' | 'Technical Interview';
  interviewNumber: 'First Interview' | 'Second Interview';
  interviewerName: string;
  interviewerUserId?: number | null;
  interviewerUsername?: string | null;
  interviewerRoleDisplayName?: string | null;
  interviewDate: string;
  interviewTime: string;
  interviewStatus: 'Interview Scheduled' | 'Interview Completed' | 'Interview Failed';
  internalNotes: string | null;
  createdAt: string;
}

export interface InterviewerOption {
  id: number;
  name: string;
  username: string;
  roleDisplayName: string | null;
  branchName: string;
}

export interface TrainingCourse {
  id: number;
  trainingName: string;
  jobVacancyId: number;
  branch: string;
  deviceName: string | null;
  trainer: string;
  startDate: string;
  endDate: string;
  trainingStatus: 'Training Scheduled' | 'Training Started' | 'Training Completed';
  notes: string | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCourseListItem extends TrainingCourse {
  registeredTraineesCount: number;
  graduatedTraineesCount: number;
}

export interface TrainingCourseTrainee {
  id: number;
  trainingCourseId: number;
  applicationId: number;
  firstName: string;
  lastName: string;
  applicationStatus: string;
  result: 'Passed' | 'Retraining' | 'Rejected' | 'Retreated' | null;
  resultRecordedAt: string | null;
  addedAt: string;
}

export interface TrainingAttendance {
  id: number;
  trainingCourseId: number;
  applicationId: number;
  attendanceDate: string;
  status: 'Present' | 'Absent';
  recordedByUserId: number | null;
  createdAt: string;
}

export interface TrainingCourseDetail extends TrainingCourse {
  vacancy: { id: number; title: string; branch: string } | null;
  trainees: TrainingCourseTrainee[];
  attendance: { applicationId: number; attendanceDate: string; status: 'Present' | 'Absent' }[];
}

// Open Task types
// 11-value lifecycle organized into 4 phases (see docs/analysis/task-model.md §2.2.1)
export type OpenTaskStatus =
  | 'open' | 'needs_follow_up'                              // Phase: قيد الانتظار
  | 'assigned' | 'in_scheduling' | 'scheduled'             // Phase: التخطيط
  | 'waiting_execution' | 'in_execution' | 'ended'         // Phase: التنفيذ
  | 'completed' | 'closed' | 'cancelled';                  // Phase: الإغلاق

export type OpenTaskPhase = 'waiting' | 'planning' | 'execution' | 'closure';

export type OpenTaskType = 'device_demo' | 'emergency_maintenance';
export type OpenTaskFamily = 'marketing' | 'service' | 'maintenance';
export type OpenTaskReason = 'new_lead' | 'follow_up' | 'renewal' | 'service_request' | 'other';

// Task type configuration (see docs/analysis/task-scheduling-patterns.md)
export type TaskSchedulingPattern = 'immediate' | 'short_window' | 'long_window' | 'expected_window';
export type TaskWindowBasis = 'none' | 'due_date' | 'expected_date';
/** Which geographic point determines this task's zone in work-scope matching. */
export type TaskLocationBasis = 'client' | 'contract';

export interface TaskTypeConfig {
  taskType: string;
  taskFamily: string;
  arabicLabel: string;
  schedulingPattern: TaskSchedulingPattern;
  windowBasis: TaskWindowBasis;
  planningWindowDays: number | null;
  contractRequired: boolean;
  allowMultiple: boolean;
  hasDueDate: boolean;
  displayOrder: number;
  isActive: boolean;
  locationBasis: TaskLocationBasis;
  createdAt: string;
  updatedAt: string;
}

export const TASK_SCHEDULING_PATTERN_LABELS: Record<TaskSchedulingPattern, string> = {
  immediate:       'فوري',
  short_window:    'نافذة قصيرة',
  long_window:     'نافذة طويلة',
  expected_window: 'نافذة الموعد المتوقع',
};

export const TASK_SCHEDULING_PATTERN_DESCRIPTIONS: Record<TaskSchedulingPattern, string> = {
  immediate:       'لا تاريخ مستقبلي — تظهر فور إنشائها، N لا تنطبق',
  short_window:    'لها due_date — تدخل النطاق قبل موعدها بأيام قليلة (3–7)',
  long_window:     'لها due_date بعيد (شهور) — تدخل النطاق قبل موعدها بنافذة أطول (15–30)',
  expected_window: 'لا due_date صارم — تستخدم expected_date من محادثة الزبون',
};

export const TASK_WINDOW_BASIS_LABELS: Record<TaskWindowBasis, string> = {
  none:          'لا ينطبق',
  due_date:      'تاريخ الاستحقاق',
  expected_date: 'الموعد المتوقع',
};

export const TASK_LOCATION_BASIS_LABELS: Record<TaskLocationBasis, string> = {
  client:   'موقع الزبون',
  contract: 'موقع الجهاز (العقد)',
};

export const TASK_LOCATION_BASIS_DESCRIPTIONS: Record<TaskLocationBasis, string> = {
  client:   'الفريق يتوجه إلى موقع الزبون — مناسب لمهام التسويق والهدايا والمبيعات الجديدة',
  contract: 'الفريق يتوجه إلى موقع تركيب الجهاز — مناسب لمهام الصيانة والتحصيل والخدمة',
};

/** Map each status to its lifecycle phase. Phase is derived, never stored. */
export const STATUS_TO_PHASE: Record<OpenTaskStatus, OpenTaskPhase> = {
  open: 'waiting',
  needs_follow_up: 'waiting',
  assigned: 'planning',
  in_scheduling: 'planning',
  scheduled: 'planning',
  waiting_execution: 'execution',
  in_execution: 'execution',
  ended: 'execution',
  completed: 'closure',
  closed: 'closure',
  cancelled: 'closure',
};

export function getTaskPhase(status: OpenTaskStatus): OpenTaskPhase {
  return STATUS_TO_PHASE[status] ?? 'waiting';
}

export const OPEN_TASK_PHASE_LABELS: Record<OpenTaskPhase, string> = {
  waiting: 'قيد الانتظار',
  planning: 'التخطيط',
  execution: 'التنفيذ',
  closure: 'الإغلاق',
};

export const OPEN_TASK_PHASE_COLORS: Record<OpenTaskPhase, string> = {
  waiting:   'bg-slate-100 text-slate-700 border-slate-200',
  planning:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  execution: 'bg-amber-50 text-amber-700 border-amber-200',
  closure:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export interface OpenTask {
  id: number;
  clientId: number;
  branchId: number;
  contractId: number | null;
  taskType: OpenTaskType;
  taskFamily: OpenTaskFamily;
  reason: OpenTaskReason;
  status: OpenTaskStatus;
  dueDate: string | null;
  expectedDate: string | null;
  lastWaitingStatus: 'open' | 'needs_follow_up' | null;
  phase?: OpenTaskPhase;  // derived from status by API
  waitingReasonId: number | null;
  waitingReasonText: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  source: string;
  marketingVisitTaskId: string | null;
  contactTargetId: number | null;
  notes: string | null;
  cancellationReason: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  clientSnapshot?: {
    name: string;
    mobile: string;
    contacts: ContactEntry[];
    address: {
      governorate: string;
      district: string;
      subArea: string;
      neighborhood: string;
      detailed: string;
    };
    rating: ClientRating;
    clientType: string;
  };
  contractSnapshot?: {
    contractId: number;
    contractNumber: string;
    contractDate: string;
    device: {
      modelId: number;
      modelName: string;
      serialNumber: string;
      maintenancePlan: string;
    };
    installationAddress: {
      geoUnitId: number | null;
      geoUnitName: string | null;
      addressText: string | null;
      lat: number | null;
      lng: number | null;
    } | null;
    financials: {
      paymentType: string;
      finalPrice: number;
      downPayment: number;
      installmentsCount: number;
      currency: string;
    };
    status: string;
  } | null;
  teamSnapshot?: {
    supervisor?: { id: number; name: string };
    technician?: { id: number; name: string };
    trainee?: { id: number; name: string };
    assignedAt: string;
  } | null;
  // Joined fields (from API)
  clientName?: string;
  clientMobile?: string;
  clientNeighborhood?: string;
  clientGovernorate?: string;
  clientDistrict?: string;
  branchName?: string;
  createdByName?: string;
  assignments: Array<{ userId: number; userName: string; roleDisplayName: string }>;
  ownership?: CustomerOwnership;
}

export const OPEN_TASK_STATUS_LABELS: Record<OpenTaskStatus, string> = {
  // Waiting phase
  open: 'مفتوحة',
  needs_follow_up: 'بحاجة متابعة',
  // Planning phase
  assigned: 'مسندة',
  in_scheduling: 'قيد الجدولة',
  scheduled: 'مجدولة',
  // Execution phase
  waiting_execution: 'بانتظار التنفيذ',
  in_execution: 'قيد التنفيذ',
  ended: 'انتهت',
  // Closure phase
  completed: 'مكتملة',
  closed: 'مغلقة نهائياً',
  cancelled: 'ملغاة',
};

export const OPEN_TASK_TYPE_LABELS: Record<OpenTaskType, string> = {
  device_demo: 'عرض جهاز',
  emergency_maintenance: 'صيانة طارئة',
};

export const OPEN_TASK_REASON_LABELS: Record<OpenTaskReason, string> = {
  new_lead: 'زبون جديد',
  follow_up: 'متابعة',
  renewal: 'تجديد',
  service_request: 'طلب خدمة',
  other: 'أخرى',
};

export const OPEN_TASK_FAMILY_LABELS: Record<OpenTaskFamily, string> = {
  marketing: 'تسويق',
  service: 'خدمة',
  maintenance: 'صيانة',
};

// ── Emergency Maintenance Result ──────────────────────────────────────────────
// Canonical list of final decisions for emergency_maintenance visit tasks.
// Each value maps to a specific open_task status transition (see mapping below).
// These values are validated on the backend in POST /open-tasks/:id/emergency-result.
export type EmergencyFinalDecision =
  | 'resolved'           // → open_task: completed
  | 'partially_resolved' // → open_task: needs_reschedule
  | 'unresolved'         // → open_task: needs_reschedule
  | 'needs_followup'     // → open_task: needs_reschedule
  | 'cancelled';         // → open_task: cancelled

export const EMERGENCY_FINAL_DECISION_LABELS: Record<EmergencyFinalDecision, string> = {
  resolved:           'تم الحل نهائياً',
  partially_resolved: 'تم الحل جزئياً',
  unresolved:         'لم تُحَل',
  needs_followup:     'تحتاج متابعة',
  cancelled:          'إلغاء نهائي',
};

export const EMERGENCY_FINAL_DECISION_DESCRIPTIONS: Record<EmergencyFinalDecision, string> = {
  resolved:           'المشكلة حُلّت بالكامل — تُنهى المهمة',
  partially_resolved: 'المشكلة حُلّت جزئياً — تحتاج متابعة',
  unresolved:         'لم يتمكن الفني من الحل — تحتاج إعادة جدولة',
  needs_followup:     'يُوصى بزيارة متابعة',
  cancelled:          'المهمة ملغاة',
};

// Derived open_task status from emergency final decision
export const EMERGENCY_DECISION_TO_TASK_STATUS: Record<EmergencyFinalDecision, string> = {
  resolved:           'completed',
  partially_resolved: 'needs_reschedule',
  unresolved:         'needs_reschedule',
  needs_followup:     'needs_reschedule',
  cancelled:          'cancelled',
};

export interface CreateTrainingCourseRequest {
  training_name: string;
  job_vacancy_id: number;
  branch: string;
  device_name?: string;
  trainer: string;
  start_date: string;
  end_date: string;
  notes?: string;
  trainee_application_ids: number[];
}

export interface RecordAttendanceRequest {
  attendance: Array<{ application_id: number; status: 'Present' | 'Absent' }>;
  attendance_date: string;
}

export interface RecordTraineeResultRequest {
  result: 'Passed' | 'Retraining' | 'Rejected' | 'Retreated';
}

// Extended types for joined queries
export interface JobApplicationListItem extends JobApplication {
  applicantFirstName: string;
  applicantLastName: string;
  applicantMobile: string;
  applicantGender: string;
  applicantDob?: string | null;
  applicantGovernorate?: string | null;
  applicantCityOrArea?: string | null;
  applicantAcademicQualification?: string | null;
  applicantSpecialization?: string | null;
  applicantDrivingLicense?: string | boolean | null;
  applicantComputerSkills?: string | null;
  applicantYearsOfExperience?: number | null;
  vacancyTitle: string;
  vacancyBranch: string;
  vacancyGovernorate?: string | null;
  vacancyCityOrArea?: string | null;
  vacancyRequiredGender?: string | null;
  vacancyRequiredAgeMin?: number | null;
  vacancyRequiredAgeMax?: number | null;
  vacancyRequiredCertificate?: string | null;
  vacancyRequiredMajor?: string | null;
  vacancyRequiredExperienceYears?: number | null;
  vacancyRequiredSkills?: string | null;
  vacancyDrivingLicenseRequired?: boolean | null;
  vacancyHasCarRequired?: boolean | null;
  hasScheduledInterview?: boolean;
}

export interface ApplicationTrainingEnrollment {
  id: number;
  trainingCourseId: number;
  trainingName: string;
  trainer: string;
  branch: string;
  deviceName: string | null;
  startDate: string;
  endDate: string;
  trainingStatus: 'Training Scheduled' | 'Training Started' | 'Training Completed';
  notes: string | null;
  result: 'Passed' | 'Retraining' | 'Rejected' | 'Retreated' | null;
  resultRecordedAt: string | null;
  addedAt: string;
}

export interface JobApplicationDetail extends JobApplication {
  applicant: Applicant;
  vacancy: JobVacancy;
  referrer: JobReferrer | null;
  interviews: Interview[];
  trainings: ApplicationTrainingEnrollment[];
}

export interface CustomerCallLog {
  id: string;
  customerId: number;
  contactId?: string;
  contactNumber?: string;
  contactLabel?: string;
  callerId?: number;
  callerName?: string;
  callerRole?: string;
  callDate: string;
  outcome: string;
  sourceType: string;
  sourceId?: string;
  notes?: string;
  branchId?: number;
  actionLog?: Record<string, any>;
  answeredBy?: 'customer' | 'spouse' | 'child';
  communicationChannel?: 'cellular_call' | 'cellular_text' | 'whatsapp_call' | 'whatsapp_text';
  status: 'pending' | 'completed';
  createdAt: string;
}
