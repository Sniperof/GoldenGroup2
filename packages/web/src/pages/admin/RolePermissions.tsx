import { useEffect, useState, useMemo, useRef } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { Permission, RolePermissionGrant } from '../../hooks/useRoleStore';
import { trpc } from '../../lib/trpc';
import { usePermissions } from '../../hooks/usePermissions';
import {
  ShieldCheck, ChevronRight, Save, Loader2, AlertTriangle,
  CheckSquare, Square, Key, Eye, Plus, Pencil, Trash2,
  ToggleRight, Award, Users, BookOpen, ClipboardList,
  Briefcase, GraduationCap, Settings, ListChecks, CheckCheck,
  UserCheck, Calendar, FileText, AlertCircle, BarChart2, ChevronDown
} from 'lucide-react';

type ScopeType = RolePermissionGrant['scopeType'];

const ALL_SCOPE_OPTIONS: Array<{ value: ScopeType; label: string }> = [
  { value: 'GLOBAL', label: 'كل الفروع' },
  { value: 'BRANCH', label: 'فرع المستخدم' },
  { value: 'ASSIGNED', label: 'السجلات المسندة' },
];

const ACTION_LABELS: Record<string, string> = {
  view_list: 'عرض القائمة',
  view_detail: 'عرض التفاصيل',
  view_eligible: 'عرض المؤهلين',
  view_audit_logs: 'عرض سجل التغييرات',
  view_history: 'عرض السجل',
  lookup: 'عرض القوائم المرجعية',
  create: 'إنشاء',
  add_trainees: 'إضافة متدربين',
  edit: 'تعديل',
  delete: 'حذف',
  edit_notes: 'تعديل الملاحظات',
  change_status: 'تغيير الحالة',
  change_stage: 'تغيير المرحلة',
  record_decision: 'تسجيل قرار',
  record_result: 'تسجيل نتيجة',
  record_attendance: 'تسجيل حضور',
  hire: 'تعيين',
  schedule: 'جدولة',
  appear: 'الظهور',
  escalate: 'تصعيد',
  archive: 'أرشفة',
  start: 'بدء',
  complete: 'إتمام',
  view: 'عرض',
  manage: 'إدارة',
  generate: 'توليد',
  book: 'حجز',
  update_result: 'تسجيل نتيجة',
  can_be_assigned: 'قابل للإسناد',
  conduct: 'إجراء',
  be_trainer: 'التدريب كمدرب',
  review: 'مراجعة',
  reject: 'رفض',
  promote: 'ترحيل',
  reopen_closed: 'إعادة فتح',
};

function isLegacyPermission(perm: Permission): boolean {
  return perm.key.startsWith('referral_sheets.') || ((perm as any).module ?? '') === 'referral_sheets';
}

function getActionLabel(action?: string | null): string {
  if (!action) return 'إجراء';
  return ACTION_LABELS[action] ?? 'إجراء مخصص';
}

/** Return the allowed scope options for a given permission, filtering by allowed_scopes if present. */
function getScopeOptions(perm: Permission): Array<{ value: ScopeType; label: string }> {
  const allowedScopes = perm.allowedScopes;
  if (!allowedScopes || allowedScopes.length === 0) return ALL_SCOPE_OPTIONS;
  return ALL_SCOPE_OPTIONS.filter(opt => allowedScopes.includes(opt.value));
}

/** Return the default scope for a permission — the first allowed scope, preferring BRANCH if available. */
function getDefaultScope(perm: Permission): ScopeType {
  const allowedScopes = perm.allowedScopes;
  if (!allowedScopes || allowedScopes.length === 0) return 'BRANCH';
  // Prefer BRANCH if allowed, otherwise GLOBAL, otherwise first in list
  if (allowedScopes.includes('BRANCH')) return 'BRANCH';
  if (allowedScopes.includes('GLOBAL')) return 'GLOBAL';
  return allowedScopes[0] as ScopeType;
}

