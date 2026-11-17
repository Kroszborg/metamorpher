import { RangePicker, RankedBars, rangeLabel } from '@/components/admin/bits';
import { PageHeader } from '@/components/kit/page-header';
import { SectionCard } from '@/components/kit/section-card';
import { parseRange, requireAdmin } from '@/server/admin';
import { audience } from '@/server/admin-queries';

export const metadata = { title: 'Audience' };

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const country = (code: string) => {
  if (!code) return 'Unknown';
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

export default async function AdminAudience({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { db } = await requireAdmin();
  const range = parseRange((await searchParams).range);
  const a = await audience(db, range);
  const rows = (list: { key: string; views: number }[], map: (k: string) => string = (k) => k) =>
    list.map((r) => ({ label: map(r.key), value: r.views }));

  return (
    <>
      <PageHeader
        title="Audience"
        subtitle={`Page views by coarse browser, system, device class, country and referring site for ${rangeLabel(range)}. Raw user-agent strings and IP addresses are never stored.`}
        actions={<RangePicker path="/admin/audience" range={range} />}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Browsers">
          <RankedBars rows={rows(a.browser)} />
        </SectionCard>
        <SectionCard title="Operating systems">
          <RankedBars rows={rows(a.os)} />
        </SectionCard>
        <SectionCard title="Device class">
          <RankedBars rows={rows(a.device, (k) => k.charAt(0).toUpperCase() + k.slice(1))} />
        </SectionCard>
        <SectionCard title="Countries" description="Only when the host provides a country (Vercel)">
          <RankedBars rows={rows(a.country, country)} />
        </SectionCard>
        <SectionCard title="Referrers" description="Site names only, never full URLs">
          <RankedBars rows={rows(a.referrer)} empty="No referrals in this period." />
        </SectionCard>
        <SectionCard title="Top pages">
          <RankedBars rows={rows(a.page)} />
        </SectionCard>
      </div>
    </>
  );
}
