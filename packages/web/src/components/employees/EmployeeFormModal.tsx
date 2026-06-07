import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  Check,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import GeoSmartSearch, { type GeoSelection } from '../GeoSmartSearch';
import { api } from '../../lib/api';
import type {
  Branch,
  Client,
  ContactEntry,
  ContactStatus,
  ContactType,
  Department,
  Employee,
  EmployeeManagerCandidate,
  GeoUnit,
  SystemList,
} from '../../lib/types';
import { findEmployeeByNumber, formatEmployeeMediatorLabel, MediatorEmployee, toMediatorEmployee } from '../../lib/employeeMediatorLookup';
import { useAuthStore } from '../../hooks/useAuthStore';
import {
  CONTACT_STATUS_CONFIG,
  CONTACT_TYPE_CONFIG,
  SYRIAN_MOBILE_HINT,
  getContactValidationMessage,
  isInvalidContactNumber,
  normalizeContactNumberInput,
} from '../../lib/contactRules';

type YesNoValue = '' | 'yes' | 'no';

export type EmployeeFormValues = {
  employeeNumber: number | null;
  firstName: string;
  fatherName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  maritalStatus: string;
  militaryService: string;
  geoSelection: GeoSelection;
  detailedAddress: string;
  contacts: ContactEntry[];
  academicQualification: string;
  specialization: string;
  yearsOfExperience: string;
  drivingLicense: YesNoValue;
  hasCar: YesNoValue;
  jobSkills: string;
  foreignLanguages: string[];
  status: Employee['status'];
  hireDate: string;
  startWorkDate: string;
  branchId: number | null;
  departmentId: number | null;
  contractType: string;
  workType: string;
  previousEmployment: string;
  directManagerId: number | null;
  jobTitle: string;
  referrerType: string;
  sourceChannel: string;
  referrerName: string;
  referralNotes: string;
  referralEntityId: number | null;
};

export type EmployeeFormInitialValues = Partial<EmployeeFormValues> & {
  residenceGovernorateId?: number | null;
  residenceRegionId?: number | null;
  residenceSubAreaId?: number | null;
  residenceNeighborhoodId?: number | null;
  applicantGovernorate?: string | null;
  applicantCityOrArea?: string | null;
  applicantSubArea?: string | null;
  applicantNeighborhood?: string | null;
};

interface EmployeeFormModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  submitting?: boolean;
  error?: string;
  initialValues?: EmployeeFormInitialValues;
  fixedBranchId?: number | null;
  fixedBranchName?: string | null;
  branchLocked?: boolean;
  addressHint?: string | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void> | void;
}

const DEFAULT_CONTACT = (): ContactEntry => ({
  id: Math.random().toString(36).slice(2, 10),
  type: 'mobile',
  number: '',
  areaCode: '',
  label: '',
  hasWhatsApp: false,
  isPrimary: false,
  status: 'active',
});

const REFERRER_TYPE_OPTIONS = [
  { value: 'Personal',  label: 'شخصي' },
  { value: 'Employee',  label: 'موظف',          autoName: null },
  { value: 'Client',    label: 'زبون',          autoName: null },
  { value: 'Unknown',   label: 'مجهول',         autoName: 'مجهول' },
];

// Matches the client form's origin channels exactly
const SOURCE_CHANNEL_OPTIONS = [
  { value: 'Acquaintance', label: 'معرفة شخصية'  },
  { value: 'PhoneCall',    label: 'مكالمة هاتفية' },
  { value: 'SocialMedia',  label: 'سوشال ميديا'   },
  { value: 'Campaign',     label: 'حملة إعلانية'  },
];

// Contact type config matching client form (with emojis)
const CONTACT_TYPES = CONTACT_TYPE_CONFIG;
const CONTACT_STATUSES = CONTACT_STATUS_CONFIG;

function getReferralAutoName(type: string, currentUserDisplayName: string): string | null {
  if (type === 'Personal') return currentUserDisplayName;
  if (type === 'Unknown') return 'مجهول';
  return null;
}

function normalizeSourceChannel(value?: string | null): string {
  if (value === 'App') return 'SocialMedia';
  return value ? String(value) : '';
}

const STATUS_OPTIONS: Array<{ value: Employee['status']; label: string }> = [
  { value: 'active', label: 'نشط' },
  { value: 'vacation', label: 'إجازة' },
  { value: 'suspended', label: 'موقوف' },
  { value: 'terminated', label: 'منتهي الخدمة' },
];

type StepKey = 'identity' | 'contact' | 'qualifications' | 'employment' | 'referral';

interface StepDef {
  key: StepKey;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepDef[] = [
  { key: 'identity', title: 'البيانات الشخصية', subtitle: 'اسم الموظف وتفاصيل هويته', icon: UserRound },
  { key: 'contact', title: 'العنوان والتواصل', subtitle: 'الإقامة ووسائل التواصل', icon: MapPin },
  { key: 'qualifications', title: 'المؤهلات والمهارات', subtitle: 'الشهادات واللغات والخبرة', icon: GraduationCap },
  { key: 'employment', title: 'البيانات الوظيفية', subtitle: 'الفرع والقسم والعقد', icon: Briefcase },
  { key: 'referral', title: 'الوسيط والملاحظات', subtitle: 'مصدر التوصية (اختياري)', icon: Users },
];

function toGenderValue(value: unknown): string {
  return String(value ?? '').trim();
}

function toYesNoValue(value: unknown): YesNoValue {
  if (value == null || value === '') return '';
  if (value === true) return 'yes';
  if (value === false) return 'no';
  const raw = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', 'نعم'].includes(raw)) return 'yes';
  if (['no', 'false', '0', 'لا'].includes(raw)) return 'no';
  return '';
}

function buildGeoSelection(initialValues?: EmployeeFormInitialValues): GeoSelection {
  if (initialValues?.geoSelection) return initialValues.geoSelection;
  return {
    govId: initialValues?.residenceGovernorateId ? String(initialValues.residenceGovernorateId) : '',
    regionId: initialValues?.residenceRegionId ? String(initialValues.residenceRegionId) : '',
    subId: initialValues?.residenceSubAreaId ? String(initialValues.residenceSubAreaId) : '',
    neighborhoodId: initialValues?.residenceNeighborhoodId ? String(initialValues.residenceNeighborhoodId) : '',
  };
}

function normalizeGeoText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s،,]+/g, ' ')
    .toLowerCase();
}

