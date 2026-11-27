/**
 * Checks L9 and L10, in record mode (specs/016-build-from-source, T016;
 * FR-031a, FR-031b, plan item 17; contracts/runner.md RB11 and RB12). They
 * run only in the Linux stand-in `gate.ts` names; without ZEKNO_LINUX_SERVER
 * the file prints its one skip line. Each asks `jobs.ts` whether it runs on
 * this leg (L9 at the floor and the newest, L10 at the floor). They assert
 * nothing about Docker: each prints one record line and fails only on its
 * own fault.
 *
 * L9: a local image tagged `zekno.invalid/check-other:k1` in the stand-in.
 * Built with RB7's list (`--provenance=false`, `--metadata-file`): `FROM`
 * it, and `FROM` a base whose `ONBUILD` line names it. The record says
 * whether the metadata's `buildx.build.provenance` materials exist and name
 * it. Then item 17 (c)'s policy, denying every `docker-image://zekno.invalid/*`
 * source, written by the check outside the pack, two ways: by buildx's
 * `--policy` where `docker buildx build --help` lists it (buildx reads that
 * file from the context's folder, and a pack on standard input has none),
 * and always by BuildKit's source-policy file. For each way the record says
 * whether a base outside `zekno.invalid/` still builds (the control), and
 * whether both builds were stopped.
 *
 * L10: a step prints a marker made in the run (the Dockerfile never holds
 * it); after the build, `docker buildx history rm` by the metadata's ref;
 * then `grep -r -a -l` for the marker over Docker's root,
 * `/var/lib/containerd` and the check's own folder, which stands in for the
 * runner's. The record names each file found, or none; never the marker.
 *
 * Every command runs in the stand-in. Each check removes, by name, also
 * after a failure, the tag, the images and the build records it made, and
 * its folder; never another.
 */
import { describe, test } from "bun:test"

import { gate } from "../support/linux-server/gate"
import { firstLine } from "../support/linux-server/host/host-lists"
import { runsHere } from "../support/linux-server/jobs/jobs"
import {
  foundWords,
  newMarker,
  printingDockerfile,
  searchPlaces,
  searchStandIn,
} from "../support/linux-server/build-runs/marker-search"
import {
  committedImage,
  type Committed,
  DENY_RESERVED_REGO,
  materialsOf,
  materialWords,
  policyArgs,
  policyFileKey,
  SOURCE_POLICY,
  SOURCE_POLICY_VARIABLE,
  withBuildEnvRun,
} from "../support/linux-server/checks/materials"
import { loadPins } from "../support/linux-server/pins"
import {
  hide,
  stepOutput,
} from "../support/linux-server/build-runs/rawjson-logs"
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
  type SmallImage,
  smallImage,
} from "../support/linux-server/build-runs/registry"
import { writeInStandIn } from "../support/linux-server/build-runs/stand-in-files"

const open = gate("L9 and L10")
if (!open.ready) console.log(open.skip)

const MINUTE = 60_000
const FIXTURES = loadPins().images.fixtures.image
const OTHER = "zekno.invalid/check-other:k1"
const OTHER_NAME = "zekno.invalid/check-other"
const ONBUILD = "zekno-check-materials-onbuild:1"
const ONBUILD_CONTAINER = "zekno-check-materials-onbuild"
const NOTE: PackFile = { path: "note.txt", data: "zekno check L9\n" }

const L9 = {
  root: "/tmp/zekno-check-materials",
  home: "/tmp/zekno-check-materials/home",
  app: "check-materials",
} as const
const L10 = {
  root: "/tmp/zekno-check-records",
  home: "/tmp/zekno-check-records/home",
  app: "check-records",
} as const

/** What a check's builds made, for the removal. */
type Made = {
  readonly options: Rb7Options[]
  readonly results: Built[]
  other?: SmallImage
  onbuild?: Committed
  /** L10: whether the fixtures' base was in the stand-in before its build. */
  basePresent?: boolean
}

const newMade = (): Made => ({ options: [], results: [] })

async function must(run: InStandIn, args: readonly string[]): Promise<void> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(`${args.join(" ")}: ${firstLine(answer)}`)
}

