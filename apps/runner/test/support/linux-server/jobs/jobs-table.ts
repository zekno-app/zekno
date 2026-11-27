/**
 * Reads quickstart.md, "The jobs" (specs/016-build-from-source, T009), for
 * jobs.test.ts, which holds `jobs.ts` to it: the table row by row, read into
 * what `jobs.ts` holds, and the notes below it. It knows the phrases the
 * table uses and throws on any other, so a changed row fails the test rather
 * than being read wrong.
 */
import { CHECK_IDS, type CheckId } from "./modes"
import { ENGINE_NAMES, type EngineName, type Pins } from "../pins"
import { STORES, type Store } from "../stand-in/plan"

export const HEADING = "## The jobs"
const HEADER = ["Job", "Stand-in", "Runs", "Time limit"]

/** The store of a row that names none: what a fresh engine's data folder gets (plan.ts, DAEMON_JSON). */
export const DEFAULT_STORE: Store = "containerd"

export type Section = {
  /** The lines between the heading and the table. */
  readonly intro: string
  readonly rows: readonly (readonly string[])[]
  /** The notes below the table, without their `- `. */
  readonly bullets: readonly string[]
}

export type TableLeg = {
  readonly engine: EngineName
  readonly store: Store
  readonly memory: boolean
}

export type Reading = {
  readonly job: string
  /** The plan's item a row names, `item 4`. */
  readonly item: string | undefined
  readonly runsOn: "ubuntu-24.04" | "ubuntu-24.04-arm" | "macos"
  /** The row names an engine or store list: one GitHub job per leg. */
  readonly matrix: boolean
  readonly legs: readonly TableLeg[]
  readonly ids: readonly CheckId[]
  /** On these engines only the ids given run. */
  readonly only: Readonly<Partial<Record<EngineName, readonly CheckId[]>>>
  /** What the Runs cell says in parentheses. */
  readonly asides: readonly string[]
  /** The items of the Runs cell that name no check. */
  readonly loose: readonly string[]
  readonly runs: string
  readonly minutes: number
}

function fail(what: string): never {
  throw new Error(`quickstart.md, "The jobs": ${what}`)
}

/** The table and the lines around it, from the heading to the next one. */
export function jobsSection(markdown: string): Section {
  const start = markdown.indexOf(`\n${HEADING}\n`)
  if (start < 0) fail("the heading is not there")
  const rest = markdown.slice(start + HEADING.length + 2)
  const end = rest.indexOf("\n## ")
  const lines = (end < 0 ? rest : rest.slice(0, end)).split("\n")
  const table = lines.filter((line) => line.startsWith("|"))
  const cells = (line: string) => {
    if (!line.endsWith("|")) fail(`the line ${line} does not end with |`)
    return line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim())
  }
  if (table.length < 3) fail("there is no table")
  if (cells(table[0]!).join("|") !== HEADER.join("|"))
    fail(`the table's columns are not ${HEADER.join(", ")}`)
  const first = lines.indexOf(table[0]!)
  return {
    intro: lines
      .slice(0, first)
      .filter((line) => line !== "")
      .join("\n"),
    rows: table.slice(2).map(cells),
    bullets: lines
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  }
}

const isCheckId = (value: string): value is CheckId =>
  (CHECK_IDS as readonly string[]).includes(value)

function checkId(value: string): CheckId {
  if (!isCheckId(value)) fail(`${value} is no check of modes.ts`)
  return value
}

const inOrder = (ids: Iterable<CheckId>) =>
  CHECK_IDS.filter((id) => new Set(ids).has(id))

