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
 *
 * Its words, and the making of a line from them, are in doctor-words.ts;
 * the lines of each server in doctor-server.ts (specs/016-build-from-source,
 * contracts/cli.md CL14).
 */
import { CoreError } from "@workspace/core"
import { lstatSync } from "node:fs"
import { join } from "node:path"

import { readCompose, type ComposeSource } from "../project/compose-read"
import {
  KeyEntryError,
  openTeam,
  readIdentity,
  type OpDeps,
  type Team,
} from "../cli/context"
import { CliError } from "../cli/errors"
import { releaseFiles } from "../server/install/checks"
import type { KeyStore } from "../profile/keystore"
import { findServer, profileStore, type Profile } from "../profile/profile"
import { DEFAULT_COMPOSE, findProject, type ProjectLink } from "../project/file"
import { standingOf } from "../project/signed"
import { shownPath } from "../project/shown"
import { RUNNER_RELEASE } from "../version/runner-release"
import { READ_LIMIT_MS } from "../server/batch"
import { sanitize } from "../server/sanitize"
import { checkNewest, newerExists, type Latest } from "../version/newest"
import { CLI_VERSION } from "../version/version"
import { atMost } from "../shared/at-most"
import { localChecks, sshChecks, type SshServer } from "./doctor-server"
import {
  composeUnreadable,
  CONNECT_OR_LINK,
  folderGood,
  good,
  KEY_FORM,
  KEY_GOOD,
  KEY_MISSING,
  KEYCHAIN_UNREADABLE,
  LINK_HERE,
  LINK_UNUSABLE,
  LINK_YOURSELF,
  MAKE_TEAM,
  NO_TEAM,
  noChecksum,
  NOT_LINKED,
  NOT_SIGNED,
  NOT_VERIFIED,
  notChecked,
  notConnected,
  notUsedYet,
  OLDER_ZEKNO,
  problem,
  PROFILE_UNREADABLE,
  profileGood,
  RESTORE_KEYCHAIN,
  restoreProfile,
  UNLOCK_KEYCHAIN,
  warning,
  zeknoDetail,
} from "./doctor-words"

// Moved to doctor-words.ts, and re-exported so that what imports them from here is unchanged.
export { freeText, sessionSentence } from "./doctor-words"

/** Which check a line is. */
export type CheckId =
  | "zekno"
  | "key"
  | "profile"
  | "folder"
  | "reachable"
  | "docker"
  | "runner"
  | "proxy"
  | "disk"

/** How a check ended: a warning does not fail the command, a problem does. */
export type CheckResult = "good" | "warning" | "problem" | "not checked"

/**
 * One line of the report (data-model.md, "Check and report"). `detail` is
 * empty for a check that was not checked; `next`, the step to take, is there
 * exactly for a warning and a problem. `reason` is the Profile line's own:
 * the sentence that said why the profile does not verify, for `--json`.
 */
export type CheckLine = {
  check: CheckId
  label: string
  result: CheckResult
  detail: string
  next?: string
  reason?: string
}

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

/** How many servers are checked at the same time. */
export const SERVERS_AT_ONCE = 4

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
function zeknoLine(
  carried: string,
  release: NonNullable<OpDeps["release"]>,
  latest: Latest
): CheckLine {
  const detail = zeknoDetail(carried)
  // A newer release is said first: it is also what fixes a build with no checksum.
  if (latest.state === "newer")
    return warning("zekno", detail, newerExists(latest.version))
  if (releaseFiles(release).length === 0)
    return warning("zekno", detail, noChecksum(carried))
  return good("zekno", detail)
}

/** The Key line, and the profile as read for it. A profile.json that is there and cannot be read leaves Key not checked. */
async function keyCheck(
  deps: Pick<OpDeps, "home" | "keyStore">
): Promise<{ line: CheckLine; profile?: Profile; unreadable?: string }> {
  const store = profileStore(deps.home)
  if (!store.exists()) return { line: problem("key", NO_TEAM, MAKE_TEAM) }
  let profile: Profile
  try {
    profile = store.load()
  } catch (error) {
    return {
      line: notChecked("key"),
      unreadable: error instanceof Error ? error.message : PROFILE_UNREADABLE,
    }
  }
  try {
    await readIdentity(deps.keyStore, profile.keyName)
  } catch (error) {
    const reason = error instanceof KeyEntryError ? error.reason : "unreadable"
    if (reason === "missing")
      return { line: problem("key", KEY_MISSING, RESTORE_KEYCHAIN), profile }
    if (reason === "form")
      return { line: problem("key", KEY_FORM, OLDER_ZEKNO), profile }
    return {
      line: problem("key", KEYCHAIN_UNREADABLE, UNLOCK_KEYCHAIN),
      profile,
    }
  }
  return { line: good("key", KEY_GOOD), profile }
}

