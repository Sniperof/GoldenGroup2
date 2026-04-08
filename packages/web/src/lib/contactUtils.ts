import { ContactEntry } from './types';

/**
 * Normalizes contact data for a Client, Candidate, or TaskListItem.
 * Returns the `contacts` array if it exists and is not empty.
 * Otherwise, falls back to wrapping the legacy `mobile` string in a single ContactEntry.
 */
export function getEntityContacts(entity: { contacts?: ContactEntry[], mobile: string }): ContactEntry[] {
    if (entity.contacts && entity.contacts.length > 0) {
        return entity.contacts;
    }

    // Fallback for legacy records that only have a mobile string
    return [{
        id: 'legacy-fallback',
        type: 'mobile',
        number: entity.mobile,
        label: 'موبايل (تلقائي)',
        hasWhatsApp: false,
        isPrimary: true,
        status: 'active'
    }];
}

/**
 * Returns the primary contact number for display purposes.
 */
export function getPrimaryContact(entity: { contacts?: ContactEntry[], mobile: string }): ContactEntry {
    const contacts = getEntityContacts(entity);
    return contacts.find(c => c.isPrimary) || contacts[0];
}
