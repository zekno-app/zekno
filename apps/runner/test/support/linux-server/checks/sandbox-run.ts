/**
 * Check L18's builds in the stand-in (specs/016-build-from-source, T020;
 * FR-033, SC-008; contracts/runner.md RB7, "Never passed"): each with RB7's
 * list (`rb7.ts`), as `apps/runner/test/linux-checks/sandbox.test.ts` runs
 * them. What each step prints, and the judgement, are `sandbox-probe.ts`'s.
 *
 * First the stand-in's own addresses, devices and capability set, read with
 * its `ip -o addr`, `ls /dev` and `/proc/self/status`; then the control, a
 * plain step under `--network default`, which must build and print, or the
 * check cannot judge and fails; then each case of quickstart.md's item 3.
 * Every command runs in the stand-in, through `gate.ts`. The removal goes by
 * name: the images the builds tagged, the base when the check's builds
 * brought it, the build records in the check's own BUILDX_CONFIG, and the
 * check's folder.
 */
import { firstLine } from "../host/host-lists"
import { loadPins } from "../pins"
import {
  type Built,
  builtName,
  type InStandIn,
  newRunToken,
  rb7Build,
  rb7Command,
  rb7Env,
  type Rb7Options,
  refOf,
  removeImages,
  removeRecords,
} from "../build-runs/rb7"
import {
  addressesOf,
  capEffOf,
  type CaseSeen,
  caseWords,
  CONTROL,
  deviceToTry,
  probeDockerfile,
  readProbe,
  reachTarget,
  type SandboxCase,
  sandboxCases,
  type StandInSeen,
  stepOutput,
  violations,
} from "./sandbox-probe"

export const CHECK = "L18"
export const ROOT = "/tmp/zekno-check-sandbox"
export const HOME = `${ROOT}/home`
export const APP = "check-sandbox"

/** What the check made, for the removal. */
export type SandboxMade = {
  readonly options: Rb7Options[]
  readonly results: Built[]
  /** The base, by digest; and whether it was in the stand-in before the builds. */
  base?: { readonly image: string; readonly there: boolean }
}

export type SandboxSeen = {
  /** What the record line says. */
  readonly words: string
  /** Where a build broke the sandbox; the check asserts there is none. */
  readonly violations: readonly string[]
}

/** A case as the record line names it: its `RUN` flag. */
export function labelOf(key: string, device: string | undefined): string {
  if (key === "device") return `RUN --device=/dev/${device ?? "?"}`
  if (key === "none") return "--network none with RUN --network=default"
  const flags = sandboxCases(device).find((item) => item.key === key)?.flags
  return flags === undefined ? key : `RUN ${flags}`
}

async function must(run: InStandIn, args: readonly string[]): Promise<string> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(
      `${args.slice(0, 3).join(" ")} failed in the stand-in: ${firstLine(answer)}`
    )
  return answer.stdout
}

/** The stand-in's own addresses, devices and capability set. */
export async function readStandIn(run: InStandIn): Promise<StandInSeen> {
  const addresses = addressesOf(await must(run, ["ip", "-o", "addr"]))
  const devices = (await must(run, ["ls", "-1", "/dev"]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const capEff = capEffOf(
    await must(run, ["grep", "CapEff", "/proc/self/status"])
  )
  if (capEff === undefined || BigInt(`0x${capEff}`) === 0n)
    throw new Error(
      "L18 cannot read the stand-in's own capability set, so it cannot judge a step's"
    )
  return { addresses, devices, capEff }
}

/**
 * Runs the control and each case with RB7's list, and gives the record's
 * words and every breach of the sandbox. A control that does not build or
 * whose step's output cannot be read is the check's own fault, and throws.
 */
export async function observeSandbox(
  run: InStandIn,
  made: SandboxMade,
  base: string = loadPins().images.fixtures.image
): Promise<SandboxSeen> {
  await must(run, ["rm", "-rf", ROOT])
  await must(run, ["mkdir", "-p", HOME])
  const env = rb7Env({ home: HOME, run: newRunToken() })
  const version = await run(rb7Command(["docker", "buildx", "version"], env))
  if (version.code !== 0)
    throw new Error(
      `L18 cannot run RB7's list: docker buildx version failed: ${firstLine(version)}`
    )
  const present = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    base,
  ])
  made.base = { image: base, there: present.code === 0 }
  const standIn = await readStandIn(run)
  const reach = reachTarget(standIn.addresses)
  const nonce = newRunToken()

  const build = async (sandboxCase: SandboxCase): Promise<CaseSeen> => {
    const options: Rb7Options = {
      app: APP,
      key: sandboxCase.key,
      dockerfile: "Dockerfile",
      network: sandboxCase.network,
      work: `${ROOT}/${sandboxCase.key}`,
    }
    made.options.push(options)
    const built = await rb7Build(run, {
      options,
      home: HOME,
      files: [
        {
          path: "Dockerfile",
          data: probeDockerfile(base, sandboxCase, nonce, reach),
        },
      ],
    })
    made.results.push(built)
    const output = stepOutput(`${built.answer.stderr}\n${built.answer.stdout}`)
    return {
      key: sandboxCase.key,
      network: sandboxCase.network,
      built: built.built,
      error: built.error,
      probe: readProbe(output, nonce),
    }
  }

  const control = await build(CONTROL)
  if (!control.built || control.probe === undefined)
    throw new Error(
      control.built
        ? "L18's control built, and what its step printed could not be read, so no case can be judged"
        : `L18's control did not build, so no case can be judged: ${control.error ?? "no error read"}`
    )
  const device = deviceToTry(standIn.devices, control.probe.devices)
  const cases: CaseSeen[] = []
  for (const sandboxCase of sandboxCases(device))
    cases.push(await build(sandboxCase))

  const found = [control, ...cases].flatMap((seen) =>
    violations(seen, standIn, control.probe!)
  )
  const words = [
    `the stand-in's addresses ${
      standIn.addresses
        .map((item) => `${item.name} ${item.address}`)
        .join(" ") || "none"
    }, CapEff ${standIn.capEff}, port 22 tried at ${reach ?? "no address"}`,
    caseWords(control),
    ...(device === undefined
      ? [
          "device: none of the stand-in's devices is beyond the control's, not tried",
        ]
      : []),
    ...cases.map((seen) =>
      caseWords(seen, control.probe, labelOf(seen.key, device))
    ),
    found.length === 0
      ? "every build failed or stayed in the sandbox"
      : `breaches: ${found.join("; ")}`,
  ]
  return { words: words.join("; "), violations: found }
}

/**
 * Removes, by name, what the check made in the stand-in: the images its
 * builds tagged, the base when it was not there before, the records in its
 * own BUILDX_CONFIG, and its folder. Gives what it could not remove;
 * records it could not remove are said in one line and go with the
 * stand-in.
 */
export async function cleanUpSandbox(
  run: InStandIn,
  made: SandboxMade,
  say: (line: string) => void = (line) => console.log(line)
): Promise<string[]> {
  const left = await removeImages(run, [
    ...made.options.map(builtName),
    ...(made.base !== undefined && !made.base.there ? [made.base.image] : []),
  ])
  const records = await removeRecords(
    run,
    HOME,
    made.results.map((built) => refOf(built.metadata))
  )
  if (records.length > 0)
    say(
      `${CHECK} could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}
