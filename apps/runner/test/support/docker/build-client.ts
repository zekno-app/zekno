/**
 * Starting the stand-in's `docker buildx build` as the runner starts a build
 * client, and reading what it printed (specs/016-build-from-source, T063;
 * contracts/runner.md RB7, RB9): a small pack written with core's writer,
 * RB7's list as far as the stand-in reads it, the client's own environment
 * and work folder, and the `--progress=rawjson` statuses on its standard
 * error. For the stand-in's own tests; Docker is never reached.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { createTarWriter } from "@workspace/core"

import { tempDir } from "../helpers"
import { fakeDocker, type FakeDocker } from "./fake"
import type { ScriptedBuild } from "./model"

export const KEY = "a".repeat(64)
export const TAG = `zekno.invalid/web:${KEY}`
export const TOKEN = "0123456789abcdef0123456789abcdef"

type TarEntry = Parameters<ReturnType<typeof createTarWriter>["begin"]>[0]

/** A pack: a folder, a file its owner may run, and the recipe. */
export function pack(): Uint8Array {
  const writer = createTarWriter()
  const parts: Uint8Array[] = []
  const add = (entry: TarEntry, data = "") => {
    parts.push(writer.begin(entry))
    if (data) parts.push(writer.data(new TextEncoder().encode(data)))
    parts.push(writer.finish())
  }
  add({ name: "app/", kind: "folder", mode: 0o755, size: 0 })
  add({ name: "app/run.sh", kind: "file", mode: 0o755, size: 3 }, "ls\n")
  add(
    { name: "builder.dockerfile", kind: "file", mode: 0o644, size: 12 },
    "FROM busybox"
  )
  parts.push(writer.end())
  return Buffer.concat(parts)
}

/** RB7's list, as far as the stand-in reads it. */
export const rb7 = (work: string, extra: string[] = []) => [
  ...["buildx", "build", "--builder", "default"],
  ...["--file", "builder.dockerfile", "--network", "default"],
  ...["--build-arg", "BUILDKIT_CACHE_MOUNT_NS=zekno-web", ...extra],
  ...["--provenance=false", "--sbom=false", "--tag", TAG],
  ...["--metadata-file", join(work, "meta.json"), "--progress=rawjson", "-"],
]

/** A stand-in with every build doing `script`, a home, a work folder, and the client's environment (RB7). */
export function buildWorld(script?: ScriptedBuild) {
  const docker = fakeDocker()
  if (script) docker.script({ build: script })
  const home = tempDir("buildx-home")
  const work = tempDir("buildx-work")
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    BUILDX_CONFIG: join(home, "buildx"),
    BUILDX_GIT_INFO: "0",
    BUILDX_GIT_LABELS: "0",
    ZEKNO_BUILD_RUN: TOKEN,
  }
  return { docker, home, work, env }
}

export type BuildWorld = ReturnType<typeof buildWorld>

/** Every client started, so a test's end can stop what is left. */
export const clients: Bun.Subprocess[] = []

/** Starts a build as the runner does; `input` is written and closed unless `hold`. */
export function startBuild(
  w: BuildWorld,
  options: { args?: string[]; input?: Uint8Array; hold?: boolean } = {}
) {
  const child = Bun.spawn([w.docker.path, ...(options.args ?? rb7(w.work))], {
    cwd: w.work,
    env: w.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  clients.push(child)
  void child.stdin.write(options.input ?? pack())
  if (!options.hold) void child.stdin.end()
  return child
}

/** Its exit status and all it printed on standard error. */
export async function finished(child: Bun.Subprocess<"pipe", "pipe", "pipe">) {
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stderr }
}

export type RawStatus = {
  vertexes?: {
    digest: string
    name: string
    cached?: boolean
    started?: string
    completed?: string
    error?: string
  }[]
  statuses?: { id: string; vertex: string; current: number }[]
  logs?: { vertex: string; stream: number; data: string }[]
}

/** The rawjson statuses among the lines printed. */
export const statuses = (stderr: string): RawStatus[] =>
  stderr
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as RawStatus)

export const vertexes = (stderr: string) =>
  statuses(stderr).flatMap((each) => each.vertexes ?? [])

/** What the steps printed, decoded and joined. */
export const logs = (stderr: string) =>
  statuses(stderr)
    .flatMap((each) => each.logs ?? [])
    .map((log) => Buffer.from(log.data, "base64").toString("utf8"))
    .join("")

/** The ref files buildx left for the builder `default`. */
export const refsIn = (w: BuildWorld) => {
  const folder = join(w.env.BUILDX_CONFIG, "refs/default/default")
  return existsSync(folder) ? readdirSync(folder) : []
}

/** A process's entry in the stand-in's proc folder. */
export const procEntry = (docker: FakeDocker, pid: number) =>
  join(docker.procRoot, String(pid), "environ")
