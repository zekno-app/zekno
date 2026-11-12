import type { MetadataRoute } from "next"

import { site } from "@/config/site"

// One entry per public page. Add new routes here as they are built.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site.url,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ]
}
