/**
 * What the stand-in for Docker remembers between calls (specs/015-domains-
 * https, contracts/runner.md, "Tests"): containers, networks, the proxy's
 * log, what it last loaded and the certificates on its volume, and what a
 * test has asked the next calls to do; since feature 016
 * (specs/016-build-from-source, contracts/runner.md, "Tests"), what Docker
 * says of itself and its builder (RB5), the builds it was asked for, its
 * records of them (RB12) and the images they tagged (RB11). Kept as one JSON
 * file in the stand-in's folder, read and written whole by each call under a
 * lock of its own, since a build runs on while other calls come and go.
 */
import {
  existsSync,
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

/** One container, with only what the runner reads of `docker inspect`. */
export type FakeContainer = {
  /** 64 hex characters. */
  id: string
  /** Without the leading slash Docker prints. */
  name: string
  image: string
  labels: Record<string, string>
  /** `HostConfig.NetworkMode`: the Compose network's name, or `host`. */
  networkMode: string
  running: boolean
  restartCount: number
  /** `State.Health.Status`, for a container with a health check of its own. */
  health?: "starting" | "healthy" | "unhealthy"
  /** Each network it is on, with its aliases there. */
  networks: Record<string, { aliases: string[] }>
  /** Bind mounts: where the folder is on this machine, and where it shows inside. */
  mounts: { source: string; target: string }[]
}

export type FakeNetwork = { name: string; labels: Record<string, string> }

/** What a signal to the proxy does: loads the file, refuses it, says nothing, or says it loaded without saving it. */
export type Reload = "ok" | "failed" | "silent" | "no_autosave"

/** What a test asks of the calls that follow. Each is used up as it is taken, unless it says otherwise. */
export type Script = {
  /** The next `docker run -d` fails with this status and error text; `leave` keeps a container in state Created, as Docker does. */
  runFails?: { code: number; stderr: string; leave: boolean }
  /** How many `caddy validate` calls fail. */
  validateFails?: number
  /** What each signal does, in order; `ok` once the list is used up. */
  reloads?: Reload[]
  /** A proxy started (`run` or `start`) logs no `serving initial configuration`. */
  startSilent?: boolean
  /** How many `network connect` calls attach the container without its alias. */
  connectWithoutAlias?: number
  /** What a health check's curl prints for a service, `<code>|<exit>`; `200|0` when not said. */
  curl?: Record<string, string>
  /** Calls that fail with exit status 1, each named by its first words, such as `network create`. */
  failing?: string[]
  /** Containers in a restart loop: each `inspect` finds one restart more. */
  restarting?: string[]
  /** The next signal's lines come after this many bytes of request errors, as visitors make them while an app is down. */
  flood?: number
  /** How long each health check's curl takes before it answers, in milliseconds; kept, not used up. */
  checkMs?: number
  /** How long each `caddy validate` takes, in milliseconds, as a first fetch of the image would; kept, not used up. */
  validateMs?: number
  /** The pinned image is not on this machine until a `pull` brings it. */
  imageMissing?: boolean
  /** Each `pull` fails. */
  pullFails?: boolean
  /** How many deletions of a released domain's certificate, inside the proxy or in a short-lived container, exit 1 and leave it. */
  deletionFails?: number
  /** What Docker says of itself and its builder (`ScriptedDocker`); kept, and each part scripted later adds to it. */
  docker?: Partial<ScriptedDocker>
  /** What every `buildx build` does (`ScriptedBuild`); kept, and each part scripted later adds to it. */
  build?: ScriptedBuild
  /** What the next builds do, one each, over `build`; each used up as a build takes it. */
  nextBuilds?: ScriptedBuild[]
  /** How many `buildx history rm` calls fail and keep the record. */
  historyRmFails?: number
  /** Each `buildx prune` hangs until it is stopped. */
  pruneHangs?: boolean
  /** The build cache's total in bytes, as `buildx du` gives it; kept, and a prune lowers it. */
  du?: number
}

/** The failing step's error, by what BuildKit's error says (RB16). */
export type BuildFailure =
  "step" | "killed" | "no_space" | "exec_format" | "no_memory"

/** What one `docker buildx build` does (specs/016-build-from-source, T063). Each is off when not said. */
export type ScriptedBuild = {
  /** A step fails with this error: an `ERROR` vertex, and the client exits `exit`. */
  fail?: BuildFailure
  /** The client's exit status when a step fails: 1, as buildx exits, when not said. */
  exit?: number
  /** The `RUN` step never ends: it prints a line every 200 ms until stopped, and ends when its reader is gone. */
  hang?: boolean
  /** It goes on through SIGTERM: only SIGKILL stops it. */
  ignoreTerm?: boolean
  /** The `RUN` step prints without pause until stopped. */
  flood?: boolean
  /** The `RUN` step, a `[stage …]` step other than `FROM`, is cached. */
  cachedStep?: boolean
  /** A silent `RUN` step that never ends and runs on after its reader goes away (E04c). */
  outlivesReader?: boolean
  /** When the ref file is written: at the start (when not said), or after the first vertex. */
  refAt?: "start" | "first_vertex"
  /** Which digest the image's `.Id` is: the manifest's, as the containerd store gives (when not said), or the config's, as the classic store does. */
  id?: "manifest" | "config"
  /** The image's architecture: the server's (`docker version`), in Go's words, when not said. */
  arch?: string
  /** The image's size in bytes. */
  size?: number
  /** The base images in the provenance materials; a busybox when not said. */
  materials?: { uri: string; digest: string }[]
  /** Milliseconds between two vertices; none when not said. */
  pauseMs?: number
  /** How long its record stays `Running` once its client stopped: seconds, or for good; 0 when not said. */
  recordRuns?: number | "forever"
  /** What its record becomes once a stopped client's time has passed: `Canceled` when not said. */
  stoppedAs?: "Canceled" | "Error"
}

/** One `docker buildx build` as the stand-in received it. */
export type FakeBuildRun = {
  /** Docker's whole argument list, `buildx build …`. */
  args: string[]
  /** Its environment, without the names its shell sets (`PWD`, `OLDPWD`, `SHLVL`, `_`). */
  env: Record<string, string>
  /** The folder it was started in. */
  cwd: string
  pid: number
  /** The record's ref this build made. */
  ref: string
  /** `-` for a tar on standard input, else the folder named. */
  context: string
  /** What came on standard input, to its end or until the client stopped. */
  input: { bytes: number; sha256: string }
  /** The tar's entries, or the folder's files, in order, with their modes. */
  entries: ContextEntry[]
  /** How it ended; undefined while it runs, and after a SIGKILL. */
  ended?: "built" | "failed" | "stopped"
}

export type ContextEntry = {
  /** A folder's name ends with `/`. */
  name: string
  kind: "file" | "folder" | "other"
  mode: number
  size: number
  /** Seconds since 1970, as the header or the file says. */
  mtime: number
}

/** Docker's own record of a build (`buildx history`). */
export type FakeRecord = {
  /** The ref's last part, as buildx names its ref file. */
  ref: string
  builder: string
  node: string
  name: string
  status: "Running" | "Completed" | "Error" | "Canceled"
  /** The client's process: the record runs while it does. */
  pid: number
  startedAt: string
  completedAt?: string
  /** When its client was stopped, or found gone. */
  stoppedAt?: string
  runsFor: number | "forever"
  stoppedAs: "Canceled" | "Error"
  error?: string
  steps: number
  cached: number
  /** Removed by `history rm`: buildx then says the ref is deleted. */
  deleted?: boolean
}

/** An image a build tagged: one per tag. */
export type FakeImage = {
  tag: string
  /** `.Id`: the manifest's digest or the config's, as the store gives it. */
  id: string
  manifest: string
  config: string
  architecture: string
  size: number
}

/**
 * What `docker version`, `docker info`, `docker context show` and `docker
 * buildx version`, `inspect` and `--help` say (specs/016-build-from-source,
 * contracts/runner.md RB5, RB6, RB17). Versions are the words Docker prints.
 */
export type ScriptedDocker = {
  /** The engine's version (`Server.Version`), or null when no engine answers. */
  engine: string | null
  /** The server's architecture as `docker version` gives it: `amd64`, `arm64`, `aarch64` or another. */
  arch: string
  /** The version word `docker buildx version` prints (`v0.34.1`, `v0.35.0-desktop.2`, Ubuntu's `0.30.1`), or null when the plugin is missing. */
  buildx: string | null
  /** The current context's name, which is also its builder's. */
  context: string
  /** The driver of that builder. */
  driver: "docker" | "docker-container"
  /** BuildKit's version, as `docker buildx inspect` prints it. */
  buildkit: string
  dockerRootDir: string
  /** The machine's memory in bytes. */
  memTotal: number
  /** Whether `docker buildx build --help` lists `--policy`. */
  policy: boolean
  /** Whether `docker buildx prune --help` lists `--max-used-space`. */
  maxUsedSpace: boolean
}

/** A Docker that can build, as on a server with Docker Engine 29 and its buildx. */
export const DOCKER_DEFAULTS: ScriptedDocker = {
  engine: "29.6.1",
  arch: "amd64",
  buildx: "v0.34.1",
  context: "default",
  driver: "docker",
  buildkit: "v0.31.1",
  dockerRootDir: "/var/lib/docker",
  memTotal: 8_324_206_592,
  policy: true,
  maxUsedSpace: true,
}

/** What Docker says of itself now: the defaults, with what the test scripted. */
export const scriptedDocker = (model: Model): ScriptedDocker => ({
  ...DOCKER_DEFAULTS,
  ...model.script.docker,
})

/** The processor as Go names it (`docker version`, an image's `Architecture`): `aarch64` is `arm64`, `x86_64` is `amd64`. */
export const goArch = (arch: string): string =>
  arch === "aarch64" ? "arm64" : arch === "x86_64" ? "amd64" : arch

/** The builder a buildx call names (`--builder <name>`, `--builder=<name>`), else the current context's. */
export function builderOf(
  words: readonly string[],
  docker: ScriptedDocker
): string {
  for (let i = 0; i < words.length; i++) {
    if (words[i] === "--builder") return words[i + 1] ?? ""
    if (words[i]!.startsWith("--builder="))
      return words[i]!.slice("--builder=".length)
  }
  return docker.context
}

/** The builder's one node: named as the builder for the `docker` driver, with a `0` after it for a container builder. */
export const nodeOf = (builder: string, docker: ScriptedDocker): string =>
  docker.driver === "docker" ? builder : `${builder}0`

export type Model = {
  containers: FakeContainer[]
  networks: FakeNetwork[]
  /** The named volumes Docker has, made by the first `run` that mounts one. */
  volumes: string[]
  /** The log of each container, by name: one JSON line each, as Caddy writes them. */
  logs: Record<string, string[]>
  /** The proxy's `/config/caddy/autosave.json`: what it last loaded. */
  autosave: string
  /**
   * The domains with a certificate and key on the proxy's volume, sorted:
   * Caddy gets one for each domain of a configuration it loads, and the
   * runner's deletion of a released domain's removes it.
   */
  certificates: string[]
  script: Script
  /** Each `buildx build`, in the order it started. */
  builds: FakeBuildRun[]
  /** Docker's records of the builds, removed ones marked. */
  records: FakeRecord[]
  /** The images builds tagged, one per tag. */
  images: FakeImage[]
  /** The options of each `buildx prune`, in order. */
  prunes: string[][]
}

const fileIn = (dir: string) => join(dir, "model.json")

const EMPTY: Model = {
  containers: [],
  networks: [],
  volumes: [],
  logs: {},
  autosave: "",
  certificates: [],
  script: {},
  builds: [],
  records: [],
  images: [],
  prunes: [],
}

export function readModel(dir: string): Model {
  const path = fileIn(dir)
  if (!existsSync(path)) return structuredClone(EMPTY)
  return {
    ...structuredClone(EMPTY),
    ...(JSON.parse(readFileSync(path, "utf8")) as Partial<Model>),
  }
}

/** Written whole, then moved into place, so a reader never sees half of it. */
export function writeModel(dir: string, model: Model): void {
  const next = join(dir, `model.json.${process.pid}`)
  writeFileSync(next, JSON.stringify(model))
  renameSync(next, fileIn(dir))
}

const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Runs `work` holding the model's lock: a file holding the holder's pid, taken over once that process is gone. */
function holdingLock<T>(dir: string, work: () => T): T {
  const lock = join(dir, "model.lock")
  // Written whole, then linked into place: a process killed at any point
  // leaves no lock, or one naming it, never an empty one.
  const mine = join(dir, `model.lock.${process.pid}`)
  writeFileSync(mine, String(process.pid))
  try {
    for (;;) {
      try {
        linkSync(mine, lock)
        break
      } catch {
        let holder = Number.NaN
        try {
          holder = Number(readFileSync(lock, "utf8"))
        } catch {
          continue
        }
        if (!alive(holder)) rmSync(lock, { force: true })
        else Bun.sleepSync(2)
      }
    }
  } finally {
    rmSync(mine, { force: true })
  }
  try {
    return work()
  } finally {
    rmSync(lock, { force: true })
  }
}

/** Changes the model in place on disk, under its lock. */
export function changeModel<T>(dir: string, change: (model: Model) => T): T {
  return holdingLock(dir, () => {
    const model = readModel(dir)
    const result = change(model)
    writeModel(dir, model)
    return result
  })
}

/**
 * A record as buildx would show it now: `Running` while its client runs;
 * once the client stopped (or is found gone), `Running` for `runsFor`
 * seconds more, then `stoppedAs`. Changes the record when it settles.
 */
export function settle(record: FakeRecord, now = Date.now()): FakeRecord {
  if (record.status !== "Running" || alive(record.pid)) return record
  record.stoppedAt ??= new Date(now).toISOString()
  if (record.runsFor === "forever") return record
  const until = Date.parse(record.stoppedAt) + record.runsFor * 1000
  if (now < until) return record
  record.status = record.stoppedAs
  record.completedAt = new Date(until).toISOString()
  record.error ??= "context canceled"
  return record
}

/** A container by name, full id or an id's first characters, as Docker finds one. */
export function findContainer(
  model: Model,
  ref: string
): FakeContainer | undefined {
  return (
    model.containers.find((c) => c.name === ref || c.id === ref) ??
    (/^[0-9a-f]{12,63}$/.test(ref)
      ? model.containers.find((c) => c.id.startsWith(ref))
      : undefined)
  )
}

/** 64 random hex characters: a container's id. */
export const newId = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")

/** One line of Caddy's log, as it writes it on standard error. */
export const caddyLine = (msg: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ level: "info", ts: Date.now() / 1000, msg, ...extra })

/** The labels Compose writes on a container of a service of `zekno-<app>`. */
export const composeLabels = (app: string, service: string) => ({
  "com.docker.compose.project": `zekno-${app}`,
  "com.docker.compose.service": service,
  "com.docker.compose.oneoff": "False",
  "com.docker.compose.container-number": "1",
})

/** What `strayTags` reads of the runner's state: each app's kept and to-remove images (CO13). */
export type BuildsOfState = {
  readonly builds: Readonly<
    Record<
      string,
      {
        readonly images: readonly { readonly key: string }[]
        readonly drop: readonly { readonly key: string }[]
      }
    >
  >
}

/**
 * Every `zekno.invalid/*` tag of the model that the state's `builds` does
 * not name, sorted: an image no deploy keeps and nothing will remove, which
 * SC-012 says the server never keeps.
 */
export function strayTags(model: Model, state: BuildsOfState): string[] {
  const named = new Set(
    Object.entries(state.builds).flatMap(([app, entry]) =>
      [...entry.images, ...entry.drop].map(
        (image) => `zekno.invalid/${app}:${image.key}`
      )
    )
  )
  return model.images
    .map((image) => image.tag)
    .filter((tag) => tag.startsWith("zekno.invalid/") && !named.has(tag))
    .sort()
}
