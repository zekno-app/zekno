/**
 * The settings' Build section, its shape and rules (specs/016-build-from-source,
 * data-model.md, "The settings' Build section"; contracts/cli.md CL1;
 * FR-006 to FR-010, FR-077; tasks T105): each rule said by its line's id,
 * the order of the text kept, and a file whose services run images read
 * exactly as today. No sentence is checked: only ids (FR-092).
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "../../src/cli/errors"
import { BuildStop, exitStatusOf } from "../../src/shared/build-lines"
import { OwnBuildStop } from "../../src/settings/build-faults"
import { faultSentence, readSettingsFile } from "../../src/settings/file"
import { checkSettings, isSettings } from "../../src/settings/schema"
import type { Settings, SettingsFault } from "../../src/settings/types"
import {
  DESIGN_FILE,
  DESIGN_SETTINGS,
  GOOD_FILES,
} from "../support/settings-files"

const FILE = "zekno.app.json"
const IMAGE = "ghcr.io/acme/web:1.4.2"
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** A file of the one service `web`, its sections as given. */
const web = (service: Record<string, unknown>): string =>
  json({ zekno: 1, services: { web: service } })

/** A built `web`: `build` merged into a Dockerfile build, `source` as given. */
const built = (
  build: Record<string, unknown> = {},
  more: Record<string, unknown> = {}
): string => web({ build: { builder: "dockerfile", ...build }, ...more })

/** The fault a text stops with, or the test fails. */
function fault(text: string): SettingsFault {
  const read = checkSettings(text, FILE)
  if (isSettings(read))
    throw new Error("expected a fault, the settings were read")
  return read
}

/** The build fault a text stops with, as its id and its values. */
function buildFault(text: string) {
  const got = fault(text)
  if (got.kind !== "build")
    throw new Error(`expected a build fault, got ${faultSentence(got, FILE)}`)
  return got.fault
}

/** The settings a text gives, or the test fails. */
function settings(text: string): Settings {
  const read = checkSettings(text, FILE)
  if (!isSettings(read)) throw new Error(faultSentence(read, FILE))
  return read
}

describe("a built service reads", () => {
  test("the builder alone: no image, no root, nothing else set", () => {
    expect(settings(built())).toEqual({
      version: 1,
      services: [["web", { build: { builder: "dockerfile" } }]],
    })
  })

  test("every field of the Build section and of Source, in data-model.md's example", () => {
    const text = web({
      source: { root: ".", include: ["certs/server.key"] },
      build: {
        builder: "dockerfile",
        dockerfile: "docker/web.Dockerfile",
        stage: "runner",
        timeout: 3600,
        network: "none",
      },
      networking: { port: 3000 },
    })
    expect(settings(text)).toEqual({
      version: 1,
      services: [
        [
          "web",
          {
            root: ".",
            include: ["certs/server.key"],
            build: {
              builder: "dockerfile",
              dockerfile: "docker/web.Dockerfile",
              stage: "runner",
              timeout: 3600,
              network: "none",
            },
            port: 3000,
          },
        ],
      ],
    })
  })

  test("the edges: a time limit of 1 and of 7,200 seconds, a path of 255 characters, a stage of 63, 64 paths to include, `internet`", () => {
    const path = `${"d/".repeat(125)}Dfile`
    expect(path).toHaveLength(255)
    const stage = `a${"b".repeat(62)}`
    const include = Array.from({ length: 64 }, (_, at) => `certs/${at}.key`)
    for (const timeout of [1, 7200]) {
      const read = settings(
        built(
          { dockerfile: path, stage, timeout, network: "internet" },
          { source: { root: "..", include } }
        )
      )
      expect(read.services[0]![1].build).toEqual({
        builder: "dockerfile",
        dockerfile: path,
        stage,
        timeout,
        network: "internet",
      })
      expect(read.services[0]![1].include).toEqual(include)
    }
  })

  test("an empty list of files to include is left out, as the file's other lists are", () => {
    expect(settings(built({}, { source: { include: [] } }))).toEqual({
      version: 1,
      services: [["web", { build: { builder: "dockerfile" } }]],
    })
  })
})

