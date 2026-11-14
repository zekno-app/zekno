/**
 * One test's world: a temporary folder holding a home folder (so `~` is what
 * the app shows), the profile folder, the project folders, the file key
 * store and the runner's folder; the stand-in Docker; and, when a test asks,
 * the stand-in server with its stand-in `ssh`.
 *
 * Every process started from here (the test build of `zekno`, and through it
 * the runner and the stand-ins) gets an environment built from the
 * allow-list in `env()`, never this process's own: this process holds the
 * model key, and none of what the app starts may see it.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { fakeDocker, filesUnder } from "../../../runner/test/helpers"
import { openTeam } from "../../src/context"
import { realRunner, sshStandIn, standInServer, type StandInServer } from "../../test/stand-in-server"
import { fileKeyStore } from "./file-keystore"
import type { Launch } from "./terminal"

/** The test build of `zekno` (zekno-test.ts). */
export const ENTRY = join(import.meta.dir, "zekno-test.ts")

/** The window the app is drawn in unless a test asks for another. */
export const COLUMNS = 100
export const ROWS = 30

/** A Compose file that runs one service and expects no value. */
export const COMPOSE_PLAIN = "services:\n  web:\n    image: example/web:1\n"
/** A Compose file whose service expects GREETING, which has no secret yet. */
export const COMPOSE_GREETING = "services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n"

export type Result = { code: number; out: string; err: string }

/** Kept for a leak check (ZEKNO_E2E_KEEP=1): the folders are then left for it to search. */
const keep = () => process.env.ZEKNO_E2E_KEEP === "1"

export type World = Awaited<ReturnType<typeof createWorld>>

/** A new, empty world. Nothing is created outside its folders and the stand-ins' own temporary folders. */
/**
 * Real Docker, for the one test that runs a container: the `docker` program,
 * the daemon's address and the Compose plugin, found on this machine by the
 * test (real-docker.e2e.ts). The runner gets them and nothing else of the
 * person's Docker set-up: its Docker config folder is a temporary one.
 */
export type RealDocker = { binary: string; host: string; composePlugin: string }

