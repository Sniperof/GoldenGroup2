import type { AuthContext } from '@golden-crm/shared';
import { resolveListAccessScope } from '../authorizationService.js';

export type ReportColumnType = 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'link';

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
  supportedScopes?: Array<'GLOBAL' | 'BRANCH' | 'ASSIGNED'>;
  columns: TabularReportColumn[];
  filters: {
    dateRange: 'none' | 'required';
    geography: boolean;
    supervisor: boolean;
    technician: boolean;
    telemarketer: boolean;
    visitStatus: boolean;
    taskType?: boolean;
    search?: boolean;
    deviceModel?: boolean;
    deviceStatus?: boolean;
    warrantyStatus?: boolean;
    customerRating?: boolean;
    contactEmployee?: boolean;
    lastContactChannel?: boolean;
    replacedParts?: boolean;
    paidAmount?: boolean;
    dateRanges?: Array<{
      fromKey: string;
      toKey: string;
      label: string;
    }>;
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
  filters: { dateRange: 'none', geography: true, supervisor: false, technician: false, telemarketer: false, visitStatus: false },
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
  filters: { dateRange: 'required', geography: true, supervisor: true, technician: true, telemarketer: true, visitStatus: true },
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

const serviceInstalledDevices: TabularReportDefinition = {
  key: 'service.installed_devices',
  groupKey: 'service',
  titleAr: 'ملف الأجهزة وخدمة الزبائن',
  descriptionAr: 'لقطة تشغيلية لكل جهاز تجمع بيانات الزبون والكفالة والموقع وآخر زيارة وخدمة وتواصل موثق.',
  question: 'ما الحالة التشغيلية والخدمية الحالية لكل جهاز، وما آخر زيارة وتواصل موثقين له ولزبونه؟',
  grain: 'جهاز مركّب واحد',
  viewPermission: 'reports.service.installed_devices.view',
  exportPermission: 'reports.service.installed_devices.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  filters: {
    dateRange: 'none', geography: true, supervisor: false, technician: false, telemarketer: false, visitStatus: false,
    search: true, deviceModel: true, deviceStatus: true, warrantyStatus: true, customerRating: true,
    contactEmployee: true, lastContactChannel: true, replacedParts: true, paidAmount: true,
    dateRanges: [
      { fromKey: 'installationFrom', toKey: 'installationTo', label: 'تاريخ التركيب' },
      { fromKey: 'periodicMaintenanceFrom', toKey: 'periodicMaintenanceTo', label: 'آخر صيانة دورية منفذة' },
      { fromKey: 'completedVisitFrom', toKey: 'completedVisitTo', label: 'آخر زيارة منفذة للجهاز' },
      { fromKey: 'lastContactFrom', toKey: 'lastContactTo', label: 'تاريخ آخر تواصل' },
      { fromKey: 'incompleteVisitFrom', toKey: 'incompleteVisitTo', label: 'آخر زيارة لم تكتمل' },
    ],
  },
  columns: [
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 24 },
    { key: 'customerRating', titleAr: 'تقييم الزبون', type: 'text', width: 16 },
    { key: 'serialNumber', titleAr: 'الرقم التسلسلي للجهاز', type: 'text', width: 22 },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24 },
    { key: 'operationalStatus', titleAr: 'الحالة التشغيلية للجهاز', type: 'text', width: 22 },
    { key: 'goldenWarrantyStatus', titleAr: 'حالة الكفالة الذهبية', type: 'text', width: 21 },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18 },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18 },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18 },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18 },
    { key: 'installationAddress', titleAr: 'العنوان التفصيلي', type: 'text', width: 34 },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 20 },
    { key: 'installationDate', titleAr: 'تاريخ التركيب', type: 'date', width: 16 },
    { key: 'lastPeriodicMaintenanceDate', titleAr: 'آخر صيانة دورية منفذة', type: 'date', width: 22 },
    { key: 'lastCompletedVisitDate', titleAr: 'آخر زيارة منفذة للجهاز', type: 'date', width: 22 },
    { key: 'replacedPartsSummary', titleAr: 'القطع المبدلة في آخر زيارة', type: 'text', width: 34 },
    { key: 'paidAmount', titleAr: 'المبلغ المدفوع فعليًا في آخر زيارة', type: 'decimal', width: 24 },
    { key: 'whatsappMessage', titleAr: 'رسالة واتساب من آخر تواصل', type: 'text', width: 36 },
    { key: 'lastContactAt', titleAr: 'تاريخ آخر تواصل', type: 'datetime', width: 22 },
    { key: 'contactEmployeeName', titleAr: 'موظف التواصل', type: 'text', width: 22 },
    { key: 'contactNotes', titleAr: 'ملاحظات آخر تواصل', type: 'text', width: 36 },
    { key: 'lastIncompleteVisitDate', titleAr: 'تاريخ آخر زيارة لم تكتمل', type: 'date', width: 23 },
  ],
  guide: {
    framingTitle: 'لقطة تشغيلية تُولّد عند الطلب',
    framingDescription: 'تعرض النسخة حالة الأجهزة والبيانات المرتبطة بها لحظة الضغط على «توليد التقرير». تبقى النسخة ثابتة عند التصفح والتصدير.',
    rowDescription: 'يمثل كل صف جهازًا واحدًا، حتى عندما يملك الزبون أكثر من جهاز أو تحتوي الزيارة أكثر من مهمة.',
    columnDescriptions: {
      branchName: 'الفرع التشغيلي التابع له الجهاز. يظهر عند صلاحية «كل الفروع».',
      customerName: 'الزبون المالك الحالي للجهاز.',
      customerRating: 'التقييم الحالي للزبون وفق مصطلحات المشروع.',
      serialNumber: 'الرقم التسلسلي الحالي للجهاز إن كان مسجلًا.',
      deviceModelName: 'موديل الجهاز من الكتالوج، أو اسم الجهاز الخارجي المسجل.',
      operationalStatus: 'الحالة التشغيلية الحالية للجهاز، وليست حالة العقد أو التحصيل.',
      goldenWarrantyStatus: 'حالة أحدث كفالة ذهبية مرتبطة بالجهاز وقت التوليد.',
      governorateName: 'المحافظة ضمن مسار موقع تركيب الجهاز.',
      regionName: 'المنطقة ضمن مسار موقع تركيب الجهاز.',
      subareaName: 'الناحية ضمن مسار موقع تركيب الجهاز.',
      neighborhoodName: 'الحي ضمن مسار موقع تركيب الجهاز.',
      installationAddress: 'العنوان النصي التفصيلي المحفوظ لموقع الجهاز.',
      primaryContactNumber: 'رقم التواصل الرئيسي للزبون فقط.',
      installationDate: 'تاريخ تركيب الجهاز.',
      lastPeriodicMaintenanceDate: 'تاريخ أحدث مهمة صيانة دورية منفذة مرتبطة بالجهاز.',
      lastCompletedVisitDate: 'أحدث زيارة تحتوي مهمة منفذة واحدة على الأقل مرتبطة بالجهاز.',
      replacedPartsSummary: 'القطع المسجلة ضمن مهام الجهاز في آخر زيارة منفذة، مجمعة بصيغة اسم القطعة × الكمية.',
      paidAmount: 'مجموع حركات الدفع الفعلية المرتبطة بمهام الجهاز ضمن آخر زيارة منفذة.',
      whatsappMessage: 'نص الملاحظات في آخر تواصل فقط عندما كانت وسيلة التواصل رسالة واتساب.',
      lastContactAt: 'وقت أحدث سجل تواصل للزبون المالك الحالي للجهاز.',
      contactEmployeeName: 'الموظف الذي سجل آخر تواصل.',
      contactNotes: 'الملاحظات العامة المسجلة في آخر تواصل.',
      lastIncompleteVisitDate: 'تاريخ أحدث زيارة غير مكتملة تضمنت مهمة مرتبطة بالجهاز؛ لا تُعرض ملاحظاتها.',
    },
    note: 'لا تُخلط مهام الزبون الأخرى مع مهام الجهاز: الزيارة تُنسب للجهاز عند وجود مهمة منفذة مرتبطة به، ثم تُجمع القطع والمدفوعات من مهام هذا الجهاز فقط.',
  },
};