// ── Human-readable labels & descriptions ─────────────────────────────────────
const PERM_LABELS: Record<string, { label: string; desc: string }> = {
  // Jobs - Vacancies
  'jobs.vacancies.view_list':       { label: 'عرض قائمة الشواغر',         desc: 'رؤية جميع الوظائف الشاغرة في النظام' },
  'jobs.vacancies.view_detail':     { label: 'عرض تفاصيل الشاغر',         desc: 'الدخول إلى صفحة تفاصيل أي شاغر وظيفي' },
  'jobs.vacancies.create':          { label: 'إنشاء شاغر وظيفي جديد',      desc: 'إضافة وظيفة شاغرة جديدة إلى النظام' },
  'jobs.vacancies.edit':            { label: 'تعديل بيانات الشاغر',        desc: 'تحديث معلومات الشاغر الوظيفي' },
  'jobs.vacancies.change_status':   { label: 'تغيير حالة الشاغر',          desc: 'فتح أو إغلاق أو تعليق الشاغر الوظيفي' },

  // Jobs - Applications
  'jobs.applications.view_list':        { label: 'عرض قائمة طلبات التوظيف',   desc: 'رؤية جميع الطلبات المقدمة في النظام' },
  'jobs.applications.view_detail':      { label: 'عرض تفاصيل الطلب',           desc: 'الدخول إلى ملف المتقدم والاطلاع على بياناته' },
  'jobs.applications.create':           { label: 'إضافة طلب يدوياً',            desc: 'إدخال طلب توظيف جديد بشكل يدوي' },
  'jobs.applications.change_stage':     { label: 'تحريك الطلب بين المراحل',     desc: 'نقل الطلب من مرحلة إلى أخرى في مسار التوظيف' },
  'jobs.applications.record_decision':  { label: 'تسجيل قرار على الطلب',        desc: 'قبول أو رفض أو تأجيل الطلب' },
  'jobs.applications.hire':             { label: 'تأكيد التعيين النهائي',        desc: 'إصدار قرار التعيين الرسمي للمتقدم' },
  'jobs.applications.escalate':         { label: 'تصعيد الطلب للإدارة',         desc: 'إحالة الطلب إلى جهة أعلى للبت فيه' },
  'jobs.applications.archive':          { label: 'أرشفة الطلبات',               desc: 'نقل الطلبات المنتهية إلى الأرشيف' },
  'jobs.applications.edit_notes':       { label: 'تعديل ملاحظات الطلب',         desc: 'إضافة أو تحديث الملاحظات الداخلية للطلب' },
  'jobs.applications.view_audit_logs':  { label: 'عرض سجل التغييرات',           desc: 'الاطلاع على تاريخ كامل التعديلات والإجراءات على الطلب' },

  // Jobs - Interviews
  'jobs.interviews.view_list':      { label: 'عرض قائمة المقابلات',        desc: 'رؤية جميع المقابلات المجدولة في النظام' },
  'jobs.interviews.view_detail':    { label: 'عرض تفاصيل المقابلة',        desc: 'الاطلاع على بيانات مقابلة محددة' },
  'jobs.interviews.view_eligible':  { label: 'عرض المرشحين للمقابلة',      desc: 'رؤية قائمة المتقدمين المؤهلين لإجراء المقابلة' },
  'jobs.interviews.schedule':       { label: 'جدولة موعد مقابلة',          desc: 'تحديد تاريخ ووقت إجراء المقابلة' },
  'jobs.interviews.conduct':        { label: 'إجراء المقابلات',            desc: 'التأهل للظهور كمقابِل داخل فرع الطلب' },
  'jobs.interviews.edit':           { label: 'تعديل بيانات المقابلة',       desc: 'تحديث تفاصيل مقابلة مجدولة' },
  'jobs.interviews.record_result':  { label: 'تسجيل نتيجة المقابلة',       desc: 'إدخال تقييم ونتيجة المقابلة بعد إجرائها' },

  // Jobs - Training
  'jobs.training.view_list':          { label: 'عرض قائمة الدورات التدريبية', desc: 'رؤية جميع الدورات التدريبية في النظام' },
  'jobs.training.view_detail':        { label: 'عرض تفاصيل الدورة',           desc: 'الاطلاع على بيانات دورة تدريبية محددة' },
  'jobs.training.view_eligible':      { label: 'عرض المرشحين للتدريب',         desc: 'رؤية قائمة المتقدمين المؤهلين للالتحاق بالتدريب' },
  'jobs.training.create':             { label: 'إنشاء دورة تدريبية',            desc: 'إضافة برنامج تدريبي جديد' },
  'jobs.training.start':              { label: 'بدء تنفيذ الدورة',              desc: 'تغيير حالة الدورة إلى "جارية"' },
  'jobs.training.complete':           { label: 'إنهاء الدورة التدريبية',         desc: 'إغلاق الدورة وتسجيلها كمنتهية' },
  'jobs.training.record_attendance':  { label: 'تسجيل حضور المتدربين',          desc: 'إدخال سجل حضور وغياب المتدربين' },
  'jobs.training.record_result':      { label: 'تسجيل نتائج التدريب',           desc: 'رصد درجات ونتائج المتدربين بعد انتهاء الدورة' },
  'jobs.training.add_trainees':       { label: 'إضافة متدربين للدورة',          desc: 'إلحاق متقدمين جدد بدورة تدريبية قائمة' },

  // Admin
  'admin.roles.view':             { label: 'عرض الأدوار الوظيفية',         desc: 'الاطلاع على قائمة الأدوار وصلاحياتها' },
  'admin.roles.manage':           { label: 'إدارة الأدوار والصلاحيات',     desc: 'إنشاء وتعديل وحذف الأدوار وتعديل شجرة صلاحياتها' },
  'admin.roles.users.manage':     { label: 'إسناد الأدوار للمستخدمين',     desc: 'إنشاء حسابات النظام وتغيير دور المستخدمين ضمن النطاق المسموح' },
  'admin.system_lists.view':      { label: 'عرض القوائم النظامية',          desc: 'الاطلاع على القوائم والتصنيفات المستخدمة في النظام' },
  'admin.system_lists.manage':    { label: 'إدارة القوائم النظامية',        desc: 'إضافة وتعديل وحذف عناصر القوائم النظامية' },
  'reference_data.lookup':        { label: 'قراءة القيم المرجعية داخل الحقول', desc: 'إظهار القيم الفعالة داخل النماذج بدون فتح إدارة القوائم أو تعديلها' },

  // Clients
  'clients.view_list':    { label: 'عرض قائمة الزبائن',     desc: 'الاطلاع على جميع سجلات الزبائن في النظام' },
  'clients.view':         { label: 'عرض ملف الزبون',        desc: 'الدخول إلى الصفحة التفصيلية لكل زبون' },
  'clients.view_detail':  { label: 'عرض ملف الزبون',        desc: 'الدخول إلى الصفحة التفصيلية لكل زبون' },
  'clients.create':       { label: 'إضافة زبون جديد',        desc: 'إنشاء سجل زبون جديد في النظام' },
  'clients.edit':         { label: 'تعديل بيانات الزبون',    desc: 'تحديث معلومات الزبون الموجود' },
  'clients.delete':       { label: 'حذف الزبون',             desc: 'حذف سجل زبون من النظام' },

  // Candidates
  'candidates.view_list': { label: 'عرض الأسماء المقترحة',   desc: 'الاطلاع على قائمة الأسماء المقترحة للتوظيف' },
  'candidates.create':    { label: 'إضافة اسم مقترح',        desc: 'إدخال اسم مقترح جديد يدوياً أو عبر الاستيراد' },
  'candidates.edit':      { label: 'تعديل الاسم المقترح',    desc: 'تحديث بيانات الاسم المقترح' },
  'candidates.name_lists.view_list': { label: 'عرض لوائح الأسماء',  desc: 'الاطلاع على لوائح الأسماء ضمن سجل الأسماء المقترحة' },
  'candidates.name_lists.create':    { label: 'إنشاء لائحة أسماء', desc: 'إنشاء لائحة أسماء جديدة وإسنادها للمتابعة' },
  'candidates.name_lists.edit':      { label: 'تعديل لائحة أسماء', desc: 'تحديث بيانات لائحة الأسماء وحالتها' },
  'candidates.name_lists.delete':    { label: 'حذف لائحة أسماء',   desc: 'حذف لائحة أسماء من سجل الأسماء المقترحة' },

  // Employees
  'employees.nav':        { label: 'إظهار سجلات الموظفين',      desc: 'إظهار صفحة سجلات الموظفين في الدروار' },
  'employees.lookup':     { label: 'قراءة الموظفين داخل الحقول', desc: 'إظهار الموظفين كخيارات داخل النماذج بدون فتح السجل الكامل' },
  'employees.manager_lookup': { label: 'قراءة المديرين المباشرين', desc: 'إظهار المرشحين لحقل المدير المباشر ضمن فرع وقسم الموظف' },
  'employees.view_list':  { label: 'عرض قائمة الموظفين',     desc: 'الاطلاع على سجلات الموظفين الميدانيين' },
  'employees.create':     { label: 'إضافة موظف جديد',        desc: 'إضافة موظف جديد أو إنشاء سجل موظف من طلب توظيف مقبول' },
  'employees.edit':       { label: 'تعديل بيانات الموظف',    desc: 'تحديث معلومات الموظف' },
  'employees.delete':     { label: 'حذف موظف',              desc: 'حذف سجل موظف من النظام' },

  // Contracts
  'contracts.view_list':  { label: 'عرض قائمة العقود',       desc: 'الاطلاع على جميع العقود المسجلة' },
  'contracts.create':     { label: 'إنشاء عقد جديد',          desc: 'إضافة عقد خدمة جديد للزبائن' },
  'contracts.edit':       { label: 'تعديل العقد',             desc: 'تحديث بنود وتفاصيل عقد موجود' },

  // Devices
  'devices.nav':    { label: 'إظهار قسم الأجهزة وقطع الغيار', desc: 'إظهار صفحة الأجهزة وقطع الغيار في الدروار' },
  'devices.view':   { label: 'عرض الأجهزة وقطع الغيار',       desc: 'الاطلاع على تعريفات الأجهزة وقطع الغيار' },
  'devices.manage': { label: 'إدارة الأجهزة وقطع الغيار',      desc: 'إضافة وتعديل وحذف الأجهزة وقطع الغيار' },
  'device_models.lookup': { label: 'قراءة تعريفات الأجهزة', desc: 'استخدام الأجهزة كخيارات داخل النماذج' },
  'spare_parts.lookup': { label: 'قراءة تعريفات قطع الغيار', desc: 'استخدام قطع الغيار كخيارات داخل النماذج' },
  'device_models.manage': { label: 'إدارة تعريفات الأجهزة', desc: 'إضافة وتعديل وحذف موديلات الأجهزة' },
  'spare_parts.manage': { label: 'إدارة تعريفات قطع الغيار', desc: 'إضافة وتعديل وحذف قطع الغيار' },
  'devices.discounts.view': { label: 'عرض خصومات الأجهزة', desc: 'الاطلاع على خصومات الأجهزة الحالية والتاريخية' },
  'devices.discounts.manage': { label: 'إدارة خصومات الأجهزة', desc: 'إضافة وتعديل وحذف خصومات الأجهزة' },
  'devices.department_availability.view': { label: 'عرض أجهزة الأقسام', desc: 'رؤية الأجهزة المخصصة للأقسام' },
  'devices.department_availability.manage': { label: 'إدارة أجهزة الأقسام', desc: 'تخصيص الأجهزة لأقسام الفروع' },
  'device_models.task_lookup': { label: 'قراءة أجهزة العمليات', desc: 'إظهار الأجهزة المسموحة داخل المهام والعقود' },
  'spare_parts.task_lookup': { label: 'قراءة قطع غيار العمليات', desc: 'إظهار قطع الغيار المسموحة داخل نتائج الصيانة' },

  // Tasks
  'open_tasks.view': { label: 'عرض المهام والعمليات',        desc: 'الاطلاع على مهام اليوم والطوارئ والصيانة والمتابعة' },
  'open_tasks.edit': { label: 'إدارة المهام وتحديث حالاتها', desc: 'تغيير حالة المهام وتعيينها للفرق' },

  // Planning
  'planning.view':   { label: 'عرض خطط وجداول الفرع',      desc: 'الاطلاع على ملخص الخطة وجداول الفرق' },
  'planning.manage': { label: 'إدارة الجدولة وتعيين المسارات', desc: 'إنشاء الجداول وتعيين مسارات العمل للفرق' },
  'planning.schedule.appear': { label: 'الظهور في جدولة الفرق', desc: 'يسمح للموظفين بهذا الدور بدخول جدولة الفرق، ويكتمل ظهورهم ضمن القوائم بعد تحديد خانة الفريق لهذا الدور' },

  // Telemarketer
  'telemarketer.view':   { label: 'عرض إدارة المواعيد',       desc: 'الاطلاع على المواعيد والعملاء المحتملين' },
  'telemarketer.manage': { label: 'إدارة المواعيد والعملاء',  desc: 'إضافة وتعديل المواعيد وتتبع العملاء المحتملين' },

  // Geo
  'geo.view':   { label: 'عرض المناطق الجغرافية',      desc: 'الاطلاع على المستويات الإدارية والمناطق' },
  'geo.manage': { label: 'إدارة المناطق والمستويات',   desc: 'إضافة وتعديل وتنظيم المناطق الجغرافية' },

  // Routes (خطوط السير) — branch-operational, separate from the national geo tree
  'routes.view':   { label: 'عرض خطوط السير',   desc: 'الاطلاع على المسارات ضمن نطاق تغطية الفرع' },
  'routes.manage': { label: 'إدارة خطوط السير', desc: 'إنشاء وتعديل وحذف المسارات ضمن نطاق تغطية الفرع' },
  'routes.assign.view':   { label: 'عرض توزيع المسارات',   desc: 'الاطلاع على توزيع المسارات على فرق الفرع اليومية' },
  'routes.assign.manage': { label: 'إدارة توزيع المسارات', desc: 'تعيين مسارات ومناطق الفرق اليومية ضمن الفرع' },

  // Branches
  'branches.nav':    { label: 'إظهار إدارة الفروع والأقسام', desc: 'إظهار صفحة الفروع والأقسام في الدروار' },
  'branches.lookup': { label: 'قراءة الفروع داخل الحقول', desc: 'إظهار الفروع المسموحة كخيارات داخل النماذج بدون فتح الإدارة' },
  'branches.view':   { label: 'عرض الفروع',    desc: 'الاطلاع على قائمة الفروع وبياناتها' },
  'branches.edit':   { label: 'تعديل بيانات الفرع', desc: 'تعديل البيانات التعريفية للفرع دون القرارات الحساسة' },
  'branches.manage': { label: 'إدارة الفروع',  desc: 'إضافة الفروع وتعديل حالتها ونطاق تغطيتها وحذفها' },
  'departments.lookup': { label: 'قراءة الأقسام داخل الحقول', desc: 'إظهار أقسام الفروع المسموحة كخيارات داخل النماذج' },
  'departments.view_list': { label: 'عرض أقسام الفروع', desc: 'عرض قائمة الأقسام ضمن الفروع المسموحة' },
  'departments.manage': { label: 'إدارة الأقسام', desc: 'إضافة وتعديل وحذف الأقسام داخل الفرع' },

  // Settings
  'settings.view':   { label: 'عرض إعدادات النظام',   desc: 'الاطلاع على إعدادات وتكوينات النظام' },
  'settings.manage': { label: 'تعديل إعدادات النظام', desc: 'تغيير إعدادات النظام وتخصيص العمل' },
};

