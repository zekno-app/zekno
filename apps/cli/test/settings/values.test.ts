/**
 * The rule of each value (specs/010-app-settings, contracts/settings-file.md,
 * "Each value" and "The start command"; tasks T007): what each takes and
 * what it refuses, with the reason a person reads.
 */
import { describe, expect, test } from "bun:test"

import {
  checkCpus,
  checkImage,
  checkMemory,
  checkMountPath,
  checkPlainName,
  checkPlainValue,
  checkPort,
  checkRestart,
  checkSecretName,
  checkServiceName,
  checkVolumeName,
  holdsOnlyAllowed,
  readTyped,
  secretNameProblem,
} from "../../src/settings/values"

const DIGEST = `sha256:${"0123456789abcdef".repeat(4)}`

/** Each of `good` passes `check`, and each of `bad` is refused with `reason`. */
function rule(
  check: (value: string) => string | undefined,
  good: string[],
  bad: string[],
  reason: string
) {
  for (const value of good)
    expect([value, check(value)]).toEqual([value, undefined])
  for (const value of bad)
    expect([value, check(value)]).toEqual([value, reason])
}

describe("the character rule every string is held to (research R1)", () => {
  test("takes text in any script, quotes, symbols and emoji", () => {
    for (const text of [
      "",
      "plain",
      'say "hi"',
      "C:\\temp",
      "$HOME ${X}",
      "café 東京 🚀",
      "a: b # c",
      "\u00a0",
      "\ufdd0",
    ])
      expect([text, holdsOnlyAllowed(text)]).toEqual([text, true])
  })

  test("refuses control characters, line separators, the byte order mark, U+FFFE, U+FFFF and lone surrogates", () => {
    for (const text of [
      "\u0000",
      "\t",
      "\n",
      "\r",
      "\u001b[2J",
      "\u007f",
      "\u0085",
      "\u009b",
      "\u2028",
      "\u2029",
      "\ufeff",
      "\ufffe",
      "\uffff",
      "\ud800",
      "a\udc00",
      "\udc00\ud800",
    ])
      expect([text, holdsOnlyAllowed(text)]).toEqual([text, false])
  })
})

describe("names", () => {
  test("checkServiceName", () => {
    rule(
      checkServiceName,
      [
        "web",
        "a",
        "web-2",
        "a-b-c",
        `a${"b".repeat(62)}`,
        "true",
        "constructor",
      ],
      [
        "",
        "Web",
        "2web",
        "-web",
        "web_1",
        "web.1",
        "a b",
        `a${"b".repeat(63)}`,
        "__proto__",
        "wéb",
      ],
      "Use lowercase letters, digits and hyphens, starting with a letter."
    )
  })

  test("checkSecretName: the pattern and 128 characters, then reserved names refused with their kind", () => {
    rule(
      checkSecretName,
      [
        "DATABASE_URL",
        "_X",
        "a",
        `A${"b".repeat(127)}`,
        "__proto__",
        "constructor",
      ],
      [
        "",
        "1A",
        "A-B",
        "A B",
        `A${"b".repeat(128)}`,
        "PATH",
        "path",
        "HOME",
        "DOCKER_HOST",
        "COMPOSE_FILE",
        "LD_PRELOAD",
        "HTTP_PROXY",
      ],
      "A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself."
    )
    expect(secretNameProblem("1A")).toBe("form")
    expect(secretNameProblem(`A${"b".repeat(128)}`)).toBe("form")
    expect(secretNameProblem("PATH")).toBe("reserved")
    expect(secretNameProblem("DOCKER_HOST")).toBe("reserved")
    expect(secretNameProblem("DATABASE_URL")).toBeUndefined()
  })

  test("checkPlainName: as a secret's, reserved names taken (research R9, item 18)", () => {
    for (const name of [
      "NODE_ENV",
      "PATH",
      "DOCKER_HOST",
      "__proto__",
      `A${"b".repeat(127)}`,
    ])
      expect(checkPlainName(name)).toBeUndefined()
    for (const name of ["", "1A", "A-B", "A.B", `A${"b".repeat(128)}`])
      expect(checkPlainName(name)).toBeDefined()
  })

  test("checkVolumeName", () => {
    for (const name of [
      "data",
      "a",
      "my_data-2",
      `v${"_".repeat(62)}`,
      "constructor",
    ])
      expect(checkVolumeName(name)).toBeUndefined()
    for (const name of [
      "",
      "Data",
      "1data",
      "_data",
      "../etc",
      "a/b",
      "a.b",
      `v${"_".repeat(63)}`,
    ])
      expect(checkVolumeName(name)).toBeDefined()
  })
})

