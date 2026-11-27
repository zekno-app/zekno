/**
 * Check L17's parts (specs/016-build-from-source, T019; contracts/cli.md
 * CL2 and CL3, "Checked against BuildKit"; plan.md "Risks", the row on the
 * Dockerfile reader and the ignore rules). The check file is
 * `apps/cli/test/linux-checks/file-choice.test.ts`; T163 turns it to assert
 * against zekno's pass 1 and Dockerfile reader, and reuses what is here.
 *
 * The `ignore-*` fixtures beside this file each hold a `.dockerignore` and a
 * multi-stage Dockerfile. The names the repository's `.gitignore` keeps out
 * of a commit (`.env*`, `build`, `dist`, `node_modules`), a link and an
 * empty folder are written at run time (`RUN_TIME`). For each fixture, in
 * the stand-in, the check's own two commands, never the runner's:
 *
 *   docker buildx build --file <ROOT>/copy-out/Dockerfile --output type=local,dest=<out> ... <context>
 *   docker buildx build --call=targets,format=json --file <context>/Dockerfile ... <context>
 *
 * The first is `FROM scratch` and `COPY . /`: what it writes out is the
 * file list BuildKit copied. Both run with a private BUILDX_CONFIG
 * (`rb7Env`), so their build records are removed by id. A fixture reaches
 * the stand-in as one `sh` script of `printf` lines (`writeScript`), never as
 * a folder copied in.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { firstLine } from "../host/host-lists"
import {
  buildxVersionOf,
  checkFolder,
  firstError,
  type InStandIn,
  newRunToken,
  rb7Command,
  rb7Env,
  refOf,
  removeRecords,
} from "../build-runs/rb7"
import { q } from "../stand-in/shell"

export const CHECK = "L17"
/** The fixtures' folder, beside this file. */
export const FIXTURES = join(import.meta.dir, "..", "fixtures")
const FIXTURE_NAME = /^ignore-[a-z0-9-]+$/

/** The check's folder in the stand-in, and the private BUILDX_CONFIG's home in it. */
export const ROOT = "/tmp/zekno-check-file-choice"
export const HOME = `${ROOT}/home`
export const COPY_OUT = `${ROOT}/copy-out`
/** The check's own Dockerfile: everything BuildKit sends of the context, copied out. */
export const COPY_OUT_DOCKERFILE = "FROM scratch\nCOPY . /\n"

const MINUTE = 60_000
const BUILD_SECONDS = 300

/** The `ignore-*` fixtures under `root`, by name, sorted. */
export function fixtureNames(root: string = FIXTURES): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && FIXTURE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export type FixtureFile = { readonly path: string; readonly data: string }

/** Every file of a fixture folder, its path relative and `/`-separated, sorted; anything but files and folders throws. */
export function fixtureFiles(folder: string): FixtureFile[] {
  const files: FixtureFile[] = []
  const walk = (relative: string) => {
    const here = relative === "" ? folder : join(folder, relative)
    for (const name of readdirSync(here).sort()) {
      const path = relative === "" ? name : `${relative}/${name}`
      const info = lstatSync(join(folder, path))
      if (info.isDirectory()) walk(path)
      else if (info.isFile())
        files.push({ path, data: readFileSync(join(folder, path), "utf8") })
      else
        throw new Error(
          `${path} in ${folder} is neither a file nor a folder; links are written at run time`
        )
    }
  }
  walk("")
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const globPart = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]*")}$`
  )

/**
 * Whether git keeps `path` out of a commit under `gitignore`'s lines that
 * name no folder of their own (`build`, `.env*`, `out/`, `*.pem`), each
 * matching a part at any depth, the last line that matches winning. The
 * lines anchored at the repository's root (`.yarn/*`) are left out: no
 * fixture lies there.
 */
export function gitIgnored(path: string, gitignore: string): boolean {
  const parts = path.split("/")
  let ignored = false
  for (const raw of gitignore.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    let pattern = negated ? line.slice(1) : line
    const folderOnly = pattern.endsWith("/")
    if (folderOnly) pattern = pattern.slice(0, -1)
    if (pattern === "" || pattern.includes("/")) continue
    const glob = globPart(pattern)
    const hit = parts.some(
      (part, at) => glob.test(part) && (!folderOnly || at < parts.length - 1)
    )
    if (hit) ignored = !negated
  }
  return ignored
}

export type RunTimeEntry =
  | { readonly kind: "file"; readonly path: string; readonly data: string }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "link"; readonly path: string; readonly target: string }

/**
 * What the test writes at run time in each fixture's copy: names the
 * repository's `.gitignore` keeps out of a commit, a link and an empty
 * folder (quickstart.md, "Fixtures").
 */
