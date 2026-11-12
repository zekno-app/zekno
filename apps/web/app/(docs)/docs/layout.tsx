import { DocsLayout } from "fumadocs-ui/layouts/notebook"

import { docsOptions } from "@/modules/docs"

export default function Layout({ children }: LayoutProps<"/docs">) {
  return <DocsLayout {...docsOptions()}>{children}</DocsLayout>
}
