import type { Metadata } from 'next';
import { AccountPage, AccountHeader } from '@/components/account/account-page';
import { AccountsOff } from '@/components/account/accounts-off';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } };

/** Static shell; the account loads on the client, so this page never renders per request. */
export default function AccountRoute() {
  if (!ACCOUNTS_ENABLED) return <AccountsOff />;
  return (
    <div className="page-container pt-6 pb-16 sm:pt-8">
      <div className="flex max-w-3xl flex-col gap-8">
        <AccountHeader />
        <AccountPage />
      </div>
    </div>
  );
}
