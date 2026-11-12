import { ContentLink } from "@/components/content-link"

import { why } from "../../content"
import { Section } from "../ui/section"

export function Why() {
  return (
    <Section id="why" className="border-y bg-muted/30 py-16 sm:py-20">
      <div className="reveal grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <p className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {why.statement}
        </p>
        <div className="flex flex-col gap-4 text-base text-pretty sm:text-lg">
          <p className="text-muted-foreground">{why.flaw}</p>
          <p className="font-medium">{why.answer}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="font-mono text-xs tracking-widest uppercase">
              {why.sourcesLabel}
            </span>
            {why.sources.map((source) => (
              <ContentLink
                key={source.label}
                link={source}
                className="underline underline-offset-4 hover:text-foreground"
              />
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}
