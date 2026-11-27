/**
 * RB7's build command in the Linux stand-in (specs/016-build-from-source,
 * T011; contracts/runner.md, "RB7. The build command, a Dockerfile"), until
 * `apps/runner/src/builder/args.ts` exists (T158). The one file a check
 * imports for a build: it re-exports the argument list and environment
 * (`rb7-args.ts`), the pack (`pack-tar.ts`) and the reading of what buildx
 * printed (`builder-output.ts`), and runs one build in the stand-in.
 *
 * How to use, in a check file whose gate is open:
 *
 *   const built = await rb7Build(open.inStandIn, {
 *     options: { app: "check-x", key: "k1", dockerfile: "Dockerfile",
 *                network: "default", work: "/tmp/zekno-check-x/k1" },
 *     home: "/tmp/zekno-check-x/home",
 *     files: [{ path: "Dockerfile", data: "FROM scratch\nCOPY a /a\n" },
 *             { path: "a", data: "a\n" }],
 *   })
 *   built.built, built.error (the builder's first error), built.metadata
 *   outcomeWords(built)          // "built" or "not built: <error>", for record()
 *
 * `work` and `home` are folders of the stand-in under `/tmp/zekno-check-*`;
 * the check removes them, its images by `builtName` with `removeImages`, and
 * its build records with `removeRecords`. A flag RB7 does not pass (L4's
 * `--iidfile`) goes in `extra`, before the final `-`; for a process of your
 * own around the list (L5), take `rb7Args`, `rb7Env` and `rb7Command`.
 * Every command runs in the stand-in, through `gate.ts`. A secret's value
 * travels on standard input into a file of mode 0600 in the work folder,
 * which the build's own `sh` reads and removes before buildx starts: no
 * value is in an argument of a host call. Checks still use markers.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { firstError } from "./builder-output"
import type { Gate } from "../gate"
import type { Answer } from "../host/host-docker"
import { packOf, type PackFile } from "./pack-tar"
import {
  newRunToken,
  rb7Args,
  rb7Command,
  rb7Env,
  type Rb7Options,
  withExtra,
} from "./rb7-args"
import { writeInStandIn } from "./stand-in-files"

export {
  buildxVersionOf,
  firstError,
  outcomeWords,
  policyListed,
  refOf,
} from "./builder-output"
export { PACK_PATH, packOf, type PackFile } from "./pack-tar"
export {
  builtName,
  checkFolder,
  DOCKER_ENV_NAMES,
  neverPassedIn,
  type Network,
  newRunToken,
  PROXY_NAMES,
  rb7Args,
  rb7Command,
  rb7Env,
  type Rb7Options,
  STAND_IN_DOCKER_ENV,
  withExtra,
} from "./rb7-args"

/** `docker exec -i <stand-in> ...`, as an open gate runs it. */
export type InStandIn = Extract<Gate, { ready: true }>["inStandIn"]

const MINUTE = 60_000

export type Rb7Build = {
  readonly options: Rb7Options
  /** The runner's home in the stand-in; `BUILDX_CONFIG` is `<home>/buildx`. */
  readonly home: string
  readonly files: readonly PackFile[]
  /** The run token; a new one when absent. */
  readonly run?: string
  /** Secret values, in the order of `options.secrets`; each reaches the stand-in on standard input. */
  readonly secrets?: readonly string[]
  /** Flags RB7 does not pass, before the final `-`. */
  readonly extra?: readonly string[]
  /** 5 minutes when absent. */
  readonly timeoutMs?: number
}

