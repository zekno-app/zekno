import { ClosingCta } from "./sections/closing-cta"
import { Comparison } from "./sections/comparison"
import { Faq } from "./sections/faq"
import { FeatureBlocks } from "./sections/feature-blocks"
import { Hero } from "./sections/hero"
import { HowItWorks } from "./sections/how-it-works"
import { OpenSource } from "./sections/open-source"
import { ThreatModel } from "./sections/threat-model"
import { Why } from "./sections/why"

/**
 * Every section of the landing page, in reading order. A Server Component
 * with no request-time data; the interactive parts are client islands inside
 * the sections. Render it inside the page's `<main>`.
 */
export function LandingPage() {
  return (
    <>
      <Hero />
      <Why />
      <HowItWorks />
      <FeatureBlocks />
      <ThreatModel />
      <Comparison />
      <OpenSource />
      <Faq />
      <ClosingCta />
    </>
  )
}
