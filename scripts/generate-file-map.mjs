/**
 * Project file map — classifies every source file in packages/{web,api,shared}
 * into the business section (sidebar module) it belongs to, front end vs back end.
 *
 * Usage:  node scripts/generate-file-map.mjs
 * Output: docs/engineering/file-map/PROJECT-FILE-MAP.md
 *         docs/engineering/file-map/project-file-map.csv
 *
 * Method (in order):
 *   1. Explicit RULES (folder / file-name patterns) — first match wins.
 *   2. Files no rule matches inherit the section(s) of the rule-owned files that
 *      import them (transitively). One section → owned by it; 2–5 → "shared";
 *      6+ → core.
 *   3. Tests inherit the section of the file they test.
 * When a new file lands in the wrong section, add or tighten a RULE below.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'packages');
const OUT_DIR = path.join(ROOT, 'docs', 'engineering', 'file-map');

// UI paths per section, as they appear in the sidebar / router (App.tsx).
const UI_PATHS = {
  dashboard: ['/'],
  supervisor_alerts: ['/supervisor/alerts'],
  clients: ['/clients', '/clients/:id'],
  candidates: ['/candidates', '/candidates/:id'],
  telemarketing: ['/telemarketer'],
  device_demo: ['/tasks/group/device-demo'],
  contracts: ['/contracts', '/contracts/new', '/contracts/:id'],
  collection: ['/tasks/group/collection', '/tasks/dues'],
  complaints: ['/complaints', '/complaints/new', '/complaints/:id'],
  sales_requests: ['/service-requests/name-nomination', '/service-requests/agent-license'],
  service_requests: ['/service-requests', '/service-requests/water-check', '/service-requests/device-requests', '/service-requests/periodic-maintenance', '/service-requests/golden-warranty', '/service-requests/:id'],
  planning: ['/planning/overview', '/planning/schedule', '/planning/zone-study', '/planning/assign'],
  field_visits: ['/field-visits', '/field-visits/:id', '/my-visits'],
  post_sale_tasks: ['/tasks/group/device-delivery', '/tasks/group/device-installation', '/tasks/group/device-activation', '/tasks/group/device-disconnection'],
  maintenance: ['/tasks/group/maintenance'],
  warranty: ['/tasks/group/warranty-services'],
  tasks_core: ['/tasks/group/my-customers', '/tasks/open', '/tasks/group/:group'],
  gifts: ['/gifts', '/tasks/group/gift-delivery'],
  devices: ['/devices', '/devices/:id', '/installed-devices', '/installed-devices/:id'],
  employees: ['/employees', '/employees/:id', '/departments'],
  recruitment: ['/jobs/vacancies', '/jobs/applications', '/jobs/interviews', '/jobs/training-courses', '/jobs/public'],
  reports: ['/reports'],
  branches: ['/branches'],
  geo_routes: ['/geo', '/routes'],
  users_roles: ['/admin/users', '/admin/roles', '/admin/permissions-settings'],
  account_requests: ['/account-requests', '/admin/customer-app-users'],
  system_config: ['/system-lists', '/admin/task-types', '/admin/emergency-action-types', '/settings'],
  app_admin: ['/admin/app-home-banners', '/admin/app-notifications', '/admin/app-contact-links'],
  auth: ['/login'],
};

// Sections with no route file of their own: their endpoints live inside routes
// owned by another section.
const API_NOTES = {
  supervisor_alerts: '`/api/open-tasks/attempt-alerts` و`/api/field-visits/escalation-alerts` (داخل مسارات المهام والزيارات)',
  device_demo: '`/api/open-tasks/device-demo` وبقية عمليات المهمة عبر `/api/open-tasks` (محرك المهام المشترك)',
  sales_requests: '`/api/service-requests` (نفس مسار طلبات الخدمة، بنوعي الطلب `name_nomination` و`agent_license`)',
  post_sale_tasks: 'لا يوجد مسار مستقل: قراءة المهام عبر `/api/open-tasks`، وتسجيل النتائج عبر `/api/field-visits` من داخل الزيارة',
  dashboard: 'أرقام الودجات نفسها تأتي من `/api/reports/<metric>` (خدمات المؤشرات في قسم التقارير)',
};

// ── Sections (sidebar order) ────────────────────────────────────────────────
const SECTIONS = [
  ['dashboard', 'لوحة المتابعة', 'الرئيسية'],
  ['supervisor_alerts', 'تنبيهات المتابعة', 'الرئيسية'],
  ['clients', 'الزبائن', 'المبيعات والزبائن'],
  ['candidates', 'الأسماء المقترحة وجلسات الترشيح', 'المبيعات والزبائن'],
  ['telemarketing', 'الاتصالات والمواعيد', 'المبيعات والزبائن'],
  ['device_demo', 'عروض الأجهزة', 'المبيعات والزبائن'],
  ['contracts', 'العقود', 'المبيعات والزبائن'],
  ['collection', 'تحصيل الذمم', 'المبيعات والزبائن'],
  ['complaints', 'الشكاوى', 'المبيعات والزبائن'],
  ['sales_requests', 'طلبات ترشيح الأسماء وترخيص الوكلاء', 'المبيعات والزبائن'],
  ['service_requests', 'طلبات الخدمة (عامة، فحص المياه، الأجهزة، الصيانة الدورية، الكفالة الذهبية)', 'الخدمة الميدانية'],
  ['planning', 'التخطيط والجدولة', 'الخدمة الميدانية'],
  ['field_visits', 'الزيارات الميدانية وزياراتي', 'الخدمة الميدانية'],
  ['post_sale_tasks', 'تسليم وتركيب وتشغيل وفك الأجهزة', 'الخدمة الميدانية'],
  ['maintenance', 'الصيانة والأعطال', 'الخدمة الميدانية'],
  ['warranty', 'خدمات الكفالة', 'الخدمة الميدانية'],
  ['tasks_core', 'محرك المهام المشترك ومهامي', 'الخدمة الميدانية'],
  ['gifts', 'الهدايا', 'الهدايا'],
  ['devices', 'الأجهزة وقطع الغيار والأجهزة المركّبة', 'الأجهزة والمخزون'],
  ['employees', 'الموظفون والأقسام', 'الموارد البشرية'],
  ['recruitment', 'التوظيف (الشواغر، الطلبات، المقابلات، الدورات)', 'الموارد البشرية'],
  ['reports', 'التقارير', 'التقارير'],
  ['branches', 'الفروع', 'الإدارة والإعدادات'],
  ['geo_routes', 'المناطق الإدارية وخطوط السير', 'الإدارة والإعدادات'],
  ['users_roles', 'المستخدمون والأدوار والصلاحيات', 'الإدارة والإعدادات'],
  ['account_requests', 'طلبات إنشاء الحساب', 'الإدارة والإعدادات'],
  ['system_config', 'القوائم المرجعية وأنواع المهام وإعدادات النظام', 'الإدارة والإعدادات'],
  ['app_admin', 'إدارة تطبيق الزبائن (البانرات، الإشعارات، الروابط)', 'الإدارة والإعدادات'],
  ['mobile_app', 'واجهة تطبيق الزبائن (موبايل) — خادم فقط', 'خارج القائمة'],
  ['auth', 'تسجيل الدخول والجلسة', 'خارج القائمة'],
  ['core', 'البنية الأساسية المشتركة', 'خارج القائمة'],
];
const SECTION_IDS = new Set(SECTIONS.map((s) => s[0]));

// ── Explicit ownership rules: [section, regex on path relative to packages/] ─
// First match wins, so the more specific rules come first.
const R = (s, ...res) => res.map((re) => [s, re]);
const RULES = [
  // mobile app back end (before domain rules: e.g. mobileNameNominationIntake)
  ...R('mobile_app',
    /^api\/routes\/app(?!HomeBanners|ContactLinks)[A-Z]\w*\.ts$/, /^api\/routes\/publicAccountDeletion/, /^api\/routes\/mobileServiceRequestMedia/,
    /^api\/services\/serviceRequests\/mobile\w*/, /^api\/services\/appAccounts\/(?!admin|appAccountList)/, /^api\/services\/otp\//,
    /^api\/services\/appNotifications\/(?!broadcast)/, /^api\/services\/app(Branch|Device)CatalogService/, /^api\/middleware\/(appAuth|rateLimit)/,
    /^api\/services\/complaints\/mobileComplaintService/, /^api\/services\/geo\/mobileServiceAddress/),
  ...R('app_admin',
    /^web\/src\/pages\/admin\/App(HomeBanners|Notifications|ContactLinks)/, /^api\/routes\/(appHomeBanners|adminAppNotifications|appContactLinks)/,
    /^api\/services\/(appHomeBanners|appContactLinks)/, /^api\/services\/appNotifications\/broadcast/),
  ...R('account_requests',
    /^web\/src\/pages\/account-requests\//, /^web\/src\/pages\/admin\/CustomerAppUsers/, /^shared\/appAccounts/,
    /^api\/routes\/(adminAccountRequests|adminAppAccounts)/,
    /^api\/services\/appAccounts\/(admin\w*|appAccountList\w*)/, /^web\/src\/components\/appAccounts\//),
  ...R('auth',
    /^web\/src\/pages\/auth\//, /^api\/routes\/auth\.ts/, /^api\/services\/(authService|sessionUserService)/, /^api\/repositories\/authRepository/,
    /^api\/middleware\/auth\.ts/, /^web\/src\/hooks\/useAuthStore/),
  ...R('dashboard',
    /^web\/src\/pages\/Dashboard\./, /^web\/src\/components\/dashboard\//, /^api\/routes\/dashboardLayout/, /^api\/services\/reporting\/dashboardLayoutPolicy/),
  ...R('supervisor_alerts',
    /^web\/src\/(pages|components)\/supervisor\//, /^api\/policies\/supervisorAlertPolicy/, /^api\/services\/visitEscalationJob/),
  ...R('sales_requests',
    /^web\/src\/pages\/service-requests\/(NameNomination|AgentLicense)/, /^web\/src\/components\/service-requests\/(NameNomination|AgentLicense)/,
    /^api\/policies\/(agentLicensePolicy|nameNominationPolicy)/, /^api\/services\/serviceRequests\/(agentLicense|nameNomination)\w*/),
  ...R('complaints',
    /^web\/src\/pages\/complaints\//, /^api\/routes\/complaints\./, /^api\/policies\/complaintPolicy/, /^api\/services\/complaints\//, /^shared\/complaints\./),
  ...R('gifts',
    /^web\/src\/pages\/gifts\//, /^web\/src\/components\/gifts\//, /^web\/src\/pages\/tasks\/GiftDeliveryTaskDetail/, /^web\/src\/data\/gifts/,
    /^web\/src\/taskTypes\/gift_delivery/, /^web\/src\/pages\/(clientProfile\/GiftsTab|contracts\/ContractGiftsPanel)/,
    /^api\/routes\/gifts\./, /^api\/policies\/giftPolicy/, /^api\/services\/(gift\w*|referralGiftPromises)/, /^api\/routes\/(giftPromiseConditions|referralGiftPromiseRoutes)/,
    /^api\/policies\/referralGiftPromiseAuthorization/),
  ...R('collection',
    /^web\/src\/pages\/tasks\/(CollectionTaskDetail|Dues)/, /^web\/src\/components\/CollectionModal/, /^web\/src\/hooks\/useCollectionStore/,
    /^web\/src\/taskTypes\/installment_collection/, /^api\/routes\/dues\./, /^api\/services\/installmentCollectionTasks/),
  ...R('device_demo',
    /^web\/src\/pages\/tasks\/DeviceDemoDetail/, /^web\/src\/taskTypes\/device_demo/),
  ...R('warranty',
    /^web\/src\/pages\/tasks\/WarrantyServicesTaskDetail/, /^web\/src\/components\/warranty\//, /^web\/src\/taskTypes\/golden_warranty/,
    /^web\/src\/components\/devices\/WarrantyStatusBadge/,
    /^api\/routes\/deviceWarranties/, /^api\/services\/goldenWarrantyCardDelivery/),
  ...R('maintenance',
    /^web\/src\/pages\/tasks\/EmergencyTaskDetail/, /^web\/src\/components\/emergency\//, /^web\/src\/taskTypes\/emergency_maintenance/,
    /^api\/routes\/(emergencyTickets|emergencyResult)/, /^api\/services\/emergencyDirectWorkshopRetrieval/, /^shared\/membraneEfficiency/),
  ...R('post_sale_tasks',
    /^web\/src\/pages\/tasks\/PostSaleTaskDetail/, /^web\/src\/taskTypes\/device_delivery/,
    /^api\/services\/deviceDeliverySuspension/, /^api\/policies\/deviceDeliverySuspensionPolicy/, /^shared\/deviceTaskEligibility/,
    /^api\/services\/deviceTaskEligibilityGuard/),
  ...R('service_requests',
    /^web\/src\/pages\/service-requests\//, /^web\/src\/components\/(service-requests|requests)\//, /^web\/src\/lib\/serviceRequestDisplay/,
    /^web\/src\/pages\/clientProfile\/ServiceRequestsTab/,
    /^api\/routes\/(serviceRequests|maintenanceRequests)\./, /^api\/services\/serviceRequests\//,
    /^api\/policies\/(serviceRequestPartyLinkPolicy|periodicMaintenanceRequestPolicy)/, /^api\/services\/periodicMaintenanceTasks/),
  ...R('planning',
    /^web\/src\/pages\/planning\//, /^api\/routes\/(planning|zoneStudy|schedules|routeAssignments|workScopes)\./,
    /^api\/policies\/routeAssignmentPolicy/, /^api\/services\/(planning\w*|teamPlanningScope|zoneStudy)/, /^shared\/workCoverage/),
  ...R('field_visits',
    /^web\/src\/pages\/visits\//, /^web\/src\/components\/(fieldVisits|marketing-visits)\//, /^web\/src\/lib\/fieldVisitPermissionPolicy/,
    /^api\/routes\/(fieldVisits|instantVisitOptions)/, /^api\/policies\/fieldVisitPolicy/, /^api\/services\/visit\w*/),
  ...R('telemarketing',
    /^web\/src\/pages\/TelemarketerWorkspace/, /^web\/src\/components\/telemarketing\//, /^web\/src\/hooks\/useTelemarketingStore/,
    /^api\/routes\/(telemarketing\w*|contactTargets)\./, /^api\/policies\/telemarketingServiceTaskPolicy/,
    /^api\/services\/(telemarketing\w*|contactTarget\w*)/, /^shared\/telemarketingOutcomes/),
  ...R('candidates',
    /^web\/src\/pages\/candidates\//, /^web\/src\/components\/candidates\//, /^web\/src\/hooks\/useCandidateStore/,
    /^api\/routes\/(candidates|referralSheets|candidate\w*|giftCandidateFilter)/, /^api\/policies\/(candidatePolicy|referralSheetPolicy)/,
    /^api\/services\/(candidate\w*|referralSheetStats)/),
  ...R('contracts',
    /^web\/src\/pages\/contracts\//, /^web\/src\/hooks\/useContractPrintable/, /^web\/src\/components\/devices\/ServiceAgreementForm/,
    /^api\/routes\/(contracts|contractDocuments|serviceAgreements|contractCustomerLookupRoute)\./, /^api\/policies\/(contract\w*)/,
    /^api\/services\/contract\w*/, /^api\/lib\/contractWarrantyPolicy/, /^api\/templates\//),
  ...R('clients',
    /^web\/src\/pages\/(Clients|ClientProfile|ClientsBulkActivationPolicy|ClientsDeletePolicy|ClientsFilterLoadingPolicy)[.A-Z]/, /^web\/src\/pages\/clientProfile\//,
    /^web\/src\/components\/(clients|customers|preOffers)\//, /^web\/src\/components\/(Client\w*|AssignAgentModal)/, /^web\/src\/hooks\/useClientStore/,
    /^api\/routes\/(clients|customerCalls|customerPreOffers|client\w*)[.A-Z]/, /^api\/policies\/clientPolicy/,
    /^api\/services\/(client\w*|customerOwnership|customerIdentity\/|financialMovements\w*)/, /^api\/lib\/client\w*/),
  ...R('devices',
    /^web\/src\/pages\/(DeviceManagement|DeviceDetail|deviceMediaEditing)/, /^web\/src\/pages\/devices\//, /^web\/src\/components\/devices\//,
    /^web\/src\/pages\/clientProfile\/(DevicesTab|PartsStockTab)/,
    /^api\/routes\/(deviceModels|deviceParts|spareParts|installedDevices|devicePossession)\./, /^api\/policies\/devicePossessionPolicy/,
    /^api\/services\/(device(Possession|Transfer|ModelSales|Serial|Scope)\w*|catalogActiveStateService)/, /^api\/lib\/installationGeoLevel/),
  ...R('employees',
    /^web\/src\/pages\/(Employees|EmployeeDetail|Departments)\./, /^web\/src\/components\/employees\//, /^web\/src\/lib\/employeeMediatorLookup/,
    /^api\/routes\/(employees|departments|employeeCloserLookupPermission)\./, /^api\/services\/employee\w*/, /^api\/repositories\/employee\w*/),
  ...R('recruitment',
    /^web\/src\/pages\/jobs\//, /^web\/src\/hooks\/use(ApplicationList|Interview|Training|Vacancy)Store/, /^web\/src\/lib\/(applicationState|jobMatch)/,
    /^api\/routes\/(vacancies|publicVacancies|publicApplications|adminApplications|interviews|trainingCourses)\./,
    /^api\/policies\/trainingCoursePolicy/, /^api\/services\/(application\w*|interview\w*|trainingCourse\w*|vacancy\w*)/,
    /^api\/repositories\/(application|interview|trainingCourse)\w*/, /^api\/utils\/(recruitmentPolicy|applicationHelpers)/),
  ...R('reports',
    /^web\/src\/pages\/Reports\./, /^web\/src\/lib\/report\w*/, /^api\/routes\/reports\./, /^api\/services\/reporting\//),
  ...R('branches',
    /^web\/src\/pages\/Branches\./, /^api\/routes\/(branches|branchesMobileProfile)\./),
  ...R('geo_routes',
    /^web\/src\/pages\/(GeoSettings|RouteManager)\./, /^web\/src\/components\/geo\//, /^api\/routes\/(geoUnits|routes|publicAreas)\./,
    /^api\/policies\/routePolicy/, /^api\/services\/(geoScopeService|geo\/)/),
  ...R('users_roles',
    /^web\/src\/pages\/admin\/(Roles|Users|RolePermissions|PermissionSettings)/, /^web\/src\/hooks\/useRoleStore/, /^web\/src\/lib\/permissionDisplay/,
    /^api\/routes\/roles\./, /^api\/trpc\/routers\/roles/, /^api\/services\/(role\w*|userBranchAssignmentService)/, /^shared\/contracts\/roles/,
    /^api\/dev-(purge-roles-users|reset-auth-users|reset-single-superadmin)/, /^api\/seed-superadmin/),
  ...R('system_config',
    /^web\/src\/pages\/(SystemSettings)\./, /^web\/src\/pages\/admin\/(SystemLists|TaskTypes|EmergencyActionTypes)/,
    /^web\/src\/hooks\/useSystemList/, /^api\/routes\/(systemLists|systemSettings\w*|taskTypeConfig|emergencyActionTypes)\./,
    /^api\/services\/(systemSettings|referenceValueService)/),
  ...R('tasks_core',
    /^web\/src\/pages\/(OpenTasks)\./, /^web\/src\/pages\/tasks\/(TaskGroupPage|TaskEvaluationLab)/, /^web\/src\/components\/tasks\//,
    /^web\/src\/hooks\/useOpenTaskStore/, /^web\/src\/lib\/(taskRoutes|taskDateStatus|taskDecisionLabels)/, /^web\/src\/taskTypes\/(index|types|registry)/,
    /^api\/routes\/openTasks\./, /^api\/policies\/openTaskPolicy/, /^api\/services\/(openTask\w*|assigneeEligibility|assignedTasks|taskResult\w*)/,
    /^api\/domain\//, /^shared\/taskResultPolicy/),
  ...R('core',
    /^web\/src\/(App|main)\./, /^web\/src\/(vite-env\.d\.ts|index\.css)$/, /^web\/src\/layout\//, /^web\/src\/components\/ui\//, /^web\/src\/assets\//,
    /^web\/src\/lib\/(api|authFetch|deviceClass|trpc|trpc-contract|branchContext|branchScope|createFetchStore|createFilterStore|types|uiId|hiddenFeatures|uploadFile|uploadMedia)\./,
    /^web\/src\/hooks\/(usePermissions|useBranch\w*)/, /^web\/src\/components\/(PermissionGate|RequireBranchContext|BranchSwitcher|BranchScopeIndicator|ErrorBoundary|SmartTable|tableExport|FloatingActionButton)/,
    /^web\/(vite\.config|tsconfig|index\.html|package\.json)/,
    /^api\/(index|start|cluster|db|migrate|swagger)\.ts$/, /^api\/config\//, /^api\/middleware\/(permission|apiErrorHandler)/, /^api\/utils\//,
    /^api\/trpc\/(init|router)/, /^api\/routes\/(media|mediaServe|upload)\./, /^api\/services\/media\//, /^api\/storage\//,
    /^api\/services\/(authorizationService|authorizationScopeCatalog|webDeviceAccessPolicy|deviceClass)/,
    /^shared\/(index|types)\.ts$/, /^shared\/types\//),
];

// ── File collection ─────────────────────────────────────────────────────────
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.turbo'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css|html|sql|docx|json)$/.test(e.name) && !/tsbuildinfo|package\.json|tsconfig/.test(e.name)) files.push(p);
  }
}
walk(path.join(PKG, 'web', 'src'));
walk(path.join(PKG, 'api'));
walk(path.join(PKG, 'shared'));
for (const f of ['web/vite.config.ts', 'web/index.html']) if (fs.existsSync(path.join(PKG, f))) files.push(path.join(PKG, f));

const rel = (p) => path.relative(PKG, p).split(path.sep).join('/');
const all = [...new Set(files.map(rel))].sort();
const set = new Set(all);
const layerOf = (f) => (f.startsWith('web/') ? 'frontend' : f.startsWith('api/') ? 'backend' : 'shared');
const isTest = (f) => /\.test\.tsx?$/.test(f);

// ── Import graph ────────────────────────────────────────────────────────────
function resolve(from, spec) {
  let base;
  if (spec.startsWith('@golden-crm/shared')) {
    const sub = spec.slice('@golden-crm/shared'.length).replace(/^\//, '');
    base = path.posix.join('shared', sub || 'index');
  } else if (spec.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  } else return null;
  base = base.replace(/\.(js|jsx)$/, '');
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (set.has(cand)) return cand;
  return null;
}
const imports = new Map();
const importedBy = new Map(all.map((f) => [f, new Set()]));
for (const f of all) {
  const deps = new Set();
  if (/\.tsx?$/.test(f)) {
    const src = fs.readFileSync(path.join(PKG, f), 'utf8');
    const re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const r = resolve(f, m[1] || m[2] || m[3]);
      if (r && r !== f) deps.add(r);
    }
  }
  imports.set(f, deps);
  for (const d of deps) importedBy.get(d).add(f);
}

// ── Pass 1: explicit rules (tests use their subject's base name) ───────────
const owner = new Map();
const how = new Map();
const ruleMatch = (f) => {
  const probe = isTest(f) ? f.replace(/(\.contract)?\.test(\.tsx?)$/, '$2') : f;
  for (const [s, re] of RULES) if (re.test(probe) || re.test(f)) return s;
  return null;
};
for (const f of all) {
  const s = ruleMatch(f);
  if (s) { owner.set(f, s); how.set(f, 'rule'); }
}

// ── Pass 2: tests without a rule → section of what they import ─────────────
// ── Pass 3: unowned non-test files → sections of their (transitive) importers
function importerSections(f, seen = new Set()) {
  const out = new Set();
  for (const imp of importedBy.get(f)) {
    if (isTest(imp) || seen.has(imp)) continue;
    seen.add(imp);
    if (how.get(imp) === 'rule') out.add(owner.get(imp));
    else for (const s of importerSections(imp, seen)) out.add(s);
  }
  return out;
}
const sharedBy = new Map();
for (const f of all) {
  if (owner.has(f) || isTest(f)) continue;
  const secs = [...importerSections(f)].filter((s) => s !== 'core' || true);
  const nonCore = secs.filter((s) => s !== 'core');
  if (nonCore.length === 1) { owner.set(f, nonCore[0]); how.set(f, 'usage'); }
  else if (nonCore.length > 1) {
    owner.set(f, nonCore.length >= 6 ? 'core' : 'shared');
    how.set(f, nonCore.length >= 6 ? 'widely-used' : 'shared');
    sharedBy.set(f, nonCore);
  } else { owner.set(f, 'core'); how.set(f, secs.length ? 'usage' : 'unreferenced'); }
}
for (const f of all) {
  if (owner.has(f)) continue;
  const subject = f.replace(/(\.contract)?\.test(\.tsx?)$/, '$2');
  if (owner.has(subject)) {
    owner.set(f, owner.get(subject)); how.set(f, 'test-subject');
    if (sharedBy.has(subject)) sharedBy.set(f, sharedBy.get(subject));
    continue;
  }
  const secs = new Set([...imports.get(f)].map((d) => owner.get(d)).filter((s) => s && s !== 'core' && s !== 'shared'));
  if (secs.size === 1) { owner.set(f, [...secs][0]); how.set(f, 'test-subject'); }
  else { owner.set(f, 'core'); how.set(f, 'test-subject'); }
}

// ── Kind of file ────────────────────────────────────────────────────────────
function kindOf(f) {
  if (isTest(f)) return 'اختبار';
  if (f.startsWith('web/')) {
    if (/^web\/src\/pages\//.test(f)) return 'صفحة';
    if (/^web\/src\/components\//.test(f)) return 'مكوّن واجهة';
    if (/^web\/src\/hooks\//.test(f)) return 'حالة (store/hook)';
    if (/^web\/src\/taskTypes\//.test(f)) return 'تعريف نوع مهمة';
    return 'مساعد/إعداد';
  }
  if (f.startsWith('api/')) {
    if (/^api\/routes\//.test(f)) return 'مسار API';
    if (/^api\/policies\//.test(f)) return 'سياسة صلاحيات';
    if (/^api\/services\//.test(f)) return 'خدمة/منطق عمل';
    if (/^api\/repositories\//.test(f)) return 'وصول للبيانات';
    if (/^api\/templates\//.test(f)) return 'قالب';
    if (/^api\/trpc\//.test(f)) return 'tRPC';
    return 'بنية/مساعد';
  }
  return 'نوع/قاعدة مشتركة';
}

const rows = all.map((f) => ({
  file: `packages/${f}`, layer: layerOf(f), kind: kindOf(f), section: owner.get(f), how: how.get(f),
  usedBy: (sharedBy.get(f) || []).join('|'), test: isTest(f),
}));

// ── API mount paths per route file (parsed from api/index.ts) ──────────────
const indexSrc = fs.readFileSync(path.join(PKG, 'api', 'index.ts'), 'utf8');
const routerFile = new Map();
for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w.]+)\.js'/g)) routerFile.set(m[1], `api/routes/${m[2]}.ts`);
const mounts = new Map();
for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']+)'[^;]*?\b(\w+Router)\s*\)/g)) {
  const f = routerFile.get(m[2]);
  if (f) mounts.set(f, [...(mounts.get(f) || []), m[1]]);
}
mounts.set('api/trpc/routers/roles.ts', ['/trpc']);

// ── Render ──────────────────────────────────────────────────────────────────
const NAME = Object.fromEntries(SECTIONS.map(([id, name]) => [id, name]));
NAME.shared = 'مشترك بين عدة أقسام';
const KIND_ORDER = ['صفحة', 'مكوّن واجهة', 'تعريف نوع مهمة', 'حالة (store/hook)', 'مساعد/إعداد',
  'مسار API', 'tRPC', 'سياسة صلاحيات', 'خدمة/منطق عمل', 'وصول للبيانات', 'قالب', 'بنية/مساعد', 'نوع/قاعدة مشتركة', 'اختبار'];
const byKind = (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.file.localeCompare(b.file);
const link = (r) => `[${r.file.replace(/^packages\//, '')}](../../../${r.file})`;
const LAYER_TITLE = { frontend: 'الواجهة (Frontend)', backend: 'الخادم (Backend)', shared: 'الحزمة المشتركة (packages/shared)' };

function fileTable(list, extraCol) {
  const head = extraCol ? '| النوع | الملف | يستخدمه |\n|---|---|---|' : '| النوع | الملف |\n|---|---|';
  return `${head}\n${list.sort(byKind).map((r) => `| ${r.kind} | ${link(r)} |${extraCol ? ` ${extraCol(r)} |` : ''}`).join('\n')}`;
}

const out = [];
const today = new Date().toISOString().slice(0, 10);
const prod = rows.filter((r) => !r.test);
const count = (sec, layer) => prod.filter((r) => r.section === sec && (!layer || r.layer === layer)).length;
const tests = (sec) => rows.filter((r) => r.test && r.section === sec).length;

out.push('# خريطة ملفات المشروع حسب الأقسام', '');
out.push(`> مولَّدة آلياً بتاريخ ${today} من \`scripts/generate-file-map.mjs\`. لا تعدّل هذا الملف يدوياً؛ أعد توليده بالأمر \`node scripts/generate-file-map.mjs\`.`, '');
out.push('هذه الوثيقة تحدد لكل قسم من أقسام النظام (كما تظهر في القائمة الجانبية) ملفات الواجهة (Frontend) وملفات الخادم (Backend) التي تخصه. الملفات التي يستخدمها أكثر من قسم مذكورة في قسم «مشترك بين عدة أقسام»، والبنية التي يعتمد عليها الجميع في «البنية الأساسية المشتركة».', '');
out.push(`النطاق: ${rows.length} ملفاً في \`packages/web\` و\`packages/api\` و\`packages/shared\` (منها ${rows.filter((r) => r.test).length} ملف اختبار). ملفات الـ migrations في \`migrations/\` خارج هذا التصنيف.`, '');
out.push('## طريقة التصنيف', '');
out.push('| المرحلة | ماذا تفعل |', '|---|---|');
out.push('| قواعد صريحة | كل قسم له أنماط مجلدات وأسماء ملفات (مثلاً `pages/contracts/*` و`routes/contracts.ts` للعقود). أول قاعدة تنطبق هي المعتمدة |');
out.push('| تتبّع الاستيراد | الملف الذي لا تنطبق عليه قاعدة يُنسب للأقسام التي تستورده فعلاً: قسم واحد فهو له، من 2 إلى 5 أقسام فهو مشترك، 6 فأكثر فهو من البنية الأساسية |');
out.push('| الاختبارات | كل ملف اختبار يتبع قسم الملف الذي يختبره |', '');
out.push(`النتيجة: ${rows.filter((r) => r.how === 'rule').length} ملفاً صُنّف بقاعدة صريحة، و${rows.filter((r) => r.how !== 'rule').length} بتتبّع الاستيراد.`, '');

out.push('## الملخص', '');
out.push('| المجموعة في القائمة | القسم | ملفات الواجهة | ملفات الخادم | الحزمة المشتركة | اختبارات |', '|---|---|---|---|---|---|');
for (const [id, name, group] of SECTIONS) out.push(`| ${group} | ${name} | ${count(id, 'frontend')} | ${count(id, 'backend')} | ${count(id, 'shared')} | ${tests(id)} |`);
out.push(`| — | ${NAME.shared} | ${count('shared', 'frontend')} | ${count('shared', 'backend')} | ${count('shared', 'shared')} | ${tests('shared')} |`, '');

let currentGroup = '';
for (const [id, name, group] of SECTIONS) {
  if (id === 'core') continue;
  if (group !== currentGroup) { out.push(`## ${group}`, ''); currentGroup = group; }
  out.push(`### ${name}`, '');
  const secRows = prod.filter((r) => r.section === id);
  const apiPaths = [...new Set(secRows.flatMap((r) => mounts.get(r.file.replace(/^packages\//, '')) || []))].sort();
  out.push('| | |', '|---|---|');
  out.push(`| مسارات الصفحات | ${(UI_PATHS[id] || []).map((p) => `\`${p}\``).join('، ') || 'لا توجد صفحات (خادم فقط)'} |`);
  const apiCell = [apiPaths.map((p) => `\`${p}\``).join('، '), API_NOTES[id]].filter(Boolean).join(' — ');
  out.push(`| مسارات الـ API | ${apiCell || '—'} |`);
  out.push(`| عدد الملفات | واجهة ${count(id, 'frontend')}، خادم ${count(id, 'backend')}${count(id, 'shared') ? `، مشتركة ${count(id, 'shared')}` : ''}، اختبارات ${tests(id)} |`, '');
  for (const layer of ['frontend', 'backend', 'shared']) {
    const list = secRows.filter((r) => r.layer === layer);
    if (list.length) out.push(`#### ${LAYER_TITLE[layer]}`, '', fileTable(list), '');
  }
  const t = rows.filter((r) => r.test && r.section === id);
  if (t.length) out.push(`<details><summary>الاختبارات (${t.length})</summary>`, '', fileTable(t), '', '</details>', '');
}

out.push('## مشترك بين عدة أقسام', '');
out.push('ملفات يستخدمها من 2 إلى 5 أقسام. أي تعديل عليها يجب اختباره في كل الأقسام المذكورة.', '');
out.push(fileTable(rows.filter((r) => r.section === 'shared'), (r) => r.usedBy.split('|').map((s) => NAME[s]).join('، ')), '');

out.push(`## ${NAME.core}`, '');
out.push('الهيكل الذي تعتمد عليه كل الأقسام: نقطة تشغيل الخادم والواجهة، الاتصال بقاعدة البيانات، الإعدادات، التحقق من الصلاحيات، التخطيط العام للصفحة، مكونات الواجهة الأساسية (`components/ui`)، عميل الـ API، رفع الملفات والوسائط.', '');
for (const layer of ['frontend', 'backend', 'shared']) {
  const list = prod.filter((r) => r.section === 'core' && r.layer === layer);
  if (list.length) out.push(`#### ${LAYER_TITLE[layer]}`, '', fileTable(list, (r) => (r.usedBy ? `${r.usedBy.split('|').length} أقسام` : 'الكل')), '');
}
const coreTests = rows.filter((r) => r.test && r.section === 'core');
if (coreTests.length) out.push(`<details><summary>الاختبارات (${coreTests.length})</summary>`, '', fileTable(coreTests), '', '</details>', '');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'PROJECT-FILE-MAP.md'), out.join('\n'));

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const GROUP = Object.fromEntries(SECTIONS.map(([id, , g]) => [id, g]));
const csv = [['file', 'layer', 'kind', 'section_id', 'section', 'sidebar_group', 'is_test', 'classified_by', 'used_by_sections'].join(',')]
  .concat(rows.map((r) => [r.file, r.layer, r.kind, r.section, NAME[r.section], GROUP[r.section] || '—', r.test ? 'yes' : 'no', r.how,
    r.usedBy.split('|').filter(Boolean).map((s) => NAME[s]).join('، ')].map(csvCell).join(',')));
fs.writeFileSync(path.join(OUT_DIR, 'project-file-map.csv'), `﻿${csv.join('\r\n')}\r\n`);

console.log(`classified ${rows.length} files → docs/engineering/file-map/`);
