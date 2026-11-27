/**
 * The runner's folder on the server: the server's key, the state the core
 * library asks it to remember, the service definition of each app, the
 * secret records it keeps, sealed (`records/`, in records.ts), and the
 * proxy's configuration (`proxy/etc/caddy.json`, since feature 015). Nothing
 * decrypted is ever written here.
 */
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const SYSTEM_HOME = "/var/lib/zekno"

/** The folder a user who is not root keeps the runner's key and state in. */
const userFolder = (userHome: string) =>
  join(userHome, ".local", "state", "zekno")

/**
 * Where the runner keeps its key and state when nothing says otherwise.
 * Root uses the system folder. Anyone else keeps using their own folder once
 * it is set up, so a system folder created later never takes its place; before
 * that, they use the system folder only when it is theirs (a server set up by
 * an earlier version), never one that belongs to root or another user.
 */
export function defaultHome(input: {
  isRoot: boolean
  userHome: string
  /** The user's own folder already holds a key or state. */
  userFolderSetUp: boolean
  /** `/var/lib/zekno` exists, is a folder and belongs to this user. */
  ownsSystemFolder: boolean
}): string {
  if (input.isRoot) return SYSTEM_HOME
  if (input.userFolderSetUp) return userFolder(input.userHome)
  return input.ownsSystemFolder ? SYSTEM_HOME : userFolder(input.userHome)
}

/** True when `path` is a folder that belongs to the user running this process. */
function ownedFolder(path: string): boolean {
  if (typeof process.getuid !== "function") return false
  try {
    const info = statSync(path)
    return info.isDirectory() && info.uid === process.getuid()
  } catch {
    return false
  }
}

const runsAsRoot = () =>
  typeof process.getuid === "function" && process.getuid() === 0

export function homeDir(): string {
  if (process.env.ZEKNO_RUNNER_HOME) return process.env.ZEKNO_RUNNER_HOME
  const userHome = homedir()
  return defaultHome({
    isRoot: runsAsRoot(),
    userHome,
    userFolderSetUp: isSetUp(userFolder(userHome)),
    ownsSystemFolder: ownedFolder(SYSTEM_HOME),
  })
}

/** An app's name as the core library holds it (`APP_NAME`): the only app name a build's path is made of. */
const APP = /^[a-z0-9][a-z0-9-]{0,62}$/
/** A build key, or a staged piece's fingerprint: 64 lowercase hex (contracts/core.md CO1). */
const HEX64 = /^[0-9a-f]{64}$/

/** `name` when it matches `pattern`; else throws, so no path is ever made of another name. */
function checked(name: string, pattern: RegExp): string {
  if (typeof name !== "string" || !pattern.test(name))
    throw new Error("A path of the runner's is made of checked names only.")
  return name
}

export const paths = (dir: string) => ({
  secretKey: join(dir, "server.key"),
  publicKey: join(dir, "server.pub"),
  state: join(dir, "state.json"),
  /** The deploy lock, "D" (specs/016-build-from-source, contracts/runner.md RB1). */
  lock: join(dir, "lock"),
  /** The state lock, "S": every read-then-write of the state, `packs/` and `kept/` (RB1). */
  stateLock: join(dir, "state.lock"),
  compose: (app: string) => join(dir, "apps", app, "compose.yaml"),
  proxy: join(dir, "proxy"),
  proxyEtc: join(dir, "proxy", "etc"),
  proxyConfig: join(dir, "proxy", "etc", "caddy.json"),
  proxyNext: join(dir, "proxy", "etc", "caddy.next.json"),
  // Feature 016 (contracts/runner.md, "Names and paths the runner uses"). Each
  // throws for an app name or a key that did not pass core's patterns.
  /** The sealed pieces staged for an app's deploy (RB2). */
  packs: (app: string) => join(dir, "packs", checked(app, APP)),
  /** Which deploy the staged pieces are for: the payload's hash (RB2). */
  packDeploy: (app: string) =>
    join(dir, "packs", checked(app, APP), "deploy.json"),
  /** One staged piece, by its fingerprint (RB2). */
  packPiece: (app: string, fingerprint: string) =>
    join(dir, "packs", checked(app, APP), checked(fingerprint, HEX64)),
  /** The pieces of the deploy being checked or built (RB3 K14d). */
  building: (app: string) => join(dir, "building", checked(app, APP)),
  /** The detailed record of one kept build, written mode 600 (RB11, RB14). */
  kept: (app: string, key: string) =>
    join(dir, "kept", checked(app, APP), `${checked(key, HEX64)}.json`),
  /** buildx's own folder: `buildxConfig` makes it (RB7). */
  buildx: join(dir, "buildx"),
})

