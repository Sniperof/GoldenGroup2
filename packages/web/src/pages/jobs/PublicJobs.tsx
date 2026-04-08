import { useState, useEffect } from 'react';
import { uploadFile } from '../../lib/uploadFile';
import type { JobVacancy, GeoUnit } from '../../lib/types';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import GeoSmartSearch, { GeoSelection } from '../../components/GeoSmartSearch';
import {
  ChevronRight, Search, Briefcase, MapPin, Users, GraduationCap,
  Calendar, Car, PartyPopper, AlertTriangle, X, User, CheckCircle,
  Phone, Home, BookOpen, Monitor, Globe, DollarSign, Send, Info, Loader2,
  File, UploadCloud, Paperclip
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
  computerSkills: string; 
  foreignLanguages: string[];
  yearsOfExperience: string; applicantSegment: string;
  specialization: string;
  hasWhatsappPrimary: boolean;
  hasWhatsappSecondary: boolean;
}

interface ReferrerForm {
  type: 'Employee' | 'Customer'; employeeId: string;
  fullName: string; lastName: string; mobileNumber: string;
  geoSelection: GeoSelection;
  detailedAddress: string;
  referrerWork: string; referrerNotes: string;
  isReferrer: boolean;
}

const emptyApplicant: ApplicantForm = {
  firstName: '', lastName: '', dob: '', gender: '', maritalStatus: '',
  email: '', mobileNumber: '', secondaryMobile: '',
  geoSelection: { govId: '', regionId: '', subId: '', neighborhoodId: '' }, detailedAddress: '',
  cvUrl: '', photoUrl: '', cvFile: null, photoFile: null,
  academicQualification: '', previousEmployment: '',
  drivingLicense: '', expectedSalary: '',
  computerSkills: '', foreignLanguages: [],
  yearsOfExperience: '', applicantSegment: '',
  specialization: '', hasWhatsappPrimary: false, hasWhatsappSecondary: false,
};

const emptyReferrer: ReferrerForm = {
  isReferrer: false, type: 'Employee', employeeId: '', fullName: '', lastName: '',
  mobileNumber: '', geoSelection: { govId: '', regionId: '', subId: '', neighborhoodId: '' },
  detailedAddress: '', referrerWork: '', referrerNotes: '',
};

const COMMON_LANGUAGES = ['الإنجليزية', 'الفرنسية', 'الكردية', 'التركية', 'الألمانية'];

// --- Styled Components (Internal Helpers) ---

const cardCls = "bg-white/80 backdrop-blur-sm rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/40 p-6";
const inputCls = (hasError?: boolean) => `w-full bg-slate-50/50 border ${hasError ? 'border-red-400 focus:border-red-500 focus:ring-red-500/10' : 'border-slate-200 focus:border-sky-500 focus:ring-sky-500/10'} rounded-2xl px-4 py-3 text-sm transition-all focus:ring-4 focus:bg-white outline-none flex items-center gap-2`;
const labelCls = "block text-xs font-bold text-slate-500 mb-1.5 mr-1";
const errorCls = "text-xs text-red-500 mt-1 flex items-center gap-1";

function FormSection({ title, subtitle, num, icon: Icon, children, delay = 0, className = "" }: { title: string; subtitle?: string; num: number; icon?: any; children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5 }} className={`${cardCls} ${className}`}>
      <div className="flex items-center gap-4 mb-6 border-b border-slate-100 pb-4">
        <div className="w-10 h-10 rounded-2xl bg-sky-50 text-sky-500 flex items-center justify-center font-black text-lg shrink-0">
          {num}
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            {title}
            {Icon && <Icon className="w-4 h-4 text-slate-400" />}
          </h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {children}
      </div>
    </motion.div>
  );
}

