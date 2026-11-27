/**
 * Expansion as BuildKit's shell lexer expands, in the scopes a Dockerfile's
 * variables live in (specs/016-build-from-source, contracts/cli.md CL3,
 * "Expansion"; FR-036a, FR-042; tasks T117): each form CL3 lists, and each
 * other form refused, never guessed; `FROM` resolved for `linux/amd64` and
 * `linux/arm64` with the global `ARG`s, the plain variables given to the
 * build and the platform names; a stage's variables, a stage built from
 * another inheriting its `ENV`, and a variable a base image might define
 * unresolvable.
 */
import { describe, expect, test } from "bun:test"

import {
  expandWord,
  globalScope,
  PLATFORMS,
  resolveFrom,
  stageScope,
} from "../../src/dockerfile/expand"
import { readDockerfile } from "../../src/dockerfile/instructions"
import { shellProcess, type Env, type Lookup } from "../../src/dockerfile/shell"

/** V is set, E is set and empty, U is not set, K is one zekno cannot know. */
const ENV: Env = (name): Lookup =>
  name === "V"
    ? { kind: "set", value: "v" }
    : name === "E"
      ? { kind: "set", value: "" }
      : name === "W"
        ? { kind: "set", value: "x y" }
        : name === "K"
          ? { kind: "unknown" }
          : { kind: "unset" }

const expand = (word: string, escape: "\\" | "`" = "\\") =>
  expandWord(word, ENV, escape)
const value = (word: string, escape: "\\" | "`" = "\\") => {
  const found = expand(word, escape)
  if (!found.ok) throw new Error(`${word}: ${found.why}`)
  return found.value
}

describe("each form CL3 lists", () => {
  test("$V and ${V}: a value, or nothing when not set", () => {
    expect([
      value("$V"),
      value("${V}"),
      value("$U"),
      value("${U}"),
      value("a$V-b"),
    ]).toEqual(["v", "v", "", "", "av-b"])
  })

  test("${V:-w} and ${V-w}: the word when not set, and with : when empty too", () => {
    expect([value("${V:-w}"), value("${E:-w}"), value("${U:-w}")]).toEqual([
      "v",
      "w",
      "w",
    ])
    expect([value("${V-w}"), value("${E-w}"), value("${U-w}")]).toEqual([
      "v",
      "",
      "w",
    ])
  })

  test("${V:+w} and ${V+w}: the word when set, and with : only when not empty", () => {
    expect([value("${V:+w}"), value("${E:+w}"), value("${U:+w}")]).toEqual([
      "w",
      "",
      "",
    ])
    expect([value("${V+w}"), value("${E+w}"), value("${U+w}")]).toEqual([
      "w",
      "w",
      "",
    ])
  })

  test("words hold forms of their own; a word not used is never looked at for its value", () => {
    expect(value("${U:-${V}-x}")).toBe("v-x")
    expect(value("${V:-$K}")).toBe("v")
    expect(value("${U:+$K}")).toBe("")
  })

  test("quotes: double quotes expand, single quotes do not, both are taken off", () => {
    expect([
      value('"a $V"'),
      value("'a $V'"),
      value(`"it's"`),
      value("'say \"hi\"'"),
    ]).toEqual(["a v", "a $V", "it's", 'say "hi"'])
  })

  test('the escape character: the next character as itself; in double quotes only before ", $ and itself', () => {
    expect([
      value("\\$V"),
      value("a\\ b"),
      value('"\\$V"'),
      value('"a\\b"'),
      value('"a\\\\b"'),
    ]).toEqual(["$V", "a b", "$V", "a\\b", "a\\b"])
  })

  test("with the backtick escape, a backslash is itself", () => {
    expect([
      value("`$V", "`"),
      value("a\\b", "`"),
      value("C:\\$V", "`"),
    ]).toEqual(["$V", "a\\b", "C:\\v"])
  })

  test("a $ that starts no name is itself", () => {
    expect([value("$"), value("a$"), value("$/x"), value("${V}$")]).toEqual([
      "$",
      "a$",
      "$/x",
      "v$",
    ])
  })

  test("words split at spaces outside quotes, a value's spaces splitting it, as BuildKit's ProcessWords", () => {
    const found = shellProcess('a  "b c" d\\ e $W', ENV, {
      escape: "\\",
      forms: "listed",
    })
    expect(found).toEqual({
      ok: true,
      result: "a  b c d e x y",
      words: ["a", "b c", "d e", "x", "y"],
    })
  })
})

