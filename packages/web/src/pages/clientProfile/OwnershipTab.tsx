// «الملكية» tab of the client profile (migration 481).
//
// Ownership is its own operation, separate from editing the client: the
// current owners, the manual operations (add / remove / transfer / release to
// the branch) — each with a mandatory reason — and the append-only history
// that the database trigger writes for every change, whatever path made it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowLeftRight,
    Building2,
    History,
    Loader2,
    UserMinus,
    UserPlus,
    Users,
} from '../../components/ui/icons';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import {
    api,
    type ClientOwnershipLogEntry,
    type ClientOwnershipOperation,
    type ClientOwnershipOwner,
    type ClientOwnershipView,
} from '../../lib/api';

interface Props {
    client: { id: number };
}

type AssignableUser = { id: number; name: string; branchId: number | null; roleName: string | null };
type ReasonOption = { id: number; value: string; label: string };

type Dialog =
    | { kind: 'add' }
    | { kind: 'remove'; owner: ClientOwnershipOwner }
    | { kind: 'transfer'; owner: ClientOwnershipOwner }
    | { kind: 'release' };

const STAGE_LABELS: Record<ClientOwnershipView['stage'], string> = {
    LEAD: 'مرشح (LEAD)',
    FOP: 'مستهدف (FOP)',
    OP: 'زبون فعلي (OP)',
};

const CONTEXT_LABELS: Record<string, string> = {
    manual_add: 'إضافة يدوية',
    manual_remove: 'إزالة يدوية',
    manual_transfer: 'نقل بين موظفين',
    manual_release: 'إرجاع للفرع',
    client_created: 'عند إضافة الزبون',
    candidate_converted: 'تحويل من اسم مقترح',
    candidate_linked: 'ربط اسم مقترح',
    sale_op: 'البيعة (OP)',
    status_op_fop: 'تغيير المرحلة',
    client_deleted: 'حذف الزبون',
    backfill: 'ملكية قائمة قبل بدء السجل',
};

function formatDateTime(value?: string | null) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('ar-SY', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return value;
    }
}

function formatDate(value?: string | null) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleDateString('ar-SY');
    } catch {
        return value;
    }
}

function contextLabel(entry: ClientOwnershipLogEntry) {
    if (entry.changeContext && CONTEXT_LABELS[entry.changeContext]) return CONTEXT_LABELS[entry.changeContext];
    return entry.role === 'system' ? 'النظام' : 'تعديل';
}

