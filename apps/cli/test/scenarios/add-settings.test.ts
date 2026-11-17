/**
 * User Story 1 of specs/012-templates end to end, against the local runner
 * and the stand-in Docker, with no terminal (tasks T030): `zekno add postgres`
 * writes the service into the settings file and stores its secrets; `zekno
 * settings compose` prints what the next deploy signs, the text `composeText`
 * makes of the file (FR-020, SC-003); that deploy starts the database with
 * both secrets in Docker's environment and in no Compose text; a second add
 * is refused; templates come only from the CLI (FR-001); and a folder whose
 * zekno.json names another settings file gets the service in that file.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { readSignedDeploy } from "@workspace/core"
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { openTeam } from "../../src/cli/context"
import { listSecrets } from "../../src/ops/secret"
import { composeText } from "../../src/settings/compose"
import { checkSettings } from "../../src/settings/schema"
import type { Settings } from "../../src/settings/types"
import { AD5, AD6 } from "../../src/templates/add-words"
import { BEFORE_FILE } from "../support/add-files"
import { machine, ready } from "../support/helpers"
import { fileOf, ROOT, runs, SUB, subFolder } from "../support/settings-places"
import { FIRST_SET } from "../support/template-files"

type Machine = ReturnType<typeof machine>

const WHERE = ["--app", "demo", "--server", "dev"]

let m: Machine
beforeAll(async () => {
  m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), BEFORE_FILE)
}, 60_000)

/** Runs `zekno <args>` on `on` with the plain interface: its status and what it wrote on each stream. */
async function on(machine: Machine, ...args: string[]) {
  machine.out.length = 0
  machine.err.length = 0
  const code = await machine.zekno(...args)
  return { code, out: [...machine.out], err: [...machine.err] }
}

/** Runs `zekno <args>` with the plain interface: its status and what it wrote on each stream. */
const piped = (...args: string[]) => on(m, ...args)

/** The Compose text of each deploy of `app` `machine` signed, oldest first, read from under its signature. */
async function signed(app = "demo", machine = m): Promise<string[]> {
  const team = await openTeam(machine.deps)
  const server = team.profile.servers[0]!
  return team.store.history(server.serverId, app).map((entry) => {
    const read = readSignedDeploy({
      envelope: entry.envelope,
      trust: team.trust,
    })
    if (!read.ok) throw new Error("a history entry did not verify")
    return read.value.deploy.compose
  })
}

/** The settings file of a folder, read back. */
const settingsOf = (path: string): Settings =>
  checkSettings(readFileSync(path, "utf8"), "zekno.app.json") as Settings

describe("zekno add postgres, then a deploy (US1)", () => {
  test("added, shown as the deploy signs it, deployed with both secrets in the environment and in no Compose text", async () => {
    // design.md's app, deployed once before its database.
    m.typing("a-session-key-value")
    expect((await piped("secret", "set", "SESSION_KEY", ...WHERE)).code).toBe(0)
    expect((await piped("deploy", ...WHERE)).code).toBe(0)

    // A postgres.json with another image in the folder and in the profile folder changes nothing (FR-001).
    const other = FIRST_SET.postgres!.replace(
      /postgres:18\.7@sha256:[0-9a-f]{64}/,
      `postgres:1.0@sha256:${"0".repeat(64)}`
    )
    writeFileSync(join(m.project, "postgres.json"), other)
    writeFileSync(join(m.home, "postgres.json"), other)

    expect(
      await piped("add", "postgres", "--yes", ...WHERE, "--for", "web")
    ).toEqual({
      code: 0,
      out: [
        "added\tpostgres\tzekno.app.json",
        "stored\tPOSTGRES_PASSWORD\t1",
        "stored\tDATABASE_URL\t1",
      ],
      err: [],
    })
    const settings = settingsOf(join(m.project, "zekno.app.json"))
    expect(settings.services.map(([name]) => name)).toEqual([
      "web",
      "worker",
      "postgres",
    ])
    expect(settings.services[2]![1].image).toBe(
      "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc"
    )

    // Both stored, version 1, not carried by the deploy before.
    const listed = await listSecrets(m.deps, { app: "demo", server: "dev" })
    expect(listed.secrets).toEqual([
      { name: "DATABASE_URL", version: 1, notDeployed: true },
      { name: "POSTGRES_PASSWORD", version: 1, notDeployed: true },
      { name: "SESSION_KEY", version: 1, notDeployed: false },
    ])
    expect((await piped("secret", "ls", ...WHERE)).out).toEqual([
      "DATABASE_URL\tversion 1",
      "POSTGRES_PASSWORD\tversion 1",
      "SESSION_KEY\tversion 1",
    ])

    // What zekno settings compose prints is what the next deploy signs, and composeText of the file (FR-020, SC-003).
    const shown = await piped("settings", "compose")
    expect(shown.code).toBe(0)
    const text = `${shown.out.join("\n")}\n`
    expect(text).toBe(composeText(settings))
    expect((await piped("deploy", ...WHERE)).code).toBe(0)
    expect((await signed()).at(-1)).toBe(text)

    // The stand-in Docker started zekno-demo with both secrets in its environment; no Compose text holds a value.
    const call = m.docker.calls().at(-1)!
    expect(call.args).toContain("zekno-demo")
    const password = call.env.POSTGRES_PASSWORD!
    expect(password).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(call.env.DATABASE_URL).toBe(
      `postgres://app:${password}@postgres:5432/app`
    )
    const args = call.args.split(" ")
    const sent = readFileSync(args[args.indexOf("-f") + 1]!, "utf8")
    for (const compose of [text, sent, ...(await signed())])
      expect(compose).not.toContain(password)
    expect(sent).toContain("${POSTGRES_PASSWORD}")
    expect(sent).toContain("${DATABASE_URL}")
    expect(
      readFileSync(join(m.project, "zekno.app.json"), "utf8")
    ).not.toContain(password)
  })

  test("a second zekno add postgres: AD5 for the secret the app has now, also with --name db (the store before the names: contracts/commands.md, 'The order of checks', steps 8 and 9); for another app, AD6 for the service", async () => {
    for (const name of [[], ["--name", "db"]])
      expect(
        await piped("add", "postgres", ...name, "--yes", ...WHERE)
      ).toEqual({
        code: 2,
        out: [],
        err: [AD5("demo", "POSTGRES_PASSWORD")],
      })
    expect(
      await piped(
        "add",
        "postgres",
        "--yes",
        "--app",
        "elsewhere",
        "--server",
        "dev"
      )
    ).toEqual({
      code: 2,
      out: [],
      err: [AD6("zekno.app.json", "postgres")],
    })
  })
})

