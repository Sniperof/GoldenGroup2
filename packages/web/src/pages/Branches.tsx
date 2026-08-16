import { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useBranchStore } from '../hooks/useBranchStore';
import { api } from '../lib/api';
import type { Branch, BranchContact, BranchContactType, BranchDepartment, BranchImage, GeoUnit } from '../lib/types';
import { usePermissions } from '../hooks/usePermissions';
import SmartTable from '../components/SmartTable';
import type { ColumnDef } from '../components/SmartTable';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import PageHeader from '../components/ui/PageHeader';
import Modal from '../components/ui/Modal';
import IconButton from '../components/ui/IconButton';
import Checkbox from '../components/ui/Checkbox';
import GeoSmartSearch, { GeoSelection, getLocationBadgeProps, LocationBadge } from '../components/GeoSmartSearch';
import { uploadMedia } from '../lib/uploadMedia';
import {
  MapPin, Building2, Plus, Edit, Trash2, Network,
  Mail, Phone, Smartphone, Globe, Users, Briefcase,
  CircleUser, BadgeDollarSign, ChevronDown, Image, Star, X, Eye, EyeOff,
} from '../components/ui/icons';

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

function makeImageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Uploads to the media store instead of inlining base64 into branches.images.
 * A branch with 20 photos used to carry tens of MB inside its row, which the
 * branch list endpoints selected on every request.
 */
async function uploadBranchImage(file: File): Promise<BranchImage> {
  const media = await uploadMedia(file);
  return {
    id: makeImageId(),
    name: file.name,
    url: media.url,
    ...(media.thumbUrl ? { thumbUrl: media.thumbUrl } : {}),
  };
}

