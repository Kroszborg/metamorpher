import { GithubIcon, SquareLock02Icon, UserBlock01Icon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import Link from 'next/link';
import { HomeSavedTools } from '@/components/tools/saved-tools';
import { SearchHero } from '@/components/tools/search-hero';
import { ToolIcon } from '@/components/tools/tool-card';
import { CategorySections } from '@/components/tools/tool-grid';
import { SOURCE_URL } from '@/lib/site';
import { AVAILABLE_TOOLS, getAvailableTool } from '@/tools/registry';

/** The most common jobs, with short labels. Missing or unshipped slugs are skipped. */
const QUICK_PICKS: [slug: string, label: string][] = [
  ['merge-pdf', 'Merge PDF'],
  ['compress-pdf', 'Compress PDF'],
  ['convert-image', 'Convert image'],
  ['pdf-to-word', 'PDF to Word'],
  ['ocr-pdf', 'OCR'],
  ['convert-video', 'Convert video'],
  ['remove-background', 'Remove background'],
];

const FACTS: { icon: IconSvgElement; title: string; body: React.ReactNode }[] = [
  {
    icon: SquareLock02Icon,
    title: 'Runs on this device',
    body: 'Files are processed in your browser and never uploaded.',
  },
  {
    icon: GithubIcon,
    title: 'Open source',
    body: (
      <>
        AGPL-3.0.{' '}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
        >
          Read the code
        </a>
      </>
    ),
  },
  { icon: UserBlock01Icon, title: 'No account', body: 'Nothing to sign up for. Open a tool and use it.' },
  {
    icon: WifiDisconnected01Icon,
    title: 'Works offline',
    body: 'Tools you have used keep working without a connection.',
  },
];

export default function Home() {
  const picks = QUICK_PICKS.flatMap(([slug, label]) => {
    const tool = getAvailableTool(slug);
    return tool ? [{ tool, label }] : [];
  });

  return (
    <div className="flex flex-col">
      <section
        aria-labelledby="hero-title"
        className="page-container flex flex-col items-center pt-14 pb-12 text-center sm:pt-24 sm:pb-16"
      >
        <h1
          id="hero-title"
          className="max-w-4xl font-display text-[2.6rem] leading-[0.98] font-bold tracking-[-0.045em] sm:text-6xl lg:text-[4.75rem]"
        >
          Every file tool. <span className="whitespace-nowrap">Nothing uploaded.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base/relaxed text-muted-foreground sm:text-lg/relaxed">
          {AVAILABLE_TOOLS.length} tools for PDFs, images, audio, video and documents. They run in your browser, so your
          files stay on this device.
        </p>

        <SearchHero className="mt-9 max-w-2xl sm:mt-10" />

        <ul aria-label="Popular tools" className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
          {picks.map(({ tool, label }) => (
            <li key={tool.slug}>
              <Link
                href={`/tools/${tool.slug}`}
                className="flex items-center gap-2 rounded-full border bg-card/60 py-1 pr-3.5 pl-1 text-sm font-medium outline-none transition-colors hover:border-input hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ToolIcon tool={tool} className="size-7 rounded-full [&_svg]:size-3.5" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="page-container">
        <ul
          aria-label="How Metamorpher works"
          className="grid grid-cols-2 gap-x-4 gap-y-4 border-y py-5 sm:gap-x-8 sm:gap-y-5 sm:py-6 lg:grid-cols-4"
        >
          {FACTS.map((f) => (
            <li key={f.title} className="flex gap-2.5 sm:gap-3">
              <HugeiconsIcon icon={f.icon} strokeWidth={2} className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="mt-0.5 text-sm/snug text-muted-foreground max-sm:hidden">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="page-container flex flex-col gap-12 pt-10 pb-20 sm:pt-12">
        <HomeSavedTools />
        <CategorySections />
      </div>
    </div>
  );
}
