import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"

import { composeServices } from "../../src/shared/views"
import {
  aliasesTooMany,
  COMPOSE_READ_BYTES,
  expectedValues,
  inSettingsForm,
  interpolated,
  MAX_ALIASES,
  MAX_NAMES,
  MAX_NODES,
  tooManyAliases,
} from "../../src/project/compose-file"
import { composeText } from "../../src/settings/compose"
import { checkSettings, isSettings } from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import { DESIGN_SETTINGS, GOOD_FILES } from "../support/settings-files"

describe("environment", () => {
  test("as a list: a name with no `=` is expected; `NAME=value` and `NAME=` are not", () => {
    const compose =
      "services:\n  web:\n    image: caddy:2\n    environment:\n      - DATABASE_URL\n      - GREETING=hello\n      - EMPTY=\n      - SESSION_KEY\n"
    expect(expectedValues(compose)).toEqual(["DATABASE_URL", "SESSION_KEY"])
  })

  test("as a map: a name with no value is expected, also `~` and `null`; a value, an empty string or a number is not", () => {
    const compose =
      "services:\n  web:\n    environment:\n      DATABASE_URL:\n      GREETING: hello\n      EMPTY: ''\n      PORT: 8080\n      TILDE: ~\n      NONE: null\n"
    expect(expectedValues(compose)).toEqual(["DATABASE_URL", "TILDE", "NONE"])
  })

  test("every service is read, and a name two services expect is listed once", () => {
    const compose =
      "services:\n  web:\n    environment: [A, B]\n  worker:\n    environment:\n      B:\n      C:\n"
    expect(expectedValues(compose)).toEqual(["A", "B", "C"])
  })

  test("anchors and merge keys are followed as Compose does", () => {
    const compose =
      "x-env: &env\n  SHARED:\n  SET: 1\nservices:\n  web:\n    environment: *env\n  api:\n    environment:\n      <<: *env\n      OWN:\n"
    expect(expectedValues(compose)).toEqual(["SHARED", "OWN"])
  })

  test("env_file is not read, and an entry that is not a name is skipped", () => {
    const compose =
      "services:\n  web:\n    env_file: .env\n    environment:\n      - 1BAD\n      - with space\n      - 42\n      - ok_name\n"
    expect(expectedValues(compose)).toEqual(["ok_name"])
  })
})

describe("interpolation", () => {
  test("`${NAME}` and `$NAME` are expected", () => {
    expect(interpolated("postgres://${DB_USER}:$DB_PASS@db/app")).toEqual([
      "DB_USER",
      "DB_PASS",
    ])
  })

  test("a default or an alternative means it is not expected; `?` means it is required", () => {
    expect(
      interpolated(
        "${A:-x} ${B-x} ${C:+x} ${D+x} ${E:?say it} ${F?say it} ${G:-}"
      )
    ).toEqual(["E", "F"])
  })

  test("`$$` is a dollar sign, not a variable", () => {
    expect(interpolated("echo $$HOME and $${NOT_ONE} but $REAL")).toEqual([
      "REAL",
    ])
  })

  test("names inside a default are not read: they are used only when the outer name is not set", () => {
    expect(interpolated("${PRIMARY:-${FALLBACK}} then ${AFTER}")).toEqual([
      "AFTER",
    ])
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
      '    command: ["sh", "-c", "echo $$PATH $GREETING"]',
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
    const compose =
      "services:\n  web:\n    environment:\n      - PATH\n      - DOCKER_HOST\n      - COMPOSE_PROJECT_NAME\n      - HTTP_PROXY\n      - MINE\n    command: echo $HOME ${LD_PRELOAD}\n"
    expect(expectedValues(compose)).toEqual(["MINE"])
  })

  test("names longer than a secret name may be", () => {
    const long = `A${"B".repeat(LIMITS.secretNameLength)}`
    expect(
      expectedValues(
        `services:\n  web:\n    environment:\n      - ${long}\n      - SHORT\n`
      )
    ).toEqual(["SHORT"])
  })

  test("every name shown is one a secret can have: escape sequences and other letters never get through", () => {
    const listed =
      'services:\n  web:\n    environment:\n      - "A\\u001b[2J"\n      - "B\\u202e"\n      - GOOD\n    command: "$\\u00e9t\\u00e9 ${C\\u001b]52;c;aGk=\\u0007}"\n'
    expect(expectedValues(listed)).toEqual(["GOOD"])
    const mapped =
      'services:\n  web:\n    environment:\n      "D\\u001b[31m":\n      "\u00c9":\n      FINE:\n'
    expect(expectedValues(mapped)).toEqual(["FINE"])
  })
})