function resolveGeoSelectionFromText(geoUnits: GeoUnit[], initialValues?: EmployeeFormInitialValues): GeoSelection | null {
  const govName = normalizeGeoText(initialValues?.applicantGovernorate);
  const regionName = normalizeGeoText(initialValues?.applicantCityOrArea);
  const subName = normalizeGeoText(initialValues?.applicantSubArea);
  const neighborhoodName = normalizeGeoText(initialValues?.applicantNeighborhood);

  if (!govName && !regionName && !subName && !neighborhoodName) return null;

  const matchesName = (unit: GeoUnit, name: string) => normalizeGeoText(unit.name) === name;
  const findUnit = (name: string, preferredLevels: number[], parentId?: number | null) => {
    const candidates = geoUnits.filter((unit) => matchesName(unit, name) && (parentId == null || unit.parentId === parentId));
    if (candidates.length === 0) return null;
    return (
      candidates.find((unit) => preferredLevels.includes(unit.level))
      ?? candidates[0]
      ?? null
    );
  };

  const gov = govName ? findUnit(govName, [1]) : null;
  const region = regionName
    ? findUnit(regionName, [2], gov?.id ?? null)
      || findUnit(regionName, [2])
      || findUnit(regionName, [3], gov?.id ?? null)
      || findUnit(regionName, [3])
    : null;
  const sub = subName
    ? findUnit(subName, [3], region?.id ?? null)
      || findUnit(subName, [3])
      || findUnit(subName, [4], region?.id ?? null)
      || findUnit(subName, [4])
    : null;
  const neighborhood = neighborhoodName
    ? findUnit(neighborhoodName, [4], sub?.id ?? null)
      || findUnit(neighborhoodName, [4])
    : null;

  if (!gov && !region && !sub && !neighborhood) return null;

  return {
    govId: gov?.id ? String(gov.id) : '',
    regionId: region?.id ? String(region.id) : '',
    subId: sub?.id ? String(sub.id) : '',
    neighborhoodId: neighborhood?.id ? String(neighborhood.id) : '',
  };
}

function buildFormState(
  initialValues?: EmployeeFormInitialValues,
  fixedBranchId?: number | null,
): EmployeeFormValues {
  return {
    employeeNumber: initialValues?.employeeNumber ?? null,
    firstName: initialValues?.firstName ?? '',
    fatherName: initialValues?.fatherName ?? '',
    lastName: initialValues?.lastName ?? '',
    birthDate: initialValues?.birthDate ? String(initialValues.birthDate).slice(0, 10) : '',
    gender: toGenderValue(initialValues?.gender),
    maritalStatus: initialValues?.maritalStatus ?? '',
    militaryService: initialValues?.militaryService ?? '',
    geoSelection: buildGeoSelection(initialValues),
    detailedAddress: initialValues?.detailedAddress ?? '',
    contacts: initialValues?.contacts && initialValues.contacts.length > 0
      ? initialValues.contacts.map((contact) => ({ ...contact, isPrimary: false }))
      : [DEFAULT_CONTACT()],
    academicQualification: initialValues?.academicQualification ?? '',
    specialization: initialValues?.specialization ?? '',
    yearsOfExperience: initialValues?.yearsOfExperience != null ? String(initialValues.yearsOfExperience) : '',
    drivingLicense: toYesNoValue(initialValues?.drivingLicense),
    hasCar: toYesNoValue((initialValues as any)?.hasCar),
    jobSkills: initialValues?.jobSkills ?? '',
    foreignLanguages: initialValues?.foreignLanguages ?? [],
    status: initialValues?.status ?? 'active',
    hireDate: initialValues?.hireDate ? String(initialValues.hireDate).slice(0, 10) : '',
    startWorkDate: initialValues?.startWorkDate ? String(initialValues.startWorkDate).slice(0, 10) : '',
    branchId: fixedBranchId ?? initialValues?.branchId ?? null,
    departmentId: initialValues?.departmentId ?? null,
    contractType: initialValues?.contractType ?? '',
    workType: initialValues?.workType ?? '',
    previousEmployment: initialValues?.previousEmployment ?? '',
    directManagerId: initialValues?.directManagerId ?? null,
    jobTitle: initialValues?.jobTitle ?? '',
    referrerType: initialValues?.referrerType ? String(initialValues.referrerType) : '',
    sourceChannel: normalizeSourceChannel(initialValues?.sourceChannel),
    referrerName: initialValues?.referrerName ?? '',
    referralNotes: initialValues?.referralNotes ?? '',
    referralEntityId: (initialValues as any)?.referralEntityId ?? null,
  };
}

function toRequestContacts(contacts: ContactEntry[]) {
  return contacts
    .map((contact) => ({
      ...contact,
      number: String(contact.number ?? '').replace(/\D/g, ''),
      areaCode: String(contact.areaCode ?? '').replace(/\D/g, ''),
      label: contact.label ?? '',
      isPrimary: false,
    }))
    .filter((contact) => contact.number);
}

function getPrimaryMobile(contacts: ContactEntry[]) {
  const mobile = contacts.find((contact) => contact.type === 'mobile' && contact.number);
  return mobile?.number ?? contacts.find((contact) => contact.number)?.number ?? '';
}

function FieldLabel({
  children,
  required,
  locked,
}: {
  children: React.ReactNode;
  required?: boolean;
  locked?: boolean;
}) {
  return (
    <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
      <span>{children}</span>
      {required && <span className="text-rose-500">*</span>}
      {locked && <Lock className="w-3 h-3 text-slate-400" />}
    </span>
  );
}

const INPUT_CLASS =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100';

