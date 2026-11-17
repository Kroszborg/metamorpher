import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { UsageStatsSwitch } from '@/components/analytics/usage-stats-switch';
import { Wordmark } from '@/components/brand';
import { AUTHOR, SOURCE_URL } from '@/lib/site';
import { buildNavGroups } from './nav-groups';

const link =
  'rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-sans text-sm font-semibold tracking-normal text-foreground">{title}</h2>
      <ul className="flex flex-col gap-2 text-sm">{children}</ul>
    </div>
  );
}

/** Site footer: categories, saved tools, and the project facts. Server-rendered, no client code. */
export function SiteFooter() {
  const groups = buildNavGroups();
  const pdf = groups.find((g) => g.id === 'pdf');
  const others = groups.filter((g) => g !== pdf).flatMap((g) => g.categories);

  return (
    <footer className="mt-auto border-t bg-card/40">
      <div className="page-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex max-w-xs flex-col gap-3">
          <Wordmark />
          <p className="text-sm/relaxed text-muted-foreground">
            File tools that run in your browser. Your files are processed on this device and never uploaded.
          </p>
        </div>
        {pdf ? (
          <Column title="PDF">
            {pdf.categories.map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.id}`} className={link}>
                  {c.title}
                </Link>
              </li>
            ))}
          </Column>
        ) : null}
        <Column title="Images, media and more">
          {others.map((c) => (
            <li key={c.id}>
              <Link href={`/category/${c.id}`} className={link}>
                {c.title}
              </Link>
            </li>
          ))}
        </Column>
        <Column title="Your tools">
          <li>
            <Link href="/starred" className={link}>
              Starred
            </Link>
          </li>
          <li>
            <Link href="/recent" className={link}>
              Recent
            </Link>
          </li>
          <li>
            <Link href="/settings/ai" className={link}>
              AI settings
            </Link>
          </li>
          <li>
            <Link href="/privacy" className={link}>
              Privacy
            </Link>
          </li>
          <li>
            <UsageStatsSwitch className="pt-1" />
          </li>
        </Column>
      </div>
      <div className="page-container">
        <div className="flex flex-col gap-2 border-t py-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className={`${link} inline-flex items-center gap-1.5 self-start`}
          >
            Source code (AGPL-3.0)
            <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} className="size-3.5" />
          </a>
          <p>
            Made by{' '}
            <a
              href={AUTHOR.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {AUTHOR.name}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
