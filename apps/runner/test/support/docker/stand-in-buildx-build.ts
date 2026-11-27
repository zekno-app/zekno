/**
 * The stand-in's `docker buildx build` (specs/016-build-from-source, T063;
 * contracts/runner.md, "Tests" first bullet, RB7, RB9 to RB12, RB15, RB16).
 * The stand-in's shell `exec`s it, so its process is the one the runner
 * started. It records what it received (the argument list, the environment,
 * the folder, the input's SHA-256 and entries), Docker's record of the build
 * (`Running` until it ends) and the ref file buildx writes under
 * `$BUILDX_CONFIG/refs/<builder>/<node>/<ref>`, holding paths only, and
 * `<its folder>/proc/<pid>/environ` as Linux keeps it, so a restarted runner
 * can find it by its run token. It prints `--progress=rawjson` lines on
 * standard error, and on success writes the `--metadata-file` and tags the
 * image. What the build does is the model's script (`ScriptedBuild`).
 */
import { createHash } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import {
  builderOf,
  changeModel,
  goArch,
  newId,
  nodeOf,
  type BuildFailure,
  type FakeBuildRun,
  type FakeRecord,
  scriptedDocker,
  type ScriptedBuild,
} from "./model"
import { folderEntries, tarEntries } from "./stand-in-context"

/** The options of `docker buildx build` that take a value; every other option is a flag. */
const WITH_VALUE = new Set([
  ...["--builder", "--file", "-f", "--target", "--network", "--build-arg"],
  ...["--secret", "--add-host", "--policy", "--tag", "-t", "--platform"],
  ...["--metadata-file", "--progress", "--label", "--output", "-o"],
  ...["--cache-from", "--cache-to", "--iidfile", "--ssh", "--allow"],
  ...["--attest", "--build-context", "--cgroup-parent", "--shm-size"],
  ...["--ulimit", "--annotation", "--call", "--no-cache-filter"],
])

/** The values of one option, in order, and the one context. */
function readBuild(words: readonly string[]) {
  const options: [string, string][] = []
  const positional: string[] = []
  for (let at = 0; at < words.length; at++) {
    const word = words[at]!
    if (word === "-" || !word.startsWith("-")) positional.push(word)
    else if (word.includes("="))
      options.push([
        word.slice(0, word.indexOf("=")),
        word.slice(word.indexOf("=") + 1),
      ])
    else if (WITH_VALUE.has(word)) options.push([word, words[++at] ?? ""])
    else options.push([word, ""])
  }
  const all = (...names: string[]) =>
    options.filter(([name]) => names.includes(name)).map(([, value]) => value)
  return { all, context: positional.at(-1) ?? "." }
}

/** The failing step's error and its last line, by what BuildKit's error says (RB16). */
const FAILURES: Record<BuildFailure, { log: string; error: string }> = {
  step: {
    log: "npm error code E404\n",
    error:
      'process "/bin/sh -c npm ci" did not complete successfully: exit code: 1',
  },
  killed: {
    log: "Killed\n",
    error:
      'process "/bin/sh -c npm ci" did not complete successfully: exit code: 137',
  },
  no_space: {
    log: "npm error nospc ENOSPC: no space left on device, write\n",
    error:
      "failed to copy files: copy file range failed: no space left on device",
  },
  exec_format: {
    log: "exec /bin/sh: exec format error\n",
    error:
      'process "/bin/sh -c npm ci" did not complete successfully: exec format error',
  },
  no_memory: {
    log: "",
    error:
      "failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: error during container init: cannot allocate memory",
  },
}

/** busybox 1.36.1, as the Linux checks pin it. */
const BASE = {
  uri: "pkg:docker/busybox@1.36.1?platform=linux%2Famd64",
  digest:
    "sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662",
}

/** The names the stand-in's shell sets, which the runner did not pass. */
const SHELL_NAMES = new Set(["PWD", "OLDPWD", "SHLVL", "_"])

/** A ref as buildx makes them: 25 lowercase letters and digits. */
function newRef(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from(
    crypto.getRandomValues(new Uint8Array(25)),
    (byte) => letters[byte % 36]
  ).join("")
}

const now = () => new Date().toISOString()

