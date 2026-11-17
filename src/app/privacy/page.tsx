import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { UsageStatsSwitch } from '@/components/analytics/usage-stats-switch';
import { PageHeader } from '@/components/kit/page-header';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { SOURCE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Metamorpher stores and what it never collects. Your files are processed on your device and never uploaded.',
  alternates: { canonical: '/privacy' },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-3 text-sm/relaxed text-muted-foreground [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="page-container pt-6 pb-16 sm:pt-8">
      <div className="flex max-w-3xl flex-col gap-10">
        <PageHeader
          breadcrumb={<Breadcrumb items={[{ label: 'All tools', href: '/' }]} />}
          title="Privacy"
          subtitle="Plainly: your files never leave your device. This page lists everything else, and it describes what the code actually does."
        />

        <Section title="Your files">
          <p>
            <strong>Every tool runs in your browser.</strong> Files you open are read and processed on your device and are
            never uploaded, with or without an account. Nothing on our servers receives a file, its contents or a preview.
          </p>
          <p>Two AI features contact other services, and only after you choose them:</p>
          <ul>
            <li>
              <strong>Downloading an on-device model</strong> fetches it once from huggingface.co, which sees your IP
              address but never your files.
            </li>
            <li>
              <strong>Using your own API key</strong> (Anthropic, OpenAI, Gemini, Groq, OpenRouter or a compatible
              server) sends your question and the relevant passages, or the audio track for transcription, from your browser
              straight to that provider. Keys stay in this browser.
            </li>
          </ul>
        </Section>

        <Section title="Without an account">
          <p>
            No cookies are set. This browser keeps your starred and recent tools, theme, AI settings and keys, Chat with PDF
            conversations (in IndexedDB) and your usage-statistics choice. None of it is sent anywhere except as described
            below.
          </p>
        </Section>

        <Section title="Anonymous usage statistics">
          <p>
            To learn which tools are used and which fail, pages send small, anonymous events to this site (never to a third
            party), after the page has finished loading:
          </p>
          <ul>
            <li>the page path (known pages only; anything else is recorded as “other”), and the referring site’s name on your first page view, never the full address;</li>
            <li>tool opened, run started, succeeded, failed or cancelled, with a short failure category such as “invalid input”, the run time rounded to a tenth of a second and the total size as a broad bucket (for example “1–10 MB”).</li>
          </ul>
          <p>On receipt, the server derives and keeps only:</p>
          <ul>
            <li>browser family, operating system and device class (for example “Firefox, Linux, desktop”);</li>
            <li>your country, when the hosting platform provides it;</li>
            <li>
              a visitor key: a hash of a random salt, your IP address and browser string. The salt changes every day and is
              deleted the next day, so the key cannot be linked across days or traced back to you.
            </li>
          </ul>
          <p>
            <strong>Never stored:</strong> your IP address, your browser’s user-agent string, cookies or any identifier in your
            browser, file names, file contents, exact sizes, and any link to your account (even when you are signed in).
            Raw events are kept for about three days and then reduced to daily totals. Known bots are ignored.
          </p>
          <p>
            Statistics are off automatically when your browser sends <strong>Do Not Track</strong> or{' '}
            <strong>Global Privacy Control</strong>. You can also switch them off here or in the footer:
          </p>
          <div className="rounded-xl border bg-card p-4 text-foreground">
            <UsageStatsSwitch withHint />
          </div>
        </Section>

        <Section title="With an account (optional)">
          <p>Creating an account stores:</p>
          <ul>
            <li>your email address, display name, a salted hash of your password (never the password), whether the email is confirmed, when the account was created and when it was last used;</li>
            <li>
              one row per signed-in device: a random session token (kept in an httpOnly cookie in your browser), when it
              started and expires, and a coarse label such as “Chrome on Windows”. Your IP address is not kept with sessions.
            </li>
          </ul>
          <p>
            To slow down password guessing, sign-in and sign-up attempts are counted per IP address; these counters are
            deleted within about an hour. Confirmation and password-reset emails are sent through Resend with only your
            address and the link.
          </p>
          <p>
            <strong>Sync is off until you turn it on</strong>, separately for each kind of data, on the{' '}
            <Link href="/account" className="font-medium text-foreground underline underline-offset-4">
              account page
            </Link>
            :
          </p>
          <ul>
            <li><strong>Starred and recent tools:</strong> tool names only.</li>
            <li>
              <strong>Tool history:</strong> for each run, the tool, time, number of files, total size, duration, and whether
              it worked (with the short failure category). File names only if you also turn on “Include file names”;
              turning that off deletes the names already stored. Never file contents.
            </li>
            <li>
              <strong>Chat with PDF conversations:</strong> your questions, the answers, the document’s file name and the
              page citations, so a chat continues on another device that opens the same file. Never the document.
            </li>
          </ul>
        </Section>

        <Section title="Your controls">
          <ul>
            <li>See and delete single history entries and conversations, or clear them all, on the history page.</li>
            <li>Download everything stored for your account as a JSON file from the account page.</li>
            <li>
              Delete your account: the account and every row stored with it are removed at once. Anonymous statistics are not
              linked to accounts, so there is nothing of yours left there.
            </li>
            <li>Sign out any device from the account page.</li>
          </ul>
        </Section>

        <Section title="Site operators">
          <p>
            The people who run this site can see the account list (email, name, dates, number of recorded runs) and the
            anonymous totals. They can disable or delete accounts and sign them out; they cannot sign in as you or read your
            password. There are no ads, no third-party scripts and no data sales.
          </p>
          <p>
            Metamorpher is open source (AGPL-3.0), so all of this can be checked in{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
              the source code
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