// ── Action icon map ───────────────────────────────────────────────────────────
function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { icon: React.ReactNode; color: string; text: string }> = {
    view_list:        { icon: <Eye className="w-3 h-3" />,          color: 'bg-blue-50 text-blue-600',     text: 'عرض' },
    view_detail:      { icon: <Eye className="w-3 h-3" />,          color: 'bg-blue-50 text-blue-600',     text: 'تفاصيل' },
    view_eligible:    { icon: <Users className="w-3 h-3" />,        color: 'bg-blue-50 text-blue-600',     text: 'استعراض' },
    view_audit_logs:  { icon: <BookOpen className="w-3 h-3" />,     color: 'bg-slate-100 text-slate-600',  text: 'سجلات' },
    create:           { icon: <Plus className="w-3 h-3" />,         color: 'bg-emerald-50 text-emerald-600', text: 'إنشاء' },
    add_trainees:     { icon: <Plus className="w-3 h-3" />,         color: 'bg-emerald-50 text-emerald-600', text: 'إضافة' },
    edit:             { icon: <Pencil className="w-3 h-3" />,       color: 'bg-amber-50 text-amber-600',   text: 'تعديل' },
    delete:           { icon: <Trash2 className="w-3 h-3" />,       color: 'bg-rose-50 text-rose-600',     text: 'حذف' },
    edit_notes:       { icon: <Pencil className="w-3 h-3" />,       color: 'bg-amber-50 text-amber-600',   text: 'تعديل' },
    change_status:    { icon: <ToggleRight className="w-3 h-3" />,  color: 'bg-amber-50 text-amber-600',   text: 'تغيير' },
    change_stage:     { icon: <ToggleRight className="w-3 h-3" />,  color: 'bg-amber-50 text-amber-600',   text: 'تحريك' },
    record_decision:  { icon: <CheckCheck className="w-3 h-3" />,   color: 'bg-purple-50 text-purple-600', text: 'قرار' },
    record_result:    { icon: <Award className="w-3 h-3" />,        color: 'bg-purple-50 text-purple-600', text: 'نتيجة' },
    record_attendance:{ icon: <UserCheck className="w-3 h-3" />,    color: 'bg-purple-50 text-purple-600', text: 'حضور' },
    hire:             { icon: <CheckCheck className="w-3 h-3" />,   color: 'bg-emerald-100 text-emerald-700', text: 'تعيين' },
    schedule:         { icon: <Calendar className="w-3 h-3" />,     color: 'bg-sky-50 text-sky-600',       text: 'جدولة' },
    appear:           { icon: <Eye className="w-3 h-3" />,          color: 'bg-cyan-50 text-cyan-600',     text: 'ظهور' },
    escalate:         { icon: <AlertCircle className="w-3 h-3" />,  color: 'bg-rose-50 text-rose-600',     text: 'تصعيد' },
    archive:          { icon: <FileText className="w-3 h-3" />,     color: 'bg-slate-100 text-slate-500',  text: 'أرشفة' },
    start:            { icon: <ToggleRight className="w-3 h-3" />,  color: 'bg-emerald-50 text-emerald-600', text: 'بدء' },
    complete:         { icon: <CheckCheck className="w-3 h-3" />,   color: 'bg-emerald-100 text-emerald-700', text: 'إتمام' },
    view:             { icon: <Eye className="w-3 h-3" />,          color: 'bg-blue-50 text-blue-600',     text: 'عرض' },
    manage:           { icon: <Settings className="w-3 h-3" />,     color: 'bg-rose-50 text-rose-600',     text: 'إدارة' },
  };
  const cfg = map[action] ?? { icon: <Key className="w-3 h-3" />, color: 'bg-slate-100 text-slate-500', text: getActionLabel(action) };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      {cfg.icon}{cfg.text}
    </span>
  );
}

