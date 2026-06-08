import type { ContactEntry, ContactStatus, ContactType } from './types';

export const CONTACT_TYPE_CONFIG: Record<ContactType, { label: string; emoji: string }> = {
  mobile: { label: 'موبايل', emoji: '📱' },
  landline: { label: 'هاتف', emoji: '☎️' },
  other: { label: 'آخر', emoji: '📞' },
};

export const CONTACT_STATUS_CONFIG: Record<ContactStatus, { label: string; style: string }> = {
  active: { label: 'فعّال', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  preferred: { label: 'مفضّل', style: 'bg-sky-50 text-sky-700 border-sky-200' },
  'out-of-coverage': { label: 'خارج التغطية', style: 'bg-amber-50 text-amber-700 border-amber-200' },
  unused: { label: 'غير مستخدم', style: 'bg-gray-50 text-gray-500 border-gray-200' },
  invalid: { label: 'قيمة خاطئة', style: 'bg-red-50 text-red-700 border-red-200' },
};

export const SYRIAN_MOBILE_HINT = '09XXXXXXXX';

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidSyrianMobile(value: unknown): boolean {
  return /^09\d{8}$/.test(digitsOnly(value));
}

export function isInvalidContactNumber(contact: Pick<ContactEntry, 'type' | 'number'>): boolean {
  return contact.type === 'mobile' && Boolean(contact.number) && !isValidSyrianMobile(contact.number);
}

export function normalizeContactNumberInput(
  type: ContactType,
  status: ContactStatus | undefined,
  nextValue: string,
  previousValue = '',
): string {
  const digits = digitsOnly(nextValue);

  if (status === 'invalid') {
    return type === 'landline' ? digits.slice(0, 7) : digits.slice(0, 15);
  }

  if (type === 'mobile') {
    const next = digits.slice(0, 10);
    if (next.length < digitsOnly(previousValue).length) return next;
    return /^(|0|09\d{0,8})$/.test(next) ? next : previousValue;
  }

  if (type === 'landline') {
    return digits.slice(0, 7);
  }

  return digits.slice(0, 15);
}

export function getContactValidationMessage(contact: ContactEntry): string | null {
  if (!contact.number.trim()) return null;
  if (contact.type === 'mobile' && contact.status !== 'invalid' && !isValidSyrianMobile(contact.number)) {
    return 'رقم الموبايل يجب أن يبدأ بـ 09 ويتكون من 10 أرقام، أو غيّر الحالة إلى قيمة خاطئة.';
  }
  return null;
}
