/**
 * The first deploy in a folder with a Dockerfile, and `zekno settings init`
 * there (specs/016-build-from-source, contracts/cli.md CL6; FR-002 to FR-005,
 * FR-011). zekno never decides by itself to build: at a terminal, in a
 * folder with a Dockerfile at its top (or, plan item 19 (a), only files named
 * `Dockerfile.*` or `*.Dockerfile` there) and neither `zekno.app.json` nor
 * `compose.yaml`, it asks once, before the opening line and the questions
 * about the key, the server and the app, with no keychain:
 *
 * - A14 first, when there are several Dockerfiles in FR-004's sense, or only
 *   `Dockerfile.*` and `*.Dockerfile` ones, which are listed even when one;
 *   the choice is written as `build.dockerfile` (A15);
 * - A1 to A6: pass 1's block, the settings file it would write, A4 for
 *   `PORT`, the proposed `.dockerignore` when the folder has none, and A5a for
 *   each line of it dropped since the Dockerfile copies that path;
 * - A7 with A8's answers (the Dockerfile names a port) or A9's, and A11 for a
 *   port, with today's rule.
 *
 * A yes writes `zekno.app.json` (builder `dockerfile`, the Dockerfile, the
 * port) and the `.dockerignore`, says A12 and keeps the folder in
 * `agreed.json`, since that yes is B24's (FR-002); the deploy goes on from
 * the settings file. `Don't build`, Esc or Ctrl-C write nothing:
 * `Nothing was done.`, exit status 1 (A13). With no terminal, or `--json`,
 * none of this is reached (A16), and a folder with both files keeps today's
 * question (A17).
 *
 * `zekno settings init` asks the same question, as A18, with `Run an image
 * instead` in place of `Don't build`, which goes on to today's IN1; then
 * today's service name question (G25).
 *
 * The folder is the person's, maybe a cloned repository's: it is walked as a
 * deploy walks it, a link never followed and nothing found there run. No
 * sentence is written here: a line is its id until the words tasks (T140,
 * T152; FR-092), and a row its id with the answer it stands for.
 */
import { lstatSync, readdirSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { CliError, Left } from "../cli/errors"
import { dockerfilePort, targetStage } from "../dockerfile/images"
import {
  type DockerfileReading,
  readDockerfile,
} from "../dockerfile/instructions"
import { DOCKERFILE_BYTES, DockerfileStop } from "../dockerfile/lex"
import { readIgnoreFile } from "../pack/ignore"
import { checkLimits, limitsOf } from "../pack/limits"
import { type Proposal, proposalRules, proposeIgnore } from "../pack/propose"
import { readOnce, type Seen, seenOf } from "../pack/spool"
import { type Walk, walkFolder } from "../pack/walk"
import { agree } from "../profile/agreed"
import { DEFAULT_COMPOSE } from "../project/file"
import { sanitize } from "../server/sanitize"
import { rootRefusal } from "../settings/build-reach"
import { SETTINGS_FILE } from "../settings/file"
import { settingWords } from "../settings/setting-words"
import { present } from "../settings/source"
import { checkPort } from "../settings/values"
import { createSettings } from "../settings/write"
import { BuildStop, type BuildLine, lineText } from "../shared/build-lines"
import type { ListRow, Ui } from "../ui/types"

/** The service the first deploy writes (lines.md A3, the boards approved on 2026-11-27). */
export const FIRST_SERVICE = "web"

/** The Dockerfile zekno reads when the settings name none (data-model.md). */
const DOCKERFILE = "Dockerfile"

/**
 * The answers' rows, each its line's id and the answer it stands for, until
 * the words tasks write their labels (A8, A9, A18; T140).
 */
export const FIRST_BUILD_ROWS = {
  /** A8: the port the Dockerfile names. */
  port: "A8:port",
  another: "A8:another",
  none: "A8:none",
  no: "A8:no",
  /** A9: the Dockerfile names no port. */
  withPort: "A9:port",
  noneWithout: "A9:none",
  noWithout: "A9:no",
  /** A18's last row, in place of `Don't build`. */
  image: "A18:image",
} as const

/** What the first question was answered: a build of `dockerfile` with its port and the `.dockerignore` proposed, or, at `zekno settings init`, an image instead. */
export type FirstBuild =
  | {
      kind: "build"
      dockerfile: string
      port: number | null
      proposal: Proposal | undefined
    }
  | { kind: "image" }

/** The files at the top of a folder that make it one with a Dockerfile (FR-004, item 19 (a)). */
type AtTop = {
  /** A regular file named exactly `Dockerfile`. */
  exact: boolean
  /** Regular files named `Dockerfile.*` (but its own `.dockerignore`) or `*.Dockerfile`, in name order. */
  others: string[]
}

/** Whether `name` in `folder` is a regular file, never through a link. */
function regularFile(folder: string, name: string): boolean {
  try {
    return lstatSync(join(folder, name)).isFile()
  } catch {
    return false
  }
}

/** The Dockerfiles at the top of `folder`, or undefined when it has none. */
function dockerfilesAtTop(folder: string): AtTop | undefined {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return undefined
  }
  const exact = names.includes(DOCKERFILE) && regularFile(folder, DOCKERFILE)
  const others = names
    .filter(
      (name) =>
        name !== DOCKERFILE &&
        !name.endsWith(".dockerignore") &&
        (name.startsWith(`${DOCKERFILE}.`) ||
          name.endsWith(`.${DOCKERFILE}`)) &&
        regularFile(folder, name)
    )
    .sort()
  return exact || others.length > 0 ? { exact, others } : undefined
}

