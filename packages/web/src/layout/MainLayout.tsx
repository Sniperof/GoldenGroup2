import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuthStore } from '../hooks/useAuthStore';
import { usePermissions } from '../hooks/usePermissions';
import { useBranchContextStore } from '../hooks/useBranchContextStore';
import { canSeeFieldVisitManagementSurface } from '../lib/fieldVisitPermissionPolicy';
import { isGlobalOnlyPath } from '../lib/branchContext';
import FloatingActionButton from '../components/FloatingActionButton';
import AddCandidateModal from '../components/candidates/AddCandidateModal';
import NewServiceRequestModal from '../components/service-requests/NewServiceRequestModal';
import BranchSwitcher from '../components/BranchSwitcher';
import logoMark from '../assets/logo-mark.png';
import {
  LayoutDashboard, Route, Users, BookUser, Globe, ClipboardList, UsersRound, Calendar,
  MapPinned, ChevronDown, Gem, Eye, Briefcase, AlertTriangle, DollarSign,
  RefreshCw, Headset, Settings, UserPlus, Menu, X as CloseIcon, ChevronRight,
  BadgeCheck, GraduationCap, Mic2, LogOut, Building2, SlidersHorizontal,
  ShieldCheck, Shield, Monitor, Settings2, GalleryHorizontal, BellRing, Bell,
  Wrench, Gift, LayoutGrid, UserCheck, CalendarCheck, Layers, HardDrive,
  Unplug, Beaker, Package, ClipboardCheck, Link2, BarChart3, FilePlus2, FileText,
} from '../components/ui/icons';

type Icon = ComponentType<{ className?: string }>;
const DRAWER_OPEN_SECTIONS_KEY = 'golden.drawer.openSections';
const DRAWER_GROUP_ICONS: Record<string, Icon> = {
  'طلبات المبيعات والشراكات': UserCheck,
  'التخطيط والجدولة': Calendar,
  'التنفيذ الميداني': MapPinned,
  'طلبات متخصصة': Package,
  'أدوات الخدمة': Settings2,
  'التنظيم والتغطية': MapPinned,
  'المستخدمون والوصول': Shield,
  'ضبط النظام': Settings2,
  'تطبيق الزبائن': GalleryHorizontal,
};

export type DrawerNavigationItem = {
  path: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  dividerLabel?: string;
};

export type DrawerNavigationSection = {
  id: string;
  label: string;
  icon: Icon;
  items: DrawerNavigationItem[];
};

export function drawerItemMatchesPath(item: DrawerNavigationItem, pathname: string) {
  return item.exact ? pathname === item.path : pathname === item.path || pathname.startsWith(`${item.path}/`);
}

type DrawerItemBlock =
  | { kind: 'item'; item: DrawerNavigationItem }
  | { kind: 'group'; label: string; items: DrawerNavigationItem[] };

function groupDrawerItems(items: DrawerNavigationItem[]): DrawerItemBlock[] {
  const blocks: DrawerItemBlock[] = [];
  for (const item of items) {
    if (!item.dividerLabel) {
      blocks.push({ kind: 'item', item });
      continue;
    }
    const previous = blocks.at(-1);
    if (previous?.kind === 'group' && previous.label === item.dividerLabel) {
      previous.items.push(item);
    } else {
      blocks.push({ kind: 'group', label: item.dividerLabel, items: [item] });
    }
  }
  return blocks;
}

