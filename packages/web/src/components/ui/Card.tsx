// ────────────────────────────────────────────────────────────────────────────
// <Card> — Golden Group design system container.
//
// Default: white bg, brand 12px radius, subtle slate border, soft shadow.
// Padding presets: none | sm (p-3) | md (p-5) | lg (p-6).
// Shadow presets: none | sm (default) | md.
// Set `bordered={false}` for shadow-only cards.
//
// Use <CardHeader> / <CardBody> / <CardFooter> for the standard layout, or
// pass arbitrary children for a freeform card.
// ────────────────────────────────────────────────────────────────────────────
import type { HTMLAttributes, ReactNode } from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardShadow = 'none' | 'sm' | 'md';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  shadow?: CardShadow;
  bordered?: boolean;
  children?: ReactNode;
}

const PADDING: Record<CardPadding, string> = {
  none: 'p-0',
  sm:   'p-3',
  md:   'p-5',
  lg:   'p-6',
};

const SHADOW: Record<CardShadow, string> = {
  none: '',
  sm:   'shadow-sm',
  md:   'shadow-md',
};

export default function Card({
  padding = 'md',
  shadow = 'sm',
  bordered = true,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        'bg-white rounded-xl',
        bordered ? 'border border-slate-200' : '',
        PADDING[padding],
        SHADOW[shadow],
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = '', children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-base font-bold text-slate-800 ${className}`} {...rest}>
      {children}
    </h3>
  );
}

export function CardBody({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`text-base text-slate-700 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-100 ${className}`} {...rest}>
      {children}
    </div>
  );
}
