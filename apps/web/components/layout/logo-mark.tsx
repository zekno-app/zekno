import { cn } from "@workspace/ui/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("leading-0.5 font-semibold", className)}>
      zekno<span className="text-brand">.dev</span>
    </span>
  )
}
