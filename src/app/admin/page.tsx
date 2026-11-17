import { formatCount, formatPct, KpiTile, RangePicker, rangeLabel } from '@/components/admin/bits';
import { LineChart } from '@/components/admin/line-chart';
import { PageHeader } from '@/components/kit/page-header';
import { SectionCard } from '@/components/kit/section-card';
import { parseRange, requireAdmin } from '@/server/admin';
import { overview } from '@/server/admin-queries';

export const metadata = { title: 'Overview' };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { db } = await requireAdmin();
  const range = parseRange((await searchParams).range);
  const { now, before, series } = await overview(db, range);
  const days = series.map((s) => s.day);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Anonymous usage for ${rangeLabel(range)} (UTC), compared with the period before.`}
        actions={<RangePicker path="/admin" range={range} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Visitors" value={formatCount(now.visitors)} now={now.visitors} before={before.visitors} days={range} />
        <KpiTile label="Page views" value={formatCount(now.pageviews)} now={now.pageviews} before={before.pageviews} days={range} />
        <KpiTile label="Tool runs" value={formatCount(now.runs)} now={now.runs} before={before.runs} days={range} />
        <KpiTile
          label="Success rate"
          value={formatPct(now.successRate)}
          now={now.successRate}
          before={before.successRate}
          days={range}
          isRate
        />
        <KpiTile label="Sign-ups" value={formatCount(now.signups)} now={now.signups} before={before.signups} days={range} />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Visitors are counted per day with a key that changes daily, so a person who comes back on three days counts three
        times. Success rate = succeeded / (succeeded + failed); cancelled runs are left out.
      </p>
      {range > 1 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Traffic" description="Page views and visitors per day">
            <LineChart
              title="Page views and visitors per day"
              days={days}
              series={[
                { name: 'Page views', color: 'var(--viz-2)', values: series.map((s) => s.pageviews) },
                { name: 'Visitors', color: 'var(--viz-3)', values: series.map((s) => s.visitors) },
              ]}
            />
          </SectionCard>
          <SectionCard title="Tool runs" description="Runs started per day, all tools">
            <LineChart
              title="Tool runs per day"
              days={days}
              series={[{ name: 'Runs', color: 'var(--viz-2)', values: series.map((s) => s.runs) }]}
            />
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
