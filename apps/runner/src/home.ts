/**
 * The runner's folder on the server: the server's key, the state the core
 * library asks it to remember, and the service definition of each app.
 * Nothing decrypted is ever written here.
 */
import { randomBytes } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const SYSTEM_HOME = "/var/lib/zekno"

/**
 * Where the runner keeps its key and state when nothing says otherwise: the
 * system folder for root, or when it is already there (a server set up by an
 * earlier version); a folder in the user's own home for anyone else, who
 * could not create the system one.
 */
export function defaultHome(input: { isRoot: boolean; systemExists: boolean; userHome: string }): string {
  if (input.isRoot || input.systemExists) return SYSTEM_HOME
  return join(input.userHome, ".local", "state", "zekno")
}

export function homeDir(): string {
  if (process.env.ZEKNO_RUNNER_HOME) return process.env.ZEKNO_RUNNER_HOME
  return defaultHome({
    isRoot: typeof process.getuid === "function" && process.getuid() === 0,
    systemExists: existsSync(SYSTEM_HOME),
    userHome: homedir(),
  })
}

const paths = (dir: string) => ({
  secretKey: join(dir, "server.key"),
  publicKey: join(dir, "server.pub"),
  state: join(dir, "state.json"),
  lock: join(dir, "lock"),
  compose: (app: string) => join(dir, "apps", app, "compose.yaml"),
})

const token = () => randomBytes(12).toString("hex")

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
}

/**
 * True when the folder and the key file belong to this user and nobody else
 * can read or write them. A runner started with someone else's folder, or
 * with a key others can read, refuses to act.
 */
export function isPrivate(dir: string): boolean {
  const mine = typeof process.getuid === "function" ? process.getuid() : undefined
  for (const path of [dir, paths(dir).secretKey]) {
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
 * of either, and so that the new content survives a power loss.
 */
function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.${token()}.tmp`
  // Exclusive create: never follows a link someone left at this name.
  const handle = openSync(temporary, "wx", 0o600)
  try {
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
export function writeKeys(dir: string, keys: { publicKey: string; secretKey: string }): void {
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

export function readKeys(dir: string): { publicKey: string; secretKey: string } {
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
export function writeCompose(dir: string, app: string, compose: string): string {
  const path = paths(dir).compose(app)
  ensureDir(join(dir, "apps"))
  ensureDir(join(dir, "apps", app))
  writeAtomic(path, compose)
  return path
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Takes the lock that keeps runs from overlapping. Returns a function that
 * releases it, or undefined when another run holds it.
 *
 * The lock file is created complete, by linking a finished file into place,
 * so it is never seen empty. Its content is this run's own mark, and only
 * the run whose mark is in the file removes it. A lock left by a run that no
 * longer exists is moved aside before it is replaced, so two runs cannot
 * both take it over. A lock whose content cannot be read counts as held.
 */
export function acquireLock(dir: string): (() => void) | undefined {
  ensureDir(dir)
  const path = paths(dir).lock
  const mark = `${process.pid}:${token()}`

  const tryCreate = (): boolean => {
    const temporary = `${path}.${token()}.new`
    writeFileSync(temporary, mark, { flag: "wx", mode: 0o600 })
    try {
      linkSync(temporary, path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return false
    } finally {
      unlinkSync(temporary)
    }
  }
  const release = () => {
    try {
      if (readFileSync(path, "utf8") === mark) unlinkSync(path)
    } catch {
      // Already gone: nothing to release.
    }
  }

  if (tryCreate()) return release

  let held: string
  try {
    held = readFileSync(path, "utf8")
  } catch {
    return tryCreate() ? release : undefined // released in between
  }
  const holder = Number(held.split(":")[0])
  if (!Number.isInteger(holder) || holder <= 0 || isAlive(holder)) return undefined

  // The holder is gone. Move its lock aside; only one run can win this rename.
  const aside = `${path}.${token()}.stale`
  try {
    renameSync(path, aside)
  } catch {
    return undefined // another run got there first
  }
  if (readFileSync(aside, "utf8") !== held) {
    // We moved a fresh lock, not the stale one. Put it back and step away.
    try {
      linkSync(aside, path)
    } catch {
      // A newer lock is already in place.
    }
    unlinkSync(aside)
    return undefined
  }
  unlinkSync(aside)
  return tryCreate() ? release : undefined
}