/** An empty folder for the check, and buildx's version, or why there is none. */
async function prepare(
  run: InStandIn,
  check: { readonly root: string; readonly home: string },
  token: string
): Promise<{ version: string; help: string } | { none: string }> {
  await must(run, ["rm", "-rf", check.root])
  await must(run, ["mkdir", "-p", check.home])
  const env = rb7Env({ home: check.home, run: token })
  const version = await run(rb7Command(["docker", "buildx", "version"], env))
  if (version.code !== 0)
    return { none: `no buildx (${firstLine(version)}); nothing built` }
  const help = await run(
    rb7Command(["docker", "buildx", "build", "--help"], env)
  )
  return {
    version: `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
    help: help.stdout,
  }
}

async function observeL9(run: InStandIn, made: Made): Promise<string> {
  const token = newRunToken()
  const ready = await prepare(run, L9, token)
  if ("none" in ready) return ready.none
  made.other = await smallImage(run, OTHER)
  made.onbuild = await committedImage(run, {
    name: ONBUILD,
    base: FIXTURES,
    container: ONBUILD_CONTAINER,
    changes: [`ONBUILD COPY --from=${OTHER} /bin/busybox /zekno-check-other`],
  })
  const inspected = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    OTHER,
  ])
  const ids = inspected.code === 0 ? [inspected.stdout.trim()] : []

  const build = async (
    key: string,
    from: string,
    more: Partial<Rb7Options> = {},
    through: InStandIn = run
  ) => {
    const options: Rb7Options = {
      app: L9.app,
      key,
      dockerfile: "Dockerfile",
      network: "default",
      work: `${L9.root}/${key}`,
      ...more,
    }
    made.options.push(options)
    const built = await rb7Build(through, {
      options,
      home: L9.home,
      run: token,
      files: [
        {
          path: "Dockerfile",
          data: `FROM ${from}\nCOPY note.txt /zekno-check-note.txt\n`,
        },
        NOTE,
      ],
    })
    made.results.push(built)
    return built
  }
  const materials = (built: Built) =>
    `${outcomeWords(built)}, ${materialWords(materialsOf(built.metadata), OTHER_NAME, ids)}`
  const fromLocal = await build("from-local", OTHER)
  const fromOnbuild = await build("onbuild", ONBUILD)

  // Both ways are tried where buildx lists `--policy`: its file is read from
  // the context's folder, and a pack on standard input has none.
  const policed = async (
    way: string,
    prefix: string,
    more: Partial<Rb7Options>,
    through: InStandIn
  ) => {
    const control = await build(`${prefix}-control`, FIXTURES, more, through)
    const deniedLocal = await build(
      `${prefix}-from-local`,
      OTHER,
      more,
      through
    )
    const deniedOnbuild = await build(
      `${prefix}-onbuild`,
      ONBUILD,
      more,
      through
    )
    return `item 17 (c)'s policy by ${way}: the control, FROM the fixtures' base, ${outcomeWords(control)}; FROM ${OTHER} ${outcomeWords(deniedLocal)}; the ONBUILD base ${outcomeWords(deniedOnbuild)}`
  }
  const ways: string[] = []
  const listed = policyListed(ready.help)
  if (listed) {
    const path = `${L9.root}/policy/deny-reserved.rego`
    await writeInStandIn(run, path, DENY_RESERVED_REGO)
    ways.push(
      await policed(
        `buildx's --policy ${policyFileKey(ready.help)}=<a Rego file outside the pack>, after --policy reset=true`,
        "policy",
        { policyReset: true, sourcePolicy: policyArgs(ready.help, path) },
        run
      )
    )
  }
  const path = `${L9.root}/policy/source-policy.json`
  await writeInStandIn(run, path, SOURCE_POLICY)
  ways.push(
    await policed(
      `BuildKit's source-policy file (${SOURCE_POLICY_VARIABLE})${listed ? "" : "; docker buildx build --help lists no --policy"}`,
      "source-policy",
      {},
      withBuildEnvRun(run, SOURCE_POLICY_VARIABLE, path)
    )
  )
  return [
    ready.version,
    `FROM ${OTHER}: ${materials(fromLocal)}`,
    `FROM a base whose ONBUILD names it: ${materials(fromOnbuild)}`,
    ...ways,
  ].join("; ")
}