/** The checks a text names: `L2 to L5` is L2, L3, L4 and L5; `L4b` is its own. */
export function idsIn(text: string): CheckId[] {
  const found: CheckId[] = []
  const rest = text.replace(
    /\b([LRB])(\d+) to ([LRB])(\d+)\b/g,
    (_, kind: string, from: string, to: string, last: string) => {
      if (to !== kind || Number(last) <= Number(from))
        fail(`${kind}${from} to ${to}${last} is not a range`)
      for (let at = Number(from); at <= Number(last); at++)
        found.push(checkId(`${kind}${at}`))
      return " "
    }
  )
  for (const match of rest.matchAll(/\b[LRB]\d+b?\b/g))
    found.push(checkId(match[0]))
  return inOrder(found)
}

/** `L2, L8 and L18`: the ids of a list, and nothing else. */
function listIds(text: string): CheckId[] {
  return inOrder(text.split(/, | and /).map(checkId))
}

/** Splits at `,` and `;` outside parentheses. */
function items(text: string): string[] {
  const found: string[] = []
  let depth = 0
  let item = ""
  for (const char of text) {
    if (char === "(") depth++
    if (char === ")") depth--
    if (depth === 0 && (char === "," || char === ";")) {
      found.push(item.trim())
      item = ""
    } else item += char
  }
  found.push(item.trim())
  return found.filter((part) => part !== "")
}

function asidesOf(text: string): { asides: string[]; stripped: string } {
  const asides: string[] = []
  const stripped = text.replace(/ ?\(([^()]*)\)/g, (_, aside: string) => {
    asides.push(aside)
    return ""
  })
  if (/[()]/.test(stripped)) fail(`the parentheses of ${text} do not pair`)
  return { asides, stripped }
}

type Matrix = {
  item: string | undefined
  engines?: EngineName[]
  stores?: Store[]
}

function readName(cell: string): { job: string } & Matrix {
  const parts = /^`([a-z0-9-]+)`(?: \((.+)\))?$/.exec(cell)
  if (!parts) fail(`the job ${cell} is not a name in backticks`)
  const job = parts[1]!
  const inside = parts[2]
  if (inside === undefined || /^item \d+$/.test(inside))
    return { job, item: inside }
  const matrix: Matrix = { item: undefined }
  for (const part of inside.split(" × ")) {
    const pair = /^(engine|store): (.+)$/.exec(part)
    if (!pair) fail(`${job}: ${part} is neither an engine nor a store list`)
    const values = pair[2]!.split(", ")
    if (pair[1] === "engine") matrix.engines = values.map(engineName)
    else matrix.stores = values.map(storeName)
  }
  return { job, ...matrix }
}

function engineName(value: string): EngineName {
  if (!(ENGINE_NAMES as readonly string[]).includes(value))
    fail(`${value} is no engine of pins.json`)
  return value as EngineName
}

function storeName(value: string): Store {
  if (!(STORES as readonly string[]).includes(value))
    fail(`${value} is no store`)
  return value as Store
}

type StandIn = {
  engines: EngineName[]
  only: Partial<Record<EngineName, CheckId[]>>
  store: Store | undefined
  memory: boolean
  runsOn: Reading["runsOn"]
  docker: boolean
}

/** The engines whose packages come from Ubuntu's own archive, with and without its buildx. */
function ubuntuEngines(pins: Pins): EngineName[] {
  const found = ENGINE_NAMES.filter(
    (name) => pins.engines[name].repository === "ubuntu"
  )
  const buildx = found.filter((name) => pins.engines[name].buildx !== undefined)
  if (found.length !== 2 || buildx.length !== 1)
    fail("pins.json does not hold Ubuntu's docker.io with and without buildx")
  return [buildx[0]!, ...found.filter((name) => name !== buildx[0])]
}

