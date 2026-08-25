import type { AuthContext } from '@golden-crm/shared';
import { resolveListAccessScope } from '../authorizationService.js';

export type ReportColumnType = 'text' | 'integer' | 'date' | 'datetime' | 'link';

export interface TabularReportColumn {
  key: string;
  titleAr: string;
  type: ReportColumnType;
  width: number;
}

export interface TabularReportDefinition {
  key: string;
  groupKey: string;
  titleAr: string;
  descriptionAr: string;
  question: string;
  grain: string;
  viewPermission: string;
  exportPermission: string;
  columns: TabularReportColumn[];
  filters: {
    dateRange: 'none' | 'required';
    geography: boolean;
  };
  guide: {
    framingTitle: string;
    framingDescription: string;
    rowDescription: string;
    columnDescriptions: Record<string, string>;
    note?: string;
  };
}

export interface ReportGroupDefinition {
  key: string;
  titleAr: string;
  descriptionAr: string;
  order: number;
}

export const REPORT_GROUPS: ReportGroupDefinition[] = [
  { key: 'work_files', titleAr: 'ملفات العمل', descriptionAr: 'تقارير الملكية والتغطية التشغيلية لملفات العمل.', order: 10 },
  { key: 'performance', titleAr: 'تقارير الأداء', descriptionAr: 'مؤشرات ونتائج أداء الأفراد والفرق.', order: 20 },
  { key: 'human_resources', titleAr: 'تقارير الموارد البشرية', descriptionAr: 'تقارير القوى العاملة والحضور والتوظيف.', order: 30 },
  { key: 'service', titleAr: 'تقارير الخدمة', descriptionAr: 'تقارير الطلبات والصيانة وجودة الخدمة.', order: 40 },
  { key: 'daily_work', titleAr: 'تقارير العمل اليومي', descriptionAr: 'متابعة التنفيذ اليومي والمهام والزيارات.', order: 50 },
];

const workFilesGeoSupervisors: TabularReportDefinition = {
  key: 'work_files.geo_supervisors',
  groupKey: 'work_files',
  titleAr: 'تغطية المشرفات وملفات العملاء حسب المنطقة',
  descriptionAr: 'لقطة حالية تجمع ملف العملاء والمتابعة البيعية والزيارات الفعلية لكل مشرفة ضمن كل منطقة.',
  question: 'كيف تتوزع ملفات العملاء الحالية والمتابعة البيعية والزيارات بين المشرفات والمناطق؟',
  grain: 'مشرفة واحدة في منطقة واحدة (ناحية أو حي)',
  viewPermission: 'reports.work_files.geo_supervisors.view',
  exportPermission: 'reports.work_files.geo_supervisors.export',
  filters: { dateRange: 'none', geography: true },
  columns: [
    { key: 'employeeName', titleAr: 'المشرفة', type: 'text', width: 22 },
    { key: 'geoUnitName', titleAr: 'المنطقة (الناحية / الحي)', type: 'text', width: 28 },
    { key: 'leadCount', titleAr: 'زبائن LEAD', type: 'integer', width: 17 },
    { key: 'salesFollowUpCount', titleAr: 'زبائن قيد متابعة', type: 'integer', width: 20 },
    { key: 'fopClosedDemoCount', titleAr: 'زبائن FOP', type: 'integer', width: 16 },
    { key: 'opClosedDemoCount', titleAr: 'زبائن OP', type: 'integer', width: 16 },
    { key: 'lastVisitAt', titleAr: 'آخر زيارة', type: 'datetime', width: 22 },
    { key: 'lastVisitTechnicianName', titleAr: 'الفني المرافق', type: 'text', width: 24 },
  ],
  guide: {
    framingTitle: 'لقطة حالية وليست تقريرًا زمنيًا',
    framingDescription: 'تعرض النسخة حالة البيانات لحظة الضغط على «توليد التقرير». يبقى وقت التوليد محفوظًا، ولا تتغير النسخة عند التصفح أو التصدير.',
    rowDescription: 'يمثل كل صف مشرفة واحدة ضمن منطقة واحدة، وهي ناحية أو حي.',
    columnDescriptions: {
      branchName: 'الفرع التنظيمي التابع له سجل المشرفة. يظهر هذا العمود عند صلاحية عرض كل الفروع.',
      employeeName: 'المشرفة التي يُنسب إليها ملف الزبائن الحالي أو مهمة عرض الجهاز المنفذة.',
      geoUnitName: 'الموقع الجغرافي الحالي للزبائن الذين دخلوا في احتساب الصف.',
      leadCount: 'زبائن LEAD المملوكون حاليًا للمشرفة ضمن المنطقة، ويُحسب كل زبون مرة واحدة.',
      salesFollowUpCount: 'جميع الزبائن الذين لديهم مهمة عرض جهاز ما زالت قيد المتابعة أو التخطيط أو التنفيذ، بصرف النظر عن توصيف الزبون.',
      fopClosedDemoCount: 'زبائن حالتهم الحالية FOP ولديهم مهمة عرض جهاز مغلقة نفذتها المشرفة ضمن المنطقة.',
      opClosedDemoCount: 'زبائن حالتهم الحالية OP ولديهم مهمة عرض جهاز مغلقة نفذتها المشرفة ضمن المنطقة.',
      lastVisitAt: 'أحدث وقت انتهاء فعلي لزيارة نفذتها المشرفة في المنطقة، وليس موعد الزيارة المجدول.',
      lastVisitTechnicianName: 'الفني الموجود ضمن فريق آخر زيارة فعلية، وفق لقطة الفريق وقت الزيارة.',
    },
    note: 'أعداد الزبائن مميزة حسب الزبون، فلا يتكرر الزبون بسبب تعدد المهام. ولا تدخل في عمودي FOP وOP إلا مهمة عرض جهاز مغلقة.',
  },
};

