/**
 * A Compose file written by hand that asks Docker to build, or names the
 * space reserved for built images (specs/016-build-from-source,
 * contracts/cli.md CL6, last item; FR-074's exception, FR-075, FR-077; tasks
 * T113): C8 or C9, before signing, exit status 1, where the Compose file is
 * read for a deploy. Lines by their id only (FR-092).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "../../src/cli/errors"
import { handComposeStop } from "../../src/project/compose-build"
import { readCompose } from "../../src/project/compose-read"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"
import { COMPOSE_V1 } from "../support/helpers"

const FILE = "compose.yaml"
const line = (text: string) => handComposeStop(text, FILE)?.line

describe("C8: a service asks Docker to build, in any form", () => {
  test.each([
    ["a context", "services:\n  web:\n    build: .\n"],
    [
      "a map",
      "services:\n  web:\n    build:\n      context: .\n      dockerfile: Dockerfile\n",
    ],
    [
      "a flow map",
      "services:\n  web: { build: { context: . }, image: x/web:1 }\n",
    ],
    ["nothing", "services:\n  web:\n    build:\n    image: x/web:1\n"],
    [
      "a merge key",
      "x-base: &base\n  build: .\nservices:\n  web:\n    <<: *base\n    image: x/web:1\n",
    ],
  ])("%s", (_, text) => {
    expect(line(text)).toEqual({ id: "C8", file: FILE, service: "web" })
  })

  test("the first service that does, in the file's order; its name cleaned", () => {
    const text =
      'services:\n  db:\n    image: postgres:16\n  "api\\u001b[2J":\n    build: ./api\n  web:\n    build: .\n'
    // `sanitize` takes the whole escape sequence out.
    expect(line(text)).toEqual({ id: "C8", file: FILE, service: "api" })
  })

  test("exit status 1, a stop before signing", () => {
    expect(exitStatusOf("C8")).toBe(1)
    expect(exitStatusOf("C9")).toBe(1)
  })
})

describe("C9: the file names zekno.invalid, any case, any port", () => {
  test.each([
    ["an image", "zekno.invalid/web:1"],
    ["in capitals", "ZEKNO.INVALID/web:1"],
    ["with a port", "zekno.invalid:5000/web"],
    ["mixed, with a port", "Zekno.Invalid:1/shop/web"],
    ["as another registry's path", "ghcr.io/zekno.invalid/web:1"],
  ])("%s", (_, image) => {
    expect(line(`services:\n  web:\n    image: "${image}"\n`)).toEqual({
      id: "C9",
      file: FILE,
      image,
    })
  })

  test("written with a YAML escape, as Compose would read it", () => {
    expect(
      line('services:\n  web:\n    image: "zekno\\x2Einvalid/web:1"\n')
    ).toEqual({ id: "C9", file: FILE, image: "zekno.invalid/web:1" })
  })

  test("anywhere in the text, as core's rule reads it: a value, a comment", () => {
    expect(
      line(
        "services:\n  web:\n    image: x/web:1\n    environment:\n      UP: zekno.invalid/web\n"
      )
    ).toEqual({ id: "C9", file: FILE, image: "zekno.invalid/web" })
    expect(
      line(
        "# was ZEKNO.INVALID:80/old\nservices:\n  web:\n    image: x/web:1\n"
      )
    ).toEqual({ id: "C9", file: FILE, image: "ZEKNO.INVALID:80/old" })
  })

  test("not a name under zekno.invalid: an image of Docker Hub so named, a host that only starts alike", () => {
    for (const image of [
      "zekno.invalid",
      "zekno.invalid:5000",
      "zekno.invalidity/web:1",
    ])
      expect(line(`services:\n  web:\n    image: ${image}\n`)).toBeUndefined()
  })
})

describe("FR-074's exception: everything else is read as today", () => {
  test("a Compose file with images only gives no stop", () => {
    expect(line(COMPOSE_V1)).toBeUndefined()
    expect(
      line(
        "services:\n  web:\n    image: x/web:1\n    labels:\n      build.note: here\n"
      )
    ).toBeUndefined()
  })

  test("a text that cannot be parsed is left to the deploy, as today", () => {
    expect(line("services: [\n")).toBeUndefined()
    expect(
      line(`services:\n  web:\n    image: ${"*a ".repeat(300)}\n`)
    ).toBeUndefined()
  })

  test("no frozen scene holds a Compose file that builds or names zekno.invalid (CL14)", () => {
    for (const file of [
      "../plain/plain-scenes.ts",
      "../plain/plain-at-head.ts",
      "../support/helpers.ts",
    ]) {
      const text = readFileSync(join(import.meta.dir, file), "utf8")
      expect({ file, build: /\bbuild:/.test(text) }).toEqual({
        file,
        build: false,
      })
      expect({ file, reserved: /zekno\.invalid/i.test(text) }).toEqual({
        file,
        reserved: false,
      })
    }
  })
})

describe("where the Compose file is read for a deploy: before signing, exit status 1", () => {
  let folder: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "zekno-compose-build-"))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  test("readCompose stops with C8 or C9, a CliError, its id the message", () => {
    for (const [text, id] of [
      ["services:\n  web:\n    build: .\n", "C8"],
      ["services:\n  web:\n    image: zekno.invalid/web:1\n", "C9"],
    ] as const) {
      writeFileSync(join(folder, FILE), text)
      let thrown: unknown
      try {
        readCompose({ kind: "default", folder })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BuildStop)
      expect(thrown).toBeInstanceOf(CliError)
      expect((thrown as BuildStop).message).toBe(id)
      expect((thrown as BuildStop).line).toMatchObject({ id, file: FILE })
    }
  })

  test("a Compose file with images only is read as today", () => {
    writeFileSync(join(folder, FILE), COMPOSE_V1)
    expect(readCompose({ kind: "default", folder }).text).toBe(COMPOSE_V1)
  })
})
