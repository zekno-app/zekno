import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

import { TemplateList } from "./templates"

/** Components available in every docs page without an import. `TemplateList`: the templates `zekno add` carries (content/docs/templates.mdx). */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    TemplateList,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
