/**
 * The instructions zekno reads from a Dockerfile, each in the forms BuildKit
 * reads (specs/016-build-from-source, contracts/cli.md CL3, "Read"; FR-036a,
 * FR-042; tasks T117): `ARG` before the first `FROM` and in each stage;
 * `FROM [--platform=…] ref [AS name]`; `ENV` in both forms; `COPY --from`;
 * `RUN --mount=…,from=`; `ADD [--checksum=…]` sources in shell and JSON form;
 * `EXPOSE`; `ONBUILD` lines kept, marked as not run here (plan.md item 17).
 * Words are kept as written: expanding them is `dockerfile/expand.ts`.
 */
import { describe, expect, test } from "bun:test"

import {
  readDockerfile,
  type DockerfileReading,
} from "../../src/dockerfile/instructions"

const read = (text: string): DockerfileReading =>
  readDockerfile(new TextEncoder().encode(text), "Dockerfile")

/** The commands of the first stage, without their lines. */
const commands = (text: string) =>
  read(text).stages[0]!.commands.map(({ line: _, ...command }) => command)

describe("ARG", () => {
  test("before the first FROM, each pair with its line, a name alone has no value, values kept as written", () => {
    const reading = read(
      'ARG BASE=node:20 TAG\nARG QUOTED="a b"\nFROM ${BASE}\n'
    )
    expect(reading.globalArgs).toEqual([
      { key: "BASE", value: "node:20", line: 1 },
      { key: "TAG", value: null, line: 1 },
      { key: "QUOTED", value: '"a b"', line: 2 },
    ])
  })

  test("in a stage, as one of its commands; only the first = splits", () => {
    expect(commands("FROM scratch\nARG A=1 B C=x=y\n")).toEqual([
      {
        kind: "arg",
        onbuild: false,
        pairs: [
          { key: "A", value: "1" },
          { key: "B", value: null },
          { key: "C", value: "x=y" },
        ],
      },
    ])
  })

  test("an escaped space or a quoted one keeps a word whole", () => {
    expect(commands('FROM scratch\nARG A=a\\ b B="c d"\n')).toEqual([
      {
        kind: "arg",
        onbuild: false,
        pairs: [
          { key: "A", value: "a\\ b" },
          { key: "B", value: '"c d"' },
        ],
      },
    ])
  })
})

describe("FROM", () => {
  test("a reference, a platform, a name in any case, lowercased as BuildKit keeps it", () => {
    const { stages } = read(
      "FROM node:20\nFROM --platform=$BUILDPLATFORM golang:1 AS Build\nfrom build as Final\n"
    )
    expect(stages.map(({ commands: _, ...stage }) => stage)).toEqual([
      { index: 0, name: null, base: "node:20", platform: null, line: 1 },
      {
        index: 1,
        name: "build",
        base: "golang:1",
        platform: "$BUILDPLATFORM",
        line: 2,
      },
      { index: 2, name: "final", base: "build", platform: null, line: 3 },
    ])
  })

  test("a stage's commands are those after its FROM; an instruction before any FROM but ARG is not read", () => {
    const { stages } = read("EXPOSE 1\nFROM a\nEXPOSE 2\nFROM b\nEXPOSE 3\n")
    expect(
      stages.map((stage) => stage.commands.map((command) => command.line))
    ).toEqual([[3], [5]])
  })
})

describe("ENV", () => {
  test("name=value pairs, quotes kept as written", () => {
    expect(commands('FROM scratch\nENV A=1 B="x y" C=\n')).toEqual([
      {
        kind: "env",
        onbuild: false,
        pairs: [
          { key: "A", value: "1" },
          { key: "B", value: '"x y"' },
          { key: "C", value: "" },
        ],
      },
    ])
  })

  test("the old form: a name, then the rest of the line as its value", () => {
    expect(commands("FROM scratch\nENV GREETING hello  there\n")).toEqual([
      {
        kind: "env",
        onbuild: false,
        pairs: [{ key: "GREETING", value: "hello  there" }],
      },
    ])
  })
})

