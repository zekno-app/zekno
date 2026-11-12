import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"

import { comparison } from "../../content"
import { type ComparisonColumn } from "../../types"
import { Section, SectionHeading } from "../ui/section"

const cell = "px-4 py-4 align-top whitespace-normal"

// Widened so every column is read as having an optional source.
const columns: ComparisonColumn[] = comparison.columns

export function Comparison() {
  return (
    <Section id="compare">
      <SectionHeading title={comparison.heading} intro={comparison.intro} />
      {/* A focusable region, so the table can be scrolled sideways by keyboard on narrow screens. */}
      <div
        role="region"
        aria-label={comparison.regionLabel}
        tabIndex={0}
        className="reveal mt-10 overflow-x-auto rounded-xl border focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <table className="w-full min-w-[46rem] table-fixed caption-bottom text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(cell, "w-[26%]")}>
                <span className="sr-only">Question</span>
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.id}
                  scope="col"
                  className={cn(
                    cell,
                    "h-auto",
                    "w-[24.66%]",
                    column.id === "zekno" ? "bg-muted/60 font-semibold" : "font-medium"
                  )}
                >
                  <span className="block">{column.label}</span>
                  {column.source ? (
                    <a
                      href={column.source}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-xs font-normal text-muted-foreground underline underline-offset-4"
                    >
                      {comparison.sourceLabel}
                    </a>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => (
              <TableRow key={row.question}>
                <th scope="row" className={cn(cell, "text-left font-medium")}>
                  {row.question}
                </th>
                <TableCell className={cn(cell, "bg-muted/60 font-medium")}>
                  {row.zekno}
                </TableCell>
                <TableCell className={cn(cell, "text-muted-foreground")}>
                  {row.managed}
                </TableCell>
                <TableCell className={cn(cell, "text-muted-foreground")}>
                  {row.scripts}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </Section>
  )
}
