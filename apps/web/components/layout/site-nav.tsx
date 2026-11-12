import { ArrowUpRight } from "lucide-react"

import { ButtonLink, ContentLink } from "@/components/content-link"
import { GithubIcon } from "@/components/icons/github-icon"
import { a11y, links, nav } from "@/config/site"
import type { Link } from "@/types/link"

import { Container } from "./container"
import { LogoMark } from "./logo-mark"
import { MobileMenu } from "./mobile-menu"

const navLinkClass =
  "rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"

const brandClass =
  "flex items-center gap-2 rounded-md text-base font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"

/** Links in the full-screen menu, in order. Each rises in after the one before. */
const menuLinks: Link[] = [...nav, links.docs]

const menuLinkClass =
  "menu-rise flex items-center justify-between gap-4 border-b py-5 text-3xl font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function riseStep(index: number) {
  return { "--rise-step": index } as React.CSSProperties
}

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
      {/* Three equal columns, so the links in the middle one sit at the centre of the page. */}
      <Container className="flex h-14 items-center gap-4">
        <div className="flex flex-1 items-center">
          <a href="#top" className={brandClass}>
            <LogoMark className="text-xl" />
          </a>
        </div>

        <nav
          aria-label={a11y.primaryNav}
          className="hidden flex-1 items-center justify-center lg:flex"
        >
          {nav.map((link) => (
            <ContentLink
              key={link.label}
              link={link}
              className={navLinkClass}
            />
          ))}
          <ContentLink link={links.docs} className={navLinkClass} />
        </nav>

        <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
          <ContentLink
            link={links.githubShort}
            className={`${navLinkClass} hidden items-center gap-1.5 sm:inline-flex`}
          >
            <GithubIcon className="size-4" />
            {links.githubShort.label}
          </ContentLink>
          <ButtonLink
            link={links.earlyAccess}
            className="hidden sm:inline-flex"
          />
          <MobileMenu
            title={a11y.menuTitle}
            openLabel={a11y.openMenu}
            closeLabel={a11y.closeMenu}
            brand={
              <a href="#top" className={brandClass}>
                <LogoMark className="text-xl" />
              </a>
            }
          >
            <nav aria-label={a11y.primaryNav} className="flex flex-col">
              {menuLinks.map((link, index) => (
                <ContentLink
                  key={link.label}
                  link={link}
                  className={menuLinkClass}
                  style={riseStep(index)}
                >
                  {link.label}
                  {link.external ? (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-6 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </ContentLink>
              ))}
            </nav>
            <div
              className="menu-rise mt-auto flex flex-col gap-3 pt-10"
              style={riseStep(menuLinks.length)}
            >
              <ButtonLink
                link={links.earlyAccess}
                className="h-12 w-full text-base"
              />
              <ButtonLink
                link={links.github}
                variant="outline"
                className="h-12 w-full text-base"
              >
                <GithubIcon className="size-[1.125rem]" />
                {links.github.label}
              </ButtonLink>
            </div>
          </MobileMenu>
        </div>
      </Container>
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px nav-edge bg-border"
      />
    </header>
  )
}
