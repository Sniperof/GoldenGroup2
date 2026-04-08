

export interface GeoUnit {
    id: number;
    name: string;
    level: number;
    parentId: number | null;
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
export type ReferralOriginChannel = 'App' | 'Campaign' | 'Acquaintance';
export type ClientRating = 'Committed' | 'NotCommitted' | 'Undefined';

export interface ReferralSheetStats {
    totalCandidates: number;
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
    createdAt: string;
    createdBy: number;
}

export type EmployeeRole = 'supervisor' | 'technician' | 'telemarketer';

export interface Employee {
    id: number;
    name: string;
    role: EmployeeRole;
    mobile: string;
    branch?: string | null;
    residence?: string | null;
    residenceShort?: string | null;
    status: 'active' | 'leave' | 'inactive';
    avatar?: string;
    jobTitle?: string | null;
    createdAt?: string;
}

export interface EmployeeSystemAccount {
    id: number;
    username: string;
    isActive: boolean;
    roleId: number | null;
    roleDisplayName: string | null;
}

export interface EmployeeDetail extends Employee {
    systemAccount: EmployeeSystemAccount | null;
    hiringApplication: JobApplicationDetail | null;
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
    coveredGeoIds: number[];
    contactInfo: BranchContact[];
    status: 'active' | 'inactive';
    createdAt: string;
}

export type ContactType = 'mobile' | 'landline' | 'other';
export type ContactStatus = 'active' | 'preferred' | 'out-of-coverage' | 'unused';

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
    occupation?: string;
    waterSource?: string;
    notes?: string;
    rating?: ClientRating;
    sourceChannel?: string;
    referrerType?: string;
    referrerId?: number;
    referrerName?: string;
    referralEntityId?: number | null;
    referralDate?: string;
    referralReason?: string;
    referralSheetId?: number | null;
    referralAddressText?: string;
    referrers?: ClientReferrer[];
    createdAt: string;
    isCandidate?: boolean;
    targetClient?: string;
    candidateStatus?: string;
}

export interface Visit {
    id: string;
    date: string;
    customerId: number;
    employeeId: number;
    employeeName: string;
    outcome: 'Pending' | 'Completed' | 'Cancelled';
    notes?: string;
}

export interface TeamSlot {
    supervisor: number | null;
    technician: number | null;
    telemarketers?: number[];
}

export interface SoloSlot {
    technician: number | null;
}

export interface DaySchedule {
    teams: TeamSlot[];
    solos: SoloSlot[];
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
    category: 'منزلي' | 'صناعي' | 'تجاري';
    maintenanceInterval: '3 أشهر' | '6 أشهر' | '1 سنة';
    basePrice: number;
    supportedVisitTypes: ('تركيب' | 'صيانة' | 'توصيل')[];
}

export type ContractStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type PaymentType = 'cash' | 'installment';
export type MaintenancePlan = '3' | '6' | '12';

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

export interface Contract {
    id: number;
    contractNumber: string;
    customerId: number;
    customerName: string;
    contractDate: string;
    sourceVisit?: string;
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
    createdAt: string;
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

export type CallOutcome = 'no_answer' | 'busy' | 'rejected' | 'booked';

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
    calledBy: number;
    communicationMethod?: 'phone' | 'whatsapp_text' | 'whatsapp_voice';
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
    createdAt: string;
    createdBy: number;
}

export const WORKING_HOURS = { start: 9, end: 17, slotMinutes: 60 };

export type EmergencyTicketStatus = 'New' | 'Assigned' | 'In Progress' | 'Completed' | 'Cancelled';
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
    callReceiver: string;
    priority: EmergencyTicketPriority;
    status: EmergencyTicketStatus;
    assignedTechnicianId: number | null;
    createdAt: string;
}

export interface SystemList {
    id: number;
    category: string;
    value: string;
    isActive: boolean;
    displayOrder: number;
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

export type ReferrerType = 'Employee' | 'Customer';
export type ApplicantSegment = 'OP' | 'FOP' | 'Lead' | 'Visitor';

export interface JobVacancy {
  id: number;
  title: string;
  branch: string;
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
  governorate: string;
  cityOrArea: string;
  subArea: string;
  neighborhood: string;
  detailedAddress: string;
  academicQualification: string;
  specialization?: string | null;
  previousEmployment: string;
  drivingLicense: string | boolean | null;
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
  interviewDate: string;
  interviewTime: string;
  interviewStatus: 'Interview Scheduled' | 'Interview Completed' | 'Interview Failed';
  internalNotes: string | null;
  createdAt: string;
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