export const token = () => randomBytes(12).toString("hex")

/**
 * Makes a folder only its owner can enter, if it is not there yet. The mode
 * of a folder that is already there is left as it is: making an open folder
 * private would hide that it was ever open, and the check that refuses it
 * would then pass (security review S3).
 */
export function ensureDir(dir: string): void {
  if (mkdirSync(dir, { recursive: true, mode: 0o700 }) !== undefined)
    chmodSync(dir, 0o700)
}

/**
 * Takes a folder for a runner being set up: made if it is not there, and made
 * private if it is, so an empty folder made with ordinary permissions serves.
 * Only `setup` calls it, for a folder that holds no key and no state yet.
 */
export function takeDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

/**
 * True when the folder, the key file and the state belong to this user and
 * nobody else can read or write them. A runner started with someone else's
 * folder, or with a folder, key or state others could change or read,
 * refuses to act.
 */
export function isPrivate(dir: string): boolean {
  const mine =
    typeof process.getuid === "function" ? process.getuid() : undefined
  const at = paths(dir)
  for (const path of [dir, at.secretKey, at.state]) {
    if (!existsSync(path)) continue
    const info = statSync(path)
    if (mine !== undefined && info.uid !== mine) return false
    if ((info.mode & 0o077) !== 0) return false
  }
  return true
}

/**
 * buildx's own folder, `<home>/buildx/`, as an absolute path: the value of
 * `BUILDX_CONFIG` for every build client (contracts/runner.md, "Names and
 * paths the runner uses"; RB7, RB12). Made on first use, mode 700; once
 * there, it and what buildx wrote in it are left as they are.
 */
export function buildxConfig(dir: string): string {
  const path = resolve(paths(dir).buildx)
  ensureDir(path)
  return path
}

/**
 * Where builds are unpacked when nothing says otherwise (FR-031, FR-050):
 * `/var/lib/zekno-unpacked` for root, else `~/.local/state/zekno-unpacked`,
 * also for a user whose runner's folder is the system one. Never inside the
 * runner's folder.
 */
export function defaultUnpacked(input: {
  isRoot: boolean
  userHome: string
}): string {
  return input.isRoot
    ? "/var/lib/zekno-unpacked"
    : join(input.userHome, ".local", "state", "zekno-unpacked")
}

/**
 * The folder that holds the work folders of builds: `ZEKNO_RUNNER_UNPACKED`
 * when set (a seam for tests, as `ZEKNO_RUNNER_HOME` is for the runner's
 * folder), else `defaultUnpacked`. Made mode 700 when it is not there, then
 * checked as the runner's folder is (`isPrivate`): a folder of another user,
 * or one others can enter, throws, and is left as it is.
 */
export function unpackedDir(): string {
  const dir =
    process.env.ZEKNO_RUNNER_UNPACKED ||
    defaultUnpacked({ isRoot: runsAsRoot(), userHome: homedir() })
  ensureDir(dir)
  if (!isPrivate(dir))
    throw new Error("The folder for unpacked builds is not private.")
  return dir
}

/**
 * Makes a build's own work folder, `unpackedDir()/<24 hex>/`, mode 700, and
 * gives its path. The name is random (`token`, 12 bytes from crypto); a
 * name already there, a folder or a file, is never used again: the next
 * name is tried. `nextName` is a seam for tests.
 */
