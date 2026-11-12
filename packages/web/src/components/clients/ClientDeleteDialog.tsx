// Delete a client from the clients table: one dialog for the confirmation and
// for the answer. When the server refuses (CLIENT_DELETE_BLOCKED), every
// reason is listed so the user knows what holds the client, instead of a
// browser alert with one long sentence.
import { useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { AlertTriangle, Ban, Trash2 } from '../ui/icons';
import { api } from '../../lib/api';

type Blocker = { key: string; label: string };

type Phase =
    | { kind: 'confirm' }
    | { kind: 'deleting' }
    | { kind: 'blocked'; blockers: Blocker[] }
    | { kind: 'failed'; message: string };

interface Props {
    client: { id: number; name: string } | null;
    onClose: () => void;
    onDeleted: () => void | Promise<void>;
}

export default function ClientDeleteDialog({ client, onClose, onDeleted }: Props) {
    const [phase, setPhase] = useState<Phase>({ kind: 'confirm' });

    useEffect(() => {
        if (client) setPhase({ kind: 'confirm' });
    }, [client?.id]);

    if (!client) return null;
    const busy = phase.kind === 'deleting';

    const confirmDelete = async () => {
        setPhase({ kind: 'deleting' });
        try {
            await api.clients.delete(client.id);
            await onDeleted();
            onClose();
        } catch (err: any) {
            const payload = err?.payload ?? err?.response?.data ?? null;
            if (payload?.code === 'CLIENT_DELETE_BLOCKED' && Array.isArray(payload.blockers)) {
                setPhase({ kind: 'blocked', blockers: payload.blockers });
            } else {
                setPhase({ kind: 'failed', message: payload?.error || err?.message || 'تعذّر حذف الزبون' });
            }
        }
    };

    const title = phase.kind === 'blocked' ? 'لا يمكن حذف الزبون' : 'حذف الزبون';

    return (
        <Modal
            isOpen
            onClose={busy ? () => undefined : onClose}
            title={title}
            subtitle={client.name}
            size="sm"
            closeOnBackdrop={!busy}
            closeOnEsc={!busy}
            footer={
                phase.kind === 'blocked' || phase.kind === 'failed' ? (
                    <Button variant="secondary" onClick={onClose}>حسناً</Button>
                ) : (
                    <>
                        <Button variant="secondary" onClick={onClose} disabled={busy}>إلغاء</Button>
                        <Button variant="danger" onClick={confirmDelete} loading={busy}>
                            <Trash2 className="h-4 w-4" /> حذف
                        </Button>
                    </>
                )
            }
        >
            {(phase.kind === 'confirm' || phase.kind === 'deleting') && (
                <div className="space-y-3 text-sm text-slate-700">
                    <p>سيُخفى الزبون من جداول النظام وقوائمه.</p>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
                        <p className="mb-1 flex items-center gap-1.5 font-bold">
                            <AlertTriangle className="h-4 w-4" /> ما يحدث عند الحذف
                        </p>
                        <p>تُلغى مهامه المفتوحة، وتُزال ملكيته، ويُسجَّل ذلك في سجلّاتها.</p>
                    </div>
                    <p className="text-xs text-slate-500">
                        لا يُحذف الزبون إذا كان له عقود أو زيارات أو أجهزة أو حركات مالية أو هدايا أو طلبات أو شكاوى أو حساب تطبيق، أو كان وسيطاً لزبائن آخرين.
                    </p>
                </div>
            )}

            {phase.kind === 'blocked' && (
                <div className="space-y-3 text-sm text-slate-700">
                    <p>الزبون مرتبط ببيانات قائمة في النظام:</p>
                    <ul className="space-y-1.5">
                        {phase.blockers.map(b => (
                            <li key={b.key} className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 font-bold text-rose-700">
                                <Ban className="h-4 w-4 shrink-0" /> {b.label}
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-slate-500">
                        إن كان الحذف مقصوداً، عالج هذه الارتباطات أولاً (مثلاً أوقف حساب التطبيق)، ثم أعد المحاولة.
                    </p>
                </div>
            )}

            {phase.kind === 'failed' && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{phase.message}</p>
            )}
        </Modal>
    );
}
