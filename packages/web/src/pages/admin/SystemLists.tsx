import { useEffect, useState, useMemo } from 'react';
import { useSystemListsStore } from '../../hooks/useSystemLists';
import { useRoleStore } from '../../hooks/useRoleStore';
import type { SystemList } from '../../lib/types';
import {
  Settings2, Plus, Edit, Trash2, Save, X, ListPlus,
  Search, ChevronLeft, ChevronDown, GraduationCap,
  Tag, FolderPlus, Link2, FileText, Users, Briefcase,
  Info, AlertTriangle, ShieldCheck, BookOpen, Layers, Cpu, Phone,
  Wrench, ClipboardList, DollarSign, MapPin, Bug, Package,
  RotateCcw, Ban, Truck, Clock, Percent, Star, Snowflake, Receipt,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import IconButton from '../../components/ui/IconButton';
import { useAuthStore } from '../../hooks/useAuthStore';
import { Navigate } from 'react-router-dom';
import Select from '../../components/ui/Select';
import Toggle from '../../components/ui/Toggle';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import PageHeader from '../../components/ui/PageHeader';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';

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
    description: 'قائمة المسميات الوظيفية المعتمدة. كل مسمى يرتبط بدور من الأدوار والصلاحيات — وعند إضافة موظف يُختار المسمى من هذه القائمة فيُسند الدور تلقائياً.',
    impact: 'high',
    usedIn: [
      { label: 'إضافة موظف مباشرة', route: 'الموظفون ← إضافة موظف', icon: <Users className="w-3 h-3" /> },
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
  {
    id: 'department_type',
    label: 'أنواع الأقسام',
    description: 'أنواع الأقسام التنظيمية داخل الفرع (مبيعات، تسويق، صيانة...). يمكن تفعيل خيار "تخصيص أجهزة" لكل نوع بحيث يظهر حقل الأجهزة عند إنشاء قسم من هذا النوع.',
    impact: 'medium',
    usedIn: [
      { label: 'إدارة أقسام الفرع', route: 'الفروع ← تفاصيل الفرع ← الأقسام', icon: <Layers className="w-3 h-3" /> },
    ],
  },
  {
    id: 'military_service',
    label: 'الخدمة العسكرية',
    description: 'القيم المعتمدة لحالة الخدمة العسكرية في ملف الموظف، وتُستخدم عند الإضافة المباشرة وعند تحويل المقبولين من طلبات التوظيف إلى سجلات موظفين.',
    impact: 'medium',
    usedIn: [
      { label: 'إضافة موظف مباشرة', route: 'الموظفون ← إضافة موظف', icon: <Users className="w-3 h-3" /> },
      { label: 'قبول نهائي ثم إنشاء موظف', route: 'الوظائف ← تفاصيل الطلب ← إنشاء سجل موظف', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'telemarketing_rejection_reason',
    label: 'أسباب رفض الجدولة',
    description: 'أسباب إغلاق جهة الاتصال بدون حجز موعد — تظهر عند اختيار "غير مهتم" أو "رفض الجدولة" في مودال تسجيل نتيجة التواصل.',
    impact: 'medium' as const,
    usedIn: [
      { label: 'مودال نتيجة التواصل — غير مهتم', route: 'التيلماركتر ← تسجيل نتيجة', icon: <Phone className="w-3 h-3" /> },
      { label: 'نافذة الإغلاق اليدوي', route: 'التيلماركتر ← إغلاق جهة الاتصال', icon: <Phone className="w-3 h-3" /> },
    ],
  },
  {
    id: 'telemarketing_reschedule_reason',
    label: 'أسباب المتابعة',
    description: 'أسباب طلب المتابعة لاحقاً — تظهر عند اختيار "متابعة لاحقاً" في مودال تسجيل نتيجة التواصل.',
    impact: 'low' as const,
    usedIn: [
      { label: 'مودال نتيجة التواصل — متابعة لاحقاً', route: 'التيلماركتر ← تسجيل نتيجة', icon: <Phone className="w-3 h-3" /> },
    ],
  },
  {
    id: 'contract_type',
    label: 'أنواع العقود',
    description: 'نوع العقد المعتمد للموظف مثل دائم أو مؤقت أو تجربة. هذه القائمة أصبحت جزءاً إلزامياً من النموذج الموحد للموظفين.',
    impact: 'high',
    usedIn: [
      { label: 'إضافة موظف مباشرة', route: 'الموظفون ← إضافة موظف', icon: <Users className="w-3 h-3" /> },
      { label: 'تعديل ملف موظف', route: 'الموظفون ← تفاصيل الموظف ← النموذج الكامل', icon: <Briefcase className="w-3 h-3" /> },
    ],
  },
  {
    id: 'foreign_language',
    label: 'اللغات الأجنبية',
    description: 'قائمة اللغات الأجنبية متعددة الاختيار المستخدمة في ملف الموظف، ويمكن الاستفادة منها أيضاً في نماذج التقديم والتأهيل.',
    impact: 'medium',
    usedIn: [
      { label: 'إضافة موظف مباشرة', route: 'الموظفون ← إضافة موظف', icon: <Users className="w-3 h-3" /> },
      { label: 'إدخال طلب يدوي', route: 'الوظائف ← الطلبات ← إدخال يدوي', icon: <FileText className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم الزيارات والاستطلاع
  // ══════════════════════════════════════════════════════════════
  {
    id: 'area_evaluation_options',
    label: 'تقييم المنطقة (استطلاع الزيارة)',
    description: 'مستويات تقييم المنطقة جغرافياً/سكانياً التي يَختارها الفني عند تَعبئة استطلاع الزيارة الميدانية. تُغذِّي تَقارير جَودة الانتشار.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال استطلاع الزيارة', route: 'الزيارات ← تفاصيل الزيارة ← الاستطلاع', icon: <Star className="w-3 h-3" /> },
    ],
  },
  {
    id: 'survey_skip_reasons',
    label: 'أسباب تَخطّي استطلاع الزيارة',
    description: 'القيم المعتمدة عند اختيار "تَخطّي الاستطلاع" — تَضمن وجود سَبب مُهيكَل بَدَل نَص حُر، ضَرورية لإكمال إغلاق الزيارة (DEC-007 D44).',
    impact: 'medium',
    usedIn: [
      { label: 'مودال استطلاع الزيارة — تَخطّي', route: 'الزيارات ← تفاصيل الزيارة ← تَخطّي الاستطلاع', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'location_missing_reasons',
    label: 'أسباب غياب GPS عند بَدء/إنهاء الزيارة',
    description: 'الأسباب المُعتَمَدة عندما يَكون GPS غير مُتوفِّر لحظة بَدء أو إنهاء الزيارة الميدانية. شَرط إجباري في endpoint البَدء/الإنهاء.',
    impact: 'medium',
    usedIn: [
      { label: 'بَدء/إنهاء الزيارة', route: 'الزيارات ← تفاصيل الزيارة ← بدء/إنهاء', icon: <MapPin className="w-3 h-3" /> },
    ],
  },
  {
    id: 'visit_cancellation_reasons',
    label: 'أسباب إلغاء الزيارة / المهمة',
    description: 'الأسباب المعتمدة عند إلغاء زيارة تَسويق أو مَهمة صيانة طارئة ميدانياً. تَنعكس على open_task بحالة "ملغاة" و تُحفظ في `cancellation_reason`.',
    impact: 'high',
    usedIn: [
      { label: 'مودال نتيجة الزيارة التسويقية — إلغاء', route: 'الزيارات ← نتيجة المهمة', icon: <Ban className="w-3 h-3" /> },
      { label: 'مودال نتيجة الصيانة الطارئة — إلغاء', route: 'الزيارات ← مهمة صيانة', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'visit_not_completed_reasons',
    label: 'أسباب عدم اكتمال الزيارة',
    description: 'أسباب عَدم إكمال زيارة بَدأت ميدانياً لكنها لم تَنتهِ بنَجاح. تُخَزَّن على `field_visits.not_completed_reason`.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال إنهاء الزيارة بدون إكمال', route: 'الزيارات ← تفاصيل الزيارة ← إنهاء', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'visit_task_reasons',
    label: 'أسباب إضافة مهمة للزيارة',
    description: 'الأسباب المُعتَمَدة عند إضافة مَهمة جَديدة لزيارة قائمة (خارج المَخطَّط الأصلي).',
    impact: 'low',
    usedIn: [
      { label: 'إضافة مهمة لزيارة قائمة', route: 'الزيارات ← تفاصيل الزيارة ← إضافة مهمة', icon: <ClipboardList className="w-3 h-3" /> },
    ],
  },
  {
    id: 'customer_followup_reasons',
    label: 'أسباب إعادة جَدوَلَة المهمة',
    description: 'الأسباب المعتمدة عند طَلب إعادة جَدوَلَة مَهَمَّة (الزبون غير مُتوفِّر، قطعة ناقصة، ...). تَنقُل المهمة لحالة "بحاجة مُتابعة" مع تاريخ مُتوقَّع جَديد.',
    impact: 'high',
    usedIn: [
      { label: 'مودال نتيجة الزيارة التسويقية — إعادة جَدوَلَة', route: 'الزيارات ← نتيجة المهمة', icon: <ClipboardList className="w-3 h-3" /> },
      { label: 'مودال نتيجة الصيانة الطارئة — إعادة جَدوَلَة', route: 'الزيارات ← مهمة صيانة', icon: <Wrench className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم الصيانة الطارئة
  // ══════════════════════════════════════════════════════════════
  {
    id: 'diagnosis_problem_types',
    label: 'أنواع الأعطال (التَشخيص)',
    description: 'القاموس المعتمد لأنواع الأعطال على الأَجهزة. يَستخدمه طلبات الصيانة عند إضافة الأعطال + الفني عند اكتشاف عَطل ميدانياً.',
    impact: 'high',
    usedIn: [
      { label: 'طلب صيانة جَديد — لائحة الأعطال', route: 'طلبات الصيانة ← تفاصيل الطلب', icon: <Bug className="w-3 h-3" /> },
      { label: 'مودال الصيانة الطارئة — اكتشاف ميداني', route: 'الزيارات ← مهمة صيانة', icon: <Bug className="w-3 h-3" /> },
    ],
  },
  {
    id: 'emergency_resolved_reason',
    label: 'أسباب الحَل (نَتيجة الصيانة)',
    description: 'أسباب تَوصيف الحَل في تَكاليف الصيانة الطارئة عند `final_decision = resolved`.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — مرحلة التكاليف', route: 'الزيارات ← مهمة صيانة ← المرحلة 4', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'emergency_unresolved_reason',
    label: 'أسباب عَدم الحَل (نَتيجة الصيانة)',
    description: 'أسباب تَوصيف عَدم الحَل في تَكاليف الصيانة الطارئة عند `final_decision = unresolved`.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — مرحلة التكاليف', route: 'الزيارات ← مهمة صيانة ← المرحلة 4', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'emergency_followup_reason',
    label: 'أسباب طَلب المُتابعة (نَتيجة الصيانة)',
    description: 'أسباب اختيار "بحاجة مُتابعة" كنَتيجة في تَكاليف الصيانة الطارئة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — مرحلة التكاليف', route: 'الزيارات ← مهمة صيانة ← المرحلة 4', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'emergency_cancelled_reason',
    label: 'أسباب الإلغاء (نَتيجة الصيانة)',
    description: 'أسباب اختيار "إلغاء" كنَتيجة في تَكاليف الصيانة الطارئة من شاشة المرحلة 4 (مُختلفة عن إلغاء الزيارة).',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — مرحلة التكاليف', route: 'الزيارات ← مهمة صيانة ← المرحلة 4', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'service_unresolved_reasons',
    label: 'أسباب عَدم الحَل (طلب الصيانة)',
    description: 'أسباب تَوضيح عَدم الحَل المُسَجَّلة على لائحة الأعطال داخل طلب الصيانة (قبل الترقية لمهمة).',
    impact: 'low',
    usedIn: [
      { label: 'طلب الصيانة ← لائحة الأعطال', route: 'طلبات الصيانة ← تفاصيل الطلب', icon: <Bug className="w-3 h-3" /> },
    ],
  },
  {
    id: 'service_partial_reasons',
    label: 'أسباب الحَل الجُزئي (طلب الصيانة)',
    description: 'أسباب تَوضيح الحَل الجُزئي على الأعطال داخل طلب الصيانة.',
    impact: 'low',
    usedIn: [
      { label: 'طلب الصيانة ← لائحة الأعطال', route: 'طلبات الصيانة ← تفاصيل الطلب', icon: <Bug className="w-3 h-3" /> },
    ],
  },
  {
    id: 'reopen_reasons',
    label: 'أسباب إعادة فَتح طلب الصيانة',
    description: 'الأسباب المعتمدة عند إعادة فَتح طلب صيانة مُغلَق. تُسَجَّل في سجل التَدقيق.',
    impact: 'medium',
    usedIn: [
      { label: 'طلب الصيانة ← إعادة فَتح', route: 'طلبات الصيانة ← تفاصيل الطلب ← إجراءات', icon: <RotateCcw className="w-3 h-3" /> },
    ],
  },
  {
    id: 'emergency_uniqueness_override_reasons',
    label: 'أسباب تَجاوز قَيد فَريد لمَهمة الطوارئ',
    description: 'الأسباب المعتمدة عند تَجاوز قَيد "مَهمة طوارئ نَشِطة واحدة لكل جهاز" (EM-UNIQ-01). يَتَطَلَّب صَلاحية audit-admin.',
    impact: 'high',
    usedIn: [
      { label: 'ترقية طلب صيانة لمَهمة طوارئ', route: 'طلبات الصيانة ← الترقية', icon: <ShieldCheck className="w-3 h-3" /> },
    ],
  },
  {
    id: 'part_no_retrieval_reason',
    label: 'أسباب عَدم استرجاع القطعة المُستَبدَلة',
    description: 'الأسباب المعتمدة عند استبدال قطعة بدون استرجاع القطعة القديمة من الزبون (تَلِفت كاملاً، رَفض الزبون، ...).',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — القطع المُستَبدَلة', route: 'الزيارات ← مهمة صيانة ← المرحلة 2', icon: <Package className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم العقود والبيع والمَدفوعات
  // ══════════════════════════════════════════════════════════════
  {
    id: 'contract_sale_source',
    label: 'مَصادر البيع (للعقود)',
    description: 'القَناة التي أَتى منها البيع (إحالة، مَعرض، حَملة...). يُسَجَّل على `contracts.sale_source` لتَحليل قَنوات البيع.',
    impact: 'medium',
    usedIn: [
      { label: 'نَموذج إنشاء/تَعديل عَقد', route: 'العقود ← نَموذج العَقد', icon: <Receipt className="w-3 h-3" /> },
    ],
  },
  {
    id: 'discount_reason',
    label: 'أسباب الحَسم',
    description: 'أسباب تَبرير حَسم نِسبة من تَكلفة الصيانة. تُسَجَّل في تَكاليف الصيانة الطارئة جَنباً مع نَسبة الحَسم.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — التكاليف', route: 'الزيارات ← مهمة صيانة ← المرحلة 4', icon: <Percent className="w-3 h-3" /> },
    ],
  },
  {
    id: 'transfer_company',
    label: 'شَركات التَحويل المالي',
    description: 'قائمة شَركات التَحويل المعتمدة (الهرم، الفؤاد، ويسترن...) المُختارة عند تَحصيل دَفعة بطريق "تَحويل". تَظهر في تَكاليف الصيانة وفي تَركيب الجهاز.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الصيانة — دَفعات', route: 'الزيارات ← مهمة صيانة', icon: <Truck className="w-3 h-3" /> },
      { label: 'مودال نتيجة التَركيب — دَفعات', route: 'الزيارات ← مهمة تَركيب', icon: <Truck className="w-3 h-3" /> },
    ],
  },
  {
    id: 'no_closing_reasons',
    label: 'أسباب عَدم إغلاق العَرض',
    description: 'الأسباب التي تَمنع إغلاق عَرض جهاز مَفتوح للزبون (الزبون مُتَردِّد، مَشغول، يَحتاج وَقت...).',
    impact: 'medium',
    usedIn: [
      { label: 'عَرض جهاز للزبون', route: 'الزبائن ← الأَجهزة المَعروضة', icon: <Tag className="w-3 h-3" /> },
      { label: 'عَرض مُسَتقِل من شاشة الزبون', route: 'الزبائن ← عَرض جهاز', icon: <Tag className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم التَركيب
  // ══════════════════════════════════════════════════════════════
  {
    id: 'installation_incomplete_reason',
    label: 'أسباب عَدم اكتمال التَركيب',
    description: 'الأسباب المعتمدة عند تَسجيل نَتيجة "تَركيب غير مُكتَمل" — يَتَطَلَّب زيارة لاحقة لإكمال التَركيب.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة التَركيب', route: 'الزيارات ← مهمة تَركيب', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'installation_refusal_reason',
    label: 'أسباب رَفض التَركيب',
    description: 'الأسباب التي يُقَدِّمها الزبون عند رَفضه تَركيب الجهاز ميدانياً. تُسَجَّل على نَتيجة المَهمة وتَنعكس على حالة الجهاز.',
    impact: 'high',
    usedIn: [
      { label: 'مودال نتيجة التَركيب', route: 'الزيارات ← مهمة تَركيب', icon: <Ban className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم التَواصل وإدارة جهات الاتصال
  // ══════════════════════════════════════════════════════════════
  {
    id: 'not_interested_reasons',
    label: 'أسباب عَدم اهتمام الزبون',
    description: 'الأسباب التَفصيلية لاختيار "غير مُهتَمّ" في مودال نتيجة التَواصل (سَعر، حاجة، ...). فَرعية من قائمة "أسباب رَفض الجَدولة".',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة التَواصل — غير مهتم', route: 'التيلماركتر ← تَسجيل نتيجة', icon: <Phone className="w-3 h-3" /> },
    ],
  },
  {
    id: 'cooldown_manual_reasons',
    label: 'أسباب تَجميد الزبون يَدوياً',
    description: 'الأسباب المعتمدة عند تَجميد جهة اتصال (cooldown) يَدوياً لفَترة مُحَدَّدة — يَمنع التَواصل مَعها مُؤقَّتاً.',
    impact: 'medium',
    usedIn: [
      { label: 'بَطاقة التَحَكُّم بالتَواصل', route: 'الزبائن ← تفاصيل الزبون ← Cooldown', icon: <Snowflake className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم مهام الأجهزة (التركيب / السحب / الإرجاع / التشغيل / الفك)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'device_retrieval_refusal_reasons',
    label: 'أسباب رَفض السحب',
    description: 'الأسباب المعتمدة عند اختيار "رفض السحب" في مودال نتيجة مهمة سحب الجهاز. تُحفظ مرجعياً على نتيجة المهمة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة السحب — رفض', route: 'الزيارات ← مهمة سحب', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_retrieval_reschedule_reasons',
    label: 'أسباب إعادة جَدوَلَة السحب',
    description: 'الأسباب المعتمدة عند اختيار "إعادة جدولة" في مودال نتيجة مهمة سحب الجهاز.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة السحب — إعادة جدولة', route: 'الزيارات ← مهمة سحب', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_return_refusal_reasons',
    label: 'أسباب رَفض الإرجاع',
    description: 'الأسباب المعتمدة عند اختيار "رفض الإرجاع" في مودال نتيجة مهمة إرجاع الجهاز بعد الصيانة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الإرجاع — رفض', route: 'الزيارات ← مهمة إرجاع', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_return_reschedule_reasons',
    label: 'أسباب إعادة جَدوَلَة الإرجاع',
    description: 'الأسباب المعتمدة عند اختيار "إعادة جدولة" في مودال نتيجة مهمة إرجاع الجهاز.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة الإرجاع — إعادة جدولة', route: 'الزيارات ← مهمة إرجاع', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_transfer_refusal_reasons',
    label: 'أسباب رَفض النقل',
    description: 'الأسباب المعتمدة عند اختيار "رفض النقل" في مودال نتيجة مهمة نقل الجهاز.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة النقل — رفض', route: 'الزيارات ← مهمة نقل', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_transfer_reschedule_reasons',
    label: 'أسباب إعادة جَدوَلَة النقل',
    description: 'الأسباب المعتمدة عند اختيار "إعادة جدولة" في مودال نتيجة مهمة نقل الجهاز.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة النقل — إعادة جدولة', route: 'الزيارات ← مهمة نقل', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_checkup_refusal_reasons',
    label: 'أسباب رفض التشييك',
    description: 'الأسباب المعتمدة عند اختيار "رفض التشييك" في مودال نتيجة مهمة تشييك الجهاز.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة التشييك — رفض', route: 'الزيارات → مهمة تشييك الجهاز', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_checkup_reschedule_reasons',
    label: 'أسباب إعادة جدولة التشييك',
    description: 'الأسباب المعتمدة عند اختيار "إعادة جدولة" في مودال نتيجة مهمة تشييك الجهاز.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة التشييك — إعادة جدولة', route: 'الزيارات → مهمة تشييك الجهاز', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_activation_followup_reasons',
    label: 'أسباب متابعة التشغيل',
    description: 'الأسباب المختصرة عند فشل التشغيل أو وجود مشكلة بالجهاز — تُختار في مودال نتيجة التشغيل وتنقل المهمة للمتابعة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة التشغيل — متابعة', route: 'الزيارات ← مهمة تشغيل', icon: <Wrench className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_disconnection_reasons',
    label: 'أسباب فَك الجهاز',
    description: 'سبب تنفيذ فك/فصل الجهاز (إلغاء عقد، إيقاف مؤقت، تحضير تبديل...). يُختار في مودال نتيجة الفك.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة الفك — سبب الفك', route: 'الزيارات ← مهمة فك', icon: <Package className="w-3 h-3" /> },
    ],
  },
  {
    id: 'device_disconnection_retrieval_reasons',
    label: 'أسباب السحب اللاحق للفك',
    description: 'سبب الحاجة لمهمة سحب مستقلة بعد الفك (صيانة في الورشة، تبديل، استرجاع نهائي...).',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة الفك — يحتاج سحباً', route: 'الزيارات ← مهمة فك', icon: <Truck className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم التَحصيل
  // ══════════════════════════════════════════════════════════════
  {
    id: 'collection_partial_payment_reasons',
    label: 'أسباب الدَفع الجُزئي (التَحصيل)',
    description: 'الأسباب المعتمدة عند تَسجيل دَفعة جُزئية في مهمة تَحصيل الأقساط — تُحفظ مرجعياً على نتيجة المهمة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة التَحصيل — دَفع جُزئي', route: 'الزيارات ← مهمة تَحصيل', icon: <DollarSign className="w-3 h-3" /> },
    ],
  },
  {
    id: 'collection_refusal_reasons',
    label: 'أسباب رَفض التَحصيل',
    description: 'الأسباب المعتمدة عند رَفض الزبون الدَفع في مهمة تَحصيل الأقساط.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة التَحصيل — رَفض', route: 'الزيارات ← مهمة تَحصيل', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'collection_reschedule_reasons',
    label: 'أسباب إعادة جَدوَلَة التَحصيل',
    description: 'الأسباب المعتمدة عند إعادة جَدوَلَة مهمة تَحصيل الأقساط لموعد لاحق.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة التَحصيل — إعادة جَدوَلَة', route: 'الزيارات ← مهمة تَحصيل', icon: <Clock className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم الهَدايا
  // ══════════════════════════════════════════════════════════════
  {
    id: 'gift_delivery_refusal_reasons',
    label: 'أسباب رَفض تَسليم الهَدية',
    description: 'الأسباب المعتمدة عند رَفض الزبون استلام الهدية في مهمة تسليم الهدايا.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة تسليم الهدية — رفض', route: 'الزيارات ← مهمة تسليم هدية', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'gift_delivery_reschedule_reasons',
    label: 'أسباب إعادة جَدوَلَة تَسليم الهَدية',
    description: 'الأسباب المعتمدة عند إعادة جَدوَلَة مهمة تسليم الهدية لموعد لاحق.',
    impact: 'low',
    usedIn: [
      { label: 'مودال نتيجة تسليم الهدية — إعادة جدولة', route: 'الزيارات ← مهمة تسليم هدية', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'gift_promise_conditions',
    label: 'شُروط وَعد الهَدية',
    description: 'الشروط المعتمدة التي يجب تحقّقها لاستحقاق الزبون هدية — تُستخدم عند ربط وعد هدية بعقد.',
    impact: 'medium',
    usedIn: [
      { label: 'ربط هدية بالعقد', route: 'الهدايا ← شروط الوعد', icon: <Tag className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // قوائم الضَمان الذَهبي (العَرض والبِطاقة)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'golden_offer_creation_reasons',
    label: 'أسباب إنشاء العَرض الذَهبي',
    description: 'الأسباب المعتمدة عند إنشاء مهمة عَرض ضَمان ذَهبي جَديدة للزبون.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال إنشاء عَرض ذَهبي', route: 'المهام ← إنشاء عرض ذهبي', icon: <ClipboardList className="w-3 h-3" /> },
    ],
  },
  {
    id: 'golden_offer_followup_reasons',
    label: 'أسباب مُتابعة العَرض الذَهبي',
    description: 'الأسباب المعتمدة عند تأجيل قرار الزبون بخصوص العَرض الذَهبي — تنقل المهمة للمُتابعة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة العَرض الذَهبي — مُتابعة', route: 'الزيارات ← مهمة عرض ذهبي', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'golden_offer_rejection_reasons',
    label: 'أسباب رَفض العَرض الذَهبي',
    description: 'الأسباب المعتمدة عند رَفض الزبون للعَرض الذَهبي نهائياً.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة العَرض الذَهبي — رَفض', route: 'الزيارات ← مهمة عرض ذهبي', icon: <Ban className="w-3 h-3" /> },
    ],
  },
  {
    id: 'golden_card_creation_reasons',
    label: 'أسباب إنشاء مهمة بِطاقة VIP',
    description: 'الأسباب المعتمدة عند إنشاء مهمة تَسليم بِطاقة VIP ذَهبية للزبون.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال إنشاء مهمة بِطاقة VIP', route: 'المهام ← إنشاء بطاقة VIP', icon: <ClipboardList className="w-3 h-3" /> },
    ],
  },
  {
    id: 'golden_card_followup_reasons',
    label: 'أسباب مُتابعة بِطاقة VIP',
    description: 'الأسباب المعتمدة عند تأجيل تَسليم بِطاقة VIP — تنقل المهمة للمُتابعة.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة بِطاقة VIP — مُتابعة', route: 'الزيارات ← مهمة بطاقة VIP', icon: <Clock className="w-3 h-3" /> },
    ],
  },
  {
    id: 'golden_card_rejection_reasons',
    label: 'أسباب رَفض بِطاقة VIP',
    description: 'الأسباب المعتمدة عند رَفض الزبون استلام بِطاقة VIP.',
    impact: 'medium',
    usedIn: [
      { label: 'مودال نتيجة بِطاقة VIP — رَفض', route: 'الزيارات ← مهمة بطاقة VIP', icon: <Ban className="w-3 h-3" /> },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // أخرى
  // ══════════════════════════════════════════════════════════════
  {
    id: 'open_task_reasons',
    label: 'أسباب فَتح مَهمة',
    description: 'الأسباب المعتمدة عند إنشاء مهمة مفتوحة يدوياً من شاشة الزبون (مثل عرض جهاز).',
    impact: 'medium',
    usedIn: [
      { label: 'عَرض جهاز للزبون', route: 'الزبائن ← عرض جهاز', icon: <Cpu className="w-3 h-3" /> },
    ],
  },
];

const MAJOR_PREFIX = 'major:';

// ─── Sidebar grouping (presentation only — no DB impact) ─────────────────────
interface ListGroup { id: string; label: string; }

const LIST_GROUPS: ListGroup[] = [
  { id: 'hr',            label: 'التوظيف والموظفون' },
  { id: 'telemarketing', label: 'التيلماركتر والتواصل' },
  { id: 'visits',        label: 'الزيارات والاستطلاع' },
  { id: 'emergency',     label: 'الصيانة الطارئة' },
  { id: 'contracts',     label: 'العقود والبيع' },
  { id: 'device_tasks',  label: 'مهام الأجهزة (تسليم/تركيب/تشغيل/سحب/فك)' },
  { id: 'collection',    label: 'التَحصيل' },
  { id: 'gifts',         label: 'الهَدايا' },
  { id: 'golden',        label: 'الضَمان الذَهبي (العَرض والبِطاقة)' },
  { id: 'custom',        label: 'فئات مخصّصة' },
];

// Maps each known category to its sidebar group. Unmapped (admin-created)
// categories fall back to the "custom" group via groupOf().
const CATEGORY_GROUP: Record<string, string> = {
  occupation: 'hr', job_title: 'hr', certificate: 'hr', work_type: 'hr',
  nationality: 'hr', marital_status: 'hr', gender: 'hr', driving_license: 'hr',
  application_source: 'hr', department_type: 'hr', military_service: 'hr',
  contract_type: 'hr', foreign_language: 'hr',

  telemarketing_rejection_reason: 'telemarketing', telemarketing_reschedule_reason: 'telemarketing',
  not_interested_reasons: 'telemarketing', cooldown_manual_reasons: 'telemarketing',

  area_evaluation_options: 'visits', survey_skip_reasons: 'visits',
  location_missing_reasons: 'visits', visit_cancellation_reasons: 'visits',
  visit_not_completed_reasons: 'visits', visit_task_reasons: 'visits',
  customer_followup_reasons: 'visits',

  diagnosis_problem_types: 'emergency', emergency_resolved_reason: 'emergency',
  emergency_unresolved_reason: 'emergency', emergency_followup_reason: 'emergency',
  emergency_cancelled_reason: 'emergency', service_unresolved_reasons: 'emergency',
  service_partial_reasons: 'emergency', reopen_reasons: 'emergency',
  emergency_uniqueness_override_reasons: 'emergency', part_no_retrieval_reason: 'emergency',

  contract_sale_source: 'contracts', discount_reason: 'contracts',
  transfer_company: 'contracts', no_closing_reasons: 'contracts',

  installation_incomplete_reason: 'device_tasks', installation_refusal_reason: 'device_tasks',
  device_retrieval_refusal_reasons: 'device_tasks', device_retrieval_reschedule_reasons: 'device_tasks',
  device_return_refusal_reasons: 'device_tasks', device_return_reschedule_reasons: 'device_tasks',
  device_transfer_refusal_reasons: 'device_tasks', device_transfer_reschedule_reasons: 'device_tasks',
  device_checkup_refusal_reasons: 'device_tasks', device_checkup_reschedule_reasons: 'device_tasks',
  device_activation_followup_reasons: 'device_tasks', device_disconnection_reasons: 'device_tasks',
  device_disconnection_retrieval_reasons: 'device_tasks',

  collection_partial_payment_reasons: 'collection',
  collection_refusal_reasons: 'collection',
  collection_reschedule_reasons: 'collection',

  gift_delivery_refusal_reasons: 'gifts',
  gift_delivery_reschedule_reasons: 'gifts',
  gift_promise_conditions: 'gifts',

  golden_offer_creation_reasons: 'golden',
  golden_offer_followup_reasons: 'golden',
  golden_offer_rejection_reasons: 'golden',
  golden_card_creation_reasons: 'golden',
  golden_card_followup_reasons: 'golden',
  golden_card_rejection_reasons: 'golden',

  open_task_reasons: 'contracts',
};

const groupOf = (catId: string) => CATEGORY_GROUP[catId] ?? 'custom';

const IMPACT_CONFIG = {
  high: { label: 'تأثير عالٍ', cls: 'bg-rose-50 text-rose-600 border-rose-200', dot: 'bg-rose-500' },
  medium: { label: 'تأثير متوسط', cls: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  low: { label: 'تأثير بسيط', cls: 'bg-sky-50 text-sky-600 border-sky-200', dot: 'bg-sky-400' },
};

export default function SystemLists() {
  const { user, hasPermission } = useAuthStore();
  const { lists, loading, fetchLists, createList, updateList, deleteList } = useSystemListsStore();
  const { roles, fetchRoles } = useRoleStore();
  const canManageSystemLists = user?.isSuperAdmin === true || hasPermission('admin.system_lists.manage');

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
  const [formLinkedRoleId, setFormLinkedRoleId] = useState<number | null>(null);
  const [formCanSelectDevice, setFormCanSelectDevice] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);
  const [newCatId, setNewCatId] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [activeCertificate, setActiveCertificate] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set([groupOf(CATEGORIES[0].id)]));

  useEffect(() => { fetchLists(); fetchRoles(); }, []);
  useEffect(() => {
    setSearch('');
    setActiveCertificate(null);
    // Ensure the group holding the active category is expanded.
    setOpenGroups(prev => new Set(prev).add(groupOf(activeCategory)));
  }, [activeCategory]);

  if (!user || (!user.isSuperAdmin && !hasPermission('admin.system_lists.view'))) return <Navigate to="/" replace />;

  const activeMeta = sidebarCategories.find(c => c.id === activeCategory);
  const isCertificateView = activeCategory === 'certificate';

  const filteredItems = useMemo(() => {
    const cat = (isCertificateView && activeCertificate)
      ? `${MAJOR_PREFIX}${activeCertificate}` : activeCategory;
    return lists
      .filter(l => l.category === cat)
      .filter(l => search === '' || l.value.includes(search) || ((l.metadata as any)?.label ?? '').includes(search))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
  }, [lists, activeCategory, activeCertificate, isCertificateView, search]);

  const certificateItems = useMemo(() =>
    lists.filter(l => l.category === 'certificate').sort((a, b) => a.displayOrder - b.displayOrder),
    [lists]);

  const openForm = (item?: SystemList) => {
    if (item) {
      setEditingItem(item);
      setFormValue(item.value);
      setFormOrder(item.displayOrder);
      setFormLinkedRoleId(item.linkedRoleId ?? null);
      setFormCanSelectDevice(!!(item.metadata as any)?.canSelectDevice);
    } else {
      setEditingItem(null);
      setFormValue('');
      setFormOrder(filteredItems.length + 1);
      setFormLinkedRoleId(null);
      setFormCanSelectDevice(false);
    }
    setIsItemModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSystemLists) return;
    try {
      const saveCategory = (isCertificateView && activeCertificate)
        ? `${MAJOR_PREFIX}${activeCertificate}` : activeCategory;
      const isJobTitle = saveCategory === 'job_title';
      const isDeptType = saveCategory === 'department_type';

      const extraFields: Record<string, unknown> = {};
      if (isJobTitle) extraFields.linkedRoleId = formLinkedRoleId;
      if (isDeptType) extraFields.metadata = { canSelectDevice: formCanSelectDevice };

      if (editingItem) {
        await updateList(editingItem.id, {
          value: formValue,
          displayOrder: formOrder,
          ...extraFields,
        });
      } else {
        await createList({
          category: saveCategory,
          value: formValue,
          displayOrder: formOrder,
          isActive: true,
          ...extraFields,
        });
      }
      setIsItemModalOpen(false);
    } catch (err: any) { alert(err.message || 'حدث خطأ أثناء الحفظ'); }
  };

  const toggleActive = async (item: SystemList) => {
    if (!canManageSystemLists) return;
    try { await updateList(item.id, { isActive: !item.isActive }); }
    catch (err: any) { alert(err.message || 'حدث خطأ'); }
  };

  const handleDelete = async (id: number) => {
    if (!canManageSystemLists) return;
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

  // Expand / collapse all groups — convenience for scanning every list at once.
  const populatedGroupIds = LIST_GROUPS
    .filter(g => sidebarCategories.some(c => groupOf(c.id) === g.id))
    .map(g => g.id);
  const allGroupsOpen = populatedGroupIds.length > 0 && populatedGroupIds.every(id => openGroups.has(id));
  const toggleAllGroups = () => setOpenGroups(allGroupsOpen ? new Set() : new Set(populatedGroupIds));

  return (
    <div className="p-6 max-w-[100rem] mx-auto h-[calc(100vh-4rem)] flex flex-col" dir="rtl">
      {/* Header */}
      <PageHeader
        className="mb-6 flex-shrink-0"
        title="إدارة القوائم والفهارس"
        subtitle="تحكم ديناميكي بجميع القوائم المنسدلة — كل تغيير ينعكس فوراً على النظام"
        icon={<Settings2 className="w-7 h-7 text-sky-500" />}
      />

      <div className="flex gap-5 flex-1 min-h-0">
        {/* ── Sidebar ── */}
        <Card padding="none" className="w-96 overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50 sticky top-0 z-10 flex items-center justify-between gap-2">
            <h3 className="font-bold text-slate-600 text-sm uppercase tracking-wider">الفئات</h3>
            <button
              onClick={toggleAllGroups}
              className="text-[11px] font-bold px-2 py-1 rounded-md text-slate-500 hover:bg-slate-100 transition-colors flex-shrink-0"
            >
              {allGroupsOpen ? 'طي الكل' : 'توسيع الكل'}
            </button>
          </div>
          <div className="p-2 space-y-1">
            {LIST_GROUPS.map(grp => {
              const cats = sidebarCategories.filter(c => groupOf(c.id) === grp.id);
              if (cats.length === 0) return null;
              const isOpen = openGroups.has(grp.id);
              const groupCount = cats.reduce((sum, c) => sum + lists.filter(l => l.category === c.id).length, 0);
              const toggleGroup = () => setOpenGroups(prev => {
                const next = new Set(prev);
                if (next.has(grp.id)) next.delete(grp.id); else next.add(grp.id);
                return next;
              });
              return (
                <div key={grp.id}>
                  <button
                    onClick={toggleGroup}
                    title={grp.label}
                    className="w-full text-right px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <motion.span animate={{ rotate: isOpen ? 0 : -90 }} transition={{ duration: 0.15 }} className="flex">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </motion.span>
                      <span className="truncate">{grp.label}</span>
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-mono flex-shrink-0">{groupCount}</span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden space-y-0.5 mt-0.5"
                      >
                        {cats.map(cat => {
                          const count = lists.filter(l => l.category === cat.id).length;
                          const isActive = activeCategory === cat.id;
                          const cfg = IMPACT_CONFIG[cat.impact];
                          return (
                            <button
                              key={cat.id}
                              onClick={() => { setActiveCategory(cat.id); setActiveCertificate(null); }}
                              title={cat.label}
                              className={`w-full text-right pr-4 pl-3 py-2 rounded-xl text-sm transition-all flex items-center justify-between gap-2 group ${isActive
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Card>

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
                      <h3 className="font-bold text-base">{activeMeta.label}</h3>
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
                          <span className="opacity-60 text-xs before:content-['—'] before:mr-1">{loc.route}</span>
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
              <Button variant="ghost" size="sm" onClick={() => setActiveCertificate(null)} className="text-violet-500 hover:text-violet-700 hover:bg-violet-100">
                الشهادات العلمية
              </Button>
              <ChevronLeft className="w-4 h-4 text-violet-300" />
              <span className="text-sm font-bold text-violet-800">{activeCertificate}</span>
              <span className="text-xs text-violet-500 bg-violet-100 px-2.5 py-1 rounded-full mr-auto">
                هذه الاختصاصات تظهر فقط عند اختيار شهادة "{activeCertificate}" في فورم الشاغر
              </span>
            </div>
          )}

          {/* ── List card ── */}
          <Card padding="none" className="flex-1 flex flex-col overflow-hidden">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-slate-800">{panelTitle()}</h3>
              <div className="flex items-center gap-3">
                <Input
                  type="text"
                  placeholder="بحث..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  leading={<Search className="w-4 h-4" />}
                  fullWidth={false}
                  className="w-48"
                />
                {canManageSystemLists && (!isCertificateView || activeCertificate) && (
                  <Button onClick={() => openForm()} icon={Plus}>
                    {isCertificateView && activeCertificate ? 'إضافة اختصاص' : 'إضافة خيار'}
                  </Button>
                )}
                {canManageSystemLists && isCertificateView && !activeCertificate && (
                  <Button onClick={() => openForm()} icon={Plus}>إضافة شهادة</Button>
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
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setActiveCertificate(cert.value)}
                                disabled={!cert.isActive}
                                icon={BookOpen}
                                className="text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-100"
                              >
                                الاختصاصات
                              </Button>
                              <Toggle checked={cert.isActive} onCheckedChange={() => toggleActive(cert)} disabled={!canManageSystemLists} size="sm" label={cert.isActive ? 'تعطيل' : 'تفعيل'} />
                              <button onClick={() => openForm(cert)} disabled={!canManageSystemLists} className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg disabled:opacity-50"><Edit className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(cert.id)} disabled={!canManageSystemLists} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
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
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold font-mono shrink-0">
                          {item.displayOrder}
                        </div>
                        <div className="min-w-0">
                          <span className={`font-semibold ${item.isActive ? 'text-slate-800' : 'text-slate-500 line-through'}`}>{(item.metadata as any)?.label || item.value}</span>
                          {!item.isActive && <span className="text-xs text-red-500 mr-2 bg-red-50 px-2 py-0.5 rounded-full">معطل</span>}
                          {activeCategory === 'job_title' && (
                            <div className="mt-1">
                              {item.linkedRoleName ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                                  <ShieldCheck className="w-3 h-3" />
                                  {item.linkedRoleName}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                                  لم يُربط بدور بعد
                                </span>
                              )}
                            </div>
                          )}
                          {activeCategory === 'department_type' && (
                            <div className="mt-1">
                              {(item.metadata as any)?.canSelectDevice ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                                  <Cpu className="w-3 h-3" />
                                  تخصيص جهاز مفعّل
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-50 text-slate-400 border border-slate-200">
                                  <Cpu className="w-3 h-3" />
                                  بدون أجهزة
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Toggle checked={item.isActive} onCheckedChange={() => toggleActive(item)} disabled={!canManageSystemLists} size="sm" label={item.isActive ? 'تعطيل' : 'تفعيل'} />
                        <button onClick={() => openForm(item)} disabled={!canManageSystemLists} className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 rounded-lg disabled:opacity-50"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(item.id)} disabled={!canManageSystemLists} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Item Modal ── */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <Tag className="w-5 h-5 text-sky-500" />
                {editingItem ? 'تعديل خيار' : `إضافة — ${panelTitle()}`}
              </h3>
              <IconButton icon={X} label="إغلاق" onClick={() => setIsItemModalOpen(false)} />
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
              <Input
                label={isCertificateView && activeCertificate ? 'اسم الاختصاص' : 'القيمة / الاسم'}
                required
                autoFocus
                value={formValue}
                onChange={e => setFormValue(e.target.value)}
                placeholder={isCertificateView && activeCertificate ? 'مثال: هندسة حاسبات' : 'أدخل القيمة...'}
              />
              <Input
                label="ترتيب الظهور"
                type="number"
                required
                min="0"
                value={formOrder}
                onChange={e => setFormOrder(parseInt(e.target.value))}
                helper="الأرقام الأصغر تظهر أولاً في القائمة"
              />

              {/* Role selector — only for job_title category */}
              {activeCategory === 'job_title' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-violet-500" />
                    الدور المرتبط
                  </label>
                  <Select
                    value={formLinkedRoleId == null ? '' : String(formLinkedRoleId)}
                    onChange={v => setFormLinkedRoleId(v ? parseInt(v) : null)}
                    placeholder="— بدون ربط بدور —"
                    ariaLabel="الدور المرتبط"
                    className="w-full"
                    options={roles.filter(r => r.isActive).map(r => ({ value: String(r.id), label: r.displayName }))}
                  />
                  <p className="text-xs text-slate-400">
                    اختر الدور الذي يُسند تلقائياً للموظف عند اختيار هذا المسمى الوظيفي
                  </p>
                </div>
              )}

              {/* canSelectDevice toggle — only for department_type category */}
              {activeCategory === 'department_type' && (
                <div className="border border-indigo-100 bg-indigo-50/50 rounded-xl p-4 space-y-2">
                  <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-indigo-500" />
                    سماحية تخصيص جهاز
                  </label>
                  <div className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-slate-200 bg-white">
                    <Toggle checked={formCanSelectDevice} onCheckedChange={setFormCanSelectDevice} label="سماحية تخصيص جهاز" />
                    <span className="text-sm font-medium text-slate-600">
                      {formCanSelectDevice
                        ? 'مفعّل — سيظهر حقل الأجهزة عند إنشاء قسم من هذا النوع'
                        : 'معطّل — لا يمكن تخصيص أجهزة لهذا النوع'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    عند التفعيل، يظهر لمنشئ القسم حقل لاختيار أجهزة من كتالوج الأجهزة.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setIsItemModalOpen(false)}>إلغاء</Button>
                <Button type="submit" icon={Save}>حفظ</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New Category Modal ── */}
      {isNewCatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-indigo-500" /> إضافة فئة جديدة
              </h3>
              <IconButton icon={X} label="إغلاق" onClick={() => setIsNewCatOpen(false)} />
            </div>
            <form onSubmit={handleAddNewCategory} className="p-6 space-y-5">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700">
                بعد الإنشاء، انتقل للفئة الجديدة وأضف خياراتها من الصفحة الرئيسية.
              </div>
              <Input
                label="الاسم العربي (للعرض)"
                required
                autoFocus
                value={newCatLabel}
                onChange={e => setNewCatLabel(e.target.value)}
                placeholder="مثال: المناطق الجغرافية"
              />
              <Input
                label="المعرف الإنجليزي"
                required
                value={newCatId}
                onChange={e => setNewCatId(e.target.value.replace(/\s+/g, '_').toLowerCase())}
                placeholder="مثال: regions"
                className="font-mono"
                helper="يُستخدم داخلياً — بالأحرف الإنجليزية فقط بدون مسافات"
              />
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setIsNewCatOpen(false)}>إلغاء</Button>
                <Button type="submit" icon={FolderPlus}>إنشاء</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
