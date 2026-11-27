/**
 * The proposed `.dockerignore` (specs/016-build-from-source, contracts/cli.md
 * CL6, "What it shows"; data-model.md, "The proposed .dockerignore";
 * FR-002b; tasks T123). Every folder is written at run time: the
 * repository's `.gitignore` ignores `dist`, `build`, `node_modules` and
 * `.next`. No sentence is checked: the first line is checked by its id.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { readDockerfile } from "../../src/dockerfile/instructions"
import { checkLimits, limitsOf } from "../../src/pack/limits"
import {
  copiedByName,
  dockerFormOf,
  proposalRules,
  proposeIgnore,
  type Proposal,
} from "../../src/pack/propose"
import { walkFolder } from "../../src/pack/walk"

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zekno-propose-")))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, content = "x"): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

const reading = (text: string) =>
  readDockerfile(new TextEncoder().encode(text), "Dockerfile")

/** The proposal for the root with its Dockerfile, the last stage chosen unless `stage` says. */
function propose(stage: string | null = null): Proposal {
  const found = proposeIgnore(root, {
    dockerfile: "Dockerfile",
    reading: reading(readFileSync(join(root, "Dockerfile"), "utf8")),
    stage,
  })
  if (found === undefined) throw new Error("expected a proposal")
  return found
}

describe("a line of .gitignore in Docker's form (FR-002b)", () => {
  test.each([
    ["node_modules", "**/node_modules"],
    ["*.log", "**/*.log"],
    ["logs/", "**/logs"],
    ["/build", "build"],
    ["/cache/", "cache"],
    ["docs/api", "docs/api"],
    ["docs/api/", "docs/api"],
    ["/docs/api", "docs/api"],
    ["**/tmp", "**/tmp"],
    ["!keep.log", "!**/keep.log"],
    ["!/public/keep", "!public/keep"],
    ["  spaced  ", "**/spaced"],
    ["crlf\r", "**/crlf"],
  ])("%p becomes %p", (line, docker) => {
    expect(dockerFormOf(line)).toBe(docker)
  })

  test.each(["", "   ", "# a comment", "#node_modules", "/", "!"])(
    "%p is dropped",
    (line) => {
      expect(dockerFormOf(line)).toBeUndefined()
    }
  )
})

describe("the proposal (CL6; data-model.md)", () => {
  test("its first line is A6, then the .gitignore in Docker's form, then the dependency folders", () => {
    write("Dockerfile", "FROM node:22-slim\nCOPY . .\n")
    write(
      ".gitignore",
      "# deps\n\nnode_modules\n/coverage\nlogs/\n!logs/keep\n*.tmp\r\n"
    )
    const proposal = propose()
    expect(proposal.first).toEqual({ id: "A6" })
    expect(proposal.lines).toEqual([
      "**/node_modules",
      "coverage",
      "**/logs",
      "!logs/keep",
      "**/*.tmp",
      "**/.venv",
    ])
    expect(proposal.dropped).toEqual([])
  })

  test("with no .gitignore: the dependency folders, and .next when present", () => {
    write("Dockerfile", "FROM node:22-slim\n")
    expect(propose().lines).toEqual(["**/node_modules", "**/.venv"])
    mkdirSync(join(root, ".next"))
    expect(propose().lines).toEqual(["**/node_modules", "**/.venv", ".next"])
  })

  test("a dependency folder the .gitignore already covers is not added again", () => {
    write("Dockerfile", "FROM node:22-slim\n")
    mkdirSync(join(root, ".next"))
    write(".gitignore", ".next/\n**/.venv\nnode_modules/\n")
    expect(propose().lines).toEqual(["**/.next", "**/.venv", "**/node_modules"])
  })

  test("nested .gitignore files are not read, and a .gitignore that is a link is not followed", () => {
    write("Dockerfile", "FROM node:22-slim\n")
    write("packages/a/.gitignore", "generated\n")
    expect(propose().lines).toEqual(["**/node_modules", "**/.venv"])
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "zekno-out-")))
    try {
      writeFileSync(join(outside, "rules"), "secret-name\n")
      symlinkSync(join(outside, "rules"), join(root, ".gitignore"))
      expect(propose().lines).toEqual(["**/node_modules", "**/.venv"])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test("there is none when the folder has an ignore file BuildKit would use", () => {
    write("Dockerfile", "FROM node:22-slim\n")
    write(".dockerignore", "node_modules\n")
    const input = {
      dockerfile: "Dockerfile",
      reading: reading("FROM node:22-slim\n"),
      stage: null,
    }
    expect(proposeIgnore(root, input)).toBeUndefined()
    rmSync(join(root, ".dockerignore"))
    write("Dockerfile.dockerignore", "node_modules\n")
    expect(proposeIgnore(root, input)).toBeUndefined()
  })
})

