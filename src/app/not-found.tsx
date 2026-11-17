import Link from 'next/link';
import { MetamorpherMark } from '@/components/brand';
import { SearchHero } from '@/components/tools/search-hero';

export default function NotFound() {
  return (
    <div className="page-container flex flex-col items-center pt-16 pb-24 text-center sm:pt-24">
      <MetamorpherMark className="size-10 text-primary" />
      <p className="mt-6 font-mono text-sm text-muted-foreground">Error 404</p>
      <h1 className="mt-2 font-display text-4xl font-bold tracking-[-0.035em] sm:text-5xl">This page does not exist</h1>
      <p className="mt-4 max-w-md text-base/relaxed text-muted-foreground">
        The link may be old, or the tool may not be available yet. Search for the tool you need, or{' '}
        <Link href="/" className="font-medium text-foreground underline underline-offset-4">
          browse all tools
        </Link>
        .
      </p>
      <SearchHero className="mt-8 max-w-xl" />
    </div>
  );
}
