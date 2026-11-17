import Link from 'next/link';
import { formatCount, formatMs, formatPct, RangePicker, rangeLabel } from '@/components/admin/bits';
import { PageHeader } from '@/components/kit/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { parseRange, requireAdmin } from '@/server/admin';
import { toolsTable } from '@/server/admin-queries';
import { getAvailableTool } from '@/tools/registry';

export const metadata = { title: 'Tools' };

export default async function AdminTools({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { db } = await requireAdmin();
  const range = parseRange((await searchParams).range);
  const rows = await toolsTable(db, range);

  return (
    <>
      <PageHeader
        title="Tools"
        subtitle={`Opens, runs and outcomes per tool for ${rangeLabel(range)}. Select a tool for its trend.`}
        actions={<RangePicker path="/admin/tools" range={range} />}
      />
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead className="text-right">Opens</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Median time</TableHead>
              <TableHead>Failures by error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No tool activity in this period.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.tool}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/tools/${r.tool}?range=${range}`} className="underline-offset-4 hover:underline">
                      {getAvailableTool(r.tool)?.title ?? r.tool}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(r.opens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(r.runs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(r.successRate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMs(r.medianMs)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.errors.length
                      ? r.errors
                          .slice(0, 3)
                          .map((e) => `${e.code.replace(/_/g, ' ')} ${e.count}`)
                          .join(' · ')
                      : '–'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Median time is estimated from a duration histogram of successful runs. Error codes are short categories (for example
        “invalid input”), never messages or file details.
      </p>
    </>
  );
}
