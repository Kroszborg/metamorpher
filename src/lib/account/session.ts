'use client';

import { api } from './api';
import { clearHint } from './hint';

/** After a successful sign-in: load the account (sets the hint) and start sync. */
export async function afterSignIn(): Promise<boolean> {
  const { startSync } = await import('./sync');
  return (await startSync()) !== null;
}

/** Signs out on the server and cuts this browser's link to the account. Local data stays. */
export async function signOut(): Promise<void> {
  await api('POST', '/api/auth/sign-out', {});
  await forgetAccount();
}

/** Clears local account state (after sign-out or account deletion). */
export async function forgetAccount(): Promise<void> {
  clearHint();
  const { stopSync } = await import('./sync');
  stopSync();
}