export async function createWorld(options: { standInServer?: boolean; realDocker?: RealDocker } = {}) {
  if (!process.versions.bun) throw new Error("the end-to-end tests run on Bun")
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "zekno-e2e-")))
  const home = join(base, "home")
  const zeknoHome = join(home, ".zekno")
  const project = join(home, "demo")
  const tmp = join(base, "tmp")
  const trapBin = join(base, "trap")
  const keys = join(base, "keys.json")
  const spawns = join(base, "spawns.log")
  const trapLog = join(base, "trap.log")
  for (const dir of [home, project, tmp, trapBin]) mkdirSync(dir, { recursive: true })

  // A trap first on PATH: anything that looked `ssh` up on PATH would land here, note it, and fail.
  writeFileSync(join(trapBin, "ssh"), `#!/bin/sh\necho ssh >> "${trapLog}"\nexit 255\n`, { mode: 0o755 })

  const docker = fakeDocker()
  const server: StandInServer | undefined = options.standInServer ? standInServer() : undefined
  const ssh = server ? sshStandIn(server) : undefined
  // The stand-in server's download is the real runner, with the stand-in Docker.
  const releaseSha = server ? server.release(realRunner(docker.path)) : undefined
  const cleanUp = [base, dirname(docker.path), ...(server ? [server.root] : []), ...(ssh ? [dirname(ssh.path)] : [])]
  const dockerConfig = join(base, "docker-config")
  if (options.realDocker) {
    mkdirSync(join(dockerConfig, "cli-plugins"), { recursive: true })
    symlinkSync(options.realDocker.composePlugin, join(dockerConfig, "cli-plugins", "docker-compose"))
    writeFileSync(join(dockerConfig, "config.json"), "{}\n")
  }

  /** The allow-list: the whole environment of everything the tests start. */
  function env(): Record<string, string> {
    return {
      HOME: home,
      ZEKNO_HOME: zeknoHome,
      PATH: `${trapBin}:/usr/bin:/bin`,
      TMPDIR: tmp,
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      // The same clock face on every machine: log times and "today 17:31" read the same wherever the tests run.
      TZ: "UTC",
      ZEKNO_E2E_KEYS: keys,
      ZEKNO_E2E_DOCKER: options.realDocker?.binary ?? docker.path,
      ...(options.realDocker ? { DOCKER_HOST: options.realDocker.host, DOCKER_CONFIG: dockerConfig } : {}),
      ZEKNO_E2E_SPAWNS: spawns,
      ...(ssh && releaseSha ? { ZEKNO_E2E_SSH: ssh.path, ZEKNO_E2E_RELEASE_SHA: releaseSha } : {}),
    }
  }

  /** Runs one `zekno` command as a script would, its output piped. */
  async function zekno(args: string[], options: { cwd?: string; input?: string } = {}): Promise<Result> {
    const child = Bun.spawn([process.execPath, ENTRY, ...args], {
      cwd: options.cwd ?? project,
      env: env(),
      stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, out, err }
  }

  /** As `zekno`, and fails the test's set-up when the command does not succeed. */
  async function must(args: string[], options: { cwd?: string; input?: string } = {}): Promise<Result> {
    const result = await zekno(args, options)
    if (result.code !== 0) throw new Error(`zekno ${args.join(" ")} exited with ${result.code}: ${result.err.trim()}`)
    return result
  }

  /** A folder in the home folder, created when missing. */
  function folder(name: string): string {
    const path = join(home, name)
    mkdirSync(path, { recursive: true })
    return path
  }

  return {
    base,
    home,
    zeknoHome,
    project,
    docker,
    server,
    ssh,
    env,
    zekno,
    must,
    folder,
    /** How the terminal starts the app: in `cwd` (the project folder by default), at the window size given. */
    launch(options: { cwd?: string; cols?: number; rows?: number } = {}): Launch {
      return { argv: [process.execPath, ENTRY], env: env(), cwd: options.cwd ?? project, cols: options.cols ?? COLUMNS, rows: options.rows ?? ROWS }
    },
    /** `zekno init --name <member>`: the team, with this member's key in the file key store. */
    init: (member = "ada") => must(["init", "--name", member]),
    /** `zekno server add <name> --local`: a runner on this machine, with the stand-in Docker. */
    addThisMachine(name = "prod") {
      mkdirSync(join(base, `runner-${name}`), { recursive: true })
      return must(["server", "add", name, "--local", "--home", join(base, `runner-${name}`)])
    },
    /** The runner's folder of a server added with `addThisMachine`. */
    runnerHome: (name = "prod") => join(base, `runner-${name}`),
    /** `zekno link`: this folder deploys `app` to `server`, signed by the team and used here. */
    link: (app = "demo", server = "prod", cwd = project) => must(["link", "--app", app, "--server", server, "--yes"], { cwd }),
    /** `zekno deploy`, from `cwd` (the project folder by default), with its own flags. */
    deploy: (args: string[] = [], cwd = project) => must(["deploy", ...args], { cwd }),
    /** What the runner of `server` says it runs: `zekno status --json`. */
    async status(server = "prod"): Promise<{ lastSequence: Record<string, number>; secrets: Record<string, { version: number }> }> {
      return JSON.parse((await must(["status", "--server", server, "--json"])).out)
    },
    /** The team list as this machine verifies it, read with the key in the test's key store. */
    trust: async () => (await openTeam({ home: zeknoHome, keyStore: fileKeyStore(keys) })).trust,
    /** The folders where a zekno.json was answered "use it" on this machine (links.json), as written. */
    links: () => (existsSync(join(zeknoHome, "links.json")) ? readFileSync(join(zeknoHome, "links.json"), "utf8") : ""),
    /** Writes a Compose file, in the project folder unless another is named. */
    compose(content: string, where = project, name = "compose.yaml") {
      mkdirSync(where, { recursive: true })
      writeFileSync(join(where, name), content)
    },
    /** The `docker compose ... up` calls the stand-in Docker received, in order. */
    ups: () => docker.calls().filter((call) => / up( |$)/.test(call.args)),
    /** Every process the test build started, by program name, and whether it ran, ran as the stand-in, or was refused. */
    spawned(): { program: string; ran: string }[] {
      if (!existsSync(spawns)) return []
      return readFileSync(spawns, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { program: string; ran: string })
    },
    /** How many times something ran the `ssh` it found on PATH (the trap). */
    trapHits: () => (existsSync(trapLog) ? readFileSync(trapLog, "utf8").split("\n").filter(Boolean).length : 0),
    /** Every file in the world's folders and the stand-ins' folders, with its content. */
    files: () => cleanUp.flatMap((dir) => filesUnder(dir)),
    /** Removes every folder of the world, unless a leak check asked to keep them. */
    cleanup() {
      if (keep()) return
      for (const dir of cleanUp) rmSync(dir, { recursive: true, force: true })
    },
  }
}
