/**
 * `zekno doctor`'s checks (specs/006-cli-small-features, contracts/doctor.md,
 * research R11 and R12): this machine, then each server, one line each, in the
 * order of mock-up 5. This returns the report as data and draws nothing.
 *
 * It changes nothing. On this machine it only reads: profile.json, the
 * keychain entry (once, for both the Key and the Profile lines), the team
 * lists, zekno.json, `links.json` and the Compose file. It never calls `save`,
 * `saveSecrets`, `saveHistory`, `accept`, `writeProject`, `withSigner` or
 * `withProject`, and never uses `teamOnce`: no file is written, not even
 * `links.json`, and nothing is signed. On a server it runs the fixed read-only
 * `CHECK_SCRIPT` and asks the runner `version` and `status`, which read its
 * state and change nothing. It never installs, updates or starts anything, and
 * uses no deploy number.
 *
 * Every server is reached in SSH's batch mode, which never asks for anything
 * on the terminal: a server where SSH would have asked is reported as needing
 * an answer, never waited on. Each connection is stopped after 20 seconds, and
 * at most four servers are checked at the same time.
 *
 * Everything a server says that a line shows is held to a pattern and passes
 * through `sanitize`. Besides the servers, it makes one request of its own:
 * the newer-release check (version/newest.ts), once per run, beside the other
 * checks; its answer never fails the command.
 */
import { CoreError, RunnerStatusSchema, type RunnerVersion } from "@workspace/core"
import { lstatSync } from "node:fs"
import { join } from "node:path"

import { batchOnly, wouldHaveAsked } from "../app/hand-over"
import { readCompose, type ComposeSource } from "../project/compose-read"
import { KeyEntryError, openTeam, reach, readIdentity, type OpDeps, type Team } from "../cli/context"
import { CliError } from "../cli/errors"
import { releaseFiles } from "../server/install/install"
import type { KeyStore } from "../profile/keystore"
import { findServer, profileStore, type Profile, type Server } from "../profile/profile"
import { DEFAULT_COMPOSE, findProject, shownPath, standingOf, type ProjectLink } from "../project/project"
import { RUNNER_RELEASE } from "../version/runner-release"
import { sanitize } from "../server/sanitize"
import { runCheck, type CheckRead } from "../server/check-script"
import { openSession, type Session } from "../server/session"
import { checkNewest, newerExists, type Latest } from "../version/newest"
import { CLI_VERSION } from "../version/version"
import { runnerRelation } from "./server"
import { checkIdentity } from "./status"

/** Which check a line is. */
export type CheckId = "zekno" | "key" | "profile" | "folder" | "reachable" | "docker" | "runner" | "disk"

/** How a check ended: a warning does not fail the command, a problem does. */
export type CheckResult = "good" | "warning" | "problem" | "not checked"

/**
 * One line of the report (data-model.md, "Check and report"). `detail` is
 * empty for a check that was not checked; `next`, the step to take, is there
 * exactly for a warning and a problem. `reason` is the Profile line's own:
 * the sentence that said why the profile does not verify, for `--json`.
 */
export type CheckLine = { check: CheckId; label: string; result: CheckResult; detail: string; next?: string; reason?: string }

/** A server's lines, under its name and where it is (its SSH destination, or `this machine`). */
export type ServerReport = { name: string; where: string; checks: CheckLine[] }

/** The whole report. `serversSkipped`: the profile did not verify, so no server was contacted. */
export type DoctorReport = {
  zekno: string
  runner: string
  latest: Latest
  machine: CheckLine[]
  servers: ServerReport[]
  serversSkipped: boolean
  problems: number
  warnings: number
}

/** The label of each line, as mock-up 5 draws it. */
export const LABELS: Record<CheckId, string> = {
  zekno: "zekno",
  key: "Key",
  profile: "Profile",
  folder: "This folder",
  reachable: "Reachable",
  docker: "Docker",
  runner: "Runner",
  disk: "Disk",
}

// The sentences of contracts/doctor.md. Those the mock-up shows are approved; the rest need approval (research Q4).

