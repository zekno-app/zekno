import { cn } from "@workspace/ui/lib/utils"

import { Container } from "@/components/layout/container"

export function Section({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & { containerClassName?: string }) {
  return (
    <section className={cn("py-20 sm:py-28", className)} {...props}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  )
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-xs tracking-widest text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  className,
}: {
  eyebrow?: string
  title: string
  intro?: string
  className?: string
}) {
  return (
    <div className={cn("reveal max-w-2xl", className)}>
      {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {intro ? (
        <p className="mt-3 text-lg text-pretty text-muted-foreground">{intro}</p>
      ) : null}
    </div>
  )
}
