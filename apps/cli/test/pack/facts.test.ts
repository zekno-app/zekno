/**
 * The summary's facts, from one pure function (specs/016-build-from-source,
 * contracts/cli.md CL5, "Facts" and "Builds again because"; FR-017, FR-072
 * to FR-072c; tasks T125). The values are lines.md's examples: the app
 * `shop` on `prod-1`, `web` and `worker` built from one Dockerfile, 1,204
 * files and 18 MB sent. No sentence is checked: each fact is checked by its
 * id and values.
 */
import { describe, expect, test } from "bun:test"

import type { Build } from "@workspace/core"

import { factsOf, type FactsBuild, type FactsInput } from "../../src/pack/facts"
import type { HistoryBuild } from "../../src/shared/history"

const MB = 1000 * 1000

/** The build of `web` and `worker` in lines.md's example. */
const shopBuild: FactsBuild = {
  services: ["web", "worker"],
  dockerfile: "Dockerfile",
  network: "internet",
  args: [{ name: "API_URL", value: "https://api.shop.example.com" }],
  notGiven: [],
  onlyApp: [
    {
      service: "web",
      names: ["NODE_ENV", "PORT", "DATABASE_URL", "SESSION_KEY"],
    },
    { service: "worker", names: ["DATABASE_URL"] },
  ],
  unpinned: ["node:22-slim"],
}

/** lines.md's example deploy, at the first deploy from the folder on this machine. */
const example: FactsInput = {
  server: "prod-1",
  app: "shop",
  file: "zekno.app.json",
  above: null,
  walk: {
    ignoreFile: ".dockerignore",
    leftOut: [
      { rule: "ignore_file", path: "node_modules", folder: true },
      { rule: "ignore_file", path: ".next", folder: true },
      { rule: "zekno", path: ".git", why: "git" },
      { rule: "secret_looking", path: ".env", kind: "secrets", named: null },
      {
        rule: "secret_looking",
        path: ".env.local",
        kind: "secrets",
        named: null,
      },
      { rule: "link", path: "assets/shared", out: true },
      {
        rule: "secret_looking",
        path: "certs/server.key",
        kind: "private_key",
        named: null,
      },
    ],
    secretsSent: [],
  },
  limits: {
    bytes: 18 * MB,
    entries: 1_290,
    files: 1_204,
    largest: [
      { folder: "src", bytes: 9 * MB },
      { folder: "public", bytes: 6 * MB },
      { folder: "prisma", bytes: 1 * MB },
    ],
    mostEntries: [],
  },
  builds: [shopBuild],
  port: [{ service: "web", port: 3000 }],
  uncommitted: false,
  fresh: false,
  history: undefined,
  earlier: null,
}

const ids = (lines: readonly { id: string }[]) => lines.map((line) => line.id)

describe("lines.md's example (CL5)", () => {
  const facts = factsOf(example)

  test("the block's rows: B1, B3 with 1,204 files and 18 MB, B4, B5's four groups, B9 with one build for web and worker, B10 with API_URL", () => {
    expect(facts.rows).toEqual([
      { id: "B1", server: "prod-1" },
      { id: "B3", files: 1_204, bytes: 18 * MB },
      {
        id: "B4",
        largest: [
          { folder: "src", bytes: 9 * MB },
          { folder: "public", bytes: 6 * MB },
          { folder: "prisma", bytes: 1 * MB },
        ],
      },
      {
        id: "B5",
        ignoreFile: ".dockerignore",
        groups: [
          { rule: "ignore_file", paths: ["node_modules", ".next"] },
          { rule: "zekno", paths: [".git"] },
          {
            rule: "secret_looking",
            paths: [".env", ".env.local", "certs/server.key"],
          },
          { rule: "link", paths: ["assets/shared"] },
        ],
      },
      {
        id: "B9",
        builds: [{ services: ["web", "worker"], dockerfile: "Dockerfile" }],
      },
      { id: "B10", reads: [{ service: "web", names: ["API_URL"] }] },
    ])
  })

  test("the warnings, every time: B14 for a base image without a digest", () => {
    expect(facts.warnings).toEqual([
      { id: "B14", service: "web", image: "node:22-slim" },
    ])
  })

  test("the notes at a first deploy: B7 for each .env, B8, B11, B20 for each service, B21", () => {
    expect(facts.notes).toEqual([
      { id: "B7", path: ".env" },
      { id: "B7", path: ".env.local" },
      {
        id: "B8",
        path: "certs/server.key",
        service: "web",
        kind: "private_key",
      },
      { id: "B11", service: "web", port: 3000 },
      {
        id: "B20",
        service: "web",
        names: ["NODE_ENV", "PORT", "DATABASE_URL", "SESSION_KEY"],
      },
      { id: "B20", service: "worker", names: ["DATABASE_URL"] },
      { id: "B21" },
    ])
  })

  test("the panel's two rows: builds and sends (B28)", () => {
    expect(facts.panel).toEqual([
      {
        id: "B28",
        builds: [{ services: ["web", "worker"], dockerfile: "Dockerfile" }],
        files: 1_204,
        bytes: 18 * MB,
      },
    ])
  })
})

