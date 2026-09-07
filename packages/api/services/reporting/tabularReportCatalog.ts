import type { AuthContext } from '@golden-crm/shared';
import { resolveListAccessScope } from '../authorizationService.js';

export type ReportColumnType = 'text' | 'integer' | 'decimal' | 'date' | 'datetime' | 'link';

export interface TabularReportColumn {
  key: string;
  titleAr: string;
  type: ReportColumnType;
  width: number;
  sortable?: boolean;
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
    primaryDateRanges?: Array<{ fromKey: string; toKey: string; label: string }>;
    candidateNameSearch?: boolean;
    candidateSourceType?: boolean;
    candidateStatus?: boolean;
    candidateOutcome?: boolean;
    candidateDuplicateStatus?: boolean;
    referralSheetNumber?: boolean;
    mediatorName?: boolean;
    mediatorType?: boolean;
    accompanyingTechnician?: boolean;
    giftPromiseStatus?: boolean;
    occupation?: boolean;
    contractStatus?: boolean;
    contractSeller?: boolean;
    contractSellerDepartment?: boolean;
    contractPaymentType?: boolean;
    contractExecutionStage?: boolean;
    contractSaleType?: boolean;
    contractSaleSubtype?: boolean;
    reportDeviceModels?: boolean;
    /** The employee who placed the call, and the outcome it was recorded with. */
    callEmployee?: boolean;
    callOutcome?: boolean;
    /** The device picker is the report's subject, so a run without one is refused. */
    reportDeviceModelsRequired?: boolean;
    departmentType?: boolean;
    contractRemainingBalance?: boolean;
    contractSale?: boolean;
    financialAsOfDate?: boolean;
    collectionOwner?: boolean;
    saleCloser?: boolean;
    latestCollectionResult?: boolean;
    faultType?: boolean;
    faultStatus?: boolean;
    faultDiscoveryPhase?: boolean;
    repairTechnician?: boolean;
    faultDuration?: boolean;
    faultPartsUsage?: boolean;
    retrievalPurpose?: boolean;
    retrievalTechnician?: boolean;
    retrievedDeviceStatus?: boolean;
    giftConditionStatus?: boolean;
    giftDeliveryResult?: boolean;
    giftDefinition?: boolean;
  };
  /**
    * Key of the column the per-run dynamic columns are inserted BEFORE. Without it
    * they are appended, which pushes a trailing total behind the varying columns —
    * and a report whose header ends with a total needs that total to stay last.
    */
  dynamicColumnsBeforeKey?: string;
  /**
    * Set when the row grain IS the branch. The shared GLOBAL branch column is then
    * suppressed, because the branch is the row's identity and not an extra field —
    * without this the column would appear twice for an «all branches» viewer.
    */
  rowIsBranch?: boolean;
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
  { key: 'work_files', titleAr: 'ملفات العمل', descriptionAr: 'تقارير ملفات العمل والزيارات والأجهزة والتوزيع الجغرافي والمتابعة.', order: 10 },
  { key: 'human_resources', titleAr: 'تقارير الموارد البشرية', descriptionAr: 'تقارير القوى العاملة والحضور والتوظيف.', order: 30 },
  { key: 'service', titleAr: 'تقارير الخدمة', descriptionAr: 'تقارير الطلبات والصيانة وجودة الخدمة.', order: 40 },
  { key: 'daily_work', titleAr: 'تقارير العمل اليومي', descriptionAr: 'متابعة التنفيذ اليومي والمهام والزيارات، ونتائج أداء الأفراد والفرق.', order: 50 },
];

const workFilesGeoSupervisors: TabularReportDefinition = {
  key: 'work_files.geo_supervisors',
  groupKey: 'work_files',
  titleAr: 'نطاقات الملفات',
  descriptionAr: 'لقطة حالية تجمع ملف العملاء والمتابعة البيعية والزيارات الفعلية لكل مشرفة ضمن كل منطقة.',
  question: 'كيف تتوزع ملفات العملاء الحالية والمتابعة البيعية والزيارات بين المشرفات والمناطق؟',
  grain: 'مشرفة واحدة في منطقة واحدة (ناحية أو حي)',
  viewPermission: 'reports.work_files.geo_supervisors.view',
  exportPermission: 'reports.work_files.geo_supervisors.export',
  filters: { dateRange: 'none', geography: true, supervisor: false, technician: false, telemarketer: false, visitStatus: false },
  columns: [
    { key: 'employeeName', titleAr: 'المشرفة', type: 'text', width: 22, sortable: true },
    { key: 'geoUnitName', titleAr: 'المنطقة (الناحية / الحي)', type: 'text', width: 28, sortable: true },
    { key: 'leadCount', titleAr: 'زبائن LEAD', type: 'integer', width: 17 },
    { key: 'salesFollowUpCount', titleAr: 'زبائن قيد متابعة', type: 'integer', width: 20 },
    { key: 'fopClosedDemoCount', titleAr: 'زبائن FOP', type: 'integer', width: 16 },
    { key: 'opClosedDemoCount', titleAr: 'زبائن OP', type: 'integer', width: 16 },
    { key: 'lastVisitAt', titleAr: 'آخر زيارة', type: 'datetime', width: 22 },
    { key: 'lastVisitTechnicianName', titleAr: 'الفني المرافق', type: 'text', width: 24, sortable: true },
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
  groupKey: 'work_files',
  titleAr: 'جدول المواعيد اليومي',
  descriptionAr: 'سجل تاريخي للزيارات وفرقها ومواعيدها ومواقعها وحالتها وعدد المهام والأسماء المسجلة.',
  question: 'ما الزيارات التي كانت مقررة ضمن الفترة، ومن كان ضمن فرقها، وما حالتها وحجم العمل المسجل فيها؟',
  grain: 'زيارة واحدة',
  viewPermission: 'reports.daily_work.visits_log.view',
  exportPermission: 'reports.daily_work.visits_log.export',
  filters: { dateRange: 'required', geography: true, supervisor: true, technician: true, telemarketer: true, visitStatus: true },
  columns: [
    { key: 'visitDate', titleAr: 'تاريخ الزيارة', type: 'date', width: 16 },
    { key: 'supervisorName', titleAr: 'المشرفة', type: 'text', width: 22, sortable: true },
    { key: 'technicianName', titleAr: 'الفني', type: 'text', width: 22, sortable: true },
    { key: 'telemarketerName', titleAr: 'التلماركتر', type: 'text', width: 22, sortable: true },
    { key: 'traineeName', titleAr: 'المتدرب', type: 'text', width: 22, sortable: true },
    { key: 'visitTime', titleAr: 'وقت الزيارة', type: 'text', width: 14, sortable: true },
    { key: 'appointmentNotes', titleAr: 'ملاحظات الموعد', type: 'text', width: 32 },
    { key: 'geoUnitName', titleAr: 'المنطقة (الناحية / الحي)', type: 'text', width: 28, sortable: true },
    { key: 'visitLocation', titleAr: 'موقع الزيارة', type: 'link', width: 18 },
    { key: 'gpsMissingReason', titleAr: 'سبب عدم تسجيل الموقع (GPS)', type: 'text', width: 30 },
    { key: 'clientName', titleAr: 'اسم الزبون', type: 'text', width: 24, sortable: true },
    { key: 'clientNotes', titleAr: 'ملاحظات الزبون', type: 'text', width: 32 },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 20 },
    { key: 'actualStartAt', titleAr: 'وقت بدء الزيارة الفعلي', type: 'datetime', width: 22 },
    { key: 'visitStatus', titleAr: 'حالة الزيارة', type: 'text', width: 18, sortable: true },
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
  groupKey: 'work_files',
  titleAr: 'تقرير صيانات',
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
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 24, sortable: true },
    { key: 'customerRating', titleAr: 'تقييم الزبون', type: 'text', width: 16, sortable: true },
    { key: 'serialNumber', titleAr: 'الرقم التسلسلي للجهاز', type: 'text', width: 22, sortable: true },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24, sortable: true },
    { key: 'operationalStatus', titleAr: 'الحالة التشغيلية للجهاز', type: 'text', width: 22, sortable: true },
    { key: 'goldenWarrantyStatus', titleAr: 'حالة الكفالة الذهبية', type: 'text', width: 21, sortable: true },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'installationAddress', titleAr: 'العنوان التفصيلي', type: 'text', width: 34 },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 20 },
    { key: 'installationDate', titleAr: 'تاريخ التركيب', type: 'date', width: 16 },
    { key: 'lastPeriodicMaintenanceDate', titleAr: 'آخر صيانة دورية منفذة', type: 'date', width: 22 },
    { key: 'lastCompletedVisitDate', titleAr: 'آخر زيارة منفذة للجهاز', type: 'date', width: 22 },
    { key: 'replacedPartsSummary', titleAr: 'القطع المبدلة في آخر زيارة', type: 'text', width: 34 },
    { key: 'paidAmount', titleAr: 'المبلغ المدفوع فعليًا في آخر زيارة', type: 'decimal', width: 24 },
    { key: 'whatsappMessage', titleAr: 'رسالة واتساب من آخر تواصل', type: 'text', width: 36 },
    { key: 'lastContactAt', titleAr: 'تاريخ آخر تواصل', type: 'datetime', width: 22 },
    { key: 'contactEmployeeName', titleAr: 'موظف التواصل', type: 'text', width: 22, sortable: true },
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
  groupKey: 'work_files',
  titleAr: 'تقييم محطات المسارات حسب نوع الزبائن والأجهزة',
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
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
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
    { key: 'areaEvaluation', titleAr: 'تقييم المنطقة', type: 'text', width: 19, sortable: true },
    { key: 'evaluationConfidence', titleAr: 'موثوقية التقييم', type: 'text', width: 18, sortable: true },
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
  groupKey: 'work_files',
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
    { key: 'supervisorName', titleAr: 'المشرفة', type: 'text', width: 22, sortable: true },
    { key: 'technicianName', titleAr: 'الفني', type: 'text', width: 22, sortable: true },
    { key: 'customerName', titleAr: 'الزبون', type: 'text', width: 25, sortable: true },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'taskType', titleAr: 'نوع المهمة', type: 'text', width: 24, sortable: true },
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

