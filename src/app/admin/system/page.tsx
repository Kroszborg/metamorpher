import { formatCount } from '@/components/admin/bits';
import { RollupButton } from '@/components/admin/rollup-button';
import { PageHeader } from '@/components/kit/page-header';
import { SectionCard } from '@/components/kit/section-card';
import { StatusBadge } from '@/components/kit/status-badge';
import { requireAdmin } from '@/server/admin';
import { system } from '@/server/admin-queries';

export const metadata = { title: 'System' };

const whenTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminSystem() {
  const { db } = await requireAdmin();
  const s = await system(db);
  const migrated = s.migrations.applied === s.migrations.expected;

  return (
    <>
      <PageHeader title="System" subtitle="Configuration and health. Secrets are never shown, only whether they are set." />
      {s.warnings.length ? (
        <SectionCard title="Warnings">
          <ul className="flex flex-col gap-2">
            {s.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm">
                <StatusBadge kind="warning" className="mt-0.5 shrink-0">
                  Warning
                </StatusBadge>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Services" contentClassName="py-2">
          <dl className="divide-y">
            <Row label="Database">
              {s.dbOk ? <StatusBadge kind="success">Connected</StatusBadge> : <StatusBadge kind="danger">Unreachable</StatusBadge>}{' '}
              <span className="text-muted-foreground">
                {s.driver} · {s.latencyMs} ms
              </span>
              {s.dbError ? <p className="mt-1 text-xs text-destructive">{s.dbError}</p> : null}
            </Row>
            <Row label="Migrations">
              {s.migrations.applied === null ? (
                <StatusBadge kind="danger">Unknown</StatusBadge>
              ) : migrated ? (
                <StatusBadge kind="success">Up to date</StatusBadge>
              ) : (
                <StatusBadge kind="warning">Pending</StatusBadge>
              )}{' '}
              <span className="text-muted-foreground">
                {s.migrations.applied ?? '?'} of {s.migrations.expected} applied (latest {s.migrations.latest})
              </span>
              {!migrated ? <p className="mt-1 text-xs text-muted-foreground">Run npm run db:migrate with DATABASE_URL set.</p> : null}
            </Row>
            <Row label="Email">
              {s.mailConfigured ? <StatusBadge kind="success">Resend</StatusBadge> : <StatusBadge kind="warning">{s.mailMode}</StatusBadge>}
            </Row>
            <Row label="Admins">{s.adminCount} in ADMIN_EMAILS</Row>
            <Row label="Last analytics rollup">
              {s.lastRollup ? (
                <>
                  {whenTime.format(s.lastRollup.at)} UTC{' '}
                  <span className="text-muted-foreground">
                    ({s.lastRollup.day}, {formatCount(s.lastRollup.events)} events)
                  </span>
                </>
              ) : (
                'Never'
              )}
              <div className="mt-2">
                <RollupButton />
              </div>
            </Row>
          </dl>
        </SectionCard>
        <SectionCard title="Stored rows" description="Rows per table. Files are never stored, so there is no file table." contentClassName="py-2">
          <dl className="grid grid-cols-2 gap-x-6">
            {s.counts.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
                <dt className="truncate font-mono text-xs text-muted-foreground">{c.name}</dt>
                <dd className="tabular-nums">{formatCount(c.rows)}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>
    </>
  );
}
