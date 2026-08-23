interface UiCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Creates an ephemeral client-side identifier without requiring
 * Crypto.randomUUID(), which is unavailable in older browsers and insecure
 * HTTP contexts. These IDs are UI keys only and are never persisted.
 */
export function createUiId(
  cryptoApi: UiCrypto | null | undefined = globalThis.crypto as UiCrypto | undefined,
): string {
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return formatUuidV4(bytes);
  }

  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