/** Runs one build to its end, as scripted, and exits with its status. */
export async function build(
  dir: string,
  cwd: string,
  args: string[]
): Promise<never> {
  const { docker, script } = changeModel(dir, (model) => {
    const next = model.script.nextBuilds?.shift()
    const taken: ScriptedBuild = { ...model.script.build, ...next }
    return { docker: scriptedDocker(model), script: taken }
  })
  const words = args.slice(2)
  const { all, context } = readBuild(words)
  const builder = builderOf(words, docker)
  const node = nodeOf(builder, docker)
  const ref = newRef()
  const tag = all("--tag", "-t").at(-1)
  const dockerfile = all("--file", "-f").at(-1) ?? "Dockerfile"
  const proc = join(dir, "proc", String(process.pid))
  const refFile = process.env.BUILDX_CONFIG
    ? join(process.env.BUILDX_CONFIG, "refs", builder, node, ref)
    : undefined
  const chunks: Uint8Array[] = []
  const input = () => {
    const bytes = Buffer.concat(chunks)
    return {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  }

  // What its record and its run become, each in one change of the model.
  const change = (run: Partial<FakeBuildRun>, record: Partial<FakeRecord>) =>
    changeModel(dir, (model) => {
      Object.assign(
        model.builds.find((each) => each.ref === ref)!,
        run
      )
      Object.assign(
        model.records.find((each) => each.ref === ref)!,
        record
      )
    })
  const writeRef = () => {
    if (!refFile) return
    mkdirSync(dirname(refFile), { recursive: true })
    // Paths only, as buildx's local state holds them.
    writeFileSync(
      refFile,
      JSON.stringify({
        Target: "default",
        LocalPath: context,
        DockerfilePath: dockerfile,
        GroupRef: "",
      })
    )
  }

  if (script.refAt !== "first_vertex") writeRef()
  changeModel(dir, (model) => {
    model.builds.push({
      args,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] =>
            !SHELL_NAMES.has(pair[0]) && pair[1] !== undefined
        )
      ),
      cwd,
      pid: process.pid,
      ref,
      context,
      input: input(),
      entries: [],
    })
    model.records.push({
      ref,
      builder,
      node,
      name: tag ?? context,
      status: "Running",
      pid: process.pid,
      startedAt: now(),
      runsFor: script.recordRuns ?? 0,
      stoppedAs: script.stoppedAs ?? "Canceled",
      steps: 0,
      cached: 0,
    })
  })

  // Standard error, and what becomes of the client when its reader goes away.
  let readerGone = false
  const leave = (
    code: number,
    ended: FakeBuildRun["ended"],
    record: Partial<FakeRecord>
  ): never => {
    change({ ended, input: input() }, record)
    rmSync(proc, { recursive: true, force: true })
    process.exit(code)
  }
  const stopped = () => ({ stoppedAt: now() })
  process.stderr.on("error", () => {
    readerGone = true
    // A client that prints ends when its reader is gone, as a Go program does on SIGPIPE.
    if (!script.outlivesReader) leave(141, "stopped", stopped())
  })
  const emit = async (status: object) => {
    if (readerGone) return
    if (!process.stderr.write(`${JSON.stringify(status)}\n`))
      await new Promise<void>((resolve) => {
        process.stderr.once("drain", resolve)
        process.stderr.once("error", resolve)
      })
  }

  const RUN = { digest: `sha256:${newId()}`, name: "[build 3/3] RUN npm ci" }
  process.on("SIGTERM", () => {
    if (script.ignoreTerm) return
    // The step canceled, as buildx prints it; the record waits as scripted.
    if (!readerGone)
      process.stderr.write(
        `${JSON.stringify({ vertexes: [{ ...RUN, started: now(), completed: now(), error: "context canceled" }] })}\n`
      )
    leave(130, "stopped", stopped())
  })
  // As Linux keeps it: NUL after each name and value (RB15). Written once
  // the stop is handled, so a client found here can be stopped as scripted.
  mkdirSync(proc, { recursive: true })
  writeFileSync(
    join(proc, "environ"),
    Object.entries(process.env)
      .map(([name, value]) => `${name}=${value}\0`)
      .join("")
  )

  // What it received: the tar on standard input to its end, or the folder named.
  if (context === "-") {
    for await (const chunk of Bun.stdin.stream()) chunks.push(chunk)
    change({ input: input(), entries: tarEntries(Buffer.concat(chunks)) }, {})
  } else change({ entries: folderEntries(context) }, {})

  const pause = () => Bun.sleep(script.pauseMs ?? 0)
  const base = script.materials?.[0] ?? BASE
  // pkg:docker/<name>@<tag>?… is the image <name>:<tag>.
  const fromName = base.uri
    .replace(/^pkg:docker\//, "")
    .replace(/\?.*$/, "")
    .replace(/@([^@]*)$/, ":$1")
  const fromRef = fromName.includes("/")
    ? fromName
    : `docker.io/library/${fromName}`
  const steps = [
    {
      name: `[internal] load build definition from ${dockerfile.split("/").at(-1)}`,
    },
    { name: `[internal] load metadata for ${fromRef}` },
    { name: "[internal] load .dockerignore" },
    {
      name: `[build 1/3] FROM ${fromRef}@${base.digest}`,
      cached: true,
    },
    { name: "[internal] load build context", status: "transferring context:" },
    { name: "[build 2/3] COPY . .", cached: script.cachedStep },
  ]
  let first = true
  for (const step of steps) {
    const vertex = { digest: `sha256:${newId()}`, name: step.name }
    const at = now()
    await emit({
      vertexes: [
        {
          ...vertex,
          started: at,
          ...(step.cached ? { completed: at, cached: true } : {}),
        },
      ],
    })
    if (first && script.refAt === "first_vertex") writeRef()
    first = false
    if (step.status)
      await emit({
        statuses: [
          {
            id: step.status,
            vertex: vertex.digest,
            name: step.status,
            current: input().bytes,
            timestamp: now(),
            started: at,
            completed: now(),
          },
        ],
      })
    if (!step.cached)
      await emit({ vertexes: [{ ...vertex, started: at, completed: now() }] })
    await pause()
  }

  // The RUN step: cached, printing, hanging, failing, or done.
  const started = now()
  const log = (text: string) =>
    emit({
      logs: [
        {
          vertex: RUN.digest,
          stream: 1,
          data: Buffer.from(text).toString("base64"),
          timestamp: now(),
        },
      ],
    })
  if (script.cachedStep)
    await emit({
      vertexes: [{ ...RUN, started, completed: started, cached: true }],
    })
  else await emit({ vertexes: [{ ...RUN, started }] })
  if (script.outlivesReader || script.hang || script.flood) {
    setInterval(() => {}, 1 << 30)
    if (script.outlivesReader) return new Promise<never>(() => {})
    for (let line = 0; ; line++) {
      if (script.flood) {
        await log(`${line} ${"still building ".repeat(12)}\n`)
        if (line % 50 === 0)
          await new Promise((resolve) => setImmediate(resolve))
      } else {
        await log(`still building ${line}\n`)
        await Bun.sleep(200)
        // A write to a reader that is gone fails only on the next turn.
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  }
  const failure = script.fail ? FAILURES[script.fail] : undefined
  if (failure) {
    if (failure.log) await log(failure.log)
    await emit({
      vertexes: [{ ...RUN, started, completed: now(), error: failure.error }],
    })
    if (!readerGone)
      process.stderr.write(
        `ERROR: failed to build: failed to solve: ${failure.error}\n`
      )
    await flushed()
    leave(script.exit ?? 1, "failed", {
      status: "Error",
      error: failure.error,
      completedAt: now(),
      steps: 7,
    })
  }
  if (!script.cachedStep) {
    await log("added 42 packages in 3s\n")
    await emit({ vertexes: [{ ...RUN, started, completed: now() }] })
  }

  // The image: its digests, the metadata file, the tag.
  const manifest = `sha256:${newId()}`
  const config = `sha256:${newId()}`
  const exporting = { digest: `sha256:${newId()}`, name: "exporting to image" }
  const exportAt = now()
  await emit({ vertexes: [{ ...exporting, started: exportAt }] })
  for (const status of [
    "exporting layers",
    `exporting manifest ${manifest}`,
    `exporting config ${config}`,
    `naming to ${tag ?? "<none>"}`,
  ])
    await emit({
      statuses: [
        {
          id: status,
          vertex: exporting.digest,
          name: status,
          current: 0,
          timestamp: now(),
          started: exportAt,
          completed: now(),
        },
      ],
    })
  await emit({
    vertexes: [{ ...exporting, started: exportAt, completed: now() }],
  })
  const arch = script.arch ?? goArch(docker.arch)
  const metadata = all("--metadata-file").at(-1)
  if (metadata)
    writeFileSync(
      metadata,
      JSON.stringify({
        "buildx.build.provenance": {
          buildType: "https://mobyproject.org/buildkit@v1",
          materials: (script.materials ?? [BASE]).map(({ uri, digest }) => ({
            uri,
            digest: {
              [digest.slice(0, digest.indexOf(":"))]: digest.slice(
                digest.indexOf(":") + 1
              ),
            },
          })),
          invocation: {
            configSource: { entryPoint: dockerfile },
            parameters: {
              frontend: "dockerfile.v0",
              args: Object.fromEntries(
                all("--build-arg").map((pair) => [
                  `build-arg:${pair.split("=")[0]}`,
                  pair.slice(pair.indexOf("=") + 1),
                ])
              ),
            },
            environment: { platform: `linux/${arch}` },
          },
        },
        "buildx.build.ref": `${builder}/${node}/${ref}`,
        "containerimage.config.digest": config,
        "containerimage.descriptor": {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: manifest,
          size: 1_043,
          platform: { architecture: arch, os: "linux" },
        },
        "containerimage.digest": manifest,
        ...(tag ? { "image.name": tag } : {}),
      })
    )
  if (tag)
    changeModel(dir, (model) => {
      model.images = model.images.filter((image) => image.tag !== tag)
      model.images.push({
        tag,
        id: script.id === "config" ? config : manifest,
        manifest,
        config,
        architecture: arch,
        size: script.size ?? 7_340_032,
      })
    })
  await flushed()
  return leave(0, "built", {
    status: "Completed",
    completedAt: now(),
    steps: 8,
    cached: script.cachedStep ? 3 : 1,
  })

  /** Until what was written on standard error has left this process. */
  function flushed(): Promise<void> {
    if (readerGone) return Promise.resolve()
    return new Promise((resolve) => process.stderr.write("", () => resolve()))
  }
}