/** D1 (mock-up). */
export const zeknoDetail = (carried: string): string => `${CLI_VERSION}, installs runner ${carried}`
/** D2. */
export const noChecksum = (carried: string): string => `This build holds no checksum for runner ${carried}, so it cannot install a runner`
export const KEY_GOOD = "in your system keychain"
/** D3, D4. */
export const NO_TEAM = "no team on this machine"
export const MAKE_TEAM = "Run zekno deploy in a project folder, or zekno init"
/** D5, D6. */
export const KEYCHAIN_UNREADABLE = "the system keychain could not be read"
export const UNLOCK_KEYCHAIN = "Unlock the keychain, or let zekno read it, and run zekno doctor again"
/** D7, D8. */
export const KEY_MISSING = "not in the system keychain"
export const RESTORE_KEYCHAIN = "Restore the keychain from a backup: the key is kept nowhere else"
/** D9, D10. */
export const KEY_FORM = "the keychain entry is not in a form this zekno reads"
export const OLDER_ZEKNO = "Use the zekno that made this key, or a newer one"
export const profileGood = (version: number): string => `verified, team list v${version}`
/** D11, D12, D13. */
export const PROFILE_UNREADABLE = "profile.json cannot be read"
export const NOT_VERIFIED = "could not be verified"
export const restoreProfile = (folder: string): string => `Restore ${folder} from a copy you trust: zekno does not repair it`
/** D14 (mock-up), D15. */
export const folderGood = (app: string, server: string, compose: string): string => `linked to ${app} on ${server}, ${compose} is readable`
export const NOT_LINKED = "not linked, compose.yaml is readable"
/** D16, D17. */
export const notUsedYet = (app: string, server: string, member: string): string => `linked to ${app} on ${server} by ${member}, not used here yet`
export const LINK_HERE = "Run zekno link here to use it"
/** D18, D19. */
export const NOT_SIGNED = "zekno.json is not signed by your team"
export const LINK_YOURSELF = "Run zekno link --app <name> --server <name> --force to link this folder yourself"
/** D20, D21. */
export const notConnected = (server: string): string => `zekno.json names ${server}, which is not connected here`
export const CONNECT_OR_LINK = "Connect it, or link this folder again with zekno link --force"
/** D22 (its next step, D23, is the sentence `findProject` gave). */
export const LINK_UNUSABLE = "zekno.json cannot be used"
/** D24 (its next step, D25, is the sentence `readCompose` gave). */
export const composeUnreadable = (link?: { app: string; server: string; compose: string }): string =>
  link ? `linked to ${link.app} on ${link.server}, ${link.compose} cannot be read` : "compose.yaml cannot be read"
export const OVER_SSH = "over SSH"
export const ON_THIS_MACHINE = "on this machine"
/** The mock-up's words for a server where SSH would have asked, and where it can. */
export const NEEDS_ANSWER = "SSH needs an answer"
export const answerInApp = (server: string): string => `Open zekno and press enter on ${server}`
/** D26, D27, D28, D29. */
export const UNREACHABLE = "could not be reached over SSH"
export const NO_ANSWER = "did not answer within 20 seconds"
export const NOT_EXPECTED = "answered, but not as zekno expects"
export const checkWith = (destination: string): string => `Check with: ssh ${destination} true`
// D30 and D31, which only the interfaces draw, are `doctorCounts` and `SERVERS_SKIPPED` in ui/types.ts.
/** D32, D33. */
export const quietLogin = (server: string): string => `Check that the login shell on ${server} prints nothing of its own`
export const NO_COMPOSE = "not found with Compose"
export const installDocker = (server: string): string => `Install Docker with its Compose plugin on ${server}`
export const composeDetail = (version: string | undefined): string => (version === undefined ? "Compose, version not reported" : `Compose ${version}`)
/** D34 (mock-up) and its next step (mock-up); D35. */
export const runnerOlder = (found: string, carried: string): string => `${found}, older than this zekno's ${carried}`
export const updateRunner = (server: string): string => `Run zekno server update ${server}`
export const noVersionReported = (carried: string): string => `does not report its version, older than this zekno's ${carried}`
/** D36, D36n, D37, D38. */
export const runnerNewer = (found: string, carried: string): string => `${found}, newer than this zekno's ${carried}`
export const MATCH_ZEKNO = "Update zekno to match it"
export const runnerNewerProtocol = (found: string, carried: string): string => `${found}, newer than this zekno's ${carried}, and speaks a newer protocol`
export const updateZekno = (server: string): string => `Update zekno before you deploy to ${server}`
/** D39, D40. */
export const runnerMissing = (path: string): string => `not found at ${path}`
export const PUT_RUNNER_BACK = "Put the runner back at that path, as apps/runner/README.md describes"
/** D41, D42. */
export const otherServer = (server: string): string => `answered as a different server than the one connected as ${server}`
export const checkDestination = (destination: string, server: string): string => `Check that ${destination} is the server you added as ${server}`
/** D44 (D43 is the session's own sentence, `sessionSentence`). */
export const replaceRunner = (server: string): string => `Run zekno server update ${server} to replace it`
/** D45, D46, D47, D48. */
export const SPACE_UNKNOWN = "free space could not be read"
export const freeSpace = (server: string): string => `Free some space on ${server} before the next deploy`
export const checkSpace = (destination: string): string => `Check with: ssh ${destination} df -Pk`
export const freeForUpdate = (server: string): string => `Free some space on ${server}: updating the runner needs 256 MiB`
/** D49, as the detail of both the Runner and the Disk lines, and its next step. */
export const NO_HOME = "the user zekno logs in as has no home folder"
export const LOG_IN_WITH_HOME = "Log in as a user with a home folder"
/**
 * The next step for a runner on this machine that did not answer as it
 * should: `zekno server update` has nothing to update there, so it points at
 * the command that says why. Not in contracts/doctor.md: needs approval.
 */