function DrawerChildLink({ item, pathname, onNavigate, grouped = false }: {
  item: DrawerNavigationItem;
  pathname: string;
  onNavigate: () => void;
  grouped?: boolean;
}) {
  const ItemIcon = item.icon;
  return (
    <NavLink
      to={item.path}
      end={item.exact}
      onClick={onNavigate}
      className={() => `w-full flex items-center gap-3 ${grouped ? 'pr-5 pl-3 py-2' : 'pr-12 pl-4 py-2.5'} rounded-lg no-pill transition-all text-right text-sm leading-snug ${drawerItemMatchesPath(item, pathname) ? 'text-sky-700 bg-sky-50 font-medium' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      <ItemIcon className="w-4 h-4 shrink-0" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function DrawerSection({ section, pathname, isOpen, isCollapsed, onToggle, onNavigate }: {
  section: DrawerNavigationSection;
  pathname: string;
  isOpen: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const active = section.items.some(item => drawerItemMatchesPath(item, pathname));
  const SectionIcon = section.icon;
  const itemBlocks = groupDrawerItems(section.items);
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        title={isCollapsed ? section.label : undefined}
        aria-expanded={isOpen}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg no-pill transition-all text-right ${active ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'} ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}
      >
        <SectionIcon className={`w-5 h-5 shrink-0 ${isCollapsed ? 'lg:w-6 lg:h-6' : ''}`} />
        <span className={`flex-1 font-medium ${isCollapsed ? 'lg:hidden' : ''}`}>{section.label}</span>
        <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }} className={isCollapsed ? 'lg:hidden' : ''}>
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && !isCollapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden flex flex-col gap-0.5 mt-0.5">
            {itemBlocks.map(block => {
              if (block.kind === 'item') {
                return <DrawerChildLink key={block.item.path} item={block.item} pathname={pathname} onNavigate={onNavigate} />;
              }
              const groupActive = block.items.some(item => drawerItemMatchesPath(item, pathname));
              const GroupIcon = DRAWER_GROUP_ICONS[block.label] ?? block.items[0].icon;
              return (
                <div
                  key={`${section.id}-${block.label}`}
                  className={`relative mr-5 pr-3 border-r-2 ${groupActive ? 'border-sky-500' : 'border-slate-200'}`}
                >
                  <span className={`absolute -right-[5px] top-3 w-2 h-2 rounded-full ring-2 ring-white ${groupActive ? 'bg-sky-600' : 'bg-sky-300'}`} />
                  <div className={`flex items-center gap-2 pr-2 pt-2 pb-1.5 text-[13px] leading-5 font-bold ${groupActive ? 'text-sky-800' : 'text-slate-700'}`}>
                    <GroupIcon className={`w-4 h-4 ${groupActive ? 'text-sky-600' : 'text-slate-400'}`} />
                    <span>{block.label}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 pb-2">
                    {block.items.map(item => (
                      <DrawerChildLink key={item.path} item={item} pathname={pathname} onNavigate={onNavigate} grouped />
                    ))}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: authUser, logout, grants } = useAuthStore();
  const { hasPermission } = usePermissions();
  const { branchId: selectedBranchId } = useBranchContextStore();
  const isSuperAdmin = authUser?.isSuperAdmin === true;
  const isPrivilegedUser = isSuperAdmin || authUser?.role === 'HR_MANAGER' || authUser?.role === 'ADMIN';
  const can = (permission: string) => isPrivilegedUser || hasPermission(permission);
  const canAccessAdminSurface = (...permissions: string[]) => permissions.some(permission => hasPermission(permission));
  const hasBranchScopedPermission = grants.some(grant => grant.scope === 'BRANCH' || grant.scope === 'ASSIGNED');
  const canSeeBranchModules = hasBranchScopedPermission || (isSuperAdmin && selectedBranchId != null) || isPrivilegedUser;
  const canSeeReports = isSuperAdmin || grants.some(grant => grant.permission.startsWith('reports.') && grant.permission.endsWith('.view'));
  const canSeeFieldVisits = canSeeFieldVisitManagementSurface({ grants, isSuperAdmin });
  const isGlobalOnlyPage = isGlobalOnlyPath(location.pathname);

  const sections: DrawerNavigationSection[] = [
    { id: 'home', label: 'الرئيسية', icon: LayoutDashboard, items: [
      { path: '/', label: 'لوحة المتابعة', icon: LayoutDashboard, exact: true },
      ...(can('tasks.my_customers.view') ? [{ path: '/tasks/group/my-customers', label: 'مهامي', icon: ClipboardList }] : []),
      ...(can('field_visits.my_visits.view') ? [{ path: '/my-visits', label: 'زياراتي', icon: CalendarCheck }] : []),
      ...(canSeeBranchModules && can('tasks.supervisor_alerts.view') ? [{ path: '/supervisor/alerts', label: 'تنبيهات المشرف', icon: Bell }] : []),
    ] },
    { id: 'sales', label: 'المبيعات والزبائن', icon: BookUser, items: [
      ...(can('clients.view_list') ? [{ path: '/clients', label: 'الزبائن', icon: BookUser }] : []),
      ...(can('candidates.view_list') ? [{ path: '/candidates', label: 'الأسماء المقترحة', icon: UserPlus }] : []),
      ...(canSeeBranchModules && can('telemarketing.lists.view') ? [{ path: '/telemarketer', label: 'الاتصالات والمواعيد', icon: Headset }] : []),
      ...(canSeeBranchModules && can('tasks.demo.view') ? [{ path: '/tasks/group/device-demo', label: 'عروض الأجهزة', icon: Monitor }] : []),
      ...(can('contracts.view_list') ? [{ path: '/contracts', label: 'العقود', icon: FileText }] : []),
      ...(canSeeBranchModules && can('tasks.collection.view') ? [{ path: '/tasks/group/collection', label: 'تحصيل الذمم', icon: DollarSign }] : []),
      ...(can('complaints.view_list') ? [{ path: '/complaints', label: 'الشكاوى', icon: AlertTriangle }] : []),
      ...(canSeeBranchModules && can('name_nomination.view') ? [{ path: '/service-requests/name-nomination', label: 'طلبات ترشيح الأسماء', icon: UserCheck, dividerLabel: 'طلبات المبيعات والشراكات' }] : []),
      ...(canSeeBranchModules && can('agent_license.view') ? [{ path: '/service-requests/agent-license', label: 'طلبات ترخيص الوكلاء', icon: ClipboardCheck, dividerLabel: 'طلبات المبيعات والشراكات' }] : []),
    ] },
    { id: 'service', label: 'الخدمة الميدانية', icon: Wrench, items: canSeeBranchModules ? [
      ...(can('service_requests.view') ? [{ path: '/service-requests', label: 'طلبات الخدمة', icon: Wrench, exact: true }] : []),
      ...(can('planning.view') ? [
        { path: '/planning/overview', label: 'ملخص الخطة', icon: Eye, dividerLabel: 'التخطيط والجدولة' },
        { path: '/planning/schedule', label: 'جدولة الفرق', icon: UsersRound, dividerLabel: 'التخطيط والجدولة' },
        { path: '/planning/zone-study', label: 'دراسة النطاقات', icon: LayoutGrid, dividerLabel: 'التخطيط والجدولة' },
        { path: '/planning/assign', label: 'تعيين المسارات', icon: MapPinned, dividerLabel: 'التخطيط والجدولة' },
      ] : []),
      ...(canSeeFieldVisits ? [{ path: '/field-visits', label: 'الزيارات الميدانية', icon: MapPinned, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.delivery.view') ? [{ path: '/tasks/group/device-delivery', label: 'تسليم الأجهزة', icon: Package, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.installation.view') ? [{ path: '/tasks/group/device-installation', label: 'تركيب الأجهزة', icon: Wrench, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.activation.view') ? [{ path: '/tasks/group/device-activation', label: 'تشغيل الأجهزة', icon: Monitor, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.maintenance.view') ? [{ path: '/tasks/group/maintenance', label: 'الصيانة والأعطال', icon: Wrench, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.after_sales.view') ? [{ path: '/tasks/group/after-sale-services', label: 'خدمات ما بعد البيع', icon: RefreshCw, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.disconnection.view') ? [{ path: '/tasks/group/device-disconnection', label: 'فك الأجهزة', icon: Unplug, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('tasks.warranty.view') ? [{ path: '/tasks/group/warranty-services', label: 'خدمات الكفالة', icon: ShieldCheck, dividerLabel: 'التنفيذ الميداني' }] : []),
      ...(can('periodic_maintenance.view') ? [{ path: '/service-requests/periodic-maintenance', label: 'طلبات الصيانة الدورية', icon: Wrench, dividerLabel: 'طلبات متخصصة' }] : []),
      ...(can('water_check.view') ? [{ path: '/service-requests/water-check', label: 'طلبات فحص المياه', icon: Beaker, dividerLabel: 'طلبات متخصصة', exact: true }] : []),
      ...(can('service_requests.view') ? [{ path: '/service-requests/device-requests', label: 'طلبات الأجهزة', icon: Package, dividerLabel: 'طلبات متخصصة' }] : []),
      ...(can('golden_warranty.view') ? [{ path: '/service-requests/golden-warranty', label: 'طلبات الكفالة الذهبية', icon: ShieldCheck, dividerLabel: 'طلبات متخصصة' }] : []),
      ...(can('water_check.create') ? [{ path: '/service-requests/water-check/simulator', label: 'محاكاة فحص المياه', icon: FilePlus2, dividerLabel: 'أدوات الخدمة' }] : []),
    ] : [] },
    { id: 'gifts', label: 'الهدايا', icon: Gift, items: canSeeBranchModules && can('tasks.gifts.view') ? [
      { path: '/gifts', label: 'سجل الهدايا', icon: Gift },
      { path: '/tasks/group/gift-delivery', label: 'مهام تسليم الهدايا', icon: CalendarCheck },
    ] : [] },
    { id: 'devices', label: 'الأجهزة والمخزون', icon: Gem, items: [
      ...((can('devices.nav') || can('devices.view') || can('device_models.manage') || can('spare_parts.manage')) ? [{ path: '/devices', label: 'دليل الأجهزة وقطع الغيار', icon: Gem }] : []),
      ...(can('installed_devices.view') ? [{ path: '/installed-devices', label: 'الأجهزة المركّبة', icon: HardDrive }] : []),
    ] },
    { id: 'hr', label: 'الموارد البشرية', icon: Users, items: [
      ...(can('employees.nav') ? [{ path: '/employees', label: 'الموظفون', icon: Users }] : []),
      ...(canAccessAdminSurface('departments.view_list') ? [{ path: '/departments', label: 'الأقسام', icon: Layers }] : []),
      ...(can('jobs.vacancies.view_list') ? [{ path: '/jobs/vacancies', label: 'الشواغر', icon: Briefcase }] : []),
      ...(can('jobs.applications.view_list') ? [{ path: '/jobs/applications', label: 'طلبات التوظيف', icon: ClipboardList }] : []),
      ...(can('jobs.interviews.view_list') ? [{ path: '/jobs/interviews', label: 'المقابلات', icon: Mic2 }] : []),
      ...(can('jobs.training.view_list') ? [{ path: '/jobs/training-courses', label: 'الدورات التدريبية', icon: GraduationCap }] : []),
      ...(can('jobs.vacancies.view_list') ? [{ path: '/jobs/public', label: 'صفحة الوظائف العامة', icon: BadgeCheck }] : []),
    ] },
    { id: 'reports', label: 'التقارير', icon: BarChart3, items: canSeeReports ? [{ path: '/reports', label: 'مركز التقارير', icon: BarChart3 }] : [] },
    { id: 'admin', label: 'الإدارة والإعدادات', icon: Settings, items: [
      ...(canAccessAdminSurface('branches.nav', 'branches.view') ? [{ path: '/branches', label: 'الفروع', icon: Building2, dividerLabel: 'التنظيم والتغطية' }] : []),
      ...(canAccessAdminSurface('geo.view') ? [
        { path: '/geo', label: 'المناطق الإدارية', icon: Globe, dividerLabel: 'التنظيم والتغطية' },
        { path: '/routes', label: 'خطوط السير', icon: Route, dividerLabel: 'التنظيم والتغطية' },
      ] : []),
      ...(can('admin.users.view_list') ? [{ path: '/admin/users', label: 'المستخدمون', icon: Users, dividerLabel: 'المستخدمون والوصول' }] : []),
      ...(canAccessAdminSurface('admin.roles.view') ? [{ path: '/admin/roles', label: 'الأدوار والصلاحيات', icon: ShieldCheck, dividerLabel: 'المستخدمون والوصول' }] : []),
      ...(isSuperAdmin ? [{ path: '/admin/permissions-settings', label: 'نطاقات الصلاحيات', icon: Shield, dividerLabel: 'المستخدمون والوصول' }] : []),
      ...(canSeeBranchModules && can('account_requests.view') ? [{ path: '/account-requests', label: 'طلبات إنشاء الحساب', icon: UserPlus, dividerLabel: 'المستخدمون والوصول' }] : []),
      ...(canAccessAdminSurface('admin.system_lists.view') ? [{ path: '/system-lists', label: 'القوائم المرجعية', icon: SlidersHorizontal, dividerLabel: 'ضبط النظام' }] : []),
      ...(canAccessAdminSurface('admin.task_types.view') ? [{ path: '/admin/task-types', label: 'أنواع المهام', icon: Settings2, dividerLabel: 'ضبط النظام' }] : []),
      ...(canAccessAdminSurface('settings.view') ? [{ path: '/settings', label: 'إعدادات النظام', icon: Settings, dividerLabel: 'ضبط النظام' }] : []),
      ...(canSeeBranchModules && can('tasks.demo.view') ? [{ path: '/tasks/evaluation-lab', label: 'تقييم المهام', icon: Beaker, dividerLabel: 'ضبط النظام' }] : []),
      ...(canAccessAdminSurface('admin.app_home_banners.view') ? [{ path: '/admin/app-home-banners', label: 'بانرات التطبيق', icon: GalleryHorizontal, dividerLabel: 'تطبيق الزبائن' }] : []),
      ...(canAccessAdminSurface('admin.app_notifications.view') ? [{ path: '/admin/app-notifications', label: 'إشعارات التطبيق', icon: BellRing, dividerLabel: 'تطبيق الزبائن' }] : []),
      ...(canAccessAdminSurface('admin.app_contact_links.view') ? [{ path: '/admin/app-contact-links', label: 'روابط التطبيق', icon: Link2, dividerLabel: 'تطبيق الزبائن' }] : []),
    ] },
  ].filter(section => section.items.length > 0);

  const activeSectionId = sections.find(section => section.items.some(item => drawerItemMatchesPath(item, location.pathname)))?.id;
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAWER_OPEN_SECTIONS_KEY) || '[]');
      const initial = new Set<string>(Array.isArray(saved) ? saved : []);
      initial.add(activeSectionId || 'home');
      return initial;
    } catch {
      return new Set(activeSectionId ? [activeSectionId] : ['home']);
    }
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showCandidateModal, setShowCandidateModal] = useState(false);
  const [showServiceRequestModal, setShowServiceRequestModal] = useState(false);
  const [candidateInitialMode, setCandidateInitialMode] = useState(false);

  useEffect(() => {
    if (!activeSectionId) return;
    setOpenSections(previous => {
      if (previous.has(activeSectionId)) return previous;
      const next = new Set(previous);
      next.add(activeSectionId);
      return next;
    });
  }, [activeSectionId]);

  useEffect(() => {
    sessionStorage.setItem(DRAWER_OPEN_SECTIONS_KEY, JSON.stringify([...openSections]));
  }, [openSections]);

  function toggleSection(sectionId: string) {
    if (isCollapsed) {
      setIsCollapsed(false);
      setOpenSections(previous => new Set(previous).add(sectionId));
      return;
    }
    setOpenSections(previous => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
      return next;
    });
  }

  function handleLogout() { logout(); navigate('/login'); }
  const roleLabel = authUser?.roleDisplayName ?? (authUser?.role === 'ADMIN' ? 'مدير النظام' : authUser?.role === 'HR_MANAGER' ? 'مدير الموارد البشرية' : authUser?.role === 'SYSTEM_ADMIN' ? 'مدير النظام' : authUser?.role === 'HR_ASSISTANT' ? 'مساعد الموارد البشرية' : authUser?.role ? 'دور نظامي محمي' : 'بدون دور');

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-30">
        <div dir="ltr" className="flex items-center gap-3"><img src={logoMark} alt="Golden Group" className="w-8 h-8 object-contain" /><span className="text-lg font-bold text-slate-800">Golden Group</span></div>
        <button type="button" onClick={() => setIsMobileMenuOpen(open => !open)} aria-label={isMobileMenuOpen ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={isMobileMenuOpen} className="p-2 rounded-lg text-slate-600 hover:bg-slate-100">{isMobileMenuOpen ? <CloseIcon className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
      </header>
      <AnimatePresence>{isMobileMenuOpen && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40" />}</AnimatePresence>
      <aside className={`fixed lg:static inset-y-0 right-0 ${isCollapsed ? 'lg:w-20' : 'lg:w-72'} w-72 bg-white border-l border-slate-200 flex flex-col z-50 shadow-sm flex-shrink-0 transition-all duration-300 transform ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>
        <div className={`p-5 border-b border-slate-100 flex items-center justify-between ${isCollapsed ? 'lg:justify-center' : ''}`}>
          <div dir="ltr" className="flex items-center gap-3"><img src={logoMark} alt="Golden Group" onClick={() => isCollapsed && setIsCollapsed(false)} title={isCollapsed ? 'توسيع القائمة' : undefined} className={`w-8 h-8 object-contain shrink-0 ${isCollapsed ? 'lg:cursor-pointer' : ''}`} /><span className={`text-lg font-bold text-slate-800 ${isCollapsed ? 'lg:hidden' : ''}`}>Golden Group</span></div>
          <button type="button" onClick={() => setIsCollapsed(true)} aria-label="طيّ الشريط الجانبي" className={`p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 ${isCollapsed ? 'hidden' : 'hidden lg:flex'}`}><ChevronRight className="w-5 h-5" /></button>
          <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="إغلاق القائمة" className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><CloseIcon className="w-6 h-6" /></button>
        </div>
        {!isCollapsed && !isGlobalOnlyPage && <BranchSwitcher />}
        <nav aria-label="القائمة الرئيسية" className="flex-1 overflow-y-auto custom-scroll py-4 px-3 space-y-1 mt-16 lg:mt-0">
          {sections.map(section => <DrawerSection key={section.id} section={section} pathname={location.pathname} isOpen={openSections.has(section.id)} isCollapsed={isCollapsed} onToggle={() => toggleSection(section.id)} onNavigate={() => setIsMobileMenuOpen(false)} />)}
        </nav>
        <div className="p-4 border-t border-slate-200 bg-slate-50/50"><div className={`flex items-center gap-3 p-2 rounded-lg ${isCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
          <div className="relative shrink-0"><img src={`https://ui-avatars.com/api/?name=${encodeURIComponent(authUser?.name || 'HR')}&background=0ea5e9&color=fff`} alt="User" className="w-10 h-10 rounded-full border border-slate-200" /><div className="absolute -bottom-0.5 -left-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white" /></div>
          <div className={`flex-1 min-w-0 ${isCollapsed ? 'lg:hidden' : ''}`}><p className="text-sm font-semibold text-slate-700 truncate">{authUser?.name || '—'}</p><p className="text-xs text-slate-500 truncate">{roleLabel}</p></div>
          <button type="button" onClick={handleLogout} title="تسجيل الخروج" aria-label="تسجيل الخروج" className={`p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-slate-400 ${isCollapsed ? 'lg:hidden' : ''}`}><LogOut className="w-4 h-4" /></button>
        </div></div>
      </aside>
      <main className="flex-1 overflow-y-auto custom-scroll bg-slate-50 mt-16 lg:mt-0"><Outlet /></main>
      <FloatingActionButton onAddSuggested={() => { setCandidateInitialMode(false); setShowCandidateModal(true); }} onAddCandidate={() => { setCandidateInitialMode(true); setShowCandidateModal(true); }} onServiceRequestClick={() => setShowServiceRequestModal(true)} />
      {showServiceRequestModal && <NewServiceRequestModal channel="internal_button" onClose={() => setShowServiceRequestModal(false)} />}
      <AddCandidateModal isOpen={showCandidateModal} onClose={() => setShowCandidateModal(false)} initialDirectMode={candidateInitialMode} />
    </div>
  );
}
