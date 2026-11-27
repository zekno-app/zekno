/**
 * `zekno settings set` and `unset` for the Build section
 * (specs/016-build-from-source, contracts/cli.md CL1, "Keys" and "Values
 * refused by set"; FR-011, FR-071b; tasks T112): each key set and unset,
 * each refusal by its id and exit status, G12 and G13 one change line, and
 * nothing written on a refusal. No sentence is checked: only ids (FR-092).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { WrongInput } from "../../src/cli/errors"
import { prepareSettingChange } from "../../src/ops/settings"
import { applyChange, parseSettingPath } from "../../src/settings/change"
import { settingsText } from "../../src/settings/text"
import type {
  Change,
  ServiceSettings,
  SettingPath,
  Settings,
} from "../../src/settings/types"
import { BuildValueRefused, exitStatusOf } from "../../src/shared/build-lines"

const IMAGE = "ghcr.io/acme/web:1.4.2"

/** An app of `web` and `db`, `web` as given. */
const app = (web: ServiceSettings): Settings => ({
  version: 1,
  services: [
    ["web", web],
    ["db", { image: "postgres:16" }],
  ],
})
const BUILT = app({ build: { builder: "dockerfile" }, port: 3000 })
const IMAGED = app({ image: IMAGE, port: 3000 })

const path = (text: string): SettingPath => {
  const parsed = parseSettingPath(text)
  if (!("service" in parsed)) throw new Error(`no setting ${text}`)
  return parsed
}

/** The change, or the test fails with the refusal. */
function change(
  settings: Settings,
  name: string,
  value: string | undefined,
  settingsFile?: string
): Change {
  const got = applyChange(settings, path(name), value, undefined, settingsFile)
  if ("refused" in got) throw new Error(`refused: ${got.refused}`)
  return got
}

/** The refusal, or the test fails. */
function refusal(
  settings: Settings,
  name: string,
  value: string | undefined,
  settingsFile?: string
) {
  const got = applyChange(settings, path(name), value, undefined, settingsFile)
  if (!("refused" in got)) throw new Error("expected a refusal")
  return got
}

const web = (settings: Settings): ServiceSettings =>
  settings.services.find(([name]) => name === "web")![1]

