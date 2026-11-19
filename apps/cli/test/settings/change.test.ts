/**
 * One change to an app's settings (specs/010-app-settings, data-model.md, "A
 * change"; contracts/commands.md, `set` and `unset`; tasks T018): which
 * setting a name is, the settings with one setting changed, the refusals
 * with their statuses, and how values read.
 */
import { describe, expect, test } from "bun:test"

import {
  applyChange,
  parseSettingPath,
  shownValue,
} from "../../src/settings/change"
import { settingsText } from "../../src/settings/text"
import type {
  Change,
  ServiceSettings,
  SettingPath,
  Settings,
} from "../../src/settings/types"
import { DESIGN_FILE, DESIGN_SETTINGS } from "../support/settings-files"

/** The change, or the test fails with the refusal. */
function change(
  settings: Settings,
  path: string,
  value: string | undefined
): Change {
  const parsed = parseSettingPath(path)
  if (!("service" in parsed)) throw new Error(`no setting ${path}`)
  const got = applyChange(settings, parsed, value)
  if ("refused" in got) throw new Error(`refused: ${got.refused}`)
  return got
}

/** The refusal, or the test fails. */
function refusal(settings: Settings, path: string, value: string | undefined) {
  const parsed = parseSettingPath(path)
  if (!("service" in parsed)) throw new Error(`no setting ${path}`)
  const got = applyChange(settings, parsed, value)
  if (!("refused" in got)) throw new Error("expected a refusal")
  return got
}

const web = (settings: Settings): ServiceSettings =>
  settings.services.find(([name]) => name === "web")![1]

describe("parseSettingPath (contracts/commands.md's table)", () => {
  test("every row, both forms", () => {
    const rows: [string, string, SettingPath][] = [
      ["web.image", "web.source.image", { service: "web", key: "image" }],
      ["web.start", "web.deploy.start", { service: "web", key: "start" }],
      ["web.restart", "web.deploy.restart", { service: "web", key: "restart" }],
      ["web.memory", "web.deploy.memory", { service: "web", key: "memory" }],
      ["web.cpus", "web.deploy.cpus", { service: "web", key: "cpus" }],
      ["web.port", "web.networking.port", { service: "web", key: "port" }],
      [
        "web.publish",
        "web.networking.publish",
        { service: "web", key: "publish" },
      ],
      [
        "web.secrets",
        "web.variables.secrets",
        { service: "web", key: "secrets" },
      ],
      [
        "web.plain.NODE_ENV",
        "web.variables.plain.NODE_ENV",
        { service: "web", key: "plain", name: "NODE_ENV" },
      ],
    ]
    for (const [short, long, path] of rows) {
      expect(parseSettingPath(short)).toEqual(path)
      expect(parseSettingPath(long)).toEqual(path)
    }
    expect(parseSettingPath("web.volumes.data")).toEqual({
      service: "web",
      key: "volume",
      name: "data",
    })
    expect(parseSettingPath("worker.memory")).toEqual({
      service: "worker",
      key: "memory",
    })
  })

  test("a later setting gives its kind, with or without its section", () => {
    // Domains and the health check are settings since specs/015-domains-https (CL1): see change-routes.test.ts.
    expect(parseSettingPath("web.build")).toEqual({ later: "build" })
    expect(parseSettingPath("web.source.build")).toEqual({ later: "build" })
    expect(parseSettingPath("web.predeploy")).toEqual({ later: "predeploy" })
    expect(parseSettingPath("web.replicas")).toEqual({ later: "replicas" })
    expect(parseSettingPath("web.deploy.replicas")).toEqual({
      later: "replicas",
    })
  })

  test("anything else is no such setting", () => {
    for (const text of [
      "web.memroy",
      "web",
      ".memory",
      "web.",
      "web.plain",
      "web.plain.1A",
      "web.plain.",
      "web.volumes",
      "web.volumes.Data",
      "web.volumes.a/b",
      "web.deploy",
      "web.source",
      "web.constructor",
      "web.__proto__",
      "web.toString",
      "web.deploy.constructor",
      "web.networking.memory",
      "web.memory.x",
      "",
      "...",
    ])
      expect([text, parseSettingPath(text)]).toEqual([text, { unknown: true }])
  })

  test("a service name is kept as typed; it is said only once it passes its rule (CS4)", () => {
    expect(parseSettingPath("Web.memory")).toEqual({
      service: "Web",
      key: "memory",
    })
    const bad = "\u001b[2J\u001b]52;c;x\u0007"
    const got = applyChange(
      DESIGN_SETTINGS,
      { service: bad, key: "memory" },
      "1g"
    )
    expect(got).toEqual({
      refused:
        "zekno.app.json has no such service. Its services are web, worker.",
      status: 2,
    })
    expect(
      applyChange(DESIGN_SETTINGS, { service: "api", key: "memory" }, "1g")
    ).toEqual({
      refused:
        "zekno.app.json has no service api. Its services are web, worker.",
      status: 2,
    })
  })
})

