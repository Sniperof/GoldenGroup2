import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CandidateDetail as CandidateDetailDto } from '../../lib/types';
import { api } from '../../lib/api';
import { usePermissions } from '../../hooks/usePermissions';
import type { GiftRecordPrototype } from '../../data/giftsPrototype';
import {
    giftConditionClasses,
    giftConditionStatusLabels,
    giftStatusClasses,
    giftStatusLabels,
} from '../../data/giftsPrototype';
import {
    AlertCircle,
    ArrowLeft,
    Briefcase,
    Building2,
    CheckCircle2,
    FileText,
    Gift,
    MapPin,
    Phone,
    ShieldCheck,
    User,
    Users,
} from '../../components/ui/icons';

const EMPTY = 'غير محدد';

const STATUS_META: Record<string, { label: string; className: string }> = {
    New: { label: 'جديد', className: 'bg-slate-50 text-slate-700 border-slate-200' },
    Suggested: { label: 'مقترح', className: 'bg-sky-50 text-sky-700 border-sky-200' },
    Contacted: { label: 'تم الاتصال', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    FollowUp: { label: 'قيد المتابعة', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    Qualified: { label: 'مؤهل', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    Junk: { label: 'مرفوض', className: 'bg-red-50 text-red-700 border-red-200' },
};

const REFERRAL_TYPE_LABELS: Record<string, string> = {
    Client: 'زبون',
    Employee: 'موظف',
    Personal: 'شخصي',
    Unknown: 'مجهول',
};

const CHANNEL_LABELS: Record<string, string> = {
    Acquaintance: 'معرفة شخصية',
    PhoneCall: 'مكالمة هاتفية',
    SocialMedia: 'وسائل التواصل الاجتماعي',
    Campaign: 'حملة إعلانية',
    App: 'التطبيق',
};

const CONTACT_TYPE_LABELS: Record<string, string> = {
    mobile: 'موبايل',
    landline: 'هاتف أرضي',
    other: 'رقم آخر',
};

const CONTACT_STATUS_LABELS: Record<string, string> = {
    active: 'فعال',
    preferred: 'مفضل',
    'out-of-coverage': 'خارج التغطية',
    unused: 'غير مستخدم',
    invalid: 'غير صالح',
};

function formatDate(value?: string | null): string {
    if (!value) return EMPTY;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GB');
}

function candidateName(candidate: CandidateDetailDto): string {
    const full = [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim();
    if (full) return candidate.nickname ? `${full} (${candidate.nickname})` : full;
    return candidate.nickname || candidate.lastName || 'اسم غير مكتمل';
}

function Card({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Icon className="h-4 w-4" />
                </span>
                <h2 className="font-black text-slate-800">{title}</h2>
            </div>
            {children}
        </section>
    );
}

function Field({ label, value }: { label: string; value?: ReactNode }) {
    return (
        <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs font-bold text-slate-400">{label}</p>
            <div className="mt-1 break-words text-sm font-bold leading-6 text-slate-800">{value || EMPTY}</div>
        </div>
    );
}

function Pill({ children, className }: { children: ReactNode; className: string }) {
    return (
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${className}`}>
            {children}
        </span>
    );
}

export default function CandidateDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { hasPermission } = usePermissions();
    const candidateId = Number(id);
    const [candidate, setCandidate] = useState<CandidateDetailDto | null>(null);
    const [giftPromises, setGiftPromises] = useState<GiftRecordPrototype[]>([]);
    const [giftPromisesLoading, setGiftPromisesLoading] = useState(false);
    const [giftPromisesError, setGiftPromisesError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const canViewGiftPromises = hasPermission('contract_gifts.view');

    useEffect(() => {
        let active = true;
        if (!Number.isInteger(candidateId) || candidateId <= 0) {
            setError('معرّف الاسم المقترح غير صالح');
            setLoading(false);
            return () => { active = false; };
        }
        setLoading(true);
        setError(null);
        api.candidates.get(candidateId)
            .then((result) => {
                if (active) setCandidate(result);
            })
            .catch((err: any) => {
                if (active) setError(err?.message || 'تعذر تحميل تفاصيل الاسم المقترح');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [candidateId]);

    useEffect(() => {
        let active = true;
        if (
            !canViewGiftPromises
            || !candidate
            || candidate.id !== candidateId
            || !Number.isInteger(candidateId)
            || candidateId <= 0
        ) {
            setGiftPromises([]);
            setGiftPromisesError(null);
            setGiftPromisesLoading(false);
            return () => { active = false; };
        }

        setGiftPromisesLoading(true);
        setGiftPromisesError(null);
        api.gifts.records.list({ candidateId })
            .then((records) => {
                if (active) setGiftPromises(records);
            })
            .catch((err: any) => {
                if (active) setGiftPromisesError(err?.message || 'تعذر تحميل وعود الهدايا');
            })
            .finally(() => {
                if (active) setGiftPromisesLoading(false);
            });

        return () => { active = false; };
    }, [candidate, candidateId, canViewGiftPromises]);

    const geoPath = useMemo(
        () => candidate?.address.geoPath.map((unit) => unit.name).join(' ← ') || EMPTY,
        [candidate],
    );

    if (loading) {
        return (
            <div className="flex min-h-[55vh] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
            </div>
        );
    }

    if (error || !candidate) {
        return (
            <div className="mx-auto max-w-3xl py-12">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
                    <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
                    <p className="font-bold text-red-800">{error || 'الاسم المقترح غير موجود'}</p>
                    <button onClick={() => navigate('/candidates')} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-bold text-red-700 shadow-sm">
                        العودة إلى الأسماء المقترحة
                    </button>
                </div>
            </div>
        );
    }

    const status = STATUS_META[candidate.status] || {
        label: candidate.status,
        className: 'bg-slate-50 text-slate-700 border-slate-200',
    };

    return (
        <div className="mx-auto max-w-7xl space-y-5 pb-10">
            <button onClick={() => navigate('/candidates')} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-sky-700">
                <ArrowLeft className="h-4 w-4 rotate-180" />
                العودة إلى الأسماء المقترحة
            </button>

            <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                            <User className="h-7 w-7" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="break-words text-2xl font-black text-slate-900">{candidateName(candidate)}</h1>
                                <span className={`rounded-full border px-3 py-1 text-xs font-black ${status.className}`}>{status.label}</span>
                                {candidate.conversion ? (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                                        مرتبط بزبون
                                    </span>
                                ) : null}
                            </div>
                            <p className="mt-2 text-sm font-bold text-slate-400">الاسم المقترح #{candidate.id}</p>
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                        <Field label="الفرع" value={candidate.branch.name} />
                        <Field label="المسؤول" value={candidate.ownership.label} />
                        <Field label="تاريخ الإضافة" value={formatDate(candidate.createdAt)} />
                    </div>
                </div>
            </header>

            {candidate.duplicate.flagged ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        <div>
                            <h2 className="font-black text-amber-900">تنبيه تكرار</h2>
                            {candidate.duplicate.match?.visible && candidate.duplicate.match.id ? (
                                <p className="mt-1 text-sm font-bold text-amber-800">
                                    يوجد تطابق مع{' '}
                                    {candidate.duplicate.match.entityType === 'Client' ? (
                                        <Link className="underline" to={`/clients/${candidate.duplicate.match.id}`}>{candidate.duplicate.match.name}</Link>
                                    ) : (
                                        <Link className="underline" to={`/candidates/${candidate.duplicate.match.id}`}>{candidate.duplicate.match.name}</Link>
                                    )}
                                </p>
                            ) : (
                                <p className="mt-1 text-sm font-bold text-amber-800">
                                    {candidate.duplicate.match?.message || 'يوجد سجل مطابق يحتاج إلى مراجعة'}
                                </p>
                            )}
                        </div>
                    </div>
                </section>
            ) : null}

            {candidate.conversion ? (
                <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-start gap-3">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                        <div>
                            <h2 className="font-black text-emerald-900">نتيجة التأهيل</h2>
                            {candidate.conversion.visible && candidate.conversion.client ? (
                                <p className="mt-1 text-sm font-bold text-emerald-800">
                                    مرتبط بالزبون{' '}
                                    <Link className="underline" to={`/clients/${candidate.conversion.client.id}`}>
                                        {candidate.conversion.client.name}
                                    </Link>
                                </p>
                            ) : (
                                <p className="mt-1 text-sm font-bold text-emerald-800">{candidate.conversion.message}</p>
                            )}
                        </div>
                    </div>
                </section>
            ) : null}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card title="أرقام الهاتف" icon={Phone}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {candidate.phoneNumbers.length > 0 ? candidate.phoneNumbers.map((phone, index) => (
                            <div key={`${phone.number}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs font-bold text-slate-400">
                                        {phone.isPrimary ? 'الرقم الأساسي' : 'رقم إضافي'}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                        {phone.type ? (
                                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                                                {CONTACT_TYPE_LABELS[phone.type] || phone.type}
                                            </span>
                                        ) : null}
                                        {phone.status ? (
                                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                                                {CONTACT_STATUS_LABELS[phone.status] || phone.status}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <p dir="ltr" className="mt-2 text-left text-base font-black text-slate-900">{phone.number}</p>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
                                    <span>لمن الرقم: <strong className="text-slate-700">{phone.label || 'غير محدد'}</strong></span>
                                    <span className={phone.hasWhatsApp === true ? 'text-emerald-700' : undefined}>
                                        {phone.hasWhatsApp === true
                                            ? 'يدعم واتساب'
                                            : phone.hasWhatsApp === false
                                                ? 'لا يدعم واتساب'
                                                : 'دعم واتساب غير محدد'}
                                    </span>
                                </div>
                            </div>
                        )) : <Field label="رقم الهاتف" value="غير مدخل" />}
                    </div>
                </Card>

                <Card title="العنوان" icon={MapPin}>
                    <div className="grid gap-3">
                        <Field
                            label="الموقع الجغرافي"
                            value={
                                <span>
                                    {geoPath}
                                    {candidate.address.geoPath.some((unit) => !unit.active) ? (
                                        <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">وحدة معطلة</span>
                                    ) : null}
                                </span>
                            }
                        />
                        <Field label="العنوان التفصيلي" value={candidate.address.text || 'غير مدخل'} />
                    </div>
                </Card>

                <Card title="الملكية والفرع" icon={Building2}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="نوع الملكية" value={candidate.ownership.type === 'PERSONAL' ? 'ملكية شخصية' : 'ملكية الفرع'} />
                        <Field label="المسؤول الحالي" value={candidate.ownership.responsibleUserName || candidate.ownership.label} />
                        <Field label="الدور" value={candidate.ownership.roleDisplayName} />
                        <Field label="الفرع" value={candidate.branch.name} />
                    </div>
                </Card>

                <Card title="معلومات الترشيح" icon={Users}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="طريقة الإدخال" value={candidate.referral.entryMode === 'NAME_LIST' ? 'من لائحة أسماء' : 'إدخال مباشر'} />
                        <Field label="نوع الوسيط" value={candidate.referral.type ? REFERRAL_TYPE_LABELS[candidate.referral.type] || candidate.referral.type : EMPTY} />
                        <Field label="اسم الوسيط وقت الترشيح" value={candidate.referral.nameSnapshot} />
                        <Field label="قناة الوصول" value={candidate.referral.originChannel ? CHANNEL_LABELS[candidate.referral.originChannel] || candidate.referral.originChannel : EMPTY} />
                        <Field label="تاريخ الترشيح" value={formatDate(candidate.referral.date)} />
                        <div className="sm:col-span-2"><Field label="سبب الترشيح" value={candidate.referral.reason} /></div>
                        <div className="sm:col-span-2"><Field label="ملاحظات الوسيط" value={candidate.candidateNotes || 'لا توجد ملاحظات للوسيط'} /></div>
                    </div>
                </Card>

                <Card title="المعلومات التشغيلية" icon={Briefcase}>
                    <div className="grid gap-3">
                        <Field
                            label="المهنة"
                            value={
                                <span>
                                    {candidate.occupation.value || EMPTY}
                                    {candidate.occupation.value && candidate.occupation.active === false ? (
                                        <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">قيمة غير فعالة</span>
                                    ) : null}
                                </span>
                            }
                        />
                    </div>
                </Card>
            </div>

            {candidate.sourceSheet ? (
                <Card title="لائحة المصدر" icon={FileText}>
                    {!candidate.sourceSheet.visible ? (
                        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
                            <ShieldCheck className="h-4 w-4" />
                            {candidate.sourceSheet.message}
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <Field label="رقم اللائحة" value={`#${candidate.sourceSheet.id}`} />
                            <Field label="الحالة" value={candidate.sourceSheet.status} />
                            <Field label="التاريخ" value={formatDate(candidate.sourceSheet.referralDate)} />
                            <Field label="الفرع" value={candidate.sourceSheet.branchName} />
                            <Field label="المصدر" value={candidate.sourceSheet.origin === 'FIELD_VISIT' ? 'زيارة ميدانية' : 'يدوي'} />
                            <Field label="جامع الأسماء" value={candidate.sourceSheet.ownerUserName} />
                            <Field label="مسؤول المراجعة" value={candidate.sourceSheet.assignedHrUserName} />
                            <Field label="مسؤول فريق الزيارة" value={candidate.sourceSheet.teamResponsibleUserName} />
                            <Field label="منشئ السجل" value={candidate.sourceSheet.createdByUserName} />
                            <Field label="الأسماء الفعلية / المستهدفة" value={`${candidate.sourceSheet.actualCandidates ?? 0} / ${candidate.sourceSheet.targetCandidates ?? 0}`} />
                            <Field label="مؤشر الجودة" value={`${candidate.sourceSheet.qualityPercentage ?? 0}%`} />
                            <Field label="مؤشر التحويل" value={`${candidate.sourceSheet.conversionPercentage ?? 0}%`} />
                            <div className="sm:col-span-2 lg:col-span-4"><Field label="ملاحظات اللائحة" value={candidate.sourceSheet.notes} /></div>
                        </div>
                    )}
                </Card>
            ) : null}

            {canViewGiftPromises ? (
                <Card title="وعود الهدايا" icon={Gift}>
                    {giftPromisesLoading ? (
                        <div className="flex min-h-28 items-center justify-center">
                            <div className="h-7 w-7 animate-spin rounded-full border-4 border-sky-100 border-t-sky-600" />
                        </div>
                    ) : giftPromisesError ? (
                        <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            {giftPromisesError}
                        </div>
                    ) : giftPromises.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">
                            لا توجد وعود هدايا مسجلة لهذا الاسم أو لائحته.
                        </div>
                    ) : (
                        <div className="grid gap-3 lg:grid-cols-2">
                            {giftPromises.map((record) => (
                                <article key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <p className="text-base font-black text-slate-900">{record.giftName}</p>
                                            <p className="mt-1 text-xs font-bold text-slate-500">
                                                الوعد: {record.promisedQuantity} {record.unitLabel}
                                                {record.approvedQuantity != null
                                                    ? ` · المعتمد: ${record.approvedQuantity} ${record.unitLabel}`
                                                    : ''}
                                            </p>
                                        </div>
                                        <Pill className={giftStatusClasses[record.status]}>{giftStatusLabels[record.status]}</Pill>
                                    </div>
                                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                        <Field label="المستفيد" value={record.beneficiaryName} />
                                        <Field label="تاريخ الوعد" value={formatDate(record.createdAt)} />
                                        <Field label="الشرط" value={record.conditionLabel} />
                                        <Field
                                            label="حالة الشرط"
                                            value={(
                                                <Pill className={giftConditionClasses[record.conditionStatus]}>
                                                    {giftConditionStatusLabels[record.conditionStatus]}
                                                </Pill>
                                            )}
                                        />
                                    </div>
                                    {record.sources.length > 0 ? (
                                        <div className="mt-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                                            <p className="text-xs font-bold text-slate-400">مصدر الوعد</p>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {record.sources.map((source) => (
                                                    <span key={source.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                                                        {source.label}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}
                </Card>
            ) : null}
        </div>
    );
}
