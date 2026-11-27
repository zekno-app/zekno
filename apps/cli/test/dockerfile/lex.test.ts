/**
 * The Dockerfile lexer, as BuildKit's parser reads lines
 * (specs/016-build-from-source, contracts/cli.md CL3, "Lexing"; FR-042;
 * tasks T110). Cases are written from BuildKit's documented grammar:
 * directives at the very top, the escape character, continuations with
 * comment and empty lines inside dropped, heredocs never read as
 * instructions, and the bounds. Core's `isSyntaxLine` is applied to every
 * line apart from the lexer (core.md CO6). Stops are checked by their id,
 * never by words.
 */
import { describe, expect, test } from "bun:test"

import { CliError } from "../../src/cli/errors"
import {
  DOCKERFILE_BYTES,
  DOCKERFILE_LINES,
  DockerfileStop,
  lexDockerfile,
  type Lexed,
  type OwnDockerfileLine,
} from "../../src/dockerfile/lex"

const lex = (text: string): Lexed =>
  lexDockerfile(new TextEncoder().encode(text), "Dockerfile")

/** Each instruction as `KEYWORD args` with its first and last line. */
const shapes = (text: string) =>
  lex(text).instructions.map(({ keyword, flags, args, start, end }) => ({
    line: [keyword, ...flags, args].filter((part) => part !== "").join(" "),
    start,
    end,
  }))

/** The stop a call throws, by its line; fails when it throws something else or nothing. */
function stopOf(work: () => unknown): OwnDockerfileLine {
  try {
    work()
  } catch (error) {
    expect(error).toBeInstanceOf(DockerfileStop)
    expect(error).toBeInstanceOf(CliError)
    const line = (error as DockerfileStop).line
    // Until its row is written (T156), the text said is the id.
    expect((error as DockerfileStop).message).toBe(line.id)
    return line
  }
  throw new Error("no stop was thrown")
}

describe("instructions and their lines", () => {
  test("keywords in any case, flags taken off with their quotes, arguments trimmed, comments and empty lines skipped", () => {
    expect(
      shapes(
        '# a comment\n\nfrom  --platform=$BUILDPLATFORM node:20  AS  build\n  RUN echo hi  \nCOPY --from="build" --chown=a\\ b /app /app\n'
      )
    ).toEqual([
      {
        line: "from --platform=$BUILDPLATFORM node:20  AS  build",
        start: 3,
        end: 3,
      },
      { line: "RUN echo hi", start: 4, end: 4 },
      { line: "COPY --from=build --chown=a b /app /app", start: 5, end: 5 },
    ])
  })

  test("a continuation joins lines with nothing between them, its comment and empty lines dropped", () => {
    expect(
      shapes(
        "RUN apt-get update && \\\n# a comment inside\n\n   \n    apt-get install -y curl\nEXPOSE 3000\n"
      )
    ).toEqual([
      {
        line: "RUN apt-get update &&     apt-get install -y curl",
        start: 1,
        end: 5,
      },
      { line: "EXPOSE 3000", start: 6, end: 6 },
    ])
  })

  test("the escape character may be followed by spaces or tabs before the line ends, and CRLF ends are read as LF", () => {
    expect(shapes("RUN a \\ \t\r\n  b\r\nENV X=1\r\n")).toEqual([
      { line: "RUN a   b", start: 1, end: 2 },
      { line: "ENV X=1", start: 3, end: 3 },
    ])
  })

  test("the backtick escape: a backslash is then an ordinary character and a backtick continues the line", () => {
    const read = lex(
      "# escape=`\nFROM scratch\nCOPY a\\b `\n  c:\\d\nRUN echo \\\nEXPOSE 1\n"
    )
    expect(read.directives.escape).toBe("`")
    expect(
      read.instructions.map(({ keyword, args }) => `${keyword} ${args}`)
    ).toEqual(["FROM scratch", "COPY a\\b   c:\\d", "RUN echo \\", "EXPOSE 1"])
  })

  test("ONBUILD holds the instruction after it, read as one of its own", () => {
    const [onbuild] = lex("ONBUILD COPY --from=other /a /b\n").instructions
    expect(onbuild).toMatchObject({
      keyword: "ONBUILD",
      args: "COPY --from=other /a /b",
    })
    expect(onbuild!.onbuild).toMatchObject({
      keyword: "COPY",
      flags: ["--from=other"],
      args: "/a /b",
    })
  })

  test("a byte order mark at the start is dropped", () => {
    expect(lex("\ufeffFROM scratch\n").instructions[0]!.keyword).toBe("FROM")
  })
})