function Field({ label, error, required, children, className = "" }: { label: string; error?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={labelCls}>{label} {required && <span className="text-red-500">*</span>}</label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={errorCls}>
            <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Main Form Component ---

export default function PublicJobs() {
  const { fetchLists, getValuesByCategory } = useSystemListsStore();

  const [vacancies, setVacancies] = useState<JobVacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  
  // Settings
  const [selectedVacancy, setSelectedVacancy] = useState<JobVacancy | null>(null);
  const [submissionType, setSubmissionType] = useState<'Apply' | 'Refer a Candidate'>('Apply');

  // Forms
  const [applicant, setApplicant] = useState<ApplicantForm>({ ...emptyApplicant });
  const [referrer, setReferrer] = useState<ReferrerForm>({ ...emptyReferrer });

  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitResult, setSubmitResult] = useState<{ type: 'success' | 'error' | 'duplicate' | 'network', message: string, id?: number } | null>(null);

  useEffect(() => {
    fetchLists();
    fetch('/api/public/vacancies')
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setVacancies(data); setLoading(false); })
      .catch((e) => { console.error(e); setLoading(false); });

    fetch('/api/geo-units')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setGeoUnits(data); })
      .catch(console.error);
  }, []);

  const filteredVacancies = vacancies.filter(v =>
    v.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.branch || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const setA = (key: keyof ApplicantForm, val: any) => {
    setApplicant(p => ({ ...p, [key]: val }));
    if (fieldErrors[key]) setFieldErrors(p => { const n = { ...p }; delete n[key]; return n; });
  };
  const setR = (key: keyof ReferrerForm, val: any) => {
    setReferrer(p => ({ ...p, [key]: val }));
    if (fieldErrors[`referrer_\${key}`]) setFieldErrors(p => { const n = { ...p }; delete n[`referrer_\${key}`]; return n; });
  };

  const handleNameInput = (val: string, key: 'firstName' | 'lastName') => {
    const cleaned = val.replace(/[0-9!@#$%^&*()_+=[\]{};':"\\\\|,.<>/?]/g, '');
    setA(key, cleaned);
  };

  const handleReferrerNameInput = (val: string, key: 'fullName' | 'lastName') => {
    const cleaned = val.replace(/[0-9!@#$%^&*()_+=[\]{};':"\\\\|,.<>/?]/g, '');
    setR(key, cleaned);
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
    if (!selectedVacancy) e.vacancy = 'يجب اختيار الشاغر';
    
    // Personal (Section 1)
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

    // Address (Section 2)
    if (!applicant.geoSelection.govId) e.geoSelection = 'المحافظة مطلوبة';
    if (!applicant.geoSelection.regionId) e.geoSelection = 'المنطقة مطلوبة';
    if (!applicant.geoSelection.subId) e.geoSelection = 'الناحية مطلوبة';
    if (!applicant.geoSelection.neighborhoodId) e.geoSelection = 'الحي مطلوب';
    if (!applicant.detailedAddress.trim()) e.detailedAddress = 'العنوان التفصيلي مطلوب';

    // Contact (Section 3)
    if (!applicant.mobileNumber.trim()) e.mobileNumber = 'رقم الموبايل الرئيسي مطلوب';
    else if (!/^\d{10}$/.test(applicant.mobileNumber)) e.mobileNumber = 'يجب أن يتكون من 10 أرقام فقط (مثال: 07XXXXXXXX)';

    if (applicant.secondaryMobile.trim() && !/^\d{10}$/.test(applicant.secondaryMobile)) {
      e.secondaryMobile = 'يجب أن يتكون من 10 أرقام فقط';
    }

    // Qualifications (Section 4)
    if (!applicant.academicQualification) e.academicQualification = 'الشهادة العلمية مطلوبة';
    if (!applicant.previousEmployment.trim()) e.previousEmployment = 'العمل السابق مطلوب (أو "لا يوجد")';
    if (!applicant.drivingLicense) e.drivingLicense = 'يرجى تحديد حالة شهادة القيادة';
    if (!applicant.expectedSalary) e.expectedSalary = 'الراتب المتوقع مطلوب';
    if (!applicant.computerSkills.trim()) e.computerSkills = 'مهارات الحاسب مطلوبة';
    if (applicant.foreignLanguages.length === 0) e.foreignLanguages = 'مطلوب لغة واحدة على الأقل. اختر لا يوجد إن لزم.';
    if (!applicant.yearsOfExperience || parseInt(applicant.yearsOfExperience) < 0) e.yearsOfExperience = 'مطلوبة (أرقام فقط)';

    // Attachments (Section 5)
    if (!applicant.photoFile && !applicant.photoUrl) e.photoFile = 'الصورة الشخصية مطلوبة';

    // Referrer (Section 6)
    if (submissionType === 'Refer a Candidate' && referrer.isReferrer) {
      if (!referrer.type) e.referrer_type = 'مطلوب';
      
      if (referrer.type === 'Employee') {
        if (!referrer.employeeId.trim()) e.referrer_employeeId = 'رقم الموظف مطلوب';
      } else {
        if (!referrer.fullName.trim()) e.referrer_fullName = 'اسم الوسيط مطلوب';
        if (!referrer.lastName.trim()) e.referrer_lastName = 'الكنية مطلوبة';
        if (!referrer.mobileNumber.trim() || !/^\d{10}$/.test(referrer.mobileNumber)) e.referrer_mobileNumber = '10 أرقام فقط';
        if (!referrer.geoSelection.neighborhoodId) e.referrer_geoSelection = 'موقع الوسيط مطلوب بالكامل';
        if (!referrer.detailedAddress.trim()) e.referrer_detailedAddress = 'العنوان التفصيلي مطلوب';
        if (!referrer.referrerWork.trim()) e.referrer_referrerWork = 'مهنة الوسيط مطلوبة';
      }
    }

    setFieldErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    return true;
  };

  const handleEmployeeLookup = async () => {
    if (!referrer.employeeId) return;
    setR('fullName', 'موظف تجريبي ' + referrer.employeeId);
    setR('mobileNumber', '0799999999');
  };


  const translateServerError = (status: number, message: string): {
    type: 'error' | 'duplicate' | 'network'; text: string;
  } => {
    if (status === 409) return { type: 'duplicate', text: 'لديك طلب توظيف نشط مسبقاً لهذه الوظيفة.' };
    if (status === 404) return { type: 'error', text: 'هذه الوظيفة لم تعد متاحة.' };
    return { type: 'error', text: message || 'حدث خطأ أثناء معالجة طلبك.' };
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

      const finalGov = getGeoName(applicant.geoSelection.govId);
      const finalCity = getGeoName(applicant.geoSelection.regionId);
      const finalSub = getGeoName(applicant.geoSelection.subId);
      const finalNeigh = getGeoName(applicant.geoSelection.neighborhoodId);

      let finalPhotoUrl = applicant.photoUrl;
      let finalCvUrl = applicant.cvUrl;

      if (applicant.photoFile) finalPhotoUrl = await uploadFile(applicant.photoFile);
      if (applicant.cvFile) finalCvUrl = await uploadFile(applicant.cvFile);
      // photoUrl stays null/empty if no file selected (validation above catches it)

      const payload: any = {
        jobVacancyId: selectedVacancy!.id,
        submissionType,
        applicationSource: 'Website',
        applicant: {
          firstName: applicant.firstName.trim(),
          lastName: applicant.lastName.trim(),
          dob: applicant.dob,
          gender: applicant.gender,
          maritalStatus: applicant.maritalStatus,
          email: applicant.email.trim() || null,
          mobileNumber: applicant.mobileNumber.trim(),
          secondaryMobile: applicant.secondaryMobile.trim() || null,
          governorate: finalGov,
          cityOrArea: finalCity,
          subArea: finalSub,
          neighborhood: finalNeigh,
          detailedAddress: applicant.detailedAddress.trim(),
          cvUrl: finalCvUrl || null,
          photoUrl: finalPhotoUrl,
          academicQualification: applicant.academicQualification.trim(),
          specialization: applicant.specialization.trim() || null,
          previousEmployment: applicant.previousEmployment.trim(),
          drivingLicense: applicant.drivingLicense === 'yes',
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
          employeeId: referrer.employeeId ? parseInt(referrer.employeeId) : null,
          fullName: referrer.fullName.trim() || null,
          lastName: referrer.lastName.trim() || null,
          mobileNumber: referrer.mobileNumber.trim() || null,
          governorate: getGeoName(referrer.geoSelection.govId) || null,
          cityOrArea: getGeoName(referrer.geoSelection.regionId) || null,
          subArea: getGeoName(referrer.geoSelection.subId) || null,
          neighborhood: getGeoName(referrer.geoSelection.neighborhoodId) || null,
          detailedAddress: referrer.detailedAddress.trim() || null,
          referrerWork: referrer.referrerWork.trim() || null,
          referrerNotes: referrer.referrerNotes.trim() || null,
        };
      }

      const res = await fetch('/api/public/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        const { type, text } = translateServerError(res.status, result.error || 'حدث خطأ أثناء حفظ الطلب');
        throw new Error(JSON.stringify({ type, text }));
      }
      
      setSubmitResult({ type: 'success', message: 'تم تقديم طلبك بنجاح! سيتم مراجعته من قبل فريق الموارد البشرية.', id: result.id });
      setApplicant({ ...emptyApplicant });
      setReferrer({ ...emptyReferrer });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      try {
        const data = JSON.parse(err.message);
        setSubmitResult({ type: data.type, message: data.text });
      } catch {
        setSubmitResult({ type: 'network', message: 'تعذّر الوصول إلى الخادم. يرجى المحاولة مجدداً.' });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  const selectVacancy = (v: JobVacancy) => {
    setSelectedVacancy(v);
    setSubmitResult(null);
    setFieldErrors({});
    setApplicant({ ...emptyApplicant });
    setReferrer({ ...emptyReferrer });
  };

  const genderOpts = getValuesByCategory('gender');
  const maritalOpts = getValuesByCategory('marital_status');
  const qualOpts = getValuesByCategory('academic_qualification');
  const majorOpts = getValuesByCategory('major:' + applicant.academicQualification);
  const langOpts = getValuesByCategory('foreign_language').length > 0 ? getValuesByCategory('foreign_language') : COMMON_LANGUAGES;

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">الوظائف المتاحة</h1>
        <p className="text-slate-500">تصفح الشواغر الوظيفية المتاحة وقدّم طلبك الآن</p>
      </div>

      {!selectedVacancy ? (
        <>
          <div className="max-w-xl mx-auto mb-6">
            <div className="relative">
              <Search className="w-5 h-5 absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl pr-12 pl-4 py-3.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500" placeholder="ابحث عن وظيفة..." />
            </div>
          </div>
          {loading ? (
            <div className="text-center py-16 text-slate-400">
               <div className="animate-spin w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full mx-auto mb-3" />
               جاري التحميل...
            </div>
          ) : filteredVacancies.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
               <Briefcase className="w-16 h-16 mx-auto mb-4 opacity-20" />
               <p className="text-lg">لا توجد شواغر وظيفية متاحة حالياً</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
              {filteredVacancies.map(v => (
                <motion.div key={v.id} whileHover={{ y: -4, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }} className="bg-white rounded-2xl border border-slate-200 p-5 cursor-pointer transition-all hover:border-sky-300" onClick={() => selectVacancy(v)}>
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-base font-bold text-slate-800 leading-snug">{v.title}</h3>
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold shrink-0 mr-2">مفتوحة</span>
                  </div>
                  <div className="space-y-2 text-sm text-slate-500">
                    {v.branch && <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{v.branch}</div>}
                    {(v.requiredAgeMin || v.requiredAgeMax) && (
                      <div className="flex items-center gap-2"><Users className="w-3.5 h-3.5" />العمر: {v.requiredAgeMin || '—'} - {v.requiredAgeMax || '—'} سنة</div>
                    )}
                    {v.requiredCertificate && (
                      <div className="flex items-center gap-2"><GraduationCap className="w-3.5 h-3.5" />{v.requiredCertificate}</div>
                    )}
                    {v.requiredMajor && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">{v.requiredMajor}</div>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{v.startDate ? new Date(v.startDate).toLocaleDateString('ar-IQ') : '—'}</span>
                    {v.drivingLicenseRequired && <span className="flex items-center gap-1 text-amber-500"><Car className="w-3 h-3" />رخصة قيادة</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="max-w-4xl mx-auto pb-32">
          <button onClick={() => setSelectedVacancy(null)} className="mb-4 text-sm text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1">
            <ChevronRight className="w-4 h-4" /> العودة إلى قائمة الوظائف
          </button>

          <AnimatePresence>
            {submitResult?.type === 'success' && (
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 border border-emerald-200 rounded-2xl p-10 text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <PartyPopper className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-bold text-emerald-800 mb-2">تم تقديم طلبك بنجاح!</h2>
                <p className="text-emerald-700 text-sm mb-1">{submitResult.message}</p>
                {submitResult.id && <p className="text-xs text-emerald-600 mt-2">رقم الطلب: <span className="font-bold">#{submitResult.id}</span></p>}
                <button onClick={() => { setSelectedVacancy(null); setSubmitResult(null); }} className="mt-6 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all">
                  العودة إلى قائمة الوظائف
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {submitResult?.type !== 'success' && (
            <div className="space-y-8">
              <div className="bg-gradient-to-l from-sky-50 to-indigo-50 rounded-2xl border border-sky-200 p-5 mb-6">
                <h2 className="text-lg font-bold text-slate-800 mb-1">{selectedVacancy.title}</h2>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                  {selectedVacancy.branch && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{selectedVacancy.branch}</span>}
                  {selectedVacancy.requiredCertificate && <span className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5" />{selectedVacancy.requiredCertificate}{selectedVacancy.requiredMajor ? ` - ${selectedVacancy.requiredMajor}` : ''}</span>}
                </div>
              </div>

              {submitResult && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  className={`bg-red-50 border-l-4 border-red-500 rounded-2xl p-4 mb-8 flex items-center gap-4 text-sm shadow-sm \${submitResult.type === 'duplicate' ? 'text-amber-700 border-amber-500 bg-amber-50' : 'text-red-700 shadow-red-100'}`}>
                  <div className={`p-2 rounded-xl \${submitResult.type === 'duplicate' ? 'bg-amber-100' : 'bg-red-100'}`}><AlertTriangle className="w-5 h-5" /></div>
                  <div className="flex-1 font-bold">{submitResult.message}</div>
                </motion.div>
              )}

              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 mb-8">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                  <div className="p-2 bg-sky-50 rounded-xl text-sky-500"><User className="w-5 h-5" /></div>
                  <h3 className="text-base font-bold text-slate-800">إعدادات توجيه الطلب</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Field label="نوع التقديم" required>
                    <select value={submissionType} onChange={e => setSubmissionType(e.target.value as any)} className={inputCls()}>
                      <option value="Apply">تقديم شخصي</option>
                      <option value="Refer a Candidate">تقديم نيابة عن مرشح (كوسيط)</option>
                    </select>
                  </Field>
                </div>
                <AnimatePresence>
                  {submissionType === 'Refer a Candidate' && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-4 pt-4 border-t border-slate-100 overflow-hidden">
                      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 px-4 py-3 rounded-2xl cursor-pointer" onClick={() => setR('isReferrer', !referrer.isReferrer)}>
                        <input type="checkbox" checked={referrer.isReferrer} readOnly className="w-5 h-5 rounded border-amber-300 text-amber-500 focus:ring-amber-500 pointer-events-none" />
                        <span className="font-bold text-sm text-amber-800 pointer-events-none">إدراج بياناتي كوسيط لهذا الطلب</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Form Sections (1 to 6) */}
              <FormSection num={1} title="البيانات الشخصية" subtitle="أدخل معلومات المتقدم الرئيسية" icon={User} delay={0.1}>
                <Field label="الاسم الأول" required error={fieldErrors.firstName}><input value={applicant.firstName} onChange={e => handleNameInput(e.target.value, 'firstName')} className={inputCls(!!fieldErrors.firstName)} /></Field>
                <Field label="الكنية" required error={fieldErrors.lastName}><input value={applicant.lastName} onChange={e => handleNameInput(e.target.value, 'lastName')} className={inputCls(!!fieldErrors.lastName)} /></Field>
                <Field label="تاريخ الميلاد" required error={fieldErrors.dob}><input type="date" value={applicant.dob} onChange={e => setA('dob', e.target.value)} max={new Date().toISOString().split('T')[0]} className={inputCls(!!fieldErrors.dob)} /></Field>
                <Field label="الجنس" required error={fieldErrors.gender}>
                  <select value={applicant.gender} onChange={e => setA('gender', e.target.value)} className={inputCls(!!fieldErrors.gender)}>
                    <option value="">اختر</option>
                    {genderOpts.length ? genderOpts.map(v => <option key={v} value={v}>{v}</option>) : <><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></>}
                  </select>
                </Field>
                <Field label="الحالة الاجتماعية" required error={fieldErrors.maritalStatus} className="md:col-span-2 lg:col-span-2">
                  <select value={applicant.maritalStatus} onChange={e => setA('maritalStatus', e.target.value)} className={inputCls(!!fieldErrors.maritalStatus)}>
                    <option value="">اختر</option>
                    {maritalOpts.length ? maritalOpts.map(v => <option key={v} value={v}>{v}</option>) : <><option value="أعزب">أعزب</option><option value="متزوج">متزوج</option><option value="مطلق">مطلق</option><option value="أرمل">أرمل</option></>}
                  </select>
                </Field>
              </FormSection>

              <FormSection num={2} title="عنوان السكن" subtitle="يتم التحديد حصراً عبر نظام البحث الجغرافي" icon={MapPin} delay={0.2}>
                <div className={`md:col-span-2 lg:col-span-2 bg-slate-50/50 border ${fieldErrors.geoSelection ? 'border-red-400' : 'border-slate-200'} rounded-2xl p-4`}>
                  <GeoSmartSearch label="التسلسل الهرمي للمنطقة" required geoUnits={geoUnits} value={applicant.geoSelection} onChange={v => { setA('geoSelection', v); delete fieldErrors.geoSelection; }} placeholder="المحافظة > المنطقة > الناحية > الحي" />
                  {fieldErrors.geoSelection && <p className={errorCls}><AlertTriangle className="w-3 h-3"/> {fieldErrors.geoSelection}</p>}
                </div>
                <Field label="تفاصيل إضافية للعنوان" required error={fieldErrors.detailedAddress} className="lg:col-span-1">
                  <textarea value={applicant.detailedAddress} onChange={e => setA('detailedAddress', e.target.value)} className={inputCls(!!fieldErrors.detailedAddress) + " min-h-[96px] py-3 resize-none w-full"} placeholder="رقم الدار، أقرب نقطة دالة..." />
                </Field>
              </FormSection>

              <FormSection num={3} title="معلومات التواصل" subtitle="البريد الإلكتروني وأرقام الهاتف" icon={Phone} delay={0.3}>
                <Field label="البريد الإلكتروني" error={fieldErrors.email} className="md:col-span-2 lg:col-span-1">
                  <div className="relative">
                    <input type="email" value={applicant.email} onChange={e => setA('email', e.target.value)} className={inputCls(!!fieldErrors.email) + " pl-10"} dir="ltr" />
                  </div>
                </Field>
                <div className="flex flex-col gap-2">
                  <Field label="رقم الموبايل الرئيسي" required error={fieldErrors.mobileNumber}><input value={applicant.mobileNumber} onChange={e => setA('mobileNumber', e.target.value)} className={inputCls(!!fieldErrors.mobileNumber) + " text-left text-lg font-mono"} dir="ltr" maxLength={10} placeholder="07XXXXXXXX" /></Field>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 mt-1 cursor-pointer">
                    <input type="checkbox" checked={applicant.hasWhatsappPrimary} onChange={e => setA('hasWhatsappPrimary', e.target.checked)} className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                    الرقم يدعم واتساب
                  </label>
                </div>
                <div className="flex flex-col gap-2">
                  <Field label="رقم بديل (اختياري)" error={fieldErrors.secondaryMobile}><input value={applicant.secondaryMobile} onChange={e => setA('secondaryMobile', e.target.value)} className={inputCls(!!fieldErrors.secondaryMobile) + " text-left text-lg font-mono"} dir="ltr" maxLength={10} placeholder="07XXXXXXXX" /></Field>
                  {applicant.secondaryMobile.trim() && (
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 mt-1 cursor-pointer">
                      <input type="checkbox" checked={applicant.hasWhatsappSecondary} onChange={e => setA('hasWhatsappSecondary', e.target.checked)} className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                      الرقم البديل يدعم واتساب
                    </label>
                  )}
                </div>
              </FormSection>

              <FormSection num={4} title="المؤهلات" subtitle="المؤهلات العلمية والمهارات والخبرة" icon={GraduationCap} delay={0.4}>
                <Field label="الشهادة العلمية" required error={fieldErrors.academicQualification}>
                  <select value={applicant.academicQualification} onChange={e => { setA('academicQualification', e.target.value); setA('specialization', ''); }} className={inputCls(!!fieldErrors.academicQualification)}>
                    <option value="">اختر</option>
                    {qualOpts.length ? qualOpts.map(v => <option key={v} value={v}>{v}</option>) : <><option value="إعدادية">إعدادية</option><option value="بكالوريوس">بكالوريوس</option><option value="ماجستير">ماجستير</option><option value="دكتوراه">دكتوراه</option></>}
                  </select>
                </Field>
                <Field label="الاختصاص" error={fieldErrors.specialization}>
                  {(majorOpts.length > 0) ? (
                    <select value={applicant.specialization} onChange={e => setA('specialization', e.target.value)} className={inputCls()}>
                      <option value="">-- اختر الاختصاص --</option>
                      {majorOpts.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={applicant.specialization} onChange={e => setA('specialization', e.target.value)} className={inputCls()} placeholder="أدخل نوع الاختصاص" />
                  )}
                </Field>
                <Field label="سنوات الخبرة" required error={fieldErrors.yearsOfExperience}>
                  <input type="number" min="0" value={applicant.yearsOfExperience} onChange={e => setA('yearsOfExperience', e.target.value)} className={inputCls(!!fieldErrors.yearsOfExperience)} placeholder="مثال: 0 للإشارة لحديث التخرج" />
                </Field>
                <Field label="العمل السابق" required error={fieldErrors.previousEmployment}>
                  <input value={applicant.previousEmployment} onChange={e => setA('previousEmployment', e.target.value)} maxLength={150} className={inputCls(!!fieldErrors.previousEmployment)} placeholder="آخر مكان عمل أو 'لا يوجد'" />
                </Field>
                <Field label="الراتب المتوقع (ل.س)" required error={fieldErrors.expectedSalary}>
                  <input type="number" min="0" value={applicant.expectedSalary} onChange={e => setA('expectedSalary', e.target.value)} className={inputCls(!!fieldErrors.expectedSalary)} placeholder="أرقام فقط" />
                </Field>
                <Field label="مهارات الحاسب" required error={fieldErrors.computerSkills}>
                  <input value={applicant.computerSkills} onChange={e => setA('computerSkills', e.target.value)} className={inputCls(!!fieldErrors.computerSkills)} placeholder="نص قصير..." />
                </Field>
                <Field label="شهادة القيادة" required error={fieldErrors.drivingLicense} className="flex flex-col justify-center">
                  <div className="flex items-center gap-6 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dl" checked={applicant.drivingLicense === 'yes'} onChange={() => setA('drivingLicense', 'yes')} className="w-4 h-4 text-sky-500" />
                      <span className="text-sm font-semibold text-slate-700">نعم، يوجد</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dl" checked={applicant.drivingLicense === 'no'} onChange={() => setA('drivingLicense', 'no')} className="w-4 h-4 text-sky-500" />
                      <span className="text-sm font-semibold text-slate-700">لا يوجد</span>
                    </label>
                  </div>
                </Field>
                <Field label="لغات أجنبية (اختيار متعدد)" required error={fieldErrors.foreignLanguages} className="md:col-span-2 lg:col-span-3">
                  <div className="flex flex-wrap gap-2 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                    {langOpts.map(lang => (
                      <button key={lang} type="button" onClick={() => toggleLanguage(lang)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors \${applicant.foreignLanguages.includes(lang) ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-500 border-slate-300'}`}>
                        {lang}
                      </button>
                    ))}
                  </div>
                </Field>
              </FormSection>

              <FormSection num={5} title="المرفقات" subtitle="ملفات الوثائق الثبوتية وصورة المتقدم" icon={Paperclip} delay={0.5}>
                 <div className="lg:col-span-1">
                   <Field label="صورة شخصية (PNG/JPG)" required error={fieldErrors.photoFile}>
                     <div className={`mt-1 border-2 border-dashed rounded-2xl p-6 text-center \${applicant.photoFile ? 'border-emerald-400 bg-emerald-50' : fieldErrors.photoFile ? 'border-red-300 bg-red-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                       <input type="file" id="photo-upload" accept=".png,.jpg,.jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if(f) setA('photoFile', f); }} />
                       <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center gap-2">
                         {applicant.photoFile ? <><CheckCircle className="w-8 h-8 text-emerald-500" /><span className="text-sm font-bold truncate">{applicant.photoFile.name}</span></> : <><UploadCloud className="w-8 h-8 text-sky-400" /><span className="text-sm font-bold text-slate-600">انقر لاختيار صورة</span></>}
                       </label>
                     </div>
                   </Field>
                 </div>
                 <div className="md:col-span-1 lg:col-span-2">
                   <Field label="السيرة الذاتية CV (اختياري)">
                     <div className={`mt-1 border-2 border-dashed rounded-2xl p-6 text-center \${applicant.cvFile ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                       <input type="file" id="cv-upload" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if(f) { if (f.size > 4 * 1024 * 1024) alert('حد أقصى 4MB'); else setA('cvFile', f); } }} />
                       <label htmlFor="cv-upload" className="cursor-pointer flex flex-col items-center gap-2">
                         {applicant.cvFile ? <><File className="w-8 h-8 text-emerald-500" /><span className="text-sm font-bold truncate">{applicant.cvFile.name}</span></> : <><UploadCloud className="w-8 h-8 text-slate-400" /><span className="text-sm font-bold text-slate-600">السيرة الذاتية (PDF/DOC)</span></>}
                       </label>
                     </div>
                   </Field>
                 </div>
              </FormSection>

              <AnimatePresence>
                {submissionType === 'Refer a Candidate' && referrer.isReferrer && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-6">
                    <FormSection num={6} title="بيانات الوسيط" subtitle="تُعطى تلقائياً للموظف وإلا تعبأ للزبائن" className="border-amber-200">
                      <Field label="نوع الوسيط" required error={fieldErrors.referrer_type}>
                        <select value={referrer.type} onChange={e => { setR('type', e.target.value); setR('employeeId', ''); setR('fullName', ''); setR('lastName', ''); setR('mobileNumber', ''); }} className={inputCls(!!fieldErrors.referrer_type)}>
                          <option value="Employee">موظف (Employee)</option><option value="Customer">زبون (Customer)</option>
                        </select>
                      </Field>
                      {referrer.type === 'Employee' ? (
                        <>
                          <Field label="رقم الموظف" required error={fieldErrors.referrer_employeeId}>
                            <div className="flex gap-2">
                              <input value={referrer.employeeId} onChange={e => setR('employeeId', e.target.value)} className={inputCls(!!fieldErrors.referrer_employeeId)} placeholder="Emp-ID" />
                              <button type="button" onClick={handleEmployeeLookup} className="bg-sky-500 text-white px-4 rounded-xl font-bold">جلب</button>
                            </div>
                          </Field>
                          <Field label="اسم الموظف"><input readOnly value={referrer.fullName} className={inputCls() + " bg-slate-100 opacity-70"} placeholder="يعبأ تلقائياً" /></Field>
                          <Field label="رقم الجوال"><input readOnly value={referrer.mobileNumber} className={inputCls() + " bg-slate-100 opacity-70 text-left"} dir="ltr" placeholder="يعبأ تلقائياً" /></Field>
                        </>
                      ) : (
                        <>
                          <Field label="اسم الوسيط" required error={fieldErrors.referrer_fullName}><input value={referrer.fullName} onChange={e => handleReferrerNameInput(e.target.value, 'fullName')} className={inputCls(!!fieldErrors.referrer_fullName)} /></Field>
                          <Field label="الكنية" required error={fieldErrors.referrer_lastName}><input value={referrer.lastName} onChange={e => handleReferrerNameInput(e.target.value, 'lastName')} className={inputCls(!!fieldErrors.referrer_lastName)} /></Field>
                          <Field label="رقم موبايل الوسيط" required error={fieldErrors.referrer_mobileNumber}><input value={referrer.mobileNumber} onChange={e => setR('mobileNumber', e.target.value)} maxLength={10} className={inputCls(!!fieldErrors.referrer_mobileNumber) + " text-left"} dir="ltr" /></Field>
                          <div className={`md:col-span-2 lg:col-span-3 bg-slate-50 border \${fieldErrors.referrer_geoSelection ? 'border-red-400' : 'border-slate-200'} rounded-2xl p-4`}>
                            <GeoSmartSearch label="موقع الوسيط" required geoUnits={geoUnits} value={referrer.geoSelection} onChange={v => { setR('geoSelection', v); delete fieldErrors.referrer_geoSelection; }} />
                          </div>
                          <Field label="العنوان التفصيلي" required error={fieldErrors.referrer_detailedAddress}><input value={referrer.detailedAddress} onChange={e => setR('detailedAddress', e.target.value)} className={inputCls(!!fieldErrors.referrer_detailedAddress)} /></Field>
                          <Field label="مهنة الوسيط" required error={fieldErrors.referrer_referrerWork}><input value={referrer.referrerWork} onChange={e => setR('referrerWork', e.target.value)} className={inputCls(!!fieldErrors.referrer_referrerWork)} /></Field>
                          <Field label="ملاحظات الوسيط"><input value={referrer.referrerNotes} onChange={e => setR('referrerNotes', e.target.value)} className={inputCls()} /></Field>
                        </>
                      )}
                    </FormSection>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.6 }} className="flex flex-col sm:flex-row items-center justify-between p-6 bg-white/80 backdrop-blur-md border border-slate-200 rounded-[2rem] shadow-xl sticky bottom-6 z-10 gap-4">
                <div className="flex items-center gap-3 text-slate-500 w-full md:w-auto">
                  {Object.keys(fieldErrors).length > 0 ? (
                    <><AlertTriangle className="w-5 h-5 text-red-500" /><span className="text-sm font-bold text-red-600">هناك {Object.keys(fieldErrors).length} حقول تحتاج إلى تصحيح.</span></>
                  ) : (
                    <><Info className="w-5 h-5 text-sky-500" /><span className="text-sm font-medium">يرجى التأكد من دقة البيانات المُلزمة قبل الحفظ</span></>
                  )}
                </div>
                <div className="flex gap-4 w-full md:w-auto">
                  <button onClick={() => setSelectedVacancy(null)} className="flex-1 md:flex-none px-8 py-3.5 text-sm font-bold text-slate-600 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 transition-all">إلغاء</button>
                  <button onClick={handleSubmit} disabled={submitting} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-10 py-3.5 text-sm font-black bg-gradient-to-r from-emerald-500 to-sky-500 text-white rounded-2xl shadow-xl shadow-sky-500/30 hover:-translate-y-0.5 transition-all disabled:opacity-50">
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
                    {submitting ? 'جاري المعالجة...' : 'حفظ وتسجيل الطلب'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