function buildGeoSelectionFromId(geoUnits: GeoUnit[], id?: number | null): GeoSelection {
  const path: GeoUnit[] = [];
  let cursor = id ? geoUnits.find(unit => unit.id === id) : undefined;
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId ? geoUnits.find(unit => unit.id === cursor!.parentId) : undefined;
  }
  return {
    govId: path[0]?.id.toString() || '',
    regionId: path[1]?.id.toString() || '',
    subId: path[2]?.id.toString() || '',
    neighborhoodId: path[3]?.id.toString() || '',
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Branches() {
  const { hasPermission, hasAnyPermission } = usePermissions();
  const { branches, loading, fetchBranches, createBranch, updateBranch, deleteBranch } = useBranchStore();
  const canManageBranchStructure = hasPermission('branches.manage');
  const canEditBranches = hasAnyPermission('branches.edit', 'branches.manage');
  const [geoUnits, setGeoUnits] = useState<GeoUnit[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);

  const [name, setName] = useState('');
  const [detailedAddress, setDetailedAddress] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [locationSelection, setLocationSelection] = useState<GeoSelection>({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
  const [coveredSelections, setCoveredSelections] = useState<GeoSelection[]>([]);
  const [contacts, setContacts] = useState<BranchContact[]>([]);
  const [mobileVisible, setMobileVisible] = useState(false);
  const [mobileDisplayOrder, setMobileDisplayOrder] = useState('0');
  const [publicDescription, setPublicDescription] = useState('');
  const [images, setImages] = useState<BranchImage[]>([]);
  const [primaryImageId, setPrimaryImageId] = useState<string | null>(null);
  // Images upload to the server now, so the form needs progress and errors.
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  useEffect(() => {
    fetchBranches();
    api.geoUnits.list().then(setGeoUnits).catch(console.error);
  }, []);

  if (!hasAnyPermission('branches.view', 'branches.edit', 'branches.manage')) {
    return <Navigate to="/" replace />;
  }

  const openForm = (branch?: Branch) => {
    if (branch) {
      setEditingBranch(branch);
      setName(branch.name);
      setDetailedAddress(branch.detailedAddress || '');
      setStatus(branch.status);
      setContacts(branch.contactInfo || []);
      setMobileVisible(branch.mobileVisible === true);
      setMobileDisplayOrder(String(branch.mobileDisplayOrder ?? 0));
      setPublicDescription(branch.publicDescription || '');
      setImages(branch.images || []);
      setPrimaryImageId(branch.primaryImageId || null);
      setLatitude(branch.latitude == null ? '' : String(branch.latitude));
      setLongitude(branch.longitude == null ? '' : String(branch.longitude));
      setLocationSelection(buildGeoSelectionFromId(geoUnits, branch.locationGeoId));
      const covered: GeoSelection[] = (branch.coveredGeoIds || []).map(id => ({
        govId: '', regionId: '', subId: '', neighborhoodId: id.toString()
      }));
      setCoveredSelections(covered);
    } else {
      setEditingBranch(null);
      setName('');
      setDetailedAddress('');
      setStatus('active');
      setLocationSelection({ govId: '', regionId: '', subId: '', neighborhoodId: '' });
      setCoveredSelections([]);
      setContacts([]);
      setMobileVisible(false);
      setMobileDisplayOrder('0');
      setPublicDescription('');
      setImages([]);
      setPrimaryImageId(null);
      setLatitude('');
      setLongitude('');
    }
    setIsModalOpen(true);
  };

  const getDeepestId = (sel: GeoSelection): number | null => {
    const idStr = sel.neighborhoodId || sel.subId || sel.regionId || sel.govId;
    return idStr ? parseInt(idStr) : null;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBranch ? !canEditBranches : !canManageBranchStructure) return;
    const locationGeoId = getDeepestId(locationSelection);
    const coveredGeoIds = coveredSelections.map(getDeepestId).filter(Boolean) as number[];
    if (!locationSelection.subId && !locationSelection.neighborhoodId) {
      alert('يجب اختيار ناحية أو حي على الأقل في العنوان.');
      return;
    }
    // Validate contacts have values
    const validContacts = contacts.filter(c => c.value.trim());

    if ((latitude === '') !== (longitude === '')) {
      alert('يجب إدخال خط العرض وخط الطول معاً.');
      return;
    }
    const basePayload = {
      name,
      locationGeoId,
      detailedAddress: detailedAddress.trim() || null,
      contactInfo: validContacts,
      publicDescription: publicDescription.trim() || null,
      images,
      primaryImageId,
      latitude: latitude === '' ? null : Number(latitude),
      longitude: longitude === '' ? null : Number(longitude),
    };
    const payload = editingBranch && !canManageBranchStructure
      ? basePayload
      : { ...basePayload, status, coveredGeoIds, mobileVisible, mobileDisplayOrder: Number(mobileDisplayOrder) || 0 };
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

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    if (images.length + files.length > 20) {
      alert('لا يمكن إضافة أكثر من 20 صورة للفرع.');
      return;
    }
    setUploadingImages(true);
    setImageUploadError(null);
    try {
      const added = await Promise.all(Array.from(files).map(uploadBranchImage));
      setImages(current => [...current, ...added]);
      if (!primaryImageId && added[0]) setPrimaryImageId(added[0].id);
    } catch (err: any) {
      setImageUploadError(err?.message || 'فشل رفع الصورة');
    } finally {
      setUploadingImages(false);
    }
  };

  const removeImage = (id: string) => {
    setImages(current => {
      const next = current.filter(image => image.id !== id);
      if (primaryImageId === id) setPrimaryImageId(next[0]?.id ?? null);
      return next;
    });
  };

  const handleDelete = async (id: number) => {
    if (!canManageBranchStructure) return;
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
      key: 'mobileVisible', label: 'الموبايل', sortable: true,
      render: (b) => b.mobileVisible
        ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Eye className="w-3.5 h-3.5" /> منشور</span>
        : <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-400"><EyeOff className="w-3.5 h-3.5" /> مخفي</span>,
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

  const canEditCurrentBranchDetails = editingBranch ? canEditBranches : canManageBranchStructure;

  return (
    <div className="p-8 space-y-6" dir="rtl">
      {/* Header */}
      <PageHeader
        title="إدارة الفروع"
        subtitle="إضافة الفروع وتحديد معلومات التواصل ونطاق التغطية الجغرافية"
        icon={<Building2 className="w-7 h-7 text-sky-500" />}
        actions={
          <Button icon={Plus} disabled={!canManageBranchStructure} onClick={() => openForm()}>
            إضافة فرع جديد
          </Button>
        }
      />

      <SmartTable<Branch>
          title="سجل الفروع"
          icon={Building2}
          data={branches}
          columns={columns}
          getId={(b) => b.id}
          actions={(b) => (
            <div className="flex items-center gap-1">
              <button onClick={() => openForm(b)} disabled={!canEditBranches} className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-500 disabled:opacity-50" title="تعديل">
                <Edit className="w-4 h-4" />
              </button>
              <button onClick={() => handleDelete(b.id)} disabled={!canManageBranchStructure} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-50" title="حذف">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        />

      {/* ── Modal ── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        size="2xl"
        title={
          <span className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-500" />
            {editingBranch ? 'تعديل بيانات الفرع' : 'إضافة فرع جديد'}
          </span>
        }
      >
            <form onSubmit={handleSave}>
              <div className="p-6 space-y-6">

                {/* Basic info */}
                <div className="grid grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">اسم الفرع <span className="text-red-500">*</span></label>
                    <input required value={name} onChange={e => setName(e.target.value)}
                      disabled={!canEditCurrentBranchDetails}
                      placeholder="مثال: فرع الرصافة الرئيسي"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none disabled:bg-slate-50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">الحالة</label>
                    <Select
                      value={status}
                      onChange={v => setStatus(v as any)}
                      disabled={!canManageBranchStructure}
                      ariaLabel="الحالة"
                      className="w-full"
                      options={[
                        { value: 'active', label: 'نشط' },
                        { value: 'inactive', label: 'غير نشط' },
                      ]}
                    />
                  </div>
                </div>

                {/* Location */}
                <div className="border border-slate-100 bg-slate-50/50 rounded-2xl p-5 space-y-4">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 border-b border-slate-200 pb-3">
                    <MapPin className="w-4 h-4 text-emerald-500" /> العنوان
                  </h4>
                  <GeoSmartSearch label="العنوان" geoUnits={geoUnits} required
                    value={locationSelection} onChange={setLocationSelection}
                    placeholder="ابحث عن ناحية أو حي..."
                    minSelectableLevel={3}
                    disabled={!canEditCurrentBranchDetails} />
                  {!locationSelection.subId && !locationSelection.neighborhoodId && (
                    <p className="text-xs text-amber-600 font-medium">
                      يجب اختيار ناحية أو حي على الأقل — لا يمكن الاكتفاء بمحافظة أو منطقة
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">العنوان التفصيلي</label>
                    <textarea
                      value={detailedAddress}
                      onChange={e => setDetailedAddress(e.target.value)}
                      disabled={!canEditCurrentBranchDetails}
                      rows={3}
                      placeholder="مثال: الشارع، البناء، الطابق، أقرب نقطة دالة..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none resize-none disabled:bg-slate-50"
                    />
                  </div>
                </div>

                {/* Public mobile profile */}
                <div className="border border-cyan-100 bg-cyan-50/30 rounded-2xl p-5 space-y-5">
                  <div className="flex items-center justify-between border-b border-cyan-100 pb-3">
                    <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-cyan-600" /> الملف العام للموبايل
                    </h4>
                    <Checkbox
                      checked={mobileVisible}
                      onCheckedChange={setMobileVisible}
                      disabled={!canManageBranchStructure}
                    >
                      <span className="text-sm font-bold text-cyan-700">إظهار الفرع في التطبيق</span>
                    </Checkbox>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-slate-700">الوصف العام</label>
                    <textarea
                      value={publicDescription}
                      onChange={event => setPublicDescription(event.target.value)}
                      disabled={!canEditCurrentBranchDetails}
                      maxLength={2000}
                      rows={3}
                      placeholder="وصف مختصر يظهر في صفحة الفرع ضمن تطبيق الموبايل..."
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none resize-none disabled:bg-slate-50"
                    />
                    <p className="text-xs text-slate-400 text-left">{publicDescription.length}/2000</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-slate-700">ترتيب الظهور</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={mobileDisplayOrder}
                        onChange={event => setMobileDisplayOrder(event.target.value)}
                        disabled={!canManageBranchStructure}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-slate-700">خط العرض</label>
                      <input
                        type="number"
                        min={-90}
                        max={90}
                        step="any"
                        value={latitude}
                        onChange={event => setLatitude(event.target.value)}
                        disabled={!canEditCurrentBranchDetails}
                        dir="ltr"
                        placeholder="33.5138"
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-slate-700">خط الطول</label>
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step="any"
                        value={longitude}
                        onChange={event => setLongitude(event.target.value)}
                        disabled={!canEditCurrentBranchDetails}
                        dir="ltr"
                        placeholder="36.2765"
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 disabled:bg-slate-50"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h5 className="text-sm font-semibold text-slate-700">صور الفرع</h5>
                        <p className="text-xs text-slate-400">حتى 20 صورة، وحدد صورة واحدة رئيسية.</p>
                      </div>
                      <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${canEditCurrentBranchDetails ? 'cursor-pointer bg-white border-cyan-200 text-cyan-700 hover:bg-cyan-50' : 'cursor-not-allowed bg-slate-50 border-slate-200 text-slate-400'}`}>
                        <Image className="w-4 h-4" /> إضافة صور
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          disabled={!canEditCurrentBranchDetails}
                          onChange={event => { void addImages(event.target.files); event.currentTarget.value = ''; }}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {uploadingImages && (
                      <div className="mb-3 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-bold text-cyan-700">
                        جارٍ رفع الصور…
                      </div>
                    )}
                    {imageUploadError && (
                      <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700">
                        {imageUploadError}
                        <button type="button" onClick={() => setImageUploadError(null)} className="mr-auto text-red-400 hover:text-red-600">✕</button>
                      </div>
                    )}

                    {images.length === 0 ? (
                      <div className="py-7 text-center text-sm text-slate-400 bg-white border border-dashed border-cyan-200 rounded-xl">
                        لم تُضف صور للفرع بعد
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {images.map(image => (
                          <div key={image.id} className={`relative group rounded-xl overflow-hidden border-2 ${image.id === primaryImageId ? 'border-amber-400' : 'border-slate-200'}`}>
                            <img src={image.url} alt={image.name} className="w-full h-28 object-cover" />
                            {image.id === primaryImageId && (
                              <span className="absolute top-1.5 right-1.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-white">رئيسية</span>
                            )}
                            {canEditCurrentBranchDetails && (
                              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                                <button type="button" onClick={() => setPrimaryImageId(image.id)} className="p-2 rounded-full bg-white/90 text-amber-500" title="تعيين كصورة رئيسية">
                                  <Star className="w-4 h-4" />
                                </button>
                                <IconButton icon={X} label="حذف الصورة" variant="danger" size="sm" shape="circle" onClick={() => removeImage(image.id)} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-slate-500">
                    لن يظهر سوى وسائل التواصل المصنفة ضمن خدمة العملاء في واجهة الموبايل.
                  </p>
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
                      disabled={!canEditCurrentBranchDetails}
                      className="text-xs font-bold text-violet-600 hover:text-violet-700 flex items-center gap-1 bg-violet-100 hover:bg-violet-200 px-3 py-1.5 rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> إضافة وسيلة تواصل
                    </button>
                  </div>

                  {contacts.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-6 bg-white border border-dashed border-violet-200 rounded-xl flex flex-col items-center gap-2">
                      <Phone className="w-8 h-8 text-violet-200" />
                      لم تُضف معلومات تواصل بعد
                      <button type="button" onClick={addContact}
                        disabled={!canEditCurrentBranchDetails}
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
                                <Select<BranchContactType>
                                  value={contact.type}
                                  onChange={v => updateContact(contact.id, {
                                    type: v,
                                    value: '', // reset value when type changes
                                  })}
                                  disabled={!canEditCurrentBranchDetails}
                                  ariaLabel="نوع التواصل"
                                  className="w-full"
                                  options={CONTACT_TYPES.map(t => ({ value: t.value, label: t.label, leading: t.icon }))}
                                />
                              </div>

                              {/* Department */}
                              <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">القسم</label>
                                <Select<BranchDepartment>
                                  value={contact.department}
                                  onChange={v => updateContact(contact.id, { department: v })}
                                  disabled={!canEditCurrentBranchDetails}
                                  ariaLabel="القسم"
                                  className="w-full"
                                  options={DEPARTMENTS.map(d => ({ value: d.value, label: d.label }))}
                                />
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
                                    disabled={!canEditCurrentBranchDetails}
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
                                  disabled={!canEditCurrentBranchDetails}
                                  placeholder="مثال: للتوظيف فقط"
                                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                                />
                              </div>

                              <button type="button" onClick={() => removeContact(contact.id)} disabled={!canEditCurrentBranchDetails}
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
                      disabled={!canManageBranchStructure}
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
                              disabled={!canManageBranchStructure}
                              placeholder="اختر المحافظة، المنطقة أو الحي..." />
                          </div>
                          <button type="button" onClick={() => removeCoveredRange(idx)} disabled={!canManageBranchStructure}
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
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 flex-shrink-0">
                <button type="button" onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors">
                  إلغاء
                </button>
                <button type="submit" disabled={loading}
                  className="bg-sky-500 hover:bg-sky-600 active:scale-95 transition-all text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-500/20 disabled:opacity-50"
                  >
                  {loading ? 'جاري الحفظ...' : `حفظ الفرع${contacts.filter(c => c.value).length > 0 ? ` (${contacts.filter(c => c.value).length} وسيلة تواصل)` : ''}`}
                </button>
              </div>
            </form>
      </Modal>
    </div>
  );
}
