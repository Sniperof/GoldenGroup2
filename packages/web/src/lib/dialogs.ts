// Global promise-based in-app dialogs (replace window.confirm/alert/prompt).
// Callable from anywhere (components, stores, api helpers). Rendered by <DialogHost />
// (components/ui/DialogHost.tsx), mounted once in main.tsx. Requests made before the
// host mounts are queued.

export type DialogTone = 'default' | 'danger';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
}
export interface AlertOptions {
  title?: string;
  message: string;
  okText?: string;
  tone?: DialogTone;
}
export interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  confirmText?: string;
  cancelText?: string;
}

export type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'alert'; opts: AlertOptions; resolve: () => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

type Listener = (queue: DialogRequest[]) => void;

let seq = 0;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();

function emit() { listeners.forEach((l) => l(queue)); }
function push(req: DialogRequest) { queue = [...queue, req]; emit(); }

export function subscribeDialogs(l: Listener): () => void {
  listeners.add(l);
  l(queue);
  return () => { listeners.delete(l); };
}
export function settleDialog(id: number) {
  queue = queue.filter((r) => r.id !== id);
  emit();
}

export function confirmDialog(input: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof input === 'string' ? { message: input } : input;
  return new Promise((resolve) => push({ id: ++seq, kind: 'confirm', opts, resolve }));
}
export function alertDialog(input: string | AlertOptions): Promise<void> {
  const opts = typeof input === 'string' ? { message: input } : input;
  return new Promise((resolve) => push({ id: ++seq, kind: 'alert', opts, resolve }));
}
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => push({ id: ++seq, kind: 'prompt', opts, resolve }));
}