export type Built = {
  readonly answer: Answer
  readonly built: boolean
  /** The builder's first error, when it did not build. */
  readonly error?: string
  /** `meta.json`, when buildx wrote it. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

async function must(run: InStandIn, args: readonly string[]): Promise<Answer> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(
      `${args.join(" ")} failed in the stand-in (exit ${answer.code}): ${firstError(answer)}`
    )
  return answer
}

function metadataOf(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Where the i-th secret's value waits in the stand-in until the build's `sh` reads and removes it. */
export const secretFileOf = (work: string, at: number): string =>
  `${work}/zekno-secret-${at}`

/**
 * One build with RB7's list in the stand-in: an empty work folder, each
 * secret's value written to its own file there over standard input, the
 * pack as a tar on standard input, exactly RB7's environment, a time limit
 * kept in the stand-in. Gives whether it built, the builder's first error,
 * and `meta.json` when buildx wrote it. The secrets' files are gone after.
 */
export async function rb7Build(
  run: InStandIn,
  build: Rb7Build
): Promise<Built> {
  const { options } = build
  const list = withExtra(rb7Args(options), build.extra ?? [])
  const values = build.secrets ?? []
  if (values.length !== (options.secrets ?? []).length)
    throw new Error("a value is given for each secret the list names")
  if (values.some((value) => value.includes("\0")))
    throw new Error("a secret value holds a NUL")
  const env = rb7Env({ home: build.home, run: build.run ?? newRunToken() })
  const secretFiles = values.map((_, at) => secretFileOf(options.work, at))
  const limit = build.timeoutMs ?? 5 * MINUTE
  const seconds = Math.ceil(limit / 1000)
  const pack = packOf(build.files)
  await must(run, ["rm", "-rf", options.work])
  await must(run, ["mkdir", "-p", options.work, env.BUILDX_CONFIG!])
  const folder = mkdtempSync(join(tmpdir(), "zekno-check-pack-"))
  let answer: Answer
  try {
    for (const [at, value] of values.entries())
      await writeInStandIn(run, secretFiles[at]!, value)
    const file = join(folder, "pack.tar")
    writeFileSync(file, pack)
    answer = await run(
      rb7Command(list, env, {
        work: options.work,
        timeoutSeconds: seconds,
        secretFiles,
      }),
      { stdin: { file }, timeoutMs: limit + MINUTE }
    )
  } finally {
    rmSync(folder, { recursive: true, force: true })
    if (secretFiles.length > 0) await run(["rm", "-f", "--", ...secretFiles])
  }
  const meta = await run(["cat", `${options.work}/meta.json`])
  const metadata = meta.code === 0 ? metadataOf(meta.stdout) : undefined
  if (answer.code === 0) return { answer, built: true, metadata }
  const error =
    answer.code === 124
      ? `stopped at its time limit of ${seconds} s`
      : answer.code === -1
        ? `the call was stopped on the host after ${seconds + 60} s`
        : firstError(answer)
  return { answer, built: false, error, metadata }
}

/** Removes images of the stand-in by name; one that is not there is no fault. Gives those it could not remove, with why. */
export async function removeImages(
  run: InStandIn,
  names: readonly string[]
): Promise<string[]> {
  const left: string[] = []
  for (const name of new Set(names)) {
    const answer = await run(["docker", "image", "rm", name])
    if (answer.code !== 0 && !/no such image/i.test(answer.stderr))
      left.push(`${name} (${firstError(answer)})`)
  }
  return left
}

const REF_ID = /^[a-z0-9]{10,64}$/

/**
 * Removes the build records a check's builds left, by their ids: those
 * given (`refOf` of each build's metadata) and those buildx kept under
 * `<home>/buildx/refs/default/default/`. Gives the ids it could not remove.
 */
export async function removeRecords(
  run: InStandIn,
  home: string,
  known: readonly (string | undefined)[] = []
): Promise<string[]> {
  const env = rb7Env({ home, run: newRunToken() })
  const listed = await run([
    "sh",
    "-c",
    'ls -1 "$1" 2> /dev/null || :',
    "sh",
    `${env.BUILDX_CONFIG}/refs/default/default`,
  ])
  const ids = [
    ...new Set(
      [
        ...known,
        ...listed.stdout.split("\n").map((line) => line.trim()),
      ].filter((id): id is string => id !== undefined && REF_ID.test(id))
    ),
  ]
  if (ids.length === 0) return []
  const answer = await run(
    rb7Command(
      ["docker", "buildx", "history", "rm", "--builder", "default", ...ids],
      env
    )
  )
  return answer.code === 0 ? [] : ids
}