/**
 * Whether the first question is asked in `folder` (CL6, "When"): it has a
 * Dockerfile at its top, or only `Dockerfile.*` and `*.Dockerfile` files
 * there, and nothing named `zekno.app.json` or `compose.yaml`. The caller
 * checks the rest: a terminal, no `-f`, no link.
 */
export function firstBuildHere(folder: string): boolean {
  return (
    !present(folder, SETTINGS_FILE) &&
    !present(folder, DEFAULT_COMPOSE) &&
    dockerfilesAtTop(folder) !== undefined
  )
}

/** The bytes of a Dockerfile, read once (C5, C6); one past the lexer's bound is that bound's stop, never read. */
function dockerfileBytes(path: string, name: string, seen: Seen): Uint8Array {
  if (seen.size > BigInt(DOCKERFILE_BYTES))
    throw new DockerfileStop({
      id: "dockerfile_size",
      why: "bytes",
      file: name,
    })
  const bytes = new Uint8Array(Number(seen.size))
  let filled = 0
  readOnce(path, name, seen, (part) => {
    bytes.set(part, filled)
    filled += part.length
  })
  return bytes
}

/** A Dockerfile at the top, by `lstat`, never through a link. */
function readAtTop(folder: string, name: string): DockerfileReading {
  const path = join(folder, name)
  let seen: Seen
  try {
    const stats = lstatSync(path, { bigint: true })
    if (!stats.isFile()) throw new BuildStop({ id: "C6", path: name })
    seen = seenOf(stats)
  } catch (error) {
    if (error instanceof BuildStop) throw error
    throw new BuildStop({ id: "C5", path: name })
  }
  return readDockerfile(dockerfileBytes(path, name, seen), name)
}

/** A Dockerfile in a sub-folder, as pass 1 found it, read under what it saw. */
function readFromWalk(walk: Walk, name: string): DockerfileReading {
  const entry = walk.entries.find(
    (each) => each.kind === "file" && each.name === name
  )
  if (entry?.kind !== "file") throw new BuildStop({ id: "C6", path: name })
  return readDockerfile(dockerfileBytes(entry.path, name, entry.seen), name)
}

/** The port the last stage names (CL3, "The port"); none when the file has no stage. */
function portOf(reading: DockerfileReading): number | null {
  try {
    return dockerfilePort(reading, targetStage(reading, FIRST_SERVICE, null))
  } catch {
    return null
  }
}

/** One Dockerfile ready to build: its reading, its port, the `.dockerignore` proposed, and pass 1 with it. */
type Ready = {
  dockerfile: string
  port: number | null
  proposal: Proposal | undefined
  walk: Walk
}