const performanceGeographicPortfolio: TabularReportDefinition = {
  key: 'performance.geographic_portfolio',
  groupKey: 'performance',
  titleAr: 'التوزيع الجغرافي للزبائن والأجهزة',
  descriptionAr: 'لقطة حالية توضح كثافة الزبائن وتصنيفاتهم وانتشار الأجهزة واستحقاق الصيانة والتقييم الميداني لكل ناحية.',
  question: 'كيف تتوزع محفظة الزبائن والأجهزة والصيانة والتقييم الميداني بين المحافظات والمناطق والنواحي؟',
  grain: 'فرع واحد في ناحية واحدة؛ وتظهر السجلات ناقصة الجغرافيا ضمن صفوف غير محددة',
  viewPermission: 'reports.performance.geographic_portfolio.view',
  exportPermission: 'reports.performance.geographic_portfolio.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  filters: {
    dateRange: 'none', geography: true, supervisor: false, technician: false, telemarketer: false, visitStatus: false,
  },
  columns: [
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18 },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18 },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18 },
    { key: 'totalCustomers', titleAr: 'إجمالي الزبائن', type: 'integer', width: 18 },
    { key: 'fopCustomers', titleAr: 'زبائن FOP', type: 'integer', width: 15 },
    { key: 'leadCustomers', titleAr: 'زبائن LEAD', type: 'integer', width: 15 },
    { key: 'suggestedCustomers', titleAr: 'زبائن مقترحون', type: 'integer', width: 17 },
    { key: 'opCustomers', titleAr: 'زبائن OP', type: 'integer', width: 15 },
    { key: 'challengerDevices', titleAr: 'أجهزة تشالنجر', type: 'integer', width: 17 },
    { key: 'aquanovaDevices', titleAr: 'أجهزة أكوانوفا', type: 'integer', width: 17 },
    { key: 'safeLifeDevices', titleAr: 'أجهزة سيف لايف', type: 'integer', width: 17 },
    { key: 'otherDevices', titleAr: 'أجهزة أخرى', type: 'integer', width: 15 },
    { key: 'periodicDueTodayDevices', titleAr: 'أجهزة مستحقة للصيانة اليوم', type: 'integer', width: 25 },
    { key: 'overduePeriodicDevices', titleAr: 'أجهزة متأخرة عن الصيانة الدورية', type: 'integer', width: 28 },
    { key: 'areaEvaluation', titleAr: 'تقييم المنطقة', type: 'text', width: 19 },
    { key: 'evaluationConfidence', titleAr: 'موثوقية التقييم', type: 'text', width: 18 },
    { key: 'evaluationCount', titleAr: 'عدد التقييمات', type: 'integer', width: 17 },
    { key: 'latestEvaluationDate', titleAr: 'تاريخ أحدث تقييم', type: 'date', width: 19 },
  ],
  guide: {
    framingTitle: 'لقطة جغرافية حالية تُولّد عند الطلب',
    framingDescription: 'تعرض النسخة حالة محفظة الزبائن والأجهزة ومهام الصيانة النشطة لحظة التوليد. تقييم المنطقة وحده يلخص استبيانات الزيارات الصالحة خلال آخر 365 يومًا.',
    rowDescription: 'يمثل كل صف فرعًا واحدًا ضمن ناحية واحدة. عند نقص أحد المستويات الجغرافية يظهر «غير محدد» بدل إسقاط السجل من الإجماليات.',
    columnDescriptions: {
      branchName: 'الفرع التنظيمي للسجلات الداخلة في الصف. يظهر عند صلاحية «كل الفروع».',
      governorateName: 'المحافظة المستخرجة من التسلسل الجغرافي لعنوان الزبون أو موقع تركيب الجهاز.',
      regionName: 'المنطقة الإدارية التابعة للمحافظة.',
      subareaName: 'الناحية التي تُجمع عندها الأرقام. الأحياء تُرفع إلى الناحية التابعة لها.',
      totalCustomers: 'جميع الزبائن الحاليين غير المحذوفين ضمن الموقع، ويُحسب كل زبون مرة واحدة.',
      fopCustomers: 'الزبائن الذين توصيفهم الحالي FOP.',
      leadCustomers: 'الزبائن الذين توصيفهم الحالي LEAD، أي لا يحملون قيمة candidate_status.',
      suggestedCustomers: 'الزبائن الذين توصيفهم الحالي «مقترح» في ملف الزبائن، وليس سجلات جدول الأسماء المقترحة.',
      opCustomers: 'الزبائن الذين توصيفهم الحالي OP.',
      challengerDevices: 'الأجهزة المركبة ذات معرّف الموديل 1195.',
      aquanovaDevices: 'الأجهزة المركبة ذات معرّف الموديل 2462.',
      safeLifeDevices: 'الأجهزة المركبة ذات معرّف الموديل 1300.',
      otherDevices: 'كل جهاز مركب لا ينتمي إلى الموديلات الثلاثة، بما فيه الجهاز الخارجي أو غير محدد الموديل.',
      periodicDueTodayDevices: 'أجهزة مميزة لديها مهمة صيانة دورية نشطة وتاريخ استحقاقها يساوي تاريخ توليد التقرير.',
      overduePeriodicDevices: 'أجهزة مميزة لديها مهمة صيانة دورية نشطة وتجاوز تاريخ التوليد تاريخ استحقاقها.',
      areaEvaluation: 'القيمة الوسطية المرجحة لتقييمات المنطقة خلال آخر 365 يومًا؛ الأحدث يأخذ وزنًا أكبر، ولا يُخمن تقييم عند غياب البيانات.',
      evaluationConfidence: 'مرتفعة أو متوسطة أو منخفضة حسب عدد التقييمات وحداثتها، أو غير متاحة عند غيابها.',
      evaluationCount: 'عدد استبيانات الزيارات المكتملة وغير المتخطاة التي دخلت في تقييم المنطقة.',
      latestEvaluationDate: 'تاريخ أحدث تقييم صالح دخل في حساب المنطقة.',
    },
    note: 'موقع الزبون يأتي من عنوانه الحالي، وموقع الجهاز والصيانة يأتي من موقع تركيب الجهاز. لا تدخل مهام الغد في الاستحقاق، ولا تدخل الأجهزة بلا مهمة دورية نشطة في عمودي الصيانة.',
  },
};

