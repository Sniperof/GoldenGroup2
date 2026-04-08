import { useEffect, useState, useMemo } from 'react';
import { useBranchStore } from '../hooks/useBranchStore';
import { api } from '../lib/api';
import type { Branch, BranchContact, BranchContactType, BranchDepartment, GeoUnit } from '../lib/types';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';
import GeoSmartSearch, { GeoSelection, getLocationBadgeProps, LocationBadge } from '../components/GeoSmartSearch';
import {
  MapPin, Building2, Plus, Edit, Trash2, X, Network,
  Mail, Phone, Smartphone, Globe, Users, Briefcase,
  CircleUser, BadgeDollarSign, ChevronDown,
} from 'lucide-react';

// ─── Contact metadata ────────────────────────────────────────────────────────
const CONTACT_TYPES: { value: BranchContactType; label: string; icon: React.ReactNode; placeholder: string; inputType: string }[] = [
  { value: 'email',   label: 'بريد إلكتروني', icon: <Mail className="w-4 h-4" />,       placeholder: 'example@company.com',   inputType: 'email' },
  { value: 'phone',   label: 'هاتف ثابت',     icon: <Phone className="w-4 h-4" />,      placeholder: '07XXXXXXXXX أو +9647...',inputType: 'tel'   },
  { value: 'mobile',  label: 'موبايل',         icon: <Smartphone className="w-4 h-4" />, placeholder: '07XXXXXXXXX',            inputType: 'tel'   },
  { value: 'website', label: 'موقع إلكتروني', icon: <Globe className="w-4 h-4" />,      placeholder: 'https://example.com',    inputType: 'url'   },
];

const DEPARTMENTS: { value: BranchDepartment; label: string }[] = [
  { value: 'customer_service', label: 'خدمة العملاء' },
  { value: 'hr',               label: 'الموارد البشرية' },
  { value: 'management',       label: 'الإدارة' },
  { value: 'accounting',       label: 'المحاسبة' },
  { value: 'other',            label: 'أخرى' },
];

const DEPT_COLORS: Record<BranchDepartment, string> = {
  customer_service: 'bg-sky-100 text-sky-700',
  hr:               'bg-violet-100 text-violet-700',
  management:       'bg-amber-100 text-amber-700',
  accounting:       'bg-emerald-100 text-emerald-700',
  other:            'bg-slate-100 text-slate-600',
};

const TYPE_COLORS: Record<BranchContactType, string> = {
  email:   'bg-rose-50 text-rose-600 border-rose-100',
  phone:   'bg-sky-50 text-sky-600 border-sky-100',
  mobile:  'bg-emerald-50 text-emerald-600 border-emerald-100',
  website: 'bg-indigo-50 text-indigo-600 border-indigo-100',
};

