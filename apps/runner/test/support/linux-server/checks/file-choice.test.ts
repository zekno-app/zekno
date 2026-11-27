/**
 * `file-choice.ts` (specs/016-build-from-source, T019; check L17): the
 * `ignore-*` fixtures hold what the task names and nothing git leaves out
 * of a commit, the scripts write exactly their entries (run here with this
 * machine's own `sh` in a temporary folder), the check's two commands, the
 * reading of what they print, and the removal of what the check made, also
 * after a failure. A stand-in function answers for the stand-in; nothing
 * here runs Docker.
 */
import { describe, expect, test } from "bun:test"
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cleanUpFileChoice,
  COPY_OUT_DOCKERFILE,
  copiedList,
  copyOutArgs,
  type FileChoiceMade,
  fixtureFiles,
  fixtureNames,
  FIXTURES,
  gitIgnored,
  HOME,
  listArgs,
  observeFileChoice,
  ROOT,
  RUN_TIME,
  targetsArgs,
  targetsOf,
  writeScript,
} from "./file-choice"
import type { Answer } from "../host/host-docker"
import type { InStandIn } from "../build-runs/rb7"

const GITIGNORE = readFileSync(
  join(import.meta.dir, "../../../../../../.gitignore"),
  "utf8"
)

/** Stands in for `open.inStandIn`: records each call and answers as `answer` says. */
function fakeRun(
  answer: (args: readonly string[]) => Partial<Answer> | undefined = () =>
    undefined
) {
  const calls: (readonly string[])[] = []
  const run: InStandIn = async (args) => {
    calls.push(args)
    return { code: 0, stdout: "", stderr: "", ...answer(args) }
  }
  return { run, calls }
}

/** Runs a script with this machine's `sh`; gives its status. */
function sh(script: string): number {
  return Bun.spawnSync(["sh", "-c", script], {
    stdout: "ignore",
    stderr: "pipe",
  }).exitCode
}

/** Every entry under `folder`, as `copiedList` words them. */
function entriesUnder(folder: string): string[] {
  const found: string[] = []
  const walk = (relative: string) => {
    for (const name of readdirSync(join(folder, relative))) {
      const path = relative === "" ? name : `${relative}/${name}`
      const info = lstatSync(join(folder, path))
      if (info.isSymbolicLink())
        found.push(`${path} -> ${readlinkSync(join(folder, path))}`)
      else if (info.isDirectory()) {
        found.push(`${path}/`)
        walk(path)
      } else found.push(path)
    }
  }
  walk("")
  return found.sort((a, b) => (a < b ? -1 : 1))
}