const workFilesNamesFile: TabularReportDefinition = {
  key: 'work_files.names_file',
  groupKey: 'work_files',
  titleAr: 'ملف الأسماء',
  descriptionAr: 'لقطة حالية موحدة للأسماء المقترحة مباشرة أو ضمن لوائح الأسماء، مع مصدر الاسم وبيانات الوسيط والموقع والحالة الحالية.',
  question: 'ما الأسماء المسجلة حاليًا، وما مصدر كل اسم ووسيطه وموقعه وحالته ومآله؟',
  grain: 'سجل اسم مقترح واحد',
  viewPermission: 'reports.work_files.names_file.view',
  exportPermission: 'reports.work_files.names_file.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  filters: {
    dateRange: 'none', geography: true, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false, search: false,
    candidateNameSearch: true, candidateSourceType: true, candidateStatus: true,
    candidateOutcome: true, candidateDuplicateStatus: true,
    primaryDateRanges: [{ fromKey: 'candidateAddedFrom', toKey: 'candidateAddedTo', label: 'تاريخ إضافة الاسم' }],
    referralSheetNumber: true, mediatorName: true, mediatorType: true,
    accompanyingTechnician: true, giftPromiseStatus: true, occupation: true,
    dateRanges: [
      { fromKey: 'referralSheetFrom', toKey: 'referralSheetTo', label: 'تاريخ لائحة الأسماء' },
      { fromKey: 'mediatorVisitFrom', toKey: 'mediatorVisitTo', label: 'تاريخ زيارة الوسيط' },
    ],
  },
  columns: [
    { key: 'sourceType', titleAr: 'مصدر الاسم', type: 'text', width: 18, sortable: true },
    { key: 'referralSheetNumber', titleAr: 'رقم لائحة الأسماء', type: 'integer', width: 19 },
    { key: 'candidateAddedDate', titleAr: 'تاريخ إضافة الاسم', type: 'date', width: 19 },
    { key: 'referralSheetDate', titleAr: 'تاريخ لائحة الأسماء', type: 'date', width: 20 },
    { key: 'mediatorVisitDate', titleAr: 'تاريخ زيارة الوسيط', type: 'date', width: 20 },
    { key: 'accompanyingTechnician', titleAr: 'الفني المرافق لزيارة الوسيط', type: 'text', width: 28, sortable: true },
    { key: 'mediatorName', titleAr: 'اسم الوسيط', type: 'text', width: 24, sortable: true },
    { key: 'mediatorType', titleAr: 'تصنيف الوسيط', type: 'text', width: 17, sortable: true },
    { key: 'mediatorAddress', titleAr: 'عنوان الوسيط المسجل', type: 'text', width: 32 },
    { key: 'mediatorContactNumber', titleAr: 'رقم تواصل الوسيط', type: 'text', width: 20 },
    { key: 'giftPromiseStatus', titleAr: 'حالة وعد الهدية', type: 'text', width: 23, sortable: true },
    { key: 'candidateName', titleAr: 'الاسم المقترح', type: 'text', width: 25, sortable: true },
    { key: 'candidateStatus', titleAr: 'حالة الاسم', type: 'text', width: 17, sortable: true },
    { key: 'candidateOutcome', titleAr: 'مآل الاسم', type: 'text', width: 23, sortable: true },
    { key: 'duplicateStatus', titleAr: 'حالة التكرار', type: 'text', width: 23, sortable: true },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'detailedAddress', titleAr: 'العنوان التفصيلي', type: 'text', width: 34 },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 21 },
    { key: 'additionalContactNumbers', titleAr: 'أرقام تواصل إضافية', type: 'text', width: 28 },
    { key: 'occupation', titleAr: 'العمل', type: 'text', width: 23, sortable: true },
    { key: 'candidateNotes', titleAr: 'ملاحظات تخص الاسم', type: 'text', width: 36 },
  ],
  guide: {
    framingTitle: 'لقطة حالية موحدة للأسماء',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. يجمع أسماء اللوائح والاقتراحات المباشرة من دون إدخال بيانات المتابعة المؤجلة.',
    rowDescription: 'يمثل كل صف سجل اسم واحدًا. لا يتكرر السجل بسبب تعدد أرقام التواصل أو حالات وعد الهدية.',
    columnDescriptions: {
      branchName: 'فرع سجل الاسم. يظهر فقط عند صلاحية «كل الفروع».',
      sourceType: '«لائحة أسماء» إذا كان الاسم مرتبطًا بلائحة، وإلا «اقتراح مباشر».',
      referralSheetNumber: 'معرف اللائحة المرتبطة؛ يبقى فارغًا للاقتراح المباشر.',
      candidateAddedDate: 'تاريخ إنشاء سجل الاسم بتوقيت دمشق.',
      referralSheetDate: 'التاريخ المسجل للائحة أو للإحالة المباشرة عند توفره.',
      mediatorVisitDate: 'تاريخ انتهاء زيارة الوسيط فعليًا؛ لا يُستخدم الموعد المجدول بديلًا عنه.',
      accompanyingTechnician: 'الفني الفعلي في فريق زيارة الوسيط بعد إعادة التعيين إن وجدت.',
      mediatorName: 'لقطة اسم الوسيط المحفوظة مع اللائحة أو الاسم.',
      mediatorType: 'تصنيف الوسيط وفق مصطلحات المشروع: زبون أو موظف أو شخصي.',
      mediatorAddress: 'العنوان النصي المحفوظ للوسيط مع لائحة الأسماء؛ يبقى فارغًا للاقتراح المباشر لأن سجل الاسم لا يحفظ عنوان الوسيط مستقلاً.',
      mediatorContactNumber: 'الرقم الحالي للوسيط عندما يكون زبونًا أو موظفًا مرتبطًا بسجل معروف.',
      giftPromiseStatus: 'حالات وعود الهدية المرتبطة بالاسم مباشرة أو بلائحته، مجمعة دون تضاعف الصف.',
      candidateName: 'الاسم الكامل المقترح، ثم اللقب عند غياب الاسم.',
      candidateStatus: 'الحالة الحالية لسجل الاسم وفق دورة حياة الأسماء.',
      candidateOutcome: 'ما إذا بقي مقترحًا أو استُبعد أو تحول إلى زبون جديد أو رُبط بزبون موجود.',
      duplicateStatus: 'نتيجة فحص التكرار المحفوظة للسجل، ولا يؤدي التشابه إلى حذف سجل مستقل من التقرير.',
      governorateName: 'المحافظة ضمن الموقع الحالي للاسم.', regionName: 'المنطقة ضمن الموقع الحالي للاسم.',
      subareaName: 'الناحية ضمن الموقع الحالي للاسم.', neighborhoodName: 'الحي ضمن الموقع الحالي للاسم.',
      detailedAddress: 'العنوان النصي التفصيلي للاسم.', primaryContactNumber: 'رقم التواصل الرئيسي للاسم.',
      additionalContactNumbers: 'أرقام التواصل الإضافية المميزة، مجمعة في خلية واحدة.',
      occupation: 'العمل المسجل للاسم.', candidateNotes: 'الملاحظات الحالية الخاصة بسجل الاسم.',
    },
    note: 'لا يحذف التقرير السجلات المتشابهة بالاسم أو الهاتف؛ يعرض كل candidate.id مرة واحدة ويبين حالة التكرار. حقول الاتصال والمتابعة والمواعيد والنتائج مؤجلة لتقرير مستقل.',
  },
};

const workFilesMediatorGifts: TabularReportDefinition = {
  key: 'work_files.mediator_gifts',
  groupKey: 'service',
  titleAr: 'تقرير هدايا الوسطاء',
  descriptionAr: 'الوسطاء والأسماء التي رشحوها ثم تحولت إلى زبائن OP، مع البيعة المرجعية والتركيب واستحقاق الهدية وتسليمها.',
  question: 'من هم الوسطاء الذين تحولت أسماؤهم المرشحة إلى زبائن OP، وما وضع هدية كل تحويل؟',
  grain: 'اسم مرشح واحد تحول إلى زبون OP مع وسيطه',
  viewPermission: 'reports.work_files.names_file.view',
  exportPermission: 'reports.work_files.names_file.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  filters: {
    dateRange: 'none', geography: true, supervisor: true, technician: true,
    telemarketer: false, visitStatus: false, search: false,
    candidateSourceType: true, referralSheetNumber: true, mediatorType: true,
    deviceModel: true, giftPromiseStatus: true, giftConditionStatus: true,
    giftDeliveryResult: true, giftDefinition: true,
    primaryDateRanges: [{ fromKey: 'opFrom', toKey: 'opTo', label: 'تاريخ التحول إلى OP' }],
    dateRanges: [
      { fromKey: 'contractFrom', toKey: 'contractTo', label: 'تاريخ العقد المرجعي' },
      { fromKey: 'installationFrom', toKey: 'installationTo', label: 'تاريخ التركيب' },
      { fromKey: 'giftDeliveryFrom', toKey: 'giftDeliveryTo', label: 'تاريخ تسليم الهدية' },
    ],
  },
  columns: [
    { key: 'candidateId', titleAr: 'رقم الاسم المرشح', type: 'integer', width: 18, sortable: true },
    { key: 'referralPath', titleAr: 'مسار الترشيح', type: 'text', width: 18, sortable: true },
    { key: 'referralSheetNumber', titleAr: 'رقم لائحة الأسماء', type: 'integer', width: 19, sortable: true },
    { key: 'candidateAddedDate', titleAr: 'تاريخ إضافة الاسم', type: 'date', width: 19, sortable: true },
    { key: 'mediatorName', titleAr: 'اسم الوسيط', type: 'text', width: 24, sortable: true },
    { key: 'mediatorType', titleAr: 'نوع الوسيط', type: 'text', width: 17, sortable: true },
    { key: 'mediatorPhone', titleAr: 'رقم هاتف الوسيط', type: 'text', width: 20 },
    { key: 'mediatorAddress', titleAr: 'عنوان الوسيط', type: 'text', width: 30 },
    { key: 'customerName', titleAr: 'اسم الزبون OP', type: 'text', width: 25, sortable: true },
    { key: 'customerPhone', titleAr: 'رقم هاتف الزبون', type: 'text', width: 20 },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'customerAddress', titleAr: 'عنوان الزبون', type: 'text', width: 32 },
    { key: 'contractNumber', titleAr: 'رقم العقد المرجعي', type: 'text', width: 21, sortable: true },
    { key: 'contractDate', titleAr: 'تاريخ العقد', type: 'date', width: 17, sortable: true },
    { key: 'opDate', titleAr: 'تاريخ التحول إلى OP', type: 'date', width: 20, sortable: true },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24, sortable: true },
    { key: 'saleNotes', titleAr: 'ملاحظات البيعة', type: 'text', width: 32 },
    { key: 'installationDate', titleAr: 'تاريخ التركيب', type: 'date', width: 18, sortable: true },
    { key: 'installationSupervisorName', titleAr: 'مشرفة التركيب', type: 'text', width: 22, sortable: true },
    { key: 'installationTechnicianName', titleAr: 'فني التركيب', type: 'text', width: 22, sortable: true },
    { key: 'giftRecordNumbers', titleAr: 'أرقام سجلات الهدايا', type: 'text', width: 21 },
    { key: 'giftSummary', titleAr: 'هدية الوسيط', type: 'text', width: 28, sortable: true },
    { key: 'giftConditionStatus', titleAr: 'حالة الاستحقاق', type: 'text', width: 20, sortable: true },
    { key: 'giftStatus', titleAr: 'حالة الهدية', type: 'text', width: 23, sortable: true },
    { key: 'giftDeliveryAppointments', titleAr: 'موعد تسليم الهدية', type: 'text', width: 24 },
    { key: 'giftDeliveryTechnicians', titleAr: 'فني تسليم الهدية', type: 'text', width: 23, sortable: true },
    { key: 'giftDeliveryResults', titleAr: 'نتيجة التسليم', type: 'text', width: 24, sortable: true },
    { key: 'giftDeliveryNotes', titleAr: 'ملاحظات التسليم', type: 'text', width: 34 },
    { key: 'giftDeliveredAt', titleAr: 'تاريخ التسليم الفعلي', type: 'date', width: 22, sortable: true },
  ],
  guide: {
    framingTitle: 'تحويلات الوسطاء المكتملة إلى OP',
    framingDescription: 'يدخل التقرير الاسم الذي تحوّل إلى زبون جديد وحالته الحالية OP وله وسيط معروف. تبقى بيانات الهدية اختيارية كي تظهر الاستحقاقات التي لم يُنشأ لها سجل بعد.',
    rowDescription: 'يمثل كل صف candidate.id واحدًا؛ لذلك يظهر الوسيط في عدة صفوف عندما تتحول عدة أسماء رشحها.',
    columnDescriptions: {
      branchName: 'فرع سجل الاسم، وهو أساس نطاق العرض.',
      candidateId: 'المعرف الثابت للاسم المرشح الذي نتج عنه الزبون.',
      referralPath: 'لائحة أسماء أو ترشيح مباشر.',
      candidateAddedDate: 'تاريخ إنشاء سجل الاسم المرشح بتوقيت دمشق.',
      mediatorName: 'اسم الوسيط من لقطة اللائحة أو المرشح، ثم السجل الحي عند غياب اللقطة.',
      customerName: 'الزبون المرتبط عبر converted_to_lead_id وحالته الحالية OP.',
      opDate: 'تاريخ اعتماد أقدم عقد فعلي للزبون، وهو الحدث الذي يرفع حالته إلى OP في المسار الحالي. يبقى فارغًا للسجلات القديمة التي لا تملك عقدًا مرجعيًا.',
      contractNumber: 'أقدم عقد فعلي نشط أو مكتمل أو ملغى أمكن ربطه بالزبون المحوّل.',
      installationSupervisorName: 'المشرفة الفعلية لزيارة تركيب العقد بعد إعادة التعيين إن وجدت.',
      installationTechnicianName: 'الفني الفعلي لزيارة تركيب العقد بعد إعادة التعيين إن وجدت.',
      giftSummary: 'كل هدايا الوسيط المرتبطة بالاسم أو لائحته أو عقده المرجعي، مجمعة دون مضاعفة الصف.',
      giftConditionStatus: 'وضع تحقق شرط استحقاق الهدية. غياب السجل يظهر بوضوح بدل إسقاط التحويل.',
      giftDeliveryAppointments: 'مواعيد مهام التسليم المرتبطة بسجلات الهدايا.',
      giftDeliveryTechnicians: 'فنيو زيارات تسليم الهدية، وقد يختلفون عن فني التركيب.',
      giftDeliveryResults: 'آخر نتيجة مسجلة لكل هدية مرتبطة بالتحويل.',
      giftDeliveredAt: 'أحدث تسليم فعلي ناجح أو يدوي ضمن الهدايا المرتبطة.',
    },
    note: 'هدية لائحة الأسماء قد تظهر في أكثر من صف عندما ينتج عن اللائحة أكثر من زبون OP؛ لذلك تُعرض أرقام سجلات الهدايا ولا يجوز جمع الهدايا عبر الصفوف دون إزالة التكرار. لا يوجد في البيانات تاريخ مستقل لانتقال OP، لذا يعتمد العمود تاريخ اعتماد العقد المرجعي.',
  },
};