/**
 * Pass 1 of the folder for one Dockerfile, as a deploy would walk it: with
 * its ignore file, or, when the folder has none, the `.dockerignore`
 * proposed; then pass 1's stops (C1 to C4).
 */
function readyFor(
  folder: string,
  home: string,
  dockerfile: string,
  reading: DockerfileReading
): Ready {
  const proposal = proposeIgnore(folder, { dockerfile, reading, stage: null })
  const walk = walkFolder(folder, {
    dockerfile,
    ignore:
      proposal === undefined
        ? readIgnoreFile(folder, { builder: "dockerfile", dockerfile })
        : proposalRules(proposal),
    include: [],
    agreed: () => false,
    zeknoHome: home,
  })
  checkLimits(walk, limitsOf(walk))
  return { dockerfile, port: portOf(reading), proposal, walk }
}

/** The port a Dockerfile names, for A14's rows; none when it cannot be read. */
function portAt(read: () => DockerfileReading): number | null {
  try {
    return portOf(read())
  } catch {
    return null
  }
}

/** A14: which Dockerfile, its rows the paths; A15 is what it leaves behind. */
function whichDockerfile(
  ui: Ui,
  offered: { path: string; port: number | null }[]
): Promise<string> {
  return ui.choose({
    question: lineText({ id: "A14", dockerfiles: offered }),
    rows: offered.map(({ path }) => ({ value: path, label: sanitize(path) })),
    collapsed: lineText({ id: "A15", dockerfile: "" }),
    missing: new Left(),
  })
}

/**
 * The Dockerfile to build, asked with A14 when there are several in FR-004's
 * sense (a `Dockerfile` beside a `Dockerfile.*`, or beside a `Dockerfile` in
 * a sub-folder that is sent) or only `Dockerfile.*` and `*.Dockerfile` ones
 * (item 19 (a)); with pass 1 for it.
 */
async function chooseDockerfile(
  ui: Ui,
  folder: string,
  home: string
): Promise<Ready> {
  const top = dockerfilesAtTop(folder)
  if (top === undefined) throw new Left()
  if (!top.exact) {
    const offered = top.others.map((path) => ({
      path,
      port: portAt(() => readAtTop(folder, path)),
    }))
    const path = await whichDockerfile(ui, offered)
    return readyFor(folder, home, path, readAtTop(folder, path))
  }
  const main = readyFor(folder, home, DOCKERFILE, readAtTop(folder, DOCKERFILE))
  const dotted = top.others.filter((name) => name.startsWith(`${DOCKERFILE}.`))
  const nested = main.walk.entries.flatMap((entry) =>
    entry.kind === "file" && entry.name.endsWith(`/${DOCKERFILE}`)
      ? [entry.name]
      : []
  )
  if (dotted.length + nested.length === 0) return main
  const path = await whichDockerfile(ui, [
    { path: DOCKERFILE, port: main.port },
    ...dotted.map((name) => ({
      path: name,
      port: portAt(() => readAtTop(folder, name)),
    })),
    ...nested.map((name) => ({
      path: name,
      port: portAt(() => readFromWalk(main.walk, name)),
    })),
  ])
  if (path === DOCKERFILE) return main
  const reading = nested.includes(path)
    ? readFromWalk(main.walk, path)
    : readAtTop(folder, path)
  return readyFor(folder, home, path, reading)
}

/** The rows of A7 (or A18): A8's when the Dockerfile names a port, else A9's; then `Don't build`, or at init `Run an image instead`. */
function answerRows(
  port: number | null,
  mode: "deploy" | "init"
): ListRow<number | null | "another" | "no" | "image">[] {
  const rows = FIRST_BUILD_ROWS
  const building: ListRow<number | null | "another" | "no" | "image">[] =
    port === null
      ? [
          { value: "another", label: rows.withPort },
          { value: null, label: rows.noneWithout },
        ]
      : [
          { value: port, label: rows.port },
          { value: "another", label: rows.another },
          { value: null, label: rows.none },
        ]
  const last =
    mode === "init"
      ? { value: "image" as const, label: rows.image }
      : {
          value: "no" as const,
          label: port === null ? rows.noWithout : rows.no,
        }
  return [...building, last]
}

