/**
 * The names a Dockerfile declares with `ARG` (specs/016-build-from-source,
 * contracts/cli.md CL3, "The build's plain variables"; data-model.md, "Build
 * variables"; FR-036a, FR-036b): those a Dockerfile build may be given.
 *
 * Every `ARG` counts, before the first `FROM` and in every stage, stages the
 * chosen one does not use among them (FR-036a); an `ONBUILD` line is not run
 * here (plan.md item 17), so it declares nothing. A name is read as BuildKit
 * expands it, quotes and the escape character taken off; one made from a
 * variable cannot be known, and a build is never given a variable it cannot
 * be shown to declare.
 *
 * Core's `isNeverGivenArg` (CO6) holds the names a build is never given; the
 * summary says which kind each is (FR-036b): one the builder reads as its own
 * (B16) or one zekno reserves (B17).
 */
import { isNeverGivenArg } from "@workspace/core"

import { expandWord } from "./expand"
import type { DockerfileReading } from "./instructions"
import type { Env } from "./shell"

/** Every variable unknown: a name is read only from what it writes out. */
const NOTHING_KNOWN: Env = () => ({ kind: "unknown" })

/** A name as `ARG` writes it, expanded as BuildKit expands it; undefined when it uses a variable or is empty. */
function nameOf(key: string, escape: string): string | undefined {
  const found = expandWord(key, NOTHING_KNOWN, escape)
  return found.ok && found.value !== "" ? found.value : undefined
}

/**
 * The names the Dockerfile declares with `ARG`, in the order of the file,
 * each once: before the first `FROM`, then in each stage.
 */
export function declaredArgs(reading: DockerfileReading): string[] {
  const escape = reading.directives.escape
  const names = new Set<string>()
  const add = (key: string) => {
    const name = nameOf(key, escape)
    if (name !== undefined) names.add(name)
  }
  for (const { key } of reading.globalArgs) add(key)
  for (const stage of reading.stages)
    for (const command of stage.commands)
      if (command.kind === "arg" && !command.onbuild)
        for (const { key } of command.pairs) add(key)
  return [...names]
}

/**
 * Names the builder reads as its own setting: the five proxy names it passes
 * to every step, the platform names and `SOURCE_DATE_EPOCH` it sets, and its
 * `BUILDKIT_` settings, in any case, as core holds them (CO6).
 */
const BUILDER_READS =
  /^(?:(?:HTTP|HTTPS|FTP|NO|ALL)_PROXY|SOURCE_DATE_EPOCH|(?:TARGET|BUILD)(?:PLATFORM|OS|ARCH|VARIANT)|BUILDKIT_\w*)$/i

/**
 * Why a Dockerfile build is never given a name (core's `isNeverGivenArg`,
 * CO6): `B16`, the builder reads it as its own setting; `B17`, zekno reserves
 * it for itself; undefined when it may be given.
 */
export function neverGiven(name: string): "B16" | "B17" | undefined {
  if (!isNeverGivenArg(name, "dockerfile")) return undefined
  return BUILDER_READS.test(name) ? "B16" : "B17"
}
