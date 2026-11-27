/**
 * The older programs, taken from git for the pairing tests (specs/014-deploy-v2,
 * research R22): runner 0.1.0, the release every server runs, and the zekno
 * from before deploy version 2. Each is extracted from this clone's history
 * into a temporary folder, with the packages already installed in this
 * repository linked in, so nothing is downloaded and the working tree is
 * never touched.
 */
import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "./helpers"

/** Runner 0.1.0: protocol 2, deploys of version 1 only. */
export const OLDER_RUNNER = "runner-v0.1.0"
/** The commit of `dev` this feature started from: the zekno from before version 2. */
export const BEFORE = "e7b0146d33a4683aace174f2e0c3d1e4ee1e3b19"
/**
 * The tip of feature 014 on `dev` (specs/015-domains-https, T015): the runner
 * and the zekno of deploy version 2, protocol 3, from before routes were
 * carried out. Its runner writes the state marked 2 and refuses mark 3.
 */
export const DEPLOY_V2 = "92788251a92a8b89c9b631dfb39f11ce3d3d0b81"
/**
 * Runner 0.1.1, the release before feature 016 (specs/016-build-from-source,
 * contracts/runner.md RB18; core.md CO18): protocol 5, the state marked 4,
 * routes and domains, and no build.
 */
export const RELEASED = "runner-v0.1.1"

const ROOT = join(import.meta.dir, "../../../..")
/** What is taken from git: the core library and the two programs. */
const PARTS = ["packages/core", "apps/runner", "apps/cli"]
/** The folders whose installed packages the older code imports: the root's and each part's. */
const PLACES = ["", "apps/cli", "apps/runner", "packages/core"]
/** The parts that import the core library, which must reach the copy's own. */
const USES_CORE = ["apps/cli", "apps/runner"]

/** Each ref's folder, or undefined when this clone does not have it. Once per ref per process. */
const trees = new Map<string, string | undefined>()

/** True when `ref` names a commit this clone has. */
function inHistory(ref: string): boolean {
  try {
    const found = Bun.spawnSync(["git", "cat-file", "-e", `${ref}^{commit}`], {
      cwd: ROOT,
      stdout: "ignore",
      stderr: "ignore",
    })
    return found.exitCode === 0
  } catch {
    // No git on this machine: the older programs cannot be had either.
    return false
  }
}

/** Links every installed package of one folder into the copy, except the workspace's own. */
function linkInstalled(tree: string, place: string): void {
  const installed = join(ROOT, place, "node_modules")
  if (!existsSync(installed)) return
  const copy = join(tree, place, "node_modules")
  mkdirSync(copy, { recursive: true })
  for (const entry of readdirSync(installed)) {
    // `@workspace` holds today's core library; the copy gets its own below.
    if (entry === "@workspace") continue
    symlinkSync(join(installed, entry), join(copy, entry))
  }
}