// ── Module config ─────────────────────────────────────────────────────────────
const MODULE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  jobs:         { label: 'إدارة التوظيف',              icon: <Briefcase className="w-4 h-4" />,    color: 'text-sky-600 bg-sky-50' },
  clients:      { label: 'سجلات الزبائن',              icon: <Users className="w-4 h-4" />,        color: 'text-violet-600 bg-violet-50' },
  candidates:   { label: 'الأسماء المقترحة',            icon: <UserCheck className="w-4 h-4" />,    color: 'text-indigo-600 bg-indigo-50' },
  employees:    { label: 'سجلات الموظفين',              icon: <Users className="w-4 h-4" />,        color: 'text-emerald-600 bg-emerald-50' },
  contracts:    { label: 'العقود',                      icon: <FileText className="w-4 h-4" />,     color: 'text-amber-600 bg-amber-50' },
  devices:      { label: 'الأجهزة وقطع الغيار',         icon: <BarChart2 className="w-4 h-4" />,    color: 'text-cyan-600 bg-cyan-50' },
  tasks:        { label: 'المهام والعمليات',             icon: <ClipboardList className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
  planning:     { label: 'إدارة عمل الفرع',             icon: <Calendar className="w-4 h-4" />,     color: 'text-teal-600 bg-teal-50' },
  telemarketer: { label: 'إدارة المواعيد',              icon: <AlertCircle className="w-4 h-4" />,  color: 'text-pink-600 bg-pink-50' },
  geo:          { label: 'المناطق الجغرافية',           icon: <BookOpen className="w-4 h-4" />,     color: 'text-lime-600 bg-lime-50' },
  branches:     { label: 'الفروع',                      icon: <Users className="w-4 h-4" />,        color: 'text-fuchsia-600 bg-fuchsia-50' },
  settings:     { label: 'إعدادات النظام',              icon: <Settings className="w-4 h-4" />,     color: 'text-slate-600 bg-slate-100' },
  admin:        { label: 'إدارة النظام والصلاحيات',     icon: <Settings className="w-4 h-4" />,     color: 'text-rose-600 bg-rose-50' },
  users:        { label: 'المستخدمون',                   icon: <Users className="w-4 h-4" />,        color: 'text-indigo-600 bg-indigo-50' },
  departments:  { label: 'الأقسام',                      icon: <ListChecks className="w-4 h-4" />,   color: 'text-slate-600 bg-slate-100' },
  marketing_visits: { label: 'الزيارات التسويقية',       icon: <Calendar className="w-4 h-4" />,     color: 'text-emerald-600 bg-emerald-50' },
  telemarketing: { label: 'التيلماركتنغ',                icon: <AlertCircle className="w-4 h-4" />,  color: 'text-pink-600 bg-pink-50' },
  field_visits: { label: 'الزيارات الميدانية',           icon: <Calendar className="w-4 h-4" />,     color: 'text-teal-600 bg-teal-50' },
  open_tasks:   { label: 'المهام المفتوحة',              icon: <ClipboardList className="w-4 h-4" />, color: 'text-orange-600 bg-orange-50' },
  service_requests: { label: 'طلبات الخدمة والصيانة',    icon: <FileText className="w-4 h-4" />,     color: 'text-cyan-600 bg-cyan-50' },
  reference_data: { label: 'القوائم المرجعية', icon: <ListChecks className="w-4 h-4" />, color: 'text-slate-600 bg-slate-100' },
};

