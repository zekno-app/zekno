/**
 * The words of `zekno doctor`'s lines (specs/006-cli-small-features,
 * contracts/doctor.md): the label of each line, its sentences by their ids,
 * and the making of a line from them, its words cleaned. Split from
 * ops/doctor.ts with no change of behaviour (specs/016-build-from-source,
 * contracts/cli.md CL14); doctor.ts re-exports what is imported from it.
 */
import { PROXY_LABEL } from "../domains/words"
import { sanitize } from "../server/sanitize"
import { CLI_VERSION } from "../version/version"
import type { CheckId, CheckLine, CheckResult } from "./doctor"

/** The label of each line, as mock-up 5 draws it. */
export const LABELS: Record<CheckId, string> = {
  zekno: "zekno",
  key: "Key",
  profile: "Profile",
  folder: "This folder",
  reachable: "Reachable",
  docker: "Docker",
  runner: "Runner",
  proxy: PROXY_LABEL,
  disk: "Disk",
}

// The sentences of contracts/doctor.md. Those the mock-up shows are approved; the rest need approval (research Q4).

/** D1 (mock-up). */
export const zeknoDetail = (carried: string): string =>
  `${CLI_VERSION}, installs runner ${carried}`
/** D2. */
export const noChecksum = (carried: string): string =>
  `This build holds no checksum for runner ${carried}, so it cannot install a runner`
export const KEY_GOOD = "in your system keychain"
/** D3, D4. */
export const NO_TEAM = "no team on this machine"
export const MAKE_TEAM = "Run zekno deploy in a project folder, or zekno init"
/** D5, D6. */
export const KEYCHAIN_UNREADABLE = "the system keychain could not be read"
export const UNLOCK_KEYCHAIN =
  "Unlock the keychain, or let zekno read it, and run zekno doctor again"
/** D7, D8. */
export const KEY_MISSING = "not in the system keychain"
export const RESTORE_KEYCHAIN =
  "Restore the keychain from a backup: the key is kept nowhere else"
/** D9, D10. */
export const KEY_FORM = "the keychain entry is not in a form this zekno reads"
export const OLDER_ZEKNO = "Use the zekno that made this key, or a newer one"
export const profileGood = (version: number): string =>
  `verified, team list v${version}`
/** D11, D12, D13. */
export const PROFILE_UNREADABLE = "profile.json cannot be read"
export const NOT_VERIFIED = "could not be verified"
export const restoreProfile = (folder: string): string =>
  `Restore ${folder} from a copy you trust: zekno does not repair it`
/** D14 (mock-up), D15. */
export const folderGood = (
  app: string,
  server: string,
  compose: string
): string => `linked to ${app} on ${server}, ${compose} is readable`
export const NOT_LINKED = "not linked, compose.yaml is readable"
/** D16, D17. */
export const notUsedYet = (
  app: string,
  server: string,
  member: string
): string => `linked to ${app} on ${server} by ${member}, not used here yet`
export const LINK_HERE = "Run zekno link here to use it"
/** D18, D19. */
export const NOT_SIGNED = "zekno.json is not signed by your team"
export const LINK_YOURSELF =
  "Run zekno link --app <name> --server <name> --force to link this folder yourself"
/** D20, D21. */
export const notConnected = (server: string): string =>
  `zekno.json names ${server}, which is not connected here`
export const CONNECT_OR_LINK =
  "Connect it, or link this folder again with zekno link --force"
/** D22 (its next step, D23, is the sentence `findProject` gave). */
export const LINK_UNUSABLE = "zekno.json cannot be used"
/** D24 (its next step, D25, is the sentence `readCompose` gave). */
export const composeUnreadable = (link?: {
  app: string
  server: string
  compose: string
}): string =>
  link
    ? `linked to ${link.app} on ${link.server}, ${link.compose} cannot be read`
    : "compose.yaml cannot be read"
export const OVER_SSH = "over SSH"
export const ON_THIS_MACHINE = "on this machine"
/** The mock-up's words for a server where SSH would have asked, and where it can. */
export const NEEDS_ANSWER = "SSH needs an answer"
export const answerInApp = (server: string): string =>
  `Open zekno and press enter on ${server}`
/** D26, D27, D28, D29. */
export const UNREACHABLE = "could not be reached over SSH"
export const NO_ANSWER = "did not answer within 20 seconds"
export const NOT_EXPECTED = "answered, but not as zekno expects"
export const checkWith = (destination: string): string =>
  `Check with: ssh ${destination} true`
