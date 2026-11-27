/**
 * Check L8, in record mode (specs/016-build-from-source, T015; FR-036,
 * plan items 3 (a) and 13; research map-checks L8). It runs only in the
 * Linux stand-in `gate.ts` names; without ZEKNO_LINUX_SERVER it prints its
 * one skip line. It asserts nothing about Docker: it prints one record
 * line, `L8 <engine> <store>: ...`, and fails only on its own fault (a step
 * of its own that could not be done, or something it made that it could
 * not remove).
 *
 * The check's registry (`registry.ts`) runs with an htpasswd file: a user
 * and a password made in the run, the bcrypt line by Bun's own
 * `Bun.password`. The stand-in's Docker logs in (`docker login
 * --password-stdin`, the password never in an argument), and a small image
 * of the fixtures' base is pushed as `check/base:1`. The client's
 * `~/.docker/config.json` in the stand-in then gets `proxies.default`, its
 * five keys set to marker values. One build with RB7's list (`rb7.ts`, the
 * ten proxy names passed empty): `FROM 127.0.0.1:5000/check/base@<digest>`
 * and a step that prints `env`. The record says whether the private base
 * resolved, and whether any marker, or any of the ten names with a value,
 * reached the step.
 *
 * Every command runs in the stand-in. It removes what it made there, by
 * name, also after a failure: its images, the login (`docker logout`), the
 * proxies in `config.json` (and the file, when the check made it), the
 * registry and its data, its folder, and its build records.
 */
import { describe, test } from "bun:test"

import {
  CLIENT_CONFIG,
  ENV_BEGIN,
  ENV_END,
  htpasswdLine,
  loginArgs,
  proxyDockerfile,
  proxyFindings,
  proxyMarkers,
  type ProxyMarkers,
  proxyWords,
  withoutProxies,
  withProxies,
} from "../support/linux-server/checks/client-config"
import { gate } from "../support/linux-server/gate"
import { firstLine } from "../support/linux-server/host/host-lists"
import { randomHex } from "../support/linux-server/build-runs/marker-search"
import {
  hide,
  linesBetween,
  stepOutput,
} from "../support/linux-server/build-runs/rawjson-logs"
import {
  builtName,
  buildxVersionOf,
  type Built,
  type InStandIn,
  newRunToken,
  outcomeWords,
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
  REGISTRY,
  smallImage,
  startRegistry,
  stopRegistry,
} from "../support/linux-server/build-runs/registry"
import {
  readInStandIn,
  removeInStandIn,
  writeInStandIn,
} from "../support/linux-server/build-runs/stand-in-files"

const CHECK = "L8"
const open = gate(CHECK)
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const ROOT = "/tmp/zekno-check-registry-proxies"
const HOME = `${ROOT}/home`
const APP = "check-registry-proxies"
const SOURCE = "zekno-check-registry-proxies-source:1"
const BASE = "check/base:1"

/** What the check made, for the removal. */
type Made = {
  readonly options: Rb7Options[]
  readonly results: Built[]
  /** Set before `docker login`: config.json's text then, or undefined when there was none. */
  config?: { readonly before: string | undefined }
  loggedIn: boolean
  registry: boolean
  digest?: string
}