describe("checkImage", () => {
  test("Docker's image references, and nothing else", () => {
    rule(
      checkImage,
      [
        "nginx",
        "nginx:1.27",
        "ghcr.io/acme/web:1.4.2",
        "ghcr.io/acme/demo-web:1.4.2",
        "registry.example.com:5000/team/app:tag",
        "localhost/x",
        "localhost:5000/a/b:tag",
        `ghcr.io/acme/web@${DIGEST}`,
        `ghcr.io/acme/web:1.4.2@${DIGEST}`,
        "a__b/c.d/e---f",
        "Registry.Example.com/x",
        "ghcr.io",
        "x:_tag",
        `a/${"b".repeat(253)}`,
        `x:${"t".repeat(128)}`,
      ],
      [
        "",
        "Upper/x",
        "acme/Web",
        "-x",
        "x-",
        "a//b",
        "a/",
        "/a",
        "x:",
        "x:-tag",
        `x:${"t".repeat(129)}`,
        "x@sha256:abc",
        `x@sha256:${"A".repeat(64)}`,
        `x@md5:${"0".repeat(64)}`,
        "host_name.io/x",
        "-host.io/x",
        "a b",
        "a\nb",
        "x:1.0 ",
        `a/${"b".repeat(254)}`,
        "ghcr.io/acme/web:1.4.2;rm -rf /",
        "$(id)",
        '"x"',
        "x\u0000",
        "café",
      ],
      "Use one such as ghcr.io/acme/web:1.4.2."
    )
  })
})

describe("deploy and networking values", () => {
  test("checkRestart", () => {
    rule(
      checkRestart,
      ["no", "on-failure", "always"],
      ["", "No", "unless-stopped", "on failure", "always "],
      "Use no, on-failure or always."
    )
  })

  test("checkMemory: at least 6m, at most five digits, m or g", () => {
    rule(
      checkMemory,
      ["6m", "512m", "1g", "99999g", "99999m"],
      [
        "",
        "5m",
        "0m",
        "06m",
        "100000m",
        "1G",
        "1M",
        "1gb",
        "1.5g",
        "1",
        "-1g",
        " 1g",
      ],
      "Use a size such as 512m or 1g."
    )
  })

  test("checkCpus reads the number's text: more than 0, at most 1024, at most two decimals", () => {
    rule(
      checkCpus,
      ["0.01", "0.5", "1", "1.5", "1.50", "2.25", "1024", "1024.00"],
      [
        "0",
        "0.0",
        "0.00",
        "0.001",
        "1.234",
        "1024.01",
        "1025",
        "1e2",
        "-1",
        "01",
        "1.",
        ".5",
        "Infinity",
        "NaN",
      ],
      "Use a number of processors, such as 0.5 or 2."
    )
  })

  test("checkPort reads the number's text: an integer from 1 to 65535", () => {
    rule(
      checkPort,
      ["1", "80", "3000", "65535"],
      ["0", "65536", "99999", "3000.5", "3e3", "-1", "080", "", "1.0"],
      "Use a port from 1 to 65535."
    )
  })
})