// D30 and D31, which only the interfaces draw, are `doctorCounts` and `SERVERS_SKIPPED` in ui/types.ts.
/** D32, D33. */
export const quietLogin = (server: string): string =>
  `Check that the login shell on ${server} prints nothing of its own`
export const NO_COMPOSE = "not found with Compose"
export const installDocker = (server: string): string =>
  `Install Docker with its Compose plugin on ${server}`
export const composeDetail = (version: string | undefined): string =>
  version === undefined ? "Compose, version not reported" : `Compose ${version}`
/** D34 (mock-up) and its next step (mock-up); D35. */
export const runnerOlder = (found: string, carried: string): string =>
  `${found}, older than this zekno's ${carried}`
export const updateRunner = (server: string): string =>
  `Run zekno server update ${server}`
export const noVersionReported = (carried: string): string =>
  `does not report its version, older than this zekno's ${carried}`
/** D36, D36n, D37, D38. */
export const runnerNewer = (found: string, carried: string): string =>
  `${found}, newer than this zekno's ${carried}`
export const MATCH_ZEKNO = "Update zekno to match it"
export const runnerNewerProtocol = (found: string, carried: string): string =>
  `${found}, newer than this zekno's ${carried}, and speaks a newer protocol`
export const updateZekno = (server: string): string =>
  `Update zekno before you deploy to ${server}`
/** D39, D40. */
export const runnerMissing = (path: string): string => `not found at ${path}`
export const PUT_RUNNER_BACK =
  "Put the runner back at that path, as apps/runner/README.md describes"
/** D41, D42. */
export const otherServer = (server: string): string =>
  `answered as a different server than the one connected as ${server}`
export const checkDestination = (destination: string, server: string): string =>
  `Check that ${destination} is the server you added as ${server}`
/** D44 (D43 is the session's own sentence, `sessionSentence`). */
export const replaceRunner = (server: string): string =>
  `Run zekno server update ${server} to replace it`
/** D45, D46, D47, D48. */
export const SPACE_UNKNOWN = "free space could not be read"
export const freeSpace = (server: string): string =>
  `Free some space on ${server} before the next deploy`
export const checkSpace = (destination: string): string =>
  `Check with: ssh ${destination} df -Pk`
export const freeForUpdate = (server: string): string =>
  `Free some space on ${server}: updating the runner needs 256 MiB`
/** D49, as the detail of both the Runner and the Disk lines, and its next step. */
export const NO_HOME = "the user zekno logs in as has no home folder"
export const LOG_IN_WITH_HOME = "Log in as a user with a home folder"
/**
 * The next step for a runner on this machine that did not answer as it
 * should: `zekno server update` has nothing to update there, so it points at
 * the command that says why. Not in contracts/doctor.md: needs approval.
 */
export const seeWhyHere = (server: string): string =>
  `Run zekno status --server ${server} to see why`

/** A size of free space as a person reads it: `133 GB`, `102 MB`. */
export function freeText(kib: number): string {
  const bytes = kib * 1024
  return bytes >= 1e9
    ? `${Math.round(bytes / 1e9)} GB`
    : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/**
 * D43: what a session that failed said, cut at its first full stop and
 * without it, for the Runner line. Its "The runner" goes, since the line's
 * label says it: `did not answer as expected`.
 */
export function sessionSentence(error: unknown): string {
  const said =
    error instanceof Error && error.message
      ? error.message
      : "did not answer as expected."
  const end = said.search(/\.(\s|$)/)
  const first = end === -1 ? said : said.slice(0, end)
  return first.replace(/^The runner (on that server )?/, "")
}

/** One line, its words cleaned: a few of them came from a server or a file. */
function line(
  check: CheckId,
  result: Exclude<CheckResult, "not checked">,
  detail: string,
  next?: string
): CheckLine {
  return {
    check,
    label: LABELS[check],
    result,
    detail: sanitize(detail),
    ...(next === undefined ? {} : { next: sanitize(next) }),
  }
}
export const good = (check: CheckId, detail: string) =>
  line(check, "good", detail)
export const warning = (check: CheckId, detail: string, next: string) =>
  line(check, "warning", detail, next)
export const problem = (check: CheckId, detail: string, next: string) =>
  line(check, "problem", detail, next)
export const notChecked = (check: CheckId): CheckLine => ({
  check,
  label: LABELS[check],
  result: "not checked",
  detail: "",
})