export const RUN_TIME: readonly RunTimeEntry[] = [
  { kind: "file", path: ".env", data: "ZEKNO_CHECK=env\n" },
  { kind: "file", path: ".env.local", data: "ZEKNO_CHECK=env-local\n" },
  { kind: "file", path: "build/out.txt", data: "run time: build/out.txt\n" },
  { kind: "file", path: "build/keep.txt", data: "run time: build/keep.txt\n" },
  { kind: "file", path: "dist/app.js", data: "run time: dist/app.js\n" },
  {
    kind: "file",
    path: "node_modules/pkg/index.js",
    data: "run time: node_modules/pkg/index.js\n",
  },
  {
    kind: "file",
    path: "lib/node_modules/inner/index.js",
    data: "run time: lib/node_modules/inner/index.js\n",
  },
  { kind: "link", path: "dockerfile-link", target: "Dockerfile" },
  { kind: "folder", path: "empty" },
]

const RELATIVE =
  /^(?!\.{1,2}(?:\/|$))(?:[^/\0]+)(?:\/(?!\.{1,2}(?:\/|$))[^/\0]+)*$/

function relativePath(path: string): string {
  if (!RELATIVE.test(path) || /[\r\n]/.test(path))
    throw new Error(
      `${JSON.stringify(path)} is not a relative path of one line`
    )
  return `./${path}`
}

const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined

/**
 * The `sh` script that writes `entries` under `folder`, made first: each
 * file with `printf '%s'`, each folder with `mkdir -p`, each link with
 * `ln -s`, every name quoted. `folder` is an absolute path; in the stand-in,
 * one under `/tmp/zekno-check-*` (`checkFolder`).
 */
export function writeScript(
  folder: string,
  entries: readonly (FixtureFile | RunTimeEntry)[]
): string {
  if (!folder.startsWith("/") || /[\r\n]/.test(folder))
    throw new Error(`${JSON.stringify(folder)} is not an absolute path`)
  const lines = ["set -eu", `mkdir -p ${q(folder)}`, `cd ${q(folder)}`]
  for (const entry of entries) {
    const path = relativePath(entry.path)
    const kind = "kind" in entry ? entry.kind : "file"
    const parent = parentOf(entry.path)
    if (parent !== undefined && kind !== "folder")
      lines.push(`mkdir -p ${q(`./${parent}`)}`)
    if (kind === "folder") lines.push(`mkdir -p ${q(path)}`)
    else if (kind === "link" && "target" in entry)
      lines.push(`ln -s -- ${q(entry.target)} ${q(path)}`)
    else if ("data" in entry) {
      if (entry.data.includes("\0"))
        throw new Error(`${entry.path} holds a NUL`)
      lines.push(`printf '%s' ${q(entry.data)} > ${q(path)}`)
    }
  }
  return lines.join("\n")
}

/** The copy-out build: `FROM scratch`, `COPY . /`, written to `out` with no attestation beside the files. */
export function copyOutArgs(input: {
  readonly context: string
  readonly out: string
  readonly metadata: string
  readonly dockerfile?: string
}): string[] {
  const dockerfile = input.dockerfile ?? `${COPY_OUT}/Dockerfile`
  checkFolder(input.context, "the context")
  checkFolder(input.out, "the output folder")
  checkFolder(input.metadata, "the metadata file")
  checkFolder(dockerfile, "the Dockerfile")
  return [
    ...["docker", "buildx", "build", "--builder", "default"],
    ...["--file", dockerfile],
    ...["--provenance=false", "--sbom=false"],
    ...["--output", `type=local,dest=${input.out}`],
    ...["--metadata-file", input.metadata],
    "--progress=rawjson",
    input.context,
  ]
}

/** The stages of the fixture's own Dockerfile, as BuildKit lists them. */
export function targetsArgs(context: string): string[] {
  checkFolder(context, "the context")
  return [
    ...["docker", "buildx", "build", "--builder", "default"],
    "--call=targets,format=json",
    ...["--file", `${context}/Dockerfile`],
    "--progress=rawjson",
    context,
  ]
}

/** Each entry under `out`: its type, its path, and a link's target, one per line. */
export function listArgs(out: string): string[] {
  checkFolder(out, "the output folder")
  return ["find", out, "-mindepth", "1", "-printf", "%y\\t%P\\t%l\\n"]
}

/**
 * The entries `listArgs` printed, sorted by path: a file by its path, a
 * folder with a trailing `/`, a link as `path -> target`, anything else
 * with its type in brackets.
 */
export function copiedList(stdout: string): string[] {
  const entries: { path: string; words: string }[] = []
  for (const line of stdout.split("\n")) {
    if (line === "") continue
    const [type = "", path = "", target = ""] = line.split("\t")
    const words =
      type === "f"
        ? path
        : type === "d"
          ? `${path}/`
          : type === "l"
            ? `${path} -> ${target}`
            : `${path} [${type}]`
    entries.push({ path, words })
  }
  return entries
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => entry.words)
}

