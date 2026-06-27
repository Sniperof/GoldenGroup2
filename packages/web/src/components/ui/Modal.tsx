// ────────────────────────────────────────────────────────────────────────────
// <Modal> — Golden Group design system dialog.
//
// The single, app-wide overlay pattern, distilled from the ~30 hand-rolled
// modals across the app:
//   • Backdrop  — slate-900/40 + backdrop blur, click-to-close (opt-out).
//   • Container — white, brand 2xl radius, soft shadow, max-h 90vh.
//   • Header    — optional title + circular ✕ close (IconButton).
//   • Body      — scrolls when content exceeds the viewport.
//   • Footer    — optional slot, right-aligned actions.
//   • ESC closes (opt-out); background scroll locked while open.
//   • Framer-motion fade/scale enter+exit.
//
// Usage:
//   <Modal isOpen={open} onClose={close} title="تعيين موظف" size="sm">
//     …body…
//     <ModalFooter>…buttons…</ModalFooter>   // or pass `footer={…}`
//   </Modal>
// ────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import IconButton from './IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm:  'max-w-sm',
  md:  'max-w-md',
  lg:  'max-w-lg',
  xl:  'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
};

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional header title. When omitted (and no subtitle), no header bar is rendered. */
  title?: ReactNode;
  /** Optional secondary line under the title (e.g. a contextual name/phone). */
  subtitle?: ReactNode;
  /** Max width preset. Default 'md'. */
  size?: ModalSize;
  /** Optional right-aligned footer slot (or use <ModalFooter> in children). */
  footer?: ReactNode;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close when Escape is pressed. Default true. */
  closeOnEsc?: boolean;
  /** Hide the header ✕ button (e.g. forced-choice dialogs). Default false. */
  hideCloseButton?: boolean;
  /** Extra classes on the dialog container. */
  className?: string;
  /** Extra classes on the scrollable body wrapper. */
  bodyClassName?: string;
  children?: ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  closeOnBackdrop = true,
  closeOnEsc = true,
  hideCloseButton = false,
  className = '',
  bodyClassName = '',
  children,
}: ModalProps) {
  // Escape-to-close.
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOnEsc, onClose]);

  // Lock background scroll while open (restores prior value on close).
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          onClick={closeOnBackdrop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={[
              'bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-[90vh] overflow-hidden',
              SIZE_CLASSES[size],
              className,
            ].filter(Boolean).join(' ')}
          >
            {(title || subtitle || !hideCloseButton) && (
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
                <div className="min-w-0">
                  {title && <h3 className="text-base font-bold text-slate-800 truncate">{title}</h3>}
                  {subtitle && <p className="text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>}
                </div>
                {!hideCloseButton && (
                  <IconButton icon={X} label="إغلاق" shape="circle" size="sm" onClick={onClose} className="shrink-0" />
                )}
              </div>
            )}

            <div className={['overflow-y-auto custom-scroll', bodyClassName].filter(Boolean).join(' ')}>
              {children}
            </div>

            {footer && (
              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ModalFooter({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={['flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 shrink-0', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