export function workFolder(nextName: () => string = token): string {
  const root = unpackedDir()
  for (;;) {
    const path = join(root, nextName())
    try {
      mkdirSync(path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
      throw error
    }
    chmodSync(path, 0o700)
    return path
  }
}

function syncDir(dir: string): void {
  try {
    const handle = openSync(dir, "r")
    try {
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
  } catch {
    // Not every platform lets a folder be synced; the rename itself still happened.
  }
}

/**
 * Writes a file so that a reader sees the old content or the new, never half
 * of either, and so that the new content survives a power loss. Only its
 * owner can read it, unless `mode` says otherwise.
 */
export function writeAtomic(path: string, content: string, mode = 0o600): void {
  const temporary = `${path}.${token()}.tmp`
  // Exclusive create: never follows a link someone left at this name.
  const handle = openSync(temporary, "wx", mode)
  try {
    // The process's umask could have taken bits off a mode wider than 0600.
    fchmodSync(handle, mode)
    writeFileSync(handle, content)
    fsyncSync(handle)
    closeSync(handle)
    renameSync(temporary, path)
  } catch (error) {
    try {
      closeSync(handle)
    } catch {
      // Already closed.
    }
    try {
      unlinkSync(temporary)
    } catch {
      // Already renamed or never created.
    }
    throw error
  }
  syncDir(dirname(path))
}

export function isSetUp(dir: string): boolean {
  const at = paths(dir)
  return existsSync(at.secretKey) || existsSync(at.state)
}

/** Stores the server's key pair. Refuses to overwrite an existing key. */
export function writeKeys(
  dir: string,
  keys: { publicKey: string; secretKey: string }
): void {
  ensureDir(dir)
  const at = paths(dir)
  const handle = openSync(at.secretKey, "wx", 0o600)
  try {
    writeFileSync(handle, keys.secretKey)
    fsyncSync(handle)
  } finally {
    closeSync(handle)
  }
  writeAtomic(at.publicKey, keys.publicKey)
}

export function readKeys(dir: string): {
  publicKey: string
  secretKey: string
} {
  const at = paths(dir)
  return {
    publicKey: readFileSync(at.publicKey, "utf8").trim(),
    secretKey: readFileSync(at.secretKey, "utf8").trim(),
  }
}

export function readState(dir: string): unknown {
  return JSON.parse(readFileSync(paths(dir).state, "utf8")) as unknown
}

export function writeState(dir: string, state: unknown): void {
  ensureDir(dir)
  writeAtomic(paths(dir).state, JSON.stringify(state))
}

/** Saves the service definition of an accepted deploy and returns where it is. */
export function writeCompose(
  dir: string,
  app: string,
  compose: string
): string {
  const path = paths(dir).compose(app)
  ensureDir(join(dir, "apps"))
  ensureDir(join(dir, "apps", app))
  writeAtomic(path, compose)
  return path
}

/**
 * The folder the proxy's container mounts read-only at `/etc/zekno-proxy`
 * (specs/015-domains-https, contracts/runner.md, "Names the runner uses"),
 * as an absolute path for Docker. The folder is mounted, never the file
 * alone: a file mounted by itself is lost to the container after an atomic
 * rename (research R5).
 */
export function proxyFolder(dir: string): string {
  return resolve(paths(dir).proxyEtc)
}

/**
 * Writes the proxy's next configuration, `caddy.next.json`, beside the one in
 * place, with the runner's atomic write (RN8). It is put in place only once
 * Caddy has validated it (`placeProxyNext`), so a file Caddy would refuse
 * never takes the place of one that works (security review S7). The proxy's
 * root has no capability to read another user's private files, so the
 * folder and the files can be read by anyone who reaches them; only the
 * runner's own folder leads there, and nobody else can enter it. The files
 * hold domains and the runner's names, never a key.
 */
export function writeProxyNext(dir: string, text: string): void {
  const at = paths(dir)
  ensureDir(at.proxy)
  mkdirSync(at.proxyEtc, { recursive: true, mode: 0o755 })
  chmodSync(at.proxyEtc, 0o755)
  writeAtomic(at.proxyNext, text, 0o644)
}

/** Puts the validated next configuration in place of the proxy's file, in one rename. */
export function placeProxyNext(dir: string): void {
  const at = paths(dir)
  renameSync(at.proxyNext, at.proxyConfig)
  syncDir(at.proxyEtc)
}

/** Removes a next configuration Caddy refused; the file in place is left as it is. */
export function dropProxyNext(dir: string): void {
  try {
    unlinkSync(paths(dir).proxyNext)
  } catch {
    // Not there.
  }
}

/** The proxy's configuration as it is on disk, or undefined when there is none. */
export function readProxyConfig(dir: string): string | undefined {
  try {
    return readFileSync(paths(dir).proxyConfig, "utf8")
  } catch {
    return undefined
  }
}