describe("directives at the very top", () => {
  test("syntax, escape and check, in any case, with spaces around =", () => {
    const read = lex(
      "# SYNTAX = docker/dockerfile:1\n#Escape=\\\n# check=skip=all\nFROM scratch\n"
    )
    expect(read.directives).toEqual({
      syntax: "docker/dockerfile:1",
      escape: "\\",
      check: "skip=all",
    })
  })

  test("after an instruction, an empty line, another comment or an unknown directive, a directive is a comment", () => {
    for (const text of [
      "FROM scratch\n# escape=`\nRUN a \\\n b\n",
      "\n# escape=`\nRUN a \\\n b\n",
      "# hello\n# escape=`\nRUN a \\\n b\n",
      "# unknown=1\n# escape=`\nRUN a \\\n b\n",
    ]) {
      const read = lex(text)
      expect(read.directives.escape).toBe("\\")
      expect(read.instructions.at(-1)).toMatchObject({
        keyword: "RUN",
        args: "a  b",
      })
    }
  })

  test("a repeated directive, in any case, is a stop of its own", () => {
    expect(stopOf(() => lex("# syntax=a\n# SYNTAX=b\nFROM scratch\n"))).toEqual(
      {
        id: "dockerfile_directive",
        why: "repeated",
        name: "syntax",
        file: "Dockerfile",
        at: 2,
      }
    )
    expect(stopOf(() => lex("# escape=\\\n# escape=`\n"))).toMatchObject({
      why: "repeated",
      name: "escape",
      at: 2,
    })
  })

  test("an escape directive that is neither a backslash nor a backtick is a stop of its own, as BuildKit refuses it", () => {
    expect(stopOf(() => lex("# escape=x\nFROM scratch\n"))).toEqual({
      id: "dockerfile_directive",
      why: "escape",
      name: "escape",
      file: "Dockerfile",
      at: 1,
    })
  })
})

describe("core's isSyntaxLine on every line, apart from the lexer (CO6)", () => {
  test("a # syntax= line after the first instruction is a comment to BuildKit, and is still found", () => {
    const read = lex(
      "FROM scratch\n# syntax=evil/frontend\nRUN true\n  #   SyNtAx = other\n"
    )
    expect(read.directives.syntax).toBeNull()
    expect(read.syntaxLines).toEqual([2, 4])
  })

  test("the directive at the top is found too, and a line inside a heredoc", () => {
    const read = lex(
      "# syntax=docker/dockerfile:1\nFROM scratch\nCOPY <<EOF /x\n# syntax=inside\nEOF\n"
    )
    expect(read.directives.syntax).toBe("docker/dockerfile:1")
    expect(read.syntaxLines).toEqual([1, 4])
  })
})