describe("lines the Dockerfile's copies keep out (CL6; A5a)", () => {
  test("dist copied by name is dropped and named", () => {
    write("Dockerfile", "FROM node:22-slim\nCOPY dist ./dist\nCOPY . .\n")
    write(".gitignore", "dist\n*.log\n")
    const proposal = propose()
    expect(proposal.lines).toEqual(["**/*.log", "**/node_modules", "**/.venv"])
    expect(proposal.dropped).toEqual([{ line: "**/dist", path: "dist" }])
  })

  test("a line that leaves out a folder above a copied path is dropped; one under it is kept", () => {
    write(
      "Dockerfile",
      "FROM node:22-slim\nCOPY out/server.js /app/\nCOPY src /app/src\n"
    )
    write(".gitignore", "/out\nsrc/generated\n")
    const proposal = propose()
    expect(proposal.lines).toContain("src/generated")
    expect(proposal.dropped).toEqual([{ line: "out", path: "out/server.js" }])
  })

  test("a dependency folder copied by name is dropped too", () => {
    write("Dockerfile", "FROM node:22-slim\nCOPY node_modules ./node_modules\n")
    const proposal = propose()
    expect(proposal.lines).toEqual(["**/.venv"])
    expect(proposal.dropped).toEqual([
      { line: "**/node_modules", path: "node_modules" },
    ])
  })

  test("only the stages the chosen stage uses count: its base, COPY --from and RUN --mount from", () => {
    write(
      "Dockerfile",
      [
        "FROM node:22-slim AS deps",
        "COPY vendor ./vendor",
        "FROM node:22-slim AS unused",
        "COPY dist ./dist",
        "FROM node:22-slim AS helper",
        "COPY generated ./generated",
        "FROM node:22-slim AS tools",
        "ADD tools.tar /opt/",
        "FROM deps AS final",
        "COPY --from=helper /generated /app/generated",
        "RUN --mount=type=bind,from=tools,target=/t true",
        "",
      ].join("\n")
    )
    write(".gitignore", "vendor\ndist\ngenerated\ntools.tar\n")
    const last = propose()
    expect(last.lines).toContain("**/dist")
    expect(last.dropped).toEqual([
      { line: "**/vendor", path: "vendor" },
      { line: "**/generated", path: "generated" },
      { line: "**/tools.tar", path: "tools.tar" },
    ])
    const unused = propose("unused")
    expect(unused.dropped).toEqual([{ line: "**/dist", path: "dist" }])
  })

  test("a source with a wildcard is not copied by name; a variable is read as BuildKit expands it", () => {
    write(
      "Dockerfile",
      [
        "FROM node:22-slim",
        "ENV OUT=dist",
        // An ARG in a stage built from an image is unknown: the image's own ENV could win over it.
        "ARG KEPT=public",
        "COPY ${OUT} ./out",
        "COPY ${KEPT} ./public",
        "COPY public/*.html ./",
        "ADD https://example.com/a.tgz /a",
        "",
      ].join("\n")
    )
    write(".gitignore", "dist\npublic\na.tgz\n")
    const proposal = propose()
    expect(proposal.lines).toEqual([
      "**/public",
      "**/a.tgz",
      "**/node_modules",
      "**/.venv",
    ])
    expect(proposal.dropped).toEqual([{ line: "**/dist", path: "dist" }])
  })

  test("the paths a Dockerfile copies by name", () => {
    expect(
      copiedByName(
        reading(
          'FROM node:22-slim\nCOPY ./a /x\nCOPY /b/ c.txt /y/\nCOPY . .\nCOPY ["d e", "/z"]\nCOPY --from=node:22 /usr /usr\nADD f.tar /\nONBUILD COPY g /g\n'
        ),
        null
      )
    ).toEqual(["a", "b", "c.txt", "d e", "f.tar"])
  })
})

describe("the walk with the proposal (FR-002b)", () => {
  test("a 600 MB sparse node_modules is proposed as **/node_modules, and the walk sends none of it", () => {
    write("Dockerfile", "FROM node:22-slim\nCOPY . .\n")
    write("package.json", "{}")
    write("src/index.js", "console.log(1)\n")
    const big = join(root, "node_modules", "big", "blob.bin")
    mkdirSync(dirname(big), { recursive: true })
    closeSync(openSync(big, "w"))
    truncateSync(big, 600 * 1000 * 1000)
    const proposal = propose()
    expect(proposal.lines).toContain("**/node_modules")
    const found = walkFolder(root, {
      dockerfile: "Dockerfile",
      ignore: proposalRules(proposal),
      include: [],
      agreed: () => false,
      zeknoHome: join(root, "..", "no-such-home"),
    })
    expect(
      found.entries.some((entry) => entry.name.startsWith("node_modules"))
    ).toBe(false)
    expect(found.leftOut).toContainEqual({
      rule: "ignore_file",
      path: "node_modules",
      folder: true,
    })
    expect(() => checkLimits(found)).not.toThrow()
    expect(limitsOf(found).bytes).toBeLessThan(10_000)
  })
})
