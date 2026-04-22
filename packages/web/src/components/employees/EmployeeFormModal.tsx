import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Check,
  ChevronRight,
  ChevronLeft,
  GraduationCap,
  Loader2,
  Lock,
  MapPin,
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
  ContactEntry,
  Department,
  Employee,
  EmployeeManagerCandidate,
  GeoUnit,
  SystemList,
} from '../../lib/types';

type GenderValue = '' | 'male' | 'female';
type YesNoValue = '' | 'yes' | 'no';

export type EmployeeFormValues = {
  employeeNumber: number | null;
  firstName: string;
  fatherName: string;
  lastName: string;
  birthDate: string;
  gender: GenderValue;
  maritalStatus: string;
  militaryService: string;
  geoSelection: GeoSelection;
  detailedAddress: string;
  contacts: ContactEntry[];
  academicQualification: string;
  specialization: string;
  yearsOfExperience: string;
  drivingLicense: YesNoValue;
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
};

export type EmployeeFormInitialValues = Partial<EmployeeFormValues> & {
  residenceGovernorateId?: number | null;
  residenceRegionId?: number | null;
  residenceSubAreaId?: number | null;
  residenceNeighborhoodId?: number | null;
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
  { value: 'Personal', label: 'شخصي' },
  { value: 'Client', label: 'زبون' },
  { value: 'Employee', label: 'موظف' },
  { value: 'Unknown', label: 'غير معروف' },
];

const SOURCE_CHANNEL_OPTIONS = [
  { value: 'App', label: 'تطبيق' },
  { value: 'Campaign', label: 'حملة' },
  { value: 'Acquaintance', label: 'معرفة' },
  { value: 'Mobile App', label: 'تطبيق الجوال' },
  { value: 'Website', label: 'الموقع الإلكتروني' },
  { value: 'External Platforms', label: 'منصات خارجية' },
  { value: 'Internal', label: 'داخلي' },
];