export default function OwnershipTab({ client }: Props) {
    const [view, setView] = useState<ClientOwnershipView | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [dialog, setDialog] = useState<Dialog | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setView(await api.clients.getOwnership(client.id));
        } catch (err: any) {
            setLoadError(err?.message || 'تعذر تحميل الملكية');
        } finally {
            setLoading(false);
        }
    }, [client.id]);

    useEffect(() => { void load(); }, [load]);

    if (loading && !view) {
        return (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل الملكية...
            </div>
        );
    }

    if (loadError || !view) {
        return (
            <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm font-medium text-red-700">
                {loadError || 'تعذر تحميل الملكية'}
            </div>
        );
    }

    const isBranchOwned = view.stage !== 'LEAD' || view.owners.every(owner => !owner.eligible);

    return (
        <div className="space-y-5">
            {/* Current ownership */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                        <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                            <Users className="h-5 w-5 text-sky-600" /> الملكية الحالية
                        </h3>
                        <p className="text-sm text-slate-500">
                            {STAGE_LABELS[view.stage]} · فرع الملكية: {view.branchName ?? '—'}
                        </p>
                    </div>
                    {view.canManage && (
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setDialog({ kind: 'add' })}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-100"
                            >
                                <UserPlus className="h-4 w-4" /> إضافة مالك
                            </button>
                            {view.owners.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setDialog({ kind: 'release' })}
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
                                >
                                    <Building2 className="h-4 w-4" /> إرجاع للفرع
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {view.manageBlockedReason && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        {view.manageBlockedReason}
                    </p>
                )}

                {isBranchOwned && (
                    <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">
                        <Building2 className="h-4 w-4 text-slate-500" />
                        الزبون ملك الفرع{view.branchName ? `: ${view.branchName}` : ''}
                    </div>
                )}

                {view.owners.length > 0 && (
                    <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {view.owners.map(owner => (
                            <li key={owner.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-bold text-slate-800">{owner.name}</span>
                                        {owner.roleName && <span className="text-xs text-slate-400">{owner.roleName}</span>}
                                        {!owner.eligible && (
                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                                                غير فعّال حالياً
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        مالك منذ {formatDate(owner.assignedAt)}
                                        {owner.assignedByName ? ` · بواسطة ${owner.assignedByName}` : ''}
                                    </p>
                                </div>
                                {view.canManage && (
                                    <div className="flex gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setDialog({ kind: 'transfer', owner })}
                                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                                        >
                                            <ArrowLeftRight className="h-3.5 w-3.5" /> نقل
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDialog({ kind: 'remove', owner })}
                                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                                        >
                                            <UserMinus className="h-3.5 w-3.5" /> إزالة
                                        </button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* History */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
                    <History className="h-5 w-5 text-slate-500" /> سجل الملكية
                </h3>
                {view.log.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-400">لا توجد تغييرات مسجلة على ملكية هذا الزبون.</p>
                ) : (
                    <ol className="mt-4 space-y-3">
                        {view.log.map(entry => {
                            const added = entry.eventType === 'owner_added';
                            return (
                                <li key={entry.id} className="flex gap-3">
                                    <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${added ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                        {added ? <UserPlus className="h-3.5 w-3.5" /> : <UserMinus className="h-3.5 w-3.5" />}
                                    </span>
                                    <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-sm font-bold text-slate-800">
                                                {added ? 'أصبح مالكاً: ' : 'انتهت ملكية: '}
                                                {entry.ownerName ?? 'مستخدم محذوف'}
                                            </span>
                                            <span className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</span>
                                        </div>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {contextLabel(entry)}
                                            {entry.performedByName ? ` · بواسطة ${entry.performedByName}` : ''}
                                        </p>
                                        {entry.reason && <p className="mt-1 text-xs text-slate-700">السبب: {entry.reason}</p>}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </section>

            {dialog && (
                <OwnershipOperationModal
                    clientId={client.id}
                    view={view}
                    dialog={dialog}
                    onClose={() => setDialog(null)}
                    onDone={(next) => { setView(next); setDialog(null); }}
                />
            )}
        </div>
    );
}

function OwnershipOperationModal({
    clientId,
    view,
    dialog,
    onClose,
    onDone,
}: {
    clientId: number;
    view: ClientOwnershipView;
    dialog: Dialog;
    onClose: () => void;
    onDone: (view: ClientOwnershipView) => void;
}) {
    const [users, setUsers] = useState<AssignableUser[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [selectedUserId, setSelectedUserId] = useState('');
    // The operation's managed reason list comes with the ownership view.
    const reasons: ReasonOption[] = view.reasonOptions?.[dialog.kind] ?? [];
    const [reasonId, setReasonId] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const needsUser = dialog.kind === 'add' || dialog.kind === 'transfer';

    useEffect(() => {
        if (!needsUser) return;
        let active = true;
        setUsersLoading(true);
        api.admin.hrUsers.assignable()
            .then(rows => {
                if (!active) return;
                setUsers((rows ?? []).map((u: any) => ({
                    id: Number(u.id),
                    name: u.name,
                    branchId: u.branch_id ?? u.branchId ?? null,
                    roleName: u.role_display_name ?? null,
                })));
            })
            .catch(() => { if (active) setUsers([]); })
            .finally(() => { if (active) setUsersLoading(false); });
        return () => { active = false; };
    }, [needsUser]);

    const candidates = useMemo(() => {
        const currentOwners = new Set(view.owners.map(owner => owner.userId));
        return users.filter(user =>
            !currentOwners.has(user.id) &&
            (view.branchId == null || user.branchId == null || user.branchId === view.branchId));
    }, [users, view.owners, view.branchId]);

    const title =
        dialog.kind === 'add' ? 'إضافة مالك'
        : dialog.kind === 'remove' ? 'إزالة مالك'
        : dialog.kind === 'transfer' ? 'نقل الملكية إلى موظف آخر'
        : 'إرجاع الزبون لملكية الفرع';

    const description =
        dialog.kind === 'add' ? 'يصبح الموظف المختار مالكاً مشاركاً مع المالكين الحاليين.'
        : dialog.kind === 'remove' ? `تنتهي ملكية ${dialog.owner.name} لهذا الزبون.`
        : dialog.kind === 'transfer' ? `تنتقل ملكية ${dialog.owner.name} إلى الموظف المختار.`
        : 'تنتهي كل الملكيات الشخصية، ويصبح الزبون ملك الفرع.';

    const trimmedNote = note.trim();
    const selectedReason = reasons.find(r => String(r.id) === reasonId);
    const noteRequired = selectedReason?.value === 'other';
    const canSubmit = !saving
        && selectedReason != null
        && (!noteRequired || trimmedNote.length > 0)
        && (!needsUser || selectedUserId !== '');

    const submit = async () => {
        if (!canSubmit || !selectedReason) return;
        const reason = { reasonId: selectedReason.id, note: trimmedNote || undefined };
        let operation: ClientOwnershipOperation;
        if (dialog.kind === 'add') {
            operation = { action: 'add', userIds: [Number(selectedUserId)], ...reason };
        } else if (dialog.kind === 'remove') {
            operation = { action: 'remove', userId: dialog.owner.userId, ...reason };
        } else if (dialog.kind === 'transfer') {
            operation = {
                action: 'transfer',
                fromUserId: dialog.owner.userId,
                toUserId: Number(selectedUserId),
                ...reason,
            };
        } else {
            operation = { action: 'release', ...reason };
        }

        setSaving(true);
        setError(null);
        try {
            onDone(await api.clients.applyOwnershipOperation(clientId, operation));
        } catch (err: any) {
            setError(err?.message || 'تعذر تنفيذ العملية');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            isOpen
            onClose={saving ? () => undefined : onClose}
            title={title}
            size="md"
            footer={(
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        إلغاء
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!canSubmit}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} تأكيد
                    </button>
                </div>
            )}
        >
            <div className="space-y-4" dir="rtl">
                <p className="text-sm text-slate-600">{description}</p>

                {needsUser && (
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-500">
                            الموظف <span className="text-red-500">*</span>
                        </label>
                        {usersLoading ? (
                            <div className="flex items-center gap-2 text-xs text-slate-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> جاري تحميل الموظفين...
                            </div>
                        ) : candidates.length === 0 ? (
                            <p className="text-xs text-slate-400">لا يوجد موظفون مؤهلون للملكية في فرع الزبون.</p>
                        ) : (
                            <Select<string>
                                value={selectedUserId}
                                onChange={setSelectedUserId}
                                ariaLabel="الموظف"
                                className="w-full"
                                options={[
                                    { value: '', label: 'اختر الموظف' },
                                    ...candidates.map(user => ({
                                        value: String(user.id),
                                        label: user.roleName ? `${user.name} — ${user.roleName}` : user.name,
                                    })),
                                ]}
                            />
                        )}
                    </div>
                )}

                <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">
                        السبب <span className="text-red-500">*</span>
                    </label>
                    {reasons.length === 0 ? (
                        <p className="text-xs text-amber-700">
                            لا توجد أسباب فعّالة لهذه العملية؛ تُضاف من «إدارة القوائم».
                        </p>
                    ) : (
                        <Select<string>
                            value={reasonId}
                            onChange={setReasonId}
                            ariaLabel="السبب"
                            className="w-full"
                            options={[
                                { value: '', label: 'اختر السبب' },
                                ...reasons.map(r => ({ value: String(r.id), label: r.label })),
                            ]}
                        />
                    )}
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-500">
                        ملاحظة {noteRequired ? <span className="text-red-500">*</span> : '(اختيارية)'}
                    </label>
                    <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        rows={2}
                        placeholder={noteRequired ? 'وضّح السبب' : 'ملاحظة إضافية'}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
                    />
                </div>

                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
            </div>
        </Modal>
    );
}
