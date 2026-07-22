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
  db?: PoolClient;
}) {
  const tx = await acquireTx(input.db);
  try {
    const identity = await resolveMobileIntakeIdentity({
      db: tx.client,
      appAccount: input.appAccount,
      handle: input.body.handle,
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
