import type { MetadataRoute } from "next"

import { site } from "@/config/site"
import { source } from "@/modules/docs"

// The home page, then every docs page. Add other routes here as they are built.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    { url: site.url, lastModified, changeFrequency: "weekly", priority: 1 },
    ...source.getPages().map((page) => ({
      url: `${site.url}${page.url}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ]
}
