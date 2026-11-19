/**
 * Site-wide facts: identity, destinations, navigation and the labels the
 * shared chrome needs. Anything specific to one page lives in that page's
 * module.
 */
import type { Link } from "@/types/link"

const repoUrl = "https://github.com/zekno-app/zekno"

/**
 * Addresses that are not decided yet. Fill each one in here and nothing else
 * needs to change. While one is empty, a button that uses it stays on the
 * page without navigating, and a footer link that uses it is hidden.
 */
const earlyAccessFormUrl = "" // the sign-up form behind every "Get early access" button
const contactUrl = "/contact" // a page, or "mailto:..."
const privacyUrl = "/privacy"
const termsUrl = "/terms"

/**
 * Public sources for what the site says about other companies. Each incident
 * link is the company's own report.
 */
export const sources = {
  /** Zeabur, preliminary report, published 19 October 2026 (attack on 14 and 15 October). */
  zeaburIncident: "https://zeabur.com/blogs/october-2026-security-incident",
  /** Railway, full incident report, published 10 November 2026 (attack on 20 and 21 October). */
  railwayIncident:
    "https://blog.railway.com/p/incident-report-october-security-incident",
  /** Northflank, status page for the incident that began on 30 October 2026. */
  northflankIncident: "https://status.northflank.com/cmvv0rn5a092f14rutwccodpp",
  /** Railway's report describes how the platform itself holds the key that decrypts variables. */
  railwayComparison:
    "https://blog.railway.com/p/incident-report-october-security-incident",
  /** Kamal reads secrets from files in the project and keeps them in a file on the host. */
  kamalComparison:
    "https://kamal-deploy.org/docs/configuration/environment-variables/",
} as const

export const site = {
  name: "Zekno",
  /** The line the landing page and the social card lead with. */
  headline: "Deploy to your own infrastructure. Keep every key.",
  /** How far along the product is, and how it is licensed. Shown wherever the site invites sign-up. */
  stage: "Pre-alpha",
  license: "Open source (MIT)",
  tagline:
    "Deploy to your own servers through a service that can't read your secrets.",
  title: "Zekno: deploy to your own infrastructure, keep every key",
  description:
    "Push-button deploys, roles and deploy history on servers you own. Secrets are encrypted and deploys are signed on your machine, so the Zekno service never holds a key.",
  repoUrl,
  /** The address the site is served from. Used for canonical links, the sitemap and social cards. */
  url: "https://zekno.dev",
  locale: "en_US",
  keywords: [
    "deployment platform",
    "deploy to your own servers",
    "self-hosted deploys",
    "encrypted secrets",
    "signed deploys",
    "Docker Compose",
    "open source",
  ],
  /** The page background in the dark theme, for the browser's own chrome. */
  themeColor: "#0a0a0a",
} as const

export const links = {
  earlyAccess: {
    label: "Get early access",
    href: earlyAccessFormUrl,
    external: true,
  },
  github: { label: "View on GitHub", href: repoUrl, external: true },
  githubShort: { label: "GitHub", href: repoUrl, external: true },
  docs: { label: "Docs", href: "/docs" },
  roadmap: { label: "Roadmap", href: `${repoUrl}#roadmap`, external: true },
  license: {
    label: "License",
    href: `${repoUrl}/blob/main/LICENSE`,
    external: true,
  },
  reportVulnerability: {
    label: "Report a vulnerability",
    href: `${repoUrl}#reporting-a-vulnerability`,
    external: true,
  },
  contact: { label: "Contact", href: contactUrl },
  privacy: { label: "Privacy", href: privacyUrl },
  terms: { label: "Terms", href: termsUrl },
} satisfies Record<string, Link>

export const nav: Link[] = [
  { label: "How it works", href: "#how" },
  { label: "Security", href: "#security" },
  { label: "Open source", href: "#open-source" },
  { label: "FAQ", href: "#faq" },
]

export const footer = {
  groups: [
    {
      title: "Product",
      links: [
        { label: "How it works", href: "#how" },
        { label: "Security model", href: "#security" },
        links.roadmap,
        links.docs,
      ],
    },
    {
      title: "Open source",
      links: [links.githubShort, links.license, links.reportVulnerability],
    },
    {
      title: "Company",
      links: [links.contact, links.privacy, links.terms],
    },
  ] satisfies { title: string; links: Link[] }[],
  legal: "© 2026 Zekno. Code in the public repository is MIT licensed.",
}

/** Labels for assistive technology used by the shared chrome and links. */
export const a11y = {
  skipToContent: "Skip to content",
  openMenu: "Open menu",
  closeMenu: "Close menu",
  menuTitle: "Menu",
  primaryNav: "Primary",
  footerNav: "Footer",
  newTab: "(opens in a new tab)",
  unresolved: "Not available yet",
} as const
