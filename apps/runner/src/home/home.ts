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

export function homeDir(): string {
  if (process.env.ZEKNO_RUNNER_HOME) return process.env.ZEKNO_RUNNER_HOME
  const userHome = homedir()
  return defaultHome({
    isRoot: typeof process.getuid === "function" && process.getuid() === 0,
    userHome,
    userFolderSetUp: isSetUp(userFolder(userHome)),
    ownsSystemFolder: ownedFolder(SYSTEM_HOME),
  })
}

export const paths = (dir: string) => ({
  secretKey: join(dir, "server.key"),
  publicKey: join(dir, "server.pub"),
  state: join(dir, "state.json"),
  lock: join(dir, "lock"),
  compose: (app: string) => join(dir, "apps", app, "compose.yaml"),
  proxy: join(dir, "proxy"),
  proxyEtc: join(dir, "proxy", "etc"),
  proxyConfig: join(dir, "proxy", "etc", "caddy.json"),
  proxyNext: join(dir, "proxy", "etc", "caddy.next.json"),
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