const dailyWorkSalesFile: TabularReportDefinition = {
  key: 'daily_work.sales_file',
  groupKey: 'daily_work',
  titleAr: 'ملف البيعات اليومي',
  descriptionAr: 'سجل البيعات ضمن الفترة بجهازها ومواعيد تسليمها وتركيبها وتشغيلها، ومقابلها المالي المحصل والمتبقي، وهديتها ووسيطها وفريق تنفيذها.',
  question: 'ما البيعات المسجلة خلال الفترة، ومن نفذ كل مرحلة منها، وما مقابلها المالي المحصل والمتبقي وهديتها ووسيطها؟',
  grain: 'عقد بيع واحد',
  viewPermission: 'reports.daily_work.sales_file.view',
  exportPermission: 'reports.daily_work.sales_file.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  filters: {
    dateRange: 'required', geography: true, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false, contractStatus: true,
    contractSeller: true, contractSellerDepartment: true,
    contractPaymentType: true, contractExecutionStage: true,
    contractSaleType: true, contractSaleSubtype: true,
    contractRemainingBalance: true, deviceModel: true, contractSale: true,
  },
  columns: [
    { key: 'sellerDepartmentName', titleAr: 'قسم البائع', type: 'text', width: 22, sortable: true },
    { key: 'contractStatus', titleAr: 'حالة العقد', type: 'text', width: 14, sortable: true },
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 24, sortable: true },
    { key: 'primaryContactNumber', titleAr: 'رقم التواصل الرئيسي', type: 'text', width: 20 },
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'installationAddress', titleAr: 'عنوان التركيب التفصيلي', type: 'text', width: 34 },
    { key: 'contractDate', titleAr: 'تاريخ العقد', type: 'date', width: 16 },
    { key: 'deliveryDate', titleAr: 'تاريخ تسليم الجهاز', type: 'date', width: 18 },
    { key: 'installationDate', titleAr: 'تاريخ التركيب', type: 'date', width: 16 },
    { key: 'activationDate', titleAr: 'تاريخ التشغيل', type: 'date', width: 16 },
    { key: 'executionStage', titleAr: 'مرحلة التنفيذ', type: 'text', width: 24, sortable: true },
    { key: 'serialNumber', titleAr: 'الرقم التسلسلي للجهاز', type: 'text', width: 22, sortable: true },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24, sortable: true },
    { key: 'saleValue', titleAr: 'قيمة البيعة', type: 'decimal', width: 18 },
    { key: 'saleType', titleAr: 'نوع البيعة', type: 'text', width: 16, sortable: true },
    { key: 'saleSubtype', titleAr: 'صفة البيعة', type: 'text', width: 14, sortable: true },
    { key: 'saleSource', titleAr: 'مصدر البيعة', type: 'text', width: 24, sortable: true },
    { key: 'paymentMethodType', titleAr: 'طريقة الدفع', type: 'text', width: 14, sortable: true },
    { key: 'firstPaymentAmount', titleAr: 'مبلغ الدفعة الأولى', type: 'decimal', width: 18 },
    { key: 'firstPaymentDate', titleAr: 'تاريخ الدفعة الأولى', type: 'date', width: 18 },
    { key: 'installmentsCount', titleAr: 'عدد الأقساط', type: 'integer', width: 14 },
    { key: 'collectedTotal', titleAr: 'إجمالي المحصل', type: 'decimal', width: 18 },
    { key: 'remainingBalance', titleAr: 'المتبقي', type: 'decimal', width: 16 },
    { key: 'paymentMethodsUsed', titleAr: 'طرائق الدفع المسجلة', type: 'text', width: 26 },
    { key: 'giftName', titleAr: 'هدية العقد', type: 'text', width: 24 },
    { key: 'giftConditionLabel', titleAr: 'شرط استحقاق الهدية', type: 'text', width: 26 },
    { key: 'giftDeliveredAt', titleAr: 'تاريخ تسليم الهدية', type: 'date', width: 18 },
    { key: 'acquisitionChannel', titleAr: 'قناة اكتساب الزبون', type: 'text', width: 20, sortable: true },
    { key: 'nameEntryPath', titleAr: 'مسار إدخال الاسم', type: 'text', width: 20, sortable: true },
    { key: 'otherClientOwners', titleAr: 'المسؤولون الآخرون عن الزبون', type: 'text', width: 28 },
    { key: 'contractNotes', titleAr: 'ملاحظات العقد', type: 'text', width: 34 },
    { key: 'sellerName', titleAr: 'البائع (مالك البيعة)', type: 'text', width: 24, sortable: true },
    { key: 'saleReferenceNumber', titleAr: 'رقم البيعة', type: 'text', width: 20, sortable: true },
    { key: 'saleVisitTechnicianName', titleAr: 'الفني المرافق في زيارة البيع', type: 'text', width: 26, sortable: true },
    { key: 'installationTechnicianName', titleAr: 'فني التركيب', type: 'text', width: 22, sortable: true },
    { key: 'installationSupervisorName', titleAr: 'مشرفة التركيب', type: 'text', width: 22, sortable: true },
    { key: 'saleCloserName', titleAr: 'مسؤول تسكير البيعة', type: 'text', width: 22, sortable: true },
    { key: 'telemarketerName', titleAr: 'التلماركتر (حاجز الموعد)', type: 'text', width: 22, sortable: true },
    { key: 'mediatorName', titleAr: 'اسم الوسيط', type: 'text', width: 24, sortable: true },
    { key: 'mediatorType', titleAr: 'تصنيف الوسيط', type: 'text', width: 16, sortable: true },
    { key: 'mediatorContactNumber', titleAr: 'رقم تواصل الوسيط', type: 'text', width: 20 },
    { key: 'additionalMediators', titleAr: 'وسطاء إضافيون', type: 'text', width: 28 },
  ],
  guide: {
    framingTitle: 'سجل البيعات ضمن الفترة',
    framingDescription: 'يعرض العقود التي يقع تاريخها ضمن النطاق المحدد، بكل حالاتها. كل تشغيل يحفظ لقطة ثابتة بوقت توليد واضح، ويُصدّر Excel من اللقطة نفسها.',
    rowDescription: 'يمثل كل صف عقد بيع واحدًا بجهازه المنشأ عنه إن وجد. لا يتكرر الصف بسبب تعدد الدفعات أو الأقساط أو الهدايا أو الوسطاء أو مهام التركيب.',
    columnDescriptions: {
      branchName: 'فرع البيع التابع له العقد. يظهر هذا العمود عند صلاحية عرض كل الفروع.',
      sellerDepartmentName: 'تصنيف قسم البائع المعياري من قوائم النظام، لا الاسم الحر المكتوب لكل فرع.',
      contractStatus: 'الحالة الحالية للعقد وقت التوليد: مسودة أو نشط أو مكتمل أو ملغى أو مستبعد.',
      customerName: 'اسم الزبون الحالي، ثم اسم الزبون المحفوظ على العقد للسجلات القديمة.',
      primaryContactNumber: 'رقم التواصل الرئيسي للزبون فقط، ولا يُستبدل برقم إضافي.',
      governorateName: 'المحافظة ضمن موقع تركيب الجهاز.',
      regionName: 'المنطقة ضمن موقع تركيب الجهاز.',
      subareaName: 'الناحية ضمن موقع تركيب الجهاز.',
      neighborhoodName: 'الحي ضمن موقع تركيب الجهاز.',
      installationAddress: 'العنوان النصي التفصيلي لموقع تركيب الجهاز، لا عنوان سجل الزبون.',
      contractDate: 'تاريخ العقد وهو أساس نطاق التقرير. تُقرأ القيمة غير الصالحة «غير محدد» ولا تُسقط التقرير.',
      deliveryDate: 'تاريخ تسليم الجهاز للزبون؛ يبقى فارغًا قبل التسليم.',
      installationDate: 'تاريخ تركيب الجهاز فعليًا؛ يبقى فارغًا قبل التركيب.',
      activationDate: 'تاريخ تشغيل الجهاز فعليًا؛ يبقى فارغًا قبل التشغيل.',
      executionStage: 'أبعد مرحلة تنفيذ بلغتها البيعة وفق التواريخ الثلاثة أعلاه: بانتظار التسليم، أو مسلم بانتظار التركيب، أو مركب بانتظار التشغيل، أو مشغل. تُقرأ بترتيب المراحل لا بترتيب التواريخ، فلا يضللها تسجيل تسليم بتاريخ لاحق للتركيب.',
      serialNumber: 'الرقم التسلسلي للجهاز، ثم رقم الجهاز الخارجي عند غيابه.',
      deviceModelName: 'نوع الجهاز المركب، ثم النوع المحفوظ على العقد للسجلات القديمة.',
      saleValue: 'القيمة النهائية المتعاقد عليها بعد الحسم.',
      saleType: 'طبيعة البيعة: بيع مباشر أو استبدال أو احتفاظ.',
      saleSubtype: 'صفة البيعة: نهائية أو مؤقتة أو مجانية، وهي بُعد مستقل عن نوعها.',
      saleSource: 'مصدر البيعة كما أُدخل. حقل حر قد يحمل قيمًا غير موحدة، ولذلك لا يُقدَّم كفلتر.',
      paymentMethodType: 'طبيعة البيعة ماليًا: نقدي أو تقسيط.',
      firstPaymentAmount: 'مبلغ أول دفعة محصلة فعليًا على العقد نفسه، لا مبلغ الدفعة المتوقعة، ولا تحصيل مهمة صيانة أو تركيب.',
      firstPaymentDate: 'تاريخ أول دفعة محصلة فعليًا؛ يبقى فارغًا قبل أي تحصيل.',
      installmentsCount: 'عدد الأقساط المنشأة فعليًا في جدول العقد، لا العدد المخطط في نموذج العقد.',
      collectedTotal: 'مجموع الدفعات المحصلة فعليًا مقابل العقد نفسه. لا يشمل ما حُصّل عن مهام الصيانة أو التركيب حتى لو سُجل على الزبون نفسه.',
      remainingBalance: 'الرصيد المتبقي = مجموع المستحقات والمرتجعات ناقص المحصل والحسومات، محسوبًا على التزامات العقد وحدها (قيمته وأقساطه ودفعاته). الذمة الناتجة عن مهمة صيانة أو تركيب لا تدخل هنا ولو كانت مسجلة على العقد، لأنها ليست من ثمن البيعة؛ مكانها كشف حساب الزبون. وقد يظهر الرصيد سالبًا للعقد الملغى، لأن الإلغاء يسجل حسم إبطال قيمة بينما قيد المديونية لا يُسجل إلا عند تفعيل العقد.',
      paymentMethodsUsed: 'طرائق الدفع المسجلة على دفعات العقد. تُقرأ من دفعات العقد لا من دفتر الحركات، فقد تظهر لعقد مسودة لم تُرحّل دفعاته إلى الدفتر بعد ويبقى المحصل صفرًا.',
      giftName: 'هدايا العقد المسجلة، مجمعة في خلية واحدة عند تعددها.',
      giftConditionLabel: 'شروط استحقاق الهدايا المسجلة على العقد.',
      giftDeliveredAt: 'أحدث تسليم فعلي لهدية العقد، يدويًا أو بإغلاق مهمة التسليم؛ يبقى فارغًا قبل التسليم.',
      acquisitionChannel: 'قناة اكتساب الزبون المسجلة على سجله.',
      nameEntryPath: 'مسار دخول الاسم للنظام: لائحة أسماء أو محوَّل من اسم مقترح أو إدخال يدوي.',
      otherClientOwners: 'المسؤولون المسندون للزبون عدا البائع الظاهر في صفه؛ ويظهر «ملكية الفرع» أو «بلا مالك» عند غياب أي إسناد فردي.',
      contractNotes: 'الملاحظات المدونة على العقد.',
      sellerName: 'مالك البيعة المسجل على العقد.',
      saleReferenceNumber: 'رقم البيعة المولد عند قبول العرض؛ يبقى فارغًا للبيعة التي لم تولد من عرض جهاز.',
      saleVisitTechnicianName: 'الفني الفعلي في فريق زيارة عرض الجهاز التي نتجت عنها البيعة؛ يبقى فارغًا للبيعة المباشرة بلا زيارة.',
      installationTechnicianName: 'الفني الفعلي في فريق آخر مهمة تركيب منفذة لهذا العقد.',
      installationSupervisorName: 'المشرفة الفعلية في فريق آخر مهمة تركيب منفذة لهذا العقد.',
      saleCloserName: 'الموظف الذي أُغلقت البيعة باسمه على العقد.',
      telemarketerName: 'موظف التسويق الهاتفي الذي حجز موعد زيارة العرض التي نتجت عنها البيعة.',
      mediatorName: 'اسم الوسيط الرئيسي المحفوظ مع العقد، ثم وسيط سجل الزبون للسجلات القديمة.',
      mediatorType: 'تصنيف الوسيط وفق مصطلحات المشروع: زبون أو موظف أو شخصي.',
      mediatorContactNumber: 'الرقم الحالي للوسيط عندما يكون زبونًا أو موظفًا مرتبطًا بسجل معروف؛ يبقى فارغًا للوسيط الشخصي.',
      additionalMediators: 'أسماء بقية وسطاء العقد بعد الوسيط الرئيسي، مجمعة في خلية واحدة.',
    },
    note: 'المال في هذا التقرير مال العقد وحده: الاستحقاقات والدفعات المنسوبة إلى العقد وأقساطه، لا ذمم مهام الصيانة والتركيب المسجلة على الزبون. فلتر «وجود متبقٍّ مالي» يطبق على الرصيد المجمع من دفتر الحركات: «عليها متبقٍّ» تعني رصيدًا أكبر من صفر فقط، والعقد الملغى ذو الرصيد السالب يظهر ضمن «مسدَّدة بالكامل» لأنه حالة إرجاع لا حالة تحصيل. وفلتر «بيعة محددة» منسدل اختيار لا حقل نص، وخياراته بيعات المدى الزمني المحدد نفسه وبحد أقصى ٣٠٠ بيعة أحدثها تاريخًا، فيضيق المدى للوصول إلى ما بعدها. أعمدة زيارة البيع تبقى فارغة للبيعة المباشرة التي لم تولد من عرض جهاز داخل زيارة. وفي نطاق «بيعاتي» لا تظهر العقود التي لا تحمل مالك بيعة، لأنها بلا علاقة إسناد. «نوع الجهاز المسحوب» غير متاح حاليًا لأن البيعة الاستبدالية لا تحفظ موديل الجهاز المسحوب.',
  },
};