/** The Profile line, and the verified team when it is good. It depends on the Key line, but for a profile.json that cannot be read. */
async function profileCheck(
  deps: Pick<OpDeps, "home" | "keyStore">,
  key: Awaited<ReturnType<typeof keyCheck>>
): Promise<{ line: CheckLine; team?: Team }> {
  const next = restoreProfile(shownPath(deps.home))
  if (key.unreadable !== undefined)
    return {
      line: {
        ...problem("profile", PROFILE_UNREADABLE, next),
        reason: sanitize(key.unreadable),
      },
    }
  if (key.line.result !== "good") return { line: notChecked("profile") }
  try {
    const team = await openTeam(deps)
    return { line: good("profile", profileGood(team.trust.version)), team }
  } catch (error) {
    const reason =
      error instanceof CliError
        ? error.message
        : error instanceof CoreError
          ? `That could not be done (${error.code}).`
          : NOT_VERIFIED
    return {
      line: {
        ...problem("profile", NOT_VERIFIED, next),
        reason: sanitize(reason),
      },
    }
  }
}

/** Why a Compose file cannot be deployed, or undefined when it can be read and is not empty. It is read as a deploy reads it, and only read. */
function composeProblem(source: ComposeSource): string | undefined {
  try {
    const read = readCompose(source)
    return read.text.trim() === ""
      ? `The Compose file at ${sanitize(read.path)} is empty.`
      : undefined
  } catch (error) {
    return error instanceof CliError
      ? error.message
      : "The Compose file could not be read."
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
function folderCheck(
  cwd: string,
  home: string,
  team: Team | undefined
): CheckLine | undefined {
  let link: ProjectLink | undefined
  try {
    link = findProject(cwd)
  } catch (error) {
    return problem(
      "folder",
      LINK_UNUSABLE,
      error instanceof Error ? error.message : LINK_UNUSABLE
    )
  }
  if (link) {
    if (!team) return notChecked("folder")
    const standing = standingOf(link, team.trust, home)
    if (standing.kind === "unsigned")
      return problem("folder", NOT_SIGNED, LINK_YOURSELF)
    if (standing.kind === "new")
      return warning(
        "folder",
        notUsedYet(link.app, link.server, standing.member),
        LINK_HERE
      )
    if (!team.profile.servers.some((server) => server.name === link.server))
      return problem("folder", notConnected(link.server), CONNECT_OR_LINK)
    const named = {
      app: link.app,
      server: link.server,
      compose: sanitize(link.compose),
    }
    const wrong = composeProblem({ kind: "project", link })
    return wrong === undefined
      ? good("folder", folderGood(named.app, named.server, named.compose))
      : problem("folder", composeUnreadable(named), wrong)
  }
  if (!composeHere(cwd)) return undefined
  const wrong = composeProblem({ kind: "default", folder: cwd })
  return wrong === undefined
    ? good("folder", NOT_LINKED)
    : problem("folder", composeUnreadable(), wrong)
}

/**
 * Every check of contracts/doctor.md, as data. `server`: only that one
 * (`findServer`'s sentence when there is none of that name, once the profile
 * verified). `limitMs`: each connection's limit (20 seconds unless given).
 * `at`: how many servers are checked at the same time (4 unless given).
 */
export async function runDoctor(
  deps: OpDeps,
  options: { server?: string; limitMs?: number; at?: number } = {}
): Promise<DoctorReport> {
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
    const chosen =
      options.server === undefined
        ? team.profile.servers
        : [findServer(team.profile, options.server)]
    const limitMs = options.limitMs ?? READ_LIMIT_MS
    servers = await atMost(
      options.at ?? SERVERS_AT_ONCE,
      chosen,
      async (server) => ({
        name: server.name,
        where:
          server.target.kind === "ssh"
            ? sanitize(server.target.destination)
            : "this machine",
        checks:
          server.target.kind === "ssh"
            ? await sshChecks(deps, team, server as SshServer, carried, limitMs)
            : await localChecks(deps, team, server, carried, limitMs),
      })
    )
  }

  const latest = await asking
  const machine = [
    zeknoLine(carried, release, latest),
    key.line,
    profile.line,
    ...(folder ? [folder] : []),
  ]
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
