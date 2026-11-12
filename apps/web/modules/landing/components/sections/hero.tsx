import { Badge } from "@workspace/ui/components/badge"
import { ArrowRight } from "lucide-react"

import { ButtonLink } from "@/components/content-link"
import { GithubIcon } from "@/components/icons/github-icon"
import { Container } from "@/components/layout/container"
import { links } from "@/config/site"

import { hero } from "../../content"
import { ProtocolStage } from "../demos/protocol-stage"

function step(index: number) {
  return { "--rise-step": index } as React.CSSProperties
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-14 pb-16 sm:pt-20 sm:pb-24">
      {/* Decorative dot grid, drawn from the border token and faded out downward. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-[radial-gradient(circle_at_center,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_top,black,transparent_70%)] bg-size-[24px_24px]"
      />
      <Container className="flex flex-col items-center text-center">
        <p
          className="rise inline-flex items-center gap-2 rounded-full border border-border bg-muted py-1 pr-3.5 pl-1 text-xs whitespace-nowrap text-foreground min-[360px]:text-sm"
          style={step(0)}
        >
          <Badge className="bg-info text-info-foreground">
            {hero.announcement.badge}
          </Badge>
          {hero.announcement.text}
        </p>
        <h1
          className="rise mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
          style={step(1)}
        >
          {hero.headline}
        </h1>
        <p
          className="rise mt-6 max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl"
          style={step(2)}
        >
          {hero.body}
        </p>
        <div
          className="rise mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
          style={step(3)}
        >
          <ButtonLink link={links.earlyAccess} className="h-11 px-6 text-base">
            {links.earlyAccess.label}
            <ArrowRight />
          </ButtonLink>
          <ButtonLink
            link={links.github}
            variant="outline"
            className="h-11 px-6 text-base"
          >
            <GithubIcon className="size-[1.125rem]" />
            {links.github.label}
          </ButtonLink>
        </div>
        <p className="rise mt-5 text-sm text-muted-foreground" style={step(4)}>
          {hero.status}
        </p>
        <div className="rise mt-12 w-full sm:mt-16" style={step(5)}>
          <ProtocolStage />
        </div>
      </Container>
    </section>
  )
}
