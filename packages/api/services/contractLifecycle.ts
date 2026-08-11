export type ContractWriteStatus =
  | 'draft'
  | 'cancelled'
  | 'completed'
  | 'discarded';

/**
 * Creating or editing a contract is never an activation operation.
 *
 * The client-supplied status is intentionally treated as untrusted here:
 * only explicit terminal states survive a normal write. Activation belongs
 * exclusively to POST /contracts/:id/approve, where authorization, locking,
 * validation, and all operational materialization run together.
 */
export function deriveContractWriteStatus(status: unknown): ContractWriteStatus {
  if (status === 'cancelled' || status === 'completed' || status === 'discarded') {
    return status;
  }
  return 'draft';
}