const serviceDues: TabularReportDefinition = {
  key: 'service.dues',
  groupKey: 'service',
  titleAr: 'تقرير الاستحقاقات',
  descriptionAr: 'الاستحقاقات المفتوحة ضمن نطاق تاريخ الاستحقاق، مع إعادة بناء وضعها المالي حتى تاريخ محدد وآخر نشاط تحصيل مرتبط بها.',
  question: 'ما الاستحقاقات المفتوحة في التاريخ المحدد، وما رصيد كل منها ووضع تحصيلها وآخر اتصال ونتيجة وموعد؟',
  grain: 'استحقاق مالي مفتوح واحد',
  viewPermission: 'reports.service.dues.view',
  exportPermission: 'reports.service.dues.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  filters: {
    dateRange: 'required', geography: true, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false,
    financialAsOfDate: true, collectionOwner: true, contractSeller: true,
    saleCloser: true, contractPaymentType: true, latestCollectionResult: true,
  },
  columns: [
    { key: 'governorateName', titleAr: 'المحافظة', type: 'text', width: 18, sortable: true },
    { key: 'regionName', titleAr: 'المنطقة', type: 'text', width: 18, sortable: true },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 18, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 18, sortable: true },
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 25, sortable: true },
    { key: 'receivableSource', titleAr: 'مصدر الاستحقاق', type: 'text', width: 26, sortable: true },
    { key: 'sourceEventDate', titleAr: 'تاريخ التركيب أو الخدمة', type: 'date', width: 21 },
    { key: 'dueDate', titleAr: 'تاريخ الاستحقاق', type: 'date', width: 18 },
    { key: 'contractFinalValue', titleAr: 'قيمة العقد', type: 'decimal', width: 18 },
    { key: 'agreedPaymentType', titleAr: 'نظام السداد المتفق عليه', type: 'text', width: 24, sortable: true },
    { key: 'lastPaymentDate', titleAr: 'تاريخ آخر دفعة قبل الاستحقاق', type: 'date', width: 27 },
    { key: 'lastPaymentAmount', titleAr: 'قيمة آخر دفعة قبل الاستحقاق', type: 'decimal', width: 27 },
    { key: 'lastPaymentMethod', titleAr: 'طريقة آخر دفعة', type: 'text', width: 20, sortable: true },
    { key: 'contractCollectedTotal', titleAr: 'إجمالي المسدد قبل الاستحقاق', type: 'decimal', width: 27 },
    { key: 'contractRemainingBalance', titleAr: 'المتبقي قبل الاستحقاق', type: 'decimal', width: 22 },
    { key: 'installmentDueAmount', titleAr: 'المبلغ المستحق', type: 'decimal', width: 19 },
    { key: 'collectionOwnerName', titleAr: 'مسؤول التحصيل', type: 'text', width: 22, sortable: true },
    { key: 'sellerName', titleAr: 'البائع', type: 'text', width: 22, sortable: true },
    { key: 'saleCloserName', titleAr: 'موظف إغلاق البيع', type: 'text', width: 22, sortable: true },
    { key: 'lastContactDate', titleAr: 'تاريخ آخر اتصال', type: 'date', width: 18 },
    { key: 'lastContactEmployeeName', titleAr: 'موظف آخر اتصال', type: 'text', width: 22, sortable: true },
    { key: 'contactNotes', titleAr: 'ملاحظات الاتصال', type: 'text', width: 34 },
    { key: 'nextCollectionAppointment', titleAr: 'موعد التحصيل القادم', type: 'date', width: 21 },
    { key: 'latestCollectionResult', titleAr: 'نتيجة آخر محاولة تحصيل', type: 'text', width: 25, sortable: true },
    { key: 'latestCollectedAmount', titleAr: 'المبلغ المحصل في آخر محاولة', type: 'decimal', width: 25 },
    { key: 'latestVisitTechnicianName', titleAr: 'الفني المرافق لآخر محاولة', type: 'text', width: 25, sortable: true },
    { key: 'latestResultNotes', titleAr: 'ملاحظات آخر نتيجة', type: 'text', width: 34 },
    { key: 'collectionTaskNotes', titleAr: 'ملاحظات مهمة التحصيل', type: 'text', width: 34 },
  ],
  guide: {
    framingTitle: 'لقطة استحقاقات بتاريخ مالي محدد',
    framingDescription: 'يعاد بناء رصيد كل قسط وإجماليات العقد حتى نهاية تاريخ الحالة المالية الذي اختاره المستخدم، ثم تحفظ النتيجة كلقطة ثابتة للتصفح والتصدير.',
    rowDescription: 'يمثل كل صف قسطًا مثبتًا واحدًا بقي عليه رصيد في تاريخ الحالة المالية. تكرار الزبون طبيعي عندما يملك أكثر من استحقاق مفتوح.',
    columnDescriptions: {
      branchName: 'فرع الخدمة للعقد، ثم فرع البيع عند غياب فرع الخدمة. يظهر فقط عند صلاحية كل الفروع.',
      governorateName: 'المحافظة الحالية ضمن عنوان الزبون.', regionName: 'المنطقة الحالية ضمن عنوان الزبون.',
      subareaName: 'الناحية الحالية ضمن عنوان الزبون.', neighborhoodName: 'الحي الحالي ضمن عنوان الزبون.',
      customerName: 'اسم الزبون الحالي، ثم الاسم المحفوظ على العقد عند غيابه.',
      receivableSource: 'الوصف المحفوظ لمصدر الذمة، ثم رقم العقد عند غياب وصف مستقل.',
      sourceEventDate: 'تاريخ تركيب الجهاز عندما يكون المصدر عقدًا، أو تاريخ تنفيذ الخدمة عندما يكون المصدر صيانة، أو بدء الكفالة عند كونها المصدر.',
      dueDate: 'تاريخ الاستحقاق الأصلي للقسط، وهو أساس نطاق التقرير.',
      contractFinalValue: 'قيمة العقد النهائية المتعاقد عليها بعد الحسم؛ وليست السعر المجرد لموديل الجهاز.',
      agreedPaymentType: 'نظام السداد التجاري المتفق عليه في العقد: نقدي أو تقسيط.',
      lastPaymentDate: 'تاريخ أحدث دفعة فعلية على العقد سبقت تاريخ استحقاق هذا الصف.',
      lastPaymentAmount: 'قيمة أحدث قيد دفع على العقد سبق تاريخ استحقاق هذا الصف.',
      lastPaymentMethod: 'وسيلة أحدث دفعة فعلية قبل الاستحقاق، مثل نقدي أو شام كاش أو حوالة بنكية؛ وهي مستقلة عن نظام السداد المتفق عليه.',
      contractCollectedTotal: 'إجمالي حركات الدفع التابعة للعقد قبل تاريخ استحقاق هذا الصف.',
      contractRemainingBalance: 'قيمة العقد مع المرتجعات، ناقص الدفعات والحسومات المسجلة قبل تاريخ استحقاق هذا الصف.',
      installmentDueAmount: 'القيمة الأصلية المجدولة للقسط في تاريخ الاستحقاق.',
      collectionOwnerName: 'حساب الموظف المسند إليه تحصيل القسط حاليًا، وهو أساس نطاق سجلاتي.',
      sellerName: 'مالك عملية البيع المسجل على العقد.', saleCloserName: 'الموظف الذي أُغلقت البيعة باسمه على العقد.',
      lastContactDate: 'أحدث اتصال حتى التاريخ المحدد ومرتبط بأي مهمة تحصيل في سلسلة القسط.',
      lastContactEmployeeName: 'الموظف الذي سجل آخر اتصال مرتبط بالقسط.', contactNotes: 'ملاحظات آخر اتصال مرتبط بالقسط.',
      nextCollectionAppointment: 'أقرب زيارة تحصيل أنشئت حتى تاريخ اللقطة، وليست ملغاة في الحالة الحالية.',
      latestCollectionResult: 'آخر نتيجة تحصيل مسجلة حتى التاريخ المحدد، بصياغة عربية من مصطلحات المشروع.',
      latestCollectedAmount: 'إجمالي المبلغ المحصل في آخر نتيجة تحصيل؛ يبقى فارغًا عند إعادة الجدولة أو رفض الدفع.',
      latestVisitTechnicianName: 'الفني الفعلي في زيارة آخر نتيجة بعد تطبيق إعادة التعيين ثم لقطة الفريق.',
      latestResultNotes: 'ملاحظات آخر نتيجة تحصيل فقط.', collectionTaskNotes: 'ملاحظات أحدث مهمة تحصيل أنشئت حتى التاريخ المحدد.',
    },
    note: 'يحدد تاريخ الحالة المالية ما إذا كان الاستحقاق ما يزال مفتوحًا وما هي الأنشطة المتاحة في اللقطة. أما آخر دفعة وإجمالي المسدد والمتبقي الظاهر فتُحسب قبل تاريخ استحقاق كل صف كما يقتضي تعريف التقرير. اسم الزبون وموقعه ومسؤول التحصيل وموظفو العقد، وحالة إلغاء موعد الزيارة، حقول مرجعية حالية لا تملك جميعها سجل تغيرات تاريخيًا مستقلًا.',
  },
};

