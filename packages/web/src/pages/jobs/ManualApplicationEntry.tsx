import { useState, useEffect } from 'react';
import type { JobVacancy, GeoUnit, ReferralType, ReferralOriginChannel, Client } from '../../lib/types';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/authFetch';
import { uploadFile } from '../../lib/uploadFile';
import { useAuthStore } from '../../hooks/useAuthStore';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import { api } from '../../lib/api';
import { findEmployeeByNumber, formatEmployeeMediatorLabel, toMediatorEmployee, MediatorEmployee } from '../../lib/employeeMediatorLookup';
import GeoSmartSearch, { GeoSelection } from '../../components/GeoSmartSearch';
import {
  ArrowRight, Send, AlertTriangle, CheckCircle, UserPlus,
  User, MapPin, Phone, Mail, GraduationCap, Briefcase, Info, Loader2,
  File, UploadCloud, Paperclip, ChevronDown, MessageCircle, Banknote,
  Car, Languages, Search, Building2, ClipboardCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { SYRIAN_MOBILE_HINT, isValidSyrianMobile } from '../../lib/contactRules';
import Select from '../../components/ui/Select';

// --- Types & Constants ---

interface ApplicantForm {
  firstName: string; lastName: string; dob: string; gender: string;
  maritalStatus: string; email: string; mobileNumber: string; secondaryMobile: string;
  geoSelection: GeoSelection;
  detailedAddress: string;
  cvUrl: string; photoUrl: string;
  cvFile: File | null; photoFile: File | null;
  academicQualification: string; previousEmployment: string;
  drivingLicense: string; expectedSalary: string;
  hasCar: string;
  computerSkills: string;
  foreignLanguages: string[];
  yearsOfExperience: string; applicantSegment: string;
  specialization: string;
  hasWhatsappPrimary: boolean;
  hasWhatsappSecondary: boolean;
}

interface ReferrerForm {
  type: ReferralType;
  sourceChannel: ReferralOriginChannel;
  employeeId: string;
  fullName: string;
  lastName: string;
  geoSelection: GeoSelection;
  detailedAddress: string;
  referrerWork: string;
  referrerNotes: string;
  isReferrer: boolean;
}

const emptyApplicant: ApplicantForm = {
  firstName: '', lastName: '', dob: '', gender: '', maritalStatus: '',
  email: '', mobileNumber: '', secondaryMobile: '',
  geoSelection: { govId: '', regionId: '', subId: '', neighborhoodId: '' }, detailedAddress: '',
  cvUrl: '', photoUrl: '', cvFile: null, photoFile: null,
  academicQualification: '', previousEmployment: '',
  drivingLicense: '', expectedSalary: '',
  hasCar: '',
  computerSkills: '', foreignLanguages: [],
  yearsOfExperience: '', applicantSegment: '',
  specialization: '', hasWhatsappPrimary: false, hasWhatsappSecondary: false,
};

const emptyReferrer: ReferrerForm = {
  isReferrer: false, type: 'Employee', sourceChannel: 'Acquaintance', employeeId: '', fullName: '', lastName: '',
  geoSelection: { govId: '', regionId: '', subId: '', neighborhoodId: '' },
  detailedAddress: '', referrerWork: '', referrerNotes: '',
};

const referralOriginChannels: { value: ReferralOriginChannel; label: string }[] = [
  { value: 'Acquaintance', label: 'معرفة شخصية' },
  { value: 'PhoneCall', label: 'مكالمة هاتفية' },
  { value: 'SocialMedia', label: 'سوشال ميديا' },
  { value: 'Campaign', label: 'حملة إعلانية' },
];

const COMMON_LANGUAGES = ['الإنجليزية', 'الفرنسية', 'الكردية', 'التركية', 'الألمانية'];

// --- Design System ---

const sectionColors: Record<number, { bg: string; border: string; badge: string; icon: string; accent: string }> = {
  0: { bg: 'from-violet-600/10 to-purple-600/5', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700', icon: 'text-violet-500', accent: 'bg-violet-500' },
  1: { bg: 'from-sky-600/10 to-blue-600/5', border: 'border-sky-200', badge: 'bg-sky-100 text-sky-700', icon: 'text-sky-500', accent: 'bg-sky-500' },
  2: { bg: 'from-emerald-600/10 to-teal-600/5', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', icon: 'text-emerald-500', accent: 'bg-emerald-500' },
  3: { bg: 'from-orange-600/10 to-amber-600/5', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700', icon: 'text-orange-500', accent: 'bg-orange-500' },
  4: { bg: 'from-indigo-600/10 to-blue-600/5', border: 'border-indigo-200', badge: 'bg-indigo-100 text-indigo-700', icon: 'text-indigo-500', accent: 'bg-indigo-500' },
  5: { bg: 'from-rose-600/10 to-pink-600/5', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-700', icon: 'text-rose-500', accent: 'bg-rose-500' },
  6: { bg: 'from-amber-600/10 to-yellow-600/5', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: 'text-amber-500', accent: 'bg-amber-500' },
};

const inputCls = (hasError?: boolean) =>
  `w-full bg-white border ${hasError ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200 hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100'} rounded-xl px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-300`;

const selectCls = (hasError?: boolean) =>
  `w-full bg-white border ${hasError ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200 hover:border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100'} rounded-xl px-4 py-2.5 text-sm text-slate-800 transition-all outline-none appearance-none cursor-pointer`;

function SectionCard({ num, title, subtitle, icon: Icon, colorKey, children, delay = 0 }: {
  num: number; title: string; subtitle?: string; icon?: any;
  colorKey: number; children: React.ReactNode; delay?: number;
}) {
  const c = sectionColors[colorKey] || sectionColors[1];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
      className={`rounded-2xl border ${c.border} bg-gradient-to-br ${c.bg} overflow-hidden shadow-sm`}
    >
      {/* Section Header */}
      <div className="px-6 pt-5 pb-4 flex items-center gap-4">
        <div className={`w-9 h-9 rounded-xl ${c.badge} flex items-center justify-center font-black text-sm shrink-0`}>
          {num}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            {Icon && <Icon className={`w-4 h-4 ${c.icon}`} />}
            {title}
          </h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className={`w-1 h-8 rounded-full ${c.accent} opacity-40 shrink-0`} />
      </div>
      {/* Divider */}
      <div className={`h-px mx-6 bg-gradient-to-r from-transparent via-slate-200 to-transparent`} />
      {/* Content */}
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {children}
        </div>
      </div>
    </motion.div>
  );
}

function Field({ label, error, required, children, className = '', hint }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode; className?: string; hint?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-slate-500 mb-1.5">
        {label}
        {required && <span className="text-red-400 mr-1">*</span>}
        {hint && <span className="font-normal text-slate-400 mr-1">({hint})</span>}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 4 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="text-xs text-red-500 flex items-center gap-1"
          >
            <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
    </div>
  );
}

function WhatsappTag({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`mt-1.5 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${checked ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {label}
      <span className={`w-2 h-2 rounded-full ${checked ? 'bg-emerald-500' : 'bg-slate-200'}`} />
    </button>
  );
}

// --- Main Form Component ---

export default function ManualApplicationEntry() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { fetchLists, getValuesByCategory } = useSystemListsStore();

  const [vacancies, setVacancies] = useState<JobVacancy[]>([]);
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  const [selectedVacancyId, setSelectedVacancyId] = useState<number | ''>('');
  const [submissionType, setSubmissionType] = useState<'Apply' | 'Refer a Candidate'>('Apply');
  const [applicationSource, setApplicationSource] = useState('');

  const [applicant, setApplicant] = useState<ApplicantForm>({ ...emptyApplicant });
  const [referrer, setReferrer] = useState<ReferrerForm>({ ...emptyReferrer });

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitResult, setSubmitResult] = useState<{ type: 'success' | 'error'; message: string; id?: number } | null>(null);
  const [employees, setEmployees] = useState<MediatorEmployee[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSuggestions, setClientSuggestions] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [employeeFound, setEmployeeFound] = useState<MediatorEmployee | null>(null);

  useEffect(() => {
    fetchLists();
    authFetch('/api/admin/vacancies?status=Open')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setVacancies(data); })
      .catch(console.error);

    authFetch('/api/geo-units')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setGeoUnits(data); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.clients.list(), api.employees.list()]).then(([clientsRes, employeesRes]) => {
      if (!active) return;
      setAllClients(clientsRes.status === 'fulfilled' ? clientsRes.value : []);
      setEmployees(
        employeesRes.status === 'fulfilled'
          ? employeesRes.value.map((item: any) => toMediatorEmployee(item))
          : [],
      );
    });
    return () => { active = false; };
  }, []);

  const setA = (key: keyof ApplicantForm, val: any) => {
    setApplicant(p => ({ ...p, [key]: val }));
    if (fieldErrors[key]) setFieldErrors(p => { const n = { ...p }; delete n[key]; return n; });
  };
  const setR = (key: keyof ReferrerForm, val: any) => {
    setReferrer(p => ({ ...p, [key]: val }));
    if (fieldErrors[`referrer_${key}`]) setFieldErrors(p => { const n = { ...p }; delete n[`referrer_${key}`]; return n; });
  };

  const handleNameInput = (val: string, key: 'firstName' | 'lastName') => {
    const cleaned = val.replace(/[0-9!@#$%^&*()_+=[\]{};':\"\\|,.<>/?]/g, '');
    setA(key, cleaned);
  };

  const handleReferrerNameInput = (val: string, key: 'fullName' | 'lastName') => {
    const cleaned = val.replace(/[0-9!@#$%^&*()_+=[\]{};':\"\\|,.<>/?]/g, '');
    setR(key, cleaned);
  };

  const handleReferrerTypeChange = (value: ReferralType) => {
    const autoName = value === 'Personal'
      ? (user?.name?.trim() || 'شخصي')
      : value === 'Unknown'
        ? 'مجهول'
        : '';
    setR('type', value);
    setR('employeeId', '');
    setR('fullName', autoName);
    setR('lastName', '');
    setR('geoSelection', { govId: '', regionId: '', subId: '', neighborhoodId: '' });
    setR('detailedAddress', '');
    setR('referrerWork', '');
    setR('referrerNotes', '');
    setSelectedClientId(null);
    setClientSearch('');
    setClientSuggestions([]);
    setEmployeeFound(null);
    delete fieldErrors.referrer_type;
    delete fieldErrors.referrer_employeeId;
    delete fieldErrors.referrer_fullName;
    delete fieldErrors.referrer_lastName;
    delete fieldErrors.referrer_geoSelection;
    delete fieldErrors.referrer_detailedAddress;
    delete fieldErrors.referrer_referrerWork;
  };

  const handleEmployeeLookup = async () => {
    const raw = referrer.employeeId.trim();
    if (!raw) return;
    const found = findEmployeeByNumber(employees, raw);
    if (found) {
      setEmployeeFound(found);
      setR('fullName', found.name);
      setR('lastName', '');
      setSelectedClientId(null);
      setClientSearch('');
      setClientSuggestions([]);
      delete fieldErrors.referrer_employeeId;
      delete fieldErrors.referrer_fullName;
        return;
    }
    setEmployeeFound(null);
    setFieldErrors(prev => ({ ...prev, referrer_employeeId: 'لم يتم العثور على الموظف' }));
  };

  const handleClientSearch = (text: string) => {
    setClientSearch(text);
    const query = text.trim();
    const matches = allClients
      .filter(client => !client.isCandidate)
      .filter(client =>
        !query ||
        client.name.includes(query) ||
        (client.contacts || []).some(con => con.number.includes(query)) ||
        String(client.mobile || '').includes(query)
      )
      .slice(0, query ? 10 : 20);
    setClientSuggestions(matches);
  };

  const handleSelectClient = (client: Client) => {
    setSelectedClientId(client.id);
    setClientSearch(client.name);
    setClientSuggestions([]);
    setEmployeeFound(null);
    setR('fullName', client.name || '');
    setR('lastName', '');
  };

  const toggleLanguage = (lang: string) => {
    setApplicant(prev => {
      const current = prev.foreignLanguages;
      const next = current.includes(lang) ? current.filter(l => l !== lang) : [...current, lang];
      setFieldErrors(e => { const ne = { ...e }; delete ne.foreignLanguages; return ne; });
      return { ...prev, foreignLanguages: next };
    });
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!applicationSource) e.applicationSource = 'مصدر الطلب مطلوب';
    if (!selectedVacancyId) e.vacancy = 'الشاغر الوظيفي حقل إلزامي';
    if (!applicant.firstName.trim()) e.firstName = 'الاسم الأول مطلوب';
    if (!applicant.lastName.trim()) e.lastName = 'الكنية مطلوبة';
    if (!applicant.dob) {
      e.dob = 'تاريخ الميلاد مطلوب';
    } else {
      const age = (new Date().getTime() - new Date(applicant.dob).getTime()) / 31557600000;
      if (age < 18) e.dob = 'يجب أن يكون العمر 18 سنة على الأقل';
    }
    if (!applicant.gender) e.gender = 'الجنس مطلوب';
    if (!applicant.maritalStatus) e.maritalStatus = 'الحالة الاجتماعية مطلوبة';
    if (applicant.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicant.email)) {
      e.email = 'صيغة البريد الإلكتروني غير صحيحة';
    }
    if (!applicant.geoSelection.govId) e.geoSelection = 'المحافظة مطلوبة';
    if (!applicant.detailedAddress.trim()) e.detailedAddress = 'العنوان التفصيلي مطلوب';
    if (!applicant.mobileNumber.trim()) e.mobileNumber = 'رقم الموبايل الرئيسي مطلوب';
    else if (!isValidSyrianMobile(applicant.mobileNumber)) e.mobileNumber = 'يجب أن يبدأ بـ 09 ويتكون من 10 أرقام';
    if (applicant.secondaryMobile.trim() && !isValidSyrianMobile(applicant.secondaryMobile)) {
      e.secondaryMobile = 'يجب أن يبدأ بـ 09 ويتكون من 10 أرقام';
    }
    if (!applicant.academicQualification) e.academicQualification = 'الشهادة العلمية مطلوبة';
    if (!applicant.previousEmployment.trim()) e.previousEmployment = 'العمل السابق مطلوب';
    if (!applicant.drivingLicense) e.drivingLicense = 'يرجى تحديد حالة الرخصة';
    if (!applicant.hasCar) e.hasCar = 'يرجى تحديد هل تمتلك سيارة';
    if (!applicant.expectedSalary) e.expectedSalary = 'الراتب المتوقع مطلوب';
    if (!applicant.computerSkills.trim()) e.computerSkills = 'مهارات الحاسب مطلوبة';
    if (applicant.foreignLanguages.length === 0) e.foreignLanguages = 'اختر لغة واحدة على الأقل';
    if (!applicant.yearsOfExperience || parseInt(applicant.yearsOfExperience) < 0) e.yearsOfExperience = 'سنوات الخبرة مطلوبة';
    if (submissionType === 'Refer a Candidate' && referrer.isReferrer) {
      if (!referrer.type) e.referrer_type = 'مطلوب';

      if (referrer.type === 'Employee') {
        if (!referrer.employeeId.trim()) e.referrer_employeeId = 'رقم الموظف مطلوب';
        if (!employeeFound) e.referrer_employeeId = 'لم يتم العثور على الموظف';
      } else if (referrer.type === 'Client') {
        if (!selectedClientId) e.referrer_fullName = 'الرجاء اختيار الزبون الوسيط';
      }
    }

    if (Object.keys(e).length > 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return false; }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitResult(null);
    setSubmitting(true);
    try {
      const getGeoName = (idStr: string) => {
        if (!idStr) return '';
        const unit = geoUnits.find(u => u.id.toString() === idStr);
        return unit ? unit.name : '';
      };
      let finalPhotoUrl = applicant.photoUrl;
      let finalCvUrl = applicant.cvUrl;
      if (applicant.photoFile) finalPhotoUrl = await uploadFile(applicant.photoFile);
      if (applicant.cvFile) finalCvUrl = await uploadFile(applicant.cvFile);
      // photoUrl stays null if not provided (validation catches missing photo above)

      const payload: any = {
        jobVacancyId: selectedVacancyId || null,
        submissionType, applicationSource,
        enteredById: user?.id, enteredByName: user?.name,
        applicant: {
          firstName: applicant.firstName.trim(), lastName: applicant.lastName.trim(),
          dob: applicant.dob, gender: applicant.gender, maritalStatus: applicant.maritalStatus,
          email: applicant.email.trim() || null,
          mobileNumber: applicant.mobileNumber.trim(), secondaryMobile: applicant.secondaryMobile.trim() || null,
          governorate: getGeoName(applicant.geoSelection.govId),
          cityOrArea: getGeoName(applicant.geoSelection.regionId),
          subArea: getGeoName(applicant.geoSelection.subId),
          neighborhood: getGeoName(applicant.geoSelection.neighborhoodId),
          detailedAddress: applicant.detailedAddress.trim(),
          cvUrl: finalCvUrl || null, photoUrl: finalPhotoUrl,
          academicQualification: applicant.academicQualification.trim(),
          specialization: applicant.specialization.trim() || null,
          previousEmployment: applicant.previousEmployment.trim(),
          drivingLicense: applicant.drivingLicense === 'yes',
          hasCar: applicant.hasCar === 'yes',
          expectedSalary: parseInt(applicant.expectedSalary),
          computerSkills: applicant.computerSkills.trim(),
          foreignLanguages: applicant.foreignLanguages.join(', '),
          yearsOfExperience: parseInt(applicant.yearsOfExperience),
          applicantSegment: applicant.applicantSegment || null,
          hasWhatsappPrimary: applicant.hasWhatsappPrimary,
          hasWhatsappSecondary: applicant.hasWhatsappSecondary,
        },
      };

      if (submissionType === 'Refer a Candidate' && referrer.isReferrer) {
        payload.referrer = {
          type: referrer.type,
          sourceChannel: referrer.sourceChannel,
          employeeId: referrer.employeeId ? parseInt(referrer.employeeId) : null,
          referralEntityId: referrer.type === 'Employee'
            ? (referrer.employeeId ? parseInt(referrer.employeeId) : null)
            : (selectedClientId ?? null),
          fullName: referrer.fullName.trim() || null, lastName: referrer.lastName.trim() || null,
          governorate: getGeoName(referrer.geoSelection.govId) || null,
          cityOrArea: getGeoName(referrer.geoSelection.regionId) || null,
          subArea: getGeoName(referrer.geoSelection.subId) || null,
          neighborhood: getGeoName(referrer.geoSelection.neighborhoodId) || null,
          detailedAddress: referrer.detailedAddress.trim() || null,
          referrerWork: referrer.referrerWork.trim() || null,
          referrerNotes: referrer.referrerNotes.trim() || null,
        };
      }

      const res = await authFetch('/api/admin/applications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'حدث خطأ أثناء حفظ الطلب');
      navigate(`/jobs/applications/${result.id}?success=true`);
    } catch (err: any) {
      setSubmitResult({ type: 'error', message: err.message });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  const genderOpts = getValuesByCategory('gender');
  const maritalOpts = getValuesByCategory('marital_status');
  const qualOpts = getValuesByCategory('academic_qualification');
  const appSourceOpts = getValuesByCategory('application_source');
  const majorOpts = getValuesByCategory('major:' + applicant.academicQualification);
  const langOpts = getValuesByCategory('foreign_language').length > 0 ? getValuesByCategory('foreign_language') : COMMON_LANGUAGES;
  const errCount = Object.keys(fieldErrors).length;

  return (
    <div className="h-full overflow-y-auto bg-slate-50 font-sans" dir="rtl">

      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-100 shadow-sm">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center gap-4">
          <button onClick={() => navigate('/jobs/applications')} className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700">
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-slate-800 truncate flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-violet-500 shrink-0" />
              نموذج إدخال طلب توظيف
            </h1>
            <p className="text-xs text-slate-400">تسجيل يدوي — إدارة الموارد البشرية</p>
          </div>
          {errCount > 0 && (
            <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              {errCount} أخطاء
            </motion.div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-6 pb-40 space-y-5">

        {/* Error Banner */}
        <AnimatePresence>
          {submitResult?.type === 'error' && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-4 text-sm text-red-700">
              <div className="w-8 h-8 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <p className="font-semibold">{submitResult.message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ─── SECTION 0: Routing Settings ─── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-600/8 to-purple-600/4 shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-4 flex items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">إعدادات توجيه الطلب</h3>
              <p className="text-xs text-slate-400 mt-0.5">ربط الطلب بشاغر ومصدر التقديم</p>
            </div>
          </div>
          <div className="h-px mx-6 bg-gradient-to-r from-transparent via-violet-200 to-transparent" />
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="الشاغر الوظيفي المرتبط" required error={fieldErrors.vacancy}>
              <Select
                value={selectedVacancyId === '' ? '' : String(selectedVacancyId)}
                onChange={v => setSelectedVacancyId(v === '' ? '' : Number(v))}
                placeholder="غير مرتبط بشاغر (يُربط لاحقاً)"
                ariaLabel="الشاغر الوظيفي"
                className="w-full"
                options={vacancies.map(v => ({ value: String(v.id), label: (v.branch ? `[${v.branch}] ` : '') + v.title }))}
              />
            </Field>
            <Field label="نوع التقديم" required>
              <Select
                value={submissionType}
                onChange={v => setSubmissionType(v as any)}
                ariaLabel="نوع التقديم"
                className="w-full"
                options={[
                  { value: 'Apply', label: 'تقديم طبيعي للمرشح' },
                  { value: 'Refer a Candidate', label: 'تقديم نيابة عن مرشح (كوسيط)' },
                ]}
              />
            </Field>
            <Field label="مصدر الطلب" required error={fieldErrors.applicationSource}>
              <Select
                value={applicationSource}
                onChange={v => { setApplicationSource(v); delete fieldErrors.applicationSource; }}
                placeholder="-- اختر المصدر --"
                ariaLabel="مصدر الطلب"
                className="w-full"
                options={appSourceOpts.length
                  ? appSourceOpts.map(v => ({ value: v, label: v }))
                  : [
                      { value: 'Internal', label: 'تسجيل داخلي (HR)' },
                      { value: 'External Platforms', label: 'منصات خارجية' },
                      { value: 'Paper', label: 'نماذج ورقية' },
                      { value: 'Facebook Page', label: 'صفحة فيسبوك' },
                    ]}
              />
            </Field>
          </div>

          <AnimatePresence>
            {submissionType === 'Refer a Candidate' && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="px-6 pb-5">
                  <button type="button" onClick={() => setR('isReferrer', !referrer.isReferrer)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${referrer.isReferrer ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-dashed border-amber-300 bg-amber-50/50 text-amber-700'}`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${referrer.isReferrer ? 'bg-amber-500 border-amber-500' : 'border-amber-400'}`}>
                      {referrer.isReferrer && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <UserPlus className="w-4 h-4" />
                    <span className="text-sm font-bold">تفعيل إدخال بيانات الوسيط يدوياً وإدراجها مع الطلب</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ─── SECTION 1: Personal Info ─── */}
        <SectionCard num={1} title="البيانات الشخصية" subtitle="المعلومات الأساسية للمتقدم" icon={User} colorKey={1} delay={0.05}>
          <Field label="الاسم الأول" required error={fieldErrors.firstName}>
            <input value={applicant.firstName} onChange={e => handleNameInput(e.target.value, 'firstName')} className={inputCls(!!fieldErrors.firstName)} placeholder="مثال: أحمد" />
          </Field>
          <Field label="الكنية / اسم العائلة" required error={fieldErrors.lastName}>
            <input value={applicant.lastName} onChange={e => handleNameInput(e.target.value, 'lastName')} className={inputCls(!!fieldErrors.lastName)} placeholder="مثال: العبادي" />
          </Field>
          <Field label="تاريخ الميلاد" required error={fieldErrors.dob}>
            <input type="date" value={applicant.dob} onChange={e => setA('dob', e.target.value)} max={new Date().toISOString().split('T')[0]} className={inputCls(!!fieldErrors.dob)} />
          </Field>
          <Field label="الجنس" required error={fieldErrors.gender}>
            <Select
              value={applicant.gender}
              onChange={v => setA('gender', v)}
              placeholder="اختر الجنس"
              ariaLabel="الجنس"
              className="w-full"
              options={genderOpts.length ? genderOpts.map(v => ({ value: v, label: v })) : [{ value: 'ذكر', label: 'ذكر' }, { value: 'أنثى', label: 'أنثى' }]}
            />
          </Field>
          <Field label="الحالة الاجتماعية" required error={fieldErrors.maritalStatus} className="md:col-span-2 lg:col-span-2">
            <Select
              value={applicant.maritalStatus}
              onChange={v => setA('maritalStatus', v)}
              placeholder="اختر الحالة"
              ariaLabel="الحالة الاجتماعية"
              className="w-full"
              options={maritalOpts.length ? maritalOpts.map(v => ({ value: v, label: v })) : [
                { value: 'أعزب', label: 'أعزب' },
                { value: 'متزوج', label: 'متزوج' },
                { value: 'مطلق', label: 'مطلق' },
                { value: 'أرمل', label: 'أرمل' },
              ]}
            />
          </Field>
        </SectionCard>

        {/* ─── SECTION 2: Address ─── */}
        <SectionCard num={2} title="عنوان السكن" subtitle="المحافظة إلزامية، وبقية مستويات العنوان اختيارية" icon={MapPin} colorKey={2} delay={0.08}>
          <div className={`md:col-span-2 lg:col-span-2 rounded-xl border ${fieldErrors.geoSelection ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-white'} p-4`}>
            <GeoSmartSearch
              label="التسلسل الهرمي للمنطقة"
              geoUnits={geoUnits} value={applicant.geoSelection}
              onChange={v => { setA('geoSelection', v); delete fieldErrors.geoSelection; }}
              placeholder="المحافظة > المنطقة > الناحية > الحي"
            />
            <p className="mt-2 text-xs text-slate-500">يمكن الحفظ بمحافظة + عنوان تفصيلي فقط، أما المنطقة والناحية والحي فهي اختيارية.</p>
          </div>
          <Field label="تفاصيل إضافية للعنوان" required error={fieldErrors.detailedAddress}>
            <textarea value={applicant.detailedAddress} onChange={e => setA('detailedAddress', e.target.value)}
              className={inputCls(!!fieldErrors.detailedAddress) + " min-h-[80px] py-2.5 resize-none"}
              placeholder="رقم الدار، أقرب نقطة دالة..." />
          </Field>
        </SectionCard>

        {/* ─── SECTION 3: Contact ─── */}
        <SectionCard num={3} title="معلومات التواصل" subtitle="البريد الإلكتروني وأرقام الاتصال" icon={Phone} colorKey={3} delay={0.1}>
          <Field label="البريد الإلكتروني" error={fieldErrors.email}>
            <div className="relative">
              <input type="email" value={applicant.email} onChange={e => setA('email', e.target.value)}
                className={inputCls(!!fieldErrors.email) + " pl-9"} dir="ltr" placeholder="example@email.com" />
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
            </div>
          </Field>
          <div className="space-y-1">
            <Field label="رقم الموبايل الرئيسي" required error={fieldErrors.mobileNumber}>
              <input value={applicant.mobileNumber} onChange={e => setA('mobileNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                className={inputCls(!!fieldErrors.mobileNumber) + " text-left font-mono tracking-wider"} dir="ltr" maxLength={10} placeholder={SYRIAN_MOBILE_HINT} />
            </Field>
            <WhatsappTag checked={applicant.hasWhatsappPrimary} onChange={v => setA('hasWhatsappPrimary', v)} label="يدعم واتساب" />
          </div>
          <div className="space-y-1">
            <Field label="رقم بديل" hint="اختياري" error={fieldErrors.secondaryMobile}>
              <input value={applicant.secondaryMobile} onChange={e => setA('secondaryMobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                className={inputCls(!!fieldErrors.secondaryMobile) + " text-left font-mono tracking-wider"} dir="ltr" maxLength={10} placeholder={SYRIAN_MOBILE_HINT} />
            </Field>
            {applicant.secondaryMobile.trim() && (
              <WhatsappTag checked={applicant.hasWhatsappSecondary} onChange={v => setA('hasWhatsappSecondary', v)} label="الرقم البديل يدعم واتساب" />
            )}
          </div>
        </SectionCard>

        {/* ─── SECTION 4: Qualifications ─── */}
        <SectionCard num={4} title="المؤهلات والخبرات" subtitle="الشهادة والمهارات والخبرة المهنية" icon={GraduationCap} colorKey={4} delay={0.12}>
          <Field label="الشهادة العلمية" required error={fieldErrors.academicQualification}>
            <Select
              value={applicant.academicQualification}
              onChange={v => { setA('academicQualification', v); setA('specialization', ''); }}
              placeholder="اختر الشهادة"
              ariaLabel="الشهادة العلمية"
              className="w-full"
              options={qualOpts.length ? qualOpts.map(v => ({ value: v, label: v })) : [
                { value: 'إعدادية', label: 'إعدادية' },
                { value: 'بكالوريوس', label: 'بكالوريوس' },
                { value: 'ماجستير', label: 'ماجستير' },
                { value: 'دكتوراه', label: 'دكتوراه' },
              ]}
            />
          </Field>
          <Field label="الاختصاص / التخصص" error={fieldErrors.specialization}>
            {majorOpts.length > 0 ? (
              <Select
                value={applicant.specialization}
                onChange={v => setA('specialization', v)}
                placeholder="-- اختر الاختصاص --"
                ariaLabel="الاختصاص"
                className="w-full"
                options={majorOpts.map(v => ({ value: v, label: v }))}
              />
            ) : (
              <input value={applicant.specialization} onChange={e => setA('specialization', e.target.value)} className={inputCls()} placeholder="مثال: هندسة برمجيات" />
            )}
          </Field>
          <Field label="سنوات الخبرة" required error={fieldErrors.yearsOfExperience}>
            <input type="number" min="0" value={applicant.yearsOfExperience} onChange={e => setA('yearsOfExperience', e.target.value)}
              className={inputCls(!!fieldErrors.yearsOfExperience)} placeholder="0 = حديث التخرج" />
          </Field>
          <Field label="جهة العمل السابقة" required error={fieldErrors.previousEmployment}>
            <input value={applicant.previousEmployment} onChange={e => setA('previousEmployment', e.target.value)} maxLength={150}
              className={inputCls(!!fieldErrors.previousEmployment)} placeholder="آخر مكان عمل أو 'لا يوجد'" />
          </Field>
          <Field label="الراتب المتوقع (ل.س)" required error={fieldErrors.expectedSalary}>
            <div className="relative">
              <input type="number" min="0" value={applicant.expectedSalary} onChange={e => setA('expectedSalary', e.target.value)}
                className={inputCls(!!fieldErrors.expectedSalary) + " pl-9"} placeholder="أرقام فقط" />
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
            </div>
          </Field>
          <Field label="مهارات الحاسب" required error={fieldErrors.computerSkills}>
            <input value={applicant.computerSkills} onChange={e => setA('computerSkills', e.target.value)}
              className={inputCls(!!fieldErrors.computerSkills)} placeholder="مثال: إتقان MS Office" />
          </Field>
          <Field label="رخصة القيادة" required error={fieldErrors.drivingLicense} className="flex flex-col">
            <div className="flex items-center gap-3 mt-1">
              {[{ val: 'yes', label: 'نعم، يوجد' }, { val: 'no', label: 'لا يوجد' }].map(opt => (
                <label key={opt.val} onClick={() => setA('drivingLicense', opt.val)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 cursor-pointer text-sm font-semibold transition-all ${applicant.drivingLicense === opt.val ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                  <Car className="w-3.5 h-3.5" />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="هل تمتلك سيارة" required error={fieldErrors.hasCar} className="flex flex-col">
            <div className="flex items-center gap-3 mt-1">
              {[{ val: 'yes', label: 'نعم' }, { val: 'no', label: 'لا' }].map(opt => (
                <label key={opt.val} onClick={() => setA('hasCar', opt.val)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 cursor-pointer text-sm font-semibold transition-all ${applicant.hasCar === opt.val ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                  <Car className="w-3.5 h-3.5" />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="اللغات الأجنبية" required error={fieldErrors.foreignLanguages} className="md:col-span-2 lg:col-span-3">
            <div className="flex flex-wrap gap-2 p-3 bg-white border border-slate-200 rounded-xl">
              {langOpts.map(lang => (
                <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all flex items-center gap-1.5 ${applicant.foreignLanguages.includes(lang) ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                  <Languages className="w-3 h-3" />
                  {lang}
                </button>
              ))}
              {langOpts.length === 0 && <p className="text-xs text-slate-400">لا توجد لغات مضافة في القوائم</p>}
            </div>
          </Field>
        </SectionCard>

        {/* ─── SECTION 5: Attachments ─── */}
        <SectionCard num={5} title="المرفقات" subtitle="صورة شخصية وسيرة ذاتية" icon={Paperclip} colorKey={5} delay={0.14}>
          <div>
            <Field label="صورة شخصية" required error={fieldErrors.photoFile}>
              <input type="file" id="photo-upload" accept=".png,.jpg,.jpeg" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setA('photoFile', f); }} />
              <label htmlFor="photo-upload" className={`mt-1 flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all ${applicant.photoFile ? 'border-emerald-400 bg-emerald-50' : fieldErrors.photoFile ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50'}`}>
                {applicant.photoFile
                  ? <><CheckCircle className="w-8 h-8 text-emerald-500" /><span className="text-xs font-bold text-emerald-700 text-center truncate max-w-full">{applicant.photoFile.name}</span></>
                  : <><UploadCloud className="w-7 h-7 text-slate-300" /><span className="text-xs font-semibold text-slate-400">انقر لاختيار صورة</span><span className="text-xs text-slate-300">PNG / JPG</span></>}
              </label>
            </Field>
          </div>
          <div className="md:col-span-1 lg:col-span-2">
            <Field label="السيرة الذاتية" hint="اختياري">
              <input type="file" id="cv-upload" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { if (f.size > 4 * 1024 * 1024) alert('حد أقصى 4MB'); else setA('cvFile', f); } }} />
              <label htmlFor="cv-upload" className={`mt-1 flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all ${applicant.cvFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50'}`}>
                {applicant.cvFile
                  ? <><File className="w-8 h-8 text-emerald-500" /><span className="text-xs font-bold text-emerald-700 truncate max-w-full">{applicant.cvFile.name}</span></>
                  : <><UploadCloud className="w-7 h-7 text-slate-300" /><span className="text-xs font-semibold text-slate-400">سيرة ذاتية</span><span className="text-xs text-slate-300">PDF / DOC — حد أقصى 4MB</span></>}
              </label>
            </Field>
          </div>
        </SectionCard>

        {/* ─── SECTION 6: Referrer ─── */}
        <AnimatePresence>
          {submissionType === 'Refer a Candidate' && referrer.isReferrer && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <SectionCard num={6} title="بيانات الوسيط" subtitle="نفس منطق الوسيط المعتمد في الزبون" icon={UserPlus} colorKey={6}>
                <Field label="نوع الوسيط" required error={fieldErrors.referrer_type}>
                  <Select<ReferralType>
                    value={referrer.type}
                    onChange={handleReferrerTypeChange}
                    ariaLabel="نوع الوسيط"
                    className="w-full"
                    options={[
                      { value: 'Personal', label: 'شخصي' },
                      { value: 'Unknown', label: 'مجهول' },
                      { value: 'Employee', label: 'موظف' },
                      { value: 'Client', label: 'زبون' },
                    ]}
                  />
                </Field>
                <Field label="طريقة التواصل" required>
                  <Select<ReferralOriginChannel>
                    value={referrer.sourceChannel}
                    onChange={v => setR('sourceChannel', v)}
                    ariaLabel="طريقة التواصل"
                    className="w-full"
                    options={referralOriginChannels.map(channel => ({ value: channel.value, label: channel.label }))}
                  />
                </Field>
                {referrer.type === 'Employee' ? (
                  <>
                    <Field label="رقم الموظف" required error={fieldErrors.referrer_employeeId}>
                      <div className="flex gap-2">
                        <input value={referrer.employeeId} onChange={e => setR('employeeId', e.target.value)} className={inputCls(!!fieldErrors.referrer_employeeId)} placeholder="Emp-ID" />
                        <button type="button" onClick={handleEmployeeLookup} className="px-4 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5">
                          <Search className="w-3.5 h-3.5" /> جلب
                        </button>
                      </div>
                    </Field>
                    <Field label="اسم الموظف">
                      <input disabled value={referrer.fullName || (employeeFound ? formatEmployeeMediatorLabel(employeeFound) : '')} className={inputCls() + " bg-slate-50 text-slate-400 cursor-not-allowed"} placeholder="يعبأ تلقائياً" />
                    </Field>
                  </>
                ) : referrer.type === 'Client' ? (
                  <>
                    <div className="md:col-span-2 lg:col-span-3 relative">
                      <Field label="البحث عن الزبون الوسيط" required error={fieldErrors.referrer_fullName}>
                        <input value={clientSearch} onChange={e => handleClientSearch(e.target.value)} className={inputCls(!!fieldErrors.referrer_fullName)} placeholder="ابحث بالاسم أو رقم الموبايل" />
                      </Field>
                      {clientSuggestions.length > 0 && (
                        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden max-h-64 overflow-y-auto">
                          {clientSuggestions.map(client => (
                            <button key={client.id} type="button" onClick={() => handleSelectClient(client)} className="w-full text-right px-4 py-3 hover:bg-sky-50 border-b border-slate-100 last:border-b-0">
                              <div className="font-bold text-slate-800">{client.name}</div>
                              <div className="text-xs text-slate-400">{client.mobile || client.contacts?.find(c => c.isPrimary)?.number || client.contacts?.[0]?.number || '--'}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="اسم الوسيط">
                      <input readOnly value={referrer.fullName} className={inputCls() + " bg-slate-50 text-slate-400"} placeholder={referrer.type === 'Personal' ? 'شخصي' : 'مجهول'} />
                    </Field>
                  </>
                )}

                <div className="mt-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-bold text-slate-500 mb-1.5 mr-1">ملاحظات الوسيط</label>
                  <ReactQuill
                    theme="snow"
                    value={referrer.referrerNotes}
                    onChange={(value) => setR('referrerNotes', value)}
                    className="bg-white rounded-xl overflow-hidden"
                  />
                </div>
              </SectionCard>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* ─── Sticky Footer ─── */}
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }}
        className="fixed bottom-0 inset-x-0 z-50 bg-white/90 backdrop-blur-xl border-t border-slate-200 shadow-xl"
      >
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-slate-500 min-w-0">
            {errCount > 0 ? (
              <><div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center shrink-0"><AlertTriangle className="w-4 h-4 text-red-500" /></div><span className="text-xs font-bold text-red-600 truncate">{errCount} حقل يحتاج مراجعة</span></>
            ) : (
              <><div className="w-7 h-7 bg-sky-50 rounded-lg flex items-center justify-center shrink-0"><Info className="w-4 h-4 text-sky-500" /></div><span className="text-xs font-medium text-slate-400 truncate">تحقق من صحة البيانات قبل الحفظ</span></>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => navigate('/jobs/applications')} className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all">
              إلغاء
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-7 py-2.5 text-sm font-bold bg-gradient-to-l from-violet-600 to-sky-500 text-white rounded-xl shadow-lg hover:shadow-sky-500/30 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:pointer-events-none">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? 'جاري الحفظ...' : 'حفظ وتسجيل الطلب'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
