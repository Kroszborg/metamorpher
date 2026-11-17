import type { Metadata } from 'next';
import { AccountsOff } from '@/components/account/accounts-off';
import { HistoryPage } from '@/components/account/history-page';
import { PageHeader } from '@/components/kit/page-header';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';

export const metadata: Metadata = { title: 'History', robots: { index: false, follow: false } };

export default function HistoryRoute() {
  if (!ACCOUNTS_ENABLED) return <AccountsOff />;
  return (
    <div className="page-container pt-6 pb-16 sm:pt-8">
      <div className="flex max-w-3xl flex-col gap-8">
        <PageHeader
          title="History"
          subtitle="Tool runs and Chat with PDF conversations kept on your account. Delete any of it at any time."
        />
        <HistoryPage />
      </div>
    </div>
  );
}
