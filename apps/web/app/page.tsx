import type { Metadata } from "next"

import { SiteFooter } from "@/components/layout/site-footer"
import { SiteNav } from "@/components/layout/site-nav"
import { MAIN_ID, SkipLink } from "@/components/layout/skip-link"
import { LandingPage } from "@/modules/landing"

export const metadata: Metadata = {
  alternates: { canonical: "/" },
}

// Prerendered as static content: nothing here reads request-time data.
export default function Page() {
  return (
    <>
      <SkipLink />
      <SiteNav />
      <main id={MAIN_ID}>
        <LandingPage />
      </main>
      <SiteFooter />
    </>
  )
}
