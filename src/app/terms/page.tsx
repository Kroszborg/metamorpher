import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/kit/page-header';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { AUTHOR, SITE_NAME, SOURCE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: `The terms for using ${SITE_NAME}: free, open source, provided as is, and your files stay yours.`,
  alternates: { canonical: '/terms' },
};

const UPDATED = '19 November 2026';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm/relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-foreground [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="page-container pt-6 pb-16 sm:pt-8">
      <div className="flex max-w-3xl flex-col gap-10">
        <PageHeader
          breadcrumb={<Breadcrumb items={[{ label: 'All tools', href: '/' }]} />}
          title="Terms"
          subtitle={`Short and plain. By using ${SITE_NAME} you agree to these terms. Last updated ${UPDATED}.`}
        />

        <Section title="The service">
          <p>
            {SITE_NAME} is a set of file tools that run in your browser. It is free to use, has no adverts, and is run by{' '}
            <a href={AUTHOR.url} target="_blank" rel="noreferrer">
              {AUTHOR.name}
            </a>{' '}
            as an independent project. Tools may be added, changed or removed at any time.
          </p>
        </Section>

        <Section title="Your files">
          <p>
            <strong>Your files stay yours.</strong> They are processed on your device and are not uploaded to us, so we
            hold no copy of them and claim no rights over them or over anything you make with the tools. How the few
            optional features that contact other services work is set out on the <Link href="/privacy">privacy page</Link>.
          </p>
          <p>
            Because nothing is stored on our side, <strong>we cannot recover a file for you</strong>. Keep your originals
            until you have checked the result.
          </p>
        </Section>

        <Section title="Using it fairly">
          <ul>
            <li>Only work on files you have the right to use, and follow the law where you live.</li>
            <li>
              Removing a password, restrictions or personal data from a document is for documents you own or are allowed
              to change.
            </li>
            <li>Do not try to break, overload or misuse the site, its accounts or other people’s use of it.</li>
          </ul>
        </Section>

        <Section title="Accounts">
          <p>
            An account is optional and only adds history and settings sync. Keep your password to yourself; you are
            responsible for what happens under your account. You can delete your account, with everything stored for it,
            from the account page at any time. We may suspend an account that is used to abuse the service.
          </p>
        </Section>

        <Section title="AI features">
          <p>
            On-device models are downloaded from their publishers and run on your device under their own licences. If you
            add your own API key, your requests go straight from your browser to that provider under the terms you have
            with them. AI output can be wrong: check it before relying on it.
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            The service is provided <strong>as is, without warranty of any kind</strong>. Conversions and edits can lose
            detail or fail, and a redaction, an encryption or a repair should be checked before you depend on it. To the
            extent the law allows, we are not liable for lost data, lost profit or any other damage that comes from using,
            or not being able to use, the service. Nothing here limits rights you have by law that cannot be limited.
          </p>
        </Section>

        <Section title="Open source">
          <p>
            The code is published under the GNU Affero General Public License, version 3 or later, at{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              {SOURCE_URL.replace('https://', '')}
            </a>
            . You may run and change your own copy under that licence; if you offer a changed version to others over a
            network, the licence asks you to publish your changes. The bundled engines and fonts keep their own licences,
            listed in the repository.
          </p>
        </Section>

        <Section title="Changes and contact">
          <p>
            These terms may be updated; the date at the top shows the latest version, and continuing to use the site means
            you accept it. Questions and problems are welcome as an issue on the{' '}
            <a href={`${SOURCE_URL}/issues`} target="_blank" rel="noreferrer">
              project page
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
