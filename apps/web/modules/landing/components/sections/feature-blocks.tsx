import { cn } from "@workspace/ui/lib/utils"

import { Container } from "@/components/layout/container"

import { features } from "../../content"
import { type FeatureId } from "../../types"
import { LeakDemo } from "../demos/leak-demo"
import { SignatureDemo } from "../demos/signature-demo"
import { TeamComposition } from "../demos/team-composition"
import { UptimeDemo } from "../demos/uptime-demo"

const demo: Record<FeatureId, React.ReactNode> = {
  leak: <LeakDemo />,
  signature: <SignatureDemo />,
  uptime: <UptimeDemo />,
  team: <TeamComposition />,
}

export function FeatureBlocks() {
  return (
    <section id="features" className="border-t py-10 sm:py-16">
      <Container className="flex flex-col">
        {features.map((feature, index) => (
          <article
            key={feature.id}
            className={cn(
              "flex flex-col gap-8 py-10 sm:py-14 lg:flex-row lg:items-center lg:gap-16",
              index % 2 === 1 && "lg:flex-row-reverse"
            )}
          >
            <div className="reveal lg:flex-1">
              <h3 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {feature.heading}
              </h3>
              <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
                {feature.body}
              </p>
            </div>
            <div className="reveal min-w-0 lg:flex-1">{demo[feature.id]}</div>
          </article>
        ))}
      </Container>
    </section>
  )
}
