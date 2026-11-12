import { Badge } from "@workspace/ui/components/badge"
import { Lock, LockOpen } from "lucide-react"

import { ButtonLink } from "@/components/content-link"
import { GithubIcon } from "@/components/icons/github-icon"
import { links } from "@/config/site"

import { openSource } from "../../content"
import { Section } from "../ui/section"

export function OpenSource() {
  return (
    <Section id="open-source" className="border-t">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="reveal">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {openSource.heading}
          </h2>
          <p className="mt-4 max-w-xl text-lg text-pretty text-muted-foreground">
            {openSource.body}
          </p>
          <ButtonLink
            link={links.github}
            variant="outline"
            className="mt-7 h-11 px-6 text-base"
          >
            <GithubIcon className="size-[1.125rem]" />
            {links.github.label}
          </ButtonLink>
        </div>
        <ul className="reveal rounded-xl border bg-card px-5">
          {openSource.parts.map((part) => (
            <li
              key={part.label}
              className="flex min-h-14 items-center justify-between gap-4 py-3 not-last:border-b"
            >
              <span className="font-medium">{part.label}</span>
              {part.status === "open" ? (
                <Badge variant="secondary" className="h-6 px-2.5">
                  <LockOpen aria-hidden="true" />
                  {openSource.statusLabels.open}
                </Badge>
              ) : (
                <Badge variant="outline" className="h-6 px-2.5">
                  <Lock aria-hidden="true" />
                  {openSource.statusLabels.closed}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}
