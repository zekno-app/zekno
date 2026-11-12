import { ArrowRight } from "lucide-react"

import { ButtonLink } from "@/components/content-link"
import { GithubIcon } from "@/components/icons/github-icon"
import { links } from "@/config/site"

import { closing } from "../../content"
import { Section } from "../ui/section"

export function ClosingCta() {
  return (
    <Section id="early-access" className="py-16 sm:py-20">
      <div className="reveal flex flex-col items-center rounded-3xl border bg-card px-6 py-14 text-center sm:px-10 sm:py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          {closing.heading}
        </h2>
        <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
          {closing.body}
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
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
      </div>
    </Section>
  )
}
