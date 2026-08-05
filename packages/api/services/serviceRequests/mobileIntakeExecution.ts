import type { PoolClient } from 'pg';
import type { AppAccountClaims } from '../appAccounts/appAuthService.js';
import { acquireTx, commitTx, rollbackTx } from './_shared.js';
import type { MobileIntakeHandler } from './mobileIntakeRegistry.js';
import {
  consumeMobileIntakeIdentity,
  resolveMobileIntakeIdentity,
} from './mobileIntakeIdentity.js';

export async function executeMobileIntake(input: {
  handler: MobileIntakeHandler;
  body: Record<string, unknown>;
  appAccount?: AppAccountClaims;
  /** `X-Device-Id` header — the unverified tier's identifier (DEC-016). */
  deviceId?: string | null;
  /** Client address, second layer above the fingerprint. */
  ip?: string | null;
  db?: PoolClient;
}) {
  const tx = await acquireTx(input.db);
  try {
    const identity = await resolveMobileIntakeIdentity({
      db: tx.client,
      appAccount: input.appAccount,
      handle: input.body.handle,
      deviceId: input.deviceId,
      ip: input.ip,
      allowUnverified: input.handler.allowsUnverifiedIntake === true,
    });
    const result = await input.handler.submit(input.body, identity, tx.client);
    await consumeMobileIntakeIdentity(tx.client, identity);
    await commitTx(tx);
    return result;
  } catch (error) {
    await rollbackTx(tx);
    throw error;
  } finally {
    tx.release();
  }
}
