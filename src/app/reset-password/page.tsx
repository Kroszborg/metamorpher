import type { Metadata } from 'next';
import { AccountsOff } from '@/components/account/accounts-off';
import { ResetPasswordForm } from '@/components/account/password-forms';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return ACCOUNTS_ENABLED ? <ResetPasswordForm /> : <AccountsOff />;
}
