/**
 * The images and stages a Dockerfile names (specs/016-build-from-source,
 * contracts/cli.md CL3, "Refused before signing", "Warned in the summary",
 * "The port"; FR-042, FR-042a). Every place that names an image is read as
 * BuildKit reads it, for `linux/amd64` and `linux/arm64`, with the `ARG`
 * defaults and the plain variables given to the build (`dockerfile/expand.ts`):
 * the base of each stage (`FROM`), each `COPY --from` and each mount's
 * `from`. `ONBUILD` lines are not run here (plan.md item 17).
 *
 * A name is an earlier stage (any case), `scratch`, or an image reference
 * (`dockerfile/reference.ts`); in `COPY --from` and a mount's `from`, any
 * stage, or one by its number. Every stage is read, the ones the chosen stage
 * does not use among them, as BuildKit reads every stage's name. Stops before
 * signing, exit status 1 (CL11):
 *
 * - C10: an image under `zekno.invalid`, any case, any port, in any place;
 * - C11: a name zekno cannot resolve fully, never guessed;
 * - C18: `build.stage` names no stage;
 * - its own ids, with no row in design/lines.md yet (T156): a name that is
 *   neither a stage nor a reference, and a file with no stage at all.
 *
 * B14 is said for each base image of a stage that is built, named without a
 * digest. The port is the first `EXPOSE` of the chosen stage's chain.
 */
import { namesReservedRegistry } from "@workspace/core"

import { CliError } from "../cli/errors"
import { BuildStop, type LineOf } from "../shared/build-lines"
import {
  type BuildArgs,
  expandWord,
  type Platform,
  PLATFORMS,
  type Resolved,
  resolveFrom,
  stageScope,
} from "./expand"
import type { DockerfileReading } from "./instructions"
import { parseReference } from "./reference"
import type { Env } from "./shell"

/**
 * A stop of the Dockerfile's images with no row in design/lines.md yet
 * (T156): `dockerfile_reference`, a name that is neither a stage nor a
 * reference Docker reads, as resolved, at its line from 1;
 * `dockerfile_no_stage`, a file with no `FROM`.
 */
export type OwnImageLine =
  | { id: "dockerfile_reference"; service: string; name: string; line: number }
  | { id: "dockerfile_no_stage"; service: string }

/** A stop before signing, exit status 1 (CL11). Its message is its id until T156. */
export class ImageNameStop extends CliError {
  constructor(readonly line: OwnImageLine) {
    super(line.id)
  }
}

/** What one image place names. */
type Named =
  | { kind: "stage"; index: number }
  | { kind: "scratch" }
  | { kind: "image"; name: string; digest: boolean }

/** A stage as one platform reads it: its base, and the stages it reads from. */
type StageNode = { base: Named; deps: Set<number> }

/** What zekno checks the images of one service's Dockerfile with. */
export type ImageCheck = {
  service: string
  reading: DockerfileReading
  /** The plain variables given to the build (`ops/build-reads.ts`). */
  given: BuildArgs
  /** `build.stage`, null when the settings set none. */
  stage: string | null
}

/** What the images of a Dockerfile that passed give the summary. */
export type ImagesRead = {
  /** The stage built, by its index. */
  target: number
  /** B14, once for each base image built from without a digest, in the order of the file. */
  unpinned: LineOf<"B14">[]
}

/** The stages by their `AS` name, in any case: the first of that name among the first `before`. */
function stageNamed(
  reading: DockerfileReading,
  name: string,
  before = reading.stages.length
): number | undefined {
  const lower = name.toLowerCase()
  const found = reading.stages.findIndex(
    (stage, at) => at < before && stage.name === lower
  )
  return found < 0 ? undefined : found
}

/**
 * The stage `build.stage` names, in any case, as BuildKit finds a target;
 * the last stage when the settings set none. C18 when it names none, with
 * the names the file gives its stages.
 */
export function targetStage(
  reading: DockerfileReading,
  service: string,
  stage: string | null
): number {
  if (reading.stages.length === 0)
    throw new ImageNameStop({ id: "dockerfile_no_stage", service })
  if (stage === null) return reading.stages.length - 1
  const found = stageNamed(reading, stage)
  if (found !== undefined) return found
  throw new BuildStop({
    id: "C18",
    service,
    stage,
    stages: reading.stages.flatMap(({ name }) => (name === null ? [] : [name])),
  })
}

/** A variable name, as a word of one variable alone writes it. */
const ONE_VARIABLE =
  /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/

/**
 * The variable C11 asks to give a default: the one the expansion could not
 * know, else the one a word of one variable alone names (a value that is
 * empty, which BuildKit refuses as a name), else none.
 */
export function variableOf(word: string, found: Resolved): string | null {
  if (found.ok) return null
  if (found.why === "unknown") return found.variable
  if (found.why === "form" && found.variable !== null) return found.variable
  const match = ONE_VARIABLE.exec(word)
  return match === null ? null : (match[1] ?? match[2]!)
}

/** A word expanded in a scope; a word with no `$` is the same in every scope, so no scope is made for it. */
export function expandIn(
  word: string,
  reading: DockerfileReading,
  scope: () => Env
): Resolved {
  const env: Env = word.includes("$") ? scope() : () => ({ kind: "unset" })
  return expandWord(word, env, reading.directives.escape)
}

/** Go's `strconv.Atoi` takes it: `COPY --from` names a stage by its number. */
const STAGE_NUMBER = /^[+-]?[0-9]+$/

/**
 * What a resolved name names. `before`: the stages a `FROM` may name, the
 * earlier ones; undefined for `COPY --from` and a mount's `from`, which name
 * any stage, or one by its number.
 */
