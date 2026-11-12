/**
 * The docs module's interface. The routes under `app/(docs)` and the sitemap
 * use the docs through this file only. Pages are MDX files in `content/docs`.
 */
export { getMDXComponents } from "./components/mdx"
export { baseOptions, docsOptions } from "./lib/layout-options"
export { docsRoute } from "./lib/shared"
export { source } from "./lib/source"
