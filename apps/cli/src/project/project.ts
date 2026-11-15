/**
 * The project file, `zekno.json` (data-model.md): which app a folder
 * deploys, to which server, from which Compose file. It saves typing `--app`
 * and `--server`; flags always win over it.
 *
 * It travels with a repository, and whoever wrote it chose the app and the
 * server, so it is not trusted as it stands. It may have come with a cloned
 * repository, or been put in a parent folder by someone else, so:
 *
 * - its schema is strict, an unknown field is an error, and at most
 *   `PROJECT_BYTES` of it are read;
 * - it is looked for from the current folder up to the home folder, never in
 *   a folder above home (above home other people's files live), and it is
 *   used only as a regular file of its own that belongs to this user: never
 *   through a symbolic link, never a pipe or a device;
 * - the Compose file it names must stay inside its folder, also once
 *   symbolic links are followed;
 * - the server it names is looked up in the verified profile, and the app
 *   name is held to the app-name pattern, before anything is sent;
 * - it is used only when it is signed by the team (`signerOf`): its `signed`
 *   field is a link a current member signed (packages/core, link.ts), checked
 *   against the verified team list, and it says exactly what the three plain
 *   fields say. A file from someone outside the team cannot carry one, so it
 *   is refused outright and not even offered;
 * - a signature proves who wrote a file, not where it sits: anyone who can
 *   read a repository can copy its zekno.json beside another Compose file.
 *   So a file signed by the team is used without a question only once it
 *   was used in its folder on this machine, byte for byte (accepted.ts,
 *   `links.json`). The first time, the person is shown what it names and
 *   asked once, `zekno link` included; where nobody can answer, the command
 *   stops, and `zekno link` records it only with `--yes`;
 * - the Compose file it names is used only with the app it names (a command
 *   given another `--app` deploys its own folder's compose.yaml);
 * - it is written only when asked, never over an existing one without
 *   `--force`, never through a link, and holds three names and the team's
 *   signature of them: no secret and no key.
 */
import { EnvelopeSchema, verifyLink, type Envelope, type Member, type TeamTrust } from "@workspace/core"
import { randomBytes } from "node:crypto"
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
  type Stats,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"

import { accept, isAccepted, sha256Of } from "./accepted"
import { CliError, NOTHING_DONE, UsageError } from "../cli/errors"
import { NAME } from "../profile/profile"
import { sanitize } from "../server/sanitize"

export const PROJECT_FILE = "zekno.json"
/** The Compose file a folder deploys when nothing names another. */
export const DEFAULT_COMPOSE = "compose.yaml"
/** The most of a project file that is read. Three short names fit many times over. */
export const PROJECT_BYTES = 4096

