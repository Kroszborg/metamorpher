import type { Metadata } from 'next';
import { AccountsOff } from '@/components/account/accounts-off';
import { SignUpForm } from '@/components/account/sign-up-form';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'Create an account', robots: { index: false, follow: false } };

export default function SignUpPage() {
  return ACCOUNTS_ENABLED ? <SignUpForm /> : <AccountsOff />;
}