describe("heredocs are never read as instructions", () => {
  test("a heredoc holding FROM: its lines are its content, and the instructions after it are read", () => {
    const read = lex(
      "FROM scratch AS base\nCOPY <<EOF /notes.txt\nFROM scratch AS not-a-stage\nEOF\n\nFROM base AS second\n"
    )
    expect(
      read.instructions.map(({ keyword, args }) => `${keyword} ${args}`)
    ).toEqual([
      "FROM scratch AS base",
      "COPY <<EOF /notes.txt",
      "FROM base AS second",
    ])
    expect(read.instructions[1]).toMatchObject({
      start: 2,
      end: 4,
      heredocs: [
        {
          name: "EOF",
          chomp: false,
          expand: true,
          content: "FROM scratch AS not-a-stage\n",
        },
      ],
    })
  })

  test("<<-WORD drops leading tabs from its end line; quoted names do not expand; several heredocs on one line are read in turn", () => {
    const read = lex(
      "RUN <<-END cat\n\tFROM a\n\tEND\nRUN <<'ONE' <<\"TWO\" cat\nFROM b\nONE\nFROM c\nTWO\nRUN 3<<X\nFROM d\nX\nEXPOSE 1\n"
    )
    expect(read.instructions.map((instruction) => instruction.keyword)).toEqual(
      ["RUN", "RUN", "RUN", "EXPOSE"]
    )
    expect(read.instructions[0]!.heredocs).toEqual([
      { name: "END", chomp: true, expand: true, content: "\tFROM a\n" },
    ])
    expect(read.instructions[1]!.heredocs).toEqual([
      { name: "ONE", chomp: false, expand: false, content: "FROM b\n" },
      { name: "TWO", chomp: false, expand: false, content: "FROM c\n" },
    ])
    expect(read.instructions[2]!.heredocs).toMatchObject([
      { name: "X", content: "FROM d\n" },
    ])
  })

  test("ADD and ONBUILD RUN hold heredocs; ENV, the JSON form and a quoted << do not", () => {
    expect(lex("ADD <<E /x\nFROM a\nE\n").instructions).toHaveLength(1)
    expect(lex("ONBUILD RUN <<E\nFROM a\nE\n").instructions).toHaveLength(1)
    for (const text of [
      "ENV A=<<E\nFROM a\nE\n",
      'RUN ["sh", "<<E"]\nFROM a\nE\n',
      'RUN echo "<<E"\nFROM a\nE\n',
    ])
      expect(
        lex(text).instructions.map((instruction) => instruction.keyword)
      ).toEqual([text.slice(0, 3), "FROM", "E"])
  })

  test("a heredoc word BuildKit expands to nothing is no heredoc: the lines after it are instructions", () => {
    expect(
      lex("RUN <<$X\nFROM a\n$X\n").instructions.map(
        (instruction) => instruction.keyword
      )
    ).toEqual(["RUN", "FROM", "$X"])
    expect(lex("RUN <<${X:-E}\nFROM a\nE\n").instructions).toHaveLength(1)
  })

  test("a heredoc line whose words zekno cannot read as BuildKit does is a stop of its own, never guessed", () => {
    for (const text of [
      "RUN <<${X#a}E\nFROM a\nE\n",
      "RUN ${X/a/b} <<E\nE\n",
      "RUN ${X%%a} <<E\nE\n",
    ])
      expect(stopOf(() => lex(text))).toEqual({
        id: "dockerfile_heredoc",
        file: "Dockerfile",
        at: 1,
      })
  })

  test("a heredoc with no end runs to the end of the file", () => {
    const read = lex("RUN <<E\nFROM a\nFROM b\n")
    expect(read.instructions).toHaveLength(1)
    expect(read.instructions[0]).toMatchObject({ end: 3, heredocs: [] })
  })
})

describe("the bounds", () => {
  test(`at most ${DOCKERFILE_BYTES} bytes, else a stop of its own`, () => {
    const line = `# ${"x".repeat(1021)}\n`
    expect(
      lex(line.repeat(DOCKERFILE_BYTES / line.length)).instructions
    ).toEqual([])
    expect(
      stopOf(() => lex(`${line.repeat(DOCKERFILE_BYTES / line.length)}#`))
    ).toEqual({
      id: "dockerfile_size",
      why: "bytes",
      file: "Dockerfile",
    })
  })

  test(`at most ${DOCKERFILE_LINES} lines, else a stop of its own; a last line with no end counts`, () => {
    expect(lex("\n".repeat(DOCKERFILE_LINES)).instructions).toEqual([])
    expect(
      lex(`${"\n".repeat(DOCKERFILE_LINES - 1)}FROM scratch`).instructions
    ).toHaveLength(1)
    expect(stopOf(() => lex("\n".repeat(DOCKERFILE_LINES + 1)))).toEqual({
      id: "dockerfile_size",
      why: "lines",
      file: "Dockerfile",
    })
    expect(
      stopOf(() => lex(`${"\n".repeat(DOCKERFILE_LINES)}x`))
    ).toMatchObject({ why: "lines" })
  })
})
