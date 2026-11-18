import { readScreen, type Run } from "../lib/screens"

/**
 * The colour of each look inside the frame: the terminal's colours, on its
 * own dark ground (contracts/screens.md, "The frame in the docs"). The site
 * has one colour scheme, so there is one set.
 */
const COLOURS: Record<string, string> = {
  brand: "text-[#2383e2]",
  green: "text-[#3fb950]",
  yellow: "text-[#d29922]",
  red: "text-[#f85149]",
}

/**
 * The classes of a run's look. A named colour wins; without one, dim text
 * is grey and bold text is white. Bold is drawn at weight 600, as on the
 * board `DocsFrame`.
 */
function classesOf(look: string): string | undefined {
  if (look === "") return undefined
  const names = look.split(",")
  const colour = names.map((name) => COLOURS[name]).find(Boolean)
  const classes = [
    colour ??
      (names.includes("dim")
        ? "text-[#8b949e]"
        : names.includes("bold")
          ? "text-white"
          : undefined),
    names.includes("bold") ? "font-semibold" : undefined,
  ].filter(Boolean)
  return classes.length > 0 ? classes.join(" ") : undefined
}

/**
 * A character the site's monospace font may not hold: anything outside
 * plain ASCII and outside the box-drawing and block characters. The browser
 * then takes it from another font, where it can be wider than a cell (on the
 * built site `●` came out 10px wide and `←` 17px, against a cell of 7.5px),
 * and every border after it on that row moves.
 */
const OUTSIDE = /([^\x20-\x7e\u2500-\u259f])/u

/** The site's monospace font, then the system's, so such a character still comes from a monospace font. */
const CELL_FONT =
  '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace'

/**
 * A run's text with each such character held to one cell: an inline block
 * one `ch` wide. An inline block keeps the row's text in one piece when it is
 * selected and copied, which an inline flex box does not.
 */
function cells(text: string) {
  if (!OUTSIDE.test(text)) return text
  return text.split(OUTSIDE).map((part, at) =>
    at % 2 === 1 ? (
      <span
        key={at}
        className="inline-block w-[1ch] text-center"
        style={{ fontFamily: CELL_FONT }}
      >
        {part}
      </span>
    ) : (
      part
    )
  )
}

/** One row of the screen: its runs side by side, 15px high even when empty. */
function Row({ runs }: { runs: Run[] }) {
  return (
    <div className="h-[15px]">
      {runs.map(([look, text], at) => {
        const className = classesOf(look)
        return className ? (
          <span key={at} className={className}>
            {cells(text)}
          </span>
        ) : (
          <span key={at}>{cells(text)}</span>
        )
      })}
    </div>
  )
}

/**
 * A screen of the CLI as the program drew it (specs/013-docs-refresh, the
 * board `DocsFrame`): `<Screen name="home" caption="…" />` in a page. A
 * figure with a title bar (what it shows on the left; the command, or the
 * size of a screen of the app, on the right), the screen as text that can be
 * selected and copied, and the caption under it.
 *
 * The screen is read from `content/screens/<name>.json` while the page is
 * prerendered; a name with no stored file, or an unsound one, throws with the
 * name and stops the build. It is a server component: no JavaScript reaches
 * the browser. A screen wider than the page scrolls sideways inside the
 * frame, which can be focused with the keyboard; the page itself never does.
 * Readers of a screen reader hear the description; the drawn rows are hidden
 * from them.
 */
export function Screen({ name, caption }: { name: string; caption?: string }) {
  const screen = readScreen(name)
  const size =
    screen.rows === null ? null : `${screen.columns} × ${screen.rows}`
  return (
    <figure className="not-prose my-4 max-w-full min-w-0">
      <div className="border-fd-border overflow-hidden rounded-lg border bg-[#0b0d10]">
        <div className="border-fd-border text-fd-muted-foreground flex items-center justify-between gap-4 border-b px-3.5 py-2 text-xs leading-4">
          <span className="min-w-0 truncate">{screen.title}</span>
          <span className="shrink-0 font-mono">{size ?? screen.command}</span>
        </div>
        <p className="sr-only">{screen.alt}</p>
        <div
          tabIndex={0}
          role="region"
          aria-label={`${screen.title}, the screen as text`}
          className="fd-scroll-container focus-visible:ring-fd-ring overflow-x-auto px-[18px] py-3.5 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          <div
            aria-hidden="true"
            className="w-max min-w-full font-mono text-[12.5px] leading-[15px] whitespace-pre text-[#d7dde4]"
          >
            {screen.lines.map((runs, at) => (
              <Row key={at} runs={runs} />
            ))}
          </div>
        </div>
      </div>
      {caption ? (
        <figcaption className="text-fd-muted-foreground mt-2 text-[13px] leading-5">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
