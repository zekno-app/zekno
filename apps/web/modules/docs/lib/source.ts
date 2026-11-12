import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

import { docsRoute } from "./shared"

/** The MDX pages under `content/docs`, compiled by Fumadocs MDX. */
export const docs = defineDocs({
  dir: "content/docs",
})

/** Pages, the sidebar tree and search data, all read from the content folder. */
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
})
