import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"

/**
 * A flex toolbar row: search on the left, filter slots in the middle,
 * right-aligned actions. Purely presentational — the parent wires state.
 */
function DataToolbar({
  children,
  actions,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  actions?: React.ReactNode
}) {
  return (
    <div
      data-slot="data-toolbar"
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/**
 * A search field with a leading icon. Name-based and uncontrolled so it
 * submits as part of a parent GET `<form>`.
 */
function SearchInput({
  name = "q",
  placeholder = "Search…",
  defaultValue,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  name?: string
}) {
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={2}
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="pl-7"
        {...props}
      />
    </div>
  )
}

export { DataToolbar, SearchInput }
