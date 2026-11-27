/**
 * Check L15, in record mode (specs/016-build-from-source, T017; FR-037d,
 * plan item 12 and "Risks", the row on `--add-host`). It runs only in the
 * Linux stand-in `gate.ts` names; without ZEKNO_LINUX_SERVER it prints its
 * one skip line. It asserts nothing about Docker: it prints one record
 * line, `L15 <engine> <store>: ...`, and fails only on its own fault.
 *
 * One Dockerfile (`secret-salts.ts`): a step that mounts the secret
 * `NPM_TOKEN` and writes into the image a word made when it ran. Five
 * builds with RB7's list, each secret passed as `--secret
 * id=NPM_TOKEN,env=ZEKNO_BUILD_SECRET_0` with that variable set, and
 * `--add-host zekno-<salt>:127.0.0.1` with a salt of 32 random hex made in
 * the run for each app and value: app a with value 1 (salt A); a with
 * value 2 (salt B); a with no secret and no salt; app b with a secret of
 * the same name (salt C); a with value 1 and salt A again. The word each
 * image holds says whether its step ran or reused an earlier build's. When
 * two different salts ever share the step, the record line ends `item 12
 * goes back to the maintainer`. The values are markers, never printed.
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name, also after a failure: the container that read each word, its
 * images, its build records, the build cache it made (by each record's id,
 * `cache-records.ts`), the fixtures' base when its builds pulled it, and
 * its folder.
 */
import { describe, test } from "bun:test"

import {
  cacheIds,
  pruneNewCache,
} from "../support/linux-server/build-runs/cache-records"
import { gate } from "../support/linux-server/gate"
import { firstLine } from "../support/linux-server/host/host-lists"
import {
  newMarker,
  randomHex,
} from "../support/linux-server/build-runs/marker-search"
import { loadPins } from "../support/linux-server/pins"
import { hide } from "../support/linux-server/build-runs/rawjson-logs"
import {
  builtName,
  buildxVersionOf,
  type Built,
  type InStandIn,
  newRunToken,
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
  RAN_FILE,
  ranWordOf,
  SALT_BUILDS,
  saltDockerfile,
  type SaltSeen,
  saltWords,
  SECRET_NAME,
} from "../support/linux-server/checks/secret-salts"

const CHECK = "L15"
const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const ROOT = "/tmp/zekno-check-secret-salts"
const HOME = `${ROOT}/home`
const APPS = { a: "check-salt-a", b: "check-salt-b" } as const
const READER = "zekno-check-secret-salts-read"
const FIXTURES = loadPins().images.fixtures.image

/** What the check made, for the removal. */
type Made = {
  readonly options: Rb7Options[]
  readonly results: Built[]
  /** The cache's records before the first build. */
  cache?: readonly string[]
  basePresent?: boolean
}

async function must(run: InStandIn, args: readonly string[]): Promise<void> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.join(" ")}: ${firstLine(answer)}`)
}

const present = async (run: InStandIn, image: string) =>
  (await run(["docker", "image", "inspect", "--format", "{{.Id}}", image]))
    .code === 0

/** The word the step wrote in `image`, read by a container that never reaches a network. */
async function wordOf(run: InStandIn, image: string): Promise<SaltSeen> {
  await run(["docker", "rm", "--force", READER])
  const answer = await run([
    ...["docker", "run", "--rm", "--network", "none"],
    ...["--name", READER, image, "cat", RAN_FILE],
  ])
  if (answer.code !== 0)
    return { built: true, why: `docker run failed: ${firstLine(answer)}` }
  const word = ranWordOf(answer.stdout)
  return word === undefined
    ? { built: true, why: `${RAN_FILE} holds no word` }
    : { built: true, word }
}

/** Runs the five builds and gives what the record line says. */
async function observe(
  run: InStandIn,
  made: Made,
  values: Readonly<Record<1 | 2, string>>
): Promise<string> {
  const token = newRunToken()
  await must(run, ["rm", "-rf", ROOT])
  await must(run, ["mkdir", "-p", HOME])
  const version = await run(
    rb7Command(
      ["docker", "buildx", "version"],
      rb7Env({ home: HOME, run: token })
    )
  )
  if (version.code !== 0)
    return `no buildx (${firstLine(version)}); nothing built`
  made.cache = await cacheIds(run, HOME)
  made.basePresent = await present(run, FIXTURES)

  const salts = { A: randomHex(), B: randomHex(), C: randomHex() } as const
  const seen: SaltSeen[] = []
  for (const [at, build] of SALT_BUILDS.entries()) {
    const key = `k${at + 1}`
    const secret = build.value !== undefined && build.salt !== undefined
    const options: Rb7Options = {
      app: APPS[build.app],
      key,
      dockerfile: "Dockerfile",
      network: "default",
      work: `${ROOT}/${key}`,
      ...(secret ? { secrets: [SECRET_NAME], salt: salts[build.salt!] } : {}),
    }
    made.options.push(options)
    const built = await rb7Build(run, {
      options,
      home: HOME,
      run: token,
      files: [{ path: "Dockerfile", data: saltDockerfile(FIXTURES, token) }],
      ...(secret ? { secrets: [values[build.value!]] } : {}),
    })
    made.results.push(built)
    seen.push(
      built.built
        ? await wordOf(run, builtName(options))
        : { built: false, why: built.error ?? "no error read" }
    )
  }
  return [
    `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
    saltWords(SALT_BUILDS, seen),
  ].join("; ")
}

/** Removes, by name, what the check made in the stand-in; gives what it could not. */
async function cleanUp(run: InStandIn, made: Made): Promise<string[]> {
  const reader = await run(["docker", "rm", "--force", READER])
  const left =
    reader.code === 0 || /no such container/i.test(reader.stderr)
      ? []
      : [`${READER} (${firstLine(reader)})`]
  left.push(...(await removeImages(run, made.options.map(builtName))))
  if (made.basePresent === false && (await present(run, FIXTURES)))
    left.push(...(await removeImages(run, [FIXTURES])))
  const records = await removeRecords(
    run,
    HOME,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    console.log(
      `L15 could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  if (made.cache !== undefined) {
    try {
      const cache = await pruneNewCache(run, HOME, made.cache)
      if (cache.length > 0)
        console.log(
          `L15 could not remove its build cache ${cache.join(", ")}; it goes with the stand-in`
        )
    } catch (error) {
      left.push(`its build cache (${(error as Error).message})`)
    }
  }
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}

describe.skipIf(!open.ready)(
  "L15: a step built with a secret, reused only with the same salt (record mode)",
  () => {
    test(
      "records whether each build ran its step or reused one",
      async () => {
        if (!open.ready) return
        const values = {
          1: newMarker("zekno-l15-one"),
          2: newMarker("zekno-l15-two"),
        } as const
        const hidden = [values[1], values[2]]
        const made: Made = { options: [], results: [] }
        let failure: { error: unknown } | undefined
        try {
          record(
            CHECK,
            hide(await observe(open.inStandIn, made, values), hidden)
          )
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUp(open.inStandIn, made)
        if (failure !== undefined) {
          const error =
            failure.error instanceof Error
              ? failure.error
              : new Error(String(failure.error))
          error.message = hide(error.message, hidden)
          throw error
        }
        if (left.length > 0)
          throw new Error(
            `L15 left in the stand-in: ${hide(left.join("; "), hidden)}`
          )
      },
      30 * MINUTE
    )
  }
)
