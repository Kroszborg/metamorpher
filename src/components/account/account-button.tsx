'use client';

import {
  Clock01Icon,
  DashboardSquare01Icon,
  Logout03Icon,
  UserCircleIcon,
  UserIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACCOUNTS_ENABLED } from '@/lib/account/flags';
import { useAccountHint } from '@/lib/account/hint';
import { signOut } from '@/lib/account/session';

/**
 * Top-bar account control. Rendered on the client only (the slot is empty in
 * the static HTML), from a local hint, so it costs signed-out visitors no
 * request. Hidden when this deployment has no accounts.
 */
export function AccountButton() {
  const hint = useAccountHint();
  const router = useRouter();
  if (!ACCOUNTS_ENABLED || hint === undefined) return null;

  if (!hint) {
    return (
      <Link
        href="/sign-in"
        aria-label="Sign in"
        className="grid h-9 place-items-center rounded-lg px-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:px-3"
      >
        <HugeiconsIcon icon={UserCircleIcon} strokeWidth={2} className="size-[1.1rem] sm:hidden" />
        <span className="hidden sm:inline">Sign in</span>
      </Link>
    );
  }

  const item = 'min-h-8 gap-2.5 px-2.5 text-sm';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${hint.name}`}
        className="ml-0.5 grid size-8 place-items-center rounded-full bg-primary font-display text-sm font-semibold text-primary-foreground outline-none ring-offset-2 ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {hint.initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="truncate px-2.5 text-sm font-medium text-foreground">{hint.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={item}>
          <Link href="/account">
            <HugeiconsIcon icon={UserIcon} strokeWidth={2} />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={item}>
          <Link href="/history">
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} />
            History
          </Link>
        </DropdownMenuItem>
        {hint.admin ? (
          <DropdownMenuItem asChild className={item}>
            <Link href="/admin">
              <HugeiconsIcon icon={DashboardSquare01Icon} strokeWidth={2} />
              Admin
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={item}
          onSelect={async () => {
            await signOut();
            router.push('/');
          }}
        >
          <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