const dailyVisitsLog: TabularReportDefinition = {
  key: 'daily_work.visits_log',
  groupKey: 'daily_work',
  titleAr: 'سجل الزيارات اليومية',
  descriptionAr: 'سجل تاريخي للزيارات وفرقها ومواعيدها ومواقعها وحالتها وعدد المهام والأسماء المسجلة.',
  question: 'ما الزيارات التي كانت مقررة ضمن الفترة، ومن كان ضمن فرقها، وما حالتها وحجم العمل المسجل فيها؟',
  grain: 'زيارة واحدة',
  viewPermission: 'reports.daily_work.visits_log.view',
  exportPermission: 'reports.daily_work.visits_log.export',
  filters: { dateRange: 'required', geography: true },
  columns: [
    { key: 'visitDate', titleAr: 'تاريخ الزيارة', type: 'date', width: 16 },
    { key: 'supervisorName', titleAr: 'المشرفة', type: 'text', width: 22 },
    { key: 'technicianName', titleAr: 'الفني', type: 'text', width: 22 },
    { key: 'telemarketerName', titleAr: 'التلماركتر', type: 'text', width: 22 },
    { key: 'traineeName', titleAr: 'المتدرب', type: 'text', width: 22 },
    { key: 'visitTime', titleAr: 'وقت الزيارة', type: 'text', width: 14 },
    { key: 'appointmentNotes', titleAr: 'ملاحظات الموعد', type: 'text', width: 32 },
    { key: 'geoUnitName', titleAr: 'المنطقة (الناحية / الحي)', type: 'text', width: 28 },
    { key: 'visitLocation', titleAr: 'موقع الزيارة', type: 'link', width: 18 },
    { key: 'gpsMissingReason', titleAr: 'سبب عدم تسجيل الموقع (GPS)', type: 'text', width: 30 },
    { key: 'clientName', titleAr: 'اسم الزبون', type: 'text', width: 24 },
    { key: 'clientNotes', titleAr: 'ملاحظات الزبون', type: 'text', width: 32 },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 20 },
    { key: 'actualStartAt', titleAr: 'وقت بدء الزيارة الفعلي', type: 'datetime', width: 22 },
    { key: 'visitStatus', titleAr: 'حالة الزيارة', type: 'text', width: 18 },
    { key: 'cancellationReason', titleAr: 'سبب إلغاء الزيارة', type: 'text', width: 26 },
    { key: 'cancellationNotes', titleAr: 'ملاحظات الإلغاء', type: 'text', width: 30 },
    { key: 'taskCount', titleAr: 'عدد مهام الزيارة', type: 'integer', width: 18 },
    { key: 'actualNamesCount', titleAr: 'عدد الأسماء المسجلة', type: 'integer', width: 20 },
  ],
  guide: {
    framingTitle: 'تقرير تاريخي يُولّد عند الطلب',
    framingDescription: 'يعرض الزيارات التي يقع تاريخها ضمن النطاق المحدد. كل تشغيل يحفظ لقطة ثابتة بوقت توليد واضح، ويُصدّر Excel من اللقطة نفسها.',
    rowDescription: 'يمثل كل صف زيارة واحدة مهما كان عدد المهام المرتبطة بها.',
    columnDescriptions: {
      branchName: 'الفرع التنظيمي التابع له سجل الزيارة. يظهر هذا العمود عند صلاحية عرض كل الفروع.',
      visitDate: 'التاريخ المحدد للزيارة، وهو أساس نطاق التقرير.',
      supervisorName: 'المشرفة الفعلية للزيارة بعد تطبيق إعادة تعيين الفريق إن وجدت، ثم لقطة الفريق المحفوظة.',
      technicianName: 'الفني الفعلي ضمن فريق الزيارة.',
      telemarketerName: 'موظف التسويق الهاتفي الذي حجز الزيارة.',
      traineeName: 'المتدرب الفعلي ضمن فريق الزيارة.',
      visitTime: 'الوقت المحدد للزيارة.',
      appointmentNotes: 'تعليمات الموعد المحفوظة للفريق، ثم ملاحظات الحجز أو الزيارة عند عدم وجودها.',
      geoUnitName: 'الناحية أو الحي الحالي المرتبط بسجل الزبون.',
      visitLocation: 'رابط إلى موقع بدء الزيارة المسجل عبر GPS.',
      gpsMissingReason: 'السبب الموثق عند عدم توفر GPS أثناء بدء الزيارة أو إنهائها.',
      clientName: 'اسم الزبون من لقطة الزيارة، ثم الاسم الحالي للسجلات القديمة.',
      clientNotes: 'ملاحظات الزبون الحالية وقت توليد التقرير.',
      primaryContactNumber: 'رقم التواصل الرئيسي فقط من لقطة الزيارة، ثم الرقم الحالي للسجلات القديمة.',
      actualStartAt: 'وقت بدء الزيارة المسجل فعليًا، وليس وقت الموعد.',
      visitStatus: 'الحالة الحالية للزيارة وفق دورة حياة الزيارات في المشروع.',
      cancellationReason: 'سبب إلغاء الزيارة من القائمة الإدارية، ويظهر للزيارة الملغاة فقط.',
      cancellationNotes: 'الملاحظات المكتوبة عند إلغاء الزيارة.',
      taskCount: 'عدد المهام المرتبطة فعليًا بالزيارة، بما فيها المهام التي ألغيت نتيجة إلغاء الزيارة.',
      actualNamesCount: 'العدد الفعلي للأسماء المسجلة في لائحة الزيارة، وليس العدد المستهدف.',
    },
    note: 'لا يعرض هذا التقرير أنواع المهام أو نتائجها؛ ستوضع تفاصيلها في تقرير مستقل.',
  },
};