export const seeWhyHere = (server: string): string => `Run zekno status --server ${server} to see why`

/** How long each connection to a server may take: 20 seconds, as the app's reads (`READ_LIMIT_MS`, held equal by a test). */
export const DOCTOR_LIMIT_MS = 20_000

/** How many servers are checked at the same time. */
export const SERVERS_AT_ONCE = 4

/** Free space, in KiB, below which a warning and a problem are said: 1 GiB, and the 256 MiB the installer needs. */
const SPACE_WARNING_KIB = 1_048_576
const SPACE_PROBLEM_KIB = 262_144

/** A size of free space as a person reads it: `133 GB`, `102 MB`. */
export function freeText(kib: number): string {
  const bytes = kib * 1024
  return bytes >= 1e9 ? `${Math.round(bytes / 1e9)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/**
 * D43: what a session that failed said, cut at its first full stop and
 * without it, for the Runner line. Its "The runner" goes, since the line's
 * label says it: `did not answer as expected`.
 */
export function sessionSentence(error: unknown): string {
  const said = error instanceof Error && error.message ? error.message : "did not answer as expected."
  const end = said.search(/\.(\s|$)/)
  const first = end === -1 ? said : said.slice(0, end)
  return first.replace(/^The runner (on that server )?/, "")
}

/** One line, its words cleaned: a few of them came from a server or a file. */
function line(check: CheckId, result: Exclude<CheckResult, "not checked">, detail: string, next?: string): CheckLine {
  return { check, label: LABELS[check], result, detail: sanitize(detail), ...(next === undefined ? {} : { next: sanitize(next) }) }
}
const good = (check: CheckId, detail: string) => line(check, "good", detail)
const warning = (check: CheckId, detail: string, next: string) => line(check, "warning", detail, next)
const problem = (check: CheckId, detail: string, next: string) => line(check, "problem", detail, next)
const notChecked = (check: CheckId): CheckLine => ({ check, label: LABELS[check], result: "not checked", detail: "" })

/**
 * The keychain, read at most once per name for the whole run: the Key line
 * and the Profile line read the same entry, and a keychain may ask the person
 * each time it is read. `zekno doctor` writes nothing, so writing throws.
 */
function readOnce(keyStore: KeyStore): KeyStore {
  const read = new Map<string, Promise<string | null>>()
  const refuse = async () => {
    throw new Error("zekno doctor writes nothing to the keychain.")
  }
  return {
    get(name) {
      let entry = read.get(name)
      if (entry === undefined) {
        entry = keyStore.get(name)
        read.set(name, entry)
      }
      return entry
    },
    set: refuse,
    delete: refuse,
  }
}

/** The `zekno` line: the two versions, and what the newer-release check and this build's checksums say. */
function zeknoLine(carried: string, release: NonNullable<OpDeps["release"]>, latest: Latest): CheckLine {
  const detail = zeknoDetail(carried)
  // A newer release is said first: it is also what fixes a build with no checksum.
  if (latest.state === "newer") return warning("zekno", detail, newerExists(latest.version))
  if (releaseFiles(release).length === 0) return warning("zekno", detail, noChecksum(carried))
  return good("zekno", detail)
}

/** The Key line, and the profile as read for it. A profile.json that is there and cannot be read leaves Key not checked. */
async function keyCheck(deps: Pick<OpDeps, "home" | "keyStore">): Promise<{ line: CheckLine; profile?: Profile; unreadable?: string }> {
  const store = profileStore(deps.home)
  if (!store.exists()) return { line: problem("key", NO_TEAM, MAKE_TEAM) }
  let profile: Profile
  try {
    profile = store.load()
  } catch (error) {
    return { line: notChecked("key"), unreadable: error instanceof Error ? error.message : PROFILE_UNREADABLE }
  }
  try {
    await readIdentity(deps.keyStore, profile.keyName)
  } catch (error) {
    const reason = error instanceof KeyEntryError ? error.reason : "unreadable"
    if (reason === "missing") return { line: problem("key", KEY_MISSING, RESTORE_KEYCHAIN), profile }
    if (reason === "form") return { line: problem("key", KEY_FORM, OLDER_ZEKNO), profile }
    return { line: problem("key", KEYCHAIN_UNREADABLE, UNLOCK_KEYCHAIN), profile }
  }
  return { line: good("key", KEY_GOOD), profile }
}

/** The Profile line, and the verified team when it is good. It depends on the Key line, but for a profile.json that cannot be read. */
async function profileCheck(deps: Pick<OpDeps, "home" | "keyStore">, key: Awaited<ReturnType<typeof keyCheck>>): Promise<{ line: CheckLine; team?: Team }> {
  const next = restoreProfile(shownPath(deps.home))
  if (key.unreadable !== undefined) return { line: { ...problem("profile", PROFILE_UNREADABLE, next), reason: sanitize(key.unreadable) } }
  if (key.line.result !== "good") return { line: notChecked("profile") }
  try {
    const team = await openTeam(deps)
    return { line: good("profile", profileGood(team.trust.version)), team }
  } catch (error) {
    const reason = error instanceof CliError ? error.message : error instanceof CoreError ? `That could not be done (${error.code}).` : NOT_VERIFIED
    return { line: { ...problem("profile", NOT_VERIFIED, next), reason: sanitize(reason) } }
  }
}

/** Why a Compose file cannot be deployed, or undefined when it can be read and is not empty. It is read as a deploy reads it, and only read. */
function composeProblem(source: ComposeSource): string | undefined {
  try {
    const read = readCompose(source)
    return read.text.trim() === "" ? `The Compose file at ${sanitize(read.path)} is empty.` : undefined
  } catch (error) {
    return error instanceof CliError ? error.message : "The Compose file could not be read."
  }
}

/** Whether there is anything named compose.yaml in `folder`, a link included. */
function composeHere(folder: string): boolean {
  try {
    lstatSync(join(folder, DEFAULT_COMPOSE))
    return true
  } catch {
    return false
  }
}

/**
 * The This folder line, only with a zekno.json here or above, or a
 * compose.yaml here (contracts/doctor.md). The link's standing is read with
 * `findProject` and `standingOf`, never `withProject` or `useOnce`, which may
 * ask and write `links.json`.
 */
function folderCheck(cwd: string, home: string, team: Team | undefined): CheckLine | undefined {
  let link: ProjectLink | undefined
  try {
    link = findProject(cwd)
  } catch (error) {
    return problem("folder", LINK_UNUSABLE, error instanceof Error ? error.message : LINK_UNUSABLE)
  }
  if (link) {
    if (!team) return notChecked("folder")
    const standing = standingOf(link, team.trust, home)
    if (standing.kind === "unsigned") return problem("folder", NOT_SIGNED, LINK_YOURSELF)
    if (standing.kind === "new") return warning("folder", notUsedYet(link.app, link.server, standing.member), LINK_HERE)
    if (!team.profile.servers.some((server) => server.name === link.server)) return problem("folder", notConnected(link.server), CONNECT_OR_LINK)
    const named = { app: link.app, server: link.server, compose: sanitize(link.compose) }
    const wrong = composeProblem({ kind: "project", link })
    return wrong === undefined ? good("folder", folderGood(named.app, named.server, named.compose)) : problem("folder", composeUnreadable(named), wrong)
  }
  if (!composeHere(cwd)) return undefined
  const wrong = composeProblem({ kind: "default", folder: cwd })
  return wrong === undefined ? good("folder", NOT_LINKED) : problem("folder", composeUnreadable(), wrong)
}

/** The Runner line from a runner that answered as the server that was connected: how its version stands to this zekno's. */
function relationLine(server: string, mode: Session["mode"], runner: RunnerVersion | undefined, carried: string): CheckLine {
  const { relation, newerProtocol } = runnerRelation(mode, runner, carried)
  const found = runner === undefined ? undefined : sanitize(runner.version)
  if (relation === "same" && found !== undefined) return good("runner", found)
  if (relation === "newer" && found !== undefined) {
    return newerProtocol ? problem("runner", runnerNewerProtocol(found, carried), updateZekno(server)) : warning("runner", runnerNewer(found, carried), MATCH_ZEKNO)
  }
  if (found === undefined) return warning("runner", noVersionReported(carried), updateRunner(server))
  return warning("runner", runnerOlder(found, carried), updateRunner(server))
}

/**
 * Asks a runner `version` (every session's first request) and `status`, in
 * SSH's batch mode, within the limit, and closes the session: the Runner
 * line. `local`: a runner on this machine, never compared with this zekno.
 */
async function runnerCheck(deps: OpDeps, team: Team, server: Server, carried: string, limitMs: number): Promise<{ line: CheckLine; opened: boolean }> {
  const local = server.target.kind === "local"
  const where = server.target.kind === "ssh" ? server.target.destination : ON_THIS_MACHINE
  // What SSH writes is kept here and never shown: batch mode never asks, so there is nothing for the person to answer.
  const lines: string[] = []
  const signal = AbortSignal.timeout(limitMs)
  let session: Session | undefined
  try {
    session = await openSession(reach({ ...deps, connect: batchOnly(deps.connect, lines) }, server.target), { signal })
    const status = await session.request("status", RunnerStatusSchema)
    try {
      checkIdentity(team, server, status)
    } catch {
      return { line: problem("runner", otherServer(server.name), local ? seeWhyHere(server.name) : checkDestination(where, server.name)), opened: true }
    }
    if (local) return { line: good("runner", `${session.runner === undefined ? "no version reported" : sanitize(session.runner.version)}, ${ON_THIS_MACHINE}`), opened: true }
    return { line: relationLine(server.name, session.mode, session.runner, carried), opened: true }
  } catch (error) {
    const detail = signal.aborted ? NO_ANSWER : sessionSentence(error)
    return { line: problem("runner", detail, local ? seeWhyHere(server.name) : replaceRunner(server.name)), opened: session !== undefined }
  } finally {
    await session?.close().catch(() => undefined)
  }
}

/** The Disk line from the script's `space` line. */
function diskLine(server: string, destination: string, space: CheckRead["space"]): CheckLine {
  if (space === undefined) return notChecked("disk")
  if (space === "unknown") return warning("disk", SPACE_UNKNOWN, checkSpace(destination))
  const detail = `${freeText(space)} free`
  if (space >= SPACE_WARNING_KIB) return good("disk", detail)
  return space < SPACE_PROBLEM_KIB ? problem("disk", detail, freeForUpdate(server)) : warning("disk", detail, freeSpace(server))
}

/** The lines of a runner on this machine: reached by its local runner, as every command reaches it; no script, so Docker and Disk are not checked. */
async function localChecks(deps: OpDeps, team: Team, server: Server, carried: string, limitMs: number): Promise<CheckLine[]> {
  const runner = await runnerCheck(deps, team, server, carried, limitMs)
  if (!runner.opened) {
    // Nothing answered: the Reachable line says why, and the rest is not checked.
    return [{ ...runner.line, check: "reachable", label: LABELS.reachable }, notChecked("docker"), notChecked("runner"), notChecked("disk")]
  }
  return [good("reachable", ON_THIS_MACHINE), notChecked("docker"), runner.line, notChecked("disk")]
}

/** A server reached over SSH. */
type SshServer = Server & { target: Extract<Server["target"], { kind: "ssh" }> }

/** The lines of a server over SSH: `CHECK_SCRIPT` first, then, when a runner is at its path, a session. */
async function sshChecks(deps: OpDeps, team: Team, server: SshServer, carried: string, limitMs: number): Promise<CheckLine[]> {
  const { destination, runnerPath } = server.target
  const rest = [notChecked("docker"), notChecked("runner"), notChecked("disk")]
  const lines: string[] = []
  const signal = AbortSignal.timeout(limitMs)
  let read: CheckRead
  try {
    read = await runCheck(reach({ ...deps, connect: batchOnly(deps.connect, lines) }, server.target), runnerPath, signal)
  } catch (error) {
    return [problem("reachable", signal.aborted ? NO_ANSWER : sessionSentence(error), checkWith(destination)), ...rest]
  }
  if (signal.aborted) return [problem("reachable", NO_ANSWER, checkWith(destination)), ...rest]
  if (!read.reached && !read.unread && read.exitCode === 255) {
    // SSH ended with its own status before the script started: it would have asked, or it could not connect.
    const reachable = wouldHaveAsked(lines) ? problem("reachable", NEEDS_ANSWER, answerInApp(server.name)) : problem("reachable", UNREACHABLE, checkWith(destination))
    return [reachable, ...rest]
  }
  if (!read.reached || read.unread) return [problem("reachable", NOT_EXPECTED, quietLogin(server.name)), ...rest]

  const docker =
    read.docker === undefined ? notChecked("docker") : read.docker === "none" ? problem("docker", NO_COMPOSE, installDocker(server.name)) : good("docker", composeDetail(read.docker.version))
  if (read.home === false) {
    return [good("reachable", OVER_SSH), docker, problem("runner", NO_HOME, LOG_IN_WITH_HOME), problem("disk", NO_HOME, LOG_IN_WITH_HOME)]
  }
  const runner = read.runner === "none" ? problem("runner", runnerMissing(runnerPath), PUT_RUNNER_BACK) : (await runnerCheck(deps, team, server, carried, limitMs)).line
  return [good("reachable", OVER_SSH), docker, runner, diskLine(server.name, destination, read.space)]
}

/** Runs `work` on each item, at most `limit` at a time, and gives the results in the items' order. */
async function atMost<T, R>(limit: number, items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
  return results
}

/**
 * Every check of contracts/doctor.md, as data. `server`: only that one
 * (`findServer`'s sentence when there is none of that name, once the profile
 * verified). `limitMs`: each connection's limit (20 seconds unless given).
 * `at`: how many servers are checked at the same time (4 unless given).
 */
export async function runDoctor(deps: OpDeps, options: { server?: string; limitMs?: number; at?: number } = {}): Promise<DoctorReport> {
  const release = deps.release ?? RUNNER_RELEASE
  const carried = release.version
  // The newer-release check, once, started first so that it runs beside every other check (contracts/version.md).
  const asking = checkNewest(deps, carried)
  const reading = { home: deps.home, keyStore: readOnce(deps.keyStore) }
  const key = await keyCheck(reading)
  const profile = await profileCheck(reading, key)
  const folder = folderCheck(deps.cwd, deps.home, profile.team)

  let servers: ServerReport[] = []
  const team = profile.team
  if (team) {
    const chosen = options.server === undefined ? team.profile.servers : [findServer(team.profile, options.server)]
    const limitMs = options.limitMs ?? DOCTOR_LIMIT_MS
    servers = await atMost(options.at ?? SERVERS_AT_ONCE, chosen, async (server) => ({
      name: server.name,
      where: server.target.kind === "ssh" ? sanitize(server.target.destination) : "this machine",
      checks:
        server.target.kind === "ssh"
          ? await sshChecks(deps, team, server as SshServer, carried, limitMs)
          : await localChecks(deps, team, server, carried, limitMs),
    }))
  }

  const latest = await asking
  const machine = [zeknoLine(carried, release, latest), key.line, profile.line, ...(folder ? [folder] : [])]
  const all = [...machine, ...servers.flatMap((server) => server.checks)]
  return {
    zekno: CLI_VERSION,
    runner: carried,
    latest,
    machine,
    servers,
    serversSkipped: team === undefined,
    problems: all.filter((check) => check.result === "problem").length,
    warnings: all.filter((check) => check.result === "warning").length,
  }
}