describe("what is refused, never guessed", () => {
  test("a variable zekno cannot know, named so it can be given a default", () => {
    expect(expand("$K")).toEqual({ ok: false, why: "unknown", variable: "K" })
    expect(expand("${K:-x}")).toEqual({
      ok: false,
      why: "unknown",
      variable: "K",
    })
    expect(expand("${U:-$K}")).toEqual({
      ok: false,
      why: "unknown",
      variable: "K",
    })
  })

  test("any other form: ?, #, %, /, a number or a special parameter", () => {
    for (const word of [
      "${V?no}",
      "${V:?no}",
      "${V#v}",
      "${V##v}",
      "${V%v}",
      "${V%%v}",
      "${V/v/w}",
      "${V//v/w}",
      "$1",
      "${1}",
      "${1:-x}",
      "$@",
      "$*",
      "$#",
      "$?",
      "$$",
      "$!",
      "$-",
      "$0",
    ])
      expect({ word, found: expand(word) }).toEqual({
        word,
        found: { ok: false, why: "form", variable: null },
      })
  })

  test("a text BuildKit refuses", () => {
    for (const word of [
      "${",
      "${}",
      "${:x}",
      "${{x}",
      "${V",
      "${V!}",
      "${V:#x}",
      '"open',
      "'open",
      "${V:-open",
    ])
      expect({ word, found: expand(word) }).toEqual({
        word,
        found: { ok: false, why: "error" },
      })
  })
})

const reading = (text: string) =>
  readDockerfile(new TextEncoder().encode(text), "Dockerfile")
const NONE = new Map<string, string>()