/** A path as a person reads it: under their home folder it starts with `~`. */
export function tilde(path: string, home = homedir()): string {
  if (path === home) return "~"
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** A path for a sentence. A folder's name can hold anything, escape sequences included, so it is cleaned. */
export const shownPath = (path: string): string => sanitize(tilde(path))

/**
 * A relative path that stays inside the folder: not absolute, no `..` part,
 * no backslash (it would mean something else on another system), and no
 * control or invisible character.
 */
function isInsidePath(path: string): boolean {
  if (isAbsolute(path) || /[\p{C}\\]/u.test(path)) return false
  return !path.split("/").includes("..")
}

const ComposePathSchema = z.string().min(1).max(255).refine(isInsidePath)

/**
 * The three plain fields, for people, and `signed`, the team's signature of
 * them (`signerOf`). A file without `signed` is well-formed, and not signed
 * by the team.
 */
const ProjectSchema = z.strictObject({
  app: z.string().regex(NAME),
  server: z.string().regex(NAME),
  compose: ComposePathSchema.optional(),
  signed: EnvelopeSchema.optional(),
})

/** What a project file says, and where it is. `compose` is relative to `folder`. */
export type ProjectLink = {
  app: string
  server: string
  compose: string
  /** The link a member signed, as the file holds it: not yet checked (`signerOf`). */
  signed?: Envelope
  /** The folder that holds the file. */
  folder: string
  /** The file itself, as a real path: what `links.json` records it by. */
  path: string
  /** The SHA-256 of its bytes, exactly as they were read and parsed. */
  sha256: string
}

/** The sentence for what is wrong with a project file's content. It quotes field names only, cleaned. */
function problemOf(issues: readonly z.core.$ZodIssue[]): string {
  const unknown = issues.flatMap((issue) => (issue.code === "unrecognized_keys" && issue.path.length === 0 ? issue.keys : []))
  if (unknown.length > 0) {
    const names = unknown.map((key) => `"${[...sanitize(key)].slice(0, 40).join("")}"`).join(", ")
    return `has a field zekno does not read: ${names}. It holds only "app", "server", "compose" and "signed".`
  }
  const field = issues[0]?.path[0]
  if (field === "app") return `needs "app": an app name of lowercase letters, digits and hyphens.`
  if (field === "server") return `needs "server": a server name of lowercase letters, digits and hyphens.`
  if (field === "compose") return `has a "compose" that is not a relative path inside its folder.`
  if (field === "signed") return `has a "signed" that is not a signature zekno reads. Run \`zekno link --app <name> --server <name> --force\` to sign it again.`
  return `is not a JSON object with an "app", a "server" and a "compose".`
}

/** Whether a file belongs to the user running zekno. Where there are no user ids, there is nothing to compare. */
function ownedByMe(stat: Stats): boolean {
  const uid = process.getuid?.()
  return uid === undefined || stat.uid === uid
}

const linkSentence = (shown: string) => `${shown} is a symbolic link. zekno reads zekno.json only as a file of its own, never through a link.`

/**
 * Checks what is at a project file's path before anything is opened: a
 * regular file of this user's, not a link. A link is refused rather than
 * followed or passed over: followed, it would let the file's content come
 * from anywhere; passed over, a folder that looks linked would quietly
 * deploy as if it were not.
 */
function checkEntry(stat: Stats, shown: string): void {
  if (stat.isSymbolicLink()) throw new CliError(linkSentence(shown))
  if (!stat.isFile()) throw new CliError(`${shown} is not a file.`)
  if (!ownedByMe(stat)) throw new CliError(`${shown} belongs to another user, so zekno does not use it.`)
}

/**
 * The text of a project file and the SHA-256 of its bytes, read from the
 * file that was checked: never through a link, never more than
 * `PROJECT_BYTES`. What is parsed and what is compared with the accepted
 * list come from this one read.
 */
function readText(path: string, shown: string): { text: string; sha256: string } {
  let fd: number
  try {
    // No link is followed, and a pipe swapped in after the check cannot hold the read up.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    // The file was replaced by a link after it was looked at.
    if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new CliError(linkSentence(shown))
    throw new CliError(`${shown} could not be read.`)
  }
  try {
    // What was opened is checked again: the path may have changed since it was looked at.
    checkEntry(fstatSync(fd), shown)
    const buffer = Buffer.alloc(PROJECT_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null)
      if (read === 0) break
      length += read
    }
    if (length > PROJECT_BYTES) throw new CliError(`${shown} is larger than the ${PROJECT_BYTES} bytes a project file may have.`)
    const bytes = buffer.subarray(0, length)
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), sha256: sha256Of(bytes) }
    } catch {
      throw new CliError(`${shown} is not valid JSON.`)
    }
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`${shown} could not be read.`)
  } finally {
    closeSync(fd)
  }
}

/** A JSON string, as it is written: what is between its quotes is read with `JSON.parse`. */
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\.)*"/y

/** How deep objects nest in a project file: the file, `signed`, and its `signature`. */
const NESTING = 3

/**
 * The keys of a JSON object, in the order written, each as `JSON.parse`
 * reads it, when each value is a string or an object of the same kind, at
 * most `NESTING` deep (as `signed` is). `JSON.parse` keeps only the last of a
 * key written twice, so this is how a second "app" is noticed. The outer
 * object's keys are returned; an object inside it that has a key twice makes
 * the answer undefined, as does text of any other shape.
 */
export function objectKeys(text: string): string[] | undefined {
  let at = 0
  const space = () => {
    while (at < text.length && " \t\n\r".includes(text[at]!)) at++
  }
  const string = (): string | undefined => {
    JSON_STRING.lastIndex = at
    const found = JSON_STRING.exec(text)?.[0]
    if (found === undefined) return undefined
    at += found.length
    return JSON.parse(found) as string
  }
  const object = (depth: number): string[] | undefined => {
    if (depth > NESTING || text[at++] !== "{") return undefined
    const keys: string[] = []
    space()
    if (text[at] === "}") {
      at++
      return keys
    }
    for (;;) {
      space()
      const key = string()
      if (key === undefined) return undefined
      keys.push(key)
      space()
      if (text[at++] !== ":") return undefined
      space()
      if (text[at] === "{") {
        const inner = object(depth + 1)
        if (inner === undefined || new Set(inner).size !== inner.length) return undefined
      } else if (string() === undefined) return undefined
      space()
      const next = text[at++]
      if (next === "}") return keys
      if (next !== ",") return undefined
    }
  }
  space()
  const keys = object(1)
  space()
  return at === text.length ? keys : undefined
}

