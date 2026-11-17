import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * Shared loading states for the dashboard routes (each route's loading.tsx
 * composes this). Shapes mirror the real page scaffolding — page header,
 * KPI band, card grid, data table — so content streams in without layout
 * jumps, and the shimmer follows the existing Skeleton pattern.
 */

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-44" />
      <Skeleton className="h-3.5 w-72 max-w-full" />
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

function CardSkeleton({ className, bodyClassName }: { className?: string; bodyClassName?: string }) {
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card", className)}>
      <div className="border-b px-5 py-3.5">
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="p-5">
        <Skeleton className={cn("h-40 w-full", bodyClassName)} />
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-4 border-b px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="hidden h-3 w-20 sm:block" />
        <Skeleton className="ml-auto h-3 w-14" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b px-4 py-3 last:border-0"
        >
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="hidden h-3.5 w-1/6 sm:block" />
          <Skeleton className="hidden h-3.5 w-1/5 md:block" />
          <Skeleton className="ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  )
}

function RouteSkeleton({
  kpis = 4,
  cards = 0,
  table = true,
  rows = 8,
}: {
  /** Stat tiles in the KPI band (0 hides the band). */
  kpis?: number
  /** Titled cards (charts/panels) in a responsive grid (0 hides the grid). */
  cards?: number
  /** Whether the route ends in a data table. */
  table?: boolean
  /** Skeleton row count for the table. */
  rows?: number
}) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <HeaderSkeleton />
      {kpis > 0 && (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            kpis === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4"
          )}
        >
          {Array.from({ length: kpis }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      )}
      {cards > 0 && (
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            cards === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3"
          )}
        >
          {Array.from({ length: cards }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}
      {table && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-20 rounded-full" />
            ))}
          </div>
          <TableSkeleton rows={rows} />
        </>
      )}
    </div>
  )
}

export { RouteSkeleton, HeaderSkeleton, StatCardSkeleton, CardSkeleton, TableSkeleton }
