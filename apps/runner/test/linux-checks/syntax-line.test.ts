/**
 * Check L2, in record mode (specs/016-build-from-source, T011; plan item
 * 11; contracts/runner.md, RB7 and its "--policy reset=true"; research
 * map-checks T4). It runs only in the Linux stand-in `gate.ts` names; without
 * ZEKNO_LINUX_SERVER it prints its one skip line. It asserts nothing about
 * Docker: it prints one record line, `L2 <engine> <store>: ...`, and fails
 * only on its own fault (a step of its own that could not be done, or
 * something it made that it could not remove).
 *
 * The check's registry (`registry.ts`) serves a small image made from the
 * fixtures' base as `127.0.0.1:5000/check/frontend:1`. A pack whose
 * Dockerfile starts `# syntax=127.0.0.1:5000/check/frontend:1` is built from
 * a tar on standard input with RB7's list (`rb7.ts`): once with
 * `--build-arg BUILDKIT_SYNTAX=dockerfile.v0`, once without (the control).
 * For each: built, or the builder's first error, and whether the registry
 * was asked for the frontend. Then the pack without that line, so that only
 * a policy can stop it: alone, with a deny-all `Dockerfile.rego` beside the
 * Dockerfile, and with it and `--policy reset=true` where `docker buildx
 * build --help` lists `--policy`. Where the engine has no buildx, the record
 * says so and nothing is built.
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name: the images it tagged, the frontend's name, the small image (and the
 * fixtures' base when it pulled it), the registry and its files, its folder,
 * and the build records its builds left in its own BUILDX_CONFIG.
 */
import { describe, test } from "bun:test"

import { gate } from "../support/linux-server/gate"
import { firstLine } from "../support/linux-server/host/host-lists"
import {
  builtName,
  buildxVersionOf,
  type Built,
  type InStandIn,
  newRunToken,
  outcomeWords,
  type PackFile,
  policyListed,
  rb7Build,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
  removeImages,
  removeRecords,
} from "../support/linux-server/build-runs/rb7"
import { record } from "../support/linux-server/jobs/record"
import {
  inRegistry,
  requestWords,
  smallImage,
  startRegistry,
  stopRegistry,
} from "../support/linux-server/build-runs/registry"

const CHECK = "L2"
const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const ROOT = "/tmp/zekno-check-syntax-line"
const HOME = `${ROOT}/home`
const APP = "check-syntax-line"
const FRONTEND = "check/frontend"
const FRONTEND_NAME = `${FRONTEND}:1`
const SOURCE = "zekno-check-syntax-line-source:1"

const BODY = "FROM scratch\nCOPY hello.txt /hello.txt\n"
const HELLO: PackFile = { path: "hello.txt", data: "zekno check L2\n" }
/** Allows nothing: buildx's policy form, `decision` from an `allow` that is never true. */
const DENY_ALL =
  'package docker\n\ndefault allow := false\n\ndecision := {"allow": allow}\n'

const PACKS = {
  syntax: [
    {
      path: "Dockerfile",
      data: `# syntax=${inRegistry(FRONTEND_NAME)}\n${BODY}`,
    },
    HELLO,
  ],
  plain: [{ path: "Dockerfile", data: BODY }, HELLO],
  rego: [
    { path: "Dockerfile", data: BODY },
    { path: "Dockerfile.rego", data: DENY_ALL },
    HELLO,
  ],
} satisfies Record<string, PackFile[]>

/** What the check's builds made, for the removal. */
type Made = { readonly options: Rb7Options[]; readonly results: Built[] }

async function must(run: InStandIn, args: readonly string[]): Promise<void> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.join(" ")}: ${firstLine(answer)}`)
}

/** Runs the builds and gives what the record line says. */
async function observe(run: InStandIn, made: Made): Promise<string> {
  const env = rb7Env({ home: HOME, run: newRunToken() })
  await must(run, ["rm", "-rf", ROOT])
  await must(run, ["mkdir", "-p", HOME])
  const version = await run(rb7Command(["docker", "buildx", "version"], env))
  if (version.code !== 0)
    return `no buildx (${firstLine(version)}); nothing built`
  const help = await run(
    rb7Command(["docker", "buildx", "build", "--help"], env)
  )
  const listed = policyListed(help.stdout)

  const registry = await startRegistry(run)
  const image = await smallImage(run, SOURCE)
  try {
    await registry.push(image.name, FRONTEND_NAME)
  } finally {
    await image.remove()
  }

  const build = async (
    key: string,
    files: readonly PackFile[],
    more: Partial<Rb7Options> = {}
  ) => {
    const options: Rb7Options = {
      app: APP,
      key,
      dockerfile: "Dockerfile",
      network: "default",
      work: `${ROOT}/${key}`,
      ...more,
    }
    made.options.push(options)
    const built = await rb7Build(run, { options, home: HOME, files })
    made.results.push(built)
    return built
  }
  const asking = async (key: string, more: Partial<Rb7Options>) => {
    const mark = await registry.mark()
    const built = await build(key, PACKS.syntax, more)
    const asked = await registry.requestsSince(mark, FRONTEND)
    return `${outcomeWords(built)}, ${requestWords(asked, FRONTEND)}`
  }

  const v0 = await asking("dockerfile-v0", { syntax: true })
  const control = await asking("control", {})
  const plain = await build("plain", PACKS.plain)
  const rego = await build("rego", PACKS.rego)
  const reset = listed
    ? `with it and --policy reset=true ${outcomeWords(
        await build("rego-reset", PACKS.rego, { policyReset: true })
      )}`
    : "docker buildx build --help does not list --policy"
  return [
    `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
    `# syntax= line with BUILDKIT_SYNTAX=dockerfile.v0: ${v0}`,
    `without it (the control): ${control}`,
    `deny-all Dockerfile.rego: the pack without it ${outcomeWords(plain)}, with it ${outcomeWords(rego)}, ${reset}`,
  ].join("; ")
}

/** Removes, by name, what the check made in the stand-in; gives what it could not. */
async function cleanUp(run: InStandIn, made: Made): Promise<string[]> {
  const left = await removeImages(run, [
    ...made.options.map(builtName),
    inRegistry(FRONTEND_NAME),
  ])
  const records = await removeRecords(
    run,
    HOME,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    console.log(
      `L2 could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  try {
    // Also a registry whose start failed half way: stopRegistry goes by its pid file.
    await stopRegistry(run)
  } catch (error) {
    left.push((error as Error).message)
  }
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}

describe.skipIf(!open.ready)(
  "L2: a # syntax= line, BUILDKIT_SYNTAX=dockerfile.v0 and a Dockerfile.rego (record mode)",
  () => {
    test(
      "records what the builder did",
      async () => {
        if (!open.ready) return
        const made: Made = { options: [], results: [] }
        let failure: { error: unknown } | undefined
        try {
          record(CHECK, await observe(open.inStandIn, made))
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUp(open.inStandIn, made)
        if (failure !== undefined) throw failure.error
        if (left.length > 0)
          throw new Error(`L2 left in the stand-in: ${left.join("; ")}`)
      },
      20 * MINUTE
    )
  }
)