const serviceDeviceFaults: TabularReportDefinition = {
  key: 'service.device_faults',
  groupKey: 'service',
  titleAr: 'تقرير الأعطال',
  descriptionAr: 'الأعطال المسجلة على أجهزة الزبائن، مع حالة كل عطل وزيارة معالجته وفني الإصلاح والقطع المرتبطة به.',
  question: 'ما الأعطال المسجلة خلال الفترة، وما حالتها الحالية، وكيف عولجت، ومن نفذ الإصلاح، وما مدة معالجتها؟',
  grain: 'عطل واحد مسجل على جهاز',
  viewPermission: 'reports.service.installed_devices.view',
  exportPermission: 'reports.service.installed_devices.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false, search: false, deviceModel: true,
    faultType: true, faultStatus: true, faultDiscoveryPhase: true,
    repairTechnician: true, faultDuration: true, faultPartsUsage: true,
    dateRanges: [{ fromKey: 'faultResolvedFrom', toKey: 'faultResolvedTo', label: 'تاريخ الإصلاح' }],
  },
  columns: [
    { key: 'faultId', titleAr: 'رقم العطل', type: 'integer', width: 14, sortable: true },
    { key: 'serviceRequestRef', titleAr: 'رقم طلب الخدمة', type: 'text', width: 20, sortable: true },
    { key: 'reportedDate', titleAr: 'تاريخ تسجيل العطل', type: 'date', width: 19, sortable: true },
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 24, sortable: true },
    { key: 'primaryContactNumber', titleAr: 'رقم الهاتف', type: 'text', width: 19 },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24, sortable: true },
    { key: 'serialNumber', titleAr: 'الرقم التسلسلي', type: 'text', width: 21, sortable: true },
    { key: 'faultType', titleAr: 'نوع العطل', type: 'text', width: 22, sortable: true },
    { key: 'faultDetails', titleAr: 'تفاصيل العطل', type: 'text', width: 34 },
    { key: 'discoveryPhase', titleAr: 'مرحلة اكتشاف العطل', type: 'text', width: 21, sortable: true },
    { key: 'faultStatus', titleAr: 'حالة العطل', type: 'text', width: 20, sortable: true },
    { key: 'unresolvedReason', titleAr: 'سبب التأجيل أو تعذر الحل', type: 'text', width: 31 },
    { key: 'treatmentVisitDate', titleAr: 'تاريخ زيارة المعالجة', type: 'date', width: 21, sortable: true },
    { key: 'visitTechnicianName', titleAr: 'فني الزيارة', type: 'text', width: 22, sortable: true },
    { key: 'resolvedDate', titleAr: 'تاريخ الإصلاح', type: 'date', width: 18, sortable: true },
    { key: 'repairTechnicianName', titleAr: 'فني الإصلاح', type: 'text', width: 22, sortable: true },
    { key: 'resolutionNotes', titleAr: 'ملاحظات الإصلاح', type: 'text', width: 34 },
    { key: 'partsUsedSummary', titleAr: 'القطع المستخدمة', type: 'text', width: 32 },
    { key: 'resolutionDurationDays', titleAr: 'مدة المعالجة بالأيام', type: 'integer', width: 21, sortable: true },
    { key: 'lastUpdatedAt', titleAr: 'آخر تحديث', type: 'datetime', width: 22, sortable: true },
  ],
  guide: {
    framingTitle: 'نشاط الأعطال المسجلة خلال الفترة',
    framingDescription: 'يحدد نطاق التاريخ الأعطال التي سُجلت خلاله، ثم تحفظ اللقطة حالتها وبيانات معالجتها كما كانت عند التوليد.',
    rowDescription: 'يمثل كل صف عطلًا واحدًا مسجلًا على جهاز؛ تعدد الأعطال في طلب الخدمة أو الجهاز ينتج صفوفًا مستقلة.',
    columnDescriptions: {
      branchName: 'فرع طلب الخدمة، أو فرع الجهاز عند غياب فرع الطلب. يظهر عند صلاحية كل الفروع.',
      faultId: 'المعرف الداخلي الثابت لسجل العطل.',
      serviceRequestRef: 'الرقم المرجعي لطلب الخدمة الذي يحتوي العطل.',
      reportedDate: 'تاريخ إنشاء سجل العطل، وهو التاريخ الذي يحدد دخوله في الفترة.',
      customerName: 'مستفيد طلب الخدمة، أو مالك الجهاز عند غيابه.',
      primaryContactNumber: 'رقم التواصل الرئيسي الحالي للزبون.',
      deviceModelName: 'موديل الجهاز من الكتالوج أو الاسم الخارجي المحفوظ.',
      serialNumber: 'الرقم التسلسلي المسجل للجهاز إن وجد.',
      faultType: 'نوع العطل من قائمة أنواع الأعطال المعتمدة.',
      faultDetails: 'التفاصيل الحرة المسجلة على العطل.',
      discoveryPhase: 'المرحلة التي أضيف فيها العطل: استقبال أو مراجعة أو استشارة فنية أو اكتشاف ميداني.',
      faultStatus: 'الحالة الحالية للعطل وقت توليد اللقطة.',
      unresolvedReason: 'السبب النصي المسجل عند تأجيل العطل أو تعذر حله ميدانيًا.',
      treatmentVisitDate: 'تاريخ نتيجة زيارة المعالجة المرتبطة صراحة بالعطل.',
      visitTechnicianName: 'فني زيارة المعالجة، وقد يختلف عن فني الإصلاح المسجل.',
      resolvedDate: 'تاريخ انتقال العطل إلى محلول أو محلول عند الاستلام.',
      repairTechnicianName: 'الفني الذي نُسب إليه تنفيذ الإصلاح، لا مستخدم إدخال النتيجة.',
      resolutionNotes: 'الملاحظات المسجلة عند حل العطل.',
      partsUsedSummary: 'القطع المرتبطة صراحة بهذا العطل، مجمعة بصيغة الاسم × الكمية.',
      resolutionDurationDays: 'عدد الأيام من تسجيل العطل إلى إصلاحه، أو إلى يوم التوليد إذا بقي غير محلول.',
      lastUpdatedAt: 'وقت آخر تحديث لسجل العطل.',
    },
    note: 'لا ينسب التقرير القطع غير المرتبطة بعطل محدد، ولا يوزع تكلفة مهمة الصيانة على أعطالها.',
  },
};

const serviceRetrievedDevices: TabularReportDefinition = {
  key: 'service.retrieved_devices',
  groupKey: 'service',
  titleAr: 'تقرير الأجهزة المسحوبة للشركة',
  descriptionAr: 'الأجهزة التي نُفذت لها عملية سحب ناجحة إلى فرع خدمة، مع بيانات الجهاز والزبون والفك والسحب والحالة الحالية.',
  question: 'ما الأجهزة التي سُحبت فعليًا إلى الشركة خلال الفترة، ولماذا سُحبت، ومن نفذ السحب، وما حالتها الحالية؟',
  grain: 'عملية سحب ناجحة واحدة لجهاز',
  viewPermission: 'reports.service.installed_devices.view',
  exportPermission: 'reports.service.installed_devices.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false, search: false, deviceModel: true,
    retrievalPurpose: true, retrievalTechnician: true, retrievedDeviceStatus: true,
  },
  columns: [
    { key: 'retrievalId', titleAr: 'رقم عملية السحب', type: 'integer', width: 17, sortable: true },
    { key: 'retrievalDate', titleAr: 'تاريخ السحب', type: 'date', width: 17, sortable: true },
    { key: 'customerName', titleAr: 'اسم الزبون', type: 'text', width: 24, sortable: true },
    { key: 'primaryContactNumber', titleAr: 'رقم الهاتف', type: 'text', width: 19 },
    { key: 'customerAddress', titleAr: 'عنوان الجهاز قبل السحب', type: 'text', width: 32 },
    { key: 'subareaName', titleAr: 'الناحية', type: 'text', width: 20, sortable: true },
    { key: 'neighborhoodName', titleAr: 'الحي', type: 'text', width: 20, sortable: true },
    { key: 'deviceModelName', titleAr: 'نوع الجهاز', type: 'text', width: 24, sortable: true },
    { key: 'serialNumber', titleAr: 'الرقم التسلسلي', type: 'text', width: 21, sortable: true },
    { key: 'retrievalPurpose', titleAr: 'غرض السحب', type: 'text', width: 20, sortable: true },
    { key: 'originBranchName', titleAr: 'الفرع قبل السحب', type: 'text', width: 22, sortable: true },
    { key: 'retrievalTechnicianName', titleAr: 'فني السحب', type: 'text', width: 22, sortable: true },
    { key: 'retrievalSource', titleAr: 'مسار السحب', type: 'text', width: 27, sortable: true },
    { key: 'currentDeviceStatus', titleAr: 'حالة الجهاز الحالية', type: 'text', width: 22, sortable: true },
    { key: 'waterDisconnected', titleAr: 'فصل الماء', type: 'text', width: 14 },
    { key: 'electricityDisconnected', titleAr: 'فصل الكهرباء', type: 'text', width: 16 },
    { key: 'accessoriesRemoved', titleAr: 'فك الملحقات', type: 'text', width: 16 },
    { key: 'disconnectionNotes', titleAr: 'ملاحظات فك الجهاز', type: 'text', width: 34 },
    { key: 'retrievalNotes', titleAr: 'ملاحظات السحب', type: 'text', width: 34 },
    { key: 'customerAcknowledged', titleAr: 'تأكيد الزبون', type: 'text', width: 16 },
    { key: 'retrievalTaskId', titleAr: 'رقم مهمة السحب', type: 'integer', width: 18, sortable: true },
    { key: 'lastUpdatedAt', titleAr: 'آخر تحديث', type: 'datetime', width: 22, sortable: true },
  ],
  guide: {
    framingTitle: 'عمليات السحب المنفذة خلال الفترة',
    framingDescription: 'يحدد نطاق التاريخ عمليات السحب الناجحة بحسب تاريخ إغلاق نتيجة مهمة السحب، ويحفظ التقرير حالتها عند التوليد.',
    rowDescription: 'يمثل كل صف عملية سحب ناجحة واحدة؛ لا تظهر المهام المؤجلة أو التي رفض فيها الزبون السحب.',
    columnDescriptions: {
      branchName: 'فرع الخدمة الذي استلم الجهاز، وهو أساس نطاق الفرع في التقرير.',
      retrievalDate: 'تاريخ إغلاق نتيجة السحب الناجحة.',
      retrievalPurpose: 'صيانة وإرجاع أو استبدال الجهاز، وفق القيم التشغيلية المحفوظة حاليًا.',
      originBranchName: 'لقطة فرع الجهاز قبل نقله إلى فرع الخدمة.',
      customerAddress: 'لقطة عنوان الجهاز المحفوظة قبل السحب.',
      subareaName: 'الناحية المستخرجة من لقطة موقع الجهاز قبل السحب.',
      neighborhoodName: 'الحي المستخرج من لقطة موقع الجهاز قبل السحب.',
      retrievalTechnicianName: 'فني الزيارة التي نُفذت فيها مهمة السحب.',
      currentDeviceStatus: 'حالة الجهاز لحظة توليد التقرير، وقد تتغير بعد إرجاعه أو نقله.',
      disconnectionNotes: 'ملاحظات أحدث عملية فك ناجحة سبقت السحب للجهاز نفسه.',
    },
    note: 'النظام الحالي يحفظ غرض السحب كصيانة أو استبدال؛ لا توجد قيمة مستقلة للإتلاف ضمن بيانات السحب.',
  },
};

