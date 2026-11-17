import type { Metadata } from 'next';
import { AccountsOff } from '@/components/account/accounts-off';
import { ForgotPasswordForm } from '@/components/account/password-forms';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'Reset your password', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return ACCOUNTS_ENABLED ? <ForgotPasswordForm /> : <AccountsOff />;
}