describe("the rules, each by its line's id", () => {
  test("F5: a builder named railpack, which this zekno does not build; exit status 1", () => {
    expect(buildFault(built({ builder: "railpack" }))).toEqual({
      id: "F5",
      service: "web",
    })
    expect(exitStatusOf("F5")).toBe(1)
  })

  test("a builder this zekno does not know, and none: ids of their own (no row yet)", () => {
    for (const builder of ["nixpacks", "Dockerfile", "", 5, null])
      expect(buildFault(built({ builder }))).toEqual({
        id: "builder_unknown",
        service: "web",
      })
    expect(buildFault(web({ build: {} }))).toEqual({
      id: "builder_missing",
      service: "web",
    })
  })

  test("C24: a Dockerfile path outside the folder sent, not relative, longer than 255 characters or not a path a person reads", () => {
    for (const dockerfile of [
      "../Dockerfile",
      "docker/../../Dockerfile",
      "./Dockerfile",
      "/srv/Dockerfile",
      "docker\\Dockerfile",
      "",
      "x".repeat(256),
      "Docker\u0007file",
      "Docker\u200bfile",
      5,
    ])
      expect(buildFault(built({ dockerfile }))).toEqual({
        id: "C24",
        service: "web",
      })
    expect(exitStatusOf("C24")).toBe(1)
  })

  test("C25: an image and a build", () => {
    expect(buildFault(built({}, { source: { image: IMAGE } }))).toEqual({
      id: "C25",
      service: "web",
    })
  })

  test("C26: neither an image nor a build, also for an app that does not build", () => {
    for (const text of [
      web({ deploy: { start: "bun run start" } }),
      web({ source: {} }),
      json({
        zekno: 1,
        services: {
          db: { source: { image: "postgres:16" } },
          web: { networking: { port: 3000 } },
        },
      }),
    ])
      expect(buildFault(text)).toEqual({ id: "C26", service: "web" })
  })

  test("C27: a time limit outside 1 to 7,200 seconds, or not a whole number", () => {
    for (const timeout of [0, 7201, 1.5, -1, "60"])
      expect(buildFault(built({ timeout }))).toEqual({
        id: "C27",
        service: "web",
      })
    const exponent = built({ timeout: 60 }).replace("60", "6e1")
    expect(buildFault(exponent)).toEqual({ id: "C27", service: "web" })
    const fraction = built({ timeout: 60 }).replace("60", "60.0")
    expect(buildFault(fraction)).toEqual({ id: "C27", service: "web" })
  })

  test("C28: a network other than internet or none", () => {
    for (const network of ["default", "host", "Internet", "", 1])
      expect(buildFault(built({ network }))).toEqual({
        id: "C28",
        service: "web",
      })
  })

  test("C29: an image under zekno.invalid, any case, any port", () => {
    for (const image of [
      "zekno.invalid/web:1",
      "ZEKNO.INVALID/web:1",
      "Zekno.Invalid:5000/web",
      "zekno.invalid:1/shop/web@sha256:" + "0".repeat(64),
      "ghcr.io/zekno.invalid/web:1",
    ])
      expect(buildFault(web({ source: { image } }))).toEqual({
        id: "C29",
        service: "web",
      })
    // Not under zekno.invalid: an image of Docker Hub named so, and one that only starts alike.
    for (const image of ["zekno.invalid:5000", "zekno.invalidity/web:1"])
      expect(settings(web({ source: { image } })).services[0]![1]).toEqual({
        image,
      })
  })

  test("a stage that breaks its pattern: an id of its own", () => {
    for (const stage of ["-x", ".x", "a b", `a${"b".repeat(63)}`, "", 5])
      expect(buildFault(built({ stage }))).toEqual({
        id: "stage_form",
        service: "web",
      })
  })

  test("root and include need a build: ids of their own", () => {
    expect(buildFault(web({ source: { image: IMAGE, root: "." } }))).toEqual({
      id: "needs_build",
      service: "web",
      setting: "root",
    })
    expect(
      buildFault(web({ source: { image: IMAGE, include: [".env"] } }))
    ).toEqual({ id: "needs_build", service: "web", setting: "include" })
  })

  test("include: at most 64 unique relative paths inside the root, ids of their own", () => {
    const many = Array.from({ length: 65 }, (_, at) => `certs/${at}.key`)
    expect(buildFault(built({}, { source: { include: many } }))).toEqual({
      id: "include_too_many",
      service: "web",
    })
    expect(
      buildFault(built({}, { source: { include: [".env", ".env"] } }))
    ).toEqual({ id: "include_twice", service: "web" })
    for (const include of [
      ["../.env"],
      ["/home/ada/.ssh/id_rsa"],
      ["certs/./server.key"],
      ["certs//server.key"],
      ["certs\\server.key"],
      [""],
      [5],
      ".env",
    ])
      expect(buildFault(built({}, { source: { include } }))).toEqual({
        id: "include_form",
        service: "web",
      })
  })

  test("a root that is not a relative path: an id of its own; where it leads is build-reach.ts's", () => {
    for (const root of ["/srv/app", "a\\b", "", 5, "web\u0000"])
      expect(buildFault(built({}, { source: { root } }))).toEqual({
        id: "root_form",
        service: "web",
      })
    for (const root of [".", "..", "../..", "apps/web", "./apps"])
      expect(
        settings(built({}, { source: { root } })).services[0]![1].root
      ).toBe(root)
  })

  test("build.secrets is a key this zekno does not know until step 1b (SV6), and so is source.build", () => {
    for (const text of [
      built({ secrets: ["NPM_TOKEN"] }),
      web({ source: { image: IMAGE, build: { context: "." } } }),
    ]) {
      const got = fault(text)
      expect(got.kind).toBe("form")
      expect(faultSentence(got, FILE)).toContain(
        "a setting this zekno does not know"
      )
    }
  })

  test("a Build section that is not an object is SV5, as any section", () => {
    const got = fault(web({ build: "." }))
    expect(got).toMatchObject({ kind: "form", place: "web, build" })
  })
})