const performanceSalesByType: TabularReportDefinition = {
  key: 'performance.sales_by_type',
  groupKey: 'daily_work',
  titleAr: 'المبيعات حسب النوع',
  descriptionAr: 'توزيع بيع كل فرع خلال المدة على أنواع البيعات وقنوات العرض، مع معدل تحويل كل قناة إلى بيعة، وأعمدة إضافية للأجهزة التي تختارها قبل التوليد.',
  question: 'كيف يتوزع بيع كل فرع على أنواع البيعات وقنواتها والأجهزة المختارة، وما معدل تحويل كل قناة إلى بيعة؟',
  grain: 'فرع واحد خلال المدة المحددة',
  viewPermission: 'reports.performance.sales_by_type.view',
  exportPermission: 'reports.performance.sales_by_type.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  rowIsBranch: true,
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false,
    contractSaleSubtype: true, reportDeviceModels: true,
  },
  columns: [
    { key: 'branchName', titleAr: 'الفرع', type: 'text', width: 20, sortable: true },
    { key: 'tradeInSales', titleAr: 'بيعة استبدال', type: 'integer', width: 14 },
    { key: 'retentionSales', titleAr: 'بيعة احتفاظ', type: 'integer', width: 14 },
    { key: 'marketingOffers', titleAr: 'عروض تسويق', type: 'integer', width: 14 },
    { key: 'marketingSales', titleAr: 'بيعة تسويق', type: 'integer', width: 14 },
    { key: 'marketingCloseRate', titleAr: 'معدل بيع تسويق %', type: 'decimal', width: 17 },
    { key: 'instantOffers', titleAr: 'عروض انستانت سيت', type: 'integer', width: 18 },
    { key: 'instantSales', titleAr: 'بيعة انستانت سيت', type: 'integer', width: 18 },
    { key: 'instantCloseRate', titleAr: 'معدل بيع انستانت %', type: 'decimal', width: 19 },
    { key: 'socialMediaSales', titleAr: 'بيعة تواصل اجتماعي', type: 'integer', width: 19 },
    { key: 'totalOffers', titleAr: 'إجمالي العروض', type: 'integer', width: 16 },
    { key: 'totalOfferSales', titleAr: 'إجمالي بيعات العروض', type: 'integer', width: 20 },
    { key: 'overallCloseRate', titleAr: 'معدل البيع الإجمالي %', type: 'decimal', width: 20 },
  ],
  guide: {
    framingTitle: 'توزيع البيع على الأنواع والقنوات لكل فرع',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. العقود تُنسب إلى المدة بتاريخ العقد، والعروض بتاريخ إغلاق نتيجتها بتوقيت دمشق.',
    rowDescription: 'يمثل كل صف فرعًا واحدًا. الفرع غير النشط لا يظهر إلا إن كان له نشاط فعلي داخل المدة.',
    columnDescriptions: {
      branchName: 'الفرع، وهو هوية الصف لا عمودًا إضافيًا؛ لذلك يظهر في كل النطاقات.',
      tradeInSales: 'عدد عقود المدة من نمط الاستبدال، أيًا كان أصل البيعة.',
      retentionSales: 'عدد عقود المدة من نمط الاحتفاظ، أيًا كان أصل البيعة.',
      marketingOffers: 'عدد عروض الأجهزة المسجلة على زيارات محجوزة من التسويق وأُغلقت نتيجتها داخل المدة، بأي نوع مهمة.',
      marketingSales: 'العروض التسويقية التي يقف خلفها عقد فعلي. لا يُعتد بعلم «تم البيع» على العرض وحده، لأنه يُرفع أحيانًا بلا عقد.',
      marketingCloseRate: 'بيعة تسويق ÷ عروض تسويق × ١٠٠. يبقى فارغًا لا صفرًا عندما لا يكون للفرع عروض في المدة.',
      instantOffers: 'عروض الأجهزة على الزيارات الفورية التي تفتحها المشرفة من الميدان خارج الخطة.',
      instantSales: 'عروض الزيارة الفورية التي يقف خلفها عقد فعلي.',
      instantCloseRate: 'بيعة انستانت ÷ عروض انستانت × ١٠٠. فارغ عند غياب العروض.',
      socialMediaSales: 'عقود المدة التي سُجل مصدرها «تواصل اجتماعي». هذا العمود وحده يعتمد على حقل مصدر البيعة الحر، وهو غير مسجل على كل العقود، فالعدد حد أدنى لا حصر تام.',
      totalOffers: 'كل عروض الأجهزة المغلقة داخل المدة في الفرع، بأي أصل زيارة.',
      totalOfferSales: 'العروض التي يقف خلفها عقد فعلي، بأي أصل زيارة.',
      overallCloseRate: 'إجمالي بيعات العروض ÷ إجمالي العروض × ١٠٠.',
      selectedDevicesTotal: 'مجموع عقود المدة التي جهازها أحد الأجهزة المختارة قبل التوليد.',
    },
    note: 'التقرير يقيس جمهورين مختلفين: أعمدة الاستبدال والاحتفاظ والتواصل الاجتماعي والأجهزة تعد عقودًا، وأعمدة العروض والمعدلات تعد عروضًا. لذلك مجموع أعمدة القنوات لا يساوي إجمالي بيعات الفرع، و«بيعة تسويق» تعني بيعة ناتجة عن عرض تسويقي لا كل بيعات الفرع. المعدلات كلها محسوبة داخل جمهور العروض فلا تتجاوز مئة بالمئة. العقود المعدودة هي النشطة والمكتملة: المسودة ليست بيعة بعد والملغاة بيعة انتهت. وأعمدة الأجهزة تظهر فقط عند اختيار أجهزة قبل التوليد.',
  },
};

const performanceDepartmentResults: TabularReportDefinition = {
  key: 'performance.department_results',
  groupKey: 'daily_work',
  titleAr: 'نتائج حسب القسم',
  descriptionAr: 'ما أنتجه كل قسم في كل فرع خلال المدة: مواعيد العرض وتنفيذها، والأسماء، ونقاط المبيعات وعقودها القطعية بحسب أجهزتها، والصيانة الدورية، والإيرادات النقدية.',
  question: 'ما أنتجه كل قسم في كل فرع خلال المدة جهدًا وبيعًا وخدمةً وإيرادًا؟',
  grain: 'قسم واحد في فرع واحد خلال المدة، مع صف «غير منسوب» لكل فرع',
  viewPermission: 'reports.performance.department_results.view',
  exportPermission: 'reports.performance.department_results.export',
  supportedScopes: ['GLOBAL', 'BRANCH'],
  rowIsBranch: true,
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false,
    departmentType: true, reportDeviceModels: true,
  },
  columns: [
    { key: 'branchName', titleAr: 'الفرع', type: 'text', width: 18, sortable: true },
    { key: 'departmentName', titleAr: 'القسم', type: 'text', width: 24, sortable: true },
    { key: 'dealerCount', titleAr: 'عدد البائع', type: 'integer', width: 13 },
    { key: 'scheduledDemoTasks', titleAr: 'عدد مواعيد التسويق', type: 'integer', width: 19 },
    { key: 'executedDemoTasks', titleAr: 'عدد العروض', type: 'integer', width: 14 },
    { key: 'offerRate', titleAr: 'نسبة العروض %', type: 'decimal', width: 16 },
    { key: 'namesCount', titleAr: 'عدد الأسماء', type: 'integer', width: 14 },
    { key: 'namesPerOffer', titleAr: 'نسبة الأسماء', type: 'decimal', width: 15 },
    { key: 'salesPoints', titleAr: 'مجموع نقاط المبيعات', type: 'decimal', width: 20 },
    { key: 'saleRatio', titleAr: 'نسبة البيع', type: 'decimal', width: 14 },
    { key: 'pace', titleAr: 'Pace', type: 'decimal', width: 12 },
    { key: 'challengerSales', titleAr: 'بيعات تشالنجر', type: 'integer', width: 16 },
    { key: 'doubleMembraneSales', titleAr: 'بيعات دبل ميمبرين', type: 'integer', width: 18 },
    { key: 'aquanovaSales', titleAr: 'بيعات أكوانوفا', type: 'integer', width: 16 },
    { key: 'softenerStationSales', titleAr: 'بيعات سوفتنر و محطة', type: 'integer', width: 20 },
    { key: 'safeLifeSales', titleAr: 'بيعات سيف لايف', type: 'integer', width: 17 },
    { key: 'goldenSales', titleAr: 'بيعات غولدن', type: 'integer', width: 15 },
    { key: 'firstPaymentTotal', titleAr: 'مبالغ مبيعات', type: 'decimal', width: 18 },
    { key: 'periodicDone', titleAr: 'عدد دورية منفذة', type: 'integer', width: 17 },
    { key: 'serviceRevenue', titleAr: 'إيرادات مبالغ خدمة', type: 'decimal', width: 19 },
    { key: 'receivablesRevenue', titleAr: 'إيرادات مبالغ ذمم', type: 'decimal', width: 19 },
    { key: 'totalRevenue', titleAr: 'إجمالي الإيرادات', type: 'decimal', width: 19 },
  ],
  guide: {
    framingTitle: 'نتائج كل قسم داخل فرعه',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. كل عمود يعلن إسناده إلى القسم: البيعات ومالها بمالك البيعة، والأسماء بمالك الاسم، والمواعيد والعروض والدورية بمن نفذها.',
    rowDescription: 'يمثل كل صف قسمًا واحدًا في فرع واحد. ولكل فرع صف «غير منسوب إلى قسم» يجمع ما لا يحمل إسنادًا، ولا يظهر إلا إن كان فيه عمل فعلي — فمجموع الأقسام مع صفه يساوي إجمالي الفرع.',
    columnDescriptions: {
      branchName: 'الفرع، وهو جزء من هوية الصف لا عمودًا إضافيًا.',
      departmentName: 'القسم داخل الفرع. والقسم غير البيعي يظهر بأصفار ولا يُحجب؛ ولعزل الأقسام البيعية يُستعمل فلتر نوع القسم.',
      dealerCount: 'عدد بائعي القسم النشطين، ومسمى البائع يختلف بحسب نوع القسم: في التسويق والمبيعات هو الديلر أو مندوب التسويق، وفي الصيانة وخدمة العملاء هي المشرفة لأنها من تزور وتعرض وتبيع. والخريطة مخزنة على نوع القسم وتعدلها الإدارة من قوائم النظام، فنوع القسم الذي لا مسمى بائع معرفًا له يقرأ العمود فارغًا لا صفرًا — لأن «لا دور بيعي هنا» ليس «صفر بائعين».',
      scheduledDemoTasks: 'مهام عرض الجهاز المجدولة في زيارات المدة، منسوبة إلى قسم مشرفة الزيارة الفعلية بعد أي إعادة تعيين.',
      executedDemoTasks: 'ما نُفذ من تلك المهام، أي ما سُجلت له نتيجة. وهو مجموعة فرعية من المواعيد، فنسبة العروض لا تتجاوز مئة بالمئة.',
      offerRate: 'العروض ÷ المواعيد × ١٠٠. يبقى فارغًا لا صفرًا عندما لا يكون للقسم مواعيد في المدة.',
      namesCount: 'الأسماء المقترحة المضافة داخل المدة، منسوبة إلى قسم مالك الاسم. ومالك الاسم مسجل في جزء من السجلات فقط، فالباقي يظهر في صف «غير منسوب» لا في أقسامه.',
      namesPerOffer: 'أسماء لكل عرض، وهو معامل لا نسبة مئوية: قيمة ٢ تعني اسمين لكل عرض منفذ.',
      salesPoints: 'مجموع أوزان نقاط أجهزة العقود القطعية: نقطة لتشالنجر وأكوانوفا وسوفتنر ومحطة، ونصف نقطة لغولدن وسيف لايف. والموديل الذي لا يحمل وزنًا مسجلًا لا يدخل المجموع ولا يُحسب بواحد افتراضًا.',
      saleRatio: 'العروض المنفذة ÷ العقود القطعية، وهو معامل لا نسبة مئوية: قيمة ٤ تعني أن كل أربعة عروض تنتج عقدًا قطعيًا، فانخفاضه تحسن. وهو مقلوب «معدل البيع» في تقرير المبيعات حسب النوع، فلا يُقارن به مباشرة.',
      pace: 'إسقاط لنهاية الشهر: العقود القطعية × أيام الشهر ÷ يوم نهاية المدة. يُحسب من تاريخ نهاية المدة لا من يوم التوليد فتبقى اللقطة ثابتة، ويبقى فارغًا إن امتدت المدة على أكثر من شهر لأن أيام الشهر تفقد معناها.',
      challengerSales: 'عقود قطعية جهازها أحد موديلات تشالنجر المسجلة في الكتالوج.',
      doubleMembraneSales: 'عقود قطعية جهازها دبل ميمبرين. لا موديل بهذا الاسم في الكتالوج، فالعمود صفر حتى يُسجل موديله.',
      aquanovaSales: 'عقود قطعية جهازها أحد موديلات أكوانوفا.',
      softenerStationSales: 'عقود قطعية جهازها أحد موديلات السوفتنر أو المحطة معًا، كما في الرأس المطلوب. والاثنان مخزنان منفصلين فيمكن فصلهما لاحقًا بلا تعديل بيانات.',
      safeLifeSales: 'عقود قطعية جهازها أحد موديلات سيف لايف.',
      goldenSales: 'عقود قطعية جهازها أحد موديلات غولدن غروب.',
      firstPaymentTotal: 'مجموع الدفعة الأولى المحصلة فعلًا لعقود قطعية تاريخها داخل المدة. رقم نقدي لا قيمة عقد، ولا يشمل الأقساط اللاحقة.',
      periodicDone: 'مهام الصيانة الدورية المكتملة التي أُغلقت نتيجتها داخل المدة، منسوبة إلى قسم منفذها. والمهمة المكتملة بلا نتيجة مسجلة لا تُحتسب.',
      serviceRevenue: 'كل ما حُصل نقدًا من مصادر المهام: الصيانة الطارئة والدورية والتركيب والكفالة الذهبية. لا يشمل مال العقود.',
      receivablesRevenue: 'ما حُصل نقدًا من ذمم العقود، أي كل دفعة عقد بعد دفعته الأولى. والدفعة الأولى مستثناة هنا لأنها محسوبة في عمود مبالغ المبيعات، فلا يُحسب المال مرتين.',
      totalRevenue: 'مبالغ المبيعات + إيرادات الخدمة + إيرادات الذمم. ثلاث حصص نقدية لا تتقاطع، فالمجموع يمثل ما دخل الصندوق في المدة.',
      selectedDevicesTotal: 'مجموع العقود القطعية التي جهازها أحد الأجهزة المختارة قبل التوليد.',
    },
    note: 'إسناد القسم مختلط بحكم البيانات: البيعات ومالها بمالك البيعة، والأسماء بمالك الاسم، والمواعيد والعروض والدورية بمن نفذها — لأن ملفات الزبائن بلا مُلاك عمليًا فكان إسناد العروض بالملكية سيُخرج أصفارًا لا لغياب العمل بل لغياب التسجيل. وما لا يُسند يسكن صف «غير منسوب إلى قسم» ولا يُسقط بصمت. والأرقام المالية كلها نقد محصل لا استحقاق. ونسبة الأسماء ونسبة البيع معاملان لا نسبتان مئويتان.',
  },
};

