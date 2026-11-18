import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

import { Screen } from "./screen"
import { TemplateList } from "./templates"

/**
 * Components available in every docs page without an import. `TemplateList`:
 * the templates `zekno add` carries (content/docs/templates.mdx). `Screen`: a
 * stored screen of the CLI in its frame (`<Screen name="home" />`).
 */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    TemplateList,
    Screen,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