/** Reads and checks the project file at `path`, in `folder`. Every problem stops the command and names the file. */
function readProject(path: string, folder: string, entry: Stats): ProjectLink {
  const shown = shownPath(path)
  checkEntry(entry, shown)
  const { text, sha256 } = readText(path, shown)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new CliError(`${shown} is not valid JSON.`)
  }
  const parsed = ProjectSchema.safeParse(json)
  if (!parsed.success) throw new CliError(`${shown} ${problemOf(parsed.error.issues)}`)
  // A field written twice is read as its last value, which someone reading the file from the top may not notice.
  const keys = objectKeys(text)
  if (keys === undefined || new Set(keys).size !== keys.length) throw new CliError(`${shown} has the same field more than once.`)
  const { app, server, compose = DEFAULT_COMPOSE, signed } = parsed.data
  return { app, server, compose, ...(signed === undefined ? {} : { signed }), folder, path, sha256 }
}

/** A folder as it really is, with no link in its path; as given when that cannot be found out. */
function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** The home folder as given and as it really is, when that differs: a folder above either is above home. */
function homesOf(home: string): string[] {
  const given = resolve(home)
  const found = real(given)
  return found === given ? [given] : [given, found]
}

/** Whether `dir` holds `path` somewhere below it. */
export const isAbove = (dir: string, path: string): boolean => dir !== path && path.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)

/**
 * Whether a folder's listing has a file named exactly zekno.json. On a file
 * system that ignores case, `ZEKNO.JSON` is found under that name too, and it
 * is not a project file: what a person sees in the folder is what counts.
 */
function listedExactly(dir: string, shown: string): boolean {
  try {
    return readdirSync(dir).includes(PROJECT_FILE)
  } catch {
    throw new CliError(`${shown} could not be read.`)
  }
}

/**
 * The project file that applies to `start`: the one in `start`, or else in
 * the nearest folder above it. The folders are those `start` really is in,
 * as the working folder a program is given always is. The search ends at the
 * home folder (whose own zekno.json counts) or at the filesystem root, and
 * never reads one from a folder above home. Undefined when there is none. A
 * file that is there but not right (a link, another user's, too large,
 * malformed) is an error that names it. Whether this machine accepted it is
 * not decided here (`isAccepted`).
 */
export function findProject(start: string, home = homedir()): ProjectLink | undefined {
  const homes = homesOf(home)
  for (let dir = real(resolve(start)); ; ) {
    if (homes.some((folder) => isAbove(dir, folder))) return undefined
    const path = join(dir, PROJECT_FILE)
    let entry: Stats | undefined
    try {
      entry = lstatSync(path)
    } catch {
      // Not there, or a folder that cannot be looked into: nothing applies from it.
      entry = undefined
    }
    if (entry && listedExactly(dir, shownPath(path))) return readProject(path, dir, entry)
    const parent = dirname(dir)
    if (homes.includes(dir) || parent === dir) return undefined
    dir = parent
  }
}

/** Where zekno.json in `folder` is, as `findProject` and `links.json` name it: by its real path. */
export const projectFileIn = (folder: string): string => join(real(resolve(folder)), PROJECT_FILE)

/** Whether a project file is in the folder a command runs in, `cwd`, rather than in one above it. */
export const isHere = (link: Pick<ProjectLink, "folder">, cwd: string): boolean => link.folder === real(resolve(cwd))

/**
 * The Compose file `zekno link -f <file>` names, as zekno.json keeps it:
 * relative to `folder`, where zekno.json is written. It must be a file inside
 * that folder, also once symbolic links are followed.
 */