export const TABULAR_REPORTS: TabularReportDefinition[] = [workFilesGeoSupervisors, dailyVisitsLog];

export const GLOBAL_BRANCH_COLUMN: TabularReportColumn = {
  key: 'branchName', titleAr: 'الفرع', type: 'text', width: 22,
};

export function columnsForGrantedScope(definition: TabularReportDefinition, scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED') {
  return scope === 'GLOBAL' ? [GLOBAL_BRANCH_COLUMN, ...definition.columns] : definition.columns;
}

export function findTabularReport(key: string): TabularReportDefinition | undefined {
  return TABULAR_REPORTS.find(report => report.key === key);
}

export function buildVisibleReportCatalog(authContext: AuthContext) {
  const visibleReports = TABULAR_REPORTS.flatMap(report => {
    const viewPlan = resolveListAccessScope(authContext, report.viewPermission);
    if (viewPlan.scope === 'NONE') return [];
    const exportPlan = resolveListAccessScope(authContext, report.exportPermission);
    const scopeRank = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 } as const;
    const effectiveExportScope = exportPlan.scope === 'NONE'
      ? null
      : scopeRank[viewPlan.scope] <= scopeRank[exportPlan.scope] ? viewPlan.scope : exportPlan.scope;
    return [{
      key: report.key,
      groupKey: report.groupKey,
      title: report.titleAr,
      description: report.descriptionAr,
      question: report.question,
      grain: report.grain,
      viewScope: viewPlan.scope,
      canExport: exportPlan.scope !== 'NONE',
      exportScope: effectiveExportScope,
      columns: columnsForGrantedScope(report, viewPlan.scope),
      filters: report.filters,
      guide: report.guide,
    }];
  });

  const visibleGroupKeys = new Set(visibleReports.map(report => report.groupKey));
  return REPORT_GROUPS
    .filter(group => visibleGroupKeys.has(group.key))
    .sort((a, b) => a.order - b.order)
    .map(group => ({
      key: group.key,
      title: group.titleAr,
      description: group.descriptionAr,
      reports: visibleReports.filter(report => report.groupKey === group.key),
    }));
}
