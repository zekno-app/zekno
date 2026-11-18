/**
 * What this machine remembers of the server, and the chain of decision B
 * (specs/014-deploy-v2, contracts/cli.md CL3b and CL21; research R9; spec
 * FR-028; tasks T078, T080). Each version-2 deploy keeps, right after it
 * read the server, the statements and versions the server said it holds
 * (`held/<serverId>/<app>.json`), before anything can stop it. When a
 * deploy stops because the server holds a secret this machine cannot account
 * for (C5) or a newer one than this machine set (C5b), `zekno secret set` and
 * `zekno secret rm` then take their version above what the server reported,
 * without connecting, and the next deploy goes through.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { recordFiles } from "../../../runner/test/support/deploy-v2"
import { C5, C5b } from "../../src/shared/deploy-words"
import {
  heldOf,
  historyOf,
  payloadOf,
  stateBytes,
  stateOf,
} from "../support/deploys"
import { COMPOSE_V1, ready, twin } from "../support/helpers"
import { asReleased } from "../support/older-runner"
import { wire } from "../support/wire"

type Machine = Awaited<ReturnType<typeof ready>>

const where = ["--app", "web", "--server", "dev"]

/** `zekno secret <args>` with `deps.connect` made to throw: these commands never connect (decision B). */
async function offline(m: Machine, ...args: string[]): Promise<number> {
  const connect = m.deps.connect
  m.deps.connect = () => {
    throw new Error("`zekno secret` tried to connect")
  }
  try {
    return await m.zekno("secret", ...args)
  } finally {
    m.deps.connect = connect
  }
}

async function set(m: Machine, name: string, value: string) {
  m.typing(value)
  expect(await offline(m, "set", name, ...where)).toBe(0)
}

/** The text of every file under this machine's `held/` folder. */
function heldText(m: Machine): string {
  const dir = join(m.home, "held")
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((path) => join(dir, path))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
}

const VALUES = {
  API_KEY: "key-held-7c3e",
  DATABASE_URL: "postgres://held-7c3e",
  GREETING: "hello-held-7c3e",
}

describe("CL3b: a version-2 deploy remembers what the server said", () => {
  test("after a deploy that read three secrets on the server: their statements and versions, and no value", async () => {
    const m = await ready()
    for (const [name, value] of Object.entries(VALUES))
      await set(m, name, value)
    const w = wire(m.deps)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    // The first deploy read a server that held nothing for web yet.
    expect(heldOf(m, "web")).toEqual({ statements: [], versions: [] })
    expect(await m.zekno("deploy", ...where)).toBe(0)

    const [, second] = w.requests("records")
    expect(second).toEqual({ command: "records", input: { app: "web" } })
    const held = heldOf(m, "web")!
    expect(
      held.statements.map((statement) => payloadOf(statement).name)
    ).toEqual(["API_KEY", "DATABASE_URL", "GREETING"])
    // Exactly the statements the server answered with.
    const answered = historyOf(m, "web")
      .map((entry) => payloadOf(entry.envelope).secrets)
      .at(0) as { name: string; hash: string }[]
    expect(
      held.statements.map((statement) => payloadOf(statement).hash)
    ).toEqual(answered.map((secret) => secret.hash))
    expect(held.versions).toEqual([
      { name: "API_KEY", version: 1, removed: false },
      { name: "DATABASE_URL", version: 1, removed: false },
      { name: "GREETING", version: 1, removed: false },
    ])
    const text = heldText(m)
    for (const value of Object.values(VALUES)) {
      expect(text).not.toContain(value)
      expect(text).not.toContain(Buffer.from(value).toString("base64url"))
    }
  })

  test("after `zekno secret rm` and the deploys that carry it and follow it: two statements, and the removed name's version marked removed", async () => {
    const m = await ready()
    for (const [name, value] of Object.entries(VALUES))
      await set(m, name, value)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await offline(m, "rm", "API_KEY", ...where)).toBe(0)
    // The deploy that carries the removal read the server before it: three statements still.
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(heldOf(m, "web")!.statements).toHaveLength(3)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const held = heldOf(m, "web")!
    expect(
      held.statements.map((statement) => payloadOf(statement).name)
    ).toEqual(["DATABASE_URL", "GREETING"])
    expect(held.versions).toEqual([
      { name: "API_KEY", version: 2, removed: true },
      { name: "DATABASE_URL", version: 1, removed: false },
      { name: "GREETING", version: 1, removed: false },
    ])
  })

  test("a version-1 deploy leaves it as it was; a deploy that stops with C5 has written it before stopping", async () => {
    const m = await ready()
    await set(m, "GREETING", VALUES.GREETING)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    // What the server held before this machine's first deploy of web: nothing.
    const written = heldOf(m, "web")
    expect(written).toEqual({ statements: [], versions: [] })
    // The runner as runner 0.1.0 keeps it: this zekno deploys in version 1, which reads no statement and keeps nothing.
    const today = asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(heldOf(m, "web")).toEqual(written)
    today()

    // A second machine without the record: its deploy stops with C5, after it kept what the server said.
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    expect(await other.zekno("deploy", ...where)).toBe(1)
    expect(other.lastErr()).toBe(C5("GREETING", "web", "dev"))
    expect(historyOf(other, "web")).toEqual([])
    expect(heldOf(other, "web")).toEqual({
      statements: [],
      versions: [{ name: "GREETING", version: 1, removed: false }],
    })
  })
})