describe("files it cannot read or understand yield no names, never an error", () => {
  test("not YAML, not a mapping, several documents, empty", () => {
    for (const compose of [
      "services: [",
      "- just\n- a list\n",
      "services: {}\n---\nservices: {}\n",
      "",
      "42",
      "services: 3",
    ]) {
      expect(expectedValues(compose)).toEqual([])
    }
  })

  test("an alias bomb Bun refuses, and one it allows that would expand past the walk's bound", () => {
    const level = (name: string, of: string) =>
      `${name}: &${name} [${Array(10).fill(`*${of}`).join(",")}]\n`
    let bomb = 'a: &a ["$X","$X","$X","$X","$X","$X","$X","$X","$X","$X"]\n'
    const names = "bcdefghi"
    for (let index = 0; index < names.length; index++)
      bomb += level(names[index]!, index === 0 ? "a" : names[index - 1]!)
    expect(
      expectedValues(`${bomb}services:\n  web:\n    environment: *i\n`)
    ).toEqual([])

    // Six levels parse (a million strings once expanded); the walk stops at its bound well before that.
    const allowed =
      'a: &a ["$X","$X","$X","$X","$X","$X","$X","$X","$X","$X"]\n' +
      [..."bcdef"].map((name, index) => level(name, "abcdef"[index]!)).join("")
    expect(MAX_NODES).toBeLessThan(1_000_000)
    const started = performance.now()
    expect(
      expectedValues(
        `${allowed}services:\n  web:\n    environment:\n      - $Y\n    x: *f\n`
      )
    ).toEqual([])
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("a long string repeated by aliases is not read over and over", () => {
    const compose = `s: &s "${"x".repeat(100_000)}$X"\nservices:\n  web:\n    command: [${Array(2000).fill("*s").join(",")}]\n`
    const started = performance.now()
    expect(expectedValues(compose)).toEqual([])
    expect(performance.now() - started).toBeLessThan(2000)
  })

  test("a structure that contains itself, and nesting deeper than any Compose file", () => {
    expect(
      expectedValues(
        "a: &a [*a, $X]\nservices:\n  web:\n    environment: [B]\n"
      )
    ).toEqual([])
    expect(
      expectedValues(
        `services:\n  web:\n    x: ${"[".repeat(100)}"$X"${"]".repeat(100)}\n`
      )
    ).toEqual([])
    expect(
      expectedValues(`a: ${"[".repeat(20_000)}${"]".repeat(20_000)}\n`)
    ).toEqual([])
  })

  test("text larger than a Compose file may be", () => {
    expect(
      expectedValues(
        `services:\n  web:\n    environment: [A]\n#${"x".repeat(LIMITS.composeBytes)}\n`
      )
    ).toEqual([])
  })
})

describe("aliases are counted before anything is parsed", () => {
  /** The reviewer's worst file: one string of about 170 KB behind an anchor, and 30,000 aliases to it, within the 256 KiB limit. */
  function worst(): string {
    const n = 30_000
    const head = "services:\n  x:\n    image: y\n    environment:\n      - $A\n"
    const big = "a".repeat(COMPOSE_READ_BYTES - head.length - 3 * n - 40)
    return `${head}s: &s "${big}"\nl: [${Array.from({ length: n }, () => "*s").join(",")}]\n`
  }

  test("up to 200 aliases are parsed as before; past that the file gives no names and no services", () => {
    const uses = (count: number) =>
      `x-env: &env\n  SHARED:\nservices:\n  web:\n    image: caddy:2\n    environment: *env\nlist: [${Array(
        count - 1
      )
        .fill("*env")
        .join(", ")}]\n`
    expect(tooManyAliases(uses(MAX_ALIASES))).toBe(false)
    expect(expectedValues(uses(MAX_ALIASES))).toEqual(["SHARED"])
    expect(composeServices(uses(MAX_ALIASES))).toEqual(["web (caddy:2)"])
    expect(tooManyAliases(uses(MAX_ALIASES + 1))).toBe(true)
    expect(expectedValues(uses(MAX_ALIASES + 1))).toEqual([])
    expect(composeServices(uses(MAX_ALIASES + 1))).toEqual([])
  })

  test("the count errs high, never low: every form Bun reads as an alias counts, and so does a `*name` in quotes", () => {
    for (const alias of [
      "*x",
      "[*x,*x]",
      '{"b":*x}',
      "\t*x",
      "*\u00a0",
      "*é",
      "'*x'",
      '"*x"',
      "# *x",
    ]) {
      expect({
        alias,
        over: tooManyAliases(
          Array(MAX_ALIASES + 1)
            .fill(alias)
            .join("\n")
        ),
      }).toEqual({ alias, over: true })
    }
    // A `*` that cannot start an alias does not count.
    for (const text of ["* x", "*,", "*]", "*}", "*\n"])
      expect(tooManyAliases(text.repeat(MAX_ALIASES + 1))).toBe(false)
  })

  test("the reviewer's worst file costs neither time nor memory: no names, no services", () => {
    const text = worst()
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(COMPOSE_READ_BYTES)
    Bun.gc(true)
    const before = process.memoryUsage().rss
    const started = performance.now()
    expect(expectedValues(text)).toEqual([])
    expect(composeServices(text)).toEqual([])
    const took = performance.now() - started
    const grew = process.memoryUsage().rss - before
    // Parsed, it took about 5 GB.
    expect(grew).toBeLessThan(64 * 1024 * 1024)
    expect(took).toBeLessThan(500)
  })
})

describe("at most 64 names", () => {
  test("the first 64, in the order the list shows them: what environment lists first, then names used in values", () => {
    const listed = Array.from(
      { length: 80 },
      (_, n) => `      - LISTED_${n}`
    ).join("\n")
    const used = Array.from({ length: 20 }, (_, n) => `\${USED_${n}}`).join(" ")
    const names = expectedValues(
      `services:\n  web:\n    command: "${used}"\n    environment:\n${listed}\n`
    )
    expect(MAX_NAMES).toBe(64)
    expect(names).toEqual(Array.from({ length: 64 }, (_, n) => `LISTED_${n}`))
    expect(
      expectedValues(
        `services:\n  web:\n    command: "${used}"\n    environment:\n      - FIRST\n`
      )
    ).toEqual(["FIRST", ...Array.from({ length: 20 }, (_, n) => `USED_${n}`)])
  })
})

describe("text in the form zekno writes from settings (specs/010-app-settings, security review S9)", () => {
  /** The review's case: a plain value of 500 asterisks beside a secret never set. */
  const MASKED: Settings = {
    version: 1,
    services: [
      [
        "web",
        {
          image: "ghcr.io/acme/web:1",
          start: 'sh -c "echo \\"*\\" && exec bun run start"',
          secrets: ["JWT_SECRET"],
          plain: [
            ["MASK", "*".repeat(500)],
            ["REQUIRE_AUTH", "1"],
          ],
        },
      ],
    ],
  }

  test("500 asterisks in a value: the guard would count them, the form shows none is an alias, and the secret is still named", () => {
    const text = composeText(MASKED)
    expect(tooManyAliases(text)).toBe(true)
    expect(inSettingsForm(text)).toBe(true)
    expect(aliasesTooMany(text)).toBe(false)
    expect(expectedValues(text)).toEqual(["JWT_SECRET"])
    expect(composeServices(text)).toEqual(["web (ghcr.io/acme/web:1)"])
  })

  test("the guard is unchanged for any other text: a hand-written file with the same asterisks gives no names, as before", () => {
    const handWritten = `services:\n  web:\n    image: ghcr.io/acme/web:1\n    environment:\n      JWT_SECRET: \${JWT_SECRET}\n      MASK: "${"*".repeat(500)}"\n`
    expect(inSettingsForm(handWritten)).toBe(false)
    expect(aliasesTooMany(handWritten)).toBe(true)
    expect(expectedValues(handWritten)).toEqual([])
  })

  test("a line zekno does not write, or an alias put among its lines, is not the form", () => {
    const text = composeText(MASKED)
    for (const changed of [
      text.replace('    image: "ghcr.io/acme/web:1"', "    image: *a"),
      text.replace('["sh", "-c",', '["sh", *b,'),
      text.replace('"REQUIRE_AUTH": "1"', '"REQUIRE_AUTH": &a "1"'),
      text.replace('"REQUIRE_AUTH": "1"', '"REQUIRE_AUTH": !!binary "1"'),
      text.replace('"REQUIRE_AUTH": "1"', '"REQUIRE_AUTH": "1" # *c'),
      text.replace('"REQUIRE_AUTH": "1"', '"REQUIRE_AUTH": "1\\x41"'),
      `${text}x-extra: *d\n`,
      text.slice(0, -1),
      "",
    ])
      expect({ changed, form: inSettingsForm(changed) }).toEqual({
        changed,
        form: false,
      })
    expect(inSettingsForm(composeText(DESIGN_SETTINGS))).toBe(true)
    for (const file of GOOD_FILES) {
      const read = checkSettings(file.text, "zekno.app.json")
      if (!isSettings(read)) throw new Error(file.name)
      expect({
        name: file.name,
        form: inSettingsForm(composeText(read)),
      }).toEqual({
        name: file.name,
        form: true,
      })
    }
  })
})
