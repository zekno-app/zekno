/**
 * What a Linux check reads of a build's `--progress=rawjson` output
 * (specs/016-build-from-source, T012 to T014; research/map-runner.md, E06):
 * each vertex as its updates leave it, the Dockerfile's steps among them and
 * whether each was cached, what the steps printed, and the plain lines
 * buildx printed around the JSON. Pure; the checks of
 * `test/linux-checks/` read a build's answer with it.
 *
 *   const progress = progressOf(`${answer.stderr}\n${answer.stdout}`)
 *   stepsOf(progress)            // [{ name: "[2/3] RUN ...", cached: true, ... }]
 *   cachedWords(stepsOf(progress))
 *   taggedLine(progress, "zekno-check-cache saw:")
 */
import type { Answer } from "../host/host-docker"

export type Vertex = {
  readonly digest: string
  readonly name: string
  readonly cached: boolean
  readonly started: boolean
  readonly completed: boolean
  readonly error?: string
}

export type Progress = {
  /** In the order each first appeared. */
  readonly vertexes: readonly Vertex[]
  /** What each vertex printed, by its digest, as text. */
  readonly logs: ReadonlyMap<string, string>
  /** The lines that are not rawjson, in order. */
  readonly plain: readonly string[]
}

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const decoder = new TextDecoder()

/** A log's `data`: base64, as Go writes a byte slice. */
function decoded(data: string): string {
  try {
    return decoder.decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
  } catch {
    return ""
  }
}

/** Reads every line of what buildx printed: rawjson updates merged by vertex, other lines kept. */
export function progressOf(text: string): Progress {
  const vertexes = new Map<string, Vertex>()
  const logs = new Map<string, string>()
  const plain: string[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      plain.push(trimmed)
      continue
    }
    if (!isObject(parsed)) {
      plain.push(trimmed)
      continue
    }
    const updates = Array.isArray(parsed.vertexes) ? parsed.vertexes : []
    for (const update of updates) {
      if (!isObject(update) || typeof update.digest !== "string") continue
      const before = vertexes.get(update.digest)
      const error =
        typeof update.error === "string" && update.error.trim() !== ""
          ? update.error.trim()
          : before?.error
      vertexes.set(update.digest, {
        digest: update.digest,
        name:
          typeof update.name === "string" && update.name !== ""
            ? update.name
            : (before?.name ?? ""),
        cached: (before?.cached ?? false) || update.cached === true,
        started:
          (before?.started ?? false) || typeof update.started === "string",
        completed:
          (before?.completed ?? false) || typeof update.completed === "string",
        ...(error === undefined ? {} : { error }),
      })
    }
    const entries = Array.isArray(parsed.logs) ? parsed.logs : []
    for (const entry of entries) {
      if (
        !isObject(entry) ||
        typeof entry.vertex !== "string" ||
        typeof entry.data !== "string"
      )
        continue
      logs.set(
        entry.vertex,
        (logs.get(entry.vertex) ?? "") + decoded(entry.data)
      )
    }
  }
  return { vertexes: [...vertexes.values()], logs, plain }
}

/** What a build's answer printed, both streams, read. */
export function progressOfAnswer(answer: Answer): Progress {
  return progressOf(`${answer.stderr}\n${answer.stdout}`)
}

/** A Dockerfile step's vertex name: `[2/3] RUN ...`, `[stage-0 2/3] COPY ...`; never `[internal] ...`. */
export const STEP_NAME = /^\[(?:[^\]\s]+ )?\d+\/\d+\] /

/** The Dockerfile's steps, as the builder named them, in order. */
export function stepsOf(progress: Progress): Vertex[] {
  return progress.vertexes.filter((vertex) => STEP_NAME.test(vertex.name))
}

/** The step whose name holds `word`, if the builder named one so. */
export function stepNamed(
  progress: Progress,
  word: string
): Vertex | undefined {
  return stepsOf(progress).find((vertex) => vertex.name.includes(word))
}

/** Whether a step whose name holds `word` has started and not yet ended. */
export function stepRunning(progress: Progress, word: string): boolean {
  const step = stepNamed(progress, word)
  return step !== undefined && step.started && !step.completed
}

const SHOWN = 80
const shortName = (name: string) =>
  name.length > SHOWN ? `${name.slice(0, SHOWN - 1)}…` : name

/** `every step cached (3 of 3)`, or which were not; `no step read` when the builder named none. */
export function cachedWords(steps: readonly Vertex[]): string {
  if (steps.length === 0) return "no step read"
  const fresh = steps.filter((step) => !step.cached)
  if (fresh.length === 0)
    return `every step cached (${steps.length} of ${steps.length})`
  return `${steps.length - fresh.length} of ${steps.length} steps cached; not cached: ${fresh
    .map((step) => shortName(step.name))
    .join(", ")}`
}

/** All the steps printed, in the order of their vertexes. */
export function logText(progress: Progress): string {
  return progress.vertexes
    .map((vertex) => progress.logs.get(vertex.digest) ?? "")
    .filter((text) => text !== "")
    .join("\n")
}

/** The rest of the first line a step printed that starts with `tag`, trimmed. */
export function taggedLine(
  progress: Progress,
  tag: string
): string | undefined {
  if (tag === "") throw new Error("a tag names the line")
  for (const line of logText(progress).split("\n")) {
    const at = line.indexOf(tag)
    if (at >= 0) return line.slice(at + tag.length).trim()
  }
  return undefined
}

/** The last `count` lines buildx printed outside rawjson, and the last `count` lines the steps printed. */
export function lastLines(
  progress: Progress,
  count = 3
): { plain: string[]; steps: string[] } {
  const steps = logText(progress)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  return { plain: progress.plain.slice(-count), steps: steps.slice(-count) }
}