describe("applyChange on design.md's settings", () => {
  test("each setting set, changed and unset", () => {
    const values: [string, string, string, string][] = [
      ["web.image", "nginx:1.27", "ghcr.io/acme/demo-web:1.4.2", "nginx:1.27"],
      ["web.start", "bun run serve", "bun run start", "bun run serve"],
      ["web.restart", "always", "on failure", "always"],
      ["web.memory", "2g", "1g", "2g"],
      ["web.cpus", "0.5", "1", "0.5"],
      ["web.port", "8080", "3000", "8080"],
      ["web.publish", "80", "not published", "80"],
      ["web.secrets", "A, B", "DATABASE_URL, SESSION_KEY", "A, B"],
      ["web.plain.NODE_ENV", "staging", "production", "staging"],
      ["web.volumes.uploads", "/srv/uploads", "/data/uploads", "/srv/uploads"],
    ]
    for (const [path, value, now, next] of values) {
      const made = change(DESIGN_SETTINGS, path, value)
      expect([path, made.now, made.next]).toEqual([path, now, next])
    }
    for (const path of [
      "web.start",
      "web.restart",
      "web.memory",
      "web.cpus",
      "web.port",
      "web.secrets",
      "web.plain.NODE_ENV",
      "web.volumes.uploads",
    ]) {
      const made = change(DESIGN_SETTINGS, path, undefined)
      expect(made.value).toBeUndefined()
    }
  })

  test("the change carries the settings with exactly that change", () => {
    const made = change(DESIGN_SETTINGS, "web.memory", "2g")
    expect(made.value).toBe("2g")
    expect(web(made.settings)).toEqual({
      ...web(DESIGN_SETTINGS),
      memory: "2g",
    })
    expect(made.settings.services[1]).toEqual(DESIGN_SETTINGS.services[1]!)
    const lines = settingsText(made.settings).split("\n")
    const before = DESIGN_FILE.split("\n")
    expect(lines.filter((line, at) => line !== before[at])).toEqual([
      '        "memory": "2g",',
    ])
  })

  test("the typed value is read as the setting holds it", () => {
    expect(change(DESIGN_SETTINGS, "web.port", "8080").value).toBe(8080)
    expect(change(DESIGN_SETTINGS, "web.cpus", "0.5").value).toBe("0.5")
    expect(change(DESIGN_SETTINGS, "web.secrets", "A, B,C").value).toEqual([
      "A",
      "B",
      "C",
    ])
  })

  test("a new plain variable and a new volume go last", () => {
    expect(
      web(change(DESIGN_SETTINGS, "web.plain.LOG_LEVEL", "info").settings).plain
    ).toEqual([
      ["NODE_ENV", "production"],
      ["LOG_LEVEL", "info"],
    ])
    expect(
      web(change(DESIGN_SETTINGS, "web.volumes.cache", "/cache").settings)
        .volumes
    ).toEqual([
      ["uploads", "/data/uploads"],
      ["cache", "/cache"],
    ])
    expect(
      change(DESIGN_SETTINGS, "worker.plain.A", "").settings.services[1]![1]
        .plain
    ).toEqual([["A", ""]])
  })

  test("unset of the last variable drops plain; of every setting of a section drops the section", () => {
    const noPlain = change(
      DESIGN_SETTINGS,
      "web.plain.NODE_ENV",
      undefined
    ).settings
    expect(web(noPlain).plain).toBeUndefined()
    expect(settingsText(noPlain)).toContain(
      '      "variables": { "secrets": ["DATABASE_URL", "SESSION_KEY"] },\n'
    )
    let settings = DESIGN_SETTINGS
    for (const path of ["web.start", "web.restart", "web.memory", "web.cpus"])
      settings = change(settings, path, undefined).settings
    expect(settingsText(settings)).not.toContain(
      '"web": {\n      "source": { "image": "ghcr.io/acme/demo-web:1.4.2" },\n      "deploy"'
    )
    expect(web(settings)).toEqual({
      image: "ghcr.io/acme/demo-web:1.4.2",
      port: 3000,
      secrets: ["DATABASE_URL", "SESSION_KEY"],
      plain: [["NODE_ENV", "production"]],
      volumes: [["uploads", "/data/uploads"]],
    })
    const noVolumes = change(
      DESIGN_SETTINGS,
      "web.volumes.uploads",
      undefined
    ).settings
    expect(web(noVolumes).volumes).toBeUndefined()
    expect(settingsText(noVolumes)).not.toContain("volumes")
  })

  test("CS15: the image cannot be unset", () => {
    expect(refusal(DESIGN_SETTINGS, "web.image", undefined)).toEqual({
      refused: "A service needs an image, so source.image cannot be unset.",
      status: 2,
    })
  })

  test("CS16: unset of a setting not set", () => {
    expect(refusal(DESIGN_SETTINGS, "worker.memory", undefined)).toEqual({
      refused: "worker · memory limit is not set. Nothing was written.",
      status: 0,
    })
    expect(refusal(DESIGN_SETTINGS, "web.plain.NOPE", undefined)).toEqual({
      refused: "web · NOPE is not set. Nothing was written.",
      status: 0,
    })
    expect(refusal(DESIGN_SETTINGS, "web.volumes.nope", undefined)).toEqual({
      refused: "web · volume nope is not set. Nothing was written.",
      status: 0,
    })
  })

  test("CS8: the same value as now, also written another way", () => {
    expect(refusal(DESIGN_SETTINGS, "web.memory", "1g")).toEqual({
      refused: "web · memory limit is 1g already. Nothing was written.",
      status: 0,
    })
    expect(refusal(DESIGN_SETTINGS, "web.restart", "on-failure").refused).toBe(
      "web · restart rule is on failure already. Nothing was written."
    )
    expect(refusal(DESIGN_SETTINGS, "web.cpus", "1.0").status).toBe(0)
    expect(
      refusal(DESIGN_SETTINGS, "web.start", "bun  run   start").status
    ).toBe(0)
    expect(
      refusal(DESIGN_SETTINGS, "web.secrets", "DATABASE_URL,SESSION_KEY").status
    ).toBe(0)
    expect(refusal(DESIGN_SETTINGS, "web.port", "3000").status).toBe(0)
  })

  test("CS7: a value its rule refuses, with the rule", () => {
    const cases: [string, string, string][] = [
      [
        "web.memory",
        "lots",
        "That is not a memory limit. Use a size such as 512m or 1g.",
      ],
      [
        "web.image",
        "Not An Image",
        "That is not an image reference. Use one such as ghcr.io/acme/web:1.4.2.",
      ],
      [
        "web.start",
        "a && b",
        "That is not a start command zekno can run. It runs without a shell, so put ; & | < > ( ) $ and backquotes in quotes. To use a shell, start it with sh -c.",
      ],
      [
        "web.start",
        "echo 'it",
        "That is not a start command zekno can run. A quote does not close.",
      ],
      [
        "web.restart",
        "sometimes",
        "That is not a restart rule. Use no, on-failure or always.",
      ],
      [
        "web.cpus",
        "0",
        "That is not a processor limit. Use a number of processors, such as 0.5 or 2.",
      ],
      ["web.port", "0", "That is not a port. Use a port from 1 to 65535."],
      [
        "web.publish",
        "70000",
        "That is not a port. Use a port from 1 to 65535.",
      ],
      [
        "web.secrets",
        "PATH",
        "That is not a list of secret names. A secret name uses letters, digits and underscore, does not start with a digit, and is not one zekno keeps for itself.",
      ],
      [
        "web.plain.A",
        "a\nb",
        "That is not a value zekno can write. Use one line with no control character, at most 4096 characters.",
      ],
      [
        "web.volumes.data",
        "/srv:/data",
        "That is not a mount path. Use an absolute path in the container, such as /data.",
      ],
    ]
    for (const [path, value, refused] of cases)
      expect([path, refusal(DESIGN_SETTINGS, path, value)]).toEqual([
        path,
        { refused, status: 2 },
      ])
  })

  test("CS17: a value that breaks a rule across settings, with the schema's place and rule", () => {
    const published = change(DESIGN_SETTINGS, "web.publish", "80").settings
    expect(refusal(published, "web.port", undefined)).toEqual({
      refused:
        "That change cannot be written. web, networking.publish: set networking.port too, the port it reaches.",
      status: 2,
    })
    const workerPort = change(published, "worker.port", "3001").settings
    expect(refusal(workerPort, "worker.publish", "80")).toEqual({
      refused:
        "That change cannot be written. worker, networking.publish: web publishes the same port.",
      status: 2,
    })
    expect(refusal(published, "worker.publish", "8080")).toEqual({
      refused:
        "That change cannot be written. worker, networking.publish: set networking.port too, the port it reaches.",
      status: 2,
    })
    expect(refusal(DESIGN_SETTINGS, "web.plain.DATABASE_URL", "x")).toEqual({
      refused:
        "That change cannot be written. web, variables.plain.DATABASE_URL: it is a secret of web too. Keep it in one place.",
      status: 2,
    })
    expect(
      refusal(DESIGN_SETTINGS, "web.secrets", "DATABASE_URL, NODE_ENV")
    ).toEqual({
      refused:
        "That change cannot be written. web, variables.plain.NODE_ENV: it is a secret of web too. Keep it in one place.",
      status: 2,
    })
    expect(
      refusal(DESIGN_SETTINGS, "web.volumes.cache", "/data/uploads")
    ).toEqual({
      refused:
        "That change cannot be written. web, volumes: two volumes are mounted at the same path.",
      status: 2,
    })
    const many = Array.from({ length: 257 }, (_, at) => `S${at}`).join(",")
    expect(refusal(DESIGN_SETTINGS, "web.secrets", many)).toEqual({
      refused:
        "That change cannot be written. web, variables.secrets: at most 256 names.",
      status: 2,
    })
  })

  test("a change that would make the file larger than a settings file may be is refused, nothing half done", () => {
    let settings = DESIGN_SETTINGS
    let refused: { refused: string; status: number } | undefined
    for (let at = 0; at < 20 && refused === undefined; at++) {
      const got = applyChange(
        settings,
        { service: "web", key: "plain", name: `BIG${at}` },
        "x".repeat(4096)
      )
      if ("refused" in got) refused = got
      else settings = got.settings
    }
    expect(refused).toEqual({
      refused:
        "That change cannot be written. zekno.app.json is larger than the 64 KiB a settings file may be.",
      status: 2,
    })
  })
})

