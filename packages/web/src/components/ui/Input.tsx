// ────────────────────────────────────────────────────────────────────────────
// <Input> — Golden Group design system text field.
//
// Pill input with optional label, helper text, and error state.
// Leading/trailing slots accept any ReactNode (icon, currency symbol, etc.).
//
// Behavior:
//   • If `error` is set, border + label go red and helper hides.
//   • Label/helper IDs are wired via aria-describedby for screen readers.
//
// Use this only for SINGLE-LINE text inputs. Textareas / number-with-stepper
// remain custom; checkboxes / radios are intentionally not in this component.
//
// The pill border-radius and focus ring come from index.css globally — this
// component focuses on layout (label + helper + slots) and error state.
// ────────────────────────────────────────────────────────────────────────────
import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helper?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Heights match <Button>: sm=h-8, md=h-10 (default), lg=h-12. */
  inputSize?: InputSize;
  /** Make the input span its container (default true). */
  fullWidth?: boolean;
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-8 text-sm',
  md: 'h-10 text-sm',
  lg: 'h-12 text-lg',
};

// Slot padding (inline-start padding for leading; inline-end padding for
// trailing) — base padding is on the side without a slot; the slot side gets
// extra room for the icon/button.
const SLOT_PADDING: Record<InputSize, { base: string; withLeading: string; withTrailing: string }> = {
  sm: { base: 'px-3.5',  withLeading: 'pr-9',  withTrailing: 'pl-9'  },
  md: { base: 'px-4',    withLeading: 'pr-10', withTrailing: 'pl-10' },
  lg: { base: 'px-5',    withLeading: 'pr-12', withTrailing: 'pl-12' },
};

const SLOT_POSITION: Record<InputSize, string> = {
  sm: 'inset-y-0',
  md: 'inset-y-0',
  lg: 'inset-y-0',
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helper,
    error,
    leading,
    trailing,
    inputSize = 'md',
    fullWidth = true,
    id,
    className = '',
    type = 'text',
    required,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  const hasError = Boolean(error);
  const describedBy = hasError ? errorId : helper ? helperId : undefined;
  const pad = SLOT_PADDING[inputSize];
  const paddingCls = [
    !leading && !trailing ? pad.base : '',
    leading ? pad.withLeading : '',
    trailing ? pad.withTrailing : '',
    leading && !trailing ? 'pl-4' : '',
    trailing && !leading ? 'pr-4' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={fullWidth ? 'w-full' : 'inline-block'}>
      {label && (
        <label
          htmlFor={inputId}
          className={`block text-base font-semibold mb-1.5 ${hasError ? 'text-red-600' : 'text-slate-700'}`}
        >
          {label}
          {required && <span className="text-red-500 mr-1">*</span>}
        </label>
      )}
      <div className="relative">
        {leading && (
          <div className={`absolute ${SLOT_POSITION[inputSize]} right-4 flex items-center text-slate-400 pointer-events-none`}>
            {leading}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={[
            'w-full bg-white border text-slate-800 placeholder:text-slate-400 transition-colors',
            'focus:outline-none disabled:bg-slate-50 disabled:cursor-not-allowed',
            SIZE_CLASSES[inputSize],
            paddingCls,
            hasError ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-sky-500',
            className,
          ].filter(Boolean).join(' ')}
          {...rest}
        />
        {trailing && (
          <div className={`absolute ${SLOT_POSITION[inputSize]} left-4 flex items-center text-slate-400`}>
            {trailing}
          </div>
        )}
      </div>
      {hasError ? (
        <p id={errorId} className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="mt-1.5 text-xs text-slate-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
