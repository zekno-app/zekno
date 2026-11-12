import { cn } from "@workspace/ui/lib/utils"

/** Fixed-height frame for a feature demonstration, so nothing shifts while it plays. */
export function DemoFrame({
  label,
  className,
  children,
  ref,
}: {
  /** Text alternative for the whole demonstration. */
  label: string
  className?: string
  children: React.ReactNode
  ref?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className={cn(
        "relative flex h-80 w-full flex-col overflow-hidden rounded-2xl border bg-card p-4 sm:p-6",
        className
      )}
    >
      {children}
    </div>
  )
}
