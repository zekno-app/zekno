/**
 * The `.dockerignore` zekno proposes at the first deploy in a folder with a
 * Dockerfile and no ignore file (specs/016-build-from-source,
 * contracts/cli.md CL6, "What it shows"; data-model.md, "The proposed
 * .dockerignore"; FR-002b). Written only on the yes of the first question
 * (`asking/first-build.ts`); nothing here writes it.
 *
 * Its first line is A6, by its id. Then each line of the root's `.gitignore`
 * in Docker's form: a line with no `/` but at its end becomes `**\/<line>`, a
 * leading `/` and a trailing `/` are dropped, `!` is kept, comments and empty
 * lines go; nested `.gitignore` files are not read. Then `**\/node_modules`,
 * `**\/.venv`, and `.next` when the folder has one, each unless the lines
 * before already leave it out.
 *
 * A line that would leave out a path the Dockerfile copies by name (a `COPY`
 * or `ADD` source with no wildcard, in the stages the chosen stage uses) is
 * dropped and handed back for A5a's note: a proposal drawn from `.gitignore`
 * lists build output such as `dist`, which a Dockerfile often copies. A
 * line zekno could not read back exactly as Docker would (`pack/ignore.ts`) is
 * dropped too, so the file written never stops a deploy.
 */
import { lstatSync } from "node:fs"
import { join } from "node:path"

import {
  expandWord,
  PLATFORMS,
  resolveFrom,
  stageScope,
} from "../dockerfile/expand"
import type { DockerfileReading } from "../dockerfile/instructions"
import type { LineOf } from "../shared/build-lines"
import {
  cleanPath,
  compilePatterns,
  IGNORE_FILE_BYTES,
  ignoreFileNames,
  type IgnoreRules,
  IgnoreStop,
  matchPath,
  readAll,
} from "./ignore"
import { readOnce, seenOf } from "./spool"

/** The proposed `.dockerignore`. */
export type Proposal = {
  /** Its first line, a comment said by its id. */
  readonly first: LineOf<"A6">
  /** Its patterns, in order, as the file holds them. */
  readonly lines: readonly string[]
  /** Lines left out since the Dockerfile copies a path they would leave out, each with that path (A5a). */
  readonly dropped: readonly { readonly line: string; readonly path: string }[]
  /** Lines of `.gitignore` in Docker's form that zekno could not read back exactly as Docker would, left out. */
  readonly unread: readonly string[]
}

/** What the proposal is drawn from besides the folder: the Dockerfile as the deploy names it, its reading, and `build.stage`. */
export type ProposeFor = {
  readonly dockerfile: string
  readonly reading: DockerfileReading
  readonly stage: string | null
}

/**
 * A line of `.gitignore` in Docker's form, or undefined for a comment, an
 * empty line, or a line that names nothing (FR-002b; data-model.md).
 */
export function dockerFormOf(line: string): string | undefined {
  const text = line.trim()
  if (text === "" || text.startsWith("#")) return undefined
  const exception = text.startsWith("!")
  let body = exception ? text.slice(1) : text
  body = body.replace(/\/+$/, "")
  if (body === "") return undefined
  if (!body.includes("/")) body = `**/${body}`
  else if (body.startsWith("/")) body = body.slice(1)
  if (body === "") return undefined
  return exception ? `!${body}` : body
}

/** The dependency folders added after `.gitignore`'s lines, with the paths that show a line already covers one. */
const DEPENDENCIES: readonly {
  readonly line: string
  readonly probes: readonly string[]
  readonly whenPresent: boolean
}[] = [
  {
    line: "**/node_modules",
    probes: ["node_modules", "a/node_modules"],
    whenPresent: false,
  },
  { line: "**/.venv", probes: [".venv", "a/.venv"], whenPresent: false },
  { line: ".next", probes: [".next"], whenPresent: true },
]

/** The rules of lines in Docker's form, read as Docker reads an ignore file; throws `IgnoreStop` for one it cannot read exactly. */
function rulesOf(lines: readonly string[]): IgnoreRules {
  const text = new TextEncoder().encode(lines.join("\n"))
  return {
    file: ".dockerignore",
    ...compilePatterns(readAll(text, ".dockerignore"), ".dockerignore"),
  }
}

/** Whether a line can be read back exactly as Docker reads it. */
function readable(line: string): boolean {
  try {
    rulesOf([line])
    return true
  } catch (error) {
    if (error instanceof IgnoreStop) return false
    throw error
  }
}

/** Whether anything is at `name` in the root, of any kind, without following it. */
function present(root: string, name: string): boolean {
  try {
    lstatSync(join(root, name))
    return true
  } catch {
    return false
  }
}

/**
 * The root's own `.gitignore` as lines: a regular file of at most 1 MiB, never
 * through a link, read once as pass 2 reads; none when there is no such file.
 */
function gitignoreLines(root: string): string[] {
  const path = join(root, ".gitignore")
  let stats
  try {
    stats = lstatSync(path, { bigint: true })
  } catch {
    return []
  }
  if (!stats.isFile() || stats.size > BigInt(IGNORE_FILE_BYTES)) return []
  const bytes = new Uint8Array(Number(stats.size))
  let filled = 0
  readOnce(path, ".gitignore", seenOf(stats), (part) => {
    bytes.set(part, filled)
    filled += part.length
  })
  return new TextDecoder().decode(bytes).split("\n")
}