export function composeFor(folder: string, file: string): string {
  const path = resolve(folder, file)
  const named = relative(folder, path).split(sep).join("/")
  if (named === "" || isAbove(path, folder) || !ComposePathSchema.safeParse(named).success) {
    throw new UsageError("The Compose file has to be inside this folder, since zekno.json names it from here.")
  }
  let real: string
  let root: string
  try {
    real = realpathSync(path)
  } catch {
    throw new CliError(`No Compose file at ${shownPath(path)}. Point to one with \`-f <file>\`.`)
  }
  try {
    root = realpathSync(folder)
  } catch {
    throw new CliError(`${shownPath(folder)} could not be read.`)
  }
  if (!isAbove(root, real)) {
    throw new CliError(`${sanitize(named)} leads outside this folder through a symbolic link, so zekno.json cannot name it.`)
  }
  let isFile: boolean
  try {
    isFile = statSync(real).isFile()
  } catch {
    isFile = false
  }
  if (!isFile) throw new CliError(`${shownPath(path)} is not a file.`)
  return named
}

/** The details a command can take from the project file. `file` is the Compose file, as `-f` gives it. */
export type Details = { app?: string; server?: string; file?: string }

/**
 * What `withProject` adds. `serverFrom` is the project file's path, as a
 * sentence shows it, when the server came from it: for the sentence when no
 * such server is connected. `project` is the project file in use whose
 * Compose file is deployed, when `-f` was not given and the app is its app.
 */
export type FromProject = { serverFrom?: string; project?: ProjectLink }

/** Where a project file and the list of files used here are looked for: the profile folder, and the home folder the search stops at. */
export type ProjectPlaces = { profile: string; home?: string }

/**
 * The member who signed a project file, when it is signed by the team
 * (data-model.md): `signed` is a link that a member of the verified team
 * list, as it is now, signed for this team and one of its servers
 * (`verifyLink`), and it says exactly what the plain fields say: the same
 * app, the same Compose file, and the server the team list names by the
 * signed id. Undefined for any other file: no signature, another team's, a
 * removed member's, one edited after signing, or one for a server of
 * another name.
 */
export function signerOf(link: ProjectLink, trust: TeamTrust): Member | undefined {
  if (link.signed === undefined) return undefined
  const verified = verifyLink(trust, link.signed)
  if (!verified.ok) return undefined
  const { serverId, app, compose, signer } = verified.value
  const server = trust.servers.find((entry) => entry.serverId === serverId)
  return app === link.app && compose === link.compose && server?.name === link.server ? signer : undefined
}

/**
 * How a project file stands on this machine (data-model.md, "When a project
 * file is used"): not signed by the team; signed by the team and not yet used
 * in its folder here (`new`); or signed and used here before, byte for byte
 * (`used`). `member` is the signer's name from the team list, cleaned.
 */
export type Standing = { kind: "unsigned" } | { kind: "new" | "used"; member: string }

export function standingOf(link: ProjectLink, trust: TeamTrust, profile: string): Standing {
  const signer = signerOf(link, trust)
  if (!signer) return { kind: "unsigned" }
  return { kind: isAccepted(profile, link) ? "used" : "new", member: sanitize(signer.name) }
}

/** Said when a command would take a name from a zekno.json not signed by the team (S1). */
export const notSigned = (link: ProjectLink): string =>
  `zekno.json in ${shownPath(link.folder)} is not signed by your team, so zekno does not use it. It names ${link.app} on ${link.server}. ` +
  "To link this folder yourself, run `zekno link --app <name> --server <name> --force`. To leave the file aside, give --app and --server."

/** The same, as the app says it on Home about the folder it was started in, `cwd`. */
export function notSignedHere(link: ProjectLink, cwd: string): string {
  const which = isHere(link, cwd) ? "zekno.json here" : shownPath(link.path)
  return `${which} is not signed by your team, so zekno does not use it. It names ${link.app} on ${link.server}.`
}

/** Said where nobody can answer the question for a file signed by the team and not yet used here (S2). */
export const notUsedHere = (member: string, link: ProjectLink): string =>
  `${member} linked ${shownPath(link.folder)} to ${link.app} on ${link.server}, and it has not been used in this folder on this machine. ` +
  "To use it, run `zekno link` there once and answer its question, or `zekno link --yes` from a script. To leave it aside, give --app and --server."

/** Said by `zekno link` without `--yes` where there is no terminal to ask on. */
export const noTerminalToUse = (member: string, link: ProjectLink): string =>
  `There is no terminal to ask on. ${member} linked ${shownPath(link.folder)} to ${link.app} on ${link.server}. Add \`--yes\` to use it here.`

/**
 * A project file in a folder above the one a command runs in: that folder,
 * and the Compose file it names, as a sentence shows them. A "yes" deploys
 * that Compose file, not the one beside the person, so the question says
 * which. Undefined for a file in the folder the command runs in.
 */
