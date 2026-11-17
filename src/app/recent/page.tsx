import type { Metadata } from 'next';
import { PageHeader } from '@/components/kit/page-header';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { SavedTools } from '@/components/tools/saved-tools';

export const metadata: Metadata = { title: 'Recent', robots: { index: false } };

export default function RecentPage() {
  return (
    <div className="page-container flex flex-col gap-8 pt-6 pb-16 sm:pt-8">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: 'All tools', href: '/' }]} />}
        title="Recent"
        subtitle="Tools you opened lately, on this device."
      />
      <SavedTools kind="recent" />
    </div>
  );
}
