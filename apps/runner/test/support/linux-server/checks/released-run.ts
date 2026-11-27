/**
 * Check L1's steps in the stand-in (specs/016-build-from-source, T021;
 * FR-083, SC-009; contracts/runner.md RB18), as
 * `apps/runner/test/linux-checks/released-runner.test.ts` runs them; the
 * scripts, the Compose texts and the reading of answers are
 * `released-runner.ts`'s.
 *
 * Runner 0.1.1 is downloaded in the stand-in for its processor, checked
 * against the SHA-256 commit `ee40f7d` recorded (a mismatch stops with one
 * line), and put at `/usr/local/bin/zekno-runner`, the stand-in's own runner
 * kept aside. It is set up for a team made in the run, then sent one signed
 * version-2 deploy per context, each made with `../deploy-v2.ts`. For each:
 * the outcome, whether Compose built the image, the images and containers
 * new after it, and the number the runner's state shows. It asserts
 * nothing.
 *
 * Every command runs in the stand-in, through `gate.ts`. The removal goes
 * by name: each app's containers by its Compose project, its network and
 * its image, the build records in the check's own Docker configuration, the
 * runner it put there (by its SHA-256) with the stand-in's own put back, and
 * the check's folder.
 */
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  proposeRoster,
} from "@workspace/core"
import { join } from "node:path"

import { buildDeployV2 } from "../../deploy-v2"
import { firstLine } from "../host/host-lists"
import { type InStandIn, removeImages, removeRecords } from "../build-runs/rb7"
import {
  answerOf,
  appOf,
  archOf,
  BUILD_CASES,
  type BuildCase,
  caseWords,
  CHECK,
  composeText,
  DOCKER_CONFIG,
  downloadScript,
  hashIn,
  imageOf,
  mismatchLine,
  networkOf,
  newLines,
  placeScript,
  projectOf,
  RECORDED_AT,
  RECORDED_FILE,
  recordedHash,
  releaseUrl,
  restoreScript,
  ROOT,
  RUNNER,
  runnerCommand,
  sequenceOf,
  sessionLine,
  VERSION,
} from "./released-runner"

const MINUTE = 60_000
/** The repository's root, where `git show` reads the recorded checksums. */
export const REPO_ROOT = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  ".."
)

/** What the check made in the stand-in, for the removal. */
export type ReleasedMade = {
  /** Whether its folder may exist: set before the download. */
  started: boolean
  /** The recorded SHA-256, once the runner is being put in place. */
  placed?: string
  /** The keys of the cases whose deploy was sent. */
  readonly cases: string[]
}

export type ReleasedDeps = {
  /** runner-release.json as commit `ee40f7d` recorded it. */
  readonly recorded: () => string
}

/** `git show ee40f7d:apps/cli/src/version/runner-release.json`, read only; a failure stops with one line. */
export function gitRecorded(root: string = REPO_ROOT): string {
  let shown: ReturnType<typeof Bun.spawnSync>
  try {
    shown = Bun.spawnSync(["git", "show", `${RECORDED_AT}:${RECORDED_FILE}`], {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch (error) {
    throw new Error(
      `${CHECK} stopped: git could not be run: ${(error as Error).message}`,
      { cause: error }
    )
  }
  if (shown.exitCode !== 0)
    throw new Error(
      `${CHECK} stopped: git show ${RECORDED_AT}:${RECORDED_FILE} failed: ${
        shown.stderr?.toString().trim().split("\n")[0] ??
        `exit ${shown.exitCode}`
      }`
    )
  return shown.stdout?.toString() ?? ""
}

async function must(run: InStandIn, args: readonly string[]): Promise<string> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(
      `${CHECK} stopped: ${args.slice(0, 3).join(" ")} failed in the stand-in: ${firstLine(answer)}`
    )
  return answer.stdout
}

/** Runs a one-shot command of the runner with `message` on its input; gives its one JSON line. */
async function runnerJson(
  run: InStandIn,
  command: string,
  message: unknown
): Promise<Record<string, unknown>> {
  const answer = await run(runnerCommand(command), {
    stdin: { text: JSON.stringify(message) },
  })
  try {
    return JSON.parse(answer.stdout.trim().split("\n").at(-1) ?? "") as Record<
      string,
      unknown
    >
  } catch {
    throw new Error(
      `${CHECK} stopped: runner ${VERSION}'s ${command} answered ${firstLine(answer) || `nothing (exit ${answer.code})`}`
    )
  }
}

/** The images and the containers of the stand-in's Docker, one per line. */
async function lists(
  run: InStandIn
): Promise<{ images: string; containers: string }> {
  return {
    images: await must(run, [
      "docker",
      "image",
      "ls",
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ]),
    containers: await must(run, [
      ...["docker", "ps", "--all"],
      ...["--format", "{{.Names}} ({{.Image}}, {{.State}})"],
    ]),
  }
}

/** One case: the deploy sent on a session of its own, and what it left. */
async function deployCase(
  run: InStandIn,
  made: ReleasedMade,
  item: BuildCase,
  deploy: (item: BuildCase) => Promise<unknown>
) {
  const before = await lists(run)
  const input = await deploy(item)
  made.cases.push(item.key)
  const answer = await run(runnerCommand("session"), {
    stdin: { text: sessionLine(input) },
    timeoutMs: 10 * MINUTE,
  })
  const { result, lines } = answerOf(answer.stdout)
  const image = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    imageOf(item.key),
  ])
  const after = await lists(run)
  return {
    item,
    result,
    code: answer.code,
    lines,
    built: image.code === 0,
    images: newLines(before.images, after.images),
    containers: newLines(before.containers, after.containers),
  }
}