export function aboveOf(link: ProjectLink, cwd: string): { folder: string; compose: string } | undefined {
  if (isHere(link, cwd)) return undefined
  return { folder: shownPath(link.folder), compose: shownPath(join(link.folder, link.compose)) }
}

/**
 * The question at a terminal the first time a file signed by the team is
 * met here: who linked which folder to what (the folder and its Compose file
 * named when the file is in a folder above, `aboveOf`), and, when a flag
 * sends the command to another app or server than the file names (`uses`),
 * where it goes instead.
 */
export function useQuestion(member: string, link: ProjectLink, cwd: string, uses?: { app: string; server: string }): string {
  const above = aboveOf(link, cwd)
  const linked = above
    ? `${member} linked ${above.folder} to ${link.app} on ${link.server}, with ${above.compose}.`
    : `${member} linked this folder to ${link.app} on ${link.server}.`
  const elsewhere = uses && (uses.app !== link.app || uses.server !== link.server) ? ` This command uses ${uses.app} on ${uses.server}.` : ""
  return `${linked}${elsewhere} Use it here?`
}

/** Said when the question is answered no. It lives in errors.ts, with `Left`, and is kept here for whoever imports it from here. */
export { NOTHING_DONE } from "../cli/errors"

/**
 * What judging a project file needs, beyond the files: the verified team
 * list, and a way to ask. `trust` reads the keychain, so it is called only
 * once there is a file to judge; nothing is signed with it. `confirm` asks a
 * yes-or-no question at a terminal and throws a `CliError` with `refusal`
 * where there is none (`Ui.confirm`).
 */
export type ProjectJudge = {
  trust(): Promise<TeamTrust>
  confirm(question: string, refusal: string): Promise<boolean>
}

/**
 * What a single command at a terminal adds (specs/006-cli-small-features,
 * research R6): a file not signed by the team is then named with
 * `leaveAside(sentence)` and left aside, as if it were not there, and the
 * command asks for what is missing. Without it such a file stops the command
 * (S1), as it always has where nobody can answer.
 */
export type ProjectAside = { leaveAside?: (sentence: string) => void }

/**
 * The first time a file signed by the team is met in its folder on this
 * machine: what it names is shown and the person is asked once (`question`).
 * Yes records it in `links.json`; anything else does nothing and stops the
 * command. Where nobody can answer, the command stops with `refusal`, as for
 * wrong usage, with exit status 2. `zekno link` asks this too: recording the
 * file is the same decision.
 */
export async function useOnce(
  link: ProjectLink,
  asking: { question: string; refusal: string },
  places: Pick<ProjectPlaces, "profile"> & Pick<ProjectJudge, "confirm">
): Promise<void> {
  let yes: boolean
  try {
    yes = await places.confirm(asking.question, asking.refusal)
  } catch (error) {
    if (error instanceof CliError) throw new UsageError(error.message)
    throw error
  }
  if (!yes) throw new CliError(NOTHING_DONE)
  accept(places.profile, link)
}

/**
 * What a command was given, with each detail it was not given taken from the
 * project file: flags win, one detail at a time. The file is looked for only
 * when a wanted detail is missing, so a command given every flag never reads
 * it.
 *
 * A name is taken only from a file signed by the team (`standingOf`): one
 * that is not would choose an app and a server unasked, and hand them a
 * Compose file from a folder nobody in the team made, with the app's
 * secrets. Such a file stops the command (S1). A file signed by the team that
 * was not used here before is asked about once at a terminal, and stops the
 * command where nobody can answer (S2). The question says where the command
 * goes when a flag sends it to another app or server than the file names: a
 * "yes" to the file's names must not send its folder somewhere unsaid.
 * Judging reads the verified team list from the keychain; every refusal
 * comes before any signer is made and before anything is signed or sent.
 *
 * Given both `--app` and `--server`, the file is left aside unless it is in
 * use here, and is never asked about; one that cannot be read then counts as
 * no project file. Its Compose file goes with its app: with another app
 * named by `--app`, the Compose file is `-f`, or compose.yaml in the current
 * folder, as without a project file.
 */