describe("FROM, resolved for linux/amd64 and linux/arm64", () => {
  const bases = (
    text: string,
    given: ReadonlyMap<string, string> = NONE,
    stage = 0
  ) =>
    PLATFORMS.map(
      (platform) => resolveFrom(reading(text), stage, platform, given).base
    )

  test("FROM ${BASE} from an ARG default, and from a plain variable given to the build", () => {
    const text = "ARG BASE=node:20\nFROM ${BASE}\n"
    expect(bases(text)).toEqual([
      { ok: true, value: "node:20" },
      { ok: true, value: "node:20" },
    ])
    expect(bases(text, new Map([["BASE", "node:22"]]))).toEqual([
      { ok: true, value: "node:22" },
      { ok: true, value: "node:22" },
    ])
    // A plain variable no ARG declares is not given to the build.
    expect(
      bases("FROM ${BASE:-alpine}\n", new Map([["BASE", "node:22"]]))[0]
    ).toEqual({ ok: true, value: "alpine" })
  })

  test("the platform names, in the name and in --platform", () => {
    const text =
      "FROM --platform=$BUILDPLATFORM node:20-${TARGETARCH}${TARGETVARIANT}\n"
    expect(bases(text)).toEqual([
      { ok: true, value: "node:20-amd64" },
      { ok: true, value: "node:20-arm64" },
    ])
    expect(
      PLATFORMS.map(
        (platform) => resolveFrom(reading(text), 0, platform, NONE).platform
      )
    ).toEqual([
      { ok: true, value: "linux/amd64" },
      { ok: true, value: "linux/arm64" },
    ])
    expect(bases("FROM ${TARGETOS}/${BUILDOS}:${TARGETPLATFORM}\n")[1]).toEqual(
      { ok: true, value: "linux/linux:linux/arm64" }
    )
  })

  test("global ARGs in order, each seeing those before it; a global ARG with no value is set and empty", () => {
    expect(bases("ARG A=x B=${A}-y\nFROM ${B}\n")[0]).toEqual({
      ok: true,
      value: "x-y",
    })
    expect(bases("ARG A\nFROM ${A:-alpine}\n")[0]).toEqual({
      ok: true,
      value: "alpine",
    })
    expect(bases("ARG A\nFROM ${A-alpine}\n")[0]).toEqual({
      ok: false,
      why: "error",
    })
    expect(bases("FROM alpine${NOT_DECLARED}\n")[0]).toEqual({
      ok: true,
      value: "alpine",
    })
  })

  test("a name BuildKit gives that zekno does not know, or a platform name declared again with no value, is unknown", () => {
    expect(bases("FROM ${TARGETSTAGE}\n")[0]).toEqual({
      ok: false,
      why: "unknown",
      variable: "TARGETSTAGE",
    })
    expect(bases("ARG TARGETARCH\nFROM a-${TARGETARCH}\n")[0]).toEqual({
      ok: false,
      why: "unknown",
      variable: "TARGETARCH",
    })
  })

  test("a declared ARG the server's side may give a value zekno does not know is unknown, default or not: CO6's names, BUILDKIT_ names", () => {
    for (const text of [
      "ARG SOURCE_DATE_EPOCH=1\nFROM a${SOURCE_DATE_EPOCH}\n",
      "ARG HTTP_PROXY\nFROM a${HTTP_PROXY}\n",
      "ARG BUILDKIT_SYNTAX=x\nFROM a${BUILDKIT_SYNTAX}\n",
    ])
      expect(bases(text)[0]).toMatchObject({ ok: false, why: "unknown" })
    // A name of the user's own that only starts like BuildKit's is read as any other.
    expect(bases("ARG BUILD_ENV\nFROM a${BUILD_ENV:-b}\n")[0]).toEqual({
      ok: true,
      value: "ab",
    })
    expect(bases("FROM alpine${BUILD_ENV}${BUILDKIT_X}\n")[0]).toEqual({
      ok: true,
      value: "alpine",
    })
  })

  test("a blank name is refused, as BuildKit refuses it", () => {
    expect(bases("ARG A=\nFROM ${A}\n")[0]).toEqual({ ok: false, why: "error" })
  })

  test("a stage's ARG is not in FROM's scope: only the global ones are", () => {
    expect(
      bases("FROM scratch\nARG IMG=x\nFROM ${IMG:-y}\n", NONE, 1)[0]
    ).toEqual({ ok: true, value: "y" })
  })
})

