import type { Metadata } from 'next';
import { AiSettingsPanel } from '@/components/ai/ai-settings-panel';
import { PageHeader } from '@/components/kit/page-header';

export const metadata: Metadata = {
  title: 'AI settings',
  description: 'API keys for cloud AI providers and downloaded on-device models, stored on this device only.',
  robots: { index: false },
};

export default function AiSettingsPage() {
  return (
    <div className="page-container flex flex-col gap-8 pt-6 pb-16 sm:pt-8">
      <PageHeader
        title="AI settings"
        subtitle="Bring your own API key for cloud models, or manage the models that run on this device."
      />
      <AiSettingsPanel />
    </div>
  );
}