/**
 * The first question (CL6), in `folder`, whose profile folder is `home`:
 * A14 when it applies, A1 to A6 shown by id, then A7 (or A18 at `zekno
 * settings init`) and A11 for a port. `Don't build`, Esc and Ctrl-C leave
 * (`Left`); nothing is written here.
 */
export async function askFirstBuild(
  ui: Ui,
  where: { cwd: string; home: string },
  mode: "deploy" | "init"
): Promise<FirstBuild> {
  const { cwd, home } = where
  // A folder that is, or holds, the home folder or zekno's own is never walked (C21b).
  const refused = rootRefusal(cwd, homedir(), home)
  if (refused !== undefined)
    throw new BuildStop({ ...refused, service: FIRST_SERVICE })
  const ready = await chooseDockerfile(ui, cwd, home)
  const { port, proposal } = ready
  const shown: BuildLine[] = [{ id: "A1" }, { id: "A2" }, { id: "A3" }]
  if (port !== null) shown.push({ id: "A4", service: FIRST_SERVICE, port })
  if (proposal !== undefined)
    shown.push(
      { id: "A5", lines: [...proposal.lines] },
      proposal.first,
      ...proposal.dropped.map(({ path }) => ({ id: "A5a" as const, path }))
    )
  for (const line of shown) ui.note(lineText(line))

  const ignore = proposal !== undefined
  const answer = await ui.choose({
    question: lineText(
      mode === "init" ? { id: "A18", ignore } : { id: "A7", ignore }
    ),
    rows: answerRows(port, mode),
    collapsed: lineText({ id: "A10", port: null }),
    missing: new Left(),
  })
  if (answer === "no") throw new Left()
  if (answer === "image") return { kind: "image" }
  const chosen =
    answer === "another"
      ? Number(
          await ui.ask({
            question: settingWords("port").question,
            check: checkPort,
            missing: new Left(),
          })
        )
      : answer
  return { kind: "build", dockerfile: ready.dockerfile, port: chosen, proposal }
}

/**
 * Writes what the first question's yes writes, in `folder`: `zekno.app.json`
 * with one built `service` (builder `dockerfile`, the Dockerfile, the port),
 * never over a file there (IN4), and the `.dockerignore` proposed, never over
 * one there. The `.dockerignore`'s first line is A6, a comment: its id after
 * `# ` until the words tasks (T140).
 */
export function writeFirstBuild(
  folder: string,
  choice: Extract<FirstBuild, { kind: "build" }>,
  service: string
): void {
  createSettings(folder, {
    version: 1,
    services: [
      [
        service,
        {
          build: { builder: "dockerfile", dockerfile: choice.dockerfile },
          ...(choice.port === null ? {} : { port: choice.port }),
        },
      ],
    ],
  })
  const { proposal } = choice
  if (proposal === undefined) return
  const path = join(folder, ".dockerignore")
  const text = [`# ${lineText(proposal.first)}`, ...proposal.lines].join("\n")
  try {
    writeFileSync(path, `${text}\n`, { mode: 0o644, flag: "wx" })
  } catch {
    throw new CliError(`Could not write ${sanitize(path)}.`)
  }
}

/**
 * The first deploy's question (CL6), at a terminal, in `deps.cwd`: on a yes
 * the files written, A12 said and the folder kept in `agreed.json` (FR-002:
 * this yes is B24's), so the deploy goes on from the settings file.
 */
export async function firstBuild(
  ui: Ui,
  deps: { cwd: string; home: string }
): Promise<void> {
  const choice = await askFirstBuild(ui, deps, "deploy")
  if (choice.kind !== "build") throw new Left()
  writeFirstBuild(deps.cwd, choice, FIRST_SERVICE)
  ui.success(lineText({ id: "A12", ignore: choice.proposal !== undefined }))
  agree(deps.home, "folders", {
    folder: realpathSync(deps.cwd),
    settings: realpathSync(join(deps.cwd, SETTINGS_FILE)),
  })
}