/**
 * The stages `--call=targets,format=json` listed: `name`, `name from base`,
 * `(default)` after the default; undefined when what it printed is not
 * that JSON.
 */
export function targetsOf(stdout: string): string[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const targets = (parsed as { targets?: unknown } | null)?.targets
  if (!Array.isArray(targets)) return undefined
  return targets.map((target: unknown) => {
    const t = (target ?? {}) as Record<string, unknown>
    const name =
      typeof t.name === "string" && t.name !== "" ? t.name : "(unnamed)"
    const base =
      typeof t.base === "string" && t.base !== "" ? ` from ${t.base}` : ""
    return `${name}${base}${t.default === true ? " (default)" : ""}`
  })
}

/** What the check made in the stand-in, for the removal. */
export type FileChoiceMade = {
  /** The record ids of its builds, from their `meta.json`. */
  readonly refs: (string | undefined)[]
}

async function must(run: InStandIn, args: readonly string[]): Promise<string> {
  const answer = await run(args)
  if (answer.code !== 0)
    throw new Error(
      `${args.slice(0, 3).join(" ")} failed in the stand-in: ${firstLine(answer)}`
    )
  return answer.stdout
}

/** One fixture: written, copied out, listed; and its stages. */
async function observeFixture(
  run: InStandIn,
  env: Record<string, string>,
  name: string,
  made: FileChoiceMade,
  fixtures: string
): Promise<string> {
  const context = checkFolder(`${ROOT}/ctx/${name}`, "the context")
  const out = checkFolder(`${ROOT}/out/${name}`, "the output folder")
  const metadata = `${ROOT}/meta/${name}.json`
  await must(run, [
    "sh",
    "-c",
    writeScript(context, [...fixtureFiles(join(fixtures, name)), ...RUN_TIME]),
  ])
  const copied = await run(
    rb7Command(copyOutArgs({ context, out, metadata }), env, {
      timeoutSeconds: BUILD_SECONDS,
    }),
    { timeoutMs: BUILD_SECONDS * 1000 + MINUTE }
  )
  const meta = await run(["cat", metadata])
  if (meta.code === 0) {
    try {
      made.refs.push(refOf(JSON.parse(meta.stdout) as Record<string, unknown>))
    } catch {
      // A meta.json that is not JSON names no record; the folder's list still does.
    }
  }
  let list: string
  if (copied.code !== 0) list = `not copied: ${firstError(copied)}`
  else {
    const found = copiedList(await must(run, listArgs(out)))
    list = `copied ${found.length} (${found.join(", ")})`
  }
  const called = await run(
    rb7Command(targetsArgs(context), env, { timeoutSeconds: BUILD_SECONDS }),
    { timeoutMs: BUILD_SECONDS * 1000 + MINUTE }
  )
  const stages = targetsOf(called.stdout)
  const targets =
    called.code !== 0
      ? `--call=targets failed: ${firstError(called)}`
      : stages === undefined
        ? `--call=targets printed ${firstLine(called) || "nothing"}`
        : `stages ${stages.join(", ")}`
  return `${name}: ${list}; ${targets}`
}

/** Writes each fixture in the stand-in, builds, and gives what the record line says. */
export async function observeFileChoice(
  run: InStandIn,
  made: FileChoiceMade,
  fixtures: string = FIXTURES
): Promise<string> {
  const env = rb7Env({ home: HOME, run: newRunToken() })
  await must(run, ["rm", "-rf", ROOT])
  await must(run, ["mkdir", "-p", HOME, `${ROOT}/meta`])
  const version = await run(rb7Command(["docker", "buildx", "version"], env))
  if (version.code !== 0)
    return `no buildx (${firstLine(version)}); nothing built`
  await must(run, [
    "sh",
    "-c",
    writeScript(COPY_OUT, [{ path: "Dockerfile", data: COPY_OUT_DOCKERFILE }]),
  ])
  const seen = [
    `buildx ${buildxVersionOf(version.stdout) ?? firstLine(version)}`,
  ]
  for (const name of fixtureNames(fixtures))
    seen.push(await observeFixture(run, env, name, made, fixtures))
  return seen.join(" | ")
}

/**
 * Removes, by name, what the check made in the stand-in: its builds'
 * records by id, then its folder. Gives what it could not remove; records
 * it could not remove are said in one line and go with the stand-in.
 */
export async function cleanUpFileChoice(
  run: InStandIn,
  made: FileChoiceMade,
  say: (line: string) => void = (line) => console.log(line)
): Promise<string[]> {
  const left: string[] = []
  const records = await removeRecords(run, HOME, made.refs)
  if (records.length > 0)
    say(
      `${CHECK} could not remove its build records ${records.join(", ")}; they go with the stand-in`
    )
  const folder = await run(["rm", "-rf", ROOT])
  if (folder.code !== 0) left.push(`${ROOT} (${firstLine(folder)})`)
  return left
}