async function must(run: InStandIn, args: readonly string[]): Promise<void> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.join(" ")}: ${firstLine(answer)}`)
}

/** Runs the build and gives what the record line says. */
async function observe(
  run: InStandIn,
  made: Made,
  markers: ProxyMarkers
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

  const user = `check-${randomHex(4)}`
  const password = randomHex()
  made.registry = true
  const registry = await startRegistry(run, {
    htpasswd: await htpasswdLine(user, password),
  })

  const before = await readInStandIn(run, CLIENT_CONFIG)
  // Refuses a config.json that already has proxies before anything changes it.
  withProxies(before, markers)
  made.config = { before }
  made.loggedIn = true
  const login = await run(loginArgs(user, REGISTRY), {
    stdin: { text: password },
  })
  if (login.code !== 0)
    throw new Error(`docker login ${REGISTRY} failed: ${firstLine(login)}`)

  const image = await smallImage(run, SOURCE)
  try {
    made.digest = (await registry.push(image.name, BASE)).digest
  } finally {
    await image.remove()
  }
  if (made.digest === undefined)
    throw new Error(`docker push ${inRegistry(BASE)} printed no digest`)

  const now = await readInStandIn(run, CLIENT_CONFIG)
  await writeInStandIn(run, CLIENT_CONFIG, withProxies(now, markers))

  const options: Rb7Options = {
    app: APP,
    key: "private-base",
    dockerfile: "Dockerfile",
    network: "default",
    work: `${ROOT}/private-base`,
  }
  made.options.push(options)
  const base = `${REGISTRY}/check/base@${made.digest}`
  const built = await rb7Build(run, {
    options,
    home: HOME,
    run: token,
    files: [{ path: "Dockerfile", data: proxyDockerfile(base, token) }],
  })
  made.results.push(built)
  const output = stepOutput(built.answer.stderr)
  const env = linesBetween(output, ENV_BEGIN, ENV_END)
  return [
    `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
    `FROM ${REGISTRY}/check/base by digest, through the registry's login: ${
      built.built ? "the private base resolved, built" : outcomeWords(built)
    }`,
    `config.json's proxies: ${proxyWords(
      env === undefined ? undefined : proxyFindings(output, env, markers)
    )}`,
  ].join("; ")
}

/** Takes the proxies out of config.json, and the file when the check made it and nothing else is left. */
async function restoreConfig(
  run: InStandIn,
  config: NonNullable<Made["config"]>
): Promise<void> {
  const now = await readInStandIn(run, CLIENT_CONFIG)
  if (now === undefined) return
  const kept = withoutProxies(now, config.before === undefined)
  if (kept === undefined) await removeInStandIn(run, CLIENT_CONFIG)
  else if ("proxies" in (JSON.parse(now) as object))
    await writeInStandIn(run, CLIENT_CONFIG, kept)
}

/** Removes, by name, what the check made in the stand-in; gives what it could not. */
async function cleanUp(run: InStandIn, made: Made): Promise<string[]> {
  const left = await removeImages(run, [
    ...made.options.map(builtName),
    SOURCE,
    inRegistry(BASE),
    ...(made.digest === undefined
      ? []
      : [`${REGISTRY}/check/base@${made.digest}`]),
  ])
  const records = await removeRecords(
    run,
    HOME,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    console.log(
      `L8 could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  if (made.loggedIn) {
    const logout = await run(["docker", "logout", REGISTRY])
    if (logout.code !== 0)
      left.push(`the login to ${REGISTRY} (${firstLine(logout)})`)
  }
  if (made.config !== undefined)
    try {
      await restoreConfig(run, made.config)
    } catch (error) {
      left.push(`the proxies in ${CLIENT_CONFIG} (${(error as Error).message})`)
    }
  if (made.registry)
    try {
      await stopRegistry(run)
    } catch (error) {
      left.push((error as Error).message)
    }
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}

describe.skipIf(!open.ready)(
  "L8: a private base through the registry's login, and config.json's proxies kept out of the step (record mode)",
  () => {
    test(
      "records what the builder did",
      async () => {
        if (!open.ready) return
        const markers = proxyMarkers(randomHex(4))
        const values = Object.values(markers)
        const made: Made = {
          options: [],
          results: [],
          loggedIn: false,
          registry: false,
        }
        let failure: { error: unknown } | undefined
        try {
          record(
            CHECK,
            hide(await observe(open.inStandIn, made, markers), values)
          )
        } catch (error) {
          failure = { error }
        }
        const left = await cleanUp(open.inStandIn, made)
        if (failure !== undefined) throw failure.error
        if (left.length > 0)
          throw new Error(`L8 left in the stand-in: ${left.join("; ")}`)
      },
      20 * MINUTE
    )
  }
)