/** Extracts the parts at `ref` with `git archive <ref> | tar -x` and links what they import. */
function extract(ref: string): string {
  const tree = tempDir(`older-${ref.slice(0, 13).replace(/[^\w.-]/g, "-")}`)
  const archive = Bun.spawnSync(["git", "archive", ref, ...PARTS], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (archive.exitCode !== 0)
    throw new Error(`git archive ${ref} failed: ${archive.stderr.toString()}`)
  const unpacked = Bun.spawnSync(["tar", "-x", "-C", tree], {
    stdin: archive.stdout,
    stdout: "ignore",
    stderr: "pipe",
  })
  if (unpacked.exitCode !== 0)
    throw new Error(
      `tar could not unpack ${ref}: ${unpacked.stderr.toString()}`
    )
  for (const place of PLACES) linkInstalled(tree, place)
  for (const place of USES_CORE) {
    const scope = join(tree, place, "node_modules", "@workspace")
    mkdirSync(scope, { recursive: true })
    symlinkSync(join(tree, "packages/core"), join(scope, "core"))
  }
  return tree
}

/**
 * The folder holding `packages/core`, `apps/runner` and `apps/cli` as they
 * were at `ref`, ready to run, or undefined when this clone's history does
 * not have `ref` (a shallow clone, say): it then prints why, once, and the
 * pairing tests skip. Extracted once per ref per process; the caller may
 * remove the folder, and the next call extracts it again.
 */
export function olderTree(ref: string): string | undefined {
  if (trees.has(ref)) {
    const known = trees.get(ref)
    if (known === undefined || existsSync(known)) return known
  }
  const tree = inHistory(ref) ? extract(ref) : undefined
  if (tree === undefined)
    console.log(
      `Skipping the pairing tests: ${ref} is not in this clone's history.`
    )
  trees.set(ref, tree)
  return tree
}

/**
 * The command that starts the runner of `tree` with the stand-in Docker at
 * `docker`: for `Bun.spawn` with the runner's command word added, or as a
 * zekno's `localRunner`. Its folder comes from `ZEKNO_RUNNER_HOME`, as for
 * today's runner. `--no-env-file` keeps Bun from reading a `.env` file of
 * the folder it is started in, as the released runner never does.
 */
export function olderRunner(tree: string, docker: string): string[] {
  return [
    "env",
    `ZEKNO_DOCKER=${docker}`,
    process.execPath,
    "--no-env-file",
    join(tree, "apps/runner/src/main.ts"),
  ]
}

/** A value made by the older zekno's own code, to be handed back to it unchanged. */
type Older<Kind extends string> = { readonly olderZekno: Kind }

/** The older `memoryKeyStore()` (`profile/keystore.ts`): a key store in memory, never the keychain. */
export type OlderKeyStore = {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  size(): number
}

/**
 * What the older `run` takes: the parts of its `Deps` (`cli/context.ts` at
 * `BEFORE`) a test gives. There is no `fetch`, so it can never reach the
 * network.
 */
export type OlderDeps = {
  /** The profile folder: a temporary one, never `~/.zekno`. */
  home: string
  cwd: string
  keyStore: OlderKeyStore
  connect: OlderZekno["connect"]
  ui: Older<"ui">
  /** The command that starts a runner on this machine, for `--local`: `olderRunner`, or today's. */
  localRunner: string[]
  /** The runner release it checks servers against; its own runner-release.json when left out. */
  release?: unknown
}

/** The zekno of `BEFORE`, run in the test's own process. */
export type OlderZekno = {
  /** Runs one command (`cli/cli.ts`) and gives its exit status. */
  run(argv: string[], deps: OlderDeps): Promise<number>
  /** Its plain interface (`ui/plain/plain.ts`): result lines to `out`, warnings and errors to `err`. */
  plainUi(
    out: (line: string) => void,
    err: (line: string) => void,
    remote?: (text: string) => void | Promise<void>
  ): Older<"ui">
  /** How it reaches a runner (`server/transport.ts`). */
  connect(
    target: unknown,
    localRunner: string[],
    options?: unknown
  ): Older<"transport">
  memoryKeyStore(): OlderKeyStore
}

/** Imports the older zekno's parts from `tree`, as made by `olderTree(BEFORE)`. */
export async function olderZekno(tree: string): Promise<OlderZekno> {
  const at = (path: string) => join(tree, "apps/cli/src", path)
  const cli = (await import(at("cli/cli.ts"))) as Pick<OlderZekno, "run">
  const plain = (await import(at("ui/plain/plain.ts"))) as Pick<
    OlderZekno,
    "plainUi"
  >
  const transport = (await import(at("server/transport.ts"))) as Pick<
    OlderZekno,
    "connect"
  >
  const keystore = (await import(at("profile/keystore.ts"))) as Pick<
    OlderZekno,
    "memoryKeyStore"
  >
  return {
    run: cli.run,
    plainUi: plain.plainUi,
    connect: transport.connect,
    memoryKeyStore: keystore.memoryKeyStore,
  }
}
