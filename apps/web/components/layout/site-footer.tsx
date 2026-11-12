import { Separator } from "@workspace/ui/components/separator"

import { ContentLink } from "@/components/content-link"
import { a11y, footer, site } from "@/config/site"

import { Container } from "./container"
import { LogoMark } from "./logo-mark"

// Links whose address is not set yet are left out, and so is a group left empty.
const groups = footer.groups
  .map((group) => ({
    ...group,
    links: group.links.filter((link) => link.href !== ""),
  }))
  .filter((group) => group.links.length > 0)

export function SiteFooter() {
  return (
    <footer className="border-t py-12 sm:py-16">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <LogoMark className="text-xl" />
            </div>
            <p className="mt-3 max-w-xs text-sm text-pretty text-muted-foreground">
              {site.tagline}
            </p>
          </div>
          {groups.map((group) => (
            <nav
              key={group.title}
              aria-label={`${a11y.footerNav}: ${group.title}`}
            >
              <h2 className="text-sm font-semibold">{group.title}</h2>
              <ul className="mt-3 flex flex-col">
                {group.links.map((link) => (
                  <li key={link.label} className="flex min-h-9 items-center">
                    <ContentLink
                      link={link}
                      className="rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <Separator className="my-8" />
        <p className="text-sm text-muted-foreground">{footer.legal}</p>
      </Container>
    </footer>
  )
}
