import { useEffect, useState, useMemo } from 'react';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import type { SystemList } from '../../lib/types';
import {
  Settings2, Plus, Edit, Trash2, Save, X, ListPlus,
  ToggleLeft, ToggleRight, Search, ChevronLeft, GraduationCap,
  Tag, FolderPlus, Link2, FileText, Users, Briefcase,
  Info, AlertTriangle, MapPin, UserCheck, BookOpen
} from 'lucide-react';
import { useAuthStore } from '../../hooks/useAuthStore';
import { Navigate } from 'react-router-dom';

// ─── Usage location badge type ───────────────────────────────────────────────
interface UsageLocation {
  label: string;
  route: string;
  icon: React.ReactNode;
}

// ─── Category metadata ────────────────────────────────────────────────────────
interface CategoryMeta {
  id: string;
  label: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  usedIn: UsageLocation[];
  isParent?: boolean; // certificate is parent of major
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: 'occupation',
    label: 'المهن',
    description: 'القيم المعتمدة لحقل المهنة في الأسماء المقترحة وسجلات الزبائن. أي تعديل هنا يظهر مباشرة في نماذج الإضافة والتأهيل.',
    impact: 'medium',
    usedIn: [
      { label: 'إضافة اسم مقترح', route: 'الأسماء المقترحة ← إضافة اسم', icon: <Users className="w-3 h-3" /> },
      { label: 'إضافة / تعديل زبون', route: 'الزبائن ← نموذج الزبون', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'job_title',
    label: 'عناوين الوظائف',
    description: 'قائمة بالمسميات الوظيفية المتاحة عند إنشاء شاغر وظيفي. كل قيمة تُصبح خياراً في حقل "عنوان الوظيفة".',
    impact: 'high',
    usedIn: [
      { label: 'إنشاء شاغر وظيفي', route: 'الوظائف ← الشواغر ← إنشاء', icon: <Briefcase className="w-3 h-3" /> },
      { label: 'تعديل الشاغر', route: 'الوظائف ← تفاصيل الشاغر ← تعديل', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'certificate',
    label: 'الشهادات العلمية',
    description: 'مستويات الشهادات الأكاديمية. يرتبط بكل شهادة قائمة اختصاصات خاصة بها (أب → ابن). الشهادة المختارة تحدد قائمة الاختصاصات المعروضة.',
    impact: 'high',
    isParent: true,
    usedIn: [
      { label: 'إنشاء شاغر وظيفي', route: 'الوظائف ← الشواغر ← إنشاء', icon: <Briefcase className="w-3 h-3" /> },
      { label: 'تعديل الشاغر', route: 'الوظائف ← تفاصيل الشاغر ← تعديل', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'work_type',
    label: 'أنواع العمل / الدوام',
    description: 'يحدد طبيعة الوظيفة من حيث نظام الدوام (كامل، جزئي، شفتات...). يظهر في فورم إنشاء الشاغر وكذلك في صفحة الوظائف العامة.',
    impact: 'medium',
    usedIn: [
      { label: 'إنشاء شاغر وظيفي', route: 'الوظائف ← الشواغر ← إنشاء', icon: <Briefcase className="w-3 h-3" /> },
      { label: 'صفحة الوظائف العامة', route: 'الوظائف ← الصفحة العامة', icon: <Users className="w-3 h-3" /> },
    ],
  },
  {
    id: 'nationality',
    label: 'الجنسيات',
    description: 'قائمة الجنسيات المتاحة للاختيار عند تسجيل بيانات المتقدم. تؤثر على فلترة الطلبات لاحقاً.',
    impact: 'medium',
    usedIn: [
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
      { label: 'صفحة الوظائف العامة', route: 'تسجيل المتقدم', icon: <Users className="w-3 h-3" /> },
    ],
  },
  {
    id: 'marital_status',
    label: 'الحالة الاجتماعية',
    description: 'خيارات الحالة الاجتماعية للمتقدم (أعزب، متزوج...). تُستخدم في ملف المتقدم للتوثيق الرسمي.',
    impact: 'low',
    usedIn: [
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
    ],
  },
  {
    id: 'gender',
    label: 'الجنس / النوع',
    description: 'يُستخدم في موضعين: تحديد الجنس في ملف المتقدم، وكذلك عند تحديد "الجنس المطلوب" في الشاغر الوظيفي.',
    impact: 'medium',
    usedIn: [
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
      { label: 'إنشاء شاغر وظيفي', route: 'الجنس المطلوب', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'driving_license',
    label: 'رخصة القيادة (الخيارات)',
    description: 'قيم نعم/لا لحقل رخصة القيادة عند إدخال بيانات المتقدم. يُفضّل الإبقاء على قيمتين فقط (نعم، لا).',
    impact: 'low',
    usedIn: [
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
    ],
  },
  {
    id: 'application_source',
    label: 'مصادر التقديم',
    description: 'من أين وصل المتقدم للوظيفة؟ (موقع إلكتروني، توصية، إعلان...). يُستخدم في تحليل فعالية قنوات التوظيف.',
    impact: 'low',
    usedIn: [
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
    ],
  },
];

const MAJOR_PREFIX = 'major:';

const IMPACT_CONFIG = {
  high: { label: 'تأثير عالٍ', cls: 'bg-rose-50 text-rose-600 border-rose-200', dot: 'bg-rose-500' },
  medium: { label: 'تأثير متوسط', cls: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  low: { label: 'تأثير بسيط', cls: 'bg-sky-50 text-sky-600 border-sky-200', dot: 'bg-sky-400' },
};

export default function SystemLists() {
  const { user } = useAuthStore();
  const { lists, loading, fetchLists, createList, updateList, deleteList } = useSystemListsStore();

  const allDbCategories = useMemo(() => {
    const cats = new Set(lists.map(l => l.category));
    return [...cats];
  }, [lists]);

  const sidebarCategories: CategoryMeta[] = useMemo(() => {
    const result = [...CATEGORIES];
    allDbCategories.forEach(cat => {
      if (!cat.startsWith(MAJOR_PREFIX) && !CATEGORIES.find(b => b.id === cat)) {
        result.push({
          id: cat, label: cat,
          description: 'فئة مخصصة أنشأها الأدمن.',
          impact: 'low',
          usedIn: [],
        });
      }
    });
    return result;
  }, [allDbCategories]);

  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<SystemList | null>(null);
  const [formValue, setFormValue] = useState('');
  const [formOrder, setFormOrder] = useState(0);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);
  const [newCatId, setNewCatId] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [activeCertificate, setActiveCertificate] = useState<string | null>(null);

  useEffect(() => { fetchLists(); }, []);
  useEffect(() => { setSearch(''); setActiveCertificate(null); }, [activeCategory]);

  if (!user || !['HR_MANAGER', 'ADMIN'].includes(user.role)) return <Navigate to="/" replace />;

  const activeMeta = sidebarCategories.find(c => c.id === activeCategory);
  const isCertificateView = activeCategory === 'certificate';

  const filteredItems = useMemo(() => {
    const cat = (isCertificateView && activeCertificate)
      ? `${MAJOR_PREFIX}${activeCertificate}` : activeCategory;
    return lists
      .filter(l => l.category === cat)
      .filter(l => search === '' || l.value.includes(search))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
  }, [lists, activeCategory, activeCertificate, isCertificateView, search]);

  const certificateItems = useMemo(() =>
    lists.filter(l => l.category === 'certificate').sort((a, b) => a.displayOrder - b.displayOrder),
    [lists]);

  const openForm = (item?: SystemList) => {
    if (item) {
      setEditingItem(item); setFormValue(item.value); setFormOrder(item.displayOrder);
    } else {
      setEditingItem(null); setFormValue(''); setFormOrder(filteredItems.length + 1);
    }
    setIsItemModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saveCategory = (isCertificateView && activeCertificate)
        ? `${MAJOR_PREFIX}${activeCertificate}` : activeCategory;
      if (editingItem) {
        await updateList(editingItem.id, { value: formValue, displayOrder: formOrder });
      } else {
        await createList({ category: saveCategory, value: formValue, displayOrder: formOrder, isActive: true });
      }
      setIsItemModalOpen(false);
    } catch (err: any) { alert(err.message || 'حدث خطأ أثناء الحفظ'); }
  };

  const toggleActive = async (item: SystemList) => {
    try { await updateList(item.id, { isActive: !item.isActive }); }
    catch (err: any) { alert(err.message || 'حدث خطأ'); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('هل أنت متأكد؟ يُفضّل التعطيل بدلاً من الحذف لحماية السجلات.')) return;
    try { await deleteList(id); }
    catch (err: any) { alert(err.message || 'حدث خطأ أثناء الحذف'); }
  };

  const handleAddNewCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const catId = newCatId.trim().toLowerCase().replace(/\s+/g, '_');
    if (!catId) return;
    setActiveCategory(catId);
    setIsNewCatOpen(false);
    setNewCatId(''); setNewCatLabel('');
  };

  const panelTitle = () => {
    if (isCertificateView && activeCertificate) return `اختصاصات شهادة: ${activeCertificate}`;
    return activeMeta?.label ?? activeCategory;
  };

  const impactCfg = IMPACT_CONFIG[activeMeta?.impact ?? 'low'];

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-4rem)] flex flex-col" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Settings2 className="w-7 h-7 text-sky-500" />
            إدارة القوائم والفهارس
          </h1>
          <p className="text-sm text-slate-500 mt-1">تحكم ديناميكي بجميع القوائم المنسدلة — كل تغيير ينعكس فوراً على النظام</p>
        </div>
      </div>

      <div className="flex gap-5 flex-1 min-h-0">
        {/* ── Sidebar ── */}
        <div className="w-60 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-y-auto flex-shrink-0">
          <div className="p-3.5 border-b border-slate-100 bg-slate-50 sticky top-0">
            <h3 className="font-bold text-slate-600 text-xs uppercase tracking-wider">الفئات</h3>
          </div>
          <div className="p-2 space-y-0.5">
            {sidebarCategories.map(cat => {
              const count = lists.filter(l => l.category === cat.id).length;
              const isActive = activeCategory === cat.id;
              const cfg = IMPACT_CONFIG[cat.impact];
              return (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategory(cat.id); setActiveCertificate(null); }}
                  className={`w-full text-right px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between gap-2 group ${isActive
                      ? 'bg-sky-50 text-sky-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 font-medium'
                    }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <span className="truncate">{cat.label}</span>
                    {cat.isParent && (
                      <Link2 className="w-3 h-3 text-violet-400 flex-shrink-0" />
                    )}
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 font-mono ${isActive ? 'bg-sky-100 text-sky-600' : 'bg-slate-100 text-slate-400'
                    }`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main Panel ── */}
        <div className="flex-1 flex flex-col gap-4 min-h-0">

          {/* ── Context Card ── */}
          {activeMeta && !activeCertificate && (
            <div className={`rounded-2xl border p-4 flex-shrink-0 ${impactCfg.cls}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${impactCfg.cls} border`}>
                    <Info className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-sm">{activeMeta.label}</h3>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${impactCfg.cls}`}>
                        {impactCfg.label}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed opacity-90 max-w-2xl">{activeMeta.description}</p>
                  </div>
                </div>

                {/* Usage locations */}
                {activeMeta.usedIn.length > 0 && (
                  <div className="flex-shrink-0">
                    <p className="text-xs font-bold opacity-70 mb-1.5">يظهر في:</p>
                    <div className="flex flex-col gap-1">
                      {activeMeta.usedIn.map((loc, i) => (
                        <div key={i} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border font-medium ${impactCfg.cls}`}>
                          {loc.icon}
                          <span>{loc.label}</span>
                          <span className="opacity-60 text-[10px] before:content-['—'] before:mr-1">{loc.route}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {activeMeta.isParent && (
                <div className="mt-3 pt-3 border-t border-current/20 flex items-center gap-2 text-xs font-medium opacity-80">
                  <Link2 className="w-3.5 h-3.5" />
                  هذه فئة أب — كل شهادة تمتلك قائمة اختصاصات مستقلة. انقر على أي شهادة لإدارة اختصاصاتها.
                </div>
              )}

              {activeMeta.impact === 'high' && (
                <div className="mt-2 flex items-center gap-1.5 text-xs font-medium opacity-75">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  تعديل أو حذف القيم يؤثر على سجلات موجودة — يُنصح بالتعطيل بدلاً من الحذف.
                </div>
              )}
            </div>
          )}

          {/* Certificate breadcrumb */}
          {isCertificateView && activeCertificate && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl px-5 py-3 flex items-center gap-3 flex-shrink-0">
              <GraduationCap className="w-4 h-4 text-violet-600 flex-shrink-0" />
              <button onClick={() => setActiveCertificate(null)} className="text-sm font-bold text-violet-500 hover:text-violet-700">
                الشهادات العلمية
              </button>
              <ChevronLeft className="w-4 h-4 text-violet-300" />
              <span className="text-sm font-bold text-violet-800">{activeCertificate}</span>
              <span className="text-xs text-violet-500 bg-violet-100 px-2.5 py-1 rounded-full mr-auto">
                هذه الاختصاصات تظهر فقط عند اختيار شهادة "{activeCertificate}" في فورم الشاغر
              </span>
            </div>
          )}

          {/* ── List card ── */}
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-slate-800">{panelTitle()}</h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input type="text" placeholder="بحث..." value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-4 pr-9 py-2 rounded-xl border border-slate-200 text-sm w-48 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none" />
                </div>
                {(!isCertificateView || activeCertificate) && (
                  <button onClick={() => openForm()}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors shadow-sm">
                    <Plus className="w-4 h-4" />
                    {isCertificateView && activeCertificate ? 'إضافة اختصاص' : 'إضافة خيار'}
                  </button>
                )}
                {isCertificateView && !activeCertificate && (
                  <button onClick={() => openForm()}
                    className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors shadow-sm">
                    <Plus className="w-4 h-4" /> إضافة شهادة
                  </button>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-5">
              {loading ? (
                <div className="flex items-center justify-center h-full text-slate-400">جاري التحميل...</div>
              ) : isCertificateView && !activeCertificate ? (
                certificateItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                    <GraduationCap className="w-12 h-12 text-slate-200" />
                    <p>لا توجد شهادات — أضف أولى الشهادات</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {certificateItems.map(cert => {
                      const majorCount = lists.filter(l => l.category === `${MAJOR_PREFIX}${cert.value}`).length;
                      return (
                        <div key={cert.id} className={`rounded-2xl border-2 transition-all ${cert.isActive ? 'bg-white border-slate-200 hover:border-violet-300 hover:shadow-md' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                          <div className="flex items-center justify-between p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center text-xs font-bold border border-violet-100">
                                {cert.displayOrder}
                              </div>
                              <div>
                                <span className={`font-bold text-base ${cert.isActive ? 'text-slate-800' : 'text-slate-500 line-through'}`}>
                                  {cert.value}
                                </span>
                                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                  <Link2 className="w-3 h-3" />
                                  {majorCount > 0 ? `${majorCount} اختصاص مرتبط` : 'لا توجد اختصاصات'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => setActiveCertificate(cert.value)} disabled={!cert.isActive}
                                className="flex items-center gap-1.5 text-xs font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-violet-100">
                                <BookOpen className="w-3.5 h-3.5" /> الاختصاصات
                              </button>
                              <button onClick={() => toggleActive(cert)} className={`p-1.5 rounded-lg ${cert.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-200'}`}>
                                {cert.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                              </button>
                              <button onClick={() => openForm(cert)} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg"><Edit className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(cert.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                  <ListPlus className="w-12 h-12 text-slate-200" />
                  <p>لا توجد خيارات بعد</p>
                  {isCertificateView && activeCertificate && (
                    <p className="text-xs text-slate-400 bg-slate-50 px-4 py-2 rounded-xl">
                      أضف اختصاصات تنتمي لشهادة "{activeCertificate}"
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredItems.map(item => (
                    <div key={item.id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${item.isActive ? 'bg-white border-slate-200 hover:border-sky-300' : 'bg-slate-50 border-slate-200 opacity-70'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold font-mono">
                          {item.displayOrder}
                        </div>
                        <div>
                          <span className={`font-semibold ${item.isActive ? 'text-slate-800' : 'text-slate-500 line-through'}`}>{item.value}</span>
                          {!item.isActive && <span className="text-xs text-red-500 mr-2 bg-red-50 px-2 py-0.5 rounded-full">معطل</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => toggleActive(item)} className={`p-2 rounded-lg transition-colors ${item.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-200'}`} title={item.isActive ? 'تعطيل' : 'تفعيل'}>
                          {item.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button onClick={() => openForm(item)} className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(item.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Item Modal ── */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <Tag className="w-5 h-5 text-sky-500" />
                {editingItem ? 'تعديل خيار' : `إضافة — ${panelTitle()}`}
              </h3>
              <button onClick={() => setIsItemModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-5">
              {isCertificateView && activeCertificate && !editingItem && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 text-sm text-violet-700 flex items-center gap-2">
                  <Link2 className="w-4 h-4 flex-shrink-0" />
                  سيتم ربط هذا الاختصاص بشهادة: <strong className="mr-1">{activeCertificate}</strong>
                </div>
              )}
              {activeMeta && !editingItem && (
                <div className={`rounded-xl px-4 py-2.5 text-xs flex items-center gap-2 border ${impactCfg.cls}`}>
                  <Info className="w-3.5 h-3.5 flex-shrink-0" />
                  {activeMeta.description}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">
                  {isCertificateView && activeCertificate ? 'اسم الاختصاص' : 'القيمة / الاسم'}
                </label>
                <input required autoFocus value={formValue} onChange={e => setFormValue(e.target.value)}
                  placeholder={isCertificateView && activeCertificate ? 'مثال: هندسة حاسبات' : 'أدخل القيمة...'}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">ترتيب الظهور</label>
                <input type="number" required min="0" value={formOrder} onChange={e => setFormOrder(parseInt(e.target.value))}
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none" />
                <p className="text-xs text-slate-400">الأرقام الأصغر تظهر أولاً في القائمة</p>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setIsItemModalOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl">إلغاء</button>
                <button type="submit" className="bg-sky-500 hover:bg-sky-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm">
                  <Save className="w-4 h-4" /> حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New Category Modal ── */}
      {isNewCatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-indigo-500" /> إضافة فئة جديدة
              </h3>
              <button onClick={() => setIsNewCatOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleAddNewCategory} className="p-6 space-y-5">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700">
                بعد الإنشاء، انتقل للفئة الجديدة وأضف خياراتها من الصفحة الرئيسية.
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">الاسم العربي (للعرض)</label>
                <input required autoFocus value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                  placeholder="مثال: المناطق الجغرافية"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-700">المعرف الإنجليزي</label>
                <input required value={newCatId} onChange={e => setNewCatId(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                  placeholder="مثال: regions"
                  className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-200 outline-none font-mono" />
                <p className="text-xs text-slate-400">يُستخدم داخلياً — بالأحرف الإنجليزية فقط بدون مسافات</p>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setIsNewCatOpen(false)} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl">إلغاء</button>
                <button type="submit" className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm">
                  <FolderPlus className="w-4 h-4" /> إنشاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
