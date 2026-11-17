import Link from 'next/link';
import { formatCount } from '@/components/admin/bits';
import { UserActions } from '@/components/admin/user-actions';
import { SearchInput } from '@/components/kit/data-toolbar';
import { PageHeader } from '@/components/kit/page-header';
import { StatusBadge } from '@/components/kit/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireAdmin } from '@/server/admin';
import { users } from '@/server/admin-queries';

export const metadata = { title: 'Users' };

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const whenTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { db, viewer } = await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 100);
  const page = Math.max(0, Math.min(1000, Number(sp.page) || 0));
  const data = await users(db, q, page);
  const link = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Users" subtitle={`${formatCount(data.total)} ${q ? 'matching' : 'total'} accounts. Times are UTC.`} />
      <form action="/admin/users" className="flex gap-2">
        <SearchInput name="q" defaultValue={q} placeholder="Search email or name…" className="sm:max-w-sm" aria-label="Search users" />
        <Button type="submit" variant="outline" size="lg">
          Search
        </Button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No accounts found.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{u.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.name}
                      {u.admin ? ' · admin' : ''}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      {u.disabled ? <StatusBadge kind="danger">Disabled</StatusBadge> : <StatusBadge kind="success">Active</StatusBadge>}
                      {u.emailVerified ? (
                        <StatusBadge kind="neutral">Verified</StatusBadge>
                      ) : (
                        <StatusBadge kind="warning">Unverified</StatusBadge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{when.format(u.createdAt)}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{u.lastSeenAt ? whenTime.format(u.lastSeenAt) : '–'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(u.runs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.sessions}</TableCell>
                  <TableCell className="text-right">
                    <UserActions id={u.id} email={u.email} disabled={u.disabled} self={u.id === viewer.id} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex gap-2">
        {page > 0 ? (
          <Button asChild variant="outline" size="lg">
            <Link href={link(page - 1)}>Newer</Link>
          </Button>
        ) : null}
        {data.more ? (
          <Button asChild variant="outline" size="lg">
            <Link href={link(page + 1)}>Older</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Runs counts only users who switched history on. There is no way to sign in as another user.
      </p>
    </>
  );
}
