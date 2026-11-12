import { renderSocialCard, socialCard } from "@/lib/social-card"

export const alt = socialCard.alt
export const size = socialCard.size
export const contentType = socialCard.contentType

// Generated from the site config when the site is built.
export default function Image() {
  return renderSocialCard()
}
