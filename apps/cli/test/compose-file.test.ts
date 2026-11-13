import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir } from "../../runner/test/helpers"
import { expectedValues, expectedValuesIn, interpolated, MAX_NODES } from "../src/compose-file"

describe("environment", () => {
  test("as a list: a name with no `=` is expected; `NAME=value` and `NAME=` are not", () => {
    const compose = "services:\n  web:\n    image: caddy:2\n    environment:\n      - DATABASE_URL\n      - GREETING=hello\n      - EMPTY=\n      - SESSION_KEY\n"
    expect(expectedValues(compose)).toEqual(["DATABASE_URL", "SESSION_KEY"])
  })

  test("as a map: a name with no value is expected, also `~` and `null`; a value, an empty string or a number is not", () => {
    const compose =
      "services:\n  web:\n    environment:\n      DATABASE_URL:\n      GREETING: hello\n      EMPTY: ''\n      PORT: 8080\n      TILDE: ~\n      NONE: null\n"
    expect(expectedValues(compose)).toEqual(["DATABASE_URL", "TILDE", "NONE"])
  })

  test("every service is read, and a name two services expect is listed once", () => {
    const compose = "services:\n  web:\n    environment: [A, B]\n  worker:\n    environment:\n      B:\n      C:\n"
    expect(expectedValues(compose)).toEqual(["A", "B", "C"])
  })

  test("anchors and merge keys are followed as Compose does", () => {
    const compose = "x-env: &env\n  SHARED:\n  SET: 1\nservices:\n  web:\n    environment: *env\n  api:\n    environment:\n      <<: *env\n      OWN:\n"
    expect(expectedValues(compose)).toEqual(["SHARED", "OWN"])
  })

  test("env_file is not read, and an entry that is not a name is skipped", () => {
    const compose = "services:\n  web:\n    env_file: .env\n    environment:\n      - 1BAD\n      - with space\n      - 42\n      - ok_name\n"
    expect(expectedValues(compose)).toEqual(["ok_name"])
  })
})

describe("interpolation", () => {
  test("`${NAME}` and `$NAME` are expected", () => {
    expect(interpolated("postgres://${DB_USER}:$DB_PASS@db/app")).toEqual(["DB_USER", "DB_PASS"])
  })

  test("a default or an alternative means it is not expected; `?` means it is required", () => {
    expect(interpolated("${A:-x} ${B-x} ${C:+x} ${D+x} ${E:?say it} ${F?say it} ${G:-}")).toEqual(["E", "F"])
  })

  test("`$$` is a dollar sign, not a variable", () => {
    expect(interpolated("echo $$HOME and $${NOT_ONE} but $REAL")).toEqual(["REAL"])
  })

  test("names inside a default are not read: they are used only when the outer name is not set", () => {
    expect(interpolated("${PRIMARY:-${FALLBACK}} then ${AFTER}")).toEqual(["AFTER"])
  })

  test("forms that are not variables are skipped; an unclosed `${` ends the reading", () => {
    expect(interpolated("$1 $ alone ${} ${1A} ${-x} $-")).toEqual([])
    expect(interpolated("$OK ${NEVER_CLOSED and $LATER")).toEqual(["OK"])
  })

  test("in a whole file: values anywhere, list entries included, but not keys", () => {
    const compose = [
      "x-image: &image example/web:${TAG}",
      "services:",
      "  web:",
      "    image: *image",
      "    command: [\"sh\", \"-c\", \"echo $$PATH $GREETING\"]",
      "    environment:",
      "      - URL=https://${DOMAIN:?set the domain}/",
      "      - PLAIN=${WITH_DEFAULT:-x}",
      "    labels:",
      "      ${NOT_READ}: value",
      "",
    ].join("\n")
    expect(expectedValues(compose)).toEqual(["TAG", "GREETING", "DOMAIN"])
  })
})

describe("what is left out", () => {
  test("reserved names, which the runner never takes from a secret", () => {
    const compose = "services:\n  web:\n    environment:\n      - PATH\n      - DOCKER_HOST\n      - COMPOSE_PROJECT_NAME\n      - HTTP_PROXY\n      - MINE\n    command: echo $HOME ${LD_PRELOAD}\n"
    expect(expectedValues(compose)).toEqual(["MINE"])
  })

  test("names longer than a secret name may be", () => {
    const long = `A${"B".repeat(LIMITS.secretNameLength)}`
    expect(expectedValues(`services:\n  web:\n    environment:\n      - ${long}\n      - SHORT\n`)).toEqual(["SHORT"])
  })

  test("every name shown is one a secret can have: escape sequences and other letters never get through", () => {
    const listed = 'services:\n  web:\n    environment:\n      - "A\\u001b[2J"\n      - "B\\u202e"\n      - GOOD\n    command: "$\\u00e9t\\u00e9 ${C\\u001b]52;c;aGk=\\u0007}"\n'
    expect(expectedValues(listed)).toEqual(["GOOD"])
    const mapped = 'services:\n  web:\n    environment:\n      "D\\u001b[31m":\n      "\u00c9":\n      FINE:\n'
    expect(expectedValues(mapped)).toEqual(["FINE"])
  })
})