const SUB_MODULE_LABELS: Record<string, string> = {
  vacancies:    'الشواغر الوظيفية',
  applications: 'طلبات التوظيف',
  interviews:   'المقابلات',
  training:     'الدورات التدريبية',
  candidates:    'الأسماء المقترحة',
  name_lists:    'لوائح الأسماء',
  roles:        'الأدوار والصلاحيات',
  roles_users:  'إسناد الأدوار للمستخدمين',
  system_lists: 'القوائم النظامية',
  branch_assignments: 'فروع المستخدمين المسموحة',
  management: 'الإدارة',
  system: 'النظام',
  geography: 'المناطق الجغرافية',
  visits: 'الزيارات',
  tasks: 'المهام',
  targets: 'الأهداف',
  lists: 'قوائم الاتصال',
  calls: 'المكالمات',
  appointments: 'المواعيد',
  schedule: 'جدولة الفرق',
  service_requests: 'طلبات الخدمة والصيانة',
  lookups: 'الاستخدام داخل العمليات',
  navigation: 'ظهور القسم',
  device_models: 'تعريفات الأجهزة',
  spare_parts: 'تعريفات قطع الغيار',
  discounts: 'خصومات الأجهزة',
  department_availability: 'أجهزة الأقسام',
  installed_devices: 'الأجهزة المركبة',
  installed_device_possession: 'حيازة الأجهزة',
};