describe("which notes show again (choice B-a (b))", () => {
  const first = factsOf(example)

  test("at a second deploy with nothing changed: no B8, B20 or B21; B7 and B11 every time; rows and warnings as before", () => {
    const second = factsOf({ ...example, earlier: first.said })
    expect(ids(second.notes)).toEqual(["B7", "B7", "B11"])
    expect(second.rows).toEqual(first.rows)
    expect(second.warnings).toEqual(first.warnings)
    expect(second.panel).toEqual(first.panel)
  })

  test("B8 again for a secret-looking file left out that the last deploy did not leave out", () => {
    const second = factsOf({
      ...example,
      walk: {
        ...example.walk,
        leftOut: [
          ...example.walk.leftOut,
          {
            rule: "secret_looking",
            path: "id_rsa",
            kind: "private_key",
            named: null,
          },
        ],
      },
      earlier: first.said,
    })
    expect(second.notes.filter((line) => line.id === "B8")).toEqual([
      { id: "B8", path: "id_rsa", service: "web", kind: "private_key" },
    ])
  })

  test("B20 again for a service whose names that reach only the app changed", () => {
    const second = factsOf({
      ...example,
      builds: [
        {
          ...shopBuild,
          onlyApp: [
            shopBuild.onlyApp[0]!,
            { service: "worker", names: ["DATABASE_URL", "QUEUE_URL"] },
          ],
        },
      ],
      earlier: first.said,
    })
    expect(second.notes.filter((line) => line.id === "B20")).toEqual([
      { id: "B20", service: "worker", names: ["DATABASE_URL", "QUEUE_URL"] },
    ])
  })

  test("notes whose earlier words this machine did not keep are said again", () => {
    const second = factsOf({ ...example, earlier: { dockerfile: true } })
    expect(ids(second.notes)).toEqual(["B7", "B7", "B8", "B11", "B20", "B20"])
  })

  test("B21 again when the last deploy did not build from a Dockerfile", () => {
    const second = factsOf({
      ...example,
      earlier: { ...first.said, dockerfile: false },
    })
    expect(ids(second.notes)).toContain("B21")
  })

  test("a file named in source.include and not agreed to is the question's, not B7's or B8's", () => {
    const facts = factsOf({
      ...example,
      walk: {
        ...example.walk,
        leftOut: [
          {
            rule: "secret_looking",
            path: ".env",
            kind: "secrets",
            named: ".env",
          },
        ],
      },
    })
    expect(ids(facts.notes)).toEqual(["B11", "B20", "B20", "B21"])
  })
})

