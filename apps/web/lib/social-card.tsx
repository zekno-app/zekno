import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { site } from "@/config/site"

/**
 * The card shown when a link to the site is shared. Drawn from the site
 * config, so it follows the headline, description and stage without being
 * redrawn by hand. Used by `app/opengraph-image.tsx` and
 * `app/twitter-image.tsx`.
 */
export const socialCard = {
  alt: `${site.title}. ${site.stage}. ${site.license}.`,
  size: { width: 1200, height: 630 },
  contentType: "image/png",
} as const

// Colours of the dark theme. The renderer cannot read CSS variables.
const colors = {
  background: site.themeColor,
  foreground: "#fafafa",
  muted: "#a1a1a1",
  surface: "#262626",
  border: "rgba(255, 255, 255, 0.12)",
  brand: "#2383e2",
}

// Inter, the site's text face, from the @fontsource/inter package (OFL-1.1).
// Read once: the files do not depend on the request.
function font(weight: 400 | 600) {
  return readFile(
    join(
      process.cwd(),
      `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`
    )
  )
}
const fonts = Promise.all([font(400), font(600)])

/** The headline, one sentence per block, so a sentence never ends on a line by itself. */
const sentences = site.headline.split(/(?<=\.)\s+/)

export async function renderSocialCard() {
  const [regular, semibold] = await fonts

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 76px",
          backgroundColor: colors.background,
          color: colors.foreground,
          fontFamily: "Inter",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 44, fontWeight: 600 }}>
            <span>zekno</span>
            <span style={{ color: colors.brand }}>.dev</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "8px 22px 8px 8px",
              border: `1px solid ${colors.border}`,
              borderRadius: 999,
              backgroundColor: colors.surface,
              fontSize: 24,
            }}
          >
            <span
              style={{
                padding: "5px 16px",
                borderRadius: 999,
                backgroundColor: colors.brand,
                color: "#ffffff",
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              {site.stage}
            </span>
            <span>{site.license}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 82,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
            }}
          >
            {sentences.map((sentence) => (
              <span key={sentence}>{sentence}</span>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 26,
              maxWidth: 940,
              fontSize: 27,
              lineHeight: 1.4,
              color: colors.muted,
            }}
          >
            {site.description}
          </div>
        </div>
      </div>
    ),
    {
      ...socialCard.size,
      fonts: [
        { name: "Inter", data: regular, weight: 400, style: "normal" },
        { name: "Inter", data: semibold, weight: 600, style: "normal" },
      ],
    }
  )
}