describe("the ignore-* fixtures", () => {
  const names = fixtureNames()

  test("are the four folders beside the harness, each with a .dockerignore and a multi-stage Dockerfile", () => {
    expect(names).toEqual([
      "ignore-basics",
      "ignore-class",
      "ignore-depth",
      "ignore-escape",
    ])
    for (const name of names) {
      const paths = fixtureFiles(join(FIXTURES, name)).map((file) => file.path)
      expect(paths).toContain(".dockerignore")
      expect(paths).toContain("Dockerfile")
      const dockerfile = readFileSync(
        join(FIXTURES, name, "Dockerfile"),
        "utf8"
      )
      expect({
        name,
        stages:
          dockerfile.split("\n").filter((line) => /^FROM /i.test(line))
            .length >= 2,
      }).toEqual({ name, stages: true })
    }
  })

  test("each .dockerignore holds a negation, **, a leading /, trailing spaces, comments, an escaped #, a folder and the files of a folder", () => {
    for (const name of names) {
      const lines = readFileSync(
        join(FIXTURES, name, ".dockerignore"),
        "utf8"
      ).split("\n")
      const patterns = lines.filter((line) => !line.startsWith("#"))
      const has = {
        negation: patterns.some((line) => line.startsWith("!")),
        anyDepth: patterns.some((line) => line.includes("**")),
        leadingSlash: patterns.some((line) => /^!?\//.test(line)),
        trailingSpaces: patterns.some((line) => /\S {2,}$/.test(line)),
        comment: lines.some((line) => line.startsWith("#")),
        escapedHash: patterns.some((line) => /^!?\\#/.test(line)),
        folder: patterns.some((line) => /^[a-z0-9/]+$/.test(line.trim())),
        filesOfAFolder: patterns.some((line) => /^[a-z0-9/]+\/\*$/.test(line)),
      }
      expect({ name, has }).toEqual({
        name,
        has: {
          negation: true,
          anyDepth: true,
          leadingSlash: true,
          trailingSpaces: true,
          comment: true,
          escapedHash: true,
          folder: true,
          filesOfAFolder: true,
        },
      })
    }
  })

  test("no committed fixture file has a name the repository's .gitignore leaves out of a commit; the run-time names are such names", () => {
    for (const name of names)
      for (const file of fixtureFiles(join(FIXTURES, name)))
        expect({
          file: `${name}/${file.path}`,
          ignored: gitIgnored(file.path, GITIGNORE),
        }).toEqual({ file: `${name}/${file.path}`, ignored: false })
    for (const path of [
      ".env",
      ".env.local",
      "build/out.txt",
      "dist/app.js",
      "node_modules/pkg/index.js",
      "lib/node_modules/inner/index.js",
    ]) {
      expect(RUN_TIME.some((entry) => entry.path === path)).toBe(true)
      expect({ path, ignored: gitIgnored(path, GITIGNORE) }).toEqual({
        path,
        ignored: true,
      })
    }
    expect(RUN_TIME.filter((entry) => entry.kind !== "file")).toEqual([
      { kind: "link", path: "dockerfile-link", target: "Dockerfile" },
      { kind: "folder", path: "empty" },
    ])
  })
})

describe("gitIgnored", () => {
  const lines =
    "node_modules\nbuild\n.env*\n!.env.example\nout/\n*.pem\n.yarn/*\n"

  test("matches a line at any depth, a folder line only on a folder, the last line winning", () => {
    for (const path of [
      "node_modules/a",
      "a/node_modules/b",
      "build",
      "x/build/y",
      ".env",
      ".env.local",
      "out/a",
      "a/key.pem",
    ])
      expect({ path, ignored: gitIgnored(path, lines) }).toEqual({
        path,
        ignored: true,
      })
    for (const path of [
      "README.txt",
      ".env.example",
      "out",
      "a/out",
      "#hash.txt",
      "builder/a",
      ".yarn/x",
    ])
      expect({ path, ignored: gitIgnored(path, lines) }).toEqual({
        path,
        ignored: false,
      })
  })
})

describe("writeScript", () => {
  test("writes a fixture and the run-time entries exactly, links and empty folders among them", () => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-file-choice-"))
    try {
      const files = fixtureFiles(join(FIXTURES, "ignore-basics"))
      expect(
        sh(writeScript(join(folder, "ctx"), [...files, ...RUN_TIME]))
      ).toBe(0)
      const written = join(folder, "ctx")
      for (const file of files)
        expect(readFileSync(join(written, file.path), "utf8")).toBe(file.data)
      expect(readFileSync(join(written, ".dockerignore"), "utf8")).toContain(
        "notes.txt   \n"
      )
      expect(readlinkSync(join(written, "dockerfile-link"))).toBe("Dockerfile")
      expect(readdirSync(join(written, "empty"))).toEqual([])
      expect(entriesUnder(written)).toContain("node_modules/pkg/index.js")
      expect(entriesUnder(written)).toContain("#hash.txt")
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  test("quotes every name, and refuses a path that leaves the folder or a relative folder", () => {
    const script = writeScript("/tmp/zekno-check-x/a", [
      { path: "it's/a b.txt", data: "it's\n" },
    ])
    expect(script).toBe(
      [
        "set -eu",
        "mkdir -p '/tmp/zekno-check-x/a'",
        "cd '/tmp/zekno-check-x/a'",
        "mkdir -p './it'\\''s'",
        "printf '%s' 'it'\\''s\n' > './it'\\''s/a b.txt'",
      ].join("\n")
    )
    for (const path of ["../a", "a/../../b", "/etc/passwd", "a//b", "a\nb"])
      expect(() =>
        writeScript("/tmp/zekno-check-x", [{ path, data: "" }])
      ).toThrow()
    expect(() => writeScript("tmp/x", [])).toThrow("not an absolute path")
  })
})

describe("the check's two commands", () => {
  test("copy the context out with FROM scratch, no attestation beside the files, and list the stages", () => {
    expect(COPY_OUT_DOCKERFILE).toBe("FROM scratch\nCOPY . /\n")
    expect(
      copyOutArgs({
        context: `${ROOT}/ctx/ignore-basics`,
        out: `${ROOT}/out/ignore-basics`,
        metadata: `${ROOT}/meta/ignore-basics.json`,
      })
    ).toEqual([
      ...["docker", "buildx", "build", "--builder", "default"],
      ...["--file", `${ROOT}/copy-out/Dockerfile`],
      ...["--provenance=false", "--sbom=false"],
      ...["--output", `type=local,dest=${ROOT}/out/ignore-basics`],
      ...["--metadata-file", `${ROOT}/meta/ignore-basics.json`],
      "--progress=rawjson",
      `${ROOT}/ctx/ignore-basics`,
    ])
    expect(targetsArgs(`${ROOT}/ctx/ignore-depth`)).toEqual([
      ...["docker", "buildx", "build", "--builder", "default"],
      "--call=targets,format=json",
      ...["--file", `${ROOT}/ctx/ignore-depth/Dockerfile`],
      "--progress=rawjson",
      `${ROOT}/ctx/ignore-depth`,
    ])
    expect(listArgs(`${ROOT}/out/a`)).toEqual([
      ...["find", `${ROOT}/out/a`, "-mindepth", "1"],
      ...["-printf", "%y\\t%P\\t%l\\n"],
    ])
  })

  test("refuse a folder outside /tmp/zekno-check-*", () => {
    expect(() =>
      copyOutArgs({
        context: "/home/me/app",
        out: `${ROOT}/o`,
        metadata: `${ROOT}/m`,
      })
    ).toThrow("is not a folder under /tmp/zekno-check-*")
    expect(() => targetsArgs("/tmp/zekno-check-x/../../etc")).toThrow()
    expect(() => listArgs("/")).toThrow()
  })
})

describe("reading what they printed", () => {
  test("the copied entries, sorted by path, folders with /, links with their target", () => {
    expect(
      copiedList(
        "f\tlib/util.txt\t\nd\tlib\t\nl\tdockerfile-link\tDockerfile\nd\tempty\t\nf\t#hash.txt\t\np\tfifo\t\n"
      )
    ).toEqual([
      "#hash.txt",
      "dockerfile-link -> Dockerfile",
      "empty/",
      "fifo [p]",
      "lib/",
      "lib/util.txt",
    ])
    expect(copiedList("")).toEqual([])
  })

  test("the stages, with their base and the default; anything not that JSON gives nothing", () => {
    expect(
      targetsOf(
        JSON.stringify({
          targets: [
            { name: "base", base: "scratch" },
            { name: "assets", base: "base", description: "x" },
            { base: "scratch" },
            { name: "final", default: true, base: "assets" },
          ],
          sources: [],
        })
      )
    ).toEqual([
      "base from scratch",
      "assets from base",
      "(unnamed) from scratch",
      "final from assets (default)",
    ])
    expect(targetsOf("TARGET DESCRIPTION\nbase")).toBeUndefined()
    expect(targetsOf('{"other":1}')).toBeUndefined()
  })
})

describe("in the stand-in", () => {
  const BUILT = JSON.stringify({
    "buildx.build.ref": "default/default/abcdefghij123",
  })

  test("writes each fixture with one script, builds with a private BUILDX_CONFIG, and records the list and the stages", async () => {
    const { run, calls } = fakeRun((args) => {
      if (args.includes("version"))
        return { stdout: "github.com/docker/buildx v0.34.1 abc\n" }
      if (args[0] === "cat") return { stdout: BUILT }
      if (args[0] === "find") return { stdout: "f\tapp.txt\t\nd\tempty\t\n" }
      if (args.includes("--call=targets,format=json"))
        return { stdout: '{"targets":[{"name":"one","default":true}]}' }
      return undefined
    })
    const made: FileChoiceMade = { refs: [] }
    const seen = await observeFileChoice(run, made)
    expect(seen.split(" | ")).toEqual([
      "buildx 0.34.1",
      ...fixtureNames().map(
        (name) => `${name}: copied 2 (app.txt, empty/); stages one (default)`
      ),
    ])
    expect(made.refs).toEqual(fixtureNames().map(() => "abcdefghij123"))
    expect(calls[0]).toEqual(["rm", "-rf", ROOT])
    const builds = calls.filter((args) => args.includes("buildx"))
    for (const args of builds) {
      const at = args.indexOf("env")
      expect(args.slice(at, at + 2)).toEqual(["env", "-i"])
      expect(args).toContain(`BUILDX_CONFIG=${HOME}/buildx`)
    }
    expect(builds.filter((args) => args[0] === "timeout")).toHaveLength(
      2 * fixtureNames().length
    )
    const scripts = calls.filter((args) => args[0] === "sh")
    expect(scripts).toHaveLength(1 + fixtureNames().length)
    expect(scripts[1]![2]).toContain(`cd '${ROOT}/ctx/ignore-basics'`)
    expect(scripts[1]![2]).toContain(
      "ln -s -- 'Dockerfile' './dockerfile-link'"
    )
  })

  test("says when a build or the stages fail, and when buildx is missing", async () => {
    const failing = fakeRun((args) => {
      if (args.includes("version"))
        return { stdout: "github.com/docker/buildx v0.39.1 x\n" }
      if (args.includes("--output"))
        return { code: 1, stderr: "ERROR: failed to solve: no such thing\n" }
      if (args.includes("--call=targets,format=json"))
        return { code: 1, stderr: "ERROR: unknown flag: --call\n" }
      if (args[0] === "cat") return { code: 1, stderr: "No such file\n" }
      return undefined
    })
    const made: FileChoiceMade = { refs: [] }
    const seen = await observeFileChoice(failing.run, made)
    expect(seen).toContain(
      "ignore-basics: not copied: failed to solve: no such thing; --call=targets failed: unknown flag: --call"
    )
    expect(made.refs).toEqual([])
    const none = fakeRun((args) =>
      args.includes("version")
        ? { code: 1, stderr: "docker: 'buildx' is not a docker command.\n" }
        : undefined
    )
    expect(await observeFileChoice(none.run, { refs: [] })).toBe(
      "no buildx (docker: 'buildx' is not a docker command.); nothing built"
    )
    expect(none.calls.some((args) => args.includes("--output"))).toBe(false)
  })

  test("removes its build records by id and its folder, also after a failure, and says what stays", async () => {
    const { run, calls } = fakeRun((args) => {
      if (args[0] === "sh" && args[2]?.startsWith("ls -1"))
        return { stdout: "abcdefghij123\nzzzzzzzzzz999\n" }
      if (args.includes("history")) return { code: 1, stderr: "no such record" }
      return undefined
    })
    const said: string[] = []
    const left = await cleanUpFileChoice(
      run,
      { refs: ["abcdefghij123", undefined] },
      (line) => said.push(line)
    )
    expect(left).toEqual([])
    expect(calls.at(-1)).toEqual(["rm", "-rf", ROOT])
    const history = calls.find((args) => args.includes("history"))!
    expect(history.slice(-2)).toEqual(["abcdefghij123", "zzzzzzzzzz999"])
    expect(said).toEqual([
      "L17 could not remove its build records abcdefghij123, zzzzzzzzzz999; they go with the stand-in",
    ])
    const stuck = fakeRun((args) =>
      args[0] === "rm" ? { code: 1, stderr: "rm: busy\n" } : undefined
    )
    expect(await cleanUpFileChoice(stuck.run, { refs: [] }, () => {})).toEqual([
      `${ROOT} (rm: busy)`,
    ])
  })
})
