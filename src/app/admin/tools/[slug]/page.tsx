import { notFound } from 'next/navigation';
import { formatCount, formatMs, formatPct, KpiTile, RangePicker, RankedBars, rangeLabel } from '@/components/admin/bits';
import { LineChart } from '@/components/admin/line-chart';
import { PageHeader } from '@/components/kit/page-header';
import { SectionCard } from '@/components/kit/section-card';
import { Breadcrumb } from '@/components/layout/breadcrumb';
import { parseRange, requireAdmin } from '@/server/admin';
import { toolsTable, toolTrend } from '@/server/admin-queries';
import { getAvailableTool } from '@/tools/registry';

export default async function AdminTool({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { db } = await requireAdmin();
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) notFound();
  const range = parseRange((await searchParams).range);
  const [[row], trend] = await Promise.all([toolsTable(db, range, slug), toolTrend(db, slug, Math.max(range, 7))]);
  const title = getAvailableTool(slug)?.title ?? slug;

  return (
    <>
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: 'Tools', href: `/admin/tools?range=${range}` }]} />}
        title={title}
        subtitle={`Usage for ${rangeLabel(range)}.`}
        actions={<RangePicker path={`/admin/tools/${slug}`} range={range} />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Opens" value={formatCount(row?.opens ?? 0)} now={null} before={null} days={range} />
        <KpiTile label="Runs" value={formatCount(row?.runs ?? 0)} now={null} before={null} days={range} />
        <KpiTile label="Success rate" value={formatPct(row?.successRate ?? null)} now={null} before={null} days={range} />
        <KpiTile label="Median time" value={formatMs(row?.medianMs ?? null)} now={null} before={null} days={range} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard title="Trend" description={`Per day, ${range === 1 ? 'last 7 days' : rangeLabel(range)}`}>
          <LineChart
            title={`${title}: opens and runs per day`}
            days={trend.map((t) => t.day)}
            series={[
              { name: 'Opens', color: 'var(--viz-2)', values: trend.map((t) => t.opens) },
              { name: 'Runs', color: 'var(--viz-3)', values: trend.map((t) => t.runs) },
            ]}
          />
        </SectionCard>
        <SectionCard title="Failures by error code" description={`${formatCount(row?.failed ?? 0)} failed, ${formatCount(row?.cancelled ?? 0)} cancelled`}>
          <RankedBars
            rows={(row?.errors ?? []).map((e) => ({ label: e.code.replace(/_/g, ' '), value: e.count }))}
            empty="No failures in this period."
            unit="failures"
          />
        </SectionCard>
      </div>
    </>
  );
}