export async function withProject<T extends Details>(
  cwd: string,
  given: T,
  wanted: readonly (keyof Details)[],
  places: ProjectPlaces & ProjectJudge & ProjectAside
): Promise<T & FromProject> {
  const missing = wanted.filter((detail) => given[detail] === undefined)
  if (missing.length === 0) return given
  const named = !missing.includes("app") && !missing.includes("server")
  let link: ProjectLink | undefined
  try {
    link = findProject(cwd, places.home)
  } catch (error) {
    // Given both names, only its Compose file could come from it: one that cannot be read gives none.
    if (named && error instanceof CliError) return given
    throw error
  }
  if (!link) return given
  if (named) {
    // Only its Compose file could come from it, for its own app, and only from a file in use here.
    if (!missing.includes("file") || given.app !== link.app || !isAccepted(places.profile, link)) return given
    return standingOf(link, await places.trust(), places.profile).kind === "used" ? { ...given, project: link } : given
  }
  const standing = standingOf(link, await places.trust(), places.profile)
  if (standing.kind === "unsigned") {
    // At a terminal the person names what is missing instead, as `--app` and `--server` would; nothing of the file is used.
    if (places.leaveAside) {
      places.leaveAside(notSignedHere(link, cwd))
      return given
    }
    throw new UsageError(notSigned(link))
  }
  if (standing.kind === "new") {
    // Where the command goes: a typed name wins, and is cleaned for the sentence. One the command does not take changes nothing.
    const uses = { app: wanted.includes("app") ? sanitize(given.app ?? link.app) : link.app, server: sanitize(given.server ?? link.server) }
    const question = useQuestion(standing.member, link, cwd, uses)
    await useOnce(link, { question, refusal: notUsedHere(standing.member, link) }, places)
  }
  const filled: T & FromProject = { ...given }
  if (missing.includes("app")) filled.app = link.app
  if (missing.includes("server")) {
    filled.server = link.server
    filled.serverFrom = shownPath(link.path)
  }
  if (missing.includes("file") && filled.app === link.app) filled.project = link
  return filled
}

/**
 * What a project file holds, exactly as it is written: three names, each
 * held to its rule, and the team's signature of them when there is one.
 * Nothing else can go in, and it always fits what is read back.
 */
export function projectText(link: { app: string; server: string; compose: string; signed?: Envelope }): string {
  const fields = { app: link.app, server: link.server, compose: link.compose, ...(link.signed === undefined ? {} : { signed: link.signed }) }
  const parsed = ProjectSchema.safeParse(fields)
  if (!parsed.success) throw new CliError("zekno.json holds only an app name, a server name and a Compose file inside its folder.")
  const { app, server, compose, signed } = parsed.data
  const text = `${JSON.stringify(signed === undefined ? { app, server, compose } : { app, server, compose, signed }, null, 2)}\n`
  if (Buffer.byteLength(text) > PROJECT_BYTES) throw new CliError(`zekno.json would be larger than the ${PROJECT_BYTES} bytes a project file may have.`)
  return text
}

/** Said when zekno.json would be written over one that is there, without `--force` (A15 of specs/006-cli-small-features). */
export const alreadyLinked = (folder: string): string => `There is already a ${PROJECT_FILE} in ${shownPath(folder)}. Run \`zekno link --force\` to replace it.`

/** File systems where a hard link cannot be made; writing there checks first, then renames. */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK", "ENOSYS"])

/**
 * Writes `zekno.json` in `folder`, as one whole file or not at all: a new
 * file under a name nobody can predict, mode 644, then put in place. Without
 * `force` it is put in place with a hard link, which fails if anything is
 * already there, so an existing file is never replaced, not even one that
 * appears in between. With `force` a rename replaces what is there: a link
 * is replaced itself, never written through. Returns the file's path.
 */
export function writeProject(folder: string, link: Parameters<typeof projectText>[0], force = false): string {
  const text = projectText(link)
  const path = join(folder, PROJECT_FILE)
  const shown = shownPath(path)
  const already = new CliError(alreadyLinked(folder))
  const temporary = join(folder, `.${PROJECT_FILE}.${randomBytes(8).toString("hex")}.tmp`)
  try {
    // `wx` refuses a file or link that is already there under this name.
    const fd = openSync(temporary, "wx", 0o644)
    try {
      fchmodSync(fd, 0o644)
      writeSync(fd, text)
    } finally {
      closeSync(fd)
    }
    if (force) {
      renameSync(temporary, path)
      return path
    }
    try {
      linkSync(temporary, path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (code === "EEXIST") throw already
      if (!NO_HARD_LINKS.has(code)) throw error
      if (exists(path)) throw already
      renameSync(temporary, path)
    }
    return path
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(`Could not write ${shown}.`)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Whether anything is at a path, a link to nowhere included. */
function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
