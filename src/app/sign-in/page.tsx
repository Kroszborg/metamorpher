import type { Metadata } from 'next';
import { AccountsOff } from '@/components/account/accounts-off';
import { SignInForm } from '@/components/account/sign-in-form';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default function SignInPage() {
  return ACCOUNTS_ENABLED ? <SignInForm /> : <AccountsOff />;
}
