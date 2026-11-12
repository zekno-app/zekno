import { createFromSource } from "fumadocs-core/search/server"

import { source } from "@/modules/docs"

// The docs search index, built from the content folder. Used by the search dialog.
export const { GET } = createFromSource(source)