const performanceSalesCount: TabularReportDefinition = {
  key: 'performance.sales_count',
  groupKey: 'daily_work',
  titleAr: 'عدد المبيعات',
  descriptionAr: 'كم باع كل بائع من الأجهزة المحددة خلال المدة، وكم نقطة مبيعات حصلها منها. يلزم اختيار جهاز واحد على الأقل قبل التوليد.',
  question: 'كم باع كل بائع من الأجهزة المحددة خلال المدة، وكم نقطة مبيعات حصلها منها؟',
  grain: 'بائع واحد في فرع واحد خلال المدة، مع صف «غير منسوب» لكل فرع',
  viewPermission: 'reports.performance.sales_count.view',
  exportPermission: 'reports.performance.sales_count.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  rowIsBranch: true,
  dynamicColumnsBeforeKey: 'totalSales',
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false,
    reportDeviceModels: true, reportDeviceModelsRequired: true,
    contractSeller: true, departmentType: true,
  },
  columns: [
    { key: 'branchName', titleAr: 'الفرع', type: 'text', width: 18, sortable: true },
    { key: 'sellerName', titleAr: 'البائع', type: 'text', width: 24, sortable: true },
    { key: 'jobTitle', titleAr: 'الصفة', type: 'text', width: 16, sortable: true },
    { key: 'departmentName', titleAr: 'القسم', type: 'text', width: 22, sortable: true },
    { key: 'totalSales', titleAr: 'إجمالي البيعات', type: 'integer', width: 17 },
    { key: 'salesPoints', titleAr: 'مجموع نقاط المبيعات', type: 'decimal', width: 20 },
  ],
  guide: {
    framingTitle: 'بيعات كل بائع من الأجهزة المحددة',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. تُنسب البيعة إلى المدة بتاريخ العقد، وإلى البائع بمالك البيعة المسجل على العقد. واختيار الأجهزة ليس زينة: التقرير يعد بيعات الأجهزة المختارة وحدها، ونقاطه نقاط تلك البيعات.',
    rowDescription: 'يمثل كل صف بائعًا واحدًا في فرع واحد. ولكل فرع صف «غير منسوب إلى بائع» يجمع بيعاته التي لا تحمل مالكًا، ولا يظهر إلا إن وُجدت، فمجموع صفوف الفرع يساوي بيعاته من الأجهزة المختارة.',
    columnDescriptions: {
      branchName: 'فرع العقد، وهو جزء من هوية الصف لا عمودًا إضافيًا.',
      sellerName: 'مالك البيعة المسجل على العقد. والعقد بلا مالك يسكن صف «غير منسوب إلى بائع» ولا يُسقط بصمت.',
      jobTitle: 'المسمى الوظيفي للبائع كما هو مسجل على الموظف. والبيع ليس حكرًا على مسمى واحد: المشرفة تبيع، والفني يبيع أحيانًا، ومندوب التسويق يبيع — فالعمود يقول من باع لا يقيده.',
      departmentName: 'قسم البائع كما هو مسجل على الموظف. يبقى فارغًا للبائع بلا قسم ولصف «غير منسوب».',
      totalSales: 'عدد العقود القطعية في المدة التي جهازها أحد الأجهزة المختارة. وهو مجموع أعمدة الأجهزة بالضبط، فالصف يقفل حسابه.',
      salesPoints: 'مجموع أوزان نقاط الأجهزة المباعة نفسها. والموديل الذي لا يحمل وزنًا مسجلًا تُعد بيعته ولا تُنقط — لا يُحسب بواحد افتراضًا ولا تُحجب بيعته، فالصف الذي بيعاته موجبة ونقاطه صفر بائع باع أجهزة بلا وزن لا بائع خامل. ويظهر وزن كل جهاز بجانب اسمه في منسدل الاختيار.',
    },
    note: 'البيعة المعدودة هنا عقد قطعي نشط أو مكتمل: المسودة ليست بيعة بعد، والملغاة بيعة انتهت، والمؤقتة والمجانية ليستا بيعًا قطعيًا. ولا يحمل هذا التقرير عمود فريق: النظام لا يخزن للفريق هوية ثابتة — مفتاح الفريق موضعي داخل جدول اليوم — فالبيع يُنسب إلى شخص لا إلى فريق. والحد الأعلى للاختيار عشرة أجهزة في التوليد الواحد.',
  },
};

const performanceCustomerCalls: TabularReportDefinition = {
  key: 'performance.customer_calls',
  groupKey: 'daily_work',
  titleAr: 'اتصالات الزبائن',
  descriptionAr: 'ما أنجزه كل موظف اتصالًا خلال المدة: محاولات الاتصال ومواعيدها وما نُفذ منها، والبيع والتحصيل الناتجين عن مواعيده.',
  question: 'ما أنجزه كل موظف اتصالًا خلال المدة: محاولةً ومواعيدَ وتنفيذًا وبيعًا وتحصيلًا؟',
  grain: 'موظف واحد في فرع واحد خلال المدة، مع صف «غير منسوب» لكل فرع',
  viewPermission: 'reports.performance.customer_calls.view',
  exportPermission: 'reports.performance.customer_calls.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  rowIsBranch: true,
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: false,
    telemarketer: false, visitStatus: false,
    callEmployee: true, callOutcome: true,
  },
  columns: [
    { key: 'branchName', titleAr: 'الفرع', type: 'text', width: 18, sortable: true },
    { key: 'employeeName', titleAr: 'الموظف', type: 'text', width: 24, sortable: true },
    { key: 'jobTitle', titleAr: 'الصفة الوظيفية', type: 'text', width: 18, sortable: true },
    { key: 'marketingAttempts', titleAr: 'محاولات اتصال تسويق', type: 'integer', width: 20 },
    { key: 'marketingAppointments', titleAr: 'مواعيد تسويق', type: 'integer', width: 16 },
    { key: 'demosExecuted', titleAr: 'عروض منفذة', type: 'integer', width: 15 },
    { key: 'demoExecutionRate', titleAr: 'نسبة تنفيذ العروض %', type: 'decimal', width: 20 },
    { key: 'periodicAttempts', titleAr: 'محاولات اتصال دورية', type: 'integer', width: 20 },
    { key: 'periodicAppointments', titleAr: 'مواعيد صيانة دورية', type: 'integer', width: 19 },
    { key: 'periodicExecuted', titleAr: 'دورية منفذة', type: 'integer', width: 15 },
    { key: 'periodicExecutionRate', titleAr: 'نسبة تنفيذ الدورية %', type: 'decimal', width: 20 },
    { key: 'bookedWithinDue', titleAr: 'مكالمات حجز ضمن الاستحقاق', type: 'integer', width: 25 },
    { key: 'bookedPastDue', titleAr: 'مكالمات حجز بعد الاستحقاق', type: 'integer', width: 25 },
    { key: 'marketingSales', titleAr: 'مبيعات تسويق', type: 'integer', width: 16 },
    { key: 'serviceSales', titleAr: 'مبيعات صيانة', type: 'integer', width: 16 },
    { key: 'totalSales', titleAr: 'إجمالي المبيعات', type: 'integer', width: 17 },
    { key: 'collectionsCount', titleAr: 'عدد الذمم المحصلة', type: 'integer', width: 19 },
    { key: 'otherAppointments', titleAr: 'مواعيد أخرى', type: 'integer', width: 15 },
    { key: 'otherExecuted', titleAr: 'منفذ أخرى', type: 'integer', width: 14 },
    { key: 'totalAppointments', titleAr: 'إجمالي المواعيد', type: 'integer', width: 18 },
    { key: 'totalExecuted', titleAr: 'إجمالي المنفذ', type: 'integer', width: 17 },
    { key: 'overallExecutionRate', titleAr: 'نسبة التنفيذ الإجمالية %', type: 'decimal', width: 24 },
    { key: 'otherAttempts', titleAr: 'محاولات أخرى', type: 'integer', width: 16 },
    { key: 'totalCalls', titleAr: 'إجمالي مكالمات', type: 'integer', width: 17 },
    { key: 'distinctCustomers', titleAr: 'عدد الزبائن المتصل بهم', type: 'integer', width: 22 },
    { key: 'callsPerActiveDay', titleAr: 'معدل المكالمات في اليوم النشط', type: 'decimal', width: 28 },
  ],
  guide: {
    framingTitle: 'عمل الاتصال لكل موظف',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. تُنسب المكالمة إلى المدة بتاريخها بتوقيت دمشق، وإلى الموظف بحساب من أجراها. والمصدر سجل مكالمات الزبائن وحده: سجل التسويق يحمل المكالمات نفسها بمعرفات أخرى، فجمعهما يضاعف كل مكالمة تسويق.',
    rowDescription: 'يمثل كل صف موظفًا واحدًا في فرع واحد. ومكالمات حساب لا سجل موظف له تسكن صف «غير منسوب إلى موظف» في فرعها ولا تُسقط.',
    columnDescriptions: {
      branchName: 'فرع المكالمة، وهو جزء من هوية الصف لا عمودًا إضافيًا.',
      employeeName: 'موظف الحساب الذي أجرى المكالمة.',
      jobTitle: 'المسمى الوظيفي كما هو مسجل على الموظف. والاتصال ليس وظيفة قسم واحد: التلماركتر يتصل، والمشرفة تتصل، ومدخل البيانات يتصل — فالعمود يقول من اتصل لا يقيده.',
      marketingAttempts: 'مكالمات موضوعها مهمة عرض جهاز. وموضوع المكالمة هو المهمة الموسومة موضوعًا عند التسجيل، أو المهمة الوحيدة المرتبطة إن كانت واحدة؛ فالمكالمة تُربط تلقائيًا بكل مهام جهة التواصل لعرضها على صفحاتها، والربط وحده لا يعني أنها كانت عنها.',
      marketingAppointments: 'مهام العرض المتمايزة التي حُجز لها موعد في تلك المكالمات. المهمة التي اتُصل بها مرتين موعد واحد لا اثنان.',
      demosExecuted: 'من تلك المواعيد ما سُجلت له نتيجة تنفيذ فعلية.',
      demoExecutionRate: 'العروض ÷ مواعيد التسويق × ١٠٠. يبقى فارغًا لا صفرًا عندما لا تكون للموظف مواعيد في المدة.',
      periodicAttempts: 'مكالمات موضوعها مهمة صيانة دورية.',
      periodicAppointments: 'مهام الدورية المتمايزة التي حُجز لها موعد.',
      periodicExecuted: 'من مواعيد الدورية ما سُجلت له نتيجة تنفيذ.',
      periodicExecutionRate: 'المنفذ ÷ مواعيد الدورية × ١٠٠. فارغ عند غياب المواعيد.',
      bookedWithinDue: 'يعد هذا العمود مكالمات لا مهامًا، فمجموعه مع العمود التالي قد يزيد على إجمالي المواعيد إذا حُجزت مهمة بمكالمتين. مكالمات حجز كان تاريخ استحقاق مهمتها لم يفت بعد يوم الاتصال. والاستحقاق مجمد على المكالمة لحظة تسجيلها فلا ينقضه تعديل لاحق، والروابط الأقدم من ذلك التجميد تقرأ الاستحقاق الحالي.',
      bookedPastDue: 'مكالمات حجز كان استحقاق مهمتها قد فات يوم الاتصال. العمود يصف حالة المهمة التي وردت إلى الموظف بقدر ما يصف عمله: من يُسلم إليه ركام مهام فات استحقاقها يظهر هنا بلا ذنب.',
      marketingSales: 'عقود قطعية مصدرها مهمة عرض من مواعيد الموظف. ولا يُفعل عقد مصدره عرض جهاز بلا مهمته المصدر، فالعمود محروس.',
      serviceSales: 'عقود قطعية مصدرها مهمة غير العرض من مواعيده. وهذا العمود غير محروس: ربط العقد بمهمته اختياري في هذا المسار، فالعدد حد أدنى لا حصر تام.',
      totalSales: 'مبيعات التسويق مع مبيعات الصيانة، لا كل بيع الموظف: ما لم ينتج عن أحد مواعيده لا يظهر هنا. إغلاق حساب لا رقم مستقل.',
      collectionsCount: 'مهام تحصيل من مواعيد الموظف سُجل لها مبلغ مدفوع أكبر من صفر.',
      otherAppointments: 'مواعيد المهام التي ليست عرضًا ولا دورية: التسليم والكفالة والهدية والتحصيل والصيانة الطارئة وغيرها. وُجد العمود ليُقفل الحساب، فلا يظهر فارق غير مفسر بين الكتلتين والإجمالي.',
      otherExecuted: 'من مواعيد الأنواع الأخرى ما سُجلت له نتيجة تنفيذ.',
      totalAppointments: 'كل المواعيد المحجوزة بمكالماته بأي نوع مهمة، وهو مجموع مواعيد التسويق والدورية والأخرى بالضبط.',
      totalExecuted: 'من كل مواعيده ما سُجلت له نتيجة تنفيذ بأي نوع، وهو مجموع العروض المنفذة والدورية المنفذة والمنفذ من الأنواع الأخرى بالضبط.',
      overallExecutionRate: 'إجمالي المنفذ ÷ إجمالي المواعيد × ١٠٠، لكل أنواع المهام معًا. فارغ عند غياب المواعيد.',
      otherAttempts: 'مكالمات موضوعها غير التسويق والدورية، أو موضوعها غير معروف لأنها مرتبطة بعدة مهام بلا وسم للموضوع. تُعد هنا صريحة ولا تُوزع على الأعمدة تخمينًا.',
      totalCalls: 'كل مكالمات الموظف في المدة، وهو مجموع محاولات التسويق والدورية والأخرى بالضبط.',
      distinctCustomers: 'عدد الزبائن المتمايزين. الفرق بينه وبين إجمالي المكالمات هو تكرار المحاولة على الزبون نفسه.',
      callsPerActiveDay: 'إجمالي المكالمات ÷ عدد الأيام التي سجل فيها الموظف اتصالًا فعلًا. والعنوان يقول «اليوم النشط» لا «اليومي» لأن المقام أيام نشاط لا أيام دوام: لا يحمل النظام سجل حضور، فلا يُقرأ الرقم كإنتاجية مقابل دوام كامل.',
    },
    note: 'المصدر سجل مكالمات الزبائن وحده، وهو يغطي مكالمات الزبائن لا الأسماء المقترحة. وموضوع المكالمة يُحدد بالوسم أو بالرابط الوحيد، وما تعذر تحديده يُعد في «محاولات أخرى». والمواعيد تُعد مهامًا متمايزة لا مكالمات، أما المحاولات فتُعد مكالمات. وأعمدة الاستحقاق تُقاس لحظة الاتصال لا لحظة التنفيذ: تحديد تاريخ الموعد يملكه المتصل، أما التنفيذ في موعده فيملكه الفريق الميداني.',
  },
};