describe("how a value reads (contracts/commands.md and contracts/app-screen.md, Words)", () => {
  test("set values, and the words of a setting left out", () => {
    const read = (path: SettingPath) => shownValue(path, DESIGN_SETTINGS)
    expect(read({ service: "web", key: "memory" })).toBe("1g")
    expect(read({ service: "web", key: "restart" })).toBe("on failure")
    expect(read({ service: "worker", key: "restart" })).toBe("always")
    expect(read({ service: "worker", key: "memory" })).toBe("no limit")
    expect(read({ service: "worker", key: "cpus" })).toBe("no limit")
    expect(read({ service: "worker", key: "port" })).toBe("none")
    expect(read({ service: "web", key: "publish" })).toBe("not published")
    expect(read({ service: "web", key: "secrets" })).toBe(
      "DATABASE_URL, SESSION_KEY"
    )
    expect(read({ service: "web", key: "plain", name: "NODE_ENV" })).toBe(
      "production"
    )
    expect(read({ service: "web", key: "plain", name: "NOPE" })).toBe("none")
    expect(read({ service: "web", key: "volume", name: "uploads" })).toBe(
      "/data/uploads"
    )
    expect(read({ service: "web", key: "volume", name: "nope" })).toBe("none")
    expect(read({ service: "nope", key: "start" })).toBe("the image's own")
  })

  test("the labels and values of a change: 512m to 1g, 1g to no limit, on-failure reads on failure", () => {
    const at512 = change(DESIGN_SETTINGS, "web.memory", "512m")
    const to1g = change(at512.settings, "web.memory", "1g")
    expect([to1g.label, to1g.now, to1g.next]).toEqual([
      "memory limit",
      "512m",
      "1g",
    ])
    const unset = change(DESIGN_SETTINGS, "web.memory", undefined)
    expect([unset.label, unset.now, unset.next]).toEqual([
      "memory limit",
      "1g",
      "no limit",
    ])
    const restart = change(DESIGN_SETTINGS, "worker.restart", "on-failure")
    expect([restart.label, restart.now, restart.next]).toEqual([
      "restart rule",
      "always",
      "on failure",
    ])
    expect(change(DESIGN_SETTINGS, "web.plain.NODE_ENV", "").next).toBe('""')
    expect(change(DESIGN_SETTINGS, "web.volumes.uploads", "/x").label).toBe(
      "volume uploads"
    )
    expect(change(DESIGN_SETTINGS, "web.plain.NODE_ENV", "x").label).toBe(
      "NODE_ENV"
    )
  })

  test("a value is cleaned before it is shown", () => {
    // No file or change can hold U+202E any more (security review S2); settings made in memory still never draw it.
    const settings: Settings = {
      version: 1,
      services: [["web", { image: "nginx:1.27", plain: [["X", "a\u202eb"]] }]],
    }
    expect(
      shownValue({ service: "web", key: "plain", name: "X" }, settings)
    ).toBe("ab")
    expect(refusal(DESIGN_SETTINGS, "web.plain.X", "a\u202eb")).toEqual({
      refused:
        "That is not a value zekno can write. Use no invisible character, such as a zero-width space or a right-to-left mark.",
      status: 2,
    })
  })
})
