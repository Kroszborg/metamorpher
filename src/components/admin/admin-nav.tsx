'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tools', label: 'Tools' },
  { href: '/admin/audience', label: 'Audience' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/system', label: 'System' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="scroll-slim -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {LINKS.map((l) => {
          const active = l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative block px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full',
                  active ? 'text-foreground after:bg-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