describe("the other rows, warnings and notes (CL5)", () => {
  test("B2 when the folder sent is above the settings file", () => {
    const facts = factsOf({ ...example, above: { root: "../..", top: true } })
    expect(facts.rows[0]).toEqual({
      id: "B2",
      server: "prod-1",
      root: "../..",
      top: true,
    })
  })

  test("B6 for the secret-looking files sent once agreed; no B4 or B5 with nothing to name", () => {
    const facts = factsOf({
      ...example,
      walk: {
        ignoreFile: null,
        leftOut: [],
        secretsSent: [
          {
            path: "certs/server.key",
            kind: "private_key",
            named: "certs/server.key",
          },
          { path: ".git", kind: "git", named: ".git" },
        ],
      },
      limits: { ...example.limits, largest: [] },
    })
    expect(ids(facts.rows)).toEqual(["B1", "B3", "B6", "B9", "B10"])
    expect(facts.rows[2]).toEqual({
      id: "B6",
      file: "zekno.app.json",
      paths: ["certs/server.key", ".git"],
    })
  })

  test("B9 and B10 with two recipes: one row a build", () => {
    const facts = factsOf({
      ...example,
      builds: [
        { ...shopBuild, services: ["web"] },
        {
          ...shopBuild,
          services: ["worker"],
          dockerfile: "docker/worker.Dockerfile",
          args: [],
          onlyApp: [],
        },
      ],
    })
    expect(facts.rows.find((line) => line.id === "B9")).toEqual({
      id: "B9",
      builds: [
        { services: ["web"], dockerfile: "Dockerfile" },
        { services: ["worker"], dockerfile: "docker/worker.Dockerfile" },
      ],
    })
    expect(facts.rows.find((line) => line.id === "B10")).toEqual({
      id: "B10",
      reads: [{ service: "web", names: ["API_URL"] }],
    })
  })

  test("no B10 when no build reads a plain variable", () => {
    const facts = factsOf({ ...example, builds: [{ ...shopBuild, args: [] }] })
    expect(ids(facts.rows)).not.toContain("B10")
  })

  test("the warnings B12, B13, B14, B16, B17, B18 and B30, in that order", () => {
    const facts = factsOf({
      ...example,
      limits: { ...example.limits, bytes: 184 * MB },
      uncommitted: true,
      builds: [
        {
          ...shopBuild,
          notGiven: [
            { name: "HTTP_PROXY", why: "builder" },
            { name: "DOCKER_HOST", why: "reserved" },
            { name: "SESSION_KEY", why: "secret" },
          ],
        },
      ],
      older: [{ service: "web", reported: 3, signed: 5 }],
    })
    expect(facts.warnings).toEqual([
      {
        id: "B12",
        bytes: 184 * MB,
        largest: [...example.limits.largest],
      },
      { id: "B13" },
      { id: "B14", service: "web", image: "node:22-slim" },
      { id: "B16", service: "web", name: "HTTP_PROXY" },
      { id: "B17", service: "web", name: "DOCKER_HOST" },
      { id: "B18", service: "web", name: "SESSION_KEY", app: "shop" },
      {
        id: "B30",
        server: "prod-1",
        service: "web",
        reported: 3,
        signed: 5,
      },
    ])
  })

  test("B22 for a build with no network, every time", () => {
    const first = factsOf({
      ...example,
      builds: [{ ...shopBuild, network: "none" }],
    })
    expect(first.notes).toContainEqual({ id: "B22", service: "web" })
    const second = factsOf({
      ...example,
      builds: [{ ...shopBuild, network: "none" }],
      earlier: first.said,
    })
    expect(ids(second.notes)).toEqual(["B7", "B7", "B11", "B22"])
  })

  test("--fresh: D13 a build in the notes, D12 in the panel", () => {
    const facts = factsOf({ ...example, fresh: true })
    expect(facts.notes.at(-1)).toEqual({ id: "D13", service: "web" })
    expect(ids(facts.panel)).toEqual(["D12", "B28"])
    expect(facts.panel[0]).toEqual({
      id: "D12",
      builds: [{ services: ["web", "worker"], dockerfile: "Dockerfile" }],
    })
  })
})

describe("builds again because (B23; FR-072c)", () => {
  const signed = (args: Build["args"]): HistoryBuild => ({
    services: ["web", "worker"],
    build: {
      key: "a".repeat(64),
      pack: { hash: "b".repeat(64), size: 2048, chunks: ["c".repeat(64)] },
      builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
      args,
      secrets: [],
      network: "default",
      timeout: 1800,
      fresh: null,
    },
  })

  test("a plain variable the build reads changed since the last deploy from this machine", () => {
    const facts = factsOf({
      ...example,
      history: [
        signed([{ name: "API_URL", value: "https://old.example.com" }]),
      ],
    })
    expect(facts.notes).toContainEqual({
      id: "B23",
      service: "web",
      name: "API_URL",
    })
  })

  test("a plain variable the build was not given before gives no reason: the variable or the Dockerfile may have changed, and zekno does not guess", () => {
    const facts = factsOf({ ...example, history: [signed([])] })
    expect(ids(facts.notes)).not.toContain("B23")
  })

  test("nothing changed, no reason; without that history, the reason is left out", () => {
    const same = factsOf({
      ...example,
      history: [
        signed([{ name: "API_URL", value: "https://api.shop.example.com" }]),
      ],
    })
    expect(ids(same.notes)).not.toContain("B23")
    expect(ids(factsOf(example).notes)).not.toContain("B23")
    // An earlier deploy that built nothing for these services gives no reason either.
    const none = factsOf({ ...example, history: [] })
    expect(ids(none.notes)).not.toContain("B23")
  })
})

describe("one pure function", () => {
  test("the same input gives the same facts, and the input is not changed", () => {
    const input = structuredClone(example)
    expect(factsOf(input)).toEqual(factsOf(example))
    expect(input).toEqual(example)
  })
})