export default function EmployeeFormModal({
  isOpen,
  title,
  description,
  submitLabel = 'حفظ الموظف',
  submitting = false,
  error = '',
  initialValues,
  fixedBranchId = null,
  fixedBranchName = null,
  branchLocked = false,
  addressHint = null,
  onClose,
  onSubmit,
}: EmployeeFormModalProps) {
  const authUser = useAuthStore((state) => state.user);
  const currentUserDisplayName = authUser?.name?.trim() || '';
  const [form, setForm] = useState<EmployeeFormValues>(() => buildFormState(initialValues, fixedBranchId));
  const [localError, setLocalError] = useState('');
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<EmployeeManagerCandidate[]>([]);
  const [specializationOptions, setSpecializationOptions] = useState<SystemList[]>([]);
  const [listsByCategory, setListsByCategory] = useState<Record<string, SystemList[]>>({});

  // Referral section — employee lookup
  const [employeeIdInput, setEmployeeIdInput] = useState('');
  const [employeeFound, setEmployeeFound] = useState<MediatorEmployee | null>(null);
  const [employeeSearchError, setEmployeeSearchError] = useState('');

  // Referral section — client search
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<StepKey>>(() => new Set(['identity']));
  // Tracks the highest step index the user has *completed* by clicking Next (not just visited).
  const [completedUpTo, setCompletedUpTo] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildFormState(initialValues, fixedBranchId));
    setLocalError('');
    setCurrentStepIdx(0);
    setVisitedSteps(new Set(['identity']));
    setCompletedUpTo(0);
    setEmployeeIdInput('');
    setEmployeeFound(null);
    setEmployeeSearchError('');
    setClientSearch('');
    setClientSuggestions([]);

    let cancelled = false;
    const initialReferralEntityId = (initialValues as any)?.referralEntityId ?? null;
    const initialReferrerType = initialValues?.referrerType ? String(initialValues.referrerType) : '';

    if (initialReferrerType === 'Employee' && initialReferralEntityId != null) {
      void (async () => {
        try {
          const employee = await api.employees.get(Number(initialReferralEntityId));
          if (cancelled || !employee) return;
          const mediator = toMediatorEmployee(employee);
          setEmployeeFound(mediator);
          setEmployeeIdInput(String(mediator.employeeNumber ?? mediator.id));
          setEmployeeSearchError('');
          setForm((current) => ({
            ...current,
            referrerName: current.referrerName || mediator.name,
            referralEntityId: mediator.id,
          }));
        } catch {
          if (!cancelled) {
            setEmployeeSearchError('تعذر استرجاع بيانات الوسيط من سجل الموظف');
          }
        }
      })();
    } else if (initialReferrerType === 'Client' && initialReferralEntityId != null) {
      void (async () => {
        try {
          const client = await api.clients.get(Number(initialReferralEntityId));
          if (cancelled || !client) return;
          setClientSearch(client.name || '');
          setForm((current) => ({
            ...current,
            referrerName: current.referrerName || client.name || '',
            referralEntityId: client.id,
          }));
        } catch {
          // best-effort only; existing snapshot text is enough for save
        }
      })();
    }

    return () => { cancelled = true; };
  }, [isOpen, initialValues, fixedBranchId]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function loadLookups() {
      setLoadingLookups(true);
      try {
        const [
          geoData,
          branchData,
          genderList,
          maritalStatus,
          militaryService,
          certificates,
          workTypes,
          contractTypes,
          foreignLanguages,
          jobTitles,
        ] = await Promise.all([
          api.geoUnits.listReference(),
          api.branches.list(),
          api.systemLists.list({ category: 'gender', activeOnly: true }),
          api.systemLists.list({ category: 'marital_status', activeOnly: true }),
          api.systemLists.list({ category: 'military_service', activeOnly: true }),
          api.systemLists.list({ category: 'certificate', activeOnly: true }),
          api.systemLists.list({ category: 'work_type', activeOnly: true }),
          api.systemLists.list({ category: 'contract_type', activeOnly: true }),
          api.systemLists.list({ category: 'foreign_language', activeOnly: true }),
          api.systemLists.list({ category: 'job_title', activeOnly: true }),
        ]);

        if (cancelled) return;

        setGeoUnits(geoData);
        setBranches(branchData);
        setListsByCategory({
          gender: genderList,
          marital_status: maritalStatus,
          military_service: militaryService,
          certificate: certificates,
          work_type: workTypes,
          contract_type: contractTypes,
          foreign_language: foreignLanguages,
          job_title: jobTitles,
        });

        // Load clients for referral search (best-effort)
        try {
          const clients = await api.clients.list();
          if (!cancelled) setAllClients(clients.filter((c: Client) => !c.isCandidate));
        } catch {
          // non-critical — referral client search simply won't show suggestions
        }
      } catch (err: any) {
        if (!cancelled) {
          setLocalError(err.message ?? 'تعذر تحميل القوائم المرجعية لنموذج الموظف.');
        }
      } finally {
        if (!cancelled) {
          setLoadingLookups(false);
        }
      }
    }

    loadLookups();
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    const branchId = form.branchId;
    if (!isOpen || branchId == null) {
      setDepartments([]);
      setManagers([]);
      return;
    }

    let cancelled = false;

    async function loadBranchData() {
      const resolvedBranchId = branchId;
      if (resolvedBranchId == null) return;
      try {
        const [departmentData, managerData] = await Promise.all([
          api.departments.list(resolvedBranchId),
          form.departmentId != null
            ? api.employees.managerCandidates(resolvedBranchId, form.departmentId)
            : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setDepartments(departmentData);
        setManagers(managerData);
      } catch (err: any) {
        if (!cancelled) {
          setLocalError(err.message ?? 'تعذر تحميل الأقسام أو المدراء المباشرين.');
        }
      }
    }

    loadBranchData();
    return () => { cancelled = true; };
  }, [isOpen, form.branchId, form.departmentId]);

  useEffect(() => {
    if (!isOpen || !form.academicQualification) {
      setSpecializationOptions([]);
      return;
    }

    let cancelled = false;

    async function loadSpecializations() {
      try {
        const data = await api.systemLists.list({
          category: `major:${form.academicQualification}`,
          activeOnly: true,
        });
        if (cancelled) return;
        setSpecializationOptions(data);
      } catch {
        if (!cancelled) {
          setSpecializationOptions([]);
        }
      }
    }

    loadSpecializations();
    return () => { cancelled = true; };
  }, [isOpen, form.academicQualification]);

  useEffect(() => {
    if (!isOpen || geoUnits.length === 0 || !initialValues) return;
    const resolved = resolveGeoSelectionFromText(geoUnits, initialValues);
    if (!resolved) return;

    setForm((current) => ({
      ...current,
      geoSelection: {
        govId: current.geoSelection.govId || resolved.govId,
        regionId: current.geoSelection.regionId || resolved.regionId,
        subId: current.geoSelection.subId || resolved.subId,
        neighborhoodId: current.geoSelection.neighborhoodId || resolved.neighborhoodId,
      },
    }));
  }, [isOpen, geoUnits, initialValues]);

  const selectedBranchName = useMemo(() => {
    if (branchLocked && fixedBranchName) return fixedBranchName;
    return branches.find((branch) => branch.id === form.branchId)?.name ?? fixedBranchName ?? '';
  }, [branchLocked, fixedBranchName, branches, form.branchId]);

  const selectedJobTitle = useMemo(() => {
    return (listsByCategory.job_title ?? []).find((item) => item.value === form.jobTitle) ?? null;
  }, [listsByCategory, form.jobTitle]);

  const genderOptions = listsByCategory.gender ?? [];
  const certificateOptions = listsByCategory.certificate ?? [];
  const maritalStatusOptions = listsByCategory.marital_status ?? [];
  const militaryServiceOptions = listsByCategory.military_service ?? [];
  const workTypeOptions = listsByCategory.work_type ?? [];
  const contractTypeOptions = listsByCategory.contract_type ?? [];
  const foreignLanguageOptions = listsByCategory.foreign_language ?? [];
  const jobTitleOptions = listsByCategory.job_title ?? [];

  const combinedError = localError || error;

  if (!isOpen) return null;

  const currentStep = STEPS[currentStepIdx];
  const isLastStep = currentStepIdx === STEPS.length - 1;
  const isFirstStep = currentStepIdx === 0;

  function validateStep(stepKey: StepKey): string | null {
    switch (stepKey) {
      case 'identity':
        if (!form.firstName.trim()) return 'الاسم الأول مطلوب.';
        if (!form.lastName.trim()) return 'الكنية مطلوبة.';
        if (!form.birthDate) return 'تاريخ الميلاد مطلوب.';
        if (!form.gender) return 'الجنس مطلوب.';
        if (!form.maritalStatus) return 'الحالة الاجتماعية مطلوبة.';
        return null;
      case 'contact': {
        if (!form.geoSelection.subId && !form.geoSelection.neighborhoodId) {
          return 'يجب اختيار ناحية أو حي على الأقل في العنوان.';
        }
        const requestContacts = toRequestContacts(form.contacts);
        if (requestContacts.length === 0) return 'يجب إدخال وسيلة تواصل واحدة على الأقل.';
        const invalidContact = requestContacts.find((contact) => getContactValidationMessage(contact));
        if (invalidContact) return getContactValidationMessage(invalidContact);
        return null;
      }
      case 'qualifications':
        return null;
      case 'employment':
        if (!form.branchId) return 'الفرع مطلوب.';
        if (!form.departmentId) return 'القسم مطلوب.';
        if (!form.contractType) return 'نوع العقد مطلوب.';
        if (!form.workType) return 'نوع العمل مطلوب.';
        if (!form.jobTitle) return 'المسمى الوظيفي مطلوب.';
        return null;
      case 'referral':
        return null;
      default:
        return null;
    }
  }

  function goToStep(idx: number) {
    if (idx === currentStepIdx) return;
    // Allow going backwards freely; forward only if current step is valid
    // and target is within already-completed range.
    if (idx > currentStepIdx) {
      if (idx > completedUpTo) {
        // Can only jump forward to steps the user already passed through
        const err = validateStep(currentStep.key);
        if (err) { setLocalError(err); return; }
      }
    }
    setLocalError('');
    setCurrentStepIdx(idx);
    setVisitedSteps((prev) => {
      const next = new Set(prev);
      next.add(STEPS[idx].key);
      return next;
    });
  }

  function handleNext() {
    const err = validateStep(currentStep.key);
    if (err) { setLocalError(err); return; }
    setLocalError('');
    const nextIdx = Math.min(currentStepIdx + 1, STEPS.length - 1);
    // Advance the progress counter — only grows, never shrinks
    setCompletedUpTo((prev) => Math.max(prev, nextIdx));
    setCurrentStepIdx(nextIdx);
    setVisitedSteps((prev) => {
      const next = new Set(prev);
      next.add(STEPS[nextIdx].key);
      return next;
    });
  }

  function handlePrev() {
    setLocalError('');
    setCurrentStepIdx((idx) => Math.max(idx - 1, 0));
  }

  async function handleSubmit() {
    // Final validation across all steps (safety net).
    for (const step of STEPS) {
      const err = validateStep(step.key);
      if (err) {
        setLocalError(err);
        const idx = STEPS.findIndex((s) => s.key === step.key);
        setCurrentStepIdx(idx);
        return;
      }
    }

    const requestContacts = toRequestContacts(form.contacts);
    setLocalError('');

    await onSubmit({
      firstName: form.firstName.trim(),
      fatherName: form.fatherName.trim() || null,
      lastName: form.lastName.trim(),
      birthDate: form.birthDate,
      gender: form.gender,
      maritalStatus: form.maritalStatus,
      militaryService: form.militaryService,
      geoSelection: form.geoSelection,
      detailedAddress: form.detailedAddress.trim() || null,
      contacts: requestContacts,
      mobile: getPrimaryMobile(requestContacts),
      academicQualification: form.academicQualification || null,
      specialization: form.specialization || null,
      yearsOfExperience: form.yearsOfExperience || null,
      drivingLicense: form.drivingLicense === '' ? null : form.drivingLicense === 'yes',
      hasCar: form.hasCar === '' ? null : form.hasCar === 'yes',
      jobSkills: form.jobSkills.trim() || null,
      foreignLanguages: form.foreignLanguages,
      status: form.status,
      hireDate: form.hireDate || null,
      startWorkDate: form.startWorkDate || null,
      branchId: form.branchId,
      departmentId: form.departmentId,
      contractType: form.contractType,
      workType: form.workType,
      previousEmployment: form.previousEmployment.trim() || null,
      directManagerId: form.directManagerId,
      jobTitle: form.jobTitle,
      referrerType: form.referrerType || null,
      sourceChannel: form.sourceChannel || null,
      referrerName: form.referrerName.trim() || null,
      referralNotes: form.referralNotes.trim() || null,
      referralEntityId: form.referralEntityId ?? null,
    });
  }

  function updateContact(contactId: string, patch: Partial<ContactEntry>) {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact) => (
        contact.id === contactId ? { ...contact, ...patch } : contact
      )),
    }));
  }

  function addContact() {
    setForm((current) => ({ ...current, contacts: [...current.contacts, DEFAULT_CONTACT()] }));
  }

  function removeContact(contactId: string) {
    setForm((current) => {
      const nextContacts = current.contacts.filter((contact) => contact.id !== contactId);
      return {
        ...current,
        contacts: nextContacts.length > 0 ? nextContacts : [DEFAULT_CONTACT()],
      };
    });
  }

  function toggleForeignLanguage(value: string) {
    setForm((current) => ({
      ...current,
      foreignLanguages: current.foreignLanguages.includes(value)
        ? current.foreignLanguages.filter((item) => item !== value)
        : [...current.foreignLanguages, value],
    }));
  }

  function handleBranchChange(value: string) {
    const branchId = Number(value) || null;
    setForm((current) => ({
      ...current,
      branchId,
      departmentId: current.branchId === branchId ? current.departmentId : null,
      directManagerId: current.branchId === branchId ? current.directManagerId : null,
    }));
  }

  function handleQualificationChange(value: string) {
    setForm((current) => ({
      ...current,
      academicQualification: value,
      specialization: current.academicQualification === value ? current.specialization : '',
    }));
  }

  function handleReferralTypeChange(value: string) {
    const autoName = getReferralAutoName(value, currentUserDisplayName);
    // Reset referral-section sub-state when type changes
    setEmployeeIdInput('');
    setEmployeeFound(null);
    setEmployeeSearchError('');
    setClientSearch('');
    setClientSuggestions([]);
    setForm((current) => ({
      ...current,
      referrerType: value,
      referralEntityId: null,
      // Auto-fill name for Personal/Unknown; clear it when switching to Employee/Client
      referrerName: autoName ?? (current.referrerType === value ? current.referrerName : ''),
      sourceChannel: value ? normalizeSourceChannel(current.sourceChannel) : '',
    }));
  }

  async function handleEmployeeBlur() {
    const raw = employeeIdInput.trim();
    if (!raw) return;
    setEmployeeFound(null);
    setEmployeeSearchError('');
    try {
      const employees: MediatorEmployee[] = (await api.employees.list()).map(toMediatorEmployee);
      const match = findEmployeeByNumber(employees, raw);
      if (match) {
        setEmployeeFound(match);
        setForm((c) => ({ ...c, referrerName: match.name, referralEntityId: match.id }));
      } else {
        setEmployeeSearchError('لم يُعثر على موظف بهذا الرقم');
      }
    } catch {
      setEmployeeSearchError('تعذر البحث عن الموظف');
    }
  }

  function handleClientSearch(value: string) {
    setClientSearch(value);
    if (!value.trim()) { setClientSuggestions([]); return; }
    const q = value.toLowerCase();
    setClientSuggestions(
      allClients
        .filter((c) => {
          const name = (c.name || '').toLowerCase();
          const phone = c.contacts?.find((cn) => cn.isPrimary)?.number || c.contacts?.[0]?.number || '';
          return name.includes(q) || phone.includes(q);
        })
        .slice(0, 8),
    );
  }

  function handleSelectClient(client: Client) {
    setClientSearch(client.name || '');
    setClientSuggestions([]);
    setForm((c) => ({ ...c, referrerName: client.name || '', referralEntityId: client.id }));
  }

  // ── Step renderers ──────────────────────────────────────────────────────────

  function renderIdentityStep() {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <FieldLabel required>الاسم الأول</FieldLabel>
          <input
            value={form.firstName}
            onChange={(e) => setForm((c) => ({ ...c, firstName: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="مثال: أحمد"
          />
        </label>
        <label className="block">
          <FieldLabel>اسم الأب</FieldLabel>
          <input
            value={form.fatherName}
            onChange={(e) => setForm((c) => ({ ...c, fatherName: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="اختياري"
          />
        </label>
        <label className="block">
          <FieldLabel required>الكنية</FieldLabel>
          <input
            value={form.lastName}
            onChange={(e) => setForm((c) => ({ ...c, lastName: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="مثال: الخطيب"
          />
        </label>
        <label className="block">
          <FieldLabel required>تاريخ الميلاد</FieldLabel>
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => setForm((c) => ({ ...c, birthDate: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <FieldLabel required>الجنس</FieldLabel>
          <select
            value={form.gender}
            onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر الجنس</option>
            {genderOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <FieldLabel required>الحالة الاجتماعية</FieldLabel>
          <select
            value={form.maritalStatus}
            onChange={(e) => setForm((c) => ({ ...c, maritalStatus: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر الحالة الاجتماعية</option>
            {maritalStatusOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>
        <label className="block md:col-span-2 xl:col-span-3">
          <FieldLabel>الخدمة العسكرية</FieldLabel>
          <select
            value={form.militaryService}
            onChange={(e) => setForm((c) => ({ ...c, militaryService: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر حالة الخدمة العسكرية</option>
            {militaryServiceOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  function renderContactStep() {
    return (
      <div className="space-y-6">
        {/* Address */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
            <MapPin className="h-4 w-4 text-sky-500" /> عنوان الإقامة
          </div>
          <GeoSmartSearch
            geoUnits={geoUnits}
            value={form.geoSelection}
            onChange={(geoSelection) => setForm((c) => ({ ...c, geoSelection }))}
            label="العنوان"
            required
            placeholder="ابحث عن الناحية أو الحي"
            minSelectableLevel={3}
          />
          {!(form.geoSelection.subId || form.geoSelection.neighborhoodId) && (
            <p className="mt-2 text-[11px] text-amber-600 font-medium flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              يجب اختيار ناحية أو حي على الأقل — لا يمكن الاكتفاء بمحافظة أو منطقة
            </p>
          )}
          {addressHint && !form.geoSelection.subId && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              العنوان القادم من الطلب محفوظ كنص مرجعي: {addressHint}
            </div>
          )}
          <label className="mt-4 block">
            <FieldLabel>العنوان التفصيلي</FieldLabel>
            <textarea
              rows={3}
              value={form.detailedAddress}
              onChange={(e) => setForm((c) => ({ ...c, detailedAddress: e.target.value }))}
              className={INPUT_CLASS}
              placeholder="تفاصيل إضافية مثل البناء أو الطابق أو أقرب نقطة دالة"
            />
          </label>
        </div>

        {/* Contacts — compact row layout matching client form */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Phone className="h-4 w-4 text-sky-500" /> وسائل التواصل
            </div>
          </div>

          <div className="space-y-3">
            {form.contacts.map((contact) => {
              const statusCfg = CONTACT_STATUSES[contact.status ?? 'active'] ?? CONTACT_STATUSES.active;
              const hasInvalidNumber = isInvalidContactNumber(contact) || contact.status === 'invalid';
              return (
                <div
                  key={contact.id}
                  className={`rounded-xl border p-3 space-y-2.5 ${hasInvalidNumber ? 'border-red-200 bg-red-50/40' : 'border-slate-100 bg-slate-50'}`}
                >
                  {/* Row 1: type + prefix/areaCode + number + delete */}
                  <div className="flex items-center gap-2">
                    {/* Type select */}
                    <select
                      value={contact.type}
                      onChange={(e) => updateContact(contact.id, {
                        type: e.target.value as ContactType,
                        areaCode: e.target.value === 'mobile' ? '' : (contact.areaCode ?? ''),
                        number: '',
                      })}
                      className="border border-gray-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none min-w-[110px] bg-white"
                    >
                      {Object.entries(CONTACT_TYPES).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
                      ))}
                    </select>

                    {/* Mobile: +963 badge */}
                    {contact.type === 'mobile' && (
                      <span className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 select-none shrink-0" dir="ltr">
                        +963
                      </span>
                    )}

                    {/* Landline: area code */}
                    {contact.type === 'landline' && (
                      <input
                        type="text"
                        value={contact.areaCode ?? ''}
                        onChange={(e) => updateContact(contact.id, { areaCode: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                        placeholder="011"
                        dir="ltr"
                        maxLength={3}
                        className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-slate-800 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none w-[60px] text-center"
                      />
                    )}

                    {/* Number */}
                    <input
                      type="text"
                      value={contact.number}
                      onChange={(e) => {
                        const v = normalizeContactNumberInput(contact.type, contact.status, e.target.value, contact.number);
                        updateContact(contact.id, { number: v });
                      }}
                      placeholder={
                        contact.type === 'mobile' ? SYRIAN_MOBILE_HINT
                        : contact.type === 'landline' ? 'XXXXXXX'
                        : 'الرقم...'
                      }
                      dir="ltr"
                      className={`flex-1 border rounded-lg px-3 py-2 text-sm font-mono placeholder:text-gray-300 focus:outline-none bg-white ${hasInvalidNumber ? 'border-red-300 text-red-700 focus:border-red-400' : 'border-gray-200 text-slate-800 focus:border-sky-500'}`}
                    />

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => removeContact(contact.id)}
                      title="حذف الرقم"
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 text-gray-300 hover:text-rose-500 hover:bg-rose-50 border-transparent hover:border-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Row 2: label + status (colored) + whatsapp toggle */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={contact.label}
                      onChange={(e) => updateContact(contact.id, { label: e.target.value })}
                      placeholder="العلاقة (شخصي، أخ، عمل...)"
                      className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none"
                    />

                    <select
                      value={contact.status}
                      onChange={(e) => updateContact(contact.id, { status: e.target.value as ContactStatus })}
                      className={`border rounded-lg px-2 py-1.5 text-[11px] font-medium focus:outline-none min-w-[115px] ${statusCfg.style}`}
                    >
                      {Object.entries(CONTACT_STATUSES).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>

                    {/* WhatsApp icon toggle */}
                    <button
                      type="button"
                      onClick={() => updateContact(contact.id, { hasWhatsApp: !contact.hasWhatsApp })}
                      title={contact.hasWhatsApp ? 'يدعم واتساب' : 'بدون واتساب'}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all border shrink-0 ${
                        contact.hasWhatsApp
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          : 'bg-white border-gray-200 text-gray-300 hover:text-gray-400'
                      }`}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {hasInvalidNumber && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border w-fit bg-red-100 text-red-700 border-red-200">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      رقم موبايل غير مطابق للصيغة 09XXXXXXXX
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add number */}
          <button
            type="button"
            onClick={addContact}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-slate-500 hover:border-sky-300 hover:text-sky-600 hover:bg-sky-50/50 transition-all text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            إضافة رقم
          </button>
        </div>
      </div>
    );
  }

  function renderQualificationsStep() {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <FieldLabel>الشهادة العلمية</FieldLabel>
          <select
            value={form.academicQualification}
            onChange={(e) => handleQualificationChange(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">بدون تحديد</option>
            {certificateOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel>الاختصاص</FieldLabel>
          <select
            value={form.specialization}
            onChange={(e) => setForm((c) => ({ ...c, specialization: e.target.value }))}
            disabled={!form.academicQualification}
            className={`${INPUT_CLASS} disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <option value="">بدون تحديد</option>
            {form.specialization && !specializationOptions.find((item) => item.value === form.specialization) && (
              <option value={form.specialization}>{form.specialization}</option>
            )}
            {specializationOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel>سنوات الخبرة</FieldLabel>
          <input
            type="number"
            min={0}
            value={form.yearsOfExperience}
            onChange={(e) => setForm((c) => ({ ...c, yearsOfExperience: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="0"
          />
        </label>

        <label className="block">
          <FieldLabel>رخصة القيادة</FieldLabel>
          <select
            value={form.drivingLicense}
            onChange={(e) => setForm((c) => ({ ...c, drivingLicense: e.target.value as YesNoValue }))}
            className={INPUT_CLASS}
          >
            <option value="">بدون تحديد</option>
            <option value="yes">نعم</option>
            <option value="no">لا</option>
          </select>
        </label>

        <label className="block">
          <FieldLabel>امتلاك سيارة</FieldLabel>
          <select
            value={form.hasCar}
            onChange={(e) => setForm((c) => ({ ...c, hasCar: e.target.value as YesNoValue }))}
            className={INPUT_CLASS}
          >
            <option value="">بدون تحديد</option>
            <option value="yes">نعم</option>
            <option value="no">لا</option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <FieldLabel>المهارات الوظيفية</FieldLabel>
          <textarea
            rows={4}
            value={form.jobSkills}
            onChange={(e) => setForm((c) => ({ ...c, jobSkills: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="اذكر المهارات الأساسية للموظف"
          />
        </label>

        <div className="md:col-span-2">
          <FieldLabel>اللغات الأجنبية</FieldLabel>
          {foreignLanguageOptions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-400">
              لم يتم إضافة لغات في إعدادات النظام بعد.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {foreignLanguageOptions.map((item) => {
                const active = form.foreignLanguages.includes(item.value);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleForeignLanguage(item.value)}
                    className={`rounded-2xl border px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {active && <Check className="ml-1 inline h-3.5 w-3.5" />}
                    {item.value}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderEmploymentStep() {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold text-slate-400">رقم الموظف</div>
          <div className="mt-1 text-sm font-bold text-slate-800">
            {form.employeeNumber ? `#${form.employeeNumber}` : 'سيتم توليده تلقائيًا'}
          </div>
        </div>

        <label className="block">
          <FieldLabel>تاريخ التوظيف</FieldLabel>
          <input
            type="date"
            value={form.hireDate}
            onChange={(e) => setForm((c) => ({ ...c, hireDate: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>

        <label className="block">
          <FieldLabel>تاريخ بدء العمل</FieldLabel>
          <input
            type="date"
            value={form.startWorkDate}
            onChange={(e) => setForm((c) => ({ ...c, startWorkDate: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>

        <label className="block">
          <FieldLabel required locked={branchLocked}>الفرع</FieldLabel>
          {branchLocked ? (
            <input
              value={selectedBranchName}
              readOnly
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500"
            />
          ) : (
            <select
              value={form.branchId ?? ''}
              onChange={(e) => handleBranchChange(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">اختر الفرع</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          )}
        </label>

        <label className="block">
          <FieldLabel required>القسم</FieldLabel>
          <select
            value={form.departmentId ?? ''}
            onChange={(e) => setForm((c) => ({ ...c, departmentId: Number(e.target.value) || null, directManagerId: null }))}
            disabled={!form.branchId}
            className={`${INPUT_CLASS} disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <option value="">{form.branchId ? 'اختر القسم' : 'اختر الفرع أولًا'}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel required>نوع العقد</FieldLabel>
          <select
            value={form.contractType}
            onChange={(e) => setForm((c) => ({ ...c, contractType: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر نوع العقد</option>
            {contractTypeOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel required>نوع العمل</FieldLabel>
          <select
            value={form.workType}
            onChange={(e) => setForm((c) => ({ ...c, workType: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر نوع العمل</option>
            {workTypeOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel>المدير المباشر</FieldLabel>
          <select
            value={form.directManagerId ?? ''}
            onChange={(e) => setForm((c) => ({ ...c, directManagerId: Number(e.target.value) || null }))}
            disabled={!form.departmentId}
            className={`${INPUT_CLASS} disabled:bg-slate-50 disabled:text-slate-400`}
          >
            <option value="">بدون تحديد</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
                {manager.departmentName ? ` - ${manager.departmentName}` : ''}
                {manager.isRecommendedManager ? ' - موصى به' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block xl:col-span-2">
          <FieldLabel required>المسمى الوظيفي</FieldLabel>
          <select
            value={form.jobTitle}
            onChange={(e) => setForm((c) => ({ ...c, jobTitle: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر المسمى الوظيفي</option>
            {jobTitleOptions.map((item) => (
              <option key={item.id} value={item.value}>{item.value}</option>
            ))}
          </select>
          {selectedJobTitle?.linkedRoleName && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              الدور المرتبط: {selectedJobTitle.linkedRoleName}
            </div>
          )}
        </label>

        <label className="block xl:col-span-3">
          <FieldLabel>العمل السابق</FieldLabel>
          <textarea
            rows={3}
            value={form.previousEmployment}
            onChange={(e) => setForm((c) => ({ ...c, previousEmployment: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="اذكر آخر جهة عمل سابقة أو الخبرات المهنية"
          />
        </label>

        <label className="block">
          <FieldLabel>حالة السجل</FieldLabel>
          <select
            value={form.status}
            onChange={(e) => setForm((c) => ({ ...c, status: e.target.value as Employee['status'] }))}
            className={INPUT_CLASS}
          >
            {STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  function renderReferralStep() {
    const autoName = getReferralAutoName(form.referrerType, currentUserDisplayName);

    return (
      <div className="space-y-4">
        {/* Optional notice */}
        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-700">
          هذه الخطوة اختيارية — يمكنك حفظ الموظف مباشرة إن لم تتوفر معلومات الوسيط.
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Referral type */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">نوع الوسيط</label>
            <select
              value={form.referrerType}
              onChange={(e) => handleReferralTypeChange(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="">بدون تحديد</option>
              {REFERRER_TYPE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          {/* Origin channel */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">طريقة التواصل</label>
            <select
              value={form.sourceChannel}
              onChange={(e) => setForm((c) => ({ ...c, sourceChannel: e.target.value }))}
              className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-sky-500"
            >
              <option value="">بدون تحديد</option>
              {SOURCE_CHANNEL_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Referrer identity — varies by type ─────────────────────────── */}

        {/* Employee — lookup by employee number */}
        {form.referrerType === 'Employee' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الرقم الوظيفي</label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={employeeIdInput}
                onChange={(e) => setEmployeeIdInput(e.target.value)}
                onBlur={handleEmployeeBlur}
                placeholder="أدخل الرقم الوظيفي..."
                className="w-1/2 p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleEmployeeBlur}
                className="px-3 py-2.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-bold hover:bg-sky-100"
              >
                اعتماد
              </button>
              {employeeFound && (
                <div className="flex items-center gap-2 text-emerald-600 font-bold bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 flex-1 text-sm">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {formatEmployeeMediatorLabel(employeeFound)}
                </div>
              )}
              {employeeSearchError && (
                <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 px-3 py-2 rounded-lg border border-red-100 flex-1 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {employeeSearchError}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Client — search autocomplete */}
        {form.referrerType === 'Client' && (
          <div ref={clientSearchRef} className="relative">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الوسيط</label>
            {allClients.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2 px-1">لا يوجد زبائن متاحون ضمن صلاحياتك.</p>
            ) : (
              <>
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => handleClientSearch(e.target.value)}
                  onFocus={(e) => handleClientSearch(e.target.value)}
                  placeholder="ابحث عن الزبون بالاسم أو رقم الهاتف..."
                  className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none"
                />
                {clientSuggestions.length > 0 && (
                  <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-20 overflow-hidden">
                    {clientSuggestions.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => handleSelectClient(client)}
                        className="w-full text-right px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 transition-colors flex items-center justify-between"
                      >
                        <span className="font-bold text-slate-700 text-sm">{client.name}</span>
                        <span className="text-xs text-slate-400 font-mono" dir="ltr">
                          {client.contacts?.find((cn) => cn.isPrimary)?.number || client.contacts?.[0]?.number || '--'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {form.referralEntityId && form.referrerName && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <CheckCircle className="h-3.5 w-3.5" /> {form.referrerName}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Personal / Unknown — auto-filled locked name */}
        {(form.referrerType === 'Personal' || form.referrerType === 'Unknown') && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">اسم الوسيط</label>
            <div className="flex items-center gap-2">
              <input
                value={form.referrerName || autoName || ''}
                readOnly
                className="flex-1 p-2.5 rounded-xl border border-gray-200 bg-slate-50 text-slate-500 font-bold cursor-not-allowed text-sm focus:outline-none"
              />
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400">
                <Lock className="h-3.5 w-3.5" /> محدد تلقائياً
              </div>
            </div>
          </div>
        )}

        {/* No type selected yet — simple text fallback */}
        {!form.referrerType && (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">اسم الوسيط</label>
            <input
              value={form.referrerName}
              onChange={(e) => setForm((c) => ({ ...c, referrerName: e.target.value }))}
              placeholder="اسم الوسيط..."
              className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none"
            />
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1.5">ملاحظات الوسيط</label>
          <textarea
            rows={3}
            value={form.referralNotes}
            onChange={(e) => setForm((c) => ({ ...c, referralNotes: e.target.value }))}
            placeholder="أي ملاحظات تخص الوسيط أو طريقة التواصل..."
            className="w-full p-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:border-sky-500 focus:outline-none resize-none"
          />
        </div>
      </div>
    );
  }

  function renderStepBody() {
    switch (currentStep.key) {
      case 'identity':       return renderIdentityStep();
      case 'contact':        return renderContactStep();
      case 'qualifications': return renderQualificationsStep();
      case 'employment':     return renderEmploymentStep();
      case 'referral':       return renderReferralStep();
      default:               return null;
    }
  }

  // Progress: based solely on how far the user has navigated via "Next" button.
  // completedUpTo = highest step index reached by clicking Next (0 = none yet).
  const progressPct = Math.round((completedUpTo / STEPS.length) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm" dir="rtl">
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-slate-50 shadow-2xl">
          {/* Header */}
          <div className="border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                {description && (
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Progress bar — advances only when user clicks Next */}
            <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
              <span className="font-semibold">{completedUpTo} / {STEPS.length} خطوات</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-sky-400 to-sky-600 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="font-semibold text-sky-600">{progressPct}%</span>
            </div>
          </div>

          {/* Body: stepper sidebar + content */}
          <div className="flex flex-1 overflow-hidden">
            {/* Stepper (vertical on desktop, horizontal scroll on mobile) */}
            <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white p-4 lg:block">
              <ol className="space-y-1.5">
                {STEPS.map((step, idx) => {
                  const Icon = step.icon;
                  const isActive = idx === currentStepIdx;
                  // A step is "done" when the user has clicked Next past it
                  const isDone = idx < completedUpTo;
                  // Clickable if already visited (current or behind) or already passed through
                  const isClickable = idx <= completedUpTo || idx === currentStepIdx;
                  return (
                    <li key={step.key}>
                      <button
                        type="button"
                        onClick={() => isClickable ? goToStep(idx) : undefined}
                        disabled={!isClickable}
                        className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-right transition-all ${
                          isActive
                            ? 'border-sky-300 bg-sky-50 shadow-sm'
                            : isClickable
                              ? 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                              : 'cursor-not-allowed border-transparent opacity-50'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                            isDone && !isActive
                              ? 'bg-emerald-500 text-white'
                              : isActive
                                ? 'bg-sky-500 text-white'
                                : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                          }`}
                        >
                          {isDone && !isActive ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-bold ${isActive ? 'text-sky-700' : 'text-slate-800'}`}>
                            {idx + 1}. {step.title}
                          </div>
                          <div className="truncate text-xs text-slate-500">{step.subtitle}</div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>

            {/* Mobile stepper */}
            <div className="lg:hidden">
              <div className="overflow-x-auto border-b border-slate-200 bg-white px-3 py-2">
                <div className="flex gap-1.5">
                  {STEPS.map((step, idx) => {
                    const Icon = step.icon;
                    const isActive = idx === currentStepIdx;
                    const isDone = idx < completedUpTo;
                    const isClickable = idx <= completedUpTo || idx === currentStepIdx;
                    return (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => isClickable ? goToStep(idx) : undefined}
                        disabled={!isClickable}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'border-sky-300 bg-sky-50 text-sky-700'
                            : isDone
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-white text-slate-400 opacity-60'
                        }`}
                      >
                        {isDone && !isActive ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                        {step.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Content */}
            <main className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-4xl space-y-5">
                {loadingLookups && (
                  <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جارٍ تحميل القوائم المرجعية للفورم...
                    </span>
                  </div>
                )}

                {combinedError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {combinedError}
                  </div>
                )}

                {/* Current step card */}
                <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <header className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                      <currentStep.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-400">الخطوة {currentStepIdx + 1} من {STEPS.length}</div>
                      <h3 className="text-base font-bold text-slate-900">{currentStep.title}</h3>
                    </div>
                  </header>
                  <div className="p-6">{renderStepBody()}</div>
                </section>
              </div>
            </main>
          </div>

          {/* Footer with navigation */}
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              إلغاء
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={isFirstStep}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
                السابق
              </button>

              {isLastStep ? (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {submitLabel}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600"
                >
                  التالي
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
