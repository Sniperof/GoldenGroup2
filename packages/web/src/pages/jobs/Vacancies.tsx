import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVacancyStore } from '../../hooks/useVacancyStore';
import type { JobVacancy, VacancyStatus, BranchContact, BranchContactType } from '../../lib/types';
import {
  Plus, Search, Filter, Edit, Archive, XCircle, Briefcase, Calendar,
  MapPin, GraduationCap, Users, ChevronDown, X, RotateCcw, Lock, Eye,
  Mail, Phone, Smartphone, Globe, PhoneCall, AlertTriangle, CheckCircle,
  ClipboardList, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PermissionGate from '../../components/PermissionGate';
import { useBranchStore } from '../../hooks/useBranchStore';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import GeoSmartSearch, { GeoSelection, getLevelName } from '../../components/GeoSmartSearch';
import { api } from '../../lib/api';
import type { GeoUnit } from '../../lib/types';

const STATUS_COLORS: Record<VacancyStatus, string> = {
  Open: 'bg-emerald-100 text-emerald-700',
  Closed: 'bg-red-100 text-red-700',
  Archived: 'bg-slate-100 text-slate-500',
};
const STATUS_LABELS: Record<VacancyStatus, string> = {
  Open: 'مفتوحة', Closed: 'مغلقة', Archived: 'مؤرشفة',
};

const CONTACT_ICONS: Record<BranchContactType, React.ElementType> = {
  email: Mail, phone: Phone, mobile: Smartphone, website: Globe,
};
const CONTACT_LABELS: Record<BranchContactType, string> = {
  email: 'بريد إلكتروني', phone: 'هاتف ثابت', mobile: 'موبايل', website: 'موقع إلكتروني',
};
const CONTACT_COLORS: Record<BranchContactType, string> = {
  email: 'bg-rose-100 text-rose-600',
  phone: 'bg-sky-100 text-sky-600',
  mobile: 'bg-emerald-100 text-emerald-700',
  website: 'bg-indigo-100 text-indigo-600',
};

const emptyVacancy: Partial<JobVacancy> = {
  title: '', branch: '', governorate: null, cityOrArea: null, subArea: null,
  neighborhood: null, detailedAddress: null, workType: null, requiredGender: null,
  requiredAgeMin: null, requiredAgeMax: null, contactMethods: [],
  requiredCertificate: null, requiredMajor: null,
  requiredExperienceYears: null, requiredSkills: null, responsibilities: null,
  drivingLicenseRequired: false, vacancyCount: 1,
  startDate: '', endDate: '',
};

export default function Vacancies() {
  const navigate = useNavigate();
  const {
    vacancies, filters, loading,
    fetchVacancies, setFilter, resetFilters,
    createVacancy, updateVacancy, updateVacancyStatus
  } = useVacancyStore();

  const [showModal, setShowModal] = useState(false);
  const [editingVacancy, setEditingVacancy] = useState<JobVacancy | null>(null);
  const [editTier, setEditTier] = useState<1 | 2 | 3>(1);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState<Partial<JobVacancy>>({ ...emptyVacancy });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const { branches, fetchBranches } = useBranchStore();
  const { fetchLists, getValuesByCategory } = useSystemListsStore();
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);
  const [branchContacts, setBranchContacts] = useState<BranchContact[]>([]);
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({
    govId: '', regionId: '', subId: '', neighborhoodId: ''
  });

  useEffect(() => {
    fetchVacancies();
    fetchBranches();
    fetchLists();
    api.geoUnits.list().then(setGeoUnits).catch(console.error);
  }, [filters.status, filters.branch, filters.search]);

  const setField = (key: string, value: any) => setFormData(prev => ({ ...prev, [key]: value }));

  const handleBranchChange = (branchName: string) => {
    setField('branch', branchName);
    setField('contactMethods', []);
    const branch = branches.find(b => b.name === branchName);
    if (branch) {
      setBranchContacts(branch.contactInfo || []);
      if (branch.locationGeoId) {
        const geoUnit = geoUnits.find(g => g.id === branch.locationGeoId);
        if (geoUnit) {
          const chain: Record<number, number> = {};
          let cur = geoUnit as typeof geoUnit | undefined;
          while (cur) {
            chain[cur.level] = cur.id;
            cur = cur.parentId ? geoUnits.find(g => g.id === cur!.parentId) : undefined;
          }
          setGeoSelection({
            govId: chain[1]?.toString() || '',
            regionId: chain[2]?.toString() || '',
            subId: chain[3]?.toString() || '',
            neighborhoodId: chain[4]?.toString() || '',
          });
        }
      }
    } else {
      setBranchContacts([]);
    }
  };

  const openCreate = () => {
    setEditingVacancy(null);
    setEditTier(1);
    setWizardStep(1);
    setFormData({ ...emptyVacancy });
    setBranchContacts([]);
    setGeoSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (v: JobVacancy) => {
    setEditingVacancy(v);
    setEditTier(1);
    setWizardStep(1);
    setFormData({ ...v });
    const branch = branches.find(b => b.name === v.branch);
    setBranchContacts(branch?.contactInfo || []);
    setGeoSelection({
      govId: geoUnits.find(u => u.name === v.governorate && u.level === 1)?.id.toString() || '',
      regionId: geoUnits.find(u => u.name === v.cityOrArea && u.level === 2)?.id.toString() || '',
      subId: geoUnits.find(u => u.name === v.subArea && u.level === 3)?.id.toString() || '',
      neighborhoodId: geoUnits.find(u => u.name === v.neighborhood && u.level === 4)?.id.toString() || '',
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (!formData.title?.trim()) { setFormError('عنوان الوظيفة مطلوب'); return; }
    if (!formData.branch?.trim()) { setFormError('الفرع مطلوب'); return; }
    if (!formData.vacancyCount || formData.vacancyCount <= 0) { setFormError('عدد الشواغر يجب أن يكون أكبر من 0'); return; }
    if (!formData.startDate) { setFormError('تاريخ البداية مطلوب'); return; }
    if (!formData.endDate) { setFormError('تاريخ النهاية مطلوب'); return; }
    if (formData.startDate > formData.endDate) { setFormError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية'); return; }

    const finalData = {
      ...formData,
      governorate: getLevelName(geoUnits, geoSelection.govId) || formData.governorate,
      cityOrArea: getLevelName(geoUnits, geoSelection.regionId) || formData.cityOrArea,
      subArea: getLevelName(geoUnits, geoSelection.subId) || formData.subArea,
      neighborhood: getLevelName(geoUnits, geoSelection.neighborhoodId) || formData.neighborhood,
    };

    setSaving(true);
    try {
      if (editingVacancy) {
        const result = await updateVacancy(editingVacancy.id, finalData);
        setEditTier(result.editTier as 1 | 2 | 3);
      } else {
        await createVacancy(finalData);
      }
      setShowModal(false);
      fetchVacancies();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id: number, status: 'Open' | 'Closed' | 'Archived') => {
    try { await updateVacancyStatus(id, status); fetchVacancies(); }
    catch (err: any) { alert(err.message); }
  };

  const isFieldLocked = (field: 'full' | 'partial') => {
    if (!editingVacancy) return false;
    if (field === 'full') return editTier >= 2;
    if (field === 'partial') return editTier >= 3;
    return false;
  };

  const inputCls = (locked: boolean) =>
    `w-full border rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-colors ${
      locked ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-100' : 'border-slate-200 bg-white'
    }`;

  const toggleContact = (contact: BranchContact, checked: boolean) => {
    const current = formData.contactMethods || [];
    setField('contactMethods', checked ? [...current, contact] : current.filter(c => c.id !== contact.id));
  };

  /* ─── WIZARD STEP CONTENT ─────────────────────────────────── */

  const Step1 = (
    <motion.div key="s1" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.22 }} className="space-y-4 pb-2">
      {/* Identity */}
      <div className="bg-gradient-to-br from-sky-50 to-indigo-50 border border-sky-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-sky-600 uppercase tracking-widest flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> هوية الوظيفة</p>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">عنوان الوظيفة <span className="text-red-400">*</span></label>
          <select value={formData.title || ''} onChange={e => setField('title', e.target.value)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))}>
            <option value="">اختر عنوان الوظيفة</option>
            {getValuesByCategory('job_title').map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الفرع <span className="text-red-400">*</span></label>
            <select value={formData.branch || ''} onChange={e => handleBranchChange(e.target.value)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))}>
              <option value="">اختر الفرع</option>
              {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">نوع العمل</label>
            <select value={formData.workType || ''} onChange={e => setField('workType', e.target.value || null)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))}>
              <option value="">اختر نوع العمل</option>
              {getValuesByCategory('work_type').map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> الموقع</p>
        <GeoSmartSearch label="الموقع الجغرافي" geoUnits={geoUnits} value={geoSelection} onChange={setGeoSelection} placeholder="يتم تعبئته تلقائياً عند اختيار الفرع..." disabled={isFieldLocked('full')} />
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">العنوان التفصيلي</label>
          <input value={formData.detailedAddress || ''} onChange={e => setField('detailedAddress', e.target.value || null)} placeholder="مثال: شارع الرشيد، بجانب مطعم..." disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
        </div>
      </div>

      {/* Contact Methods */}
      <div className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-violet-700 uppercase tracking-widest flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5" /> وسائل التواصل للنشر</p>
          {(formData.contactMethods || []).length > 0 && (
            <span className="text-[10px] bg-violet-500 text-white px-2 py-0.5 rounded-full font-bold">{(formData.contactMethods || []).length} مختارة</span>
          )}
        </div>
        {branchContacts.length > 0 ? (
          <div className="space-y-2">
            {branchContacts.map(contact => {
              const Icon = CONTACT_ICONS[contact.type];
              const isSelected = (formData.contactMethods || []).some(c => c.id === contact.id);
              return (
                <label key={contact.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150 ${isSelected ? 'border-violet-400 bg-white shadow-sm' : 'border-transparent bg-white/60 hover:bg-white hover:border-violet-200'}`}>
                  <input type="checkbox" checked={isSelected} disabled={isFieldLocked('partial')} onChange={e => toggleContact(contact, e.target.checked)} className="sr-only" />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isSelected ? 'bg-violet-500 border-violet-500' : 'border-slate-300'}`}>
                    {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 ${CONTACT_COLORS[contact.type]}`}>
                      <Icon className="w-3 h-3" /> {CONTACT_LABELS[contact.type]}
                    </span>
                    <span className="font-mono text-xs text-slate-700 truncate" dir="ltr">{contact.value}</span>
                    {contact.label && <span className="text-[10px] text-slate-400 truncate">— {contact.label}</span>}
                    <span className={`mr-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${contact.department === 'hr' ? 'bg-violet-100 text-violet-600' : contact.department === 'customer_service' ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-500'}`}>
                      {contact.department === 'hr' ? 'HR' : contact.department === 'customer_service' ? 'خدمة عملاء' : contact.department === 'management' ? 'إدارة' : 'أخرى'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center py-5 text-center">
            <PhoneCall className="w-7 h-7 text-violet-300 mb-2" />
            <p className="text-sm text-slate-500">{formData.branch ? 'لا توجد وسائل تواصل لهذا الفرع' : 'اختر الفرع أولاً'}</p>
          </div>
        )}
      </div>
    </motion.div>
  );

  const Step2 = (
    <motion.div key="s2" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.22 }} className="space-y-4 pb-2">
      {/* Profile */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-amber-700 uppercase tracking-widest flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> الملف الشخصي</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الجنس</label>
            <select value={formData.requiredGender || ''} onChange={e => setField('requiredGender', e.target.value || null)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))}>
              <option value="">لا يهم</option>
              {getValuesByCategory('gender').map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الحد الأدنى للعمر</label>
            <input type="number" placeholder="—" value={formData.requiredAgeMin ?? ''} onChange={e => setField('requiredAgeMin', e.target.value ? parseInt(e.target.value) : null)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الحد الأقصى للعمر</label>
            <input type="number" placeholder="—" value={formData.requiredAgeMax ?? ''} onChange={e => setField('requiredAgeMax', e.target.value ? parseInt(e.target.value) : null)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
          </div>
        </div>
        <label className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${formData.drivingLicenseRequired ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white hover:border-amber-200'}`}>
          <input type="checkbox" checked={formData.drivingLicenseRequired || false} onChange={e => setField('drivingLicenseRequired', e.target.checked)} disabled={isFieldLocked('full')} className="sr-only" />
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${formData.drivingLicenseRequired ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
            {formData.drivingLicenseRequired && <div className="w-2 h-2 bg-white rounded-full" />}
          </div>
          <span className="text-sm font-medium text-slate-700">يُشترط امتلاك رخصة قيادة</span>
        </label>
      </div>

      {/* Education */}
      <div className="bg-gradient-to-br from-sky-50 to-cyan-50 border border-sky-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-sky-700 uppercase tracking-widest flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> المؤهل والخبرة</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الشهادة العلمية</label>
            <select value={formData.requiredCertificate || ''} onChange={e => { setField('requiredCertificate', e.target.value || null); setField('requiredMajor', null); }} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))}>
              <option value="">اختر الشهادة</option>
              {getValuesByCategory('certificate').map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">الاختصاص</label>
            <select value={formData.requiredMajor || ''} onChange={e => setField('requiredMajor', e.target.value || null)} disabled={isFieldLocked('full') || !formData.requiredCertificate} className={inputCls(isFieldLocked('full') || !formData.requiredCertificate)}>
              <option value="">{formData.requiredCertificate ? 'اختر الاختصاص' : 'اختر الشهادة أولاً'}</option>
              {formData.requiredCertificate && getValuesByCategory(`major:${formData.requiredCertificate}`).map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">سنوات الخبرة المطلوبة</label>
          <div className="flex items-center gap-3">
            <input type="number" placeholder="0" min={0} value={formData.requiredExperienceYears ?? ''} onChange={e => setField('requiredExperienceYears', e.target.value ? parseInt(e.target.value) : null)} disabled={isFieldLocked('full')} className={`${inputCls(isFieldLocked('full'))} max-w-[120px]`} />
            <span className="text-sm text-slate-400">سنة فأكثر</span>
          </div>
        </div>
      </div>

      {/* Skills */}
      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> المهام والمهارات</p>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">المهارات المطلوبة</label>
          <textarea value={formData.requiredSkills || ''} onChange={e => setField('requiredSkills', e.target.value || null)} rows={2} placeholder="مثال: Excel، خدمة العملاء، اللغة الإنجليزية..." disabled={isFieldLocked('partial')} className={inputCls(isFieldLocked('partial'))} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">المسؤوليات والمهام</label>
          <textarea value={formData.responsibilities || ''} onChange={e => setField('responsibilities', e.target.value || null)} rows={2} placeholder="وصف مختصر للمهام الرئيسية..." disabled={isFieldLocked('partial')} className={inputCls(isFieldLocked('partial'))} />
        </div>
      </div>
    </motion.div>
  );

  const durationDays = formData.startDate && formData.endDate && formData.startDate <= formData.endDate
    ? Math.ceil((new Date(formData.endDate).getTime() - new Date(formData.startDate).getTime()) / 86400000)
    : null;

  const Step3 = (
    <motion.div key="s3" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.22 }} className="space-y-4 pb-2">
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-widest flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> الإطار الزمني</p>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">تاريخ البداية <span className="text-red-400">*</span></label>
            <input type="date" value={formData.startDate || ''} onChange={e => setField('startDate', e.target.value)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">تاريخ الانتهاء <span className="text-red-400">*</span></label>
            <input type="date" value={formData.endDate || ''} onChange={e => setField('endDate', e.target.value)} className={inputCls(false)} />
          </div>
        </div>
        {durationDays !== null && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-xs text-indigo-700 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 shrink-0" /> مدة الشاغر: <strong>{durationDays}</strong> يوم
          </div>
        )}
      </div>
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> عدد الشواغر</p>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setField('vacancyCount', Math.max(1, (formData.vacancyCount || 1) - 1))} disabled={isFieldLocked('full') || (formData.vacancyCount || 1) <= 1} className="w-10 h-10 rounded-xl bg-white border-2 border-slate-200 text-slate-600 text-xl font-bold hover:border-emerald-400 hover:text-emerald-600 transition-all disabled:opacity-40 flex items-center justify-center">−</button>
          <input type="number" min={1} value={formData.vacancyCount ?? 1} onChange={e => setField('vacancyCount', parseInt(e.target.value) || 1)} disabled={isFieldLocked('full')} className="w-20 text-center text-2xl font-bold text-emerald-700 bg-white border-2 border-emerald-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 focus:outline-none" />
          <button type="button" onClick={() => setField('vacancyCount', (formData.vacancyCount || 1) + 1)} disabled={isFieldLocked('full')} className="w-10 h-10 rounded-xl bg-white border-2 border-slate-200 text-slate-600 text-xl font-bold hover:border-emerald-400 hover:text-emerald-600 transition-all disabled:opacity-40 flex items-center justify-center">+</button>
          <span className="text-sm text-slate-500 font-medium">شاغر وظيفي</span>
        </div>
      </div>
      {/* Summary */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">ملخص الشاغر</p>
        <div className="grid grid-cols-2 gap-y-3">
          {[
            { l: 'المسمى الوظيفي', v: formData.title || '—' },
            { l: 'الفرع', v: formData.branch || '—' },
            { l: 'نوع العمل', v: formData.workType || '—' },
            { l: 'الجنس', v: formData.requiredGender || 'لا يهم' },
            { l: 'الشهادة', v: formData.requiredCertificate || '—' },
            { l: 'وسائل التواصل', v: `${(formData.contactMethods || []).length} وسيلة` },
          ].map(({ l, v }) => (
            <div key={l}>
              <p className="text-[10px] text-slate-400">{l}</p>
              <p className="text-xs font-semibold text-slate-700">{v}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );

  /* ─── EDIT MODE: single page with all fields ─── */
  const EditAllFields = (
    <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4 pb-2">
      {Step1}
      {Step2}
      {/* Dates */}
      <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-2xl p-5 space-y-4">
        <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-widest flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> التوقيت والعدد</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">تاريخ البداية <span className="text-red-400">*</span></label>
            <input type="date" value={formData.startDate || ''} onChange={e => setField('startDate', e.target.value)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">تاريخ الانتهاء <span className="text-red-400">*</span></label>
            <input type="date" value={formData.endDate || ''} onChange={e => setField('endDate', e.target.value)} className={inputCls(false)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">عدد الشواغر <span className="text-red-400">*</span></label>
            <input type="number" min={1} value={formData.vacancyCount ?? 1} onChange={e => setField('vacancyCount', parseInt(e.target.value) || 1)} disabled={isFieldLocked('full')} className={inputCls(isFieldLocked('full'))} />
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="h-full overflow-y-auto p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Briefcase className="w-7 h-7 text-sky-500" />إدارة الشواغر الوظيفية
          </h1>
          <p className="text-sm text-slate-500 mt-1">إنشاء وإدارة فرص العمل المتاحة</p>
        </div>
        <PermissionGate permission="jobs.vacancies.create">
          <button onClick={openCreate} className="flex items-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl font-semibold shadow-lg shadow-sky-500/25 transition-all">
            <Plus className="w-5 h-5" /> إنشاء شاغر جديد
          </button>
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-slate-500"><Filter className="w-4 h-4" /><span className="text-sm font-medium">تصفية:</span></div>
        <div className="relative">
          <select value={filters.status} onChange={e => setFilter('status', e.target.value as VacancyStatus | '')} className="appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500">
            <option value="">كل الحالات</option>
            <option value="Open">مفتوحة</option>
            <option value="Closed">مغلقة</option>
            <option value="Archived">مؤرشفة</option>
          </select>
          <ChevronDown className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={filters.branch} onChange={e => setFilter('branch', e.target.value)} className="appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:ring-2 focus:ring-sky-500">
            <option value="">كل الفروع</option>
            {branches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <ChevronDown className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="بحث بالرقم أو الإسم..." value={filters.search} onChange={e => setFilter('search', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg pr-10 pl-3 py-2 text-sm focus:ring-2 focus:ring-sky-500" />
        </div>
        {(filters.status || filters.branch || filters.search) && (
          <button onClick={resetFilters} className="text-xs text-slate-500 hover:text-red-500 transition-colors">مسح الفلاتر</button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="animate-spin w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full mx-auto mb-3" />
            جاري التحميل...
          </div>
        ) : vacancies.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد شواغر وظيفية</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">#</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">عنوان الوظيفة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفرع</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الفترة</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600">الشهادة</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-600">الشواغر</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-600">الحالة</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-600">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {vacancies.map((v, idx) => (
                  <tr key={v.id} className={`border-b border-slate-100 hover:bg-sky-50/40 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/30' : ''}`} onClick={() => navigate(`/jobs/vacancies/${v.id}`)}>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{v.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{v.title}</td>
                    <td className="px-4 py-3 text-slate-600"><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{v.branch}</span></td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {v.startDate ? new Date(v.startDate).toLocaleDateString('ar-IQ') : '—'} → {v.endDate ? new Date(v.endDate).toLocaleDateString('ar-IQ') : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600"><span className="flex items-center gap-1"><GraduationCap className="w-3.5 h-3.5 text-slate-400" />{v.requiredCertificate || '—'}</span></td>
                    <td className="px-4 py-3 text-center"><span className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold"><Users className="w-3 h-3" />{v.vacancyCount}</span></td>
                    <td className="px-4 py-3 text-center"><span className={`px-3 py-1 rounded-full text-xs font-bold ${STATUS_COLORS[v.status]}`}>{STATUS_LABELS[v.status]}</span></td>
                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => navigate(`/jobs/vacancies/${v.id}`)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors" title="عرض"><Eye className="w-4 h-4" /></button>
                        <PermissionGate permission="jobs.vacancies.edit">
                          {v.status !== 'Archived' && <button onClick={() => openEdit(v)} className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors" title="تعديل"><Edit className="w-4 h-4" /></button>}
                        </PermissionGate>
                        <PermissionGate permission="jobs.vacancies.change_status">
                          {v.status === 'Open' && <button onClick={() => handleStatusChange(v.id, 'Closed')} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="إغلاق"><XCircle className="w-4 h-4" /></button>}
                          {v.status === 'Closed' && (
                            <>
                              <button onClick={() => handleStatusChange(v.id, 'Open')} className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="إعادة فتح"><RotateCcw className="w-4 h-4" /></button>
                              <button onClick={() => handleStatusChange(v.id, 'Archived')} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="أرشفة"><Archive className="w-4 h-4" /></button>
                            </>
                          )}
                        </PermissionGate>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={() => setShowModal(false)}>
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
              style={{ maxHeight: 'min(90vh, 740px)' }}
              onClick={e => e.stopPropagation()} dir="rtl">

              {/* Header */}
              <div className="px-7 pt-6 pb-0 shrink-0">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">{editingVacancy ? 'تعديل الشاغر الوظيفي' : 'إنشاء شاغر وظيفي جديد'}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">{editingVacancy ? `شاغر: ${editingVacancy.title}` : 'أكمل الخطوات الثلاث لإضافة الشاغر'}</p>
                  </div>
                  <button onClick={() => setShowModal(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 transition-colors"><X className="w-5 h-5" /></button>
                </div>

                {/* Step Indicator (create only) */}
                {!editingVacancy && (
                  <div className="flex items-center gap-0 mb-5">
                    {([{ n: 1, label: 'الأساسيات', Icon: Briefcase }, { n: 2, label: 'المتطلبات', Icon: GraduationCap }, { n: 3, label: 'التوقيت', Icon: Calendar }] as const).map(({ n, label, Icon }, idx) => {
                      const done = wizardStep > n;
                      const active = wizardStep === n;
                      return (
                        <div key={n} className="flex items-center flex-1">
                          <div className="flex flex-col items-center flex-1">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold transition-all duration-300 ${done ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : active ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30' : 'bg-slate-100 text-slate-400'}`}>
                              {done ? <CheckCircle className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                            </div>
                            <span className={`text-[10px] font-semibold mt-1 ${active ? 'text-sky-600' : done ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</span>
                          </div>
                          {idx < 2 && <div className={`h-0.5 flex-1 mx-1 mb-4 rounded-full transition-all duration-500 ${wizardStep > n ? 'bg-emerald-400' : 'bg-slate-200'}`} />}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Alerts */}
                {formError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> {formError}
                  </div>
                )}
                {editingVacancy && editTier > 1 && (
                  <div className={`rounded-xl p-3 text-sm flex items-center gap-2 mb-4 ${editTier === 2 ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    <Lock className="w-4 h-4 shrink-0" />
                    {editTier === 2 ? 'تعديل مقيد (مستوى 2): يمكن تعديل تاريخ الانتهاء والمسؤوليات والمهارات ووسائل التواصل فقط' : 'تعديل مقيد (مستوى 3): يمكن تعديل تاريخ الانتهاء فقط'}
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-7 pt-2">
                <AnimatePresence mode="wait">
                  {editingVacancy ? EditAllFields : wizardStep === 1 ? Step1 : wizardStep === 2 ? Step2 : Step3}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="px-7 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between bg-white">
                {!editingVacancy ? (
                  <>
                    <span className="text-xs text-slate-400">الخطوة {wizardStep} من 3</span>
                    <div className="flex items-center gap-3">
                      {wizardStep > 1 && (
                        <button onClick={() => setWizardStep(s => (s - 1) as 1 | 2 | 3)} className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-2">
                          <ArrowRight className="w-4 h-4" /> السابق
                        </button>
                      )}
                      <button onClick={() => setShowModal(false)} className="px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">إلغاء</button>
                      {wizardStep < 3 ? (
                        <button onClick={() => {
                          setFormError('');
                          if (wizardStep === 1) {
                            if (!formData.title?.trim()) { setFormError('عنوان الوظيفة مطلوب'); return; }
                            if (!formData.branch?.trim()) { setFormError('الفرع مطلوب'); return; }
                          }
                          setWizardStep(s => (s + 1) as 1 | 2 | 3);
                        }} className="px-6 py-2.5 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-xl shadow-lg shadow-sky-500/25 transition-all flex items-center gap-2">
                          التالي <ArrowLeft className="w-4 h-4" />
                        </button>
                      ) : (
                        <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl shadow-lg shadow-emerald-500/25 transition-all disabled:opacity-50 flex items-center gap-2">
                          {saving ? 'جاري الحفظ...' : <><CheckCircle className="w-4 h-4" /> إنشاء الشاغر</>}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">إلغاء</button>
                    <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 rounded-xl shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 flex items-center gap-2">
                      {saving ? 'جاري الحفظ...' : <><CheckCircle className="w-4 h-4" /> حفظ التعديلات</>}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