function newContact(): BranchContact {
  return {
    id: crypto.randomUUID(),
    type: 'phone',
    department: 'customer_service',
    value: '',
    label: '',
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Branches() {
  const { branches, loading, fetchBranches, createBranch, updateBranch, deleteBranch } = useBranchStore();
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [locationSelection, setLocationSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
  const [coveredSelections, setCoveredSelections] = useState<GeoSelection[]>([]);
  const [contacts, setContacts] = useState<BranchContact[]>([]);

  useEffect(() => {
    fetchBranches();
    api.geoUnits.list().then(setGeoUnits).catch(console.error);
  }, []);

  const openForm = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setName(branch.name);
      setStatus(branch.status);
      setContacts(branch.contactInfo || []);
      if (branch.locationGeoId) {
        setLocationSelection({ govId: '', regionId: '', subId: '', neighborhoodId: branch.locationGeoId.toString() });
      } else {
        setLocationSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
      }
      const covered: GeoSelection[] = (branch.coveredGeoIds || []).map(id => ({
        govId: '', regionId: '', subId: '', neighborhoodId: id.toString()
      }));
      setCoveredSelections(covered);
    } else {
      setEditingBranch(null);
      setName('');
      setStatus('active');
      setLocationSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
      setCoveredSelections([]);
      setContacts([]);
    }
    setIsModalOpen(true);
  };

  const getDeepestId = (sel: GeoSelection): number | null => {
    const idStr = sel.neighborhoodId || sel.subId || sel.regionId || sel.govId;
    return idStr ? parseInt(idStr) : null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const locationGeoId = getDeepestId(locationSelection);
    const coveredGeoIds = coveredSelections.map(getDeepestId).filter(Boolean) as number[];
    // Validate contacts have values
    const validContacts = contacts.filter(c => c.value.trim());

    const payload = { name, status, locationGeoId, coveredGeoIds, contactInfo: validContacts };
    try {
      if (editingBranch) {
        await updateBranch(editingBranch.id, payload);
      } else {
        await createBranch(payload);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert('حدث خطأ أثناء حفظ الفرع: ' + (err.message || 'خطأ غير معروف'));
    }
  };

  // Contact handlers
  const addContact = () => setContacts(c => [...c, newContact()]);
  const removeContact = (id: string) => setContacts(c => c.filter(x => x.id !== id));
  const updateContact = (id: string, patch: Partial<BranchContact>) => {
    setContacts(c => c.map(x => x.id === id ? { ...x, ...patch } : x));
  };

  const handleDelete = async (id: number) => {
    if (!confirm('هل أنت متأكد من حذف هذا الفرع؟')) return;
    try { await deleteBranch(id); }
    catch { alert('لا يمكن حذف الفرع لاحتمال وجود سجلات مرتبطة به'); }
  };

  const addCoveredRange = () => setCoveredSelections([...coveredSelections, { govId: '', regionId: '', subId: '', neighborhoodId: '' }]);
  const removeCoveredRange = (index: number) => setCoveredSelections(s => s.filter((_, i) => i !== index));

  const columns: ColumnDef<Branch>[] = [
    { key: 'id', label: 'ID', sortable: true, render: (b) => <span className="font-mono text-slate-500 text-xs">#{b.id}</span> },
    { key: 'name', label: 'اسم الفرع', sortable: true, render: (b) => <span className="font-bold text-slate-800">{b.name}</span> },
    {
      key: 'locationGeoName', label: 'الموقع الرئيسي', sortable: true,
      render: (b) => {
        if (!b.locationGeoId) return <span className="text-slate-400">--</span>;
        const unit = geoUnits.find(u => u.id === b.locationGeoId);
        if (!unit) return <span className="text-slate-600">{b.locationGeoName || 'موقع مجهول'}</span>;
        return <LocationBadge {...getLocationBadgeProps(unit.name, geoUnits)} />;
      }
    },
    {
      key: 'contactInfo' as any, label: 'التواصل', sortable: false,
      render: (b) => {
        const ci = b.contactInfo || [];
        if (ci.length === 0) return <span className="text-slate-400 text-xs">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {ci.slice(0, 3).map(c => {
              const t = CONTACT_TYPES.find(x => x.value === c.type);
              return (
                <span key={c.id} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${TYPE_COLORS[c.type]}`}>
                  {t?.icon} {c.value.length > 18 ? c.value.slice(0, 18) + '…' : c.value}
                </span>
              );
            })}
            {ci.length > 3 && <span className="text-xs text-slate-400">+{ci.length - 3}</span>}
          </div>
        );
      }
    },
    {
      key: 'status', label: 'الحالة', sortable: true,
      render: (b) => (
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${b.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {b.status === 'active' ? 'نشط' : 'غير نشط'}
        </span>
      )
    },
    {
      key: 'coveredGeoIds', label: 'التغطية', sortable: false,
      render: (b) => (
        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg flex items-center gap-1 w-fit">
          <Network className="w-3.5 h-3.5" />
          {(b.coveredGeoIds || []).length} منطقة
        </span>
      )
    }
  ];

  return (
    <div className="flex flex-col h-full p-8 space-y-6 overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-sky-500" />
            إدارة الفروع
          </h1>
          <p className="text-sm text-slate-500 mt-1">إضافة الفروع وتحديد معلومات التواصل ونطاق التغطية الجغرافية</p>
        </div>
        <button onClick={() => openForm()}
          className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 transition-all active:scale-95">
          <Plus className="w-4 h-4" /> إضافة فرع جديد
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
        <SmartTable<Branch>
          title="سجل الفروع"
          icon={Building2}
          data={branches}
          columns={columns}
          getId={(b) => b.id}
          actions={(b) => (
            <div className="flex items-center gap-1">
              <button onClick={() => openForm(b)} className="p-1.5 rounded-md hover:bg-sky-50 text-slate-400 hover:text-sky-500" title="تعديل">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(b.id)} className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500" title="حذف">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        />
      </div>

      {/* ── Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex-shrink-0">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-sky-500" />
                {editingBranch ? 'تعديل بيانات الفرع' : 'إضافة فرع جديد'}
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto flex-1">
              <div className="p-6 space-y-6">

                {/* Basic info */}
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">اسم الفرع <span className="text-red-500">*</span></label>
                    <input required value={name} onChange={e => setName(e.target.value)}
                      placeholder="مثال: فرع الرصافة الرئيسي"
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">الحالة</label>
                    <select value={status} onChange={e => setStatus(e.target.value as any)}
                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none">
                      <option value="active">نشط</option>
                      <option value="inactive">غير نشط</option>
                    </select>
                  </div>
                </div>

                {/* Location */}
                <div className="border border-slate-100 bg-slate-50/50 rounded-2xl p-5 space-y-4">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 border-b border-slate-200 pb-3">
                    <MapPin className="w-4 h-4 text-emerald-500" /> الموقع الجغرافي الأساسي
                  </h4>
                  <GeoSmartSearch label="موقع الفرع" geoUnits={geoUnits} required
                    value={locationSelection} onChange={setLocationSelection}
                    placeholder="ابحث عن موقع الفرع الجغرافي..." />
                </div>

                {/* ── Contact Info ── */}
                <div className="border border-violet-100 bg-violet-50/30 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-violet-100 pb-3">
                    <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <Phone className="w-4 h-4 text-violet-500" />
                      معلومات التواصل
                      {contacts.length > 0 && (
                        <span className="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full font-bold">{contacts.length}</span>
                      )}
                    </h4>
                    <button type="button" onClick={addContact}
                      className="text-xs font-bold text-violet-600 hover:text-violet-700 flex items-center gap-1 bg-violet-100 hover:bg-violet-200 px-3 py-1.5 rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> إضافة وسيلة تواصل
                    </button>
                  </div>

                  {contacts.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-6 bg-white border border-dashed border-violet-200 rounded-xl flex flex-col items-center gap-2">
                      <Phone className="w-8 h-8 text-violet-200" />
                      لم تُضف معلومات تواصل بعد
                      <button type="button" onClick={addContact}
                        className="text-xs font-bold text-violet-500 bg-violet-50 hover:bg-violet-100 px-4 py-1.5 rounded-lg transition-colors">
                        + إضافة أول وسيلة تواصل
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {contacts.map((contact) => {
                        const typeMeta = CONTACT_TYPES.find(t => t.value === contact.type)!;
                        return (
                          <div key={contact.id}
                            className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-sm">
                            {/* Row 1: type & department */}
                            <div className="grid grid-cols-2 gap-3">
                              {/* Contact type */}
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">نوع التواصل</label>
                                <div className="relative">
                                  <select
                                    value={contact.type}
                                    onChange={e => updateContact(contact.id, {
                                      type: e.target.value as BranchContactType,
                                      value: '', // reset value when type changes
                                    })}
                                    className="w-full appearance-none bg-white border border-slate-200 rounded-xl pl-8 pr-4 py-2 text-sm focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none"
                                  >
                                    {CONTACT_TYPES.map(t => (
                                      <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                  </select>
                                  <span className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none`}>
                                    {typeMeta.icon}
                                  </span>
                                </div>
                              </div>

                              {/* Department */}
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">القسم</label>
                                <select
                                  value={contact.department}
                                  onChange={e => updateContact(contact.id, { department: e.target.value as BranchDepartment })}
                                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:border-violet-400 focus:ring-2 focus:ring-violet-100 outline-none"
                                >
                                  {DEPARTMENTS.map(d => (
                                    <option key={d.value} value={d.value}>{d.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Row 2: value field (type-specific) + optional label + delete */}
                            <div className="flex items-end gap-2">
                              <div className="flex-1 space-y-1">
                                <label className="text-xs font-semibold text-slate-500">
                                  {typeMeta.label} <span className="text-red-400">*</span>
                                </label>
                                <div className={`flex items-center gap-2 border rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-violet-100 focus-within:border-violet-400 bg-white ${
                                  contact.value ? `border-slate-200` : 'border-slate-200'
                                }`}>
                                  <span className="text-slate-400 flex-shrink-0">{typeMeta.icon}</span>
                                  <input
                                    type={typeMeta.inputType}
                                    value={contact.value}
                                    onChange={e => updateContact(contact.id, { value: e.target.value })}
                                    placeholder={typeMeta.placeholder}
                                    className="flex-1 text-sm outline-none bg-transparent"
                                    dir={contact.type === 'website' || contact.type === 'email' ? 'ltr' : 'rtl'}
                                  />
                                </div>
                              </div>

                              <div className="w-36 space-y-1">
                                <label className="text-xs font-semibold text-slate-500">ملاحظة (اختياري)</label>
                                <input
                                  type="text"
                                  value={contact.label || ''}
                                  onChange={e => updateContact(contact.id, { label: e.target.value })}
                                  placeholder="مثال: للتوظيف فقط"
                                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                                />
                              </div>

                              <button type="button" onClick={() => removeContact(contact.id)}
                                className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors rounded-xl border border-red-100 mb-0.5">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Preview badge */}
                            {contact.value && (
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${TYPE_COLORS[contact.type]}`}>
                                  {typeMeta.icon}
                                  {contact.value}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DEPT_COLORS[contact.department]}`}>
                                  {DEPARTMENTS.find(d => d.value === contact.department)?.label}
                                </span>
                                {contact.label && <span className="text-xs text-slate-400">— {contact.label}</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Coverage */}
                <div className="border border-slate-100 bg-sky-50/20 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-sky-100 pb-3">
                    <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <Network className="w-4 h-4 text-sky-500" />
                      نطاق التغطية والمناطق التابعة
                    </h4>
                    <button type="button" onClick={addCoveredRange}
                      className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 bg-sky-100 px-3 py-1.5 rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> إضافة منطقة
                    </button>
                  </div>
                  {coveredSelections.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-4 bg-white border border-dashed border-slate-200 rounded-xl">
                      لم يتم تحديد مناطق تغطية — الفرع سيخدم موقعه الأساسي فقط.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {coveredSelections.map((sel, idx) => (
                        <div key={idx} className="flex items-end gap-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                          <div className="flex-1">
                            <GeoSmartSearch geoUnits={geoUnits} value={sel}
                              onChange={(newSel) => {
                                const arr = [...coveredSelections];
                                arr[idx] = newSel;
                                setCoveredSelections(arr);
                              }}
                              placeholder="اختر المحافظة، المنطقة أو الحي..." />
                          </div>
                          <button type="button" onClick={() => removeCoveredRange(idx)}
                            className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-red-50 text-red-500 hover:bg-red-100 rounded-xl border border-red-100 mb-0.5">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3 flex-shrink-0">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors">
                  إلغاء
                </button>
                <button type="submit" disabled={loading}
                  className="bg-sky-500 hover:bg-sky-600 active:scale-95 transition-all text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 disabled:opacity-50">
                  {loading ? 'جاري الحفظ...' : `حفظ الفرع${contacts.filter(c => c.value).length > 0 ? ` (${contacts.filter(c => c.value).length} وسيلة تواصل)` : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
