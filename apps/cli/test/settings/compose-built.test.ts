/**
 * The Compose text of a built service (specs/016-build-from-source,
 * contracts/cli.md CL1, "The Compose text"; data-model.md, "The Compose text
 * of a built service"; FR-072a, FR-077; tasks T113): the image the deploy
 * names, `pull_policy: "never"`, `PORT` when it has a port and sets none; a
 * service that runs an image written byte for byte as before; the text in
 * zekno's form; and read back with the history's builds.
 */
import { describe, expect, test } from "bun:test"
import { builtImageName, type Build } from "@workspace/core"

import { inSettingsForm } from "../../src/project/compose-file"
import { composeText, deployedSettings } from "../../src/settings/compose"
import type { ServiceSettings, Settings } from "../../src/settings/types"
import { DESIGN_COMPOSE, DESIGN_SETTINGS } from "../support/settings-files"

const KEY = "0123456789abcdef".repeat(4)
const IMAGE = builtImageName("shop", KEY)
const one = (web: ServiceSettings): Settings => ({
  version: 1,
  services: [["web", web]],
})
const built = (more: Partial<ServiceSettings> = {}): ServiceSettings => ({
  build: { builder: "dockerfile" },
  ...more,
})
const images = new Map([["web", IMAGE]])

/** The build this machine's history keeps under KEY. */
const BUILD: Build = {
  key: KEY,
  pack: { hash: "1".repeat(64), size: 1, chunks: ["2".repeat(64)] },
  builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
  args: [],
  secrets: [],
  network: "default",
  timeout: 1800,
  fresh: null,
}

describe("composeText: a built service (G22)", () => {
  test("the image the deploy names, pull_policy never, and PORT for its port", () => {
    expect(composeText(one(built({ port: 3000 })), images)).toBe(
      [
        "services:",
        '  "web":',
        `    image: "zekno.invalid/shop:${KEY}"`,
        '    pull_policy: "never"',
        '    expose: ["3000"]',
        "    environment:",
        '      "PORT": "3000"',
        "",
      ].join("\n")
    )
  })

  test("PORT after the service's own variables; none when it sets PORT, as a plain variable or a secret, or has no port", () => {
    const text = composeText(
      one(
        built({
          port: 3000,
          publish: 8080,
          secrets: ["DATABASE_URL"],
          plain: [["NODE_ENV", "production"]],
        })
      ),
      images
    )
    expect(text.split("\n").slice(4)).toEqual([
      '    ports: ["8080:3000"]',
      "    environment:",
      '      "DATABASE_URL": "${DATABASE_URL}"',
      '      "NODE_ENV": "production"',
      '      "PORT": "3000"',
      "",
    ])
    for (const service of [
      built({ port: 3000, plain: [["PORT", "8000"]] }),
      built({ port: 3000, secrets: ["PORT"] }),
      built(),
    ]) {
      const lines = composeText(one(service), images).split("\n")
      expect(lines.filter((line) => line.includes('"PORT"')).length).toBe(
        service.plain || service.secrets ? 1 : 0
      )
      expect(lines.filter((line) => line.includes('"3000"'))).not.toContain(
        '      "PORT": "3000"'
      )
    }
  })

  test("every built name stands after a quote, as core's rule of the text asks (CO2)", () => {
    const text = composeText(one(built({ port: 3000 })), images)
    for (const found of text.matchAll(/zekno\.invalid\//g))
      expect(text[found.index - 1]).toBe('"')
  })

  test("a built service whose name the deploy did not give is a fault of this program, never a name made up", () => {
    expect(() => composeText(one(built()))).toThrow(Error)
  })

  test("a service that runs an image is written byte for byte as before, whatever map is given", () => {
    expect(composeText(DESIGN_SETTINGS)).toBe(DESIGN_COMPOSE)
    expect(composeText(DESIGN_SETTINGS, new Map([["web", IMAGE]]))).toBe(
      DESIGN_COMPOSE
    )
  })

  test("the text is in zekno's settings form: `pull_policy` is one of its lines", () => {
    const text = composeText(
      {
        version: 1,
        services: [
          ["web", built({ port: 3000, plain: [["STARS", "*a *b *c"]] })],
          ["db", { image: "postgres:16" }],
        ],
      },
      images
    )
    expect(inSettingsForm(text)).toBe(true)
    expect(inSettingsForm(text.replace('"never"', '"always"'))).toBe(false)
  })
})

describe("deployedSettings: a built service read back with the history's builds", () => {
  test("the build of the key in its image's name, as signed; PORT given by zekno is no setting", () => {
    const settings = one(built({ port: 3000 }))
    expect(deployedSettings(composeText(settings, images), [BUILD])).toEqual(
      one({
        build: {
          builder: "dockerfile",
          dockerfile: "Dockerfile",
          timeout: 1800,
          network: "internet",
        },
        port: 3000,
      })
    )
  })

  test("a stage and no network, and a PORT the service sets itself, read back", () => {
    const settings = one(built({ port: 3000, plain: [["PORT", "8000"]] }))
    const build: Build = {
      ...BUILD,
      builder: {
        name: "dockerfile",
        dockerfile: "web.Dockerfile",
        target: "runner",
      },
      network: "none",
      timeout: 60,
    }
    expect(deployedSettings(composeText(settings, images), [build])).toEqual(
      one({
        build: {
          builder: "dockerfile",
          dockerfile: "web.Dockerfile",
          stage: "runner",
          timeout: 60,
          network: "none",
        },
        port: 3000,
        plain: [["PORT", "8000"]],
      })
    )
  })

  test("without the build of its key, the text is not read back", () => {
    const text = composeText(one(built()), images)
    expect(deployedSettings(text)).toBeUndefined()
    expect(
      deployedSettings(text, [{ ...BUILD, key: "f".repeat(64) }])
    ).toBeUndefined()
    expect(
      deployedSettings(text.replace('"never"', '"always"'), [BUILD])
    ).toBeUndefined()
  })

  test("a deploy of services that run images reads back as before", () => {
    expect(deployedSettings(DESIGN_COMPOSE)).toEqual(DESIGN_SETTINGS)
  })
})