describe("files it cannot read or understand yield no names, never an error", () => {
  test("not YAML, not a mapping, several documents, empty", () => {
    for (const compose of ["services: [", "- just\n- a list\n", "services: {}\n---\nservices: {}\n", "", "42", "services: 3"]) {
      expect(expectedValues(compose)).toEqual([])
    }
  })

  test("an alias bomb Bun refuses, and one it allows that would expand past the walk's bound", () => {
    const level = (name: string, of: string) => `${name}: &${name} [${Array(10).fill(`*${of}`).join(",")}]\n`
    let bomb = 'a: &a ["$X","$X","$X","$X","$X","$X","$X","$X","$X","$X"]\n'
    const names = "bcdefghi"
    for (let index = 0; index < names.length; index++) bomb += level(names[index]!, index === 0 ? "a" : names[index - 1]!)
    expect(expectedValues(`${bomb}services:\n  web:\n    environment: *i\n`)).toEqual([])

    // Six levels parse (a million strings once expanded); the walk stops at its bound well before that.
    const allowed = 'a: &a ["$X","$X","$X","$X","$X","$X","$X","$X","$X","$X"]\n' + [..."bcdef"].map((name, index) => level(name, "abcdef"[index]!)).join("")
    expect(MAX_NODES).toBeLessThan(1_000_000)
    const started = performance.now()
    expect(expectedValues(`${allowed}services:\n  web:\n    environment:\n      - $Y\n    x: *f\n`)).toEqual([])
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("a long string repeated by aliases is not read over and over", () => {
    const compose = `s: &s "${"x".repeat(100_000)}$X"\nservices:\n  web:\n    command: [${Array(2000).fill("*s").join(",")}]\n`
    const started = performance.now()
    expect(expectedValues(compose)).toEqual([])
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("a structure that contains itself, and nesting deeper than any Compose file", () => {
    expect(expectedValues("a: &a [*a, $X]\nservices:\n  web:\n    environment: [B]\n")).toEqual([])
    expect(expectedValues(`services:\n  web:\n    x: ${"[".repeat(100)}"$X"${"]".repeat(100)}\n`)).toEqual([])
    expect(expectedValues(`a: ${"[".repeat(20_000)}${"]".repeat(20_000)}\n`)).toEqual([])
  })

  test("text larger than a Compose file may be", () => {
    expect(expectedValues(`services:\n  web:\n    environment: [A]\n#${"x".repeat(LIMITS.composeBytes)}\n`)).toEqual([])
  })

  test("from a path: missing, a folder, a named pipe, too large, not UTF-8, or a link", () => {
    const dir = tempDir("compose")
    expect(expectedValuesIn(join(dir, "missing.yaml"))).toEqual([])
    mkdirSync(join(dir, "folder"))
    expect(expectedValuesIn(join(dir, "folder"))).toEqual([])
    Bun.spawnSync(["mkfifo", join(dir, "pipe")])
    expect(expectedValuesIn(join(dir, "pipe"))).toEqual([])
    writeFileSync(join(dir, "big.yaml"), `services:\n  web:\n    environment: [A]\n#${"x".repeat(LIMITS.composeBytes)}\n`)
    expect(expectedValuesIn(join(dir, "big.yaml"))).toEqual([])
    writeFileSync(join(dir, "latin1.yaml"), Buffer.from("services:\n  web:\n    environment: [A]\n# caf\xe9\n", "latin1"))
    expect(expectedValuesIn(join(dir, "latin1.yaml"))).toEqual([])
    writeFileSync(join(dir, "compose.yaml"), "services:\n  web:\n    environment: [A]\n")
    expect(expectedValuesIn(join(dir, "compose.yaml"))).toEqual(["A"])
    symlinkSync(join(dir, "compose.yaml"), join(dir, "link.yaml"))
    expect(expectedValuesIn(join(dir, "link.yaml"))).toEqual(["A"])
  })
})
