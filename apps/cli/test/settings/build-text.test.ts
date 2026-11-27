/**
 * The Build section written and read back (specs/016-build-from-source,
 * contracts/cli.md CL1, "Rows"; FR-011; tasks T115): `source.root`,
 * `source.include` and `build` in a fixed order, read back equal, checked
 * by the write's read-back, one line a setting when piped (G11), and the
 * same facts with `--json`, which is the file's own data.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "../../src/cli/errors"
import { readSettingsFile } from "../../src/settings/file"
import { pipedLines } from "../../src/settings/piped"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { writeSettings } from "../../src/settings/write"

const FILE = "zekno.app.json"

/** data-model.md's example, step 1's fields. */
const WEB: ServiceSettings = {
  root: ".",
  include: ["certs/server.key"],
  build: {
    builder: "dockerfile",
    dockerfile: "Dockerfile",
    stage: "runner",
    timeout: 3600,
    network: "internet",
  },
  port: 3000,
}

const app = (...services: [string, ServiceSettings][]): Settings => ({
  version: 1,
  services,
})

describe("settingsText: the Build section in a fixed order", () => {
  test("source's image, root and files to include, then build's builder, Dockerfile, stage, time limit and network, before deploy", () => {
    expect(settingsText(app(["web", WEB]))).toBe(`{
  "zekno": 1,
  "services": {
    "web": {
      "source": { "root": ".", "include": ["certs/server.key"] },
      "build": {
        "builder": "dockerfile",
        "dockerfile": "Dockerfile",
        "stage": "runner",
        "timeout": 3600,
        "network": "internet"
      },
      "networking": { "port": 3000 }
    }
  }
}
`)
  })

  test("only what is set: a build of its builder alone, and no source at all", () => {
    expect(settingsText(app(["web", { build: { builder: "dockerfile" } }])))
      .toBe(`{
  "zekno": 1,
  "services": {
    "web": {
      "build": { "builder": "dockerfile" }
    }
  }
}
`)
  })

  test("written then read back equal, every field and every mix of them", () => {
    const many: ServiceSettings[] = [
      WEB,
      { build: { builder: "dockerfile" } },
      { root: "../..", build: { builder: "dockerfile", timeout: 90 } },
      {
        include: [".env", ".git/config"],
        build: { builder: "dockerfile", network: "none" },
      },
      {
        build: { builder: "dockerfile", stage: "build-1.2_x" },
        start: "bun run start",
        memory: "1g",
      },
    ]
    for (const service of many) {
      const settings = app(["web", service], ["db", { image: "postgres:16" }])
      expect(checkSettings(settingsText(settings), FILE)).toEqual(settings)
    }
  })

  test("a service that runs an image is written as before: no build, root or include key", () => {
    const text = settingsText(app(["web", { image: "nginx:1.27" }]))
    for (const key of ['"build"', '"root"', '"include"'])
      expect(text).not.toContain(key)
  })

  test("`--json` is the file's own data: the same facts", () => {
    expect(JSON.parse(settingsText(app(["web", WEB])))).toEqual({
      zekno: 1,
      services: {
        web: {
          source: { root: ".", include: ["certs/server.key"] },
          build: {
            builder: "dockerfile",
            dockerfile: "Dockerfile",
            stage: "runner",
            timeout: 3600,
            network: "internet",
          },
          networking: { port: 3000 },
        },
      },
    })
  })
})

describe("writeSettings: the read-back check sees the Build section", () => {
  let folder: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "zekno-build-text-"))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  test("a written build reads back whole; a text that drops a field of it is refused and nothing is written", () => {
    const before = settingsText(
      app(["web", { build: { builder: "dockerfile" } }])
    )
    writeFileSync(join(folder, FILE), before)
    const read = readSettingsFile({ kind: "default", folder }, folder)
    const next = app(["web", WEB])
    for (const [from, to] of [
      ['        "stage": "runner",\n', ""],
      ['"certs/server.key"', '"other.key"'],
      ['"root": ".", ', ""],
    ]) {
      const broken = (settings: Settings) =>
        settingsText(settings).replace(from!, to!)
      expect(() => writeSettings(read, next, { text: broken })).toThrow(
        CliError
      )
      expect(readFileSync(join(folder, FILE), "utf8")).toBe(before)
    }
    writeSettings(read, next)
    expect(
      readSettingsFile({ kind: "default", folder }, folder).settings
    ).toEqual(next)
  })
})

describe("pipedLines: one line a setting (G11)", () => {
  test("`<service><TAB><key><TAB><value>`, as the file holds each, in the file's order", () => {
    expect(
      pipedLines(app(["web", WEB], ["db", { image: "postgres:16" }])).map(
        (line) => line.join("\t")
      )
    ).toEqual([
      "web\tsource.root\t.",
      "web\tsource.include\tcerts/server.key",
      "web\tbuild.builder\tdockerfile",
      "web\tbuild.dockerfile\tDockerfile",
      "web\tbuild.stage\trunner",
      "web\tbuild.timeout\t3600",
      "web\tbuild.network\tinternet",
      "web\tnetworking.port\t3000",
      "db\tsource.image\tpostgres:16",
    ])
  })

  test("only the settings that are set; files to include joined with `,`, as secrets are", () => {
    expect(
      pipedLines(
        app([
          "web",
          {
            include: [".env", "certs/a.key"],
            build: { builder: "dockerfile" },
          },
        ])
      ).map((line) => line.join("\t"))
    ).toEqual([
      "web\tsource.include\t.env,certs/a.key",
      "web\tbuild.builder\tdockerfile",
    ])
  })
})
