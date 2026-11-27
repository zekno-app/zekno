/**
 * What a Linux check reads of buildx's answers (specs/016-build-from-source,
 * T011): whether `docker buildx build --help` lists `--policy`, the version
 * `docker buildx version` names, the builder's first error under
 * `--progress=rawjson`, a build's record id in `meta.json`, and the words a
 * record line says of a build. Pure; `rb7.ts` re-exports it.
 */
import type { Answer } from "../host/host-docker"

/** Whether `docker buildx build --help` lists `--policy`. */
export function policyListed(help: string): boolean {
  return /^\s+--policy\b/m.test(help)
}

/** The version `docker buildx version` names: `github.com/docker/buildx v0.34.1 …` is `0.34.1`. */
export function buildxVersionOf(stdout: string): string | undefined {
  const word = stdout.trim().split(/\s+/)[1]
  return word === undefined ? undefined : word.replace(/^v/, "")
}

const LONGEST = 1000

/**
 * The builder's first error: the first vertex error of `--progress=rawjson`
 * with the vertex's name, else the first line that starts `ERROR`/`error`
 * (without buildx's `ERROR: `), else the first line printed that is not a
 * warning. At most 1,000 characters.
 */
export function firstError(answer: Answer): string {
  const lines = `${answer.stderr}\n${answer.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  const plain: string[] = []
  for (const line of lines) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      plain.push(line)
      continue
    }
    const vertexes = (parsed as { vertexes?: unknown } | null)?.vertexes
    if (!Array.isArray(vertexes)) continue
    for (const vertex of vertexes as { name?: unknown; error?: unknown }[]) {
      if (typeof vertex?.error !== "string" || vertex.error.trim() === "")
        continue
      const error = vertex.error.trim().split("\n")[0]!
      const name = typeof vertex.name === "string" ? `${vertex.name}: ` : ""
      return `${name}${error}`.slice(0, LONGEST)
    }
  }
  const marked = plain.find((line) => /^error\b/i.test(line))
  const line =
    marked?.replace(/^error:\s*/i, "") ??
    plain.find((item) => !/^warning\b/i.test(item)) ??
    plain[0] ??
    `exit ${answer.code}, nothing printed`
  return line.slice(0, LONGEST)
}

/** The record id of `buildx.build.ref` (`<builder>/<node>/<id>`) in a build's `meta.json`. */
export function refOf(
  metadata: Readonly<Record<string, unknown>> | undefined
): string | undefined {
  const ref = metadata?.["buildx.build.ref"]
  return typeof ref === "string" && ref !== ""
    ? ref.split("/").at(-1)
    : undefined
}

/** `built`, or `not built: <the builder's first error>`. */
export function outcomeWords(built: {
  readonly built: boolean
  readonly error?: string
}): string {
  return built.built ? "built" : `not built: ${built.error ?? "no error read"}`
}