function readStandIn(cell: string, pins: Pins): StandIn {
  const standIn: StandIn = {
    engines: [],
    only: {},
    store: undefined,
    memory: false,
    runsOn: "ubuntu-24.04",
    docker: true,
  }
  const add = (...names: EngineName[]) => {
    for (const name of names)
      if (standIn.engines.includes(name)) fail(`${cell} names ${name} twice`)
      else standIn.engines.push(name)
  }
  for (const segment of cell.split("; ")) {
    const newest = /^the newest runs (.+)$/.exec(segment)
    if (segment === "the floor runs every check of the row") add("floor")
    else if (newest) {
      add("newest")
      standIn.only.newest = listIds(newest[1]!)
    } else if (segment === "Ubuntu's `docker.io` with and without its buildx")
      add(...ubuntuEngines(pins))
    else
      for (const phrase of segment.split(", ")) {
        const quoted = /^`([a-z-]+)`$/.exec(phrase)
        if (phrase === "the floor") add("floor")
        else if (phrase === "held to 1 GB") standIn.memory = true
        else if (phrase === "`ubuntu-24.04-arm`")
          standIn.runsOn = "ubuntu-24.04-arm"
        else if (phrase === "a GitHub macOS machine") standIn.runsOn = "macos"
        else if (phrase === "no Docker") standIn.docker = false
        else if ((STORES as readonly string[]).includes(phrase))
          standIn.store = phrase as Store
        else if (
          quoted &&
          (ENGINE_NAMES as readonly string[]).includes(quoted[1]!)
        )
          add(quoted[1] as EngineName)
        else if (/^\d+\.\d+\.\d+$/.test(phrase)) {
          // A bare version is the one engine of Docker's repository pinned at it.
          const pinned = ENGINE_NAMES.filter(
            (name) =>
              pins.engines[name].engine === phrase &&
              pins.engines[name].repository === "docker" &&
              pins.engines[name].buildx !== undefined
          )
          if (pinned.length !== 1)
            fail(`no one engine of pins.json is ${phrase}`)
          add(pinned[0]!)
        } else
          fail(
            `the phrase ${JSON.stringify(phrase)} is not one this reader knows`
          )
      }
  }
  return standIn
}

/** One row, read into what jobs.ts holds. */
export function readRow(cells: readonly string[], pins: Pins): Reading {
  if (cells.length !== HEADER.length) fail(`a row has ${cells.length} cells`)
  const [nameCell, standInCell, runsCell, limitCell] = cells as [
    string,
    string,
    string,
    string,
  ]
  const name = readName(nameCell)
  const standIn = readStandIn(standInCell, pins)
  const matrix = name.engines !== undefined || name.stores !== undefined
  if (
    name.engines !== undefined &&
    standIn.engines.length > 0 &&
    name.engines.join() !== standIn.engines.join()
  )
    fail(`${name.job}'s engines differ between its name and its stand-in`)
  const engines = name.engines ?? standIn.engines
  const stores =
    name.stores ?? (standIn.store ? [standIn.store] : [DEFAULT_STORE])
  if (standIn.docker && engines.length === 0)
    fail(`${name.job} names no engine`)
  const { asides, stripped } = asidesOf(runsCell)
  const limit = /^(\d+) min$/.exec(limitCell)
  if (!limit) fail(`${name.job}'s time limit ${limitCell} is not minutes`)
  return {
    job: name.job,
    item: name.item,
    runsOn: standIn.runsOn,
    matrix,
    legs: standIn.docker
      ? engines.flatMap((engine) =>
          stores.map((store) => ({ engine, store, memory: standIn.memory }))
        )
      : [],
    ids: idsIn(stripped),
    only: standIn.only,
    asides,
    loose: items(stripped).filter((item) => idsIn(item).length === 0),
    runs: runsCell,
    minutes: Number(limit[1]),
  }
}

/** A note below the table that names where some checks run: `L8 runs at the floor and the newest`. */
export function engineNote(
  bullet: string
): { ids: CheckId[]; engines: EngineName[] } | undefined {
  const parts =
    /^((?:[LRB]\d+b?)(?:(?:, | and )[LRB]\d+b?)*) runs? (?:where the runner builds: |at )the floor and the newest\b/.exec(
      bullet
    )
  return parts
    ? { ids: listIds(parts[1]!), engines: ["floor", "newest"] }
    : undefined
}