/**
 * The `.dockerignore` proposed for `root`, or undefined when the folder
 * already has an ignore file BuildKit would use for this Dockerfile (CL2):
 * a proposal there would be read by no one.
 */
export function proposeIgnore(
  root: string,
  build: ProposeFor
): Proposal | undefined {
  const names = ignoreFileNames({
    builder: "dockerfile",
    dockerfile: build.dockerfile,
  })
  if (names.some((name) => present(root, name))) return undefined
  const lines: string[] = []
  const unread: string[] = []
  for (const raw of gitignoreLines(root)) {
    const line = dockerFormOf(raw)
    if (line === undefined) continue
    if (readable(line)) lines.push(line)
    else unread.push(line)
  }
  for (const { line, probes, whenPresent } of DEPENDENCIES) {
    if (whenPresent && !present(root, line)) continue
    const rules = rulesOf(lines)
    if (probes.every((probe) => matchPath(rules, probe).excluded)) continue
    lines.push(line)
  }
  const copied = copiedByName(build.reading, build.stage)
  const kept: string[] = []
  const dropped: { line: string; path: string }[] = []
  for (const line of lines) {
    const rules = rulesOf([line])
    const path = line.startsWith("!")
      ? undefined
      : copied.find((each) => matchPath(rules, each).excluded)
    if (path === undefined) kept.push(line)
    else dropped.push({ line, path })
  }
  return { first: { id: "A6" }, lines: kept, dropped, unread }
}

/** The rules of a proposal, as the file it would write is read (`pack/ignore.ts`): what a walk with it would leave out. */
export function proposalRules(proposal: Pick<Proposal, "lines">): IgnoreRules {
  return rulesOf(proposal.lines)
}

/** The platform names are given to every build alike: one is enough to read which stages are used. */
const PLATFORM = PLATFORMS[0]!
const NO_ARGS: ReadonlyMap<string, string> = new Map()

/** An earlier stage a name or number stands for, as BuildKit finds one for `FROM`, `COPY --from` and a mount's `from`. */
function stageNamed(
  reading: DockerfileReading,
  before: number,
  name: string
): number | undefined {
  if (/^[0-9]+$/.test(name)) {
    const index = Number(name)
    return index < before ? index : undefined
  }
  const lower = name.toLowerCase()
  const found = reading.stages.findIndex(
    (stage, index) => index < before && stage.name === lower
  )
  return found < 0 ? undefined : found
}

/** The stages the chosen stage uses: itself, its base when that is a stage, and every stage a `COPY --from` or a mount's `from` names, each in turn. */
function usedStages(reading: DockerfileReading, chosen: number): number[] {
  const used = new Set<number>()
  const escape = reading.directives.escape
  const visit = (index: number) => {
    if (used.has(index)) return
    used.add(index)
    const base = resolveFrom(reading, index, PLATFORM, NO_ARGS).base
    if (base.ok) {
      const parent = stageNamed(reading, index, base.value)
      if (parent !== undefined) visit(parent)
    }
    reading.stages[index]!.commands.forEach((command, at) => {
      if (command.onbuild) return
      const froms =
        command.kind === "copy"
          ? [command.from]
          : command.kind === "run"
            ? command.mounts.map((mount) => mount.from)
            : []
      for (const from of froms) {
        if (from === null) continue
        const name = expandWord(
          from,
          stageScope(reading, index, at, PLATFORM, NO_ARGS),
          escape
        )
        const other = name.ok
          ? stageNamed(reading, index, name.value)
          : undefined
        if (other !== undefined) visit(other)
      }
    })
  }
  visit(chosen)
  return [...used].sort((a, b) => a - b)
}

/** A source fetched from elsewhere, not from the folder sent: a URL, an SCP-like address, or `github.com/…` (CL3). */
const REMOTE =
  /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[^/\s]+@[^/\s]+:|github\.com\/)/

/** A source with a wildcard: not a path copied by name. */
const WILDCARD = /[*?[]/

/**
 * The paths of the folder sent that the Dockerfile copies by name: each
 * `COPY` (with no `--from`) or `ADD` source with no wildcard, expanded as
 * BuildKit expands it, in the stages the chosen stage uses (`stage`, or the
 * last). A source zekno cannot expand, a remote one, and the folder itself
 * are left out. In the file's order, each once.
 */
export function copiedByName(
  reading: DockerfileReading,
  stage: string | null
): string[] {
  if (reading.stages.length === 0) return []
  const named =
    stage === null
      ? -1
      : reading.stages.findIndex((each) => each.name === stage.toLowerCase())
  const chosen = named < 0 ? reading.stages.length - 1 : named
  const escape = reading.directives.escape
  const paths: string[] = []
  for (const index of usedStages(reading, chosen)) {
    reading.stages[index]!.commands.forEach((command, at) => {
      if (command.onbuild) return
      if (command.kind === "copy" && command.from !== null) return
      if (command.kind !== "copy" && command.kind !== "add") return
      for (const source of command.sources) {
        if (REMOTE.test(source)) continue
        const word = expandWord(
          source,
          stageScope(reading, index, at, PLATFORM, NO_ARGS),
          escape
        )
        if (!word.ok || WILDCARD.test(word.value) || REMOTE.test(word.value))
          continue
        const path = cleanPath(word.value).replace(/^\/+/, "")
        if (
          path === "" ||
          path === "." ||
          path === ".." ||
          path.startsWith("../")
        )
          continue
        if (!paths.includes(path)) paths.push(path)
      }
    })
  }
  return paths
}