const performanceTechnicianWork: TabularReportDefinition = {
  key: 'performance.technician_work',
  groupKey: 'daily_work',
  titleAr: 'عمل الفنيين',
  descriptionAr: 'ما أنجزه كل فني خلال المدة: الصيانة الدورية والطارئة، والمال المحصل، والتركيب، والبيع والأسماء. ويظهر كل فني ولو لم يُسند إليه عمل.',
  question: 'ما أنجزه كل فني خلال المدة: صيانةً ومالًا وتركيبًا وبيعًا؟',
  grain: 'فني واحد في فرعه خلال المدة، ويظهر ولو بلا عمل',
  viewPermission: 'reports.performance.technician_work.view',
  exportPermission: 'reports.performance.technician_work.export',
  supportedScopes: ['GLOBAL', 'BRANCH', 'ASSIGNED'],
  rowIsBranch: true,
  filters: {
    dateRange: 'required', geography: false, supervisor: false, technician: true,
    telemarketer: false, visitStatus: false,
  },
  columns: [
    { key: 'branchName', titleAr: 'الفرع', type: 'text', width: 18, sortable: true },
    { key: 'technicianName', titleAr: 'اسم الفني', type: 'text', width: 24, sortable: true },
    { key: 'periodicDone', titleAr: 'دورية', type: 'integer', width: 12 },
    { key: 'periodicCollected', titleAr: 'مبالغ الدورية', type: 'decimal', width: 17 },
    { key: 'emergencyDone', titleAr: 'طارئة', type: 'integer', width: 12 },
    { key: 'emergencyCollected', titleAr: 'مبالغ الطارئة', type: 'decimal', width: 17 },
    { key: 'serviceDuesCollected', titleAr: 'مبالغ ذمم صيانة', type: 'decimal', width: 19 },
    { key: 'contractDuesCollected', titleAr: 'مبالغ ذمم عقود', type: 'decimal', width: 19 },
    { key: 'taskMoneyExcludingContractDues', titleAr: 'إجمالي مبالغ المهام عدا ذمم العقود', type: 'decimal', width: 32 },
    { key: 'serviceAgreementsValue', titleAr: 'مبالغ اتفاقيات خدمة', type: 'decimal', width: 21 },
    { key: 'personalSaleInstalls', titleAr: 'تركيب بيعات شخصية', type: 'integer', width: 20 },
    { key: 'otherSaleInstalls', titleAr: 'تركيب بيعات أخرى', type: 'integer', width: 19 },
    { key: 'totalExecutedTasks', titleAr: 'إجمالي مواعيد منفذة', type: 'integer', width: 21 },
    { key: 'definitiveSales', titleAr: 'بيعات', type: 'integer', width: 12 },
    { key: 'periodicWithinDue', titleAr: 'دورية منفذة ضمن الالتزام', type: 'integer', width: 25 },
    { key: 'periodicPastDue', titleAr: 'دورية منفذة خارج الاستحقاق', type: 'integer', width: 27 },
    { key: 'demosDone', titleAr: 'عروض منفذة', type: 'integer', width: 15 },
    { key: 'candidatesAdded', titleAr: 'عدد أسماء', type: 'integer', width: 14 },
    { key: 'goldenWarrantyOffers', titleAr: 'عدد كفالة ذهبية', type: 'integer', width: 18 },
    { key: 'temporaryContracts', titleAr: 'عدد عقد مؤقت', type: 'integer', width: 16 },
  ],
  guide: {
    framingTitle: 'ما أنجزه كل فني ميدانيًا',
    framingDescription: 'يُولد التقرير يدويًا ويثبت حالة البيانات لحظة التوليد. تُنسب المهمة إلى المدة بتاريخ إغلاق نتيجتها بتوقيت دمشق، وإلى الفني بفني الزيارة بعد أي إعادة تعيين. والمال هنا محصل لا مستحق: التقرير عن عمل الفني لا عن ذمم الزبون.',
    rowDescription: 'يمثل كل صف فنيًا واحدًا في فرعه. ويظهر كل فني في النطاق ولو لم يُسند إليه عمل، فالصف الصفري معلومة لا فراغ. ومسميات الفنيين تُقرأ من إعداد إداري لا من الكود.',
    columnDescriptions: {
      branchName: 'فرع الفني، وهو جزء من هوية الصف لا عمودًا إضافيًا.',
      technicianName: 'الفني كما هو مسجل في الموظفين. ويُضاف إلى الفنيين النشطين كل من نفذ عملًا داخل المدة ولو انتهت خدمته، فلا يسقط تاريخ.',
      periodicDone: 'مهام الصيانة الدورية التي أُغلقت نتيجتها داخل المدة والفني فني زيارتها.',
      periodicCollected: 'ما حُصل نقدًا على تلك المهام. والمال المستحق غير المحصل لا يظهر هنا، فالعمود يقرأ صفرًا حين لا يُسجل تحصيل ميداني — وهو غياب تسجيل لا غياب عمل.',
      emergencyDone: 'مهام الصيانة الطارئة المنفذة له.',
      emergencyCollected: 'المبلغ المحصل المسجل على مالية المهمة الطارئة.',
      serviceDuesCollected: 'ما حُصل من ذمم مصدرها غير العقد: الصيانة والتركيب وما شابه.',
      contractDuesCollected: 'ما حُصل من أقساط العقود. مفصول عما قبله لأن مال العقد ليس مال مهمة.',
      taskMoneyExcludingContractDues: 'مبالغ الدورية والطارئة وذمم الصيانة مجموعة. لا يشمل ذمم العقود ولا قيمة اتفاقيات الخدمة.',
      serviceAgreementsValue: 'قيمة اتفاقيات الخدمة المرتبطة بالدوريات التي نفذها. وتُقرأ الاتفاقية من حمولة المهمة لا من الجهاز: الإسناد بالجهاز كان سيضيف قيمة الاتفاقية مع كل مهمة نُفذت عليه فيتضاعف المبلغ. والاتفاقية الواحدة لا تُجمع مرتين للفني نفسه.',
      personalSaleInstalls: 'تركيباته المنفذة على عقود قطعية نافذة هو مالك بيعتها.',
      otherSaleInstalls: 'تركيباته المنفذة على عقود قطعية نافذة مالك بيعتها غيره، ويدخل معها العقد الذي لا مالك بيعة له لأن الفني فيه ليس البائع.',
      totalExecutedTasks: 'كل مهامه المنفذة داخل المدة بأي نوع، ومنها أنواع لا عمود مستقلًا لها كالتسليم والتفعيل والفصل.',
      definitiveSales: 'العقود القطعية النافذة التي تاريخها داخل المدة وهو مالك بيعتها. فالفني يبيع أحيانًا، والعمود يقيس ذلك بالتعريف نفسه المستعمل في تقرير عدد المبيعات.',
      periodicWithinDue: 'من دورياته المنفذة ما أُغلق في تاريخ استحقاقه أو قبله. والالتزام هنا وعد بألا يُتجاوز الموعد، فالتنفيذ المبكر خدمة للزبون لا إخلال بها.',
      periodicPastDue: 'من دورياته المنفذة ما أُغلق بعد استحقاقه. وهذا العمود مع سابقه يساوي عمود الدورية بالضبط.',
      demosDone: 'مهام عرض الجهاز التي نفذها.',
      candidatesAdded: 'الأسماء المقترحة المضافة داخل المدة والمسجلة بملكيته.',
      goldenWarrantyOffers: 'مهام عرض الكفالة الذهبية التي نفذها. ولا يشمل تسليم بطاقة الكفالة لأنه مناولة إدارية لا عرضًا.',
      temporaryContracts: 'العقود المؤقتة غير الملغاة التي تاريخها داخل المدة وهو مالك بيعتها.',
    },
    note: 'إسناد العمل هنا مكتمل: كل مهمة منفذة تحمل فنيها من لقطة فريق الزيارة بعد إعادة التعيين، فلا صف «غير منسوب» في هذا التقرير. والمال كله محصل لا مستحق. وتاريخ استحقاق الدورية قابل للتعديل ولا يسجل سجل أحداث المهمة تعديله، فعمودا الالتزام يقرآن الاستحقاق الحالي.',
  },
};

export const TABULAR_REPORTS: TabularReportDefinition[] = [
  workFilesGeoSupervisors,
  dailyVisitsLog,
  serviceInstalledDevices,
  performanceGeographicPortfolio,
  performanceSalesFollowUpTasks,
  workFilesNamesFile,
  workFilesMediatorGifts,
  dailyWorkSalesFile,
  serviceDues,
  serviceDeviceFaults,
  serviceRetrievedDevices,
  performanceSalesByType,
  performanceDepartmentResults,
  performanceSalesCount,
  performanceCustomerCalls,
  performanceTechnicianWork,
];

export const GLOBAL_BRANCH_COLUMN: TabularReportColumn = {
  key: 'branchName', titleAr: 'الفرع', type: 'text', width: 22, sortable: true,
};

export function columnsForGrantedScope(
  definition: TabularReportDefinition,
  scope: 'GLOBAL' | 'BRANCH' | 'ASSIGNED',
) {
  const injectBranch = scope === 'GLOBAL' && definition.rowIsBranch !== true;
  const columns = [
    ...(injectBranch ? [GLOBAL_BRANCH_COLUMN] : []),
    ...definition.columns,
  ];
  return columns.map(column => ({
    ...column,
    sortable: column.sortable ?? ['integer', 'decimal', 'date', 'datetime'].includes(column.type),
  }));
}

/**
 * Places the per-run columns inside the fixed header instead of always after it. The
 * anchor is a catalogue key, so the totals stay declared, documented and sortable
 * while the varying device columns sit before them.
 */
export function mergeTabularReportColumns(
  fixed: TabularReportColumn[],
  dynamic: TabularReportColumn[],
  beforeKey?: string,
): TabularReportColumn[] {
  if (dynamic.length === 0) return fixed;
  const anchor = beforeKey ? fixed.findIndex(column => column.key === beforeKey) : -1;
  if (anchor < 0) return [...fixed, ...dynamic];
  return [...fixed.slice(0, anchor), ...dynamic, ...fixed.slice(anchor)];
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