describe("parseSettingPath: the keys of the Build section, with and without their place in the file", () => {
  test("every key", () => {
    for (const [short, long, key] of [
      ["web.root", "web.source.root", "root"],
      ["web.include", "web.source.include", "include"],
      ["web.builder", "web.build.builder", "builder"],
      ["web.dockerfile", "web.build.dockerfile", "dockerfile"],
      ["web.stage", "web.build.stage", "stage"],
      ["web.build-timeout", "web.build.timeout", "build-timeout"],
      ["web.build-network", "web.build.network", "build-network"],
    ] as const) {
      expect(parseSettingPath(short)).toEqual({ service: "web", key })
      expect(parseSettingPath(long)).toEqual({ service: "web", key })
    }
  })

  test("G18: a setting not known; G19: `web.build`, today's later setting; both exit status 2", () => {
    for (const [text, id] of [
      ["web.memroy", "G18"],
      ["web.build-secrets", "G18"],
      ["web.build.secrets", "G18"],
      ["nodot", "G18"],
      ["web.build", "G19"],
      ["web.source.build", "G19"],
    ] as const) {
      let thrown: unknown
      try {
        parseSettingPath(text)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(BuildValueRefused)
      expect(thrown).toBeInstanceOf(WrongInput)
      expect((thrown as BuildValueRefused).line).toEqual({ id })
      expect(exitStatusOf(id)).toBe(2)
    }
    expect(parseSettingPath("web.replicas")).toEqual({ later: "replicas" })
  })
})

describe("each key set and unset on a built service", () => {
  test("root, include, dockerfile, stage, build-timeout and build-network: set, then unset", () => {
    for (const [name, value, field] of [
      ["web.root", "apps/web", { root: "apps/web" }],
      [
        "web.include",
        "certs/server.key, .env",
        { include: ["certs/server.key", ".env"] },
      ],
      [
        "web.dockerfile",
        "docker/web.Dockerfile",
        {
          build: { builder: "dockerfile", dockerfile: "docker/web.Dockerfile" },
        },
      ],
      [
        "web.stage",
        "runner",
        { build: { builder: "dockerfile", stage: "runner" } },
      ],
      [
        "web.build-timeout",
        "3600",
        { build: { builder: "dockerfile", timeout: 3600 } },
      ],
      [
        "web.build-network",
        "none",
        { build: { builder: "dockerfile", network: "none" } },
      ],
    ] as const) {
      const set = change(BUILT, name, value)
      expect({ name, web: web(set.settings) }).toEqual({
        name,
        web: { build: { builder: "dockerfile" }, port: 3000, ...field },
      })
      // The other service is as it was.
      expect(set.settings.services[1]).toEqual(BUILT.services[1]!)
      const unset = change(set.settings, name, undefined)
      expect({ name, web: web(unset.settings) }).toEqual({
        name,
        web: web(BUILT),
      })
    }
  })

  test("each change's label is its row's id until the words tasks (G1 to G8), its values as the file holds them", () => {
    const timeout = change(BUILT, "web.build-timeout", "3600")
    expect([timeout.label, timeout.now, timeout.next]).toEqual([
      "G5",
      "G5",
      "3600",
    ])
    const root = change(BUILT, "web.root", "..")
    expect([root.label, root.next]).toEqual(["G1", ".."])
    expect(change(BUILT, "web.include", ".env").label).toBe("G8")
  })

  test("the same value, and a setting not set, write nothing: exit status 0, as today", () => {
    expect(refusal(BUILT, "web.builder", "dockerfile")).toMatchObject({
      status: 0,
    })
    expect(refusal(BUILT, "web.stage", undefined)).toMatchObject({ status: 0 })
    const staged = change(BUILT, "web.stage", "runner").settings
    expect(refusal(staged, "web.stage", "runner")).toMatchObject({ status: 0 })
  })

  test("G17: the builder of a service with no image cannot be unset", () => {
    expect(refusal(BUILT, "web.builder", undefined)).toEqual({
      refused: "G17",
      status: 2,
      line: { id: "G17", service: "web" },
    })
  })
})

describe("G12 and G13: one change line from an image to a build, and back", () => {
  test("G12: `set web.builder dockerfile` on a service that runs an image replaces the image", () => {
    const got = change(IMAGED, "web.builder", "dockerfile")
    expect(got.line).toEqual({
      id: "G12",
      service: "web",
      image: IMAGE,
      dockerfile: "Dockerfile",
    })
    expect(web(got.settings)).toEqual({
      build: { builder: "dockerfile" },
      port: 3000,
    })
    expect(got.label).toBe("G12")
  })

  test("G13: `set web.image <ref>` on a built service replaces the build, its root and its files to include", () => {
    const built = app({
      root: "apps/web",
      include: [".env"],
      build: { builder: "dockerfile", dockerfile: "web.Dockerfile" },
      port: 3000,
    })
    const got = change(built, "web.image", IMAGE)
    expect(got.line).toEqual({
      id: "G13",
      service: "web",
      dockerfile: "web.Dockerfile",
      image: IMAGE,
    })
    expect(web(got.settings)).toEqual({ image: IMAGE, port: 3000 })
    expect(got.label).toBe("G13")
  })

  test("both read back and write as one file a deploy reads", () => {
    for (const got of [
      change(IMAGED, "web.builder", "dockerfile"),
      change(BUILT, "web.image", IMAGE),
    ])
      expect(settingsText(got.settings)).not.toContain('"image": "zekno')
  })
})

describe("refused values, exit status 2, each by its id", () => {
  test("G20's forms of step 1", () => {
    for (const [name, value, refused] of [
      ["web.builder", "nixpacks", "builder"],
      ["web.builder", "railpack", "railpack"],
      ["web.dockerfile", "../Dockerfile", "dockerfile"],
      ["web.dockerfile", "/srv/Dockerfile", "dockerfile"],
      ["web.dockerfile", "x".repeat(256), "dockerfile"],
      ["web.stage", "-runner", "stage"],
      ["web.build-timeout", "0", "build-timeout"],
      ["web.build-timeout", "7201", "build-timeout"],
      ["web.build-timeout", "30m", "build-timeout"],
      ["web.build-network", "host", "build-network"],
      ["web.root", "/srv/app", "root"],
      ["web.root", "a\\b", "root"],
    ] as const)
      expect({ name, value, got: refusal(BUILT, name, value) }).toEqual({
        name,
        value,
        got: { refused: "G20", status: 2, line: { id: "G20", refused } },
      })
    expect(exitStatusOf("G20")).toBe(2)
  })

  test("G20's form for an image under zekno.invalid, any case, any port; an image that is no reference stays today's", () => {
    for (const image of ["zekno.invalid/web:1", "ZEKNO.INVALID:5000/web"])
      expect(refusal(IMAGED, "web.image", image)).toEqual({
        refused: "G20",
        status: 2,
        line: { id: "G20", refused: "image" },
      })
    const notReference = refusal(IMAGED, "web.image", "Not An Image")
    expect(notReference.status).toBe(2)
    expect(notReference).not.toHaveProperty("line")
  })

  test("G16: the image of a service with no build cannot be unset, also for an app that does not build", () => {
    expect(refusal(IMAGED, "web.image", undefined)).toEqual({
      refused: "G16",
      status: 2,
      line: { id: "G16", service: "web" },
    })
  })

  test("include: more than 64 paths, a path twice, not relative or outside the root: ids of their own", () => {
    const many = Array.from({ length: 65 }, (_, at) => `k${at}.pem`).join(",")
    for (const [value, id] of [
      [many, "include_too_many"],
      [".env, .env", "include_twice"],
      ["../.env", "include_form"],
      ["/etc/passwd", "include_form"],
      ["certs/./x.key", "include_form"],
      ["", "include_form"],
      [".env,", "include_form"],
    ] as const)
      expect({ value, got: refusal(BUILT, "web.include", value) }).toEqual({
        value,
        got: { refused: id, status: 2, line: { id, service: "web" } },
      })
  })

  test("a setting of the Build section on a service with no build: an id of its own", () => {
    for (const [name, value, setting] of [
      ["web.root", ".", "root"],
      ["web.include", ".env", "include"],
      ["web.dockerfile", "Dockerfile", "dockerfile"],
      ["web.stage", "runner", "stage"],
      ["web.build-timeout", "60", "build-timeout"],
      ["web.build-network", "none", "build-network"],
    ] as const)
      expect({ name, got: refusal(IMAGED, name, value) }).toEqual({
        name,
        got: {
          refused: "needs_build",
          status: 2,
          line: { id: "needs_build", service: "web", setting },
        },
      })
  })

  test("a root beyond its reach, or through a link out, checked by build-reach.ts: G20's root form", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "zekno-build-set-")))
    try {
      const project = join(base, "project")
      mkdirSync(join(project, "app"), { recursive: true })
      mkdirSync(join(base, "outside"))
      symlinkSync(join(base, "outside"), join(project, "out"))
      const file = join(project, "zekno.app.json")
      expect(change(BUILT, "web.root", "app", file).settings).toBeTruthy()
      for (const root of ["..", "out"])
        expect(refusal(BUILT, "web.root", root, file)).toEqual({
          refused: "G20",
          status: 2,
          line: { id: "G20", refused: "root" },
        })
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe("nothing is written on a refusal", () => {
  let cwd: string
  let home: string
  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), "zekno-build-set-cwd-")))
    home = mkdtempSync(join(tmpdir(), "zekno-build-set-home-"))
  })
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("each refusal leaves the file byte for byte, with exit status 2 (WrongInput)", () => {
    const text = settingsText(BUILT)
    const file = join(cwd, "zekno.app.json")
    writeFileSync(file, text)
    for (const [name, value, unset, id] of [
      ["web.builder", "railpack", false, "G20"],
      // A root beyond its reach, checked against the file the command reads (build-reach.ts).
      ["web.root", "..", false, "G20"],
      ["web.builder", undefined, true, "G17"],
      ["web.include", ".env,.env", false, "include_twice"],
      ["db.root", ".", false, "needs_build"],
      ["db.image", undefined, true, "G16"],
      ["web.nope", "x", false, "G18"],
      ["web.build", "x", false, "G19"],
    ] as const) {
      let thrown: unknown
      try {
        prepareSettingChange({ cwd, home }, name, value, unset)
      } catch (error) {
        thrown = error
      }
      expect({ name, wrongInput: thrown instanceof WrongInput }).toEqual({
        name,
        wrongInput: true,
      })
      expect((thrown as Error).message).toBe(id)
      expect(readFileSync(file, "utf8")).toBe(text)
    }
  })
})