const STATUS_OPTIONS: Array<{ value: Employee['status']; label: string }> = [
  { value: 'active', label: 'نشط' },
  { value: 'leave', label: 'إجازة' },
  { value: 'inactive', label: 'غير فعال' },
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

function toGenderValue(value: unknown): GenderValue {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'male' || raw === 'ذكر') return 'male';
  if (raw === 'female' || raw === 'أنثى' || raw === 'انثى') return 'female';
  return '';
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
    sourceChannel: initialValues?.sourceChannel ? String(initialValues.sourceChannel) : '',
    referrerName: initialValues?.referrerName ?? '',
    referralNotes: initialValues?.referralNotes ?? '',
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
  const [form, setForm] = useState<EmployeeFormValues>(() => buildFormState(initialValues, fixedBranchId));
  const [localError, setLocalError] = useState('');
  const [loadingLookups, setLoadingLookups] = useState(false);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<EmployeeManagerCandidate[]>([]);
  const [specializationOptions, setSpecializationOptions] = useState<SystemList[]>([]);
  const [listsByCategory, setListsByCategory] = useState<Record<string, SystemList[]>>({});
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<StepKey>>(() => new Set(['identity']));

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildFormState(initialValues, fixedBranchId));
    setLocalError('');
    setCurrentStepIdx(0);
    setVisitedSteps(new Set(['identity']));
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
          maritalStatus,
          militaryService,
          certificates,
          workTypes,
          contractTypes,
          foreignLanguages,
          jobTitles,
        ] = await Promise.all([
          api.geoUnits.list(),
          api.branches.list(),
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
          marital_status: maritalStatus,
          military_service: militaryService,
          certificate: certificates,
          work_type: workTypes,
          contract_type: contractTypes,
          foreign_language: foreignLanguages,
          job_title: jobTitles,
        });
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

  const selectedBranchName = useMemo(() => {
    if (branchLocked && fixedBranchName) return fixedBranchName;
    return branches.find((branch) => branch.id === form.branchId)?.name ?? fixedBranchName ?? '';
  }, [branchLocked, fixedBranchName, branches, form.branchId]);

  const selectedJobTitle = useMemo(() => {
    return (listsByCategory.job_title ?? []).find((item) => item.value === form.jobTitle) ?? null;
  }, [listsByCategory, form.jobTitle]);

  const certificateOptions = listsByCategory.certificate ?? [];
  const maritalStatusOptions = listsByCategory.marital_status ?? [];
  const militaryServiceOptions = listsByCategory.military_service ?? [];
  const workTypeOptions = listsByCategory.work_type ?? [];
  const contractTypeOptions = listsByCategory.contract_type ?? [];
  const foreignLanguageOptions = listsByCategory.foreign_language ?? [];
  const jobTitleOptions = listsByCategory.job_title ?? [];

  const combinedError = localError || error;

  // Per-step completion derived from form state.
  const stepCompletion = useMemo(() => {
    const identityDone = Boolean(
      form.firstName.trim() && form.lastName.trim() && form.birthDate
      && form.gender && form.maritalStatus && form.militaryService,
    );
    const hasContact = form.contacts.some((c) => String(c.number ?? '').replace(/\D/g, ''));
    const contactDone = Boolean(
      form.geoSelection.govId && form.geoSelection.regionId && form.geoSelection.subId && hasContact,
    );
    const qualificationsDone = true; // optional section
    const employmentDone = Boolean(
      form.branchId && form.departmentId && form.contractType && form.workType && form.jobTitle,
    );
    const referralDone = true;
    return { identity: identityDone, contact: contactDone, qualifications: qualificationsDone, employment: employmentDone, referral: referralDone };
  }, [form]);

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
        if (!form.militaryService) return 'الخدمة العسكرية مطلوبة.';
        return null;
      case 'contact': {
        if (!form.geoSelection.govId || !form.geoSelection.regionId || !form.geoSelection.subId) {
          return 'يجب تحديد المحافظة والمنطقة والناحية من البحث الجغرافي.';
        }
        const requestContacts = toRequestContacts(form.contacts);
        if (requestContacts.length === 0) return 'يجب إدخال وسيلة تواصل واحدة على الأقل.';
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
    // allow going backwards freely, forward only if current step valid
    if (idx > currentStepIdx) {
      const err = validateStep(currentStep.key);
      if (err) {
        setLocalError(err);
        return;
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
            onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value as GenderValue }))}
            className={INPUT_CLASS}
          >
            <option value="">اختر الجنس</option>
            <option value="male">ذكر</option>
            <option value="female">أنثى</option>
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
          <FieldLabel required>الخدمة العسكرية</FieldLabel>
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
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800">
            <MapPin className="h-4 w-4 text-sky-500" /> عنوان الإقامة
          </div>
          <GeoSmartSearch
            geoUnits={geoUnits}
            value={form.geoSelection}
            onChange={(geoSelection) => setForm((c) => ({ ...c, geoSelection }))}
            label="العنوان الجغرافي"
            required
            placeholder="ابحث عن الناحية أو الحي"
          />
          {addressHint && !form.geoSelection.subId && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              العنوان القادم من الطلب محفوظ كنص مرجعي: {addressHint}
            </div>
          )}
          <label className="mt-4 block">
            <FieldLabel>تفاصيل العنوان</FieldLabel>
            <textarea
              rows={3}
              value={form.detailedAddress}
              onChange={(e) => setForm((c) => ({ ...c, detailedAddress: e.target.value }))}
              className={INPUT_CLASS}
              placeholder="تفاصيل إضافية مثل البناء أو الطابق أو أقرب نقطة دالة"
            />
          </label>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Phone className="h-4 w-4 text-sky-500" /> وسائل التواصل
            </div>
            <button
              type="button"
              onClick={addContact}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-dashed border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50"
            >
              <Plus className="h-3.5 w-3.5" /> رقم جديد
            </button>
          </div>

          <div className="space-y-4">
            {form.contacts.map((contact, index) => (
              <div key={contact.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-bold text-slate-600">وسيلة التواصل #{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => removeContact(contact.id)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500 transition-colors hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="block">
                    <FieldLabel required>نوع الرقم</FieldLabel>
                    <select
                      value={contact.type}
                      onChange={(e) => updateContact(contact.id, { type: e.target.value as ContactEntry['type'], areaCode: e.target.value === 'mobile' ? '' : contact.areaCode ?? '' })}
                      className={INPUT_CLASS}
                    >
                      <option value="mobile">موبايل</option>
                      <option value="landline">هاتف آخر</option>
                    </select>
                  </label>

                  {contact.type === 'mobile' ? (
                    <label className="block">
                      <FieldLabel required>رقم الموبايل</FieldLabel>
                      <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-100">
                        <span className="inline-flex items-center border-l border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-500">+963</span>
                        <input
                          value={contact.number}
                          onChange={(e) => updateContact(contact.id, { number: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                          className="w-full px-4 py-3 text-sm text-slate-800 outline-none"
                          placeholder="9XXXXXXXX"
                        />
                      </div>
                    </label>
                  ) : (
                    <label className="block">
                      <FieldLabel required>لاحقة الهاتف</FieldLabel>
                      <input
                        value={contact.areaCode ?? ''}
                        onChange={(e) => updateContact(contact.id, { areaCode: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                        className={INPUT_CLASS}
                        placeholder="011"
                      />
                    </label>
                  )}

                  {contact.type === 'landline' && (
                    <label className="block">
                      <FieldLabel required>رقم الهاتف</FieldLabel>
                      <input
                        value={contact.number}
                        onChange={(e) => updateContact(contact.id, { number: e.target.value.replace(/\D/g, '').slice(0, 7) })}
                        className={INPUT_CLASS}
                        placeholder="1234567"
                      />
                    </label>
                  )}

                  <label className="block">
                    <FieldLabel>تسمية الرقم</FieldLabel>
                    <input
                      value={contact.label}
                      onChange={(e) => updateContact(contact.id, { label: e.target.value })}
                      className={INPUT_CLASS}
                      placeholder="مثال: شخصي"
                    />
                  </label>

                  <label className="block">
                    <FieldLabel>حالة الرقم</FieldLabel>
                    <select
                      value={contact.status}
                      onChange={(e) => updateContact(contact.id, { status: e.target.value as ContactEntry['status'] })}
                      className={INPUT_CLASS}
                    >
                      <option value="active">فعال</option>
                      <option value="preferred">مفضل</option>
                      <option value="out-of-coverage">خارج التغطية</option>
                      <option value="unused">غير مستخدم</option>
                    </select>
                  </label>

                  {contact.type === 'mobile' && (
                    <label className="mt-6 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 xl:col-span-4">
                      <input
                        type="checkbox"
                        checked={contact.hasWhatsApp}
                        onChange={(e) => updateContact(contact.id, { hasWhatsApp: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      واتساب متاح على هذا الرقم
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
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
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-700">
          هذه الخطوة اختيارية — يمكنك حفظ الموظف مباشرة إن لم تتوفر معلومات الوسيط.
        </div>

        <label className="block">
          <FieldLabel>نوع الوسيط</FieldLabel>
          <select
            value={form.referrerType}
            onChange={(e) => setForm((c) => ({ ...c, referrerType: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">بدون تحديد</option>
            {REFERRER_TYPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <FieldLabel>نوع التواصل</FieldLabel>
          <select
            value={form.sourceChannel}
            onChange={(e) => setForm((c) => ({ ...c, sourceChannel: e.target.value }))}
            className={INPUT_CLASS}
          >
            <option value="">بدون تحديد</option>
            {SOURCE_CHANNEL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <FieldLabel>اسم الوسيط</FieldLabel>
          <input
            value={form.referrerName}
            onChange={(e) => setForm((c) => ({ ...c, referrerName: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>

        <label className="block md:col-span-2">
          <FieldLabel>ملاحظات الوسيط</FieldLabel>
          <textarea
            rows={4}
            value={form.referralNotes}
            onChange={(e) => setForm((c) => ({ ...c, referralNotes: e.target.value }))}
            className={INPUT_CLASS}
            placeholder="ملاحظات أو تفاصيل إضافية عن الوسيط"
          />
        </label>
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

  // Progress percentage based on completed steps
  const completedCount = STEPS.filter((s) => stepCompletion[s.key]).length;
  const progressPct = Math.round((completedCount / STEPS.length) * 100);

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

            {/* Progress bar */}
            <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
              <span className="font-semibold">{completedCount} / {STEPS.length} أقسام</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-sky-400 to-sky-600 transition-all duration-300"
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
                  const isComplete = stepCompletion[step.key];
                  const isVisited = visitedSteps.has(step.key);
                  return (
                    <li key={step.key}>
                      <button
                        type="button"
                        onClick={() => goToStep(idx)}
                        className={`group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-right transition-all ${
                          isActive
                            ? 'border-sky-300 bg-sky-50 shadow-sm'
                            : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                            isComplete && isVisited
                              ? 'bg-emerald-500 text-white'
                              : isActive
                                ? 'bg-sky-500 text-white'
                                : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                          }`}
                        >
                          {isComplete && isVisited && !isActive ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
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
                    const isComplete = stepCompletion[step.key] && visitedSteps.has(step.key);
                    return (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => goToStep(idx)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'border-sky-300 bg-sky-50 text-sky-700'
                            : isComplete
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        {isComplete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
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
