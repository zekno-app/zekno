import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook"
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"

import { LogoMark } from "@/components/layout/logo-mark"
import { site } from "@/config/site"

import { source } from "./source"

/** Options shared by every Fumadocs layout: the brand, its link home and the repository. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <LogoMark className="text-lg" />,
      url: "/",
    },
    githubUrl: site.repoUrl,
    // The site is dark for every visitor, so there is nothing to switch.
    themeSwitch: { enabled: false },
  }
}

/**
 * Props for Fumadocs' notebook layout in its default mode: the brand sits at
 * the top of the sidebar, and the bar with search and links runs above the
 * article only. The page tree is read from the content folder.
 */
export function docsOptions(): Omit<DocsLayoutProps, "children"> {
  return {
    ...baseOptions(),
    tree: source.getPageTree(),
  }
}
