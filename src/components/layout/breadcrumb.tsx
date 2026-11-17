import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { Fragment } from 'react';

export type Crumb = { label: string; href: string };

/**
 * Trail of parent pages above a page title. On small screens only the nearest
 * parent shows, as a back link.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  const parent = items.at(-1);
  if (!parent) return null;
  const link =
    'rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <Link href={parent.href} className={`${link} inline-flex items-center gap-1 sm:hidden`}>
        <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} className="size-4" />
        {parent.label}
      </Link>
      <ol className="hidden items-center gap-1.5 sm:flex">
        {items.map((c, i) => (
          <Fragment key={c.href}>
            {i > 0 ? (
              <li aria-hidden className="text-faint">
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3.5" />
              </li>
            ) : null}
            <li>
              <Link href={c.href} className={link}>
                {c.label}
              </Link>
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
