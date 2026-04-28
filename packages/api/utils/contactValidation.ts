import type { ContactEntry, ContactStatus, ContactType } from '@golden-crm/shared';

type RawContact = Record<string, unknown>;

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';

  const digits = digitsOnly(value);
  if (!digits) return '';

  if (/^009639\d{8}$/.test(digits)) return `0${digits.slice(5)}`;
  if (/^9639\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^9\d{8}$/.test(digits)) return `0${digits}`;

  return digits;
}

export function isValidSyrianMobile(value: unknown): boolean {
  return /^09\d{8}$/.test(normalizePhone(value));
}

export function normalizeContactType(value: unknown): ContactType {
  const raw = String(value ?? 'mobile').trim();
  if (raw === 'landline' || raw === 'other') return raw;
  return 'mobile';
}

export function normalizeContactStatus(value: unknown): ContactStatus {
  const raw = String(value ?? 'active').trim();
  if (raw === 'preferred' || raw === 'out-of-coverage' || raw === 'unused' || raw === 'invalid') return raw;
  return 'active';
}

export function normalizeContactNumber(type: ContactType, status: ContactStatus, value: unknown): string {
  if (status === 'invalid') return digitsOnly(value);
  return type === 'mobile' ? normalizePhone(value) : digitsOnly(value);
}

export function validateContactNumber(type: ContactType, status: ContactStatus, number: string, areaCode?: string) {
  if (!number) return;

  if (type === 'mobile' && status !== 'invalid' && !isValidSyrianMobile(number)) {
    const error = new Error('رقم الموبايل يجب أن يبدأ بـ 09 ويتكون من 10 أرقام') as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  if (type === 'landline' && status !== 'invalid') {
    if (!/^\d{7}$/.test(number)) {
      const error = new Error('رقم الهاتف يجب أن يتكون من 7 أرقام') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
    if (!/^\d{3}$/.test(areaCode ?? '')) {
      const error = new Error('رمز الهاتف يجب أن يتكون من 3 أرقام') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
  }
}

export function normalizeContactsForWrite(
  rawContacts: unknown,
  options: { requireOne?: boolean; forceNonPrimary?: boolean } = {},
): ContactEntry[] {
  const source = Array.isArray(rawContacts) ? rawContacts : [];
  const contacts = source
    .map((item, index): ContactEntry | null => {
      const record = item && typeof item === 'object' ? item as RawContact : {};
      const type = normalizeContactType(record.type);
      const status = normalizeContactStatus(record.status);
      const number = normalizeContactNumber(type, status, record.number);
      if (!number) return null;

      const areaCode = type === 'landline' ? digitsOnly(record.areaCode).slice(0, 3) : undefined;
      validateContactNumber(type, status, number, areaCode);

      return {
        id: String(record.id ?? `contact-${index + 1}`),
        type,
        number,
        areaCode,
        label: String(record.label ?? ''),
        hasWhatsApp: Boolean(record.hasWhatsApp),
        isPrimary: options.forceNonPrimary ? false : Boolean(record.isPrimary),
        status,
      };
    })
    .filter((item): item is ContactEntry => Boolean(item));

  if (options.requireOne && contacts.length === 0) {
    const error = new Error('يجب إضافة وسيلة تواصل واحدة على الأقل') as Error & { status?: number };
    error.status = 400;
    throw error;
  }

  return contacts;
}

export function getCanonicalContactNumber(contacts: ContactEntry[]): string {
  const contact = contacts.find((item) => item.isPrimary) || contacts.find((item) => item.type === 'mobile') || contacts[0];
  if (!contact) return '';
  return contact.type === 'landline' && contact.areaCode ? `${contact.areaCode}${contact.number}` : contact.number;
}
