import { a11y } from "@/config/site"

/** The id the page's `<main>` must carry for the skip link to reach it. */
export const MAIN_ID = "main"

/** First stop for keyboard users: jumps past the top bar to the page content. */
export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only rounded-md bg-background px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:ring-3 focus:ring-ring/50 focus:outline-none"
    >
      {a11y.skipToContent}
    </a>
  )
}
