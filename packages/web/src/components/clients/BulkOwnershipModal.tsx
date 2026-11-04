// Bulk «إسناد ملكية» on the clients table's current filter result, or on the
// rows ticked in the table (`clientIds`).
//
// The server rebuilds the result from the same filters as the table (or takes
// the ticked ids through the same scope checks) and acts
// on clients of one branch, at any stage: the chosen employee is ADDED as an owner
// (existing owners stay), clients they already own are skipped. A preview
// shows the counts first; the apply call sends the count it showed, so a
// result that changed in between is refused instead of silently differing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, UserPlus } from '../ui/icons';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { api, type ClientBulkOwnershipResult, type PagedClientsParams } from '../../lib/api';

interface Props {
    open: boolean;
    onClose: () => void;
    filters: PagedClientsParams;
    /** Ticked rows: when set, the operation acts on these clients instead of the filter result. */
    clientIds?: number[] | null;
    /** The branch the result is narrowed to (GLOBAL viewers pick it in the page filter). */
    branchId: number | null;
    onApplied: () => void;
}

type AssignableUser = { id: number; name: string; branchId: number | null; roleName: string | null };
type Counts = Omit<ClientBulkOwnershipResult, 'reasonOptions' | 'applied'>;

export default function BulkOwnershipModal({ open, onClose, filters, clientIds, branchId, onApplied }: Props) {
    const bySelection = clientIds != null && clientIds.length > 0;
    const target = bySelection ? { clientIds: clientIds! } : {};
    const [users, setUsers] = useState<AssignableUser[]>([]);
    const [reasons, setReasons] = useState<Array<{ id: number; value: string; label: string }>>([]);
    const [userId, setUserId] = useState('');
    const [reasonId, setReasonId] = useState('');
    const [note, setNote] = useState('');
    const [counts, setCounts] = useState<Counts | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [appliedCount, setAppliedCount] = useState<number | null>(null);

    const preview = useCallback(async (forUserId: string) => {
        setPreviewing(true);
        setError(null);
        try {
            const result = await api.clients.bulkOwnership(filters, {
                ...target,
                dryRun: true,
                userId: forUserId ? Number(forUserId) : undefined,
            });
            setCounts(result);
            if (result.reasonOptions) setReasons(result.reasonOptions);
        } catch (err: any) {
            setCounts(null);
            setError(err?.message || (bySelection ? 'تعذرت معاينة الزبائن المحددين' : 'تعذرت معاينة نتيجة الفلتر'));
        } finally {
            setPreviewing(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters, clientIds]);

    useEffect(() => {
        if (!open) return;
        setUserId('');
        setReasonId('');
        setNote('');
        setCounts(null);
        setAppliedCount(null);
        setError(null);
        void preview('');
        api.admin.hrUsers.assignable()
            .then(rows => setUsers((rows ?? []).map((u: any) => ({
                id: Number(u.id),
                name: u.name,
                branchId: u.branch_id ?? u.branchId ?? null,
                roleName: u.role_display_name ?? null,
            }))))
            .catch(() => setUsers([]));
        // Only when the dialog opens: the filters are frozen while it is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const branchUsers = useMemo(
        () => users.filter(user => branchId == null || user.branchId == null || user.branchId === branchId),
        [users, branchId],
    );

    const selectedReason = reasons.find(r => String(r.id) === reasonId);
    const noteRequired = selectedReason?.value === 'other';
    const canApply = !saving && !previewing && counts != null && counts.toAssign > 0
        && userId !== '' && selectedReason != null && (!noteRequired || note.trim().length > 0);

    const apply = async () => {
        if (!canApply || !counts || !selectedReason) return;
        setSaving(true);
        setError(null);
        try {
            const result = await api.clients.bulkOwnership(filters, {
                ...target,
                dryRun: false,
                userId: Number(userId),
                reasonId: selectedReason.id,
                note: note.trim() || undefined,
                expectedCount: counts.toAssign,
            });
            setAppliedCount(result.applied);
            onApplied();
        } catch (err: any) {
            const payload = err?.payload;
            if (payload?.code === 'BULK_OWNERSHIP_STALE') {
                setCounts(payload);
            }
            setError(err?.message || 'تعذر تنفيذ الإسناد الجماعي');
        } finally {
            setSaving(false);
        }
    };

    const done = appliedCount != null;

    return (
        <Modal
            isOpen={open}
            onClose={saving ? () => undefined : onClose}
            title={bySelection ? 'إسناد ملكية الزبائن المحددين' : 'إسناد ملكية نتائج الفلتر'}
            size="md"
            footer={(
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        {done ? 'إغلاق' : 'إلغاء'}
                    </button>
                    {!done && (
                        <button
                            type="button"
                            onClick={apply}
                            disabled={!canApply}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                            إسناد {counts?.toAssign ?? ''} زبون
                        </button>
                    )}
                </div>
            )}
        >
            <div className="space-y-4" dir="rtl">
                {done ? (
                    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">
                        تم إسناد {appliedCount} زبون، وسُجّلت العملية في سجل ملكية كل زبون.
                    </p>
                ) : (
                    <>
                        <p className="text-sm text-slate-600">
                            يُضاف الموظف المختار مالكاً {bySelection ? 'للزبائن المحددين في الجدول' : 'لزبائن نتيجة الفلتر الحالية'}، ويبقى المالكون الحاليون.
                        </p>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500">
                                الموظف <span className="text-red-500">*</span>
                            </label>
                            {branchUsers.length === 0 ? (
                                <p className="text-xs text-slate-400">لا يوجد موظفون مؤهلون للملكية في هذا الفرع.</p>
                            ) : (
                                <Select<string>
                                    value={userId}
                                    onChange={(value) => { setUserId(value); void preview(value); }}
                                    ariaLabel="الموظف"
                                    className="w-full"
                                    options={[
                                        { value: '', label: 'اختر الموظف' },
                                        ...branchUsers.map(user => ({
                                            value: String(user.id),
                                            label: user.roleName ? `${user.name} — ${user.roleName}` : user.name,
                                        })),
                                    ]}
                                />
                            )}
                        </div>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            {previewing || counts == null ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {bySelection ? 'جاري فحص الزبائن المحددين...' : 'جاري حساب نتيجة الفلتر...'}
                                </div>
                            ) : (
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                                    <dt className="text-slate-500">{bySelection ? 'الزبائن المحددون' : 'زبائن الفلتر في الفرع'}</dt>
                                    <dd className="font-bold text-slate-800">{counts.matched}</dd>
                                    {userId !== '' && (
                                        <>
                                            <dt className="text-slate-500">مستثنون (مالكهم أصلاً)</dt>
                                            <dd className="font-bold text-slate-800">{counts.alreadyOwner}</dd>
                                        </>
                                    )}
                                    <dt className="font-bold text-sky-700">سيتم إسنادهم</dt>
                                    <dd className="font-black text-sky-700">{counts.toAssign}</dd>
                                </dl>
                            )}
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-500">
                                السبب <span className="text-red-500">*</span>
                            </label>
                            {reasons.length === 0 ? (
                                <p className="text-xs text-amber-700">لا توجد أسباب فعّالة لإضافة مالك؛ تُضاف من «إدارة القوائم».</p>
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
                    </>
                )}

                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
            </div>
        </Modal>
    );
}
