type CustomerSnapshotInput = Record<string, unknown> | null | undefined;

const nonEmptyText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

export function getSnapshotAddress(snapshot: CustomerSnapshotInput): string | null {
  if (!snapshot) return null;
  const direct = nonEmptyText(snapshot.addressText);
  if (direct) return direct;

  const address = snapshot.address;
  if (typeof address === 'string') return nonEmptyText(address);
  if (address && typeof address === 'object' && !Array.isArray(address)) {
    return nonEmptyText((address as Record<string, unknown>).detailedAddress);
  }
  return null;
}

export function resolveBookingAddress(input: {
  taskListAddress?: unknown;
  taskLocationAddress?: unknown;
  customerAddress?: unknown;
  suppliedSnapshot?: CustomerSnapshotInput;
}): string | null {
  return nonEmptyText(input.taskListAddress)
    ?? nonEmptyText(input.taskLocationAddress)
    ?? getSnapshotAddress(input.suppliedSnapshot)
    ?? nonEmptyText(input.customerAddress);
}

export function withResolvedBookingAddress(
  snapshot: CustomerSnapshotInput,
  addressText: string | null,
): Record<string, unknown> | null {
  if (!snapshot && !addressText) return null;
  const base = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot
    : {};
  return {
    ...base,
    ...(addressText ? { addressText } : {}),
  };
}
