/**
 * What the hosted service, when it exists, will read (specs/014-deploy-v2,
 * User Story 7, FR-051 and FR-052; design/lines.md M1 and M2 in the form the
 * board `Deploy2Refusals` draws, research R25). The README's note under "What
 * Zekno does not protect against" and the callout "Metadata" of the docs'
 * security page hold the maintainer's approved words: two leads and seven
 * items, in order. The words are compared without their bold marks, so an edit
 * that changes a word, drops an item or adds one fails here and names the
 * place. Nothing here starts a process.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8")

const README = "README.md"
const README_HEADING = "### What Zekno does not protect against"
const SECURITY_PAGE = "apps/web/content/docs/security.mdx"
const CALLOUT = '<Callout title="Metadata">'

/** One part of the note: a lead, or an item of the list under it. */
type Part = { kind: "lead" | "item"; text: string }

const lead = (text: string): Part => ({ kind: "lead", text })
const item = (text: string): Part => ({ kind: "item", text })

/** The approved note, as the board draws it: its two leads and its seven items, in order. */
const APPROVED: Part[] = [
  lead(
    "The control plane, when it exists, will never see a secret's value. It will see:"
  ),
  item("Server addresses and team membership"),
  item("App names, deploy numbers and times"),
  item(
    "Each deploy's Compose text with its plain variables, and image names with their digests"
  ),
  item("Each secret's name, version, size and who set it"),
  lead(
    "With domains, building from source and health checks, it will also see:"
  ),
  item("Domains"),
  item(
    "Build recipes and their arguments, pre-deploy commands, health-check paths"
  ),
  item(
    "The size and fingerprint of each source pack: enough to confirm a guess of the exact source (a public repository at a known commit), not to read it"
  ),
]

/** The words of a part as they show: its lines joined by spaces, without bold marks. */
const words = (text: string): string =>
  text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim()

/**
 * The parts of a short markdown text: a line `- ` starts an item, any other
 * line after a blank one starts a lead, and every other line continues the
 * part above it, as markdown reads a paragraph and a list item.
 */
function partsOf(markdown: string): Part[] {
  const parts: Part[] = []
  let open: Part | undefined
  for (const line of markdown.split("\n")) {
    if (line.trim() === "") {
      open = undefined
      continue
    }
    const listed = /^- (.*)$/.exec(line)
    if (listed !== null) {
      open = item(listed[1]!)
      parts.push(open)
    } else if (open !== undefined) open.text += `\n${line}`
    else {
      open = lead(line)
      parts.push(open)
    }
  }
  return parts.map(({ kind, text }) => ({ kind, text: words(text) }))
}

/** The README's `> [!NOTE]` under its heading, without the quote marks, or undefined when there is none. */
function readmeNote(): string | undefined {
  const lines = read(README).split("\n")
  const heading = lines.indexOf(README_HEADING)
  if (heading === -1) return undefined
  const next = lines.findIndex(
    (line, index) => index > heading && /^#{1,6} /.test(line)
  )
  const section = lines.slice(heading + 1, next === -1 ? undefined : next)
  const start = section.indexOf("> [!NOTE]")
  if (start === -1) return undefined
  const quoted: string[] = []
  for (const line of section.slice(start + 1)) {
    if (!line.startsWith(">")) break
    quoted.push(line.replace(/^> ?/, ""))
  }
  return quoted.join("\n")
}

/** The text inside the security page's callout "Metadata", its common indent taken off, or undefined when there is none. */
function securityCallout(): string | undefined {
  const lines = read(SECURITY_PAGE).split("\n")
  const start = lines.indexOf(CALLOUT)
  if (start === -1) return undefined
  const end = lines.indexOf("</Callout>", start)
  if (end === -1) return undefined
  const body = lines.slice(start + 1, end)
  const indent = Math.min(
    ...body
      .filter((line) => line.trim() !== "")
      .map((line) => /^ */.exec(line)![0].length)
  )
  return body.map((line) => line.slice(indent)).join("\n")
}

/** How a part is named in a message: `lead 2`, `item 5`, counted as the approved note counts them. */
function placeOf(index: number): string {
  const part = APPROVED[index]
  if (part === undefined) return `part ${index + 1}`
  const count = APPROVED.slice(0, index + 1).filter(
    ({ kind }) => kind === part.kind
  ).length
  return `${part.kind} ${count}`
}

/** Each way a place's note differs from the approved words, part by part. */
function drift(place: string, found: Part[]): string[] {
  const problems: string[] = []
  const parts = Math.max(found.length, APPROVED.length)
  for (let index = 0; index < parts; index++) {
    const want = APPROVED[index]
    const has = found[index]
    if (want !== undefined && has !== undefined) {
      if (want.kind !== has.kind || want.text !== has.text)
        problems.push(
          `${place}, ${placeOf(index)}: it has the ${has.kind} "${has.text}", the approved words are the ${want.kind} "${want.text}"`
        )
    } else if (want !== undefined)
      problems.push(
        `${place} has no ${placeOf(index)}; the approved words are "${want.text}"`
      )
    else if (has !== undefined)
      problems.push(
        `${place} has a ${has.kind} the approved note does not: "${has.text}"`
      )
  }
  return problems
}

describe("the note on what the hosted service will read (M1, M2)", () => {
  test(`${README}: the \`> [!NOTE]\` under "What Zekno does not protect against" holds the approved words`, () => {
    const place = `${README}, the note under "What Zekno does not protect against"`
    const note = readmeNote()
    expect(
      note === undefined
        ? [`${README} has no \`> [!NOTE]\` under "${README_HEADING}"`]
        : drift(place, partsOf(note))
    ).toEqual([])
  })

  test(`${SECURITY_PAGE}: the callout "Metadata" holds the approved words`, () => {
    const place = `${SECURITY_PAGE}, the callout "Metadata"`
    const note = securityCallout()
    expect(
      note === undefined
        ? [`${SECURITY_PAGE} has no ${CALLOUT} closed by </Callout>`]
        : drift(place, partsOf(note))
    ).toEqual([])
  })
})