function namedBy(
  check: ImageCheck,
  name: string,
  line: number,
  before: number | undefined
): Named {
  const { reading, service } = check
  // A number past the stages is BuildKit's own refusal; no image is named by it.
  if (
    before === undefined &&
    STAGE_NUMBER.test(name) &&
    Number.isSafeInteger(Number(name))
  )
    return { kind: "stage", index: Number(name) }
  const stage = stageNamed(reading, name, before)
  if (stage !== undefined) return { kind: "stage", index: stage }
  if (name === "scratch") return { kind: "scratch" }
  const reference = parseReference(name)
  if (reference === undefined)
    throw new ImageNameStop({ id: "dockerfile_reference", service, name, line })
  if (namesReservedRegistry(reference.domain))
    throw new BuildStop({ id: "C10", service, image: name })
  return { kind: "image", name, digest: reference.digest !== null }
}

/** C11 for a word of an image place. */
const unresolved = (
  check: ImageCheck,
  instruction: string,
  word: string,
  line: number,
  found: Resolved
) =>
  new BuildStop({
    id: "C11",
    service: check.service,
    instruction,
    line,
    variable: variableOf(word, found),
  })

/** Every stage as one platform reads it: each image place resolved and checked. */
function stagesFor(check: ImageCheck, platform: Platform): StageNode[] {
  const { reading, given } = check
  return reading.stages.map((stage, index) => {
    const from = resolveFrom(reading, index, platform, given).base
    if (!from.ok)
      throw unresolved(
        check,
        `FROM ${stage.base}`,
        stage.base,
        stage.line,
        from
      )
    const base = namedBy(check, from.value, stage.line, index)
    const deps = new Set<number>()
    if (base.kind === "stage") deps.add(base.index)
    stage.commands.forEach((command, at) => {
      if (command.onbuild) return
      const places =
        command.kind === "copy"
          ? [{ word: command.from, flag: "COPY --from=" }]
          : command.kind === "run"
            ? command.mounts.map(({ from }) => ({
                word: from,
                flag: "RUN --mount=from=",
              }))
            : []
      for (const { word, flag } of places) {
        if (word === null) continue
        const found = expandIn(word, reading, () =>
          stageScope(reading, index, at, platform, given)
        )
        if (!found.ok)
          throw unresolved(check, flag + word, word, command.line, found)
        const named = namedBy(check, found.value, command.line, undefined)
        if (named.kind === "stage") deps.add(named.index)
      }
    })
    return { base, deps }
  })
}

/** The stages the target is built from, itself among them, in the order of the file. */
function reachable(stages: StageNode[], target: number): number[] {
  const seen = new Set<number>()
  const stack = [target]
  while (stack.length > 0) {
    const at = stack.pop()!
    if (seen.has(at) || stages[at] === undefined) continue
    seen.add(at)
    stack.push(...stages[at].deps)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * Every image place of a service's Dockerfile checked: C18, C10, C11 and
 * the own stops are thrown before anything is signed. What passes gives the
 * stage built and B14's lines.
 */
export function checkImages(check: ImageCheck): ImagesRead {
  const target = targetStage(check.reading, check.service, check.stage)
  const unpinned = new Map<string, LineOf<"B14">>()
  for (const platform of PLATFORMS) {
    const stages = stagesFor(check, platform)
    for (const at of reachable(stages, target)) {
      const { base } = stages[at]!
      if (base.kind === "image" && !base.digest && !unpinned.has(base.name))
        unpinned.set(base.name, {
          id: "B14",
          service: check.service,
          image: base.name,
        })
    }
  }
  return { target, unpinned: [...unpinned.values()] }
}

/** An `EXPOSE` word that is one TCP port: `3000` or `3000/tcp`, from 1 to 65535; else none. */
function portNumber(word: string): number | null {
  const match = /^([0-9]{1,5})(?:\/tcp)?$/i.exec(word)
  const port = match === null ? 0 : Number(match[1])
  return port >= 1 && port <= 65535 ? port : null
}

/** The port for one platform: the first `EXPOSE` from the root of the target's chain of stages down to it. */
function portFor(
  reading: DockerfileReading,
  target: number,
  platform: Platform,
  given: BuildArgs
): number | null {
  const chain: number[] = []
  for (let at: number | undefined = target; at !== undefined;) {
    chain.unshift(at)
    const base = resolveFrom(reading, at, platform, given).base
    if (!base.ok) return null
    at = stageNamed(reading, base.value, at)
  }
  for (const stage of chain) {
    const commands = reading.stages[stage]!.commands
    const at = commands.findIndex(
      (command) => command.kind === "expose" && !command.onbuild
    )
    const expose = commands[at]
    if (expose?.kind !== "expose") continue
    const word = expose.ports[0]
    if (word === undefined) return null
    const found = expandIn(word, reading, () =>
      stageScope(reading, stage, at, platform, given)
    )
    return found.ok ? portNumber(found.value) : null
  }
  return null
}

/**
 * The port of the stage built (CL3, "The port"): the first `EXPOSE` of its
 * chain, with the `ARG` defaults and the plain variables given, the same for
 * both platforms; null when there is none, when it cannot be resolved, or
 * when it is not one TCP port.
 */
export function dockerfilePort(
  reading: DockerfileReading,
  target: number,
  given: BuildArgs = new Map()
): number | null {
  const [first, ...rest] = PLATFORMS.map((platform) =>
    portFor(reading, target, platform, given)
  )
  return rest.every((port) => port === first) ? (first ?? null) : null
}