async function observeL10(run: InStandIn, made: Made): Promise<string> {
  const token = newRunToken()
  const ready = await prepare(run, L10, token)
  if ("none" in ready) return ready.none
  const present = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    FIXTURES,
  ])
  made.basePresent = present.code === 0
  const marker = newMarker("zekno-l10")
  const options: Rb7Options = {
    app: L10.app,
    key: "printed",
    dockerfile: "Dockerfile",
    network: "default",
    work: `${L10.root}/printed`,
  }
  made.options.push(options)
  const built = await rb7Build(run, {
    options,
    home: L10.home,
    run: token,
    files: [{ path: "Dockerfile", data: printingDockerfile(FIXTURES, marker) }],
  })
  made.results.push(built)
  if (!built.built)
    return hide(`${ready.version}; ${outcomeWords(built)}; nothing searched`, [
      marker,
    ])
  const printed = stepOutput(built.answer.stderr).includes(marker)
  const ref = refOf(built.metadata)
  let removal: string
  if (ref === undefined)
    removal = "no buildx.build.ref in its metadata, so no record removed"
  else {
    const removed = await run(
      rb7Command(
        ["docker", "buildx", "history", "rm", "--builder", "default", ref],
        rb7Env({ home: L10.home, run: token })
      )
    )
    removal =
      removed.code === 0
        ? `its record ${ref} removed by docker buildx history rm`
        : `docker buildx history rm ${ref} failed: ${firstLine(removed)}`
  }
  const places = await searchPlaces(run, L10.root)
  const found = await searchStandIn(run, marker, places)
  return hide(
    [
      ready.version,
      printed
        ? "the step printed the marker"
        : "the marker was not seen in what the step printed",
      removal,
      `then the marker was ${foundWords(found, places)}`,
    ].join("; "),
    [marker]
  )
}

/** Removes, by name, what a check made in the stand-in; gives what it could not. */
async function cleanUp(
  run: InStandIn,
  id: "L9" | "L10",
  check: { readonly root: string; readonly home: string },
  made: Made
): Promise<string[]> {
  const left = await removeImages(run, made.options.map(builtName))
  for (const image of [made.onbuild, made.other])
    if (image !== undefined)
      try {
        await image.remove()
      } catch (error) {
        left.push((error as Error).message)
      }
  if (made.basePresent === false) {
    const now = await run([
      "docker",
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      FIXTURES,
    ])
    if (now.code === 0) left.push(...(await removeImages(run, [FIXTURES])))
  }
  const records = await removeRecords(
    run,
    check.home,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    console.log(
      `${id} could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  const folder = await run(["rm", "-rf", check.root])
  if (folder.code !== 0) left.push(`${check.root} (${firstLine(folder)})`)
  return left
}

/** Runs a check, removes what it made whatever happened, and fails only on its own fault. */
async function runCheck(
  id: "L9" | "L10",
  check: { readonly root: string; readonly home: string },
  observe: (run: InStandIn, made: Made) => Promise<string>
): Promise<void> {
  if (!open.ready) return
  const made = newMade()
  let failure: { error: unknown } | undefined
  try {
    record(id, await observe(open.inStandIn, made))
  } catch (error) {
    failure = { error }
  }
  const left = await cleanUp(open.inStandIn, id, check, made)
  if (failure !== undefined) throw failure.error
  if (left.length > 0)
    throw new Error(`${id} left in the stand-in: ${left.join("; ")}`)
}

describe.skipIf(!open.ready || !runsHere("L9"))(
  "L9: the materials of a build from a local image, and item 17 (c)'s policy (record mode)",
  () => {
    test(
      "records what the builder did",
      () => runCheck("L9", L9, observeL9),
      20 * MINUTE
    )
  }
)

describe.skipIf(!open.ready || !runsHere("L10"))(
  "L10: a printed marker after Docker's record of the build is removed (record mode)",
  () => {
    test(
      "records where the marker was found",
      () => runCheck("L10", L10, observeL10),
      20 * MINUTE
    )
  }
)