/** Downloads, checks and places runner 0.1.1, sets it up, sends each deploy, and gives what the record line says. */
export async function observeReleased(
  run: InStandIn,
  made: ReleasedMade,
  deps: ReleasedDeps = { recorded: () => gitRecorded() }
): Promise<string> {
  const arch = archOf(await must(run, ["uname", "-m"]))
  const recorded = recordedHash(deps.recorded(), arch)
  const url = releaseUrl(arch)
  made.started = true
  const downloaded = await run(["sh", "-c", downloadScript(url)], {
    timeoutMs: 6 * MINUTE,
  })
  if (downloaded.code !== 0)
    throw new Error(
      `${CHECK} stopped: the download of ${url} failed: ${firstLine(downloaded)}`
    )
  const found = hashIn(downloaded.stdout)
  if (found !== recorded)
    throw new Error(mismatchLine(arch, found ?? "unreadable", recorded))
  made.placed = recorded
  await must(run, ["sh", "-c", placeScript()])
  const version = await run(runnerCommand("version"))

  const signer = createSigner(generateMemberKeyPair().secretKey)
  const team = await createTeam({ founderName: "Ada", signer })
  const setup = await runnerJson(run, "setup", {
    founding: team.envelope,
    teamCode: team.confirmationCode,
  })
  if (
    typeof setup.serverId !== "string" ||
    typeof setup.serverPublicKey !== "string"
  )
    throw new Error(
      `${CHECK} stopped: runner ${VERSION} refused setup: ${JSON.stringify(setup)}`
    )
  const added = await proposeRoster({
    trust: team.trust,
    servers: [{ name: "stand-in", publicKey: setup.serverPublicKey as never }],
    signer,
  })
  const rosters = [team.envelope, added.envelope]
  const synced = await runnerJson(run, "sync", { rosters })
  if (synced.outcome !== "ok")
    throw new Error(
      `${CHECK} stopped: runner ${VERSION} refused sync: ${JSON.stringify(synced)}`
    )

  const deploy = async (item: BuildCase) => ({
    rosters,
    ...(await buildDeployV2({
      trust: added.trust,
      serverId: setup.serverId as string,
      signer,
      previous: 0,
      app: appOf(item.key),
      compose: composeText(item),
      values: {},
    })),
  })
  const done = []
  for (const item of BUILD_CASES)
    done.push(await deployCase(run, made, item, deploy))
  const status = (await run(runnerCommand("status"))).stdout
  return [
    `runner ${VERSION} for linux-${arch}, SHA-256 as ${RECORDED_AT} recorded, at ${RUNNER}, version ${firstLine(version) || "not read"}`,
    "set up for a team made in the run",
    ...done.map((seen) =>
      caseWords({ ...seen, sequence: sequenceOf(status, appOf(seen.item.key)) })
    ),
  ].join("; ")
}

/**
 * Removes, by name, what the check made in the stand-in: each app's
 * containers by its Compose project, its network and its image, the build
 * records in its own Docker configuration, the runner it put there, with
 * the stand-in's own put back, and its folder. Gives what it could not
 * remove; records it could not remove are said in one line and go with the
 * stand-in.
 */
export async function cleanUpReleased(
  run: InStandIn,
  made: ReleasedMade,
  say: (line: string) => void = (line) => console.log(line)
): Promise<string[]> {
  const left: string[] = []
  for (const key of made.cases) {
    const listed = await run([
      ...["docker", "ps", "--all"],
      ...["--filter", `label=com.docker.compose.project=${projectOf(key)}`],
      ...["--format", "{{.Names}}"],
    ])
    if (listed.code !== 0)
      left.push(`the containers of ${projectOf(key)} (${firstLine(listed)})`)
    for (const name of listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      const removed = await run(["docker", "rm", "--force", name])
      if (removed.code !== 0) left.push(`${name} (${firstLine(removed)})`)
    }
    const network = await run(["docker", "network", "rm", networkOf(key)])
    if (
      network.code !== 0 &&
      !/not found|no such network/i.test(network.stderr)
    )
      left.push(`${networkOf(key)} (${firstLine(network)})`)
  }
  left.push(...(await removeImages(run, made.cases.map(imageOf))))
  if (made.started) {
    const records = await removeRecords(run, DOCKER_CONFIG)
    if (records.length > 0)
      say(
        `${CHECK} could not remove the build records ${records.join(", ")}; they go with the stand-in`
      )
  }
  if (made.placed !== undefined) {
    const restored = await run(["sh", "-c", restoreScript(made.placed)])
    if (restored.code !== 0) left.push(`${RUNNER} (${firstLine(restored)})`)
  }
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}