describe("variables and volumes", () => {
  test("checkPlainValue: one line, no control character, at most 4096 characters; empty is a value", () => {
    rule(
      checkPlainValue,
      [
        "",
        "production",
        'say "hi" $HOME ${X} # ! & *',
        "é".repeat(4096),
        "🚀".repeat(4096),
      ],
      [
        "\u0000",
        "a\tb",
        "a\nb",
        "\u2028",
        "\u2029",
        "\ufeff",
        "\ufffe",
        "\uffff",
        "\ud800",
        "x\udfff",
        "a".repeat(4097),
        "\u0085",
      ],
      "Use one line with no control character, at most 4096 characters."
    )
  })

  test("checkMountPath: absolute, in the container, no . or .. part", () => {
    rule(
      checkMountPath,
      ["/data", "/var/lib/app_1.2@x+y-z", "/a/.b/..c", `/${"p".repeat(254)}`],
      [
        "/",
        "/a/../b",
        "/a/./b",
        "//a",
        "a",
        "/a:b",
        "/a b",
        "/a/",
        "/srv/data:/data",
        "/..",
        "/.",
        `/${"p".repeat(255)}`,
        "/a\nb",
        "/é",
        "/a~",
        "/$HOME",
      ],
      "Use an absolute path in the container, such as /data."
    )
  })
})

describe("readTyped: a value as typed for set or the screen", () => {
  test("each setting as it holds it", () => {
    expect(readTyped({ service: "web", key: "cpus" }, "0.5")).toEqual({
      value: "0.5",
    })
    expect(readTyped({ service: "web", key: "port" }, "8080")).toEqual({
      value: 8080,
    })
    expect(readTyped({ service: "web", key: "publish" }, "80")).toEqual({
      value: 80,
    })
    expect(readTyped({ service: "web", key: "secrets" }, "A, B,C")).toEqual({
      value: ["A", "B", "C"],
    })
    expect(
      readTyped({ service: "web", key: "plain", name: "X" }, "  as it is ")
    ).toEqual({ value: "  as it is " })
    expect(readTyped({ service: "web", key: "plain", name: "X" }, "")).toEqual({
      value: "",
    })
    expect(readTyped({ service: "web", key: "memory" }, "1g")).toEqual({
      value: "1g",
    })
    expect(
      readTyped({ service: "web", key: "volume", name: "data" }, "/data")
    ).toEqual({ value: "/data" })
    expect(
      readTyped({ service: "web", key: "start" }, "bun run start")
    ).toEqual({ value: "bun run start" })
    expect(readTyped({ service: "web", key: "restart" }, "always")).toEqual({
      value: "always",
    })
    expect(readTyped({ service: "web", key: "image" }, "nginx:1.27")).toEqual({
      value: "nginx:1.27",
    })
  })

  test("refused, with the rule as a sentence", () => {
    expect(readTyped({ service: "web", key: "memory" }, "lots")).toEqual({
      refused: "Use a size such as 512m or 1g.",
    })
    expect(readTyped({ service: "web", key: "port" }, "abc")).toEqual({
      refused: "Use a port from 1 to 65535.",
    })
    expect(readTyped({ service: "web", key: "publish" }, "0")).toEqual({
      refused: "Use a port from 1 to 65535.",
    })
    expect(readTyped({ service: "web", key: "cpus" }, "0")).toEqual({
      refused: "Use a number of processors, such as 0.5 or 2.",
    })
    expect(readTyped({ service: "web", key: "secrets" }, "A,,B")).toEqual({
      refused:
        "A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
    })
    expect(
      readTyped({ service: "web", key: "secrets" }, "PATH")
    ).toHaveProperty("refused")
    expect(readTyped({ service: "web", key: "secrets" }, "")).toHaveProperty(
      "refused"
    )
    expect(readTyped({ service: "web", key: "start" }, "a && b")).toEqual({
      refused:
        "It runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
    })
    expect(
      readTyped({ service: "web", key: "plain", name: "X" }, "a\nb")
    ).toEqual({
      refused:
        "Use one line with no control character, at most 4096 characters.",
    })
    expect(
      readTyped({ service: "web", key: "volume", name: "data" }, "/srv:/data")
    ).toEqual({
      refused: "Use an absolute path in the container, such as /data.",
    })
    expect(readTyped({ service: "web", key: "image" }, "")).toEqual({
      refused: "Use one such as ghcr.io/acme/web:1.4.2.",
    })
    expect(readTyped({ service: "web", key: "restart" }, "sometimes")).toEqual({
      refused: "Use no, on-failure or always.",
    })
  })
})