describe("a folder whose zekno.json, signed and in use, names deploy/zekno.app.json", () => {
  test("that file gains the service, and the result line names it; the folder's own file is left as it was", async () => {
    const folder = join(realpathSync(m.project), "linked")
    mkdirSync(join(folder, "deploy"), { recursive: true })
    writeFileSync(join(folder, "deploy", "zekno.app.json"), BEFORE_FILE)
    m.deps.cwd = folder
    try {
      expect(
        (
          await piped(
            "link",
            "--app",
            "other",
            "--server",
            "dev",
            "-f",
            "deploy/zekno.app.json"
          )
        ).code
      ).toBe(0)
      const own = BEFORE_FILE.replace("1g", "2g")
      writeFileSync(join(folder, "zekno.app.json"), own)
      expect(await piped("add", "redis", "--yes", "--for", "worker")).toEqual({
        code: 0,
        out: [
          "added\tredis\tdeploy/zekno.app.json",
          "stored\tREDIS_PASSWORD\t1",
          "stored\tREDIS_URL\t1",
        ],
        err: [],
      })
      expect(
        settingsOf(join(folder, "deploy", "zekno.app.json")).services.map(
          ([name]) => name
        )
      ).toEqual(["web", "worker", "redis"])
      expect(readFileSync(join(folder, "zekno.app.json"), "utf8")).toBe(own)
      const listed = await listSecrets(m.deps, { app: "other", server: "dev" })
      expect(listed.secrets.map((secret) => secret.name)).toEqual([
        "REDIS_PASSWORD",
        "REDIS_URL",
      ])
    } finally {
      m.deps.cwd = m.project
    }
  })
})

describe("--app another app below a zekno.json in use (security review T2)", () => {
  test("the folder's own file gains the service, the one zekno deploy --app signs there; the link's file and app are left as they were", async () => {
    const { m: sub, signedFile, ownFile } = await subFolder()
    expect(
      await on(
        sub,
        "add",
        "postgres",
        "--yes",
        "--app",
        "billing",
        "--server",
        "dev"
      )
    ).toEqual({
      code: 0,
      out: [
        "added\tpostgres\tzekno.app.json",
        "stored\tPOSTGRES_PASSWORD\t1",
        "stored\tDATABASE_URL\t1",
      ],
      err: [],
    })
    expect(readFileSync(signedFile, "utf8")).toBe(fileOf(ROOT))
    const own = settingsOf(ownFile)
    expect(own.services.map(([name]) => name)).toEqual(["web", "postgres"])
    expect(own.services[0]).toEqual([
      "web",
      { ...runs(SUB).services[0]![1], secrets: ["DATABASE_URL"] },
    ])
    const billing = await listSecrets(sub.deps, {
      app: "billing",
      server: "dev",
    })
    expect(billing.secrets.map((secret) => secret.name)).toEqual([
      "DATABASE_URL",
      "POSTGRES_PASSWORD",
    ])
    expect(
      (await on(sub, "deploy", "--app", "billing", "--server", "dev")).code
    ).toBe(0)
    expect((await signed("billing", sub)).at(-1)).toBe(composeText(own))
  }, 60_000)
})