const performanceSalesFollowUpTasks: TabularReportDefinition = {
  key: 'performance.sales_follow_up_tasks',
  groupKey: 'performance',
  titleAr: 'متابعة البيع — مهام العرض والخدمة',
  descriptionAr: 'سجل زمني لكل مهمة عرض جهاز أو مهمة مصنفة خدمة تم تسجيل نتيجتها ضمن الفترة المحددة.',
  question: 'ما مهام العرض والخدمة التي نُفذت، ومن نفذها، ولأي زبون وفي أي موقع؟',
  grain: 'نتيجة مهمة منفذة واحدة',
  viewPermission: 'reports.performance.sales_follow_up_tasks.view',
  exportPermission: 'reports.performance.sales_follow_up_tasks.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  filters: {
    dateRange: 'required', geography: true, supervisor: true, technician: true,
    telemarketer: false, visitStatus: false, taskType: true, search: false,
  },
  columns: [
    { key: 'supervisorName', titleAr: 'المشرفة', type: 'text', width: 22 },
    { key: 'technicianName', titleAr: 'الفني', type: 'text', width: 22 },
    { key: 'customerName', titleAr: 'الزبون', type: 'text', width: 25 },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18 },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18 },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18 },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18 },
    { key: 'taskType', titleAr: 'نوع المهمة', type: 'text', width: 24 },
    { key: 'executedDate', titleAr: 'تاريخ تنفيذ المهمة', type: 'date', width: 20 },
    { key: 'resultNotes', titleAr: 'ملاحظات النتيجة', type: 'text', width: 38 },
  ],
  guide: {
    framingTitle: 'تقرير زمني لنتائج المهام المنفذة',
    framingDescription: 'يعتمد نطاق التاريخ على وقت تسجيل نتيجة المهمة، وليس على موعد الزيارة المجدول. كل تشغيل يحفظ لقطة ثابتة قابلة للتصدير إلى Excel.',
    rowDescription: 'يمثل كل صف مهمة واحدة لها نتيجة مسجلة؛ لذلك قد تظهر الزيارة نفسها في أكثر من صف عندما تحتوي عدة مهام منفذة.',
    columnDescriptions: {
      branchName: 'فرع الزيارة التي نُفذت ضمنها المهمة. يظهر عند صلاحية «كل الفروع».',
      supervisorName: 'المشرفة الفعلية ضمن فريق الزيارة بعد تطبيق إعادة التعيين، ثم لقطة الفريق المحفوظة.',
      technicianName: 'الفني الفعلي ضمن فريق الزيارة بعد تطبيق إعادة التعيين، ثم لقطة الفريق المحفوظة.',
      customerName: 'اسم الزبون من لقطة الزيارة، ثم الاسم الحالي عند غياب اللقطة في السجلات القديمة.',
      governorateName: 'المحافظة ضمن موقع تنفيذ المهمة.',
      regionName: 'المنطقة ضمن موقع تنفيذ المهمة.',
      subareaName: 'الناحية ضمن موقع تنفيذ المهمة.',
      neighborhoodName: 'الحي ضمن موقع تنفيذ المهمة، أو «غير محدد» عند غيابه.',
      taskType: 'الاسم العربي لنوع المهمة من إعدادات أنواع المهام الحالية.',
      executedDate: 'تاريخ تسجيل نتيجة المهمة بتوقيت دمشق، وهو أساس نطاق التقرير.',
      resultNotes: 'ملاحظات الإغلاق المحفوظة مع نتيجة المهمة فقط، دون خلطها بملاحظات الزيارة أو الموعد.',
    },
    note: 'يدخل التقرير مهمة «عرض جهاز» وكل نوع تضبطه إعدادات المشروع ضمن تصنيف «خدمة». مهمة الجهاز تُنسب إلى موقع تركيب الجهاز، ومهمة الزبون إلى عنوان الزبون. المهام الملغاة غير منفذة لا تدخل التقرير.',
  },
};

export const TABULAR_REPORTS: TabularReportDefinition[] = [
  workFilesGeoSupervisors,
  dailyVisitsLog,
  serviceInstalledDevices,
  performanceGeographicPortfolio,
  performanceSalesFollowUpTasks,
];

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
    if (report.supportedScopes && !report.supportedScopes.includes(viewPlan.scope)) return [];
    const exportPlan = resolveListAccessScope(authContext, report.exportPermission);
    const scopeRank = { ASSIGNED: 1, BRANCH: 2, GLOBAL: 3 } as const;
    const exportSupported = exportPlan.scope !== 'NONE'
      && (!report.supportedScopes || report.supportedScopes.includes(exportPlan.scope));
    const effectiveExportScope = !exportSupported
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
      canExport: exportSupported,
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