describe("a stage's variables", () => {
  /** What `name` is just before the command at `before` of stage `stage`. */
  const lookup = (
    text: string,
    stage: number,
    before: number,
    name: string,
    given = NONE
  ) => stageScope(reading(text), stage, before, "linux/amd64", given)(name)

  test("a stage built from another stage inherits its ENV, by its name in any case", () => {
    const text =
      "FROM scratch AS Base\nENV IMG=one\nFROM base AS next\nCOPY --from=${IMG} /a /b\n"
    expect(lookup(text, 1, 0, "IMG")).toEqual({ kind: "set", value: "one" })
    expect(lookup(text, 0, 0, "IMG")).toEqual({ kind: "unset" })
  })

  test("a variable a base image might define is unknown: an image's own ENV wins over an ARG, so only an ENV of the file is known", () => {
    expect(
      lookup("FROM node AS a\nARG S=x\nCOPY --from=$S /a /b\n", 0, 1, "S")
    ).toEqual({ kind: "unknown" })
    expect(
      lookup("FROM node AS a\nENV S=x\nCOPY --from=$S /a /b\n", 0, 1, "S")
    ).toEqual({ kind: "set", value: "x" })
    expect(lookup("FROM node AS a\nFROM a\nRUN x\n", 1, 0, "ANY")).toEqual({
      kind: "unknown",
    })
    // From scratch, nothing is set but BuildKit's default PATH.
    expect(lookup("FROM scratch\nRUN x\n", 0, 0, "ANY")).toEqual({
      kind: "unset",
    })
    expect(lookup("FROM scratch\nRUN x\n", 0, 0, "PATH")).toEqual({
      kind: "unknown",
    })
  })

  test("ARG and ENV in a stage: ENV wins over an ARG of the same name, before or after it", () => {
    const text = "FROM scratch\nARG X=1\nENV X=2\nARG X=3\nRUN x\n"
    expect(lookup(text, 0, 1, "X")).toEqual({ kind: "set", value: "1" })
    expect(lookup(text, 0, 3, "X")).toEqual({ kind: "set", value: "2" })
  })

  test("a stage's ARG with no value takes the global ARG's, or the plain variable given; an ARG not declared is not in scope", () => {
    const text = "ARG G=g\nFROM scratch\nARG G\nARG H\nRUN x\n"
    expect(lookup(text, 0, 2, "G")).toEqual({ kind: "set", value: "g" })
    expect(lookup(text, 0, 2, "G", new Map([["G", "given"]]))).toEqual({
      kind: "set",
      value: "given",
    })
    expect(lookup(text, 0, 2, "H")).toEqual({ kind: "unset" })
    expect(lookup("ARG G=g\nFROM scratch\nRUN x\n", 0, 0, "G")).toEqual({
      kind: "unset",
    })
    expect(
      lookup("FROM scratch\nARG TARGETARCH\nRUN x\n", 0, 1, "TARGETARCH")
    ).toEqual({ kind: "set", value: "amd64" })
    expect(
      lookup("FROM scratch\nARG TARGETARCH=x\nRUN x\n", 0, 1, "TARGETARCH")
    ).toEqual({ kind: "unknown" })
    expect(
      lookup("FROM scratch\nARG HTTP_PROXY=x\nRUN x\n", 0, 1, "HTTP_PROXY")
    ).toEqual({ kind: "unknown" })
  })

  test("one ENV line sees the values from before it; the next line sees its own", () => {
    const text = "FROM scratch\nENV A=1 B=$A\nENV C=$A\nRUN x\n"
    expect(lookup(text, 0, 1, "B")).toEqual({ kind: "set", value: "" })
    expect(lookup(text, 0, 2, "C")).toEqual({ kind: "set", value: "1" })
  })

  test("an ENV or ARG whose value cannot be resolved is unknown; one whose name cannot be makes every name unknown", () => {
    expect(lookup("FROM scratch\nENV A=${X#y}\nRUN x\n", 0, 1, "A")).toEqual({
      kind: "unknown",
    })
    expect(lookup("FROM scratch\nENV ${X#y}=1\nRUN x\n", 0, 1, "B")).toEqual({
      kind: "unknown",
    })
  })

  test("ONBUILD's ENV and ARG are not run in the stage that holds them", () => {
    expect(lookup("FROM scratch\nONBUILD ENV A=1\nRUN x\n", 0, 1, "A")).toEqual(
      { kind: "unset" }
    )
  })

  test("the global scope holds the platform names and the global ARGs", () => {
    const scope = globalScope(
      reading("ARG A=1\nFROM scratch\n"),
      "linux/arm64",
      NONE
    )
    expect([
      scope("A"),
      scope("TARGETARCH"),
      scope("BUILDARCH"),
      scope("NOPE"),
    ]).toEqual([
      { kind: "set", value: "1" },
      { kind: "set", value: "arm64" },
      { kind: "set", value: "arm64" },
      { kind: "unset" },
    ])
  })
})