describe("COPY", () => {
  test("--from, with its quotes taken off; sources without the destination", () => {
    expect(
      commands(
        'FROM scratch\nCOPY --from=build /app /app\nCOPY --chown=1:1 --from="other" a b /dest/\nCOPY a b\n'
      )
    ).toEqual([
      { kind: "copy", onbuild: false, from: "build", sources: ["/app"] },
      { kind: "copy", onbuild: false, from: "other", sources: ["a", "b"] },
      { kind: "copy", onbuild: false, from: null, sources: ["a"] },
    ])
  })

  test("the JSON form, and a heredoc, which is no source on disk", () => {
    expect(
      commands(
        'FROM scratch\nCOPY ["a b", "c", "/d"]\nCOPY <<EOF /x\nhello\nEOF\n'
      )
    ).toEqual([
      { kind: "copy", onbuild: false, from: null, sources: ["a b", "c"] },
      { kind: "copy", onbuild: false, from: null, sources: [] },
    ])
  })
})

describe("RUN --mount", () => {
  test("each mount's type and from, its options comma-separated, a field in escaped quotes holding commas (the flag's own quotes are taken off first)", () => {
    expect(
      commands(
        'FROM scratch\nRUN --mount=type=cache,target=/root/.npm,from=deps --mount=from=build,source=/out,target=/in --mount=type=bind,\\"from=a,b\\" --network=none true\nRUN echo no mount\n'
      )
    ).toEqual([
      {
        kind: "run",
        onbuild: false,
        mounts: [
          { type: "cache", from: "deps" },
          { type: "bind", from: "build" },
          { type: "bind", from: "a,b" },
        ],
      },
      { kind: "run", onbuild: false, mounts: [] },
    ])
  })

  test("a mount BuildKit cannot read as comma-separated fields is kept as unreadable, never guessed", () => {
    expect(
      commands('FROM scratch\nRUN --mount=type=bind,from=\\"a true\n')
    ).toEqual([
      { kind: "run", onbuild: false, mounts: [{ type: null, from: null }] },
    ])
  })
})

describe("ADD", () => {
  test("--checksum, and sources in shell and JSON form", () => {
    expect(
      commands(
        'FROM scratch\nADD --checksum=sha256:abc https://example.com/a.tgz /a\nADD ["https://example.com/b c", "/b"]\nADD x y /z/\nADD <<EOF /h\nhi\nEOF\n'
      )
    ).toEqual([
      {
        kind: "add",
        onbuild: false,
        checksum: "sha256:abc",
        sources: ["https://example.com/a.tgz"],
      },
      {
        kind: "add",
        onbuild: false,
        checksum: null,
        sources: ["https://example.com/b c"],
      },
      { kind: "add", onbuild: false, checksum: null, sources: ["x", "y"] },
      { kind: "add", onbuild: false, checksum: null, sources: [] },
    ])
  })
})

describe("EXPOSE", () => {
  test("its ports as written", () => {
    expect(commands("FROM scratch\nEXPOSE 3000 8080/tcp ${PORT}\n")).toEqual([
      {
        kind: "expose",
        onbuild: false,
        ports: ["3000", "8080/tcp", "${PORT}"],
      },
    ])
  })
})

describe("ONBUILD and the rest", () => {
  test("ONBUILD's instruction is read, marked as not run in this stage (plan.md item 17)", () => {
    expect(
      commands(
        "FROM scratch\nONBUILD COPY --from=other /a /b\nONBUILD ENV A=1\n"
      )
    ).toEqual([
      { kind: "copy", onbuild: true, from: "other", sources: ["/a"] },
      { kind: "env", onbuild: true, pairs: [{ key: "A", value: "1" }] },
    ])
  })

  test("instructions that name no image, variable or port are not kept", () => {
    expect(
      commands('FROM scratch\nWORKDIR /app\nCMD ["node"]\nLABEL a=b\nUSER 1\n')
    ).toEqual([])
  })

  test("the lines of each command are kept, and the reading carries the lexer's directives and syntax lines", () => {
    const reading = read(
      "# syntax=x\nFROM scratch\nRUN a \\\n  b\nEXPOSE 1\n# syntax=y\n"
    )
    expect(reading.stages[0]!.commands.map((command) => command.line)).toEqual([
      3, 5,
    ])
    expect(reading.directives.syntax).toBe("x")
    expect(reading.syntaxLines).toEqual([1, 6])
  })
})