describe("the order of the text", () => {
  test("the first fault in the text is said, whichever its kind", () => {
    const first = json({
      zekno: 1,
      services: {
        web: { build: { builder: "dockerfile", network: "lan" } },
        api: { build: { builder: "dockerfile", timeout: 0 } },
      },
    })
    expect(buildFault(first)).toEqual({ id: "C28", service: "web" })
    const memoryFirst = json({
      zekno: 1,
      services: {
        web: { deploy: { memory: "lots" } },
        api: { build: { builder: "railpack" } },
      },
    })
    expect(fault(memoryFirst)).toMatchObject({
      kind: "form",
      place: "web, deploy.memory",
    })
  })

  test("C26 comes where the image would end, after a fault inside the service and before the next service's", () => {
    const text = json({
      zekno: 1,
      services: {
        web: { deploy: { memory: "lots" } },
        api: { source: 5 },
      },
    })
    expect(fault(text)).toMatchObject({ place: "web, deploy.memory" })
    const neither = json({
      zekno: 1,
      services: { web: { deploy: {} }, api: { source: 5 } },
    })
    expect(buildFault(neither)).toEqual({ id: "C26", service: "web" })
  })
})

describe("a file whose services run images reads exactly as today", () => {
  test("design.md's file, and every good file of the test set", () => {
    expect(checkSettings(DESIGN_FILE, FILE)).toEqual(DESIGN_SETTINGS)
    for (const file of GOOD_FILES) {
      const read = checkSettings(file.text, FILE)
      expect({ name: file.name, read }).toEqual({
        name: file.name,
        read: file.expect.settings,
      })
      if (!isSettings(read)) continue
      for (const [, service] of read.services)
        for (const key of ["build", "root", "include"])
          expect(Object.hasOwn(service, key)).toBe(false)
    }
  })
})

describe("read from the disk, a fault is a stop with exit status 1 and its id as the message", () => {
  const withFile = (text: string, run: (folder: string) => void) => {
    const folder = mkdtempSync(join(tmpdir(), "zekno-build-shape-"))
    try {
      writeFileSync(join(folder, FILE), text)
      run(folder)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
  const thrown = (folder: string): unknown => {
    try {
      readSettingsFile({ kind: "default", folder }, folder)
    } catch (error) {
      return error
    }
    throw new Error("expected the reader to stop")
  }

  test("a row's id: a BuildStop holding the file and the service", () => {
    withFile(built({ network: "lan" }), (folder) => {
      const error = thrown(folder)
      expect(error).toBeInstanceOf(BuildStop)
      expect(error).toBeInstanceOf(CliError)
      expect((error as BuildStop).line).toEqual({
        id: "C28",
        file: FILE,
        service: "web",
      })
      expect((error as BuildStop).message).toBe("C28")
    })
  })

  test("an id of its own: a stop of its own, a CliError, its id as the message", () => {
    withFile(built({ builder: "nixpacks" }), (folder) => {
      const error = thrown(folder)
      expect(error).toBeInstanceOf(OwnBuildStop)
      expect(error).toBeInstanceOf(CliError)
      expect((error as OwnBuildStop).line).toEqual({
        id: "builder_unknown",
        service: "web",
        file: FILE,
      })
      expect((error as OwnBuildStop).message).toBe("builder_unknown")
    })
  })

  test("a built service is read whole", () => {
    withFile(built({ stage: "runner" }), (folder) => {
      const read = readSettingsFile({ kind: "default", folder }, folder)
      expect(read.settings.services).toEqual([
        ["web", { build: { builder: "dockerfile", stage: "runner" } }],
      ])
    })
  })
})