describe("CL21, the chain: set or rm, offline, then the deploy goes through", () => {
  /**
   * An app deployed in version 1 only, with GREETING at version 2, then held
   * by this runner; a second machine without its records, whose deploy
   * stopped with C5 and so remembers what the server holds.
   */
  async function versionOneSecret() {
    const m = await ready()
    await set(m, "GREETING", "first")
    await set(m, "GREETING", "second")
    const today = asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    today()
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    const state = stateBytes(m)
    expect(await other.zekno("deploy", ...where)).toBe(1)
    expect(other.lastErr()).toBe(C5("GREETING", "web", "dev"))
    expect(historyOf(other, "web")).toEqual([])
    expect(stateBytes(m)).toBe(state)
    return { m, other }
  }

  test("(a) C5: `zekno secret set` on the second machine signs a version above the server's, and its next deploy supplies it", async () => {
    const { m, other } = await versionOneSecret()
    other.typing("third")
    expect(await offline(other, "set", "GREETING", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Set GREETING (version 3) for web on dev. It takes effect on the next deploy."
    )
    const w = wire(other.deps)
    expect(await other.zekno("deploy", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Deploy 3 of web is running on dev with 1 secret."
    )
    const [sent] = w.requests("deploy") as {
      input: { records: { sealed: { name: string } }[] }
    }[]
    expect(sent!.input.records.map((record) => record.sealed.name)).toEqual([
      "GREETING",
    ])
    expect(stateOf(m).secrets["web/GREETING"]!.version).toBe(3)
    expect(other.docker.calls().at(-1)!.env.GREETING).toBe("third")
  })

  test("(a) C5: `zekno secret rm` on the second machine removes it above the server's version, and the next deploy lists the removal", async () => {
    const { m, other } = await versionOneSecret()
    expect(await offline(other, "rm", "GREETING", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Removed GREETING from web on dev. It takes effect on the next deploy."
    )
    expect(await other.zekno("deploy", ...where)).toBe(0)
    expect(other.lastOut()).toBe(
      "Deploy 3 of web is running on dev with no secrets."
    )
    expect(payloadOf(historyOf(other, "web").at(-1)!.envelope)).toMatchObject({
      secrets: [],
      removed: [{ name: "GREETING", version: 3 }],
    })
    expect(stateOf(m).secrets["web/GREETING"]).toEqual({
      version: 3,
      hash: null,
    })
  })

  /**
   * GREETING at version 2 set and deployed here; a second machine deploys
   * from the server's record, sets it again (version 3) and deploys; this
   * machine, still holding version 2, then deploys: C5b.
   */
  async function newerOnServer() {
    const m = await ready()
    await set(m, "GREETING", "first")
    await set(m, "GREETING", "second")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    const other = await twin(m)
    other.compose(COMPOSE_V1)
    expect(await other.zekno("deploy", ...where)).toBe(0)
    other.typing("third")
    expect(await offline(other, "set", "GREETING", ...where)).toBe(0)
    expect(other.lastOut()).toContain("(version 3)")
    expect(await other.zekno("deploy", ...where)).toBe(0)
    expect(stateOf(m).secrets["web/GREETING"]!.version).toBe(3)

    const history = historyOf(m, "web")
    const state = stateBytes(m)
    const records = recordFiles(m.runnerHome)
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toBe(C5b("GREETING", "web", "dev"))
    expect(historyOf(m, "web")).toEqual(history)
    expect(stateBytes(m)).toBe(state)
    expect(recordFiles(m.runnerHome)).toEqual(records)
    return m
  }

  test("(b) C5b: `zekno secret set` gives version 4, offline, and the deploy goes through", async () => {
    const m = await newerOnServer()
    m.typing("fourth")
    expect(await offline(m, "set", "GREETING", ...where)).toBe(0)
    expect(m.lastOut()).toBe(
      "Set GREETING (version 4) for web on dev. It takes effect on the next deploy."
    )
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toBe("Deploy 4 of web is running on dev with 1 secret.")
    expect(stateOf(m).secrets["web/GREETING"]!.version).toBe(4)
    expect(m.docker.calls().at(-1)!.env.GREETING).toBe("fourth")
  })

  test("(b) C5b: `zekno secret rm` removes it at version 4, offline, and the deploy lists the removal", async () => {
    const m = await newerOnServer()
    expect(await offline(m, "rm", "GREETING", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(payloadOf(historyOf(m, "web").at(-1)!.envelope)).toMatchObject({
      secrets: [],
      removed: [{ name: "GREETING", version: 4 }],
    })
    expect(stateOf(m).secrets["web/GREETING"]).toEqual({
      version: 4,
      hash: null,
    })
  })
})