function getModuleConfig(module: string) {
  return MODULE_CONFIG[module] ?? {
    label: 'إدارة عمل الفرع',
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-teal-600 bg-teal-50',
  };
}

function getSubModuleLabel(subModule: string): string {
  return SUB_MODULE_LABELS[subModule] ?? 'مجموعة صلاحيات';
}

function getPermissionGrouping(perm: Permission): { module: string; subModule: string } {
  if (perm.key === 'reference_data.lookup') {
    return { module: 'admin', subModule: 'system_lists' };
  }
  return {
    module: (perm as any).module ?? 'other',
    subModule: (perm as any).sub_module ?? (perm as any).subModule ?? 'general',
  };
}

// ── Helper to get display name safely (snake_case & camelCase) ────────────────
function getPermLabel(perm: Permission): string {
  const known = PERM_LABELS[perm.key];
  if (known) return known.label;
  // Fallback: API may return display_name (snake_case)
  const raw = (perm as any).display_name ?? perm.displayName;
  if (raw && raw !== perm.key) return raw;
  const action = getActionLabel((perm as any).action);
  const sub = getSubModuleLabel((perm as any).sub_module ?? (perm as any).subModule ?? '');
  return `${action} - ${sub}`;
}

function getPermDesc(perm: Permission): string | null {
  return PERM_LABELS[perm.key]?.desc ?? null;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RolePermissions() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const roleId = Number(id);
  const { hasPermission } = usePermissions();

  const { roles, allPermissions, fetchRoles, fetchPermissions, updateRolePermissions } = useRoleStore();
  const role = roles.find(r => r.id === roleId);
  const canManageRolePermissions = hasPermission('admin.roles.manage');
  const isProtectedRole = role?.isSystem || role?.isProtected;

  const [assigned, setAssigned] = useState<Map<number, ScopeType>>(new Map());
  const previousScopes = useRef(new Map<number, ScopeType>());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([fetchRoles(), fetchPermissions()]).then(() => setLoading(false));
  }, [fetchRoles, fetchPermissions]);

  useEffect(() => {
    if (!roleId) return;
    trpc.roles.getPermissions.query({ id: roleId })
      .then((perms: RolePermissionGrant[]) => {
        setAssigned(new Map(perms.map(p => [p.id, p.scopeType ?? getDefaultScope(p)])));
      })
      .catch(() => {});
  }, [roleId]);

  // Group by module → subModule
  const grouped = useMemo(() => {
    const map: Record<string, Record<string, Permission[]>> = {};
    for (const p of allPermissions) {
      if (isLegacyPermission(p)) continue;
      const { module: mod, subModule: sub } = getPermissionGrouping(p);
      if (!map[mod]) map[mod] = {};
      if (!map[mod][sub]) map[mod][sub] = [];
      map[mod][sub].push(p);
    }
    return map;
  }, [allPermissions]);

  const moduleEntries = useMemo(() => Object.entries(grouped), [grouped]);
  const moduleKeys = useMemo(() => moduleEntries.map(([module]) => module), [moduleEntries]);

  useEffect(() => {
    setOpenModules(prev => new Set([...prev].filter(module => moduleKeys.includes(module))));
  }, [moduleKeys]);

  function toggle(perm: Permission) {
    if (!canManageRolePermissions || isProtectedRole) return;
    setAssigned(prev => {
      const next = new Map(prev);
      if (next.has(perm.id)) {
        previousScopes.current.set(perm.id, next.get(perm.id)!);
        next.delete(perm.id);
      } else {
        const prevScope = previousScopes.current.get(perm.id);
        next.set(perm.id, prevScope ?? getDefaultScope(perm));
      }
      return next;
    });
  }

  function setScope(permId: number, scopeType: ScopeType) {
    if (!canManageRolePermissions || isProtectedRole) return;
    setAssigned(prev => {
      const next = new Map(prev);
      next.set(permId, scopeType);
      return next;
    });
  }

  function toggleSubModule(perms: Permission[]) {
    if (!canManageRolePermissions || isProtectedRole) return;
    const ids = perms.map(p => p.id);
    const allSelected = ids.every(id => assigned.has(id));
    setAssigned(prev => {
      const next = new Map(prev);
      allSelected ? ids.forEach(id => next.delete(id)) : ids.forEach(id => {
        const perm = perms.find(p => p.id === id)!;
        next.set(id, getDefaultScope(perm));
      });
      return next;
    });
  }

  function toggleModule(subGroups: Record<string, Permission[]>) {
    if (!canManageRolePermissions || isProtectedRole) return;
    const allPerms = Object.values(subGroups).flat();
    const ids = allPerms.map(p => p.id);
    const allSelected = ids.every(id => assigned.has(id));
    setAssigned(prev => {
      const next = new Map(prev);
      allSelected ? ids.forEach(id => next.delete(id)) : ids.forEach(id => {
        const perm = allPerms.find(p => p.id === id)!;
        next.set(id, getDefaultScope(perm));
      });
      return next;
    });
  }

  function toggleModulePanel(module: string) {
    setOpenModules(prev => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  function expandAllModules() {
    setOpenModules(new Set(moduleKeys));
  }

  function collapseAllModules() {
    setOpenModules(new Set());
  }

  async function handleSave() {
    if (!canManageRolePermissions || isProtectedRole) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await updateRolePermissions(
        roleId,
        [...assigned.entries()].map(([permissionId, scopeType]) => ({ permissionId, scopeType })),
      );
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message ?? 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  if (!hasPermission('admin.roles.view')) {
    return <Navigate to="/" replace />;
  }

  if (!role) {
    return <Navigate to="/admin/roles" replace />;
  }

  const visibleAssignedCount = Object.values(grouped)
    .flatMap(subGroups => Object.values(subGroups).flat())
    .filter(permission => assigned.has(permission.id)).length;
  const totalPerms = Object.values(grouped)
    .reduce((sum, subGroups) => sum + Object.values(subGroups).flat().length, 0);
  const grantedPercent = totalPerms > 0 ? Math.round((visibleAssignedCount / totalPerms) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => navigate('/admin/roles')}
            className="p-2 rounded-xl hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/30 shrink-0">
            <Key className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-800 truncate">
              صلاحيات دور: <span className="text-sky-600">{role?.displayName ?? `#${roleId}`}</span>
            </h1>
            <p className="text-xs text-slate-500">
              {visibleAssignedCount} صلاحية مُفعَّلة من أصل {totalPerms}
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !canManageRolePermissions || !!isProtectedRole}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50 shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ التغييرات
          </button>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>نسبة الصلاحيات الممنوحة</span>
            <span className="font-bold text-slate-700">
              {grantedPercent}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-sky-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${grantedPercent}%` }}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-bold text-slate-800">{'\u0627\u0644\u0623\u0642\u0633\u0627\u0645'}</p>
              <p className="text-xs text-slate-500">{'\u0643\u0644 \u0643\u0627\u0631\u062f \u0623\u0635\u0628\u062d \u0642\u0627\u0628\u0644\u0627\u064b \u0644\u0644\u0637\u064a. \u0627\u0641\u062a\u062d \u0627\u0644\u0642\u0633\u0645 \u0627\u0644\u0630\u064a \u062a\u0631\u064a\u062f\u0647 \u0641\u0642\u0637.'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-nowrap">
              <button
                onClick={expandAllModules}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-sky-50 text-sky-600 hover:bg-sky-100 transition-colors"
              >
                {'\u0641\u062a\u062d \u0627\u0644\u0643\u0644'}
              </button>
              <button
                onClick={collapseAllModules}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
              >
                {'\u0637\u064a \u0627\u0644\u0643\u0644'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {moduleEntries.map(([module, subGroups]) => {
              const modCfg = getModuleConfig(module);
              const allModulePerms = Object.values(subGroups).flat();
              const moduleSelected = allModulePerms.filter(p => assigned.has(p.id)).length;
              const isOpen = openModules.has(module);

              return (
                <button
                  key={module}
                  onClick={() => toggleModulePanel(module)}
                  className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-all ${
                    isOpen
                      ? 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${modCfg.color}`}>
                    {modCfg.icon}
                  </span>
                  <span>{modCfg.label}</span>
                  <span className={`rounded-full px-2 py-0.5 ${isOpen ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>
                    {moduleSelected}/{allModulePerms.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-xl p-4">
            <ShieldCheck className="w-4 h-4 shrink-0" />تم حفظ الصلاحيات بنجاح
          </div>
        )}
        {isProtectedRole && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />هذا الدور محمي ولا يمكن تعديل صلاحياته من الواجهة الإدارية العادية
          </div>
        )}

        {/* Permissions grouped by module → subModule */}
        {moduleEntries.map(([module, subGroups]) => {
          const modCfg = getModuleConfig(module);
          const allModulePerms = Object.values(subGroups).flat();
          const moduleSelected = allModulePerms.filter(p => assigned.has(p.id)).length;
          const moduleTotal = allModulePerms.length;
          const allModuleSelected = moduleSelected === moduleTotal;
          const isOpen = openModules.has(module);
          const subModuleNames = Object.keys(subGroups).map(getSubModuleLabel);

          return (
            <div key={module} className={`bg-white rounded-2xl border overflow-hidden transition-all ${isOpen ? 'border-sky-200 shadow-lg shadow-sky-100/60' : 'border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200'}`}>
              {/* Module Header */}
              <div className={`flex items-start justify-between gap-4 px-5 py-4 ${isOpen ? 'border-b border-slate-100 bg-gradient-to-l from-sky-50 via-white to-white' : ''}`}>
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${modCfg.color}`}>
                    {modCfg.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800">{modCfg.label}</h3>
                    {!isOpen && (
                      <div className="flex flex-wrap gap-1.5 mt-2 mb-1">
                        {subModuleNames.slice(0, 3).map(name => (
                          <span key={name} className="inline-flex items-center rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[10px] font-medium">
                            {name}
                          </span>
                        ))}
                        {subModuleNames.length > 3 && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-400 px-2 py-0.5 text-[10px] font-medium">
                            +{subModuleNames.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-400">{moduleSelected} من {moduleTotal} صلاحية مُفعَّلة</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleModule(subGroups)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                      allModuleSelected
                        ? 'bg-sky-100 text-sky-600 hover:bg-sky-200'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {allModuleSelected ? '\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0643\u0644' : '\u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0643\u0644'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleModulePanel(module)}
                    aria-expanded={isOpen}
                    className="p-2 rounded-xl border border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-200 transition-all"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {/* SubModule Groups */}
              {isOpen && (
              <div className="divide-y divide-slate-50">
                {Object.entries(subGroups).map(([sub, perms]) => {
                  const subLabel = getSubModuleLabel(sub);
                  const subSelected = perms.filter(p => assigned.has(p.id)).length;
                  const allSubSelected = subSelected === perms.length;

                  return (
                    <div key={sub}>
                      {/* SubModule header */}
                      <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/60">
                        <span className="text-xs font-semibold text-slate-500">{subLabel}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">{subSelected}/{perms.length}</span>
                          <button
                            onClick={() => toggleSubModule(perms)}
                            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                              allSubSelected
                                ? 'bg-sky-100 text-sky-600 hover:bg-sky-200'
                                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {allSubSelected ? 'إلغاء' : 'تحديد الكل'}
                          </button>
                        </div>
                      </div>

                      {/* Permission rows */}
                      {perms
                        .sort((a, b) => ((a as any).display_order ?? 0) - ((b as any).display_order ?? 0))
                        .map(perm => {
                          const isOn = assigned.has(perm.id);
                          const scopeType = assigned.get(perm.id) ?? getDefaultScope(perm);
                          const desc = getPermDesc(perm);
                          const action = (perm as any).action ?? '';
                          const scopeOptions = getScopeOptions(perm);

                          return (
                            <div
                              key={perm.id}
                              className={`flex items-start gap-3 px-5 py-3.5 transition-colors group ${
                                isOn ? 'bg-sky-50/40 hover:bg-sky-50/70' : 'hover:bg-slate-50/80'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggle(perm)}
                                disabled={!canManageRolePermissions || !!isProtectedRole}
                                aria-pressed={isOn}
                                className="mt-0.5 shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed"
                              >
                                {isOn
                                  ? <CheckSquare className="w-4 h-4 text-sky-500" />
                                  : <Square className="w-4 h-4 text-slate-300 group-hover:text-slate-400" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-sm font-semibold ${isOn ? 'text-slate-800' : 'text-slate-600'}`}>
                                        {getPermLabel(perm)}
                                      </span>
                                      <ActionBadge action={action} />
                                    </div>
                                    {desc && (
                                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{desc}</p>
                                    )}
                                  </div>
                                  {isOn && scopeOptions.length > 1 && (
                                    <select
                                      value={scopeType}
                                      onClick={event => event.stopPropagation()}
                                      onChange={event => setScope(perm.id, event.target.value as ScopeType)}
                                      disabled={!canManageRolePermissions || !!isProtectedRole}
                                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-300"
                                    >
                                      {scopeOptions.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  )}
                                  {isOn && scopeOptions.length === 1 && (
                                    <span className="shrink-0 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-400">
                                      {scopeOptions[0].label}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}

        {Object.keys(grouped).length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا توجد صلاحيات متاحة</p>
          </div>
        )}

        {/* Sticky Save */}
        <div className="sticky bottom-4 flex justify-center pb-2">
          <button
            onClick={handleSave}
            disabled={saving || !canManageRolePermissions || !!isProtectedRole}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold px-8 py-3 rounded-2xl transition-colors shadow-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            حفظ التغييرات
          </button>
        </div>
      </div>
    </div>
  );
}
