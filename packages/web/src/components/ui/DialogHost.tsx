// Renders the global confirm/alert/prompt dialogs from lib/dialogs.ts.
// Mount once near the app root.
import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import { subscribeDialogs, settleDialog } from '../../lib/dialogs';
import type { DialogRequest } from '../../lib/dialogs';

function DialogView({ req }: { req: DialogRequest }) {
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.opts.defaultValue ?? '') : '');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const danger = req.kind !== 'prompt' && req.opts.tone === 'danger';
  const required = req.kind === 'prompt' && !!req.opts.required;
  const canSubmit = !required || value.trim().length > 0;

  function finish(ok: boolean) {
    if (req.kind === 'confirm') req.resolve(ok);
    else if (req.kind === 'alert') req.resolve();
    else req.resolve(ok ? value : null);
    settleDialog(req.id);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (req.kind === 'prompt') { inputRef.current?.focus(); inputRef.current?.select(); }
      else okRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [req]);

  // Enter confirms (Escape / overlay click are handled by Modal -> cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const multiline = req.kind === 'prompt' && req.opts.multiline;
      if (multiline && !(e.ctrlKey || e.metaKey)) return;
      if (!canSubmit) return;
      e.preventDefault();
      finish(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const title =
    req.opts.title ??
    (req.kind === 'confirm' ? 'تأكيد' : req.kind === 'alert' ? 'تنبيه' : 'إدخال');
  const confirmText =
    req.kind === 'alert' ? (req.opts.okText ?? 'حسناً') : (req.opts.confirmText ?? 'تأكيد');
  const cancelText = req.kind === 'alert' ? '' : (req.opts.cancelText ?? 'إلغاء');
  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';

  return (
    <Modal
      isOpen
      onClose={() => finish(false)}
      title={title}
      size="sm"
      hideCloseButton
      footer={
        <>
          {req.kind !== 'alert' && (
            <Button variant="secondary" onClick={() => finish(false)}>{cancelText}</Button>
          )}
          <Button
            ref={okRef}
            variant={danger ? 'danger' : 'primary'}
            disabled={!canSubmit}
            onClick={() => finish(true)}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-5" dir="rtl">
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{req.opts.message}</p>
        {req.kind === 'prompt' && (
          req.opts.multiline ? (
            <textarea
              ref={inputRef}
              rows={3}
              value={value}
              placeholder={req.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className={inputCls}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={value}
              placeholder={req.opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              className={inputCls}
            />
          )
        )}
      </div>
    </Modal>
  );
}

export default function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);
  const current = queue[0];
  if (!current) return null;
  return <DialogView key={current.id} req={current} />;
}
