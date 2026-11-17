/**
 * Adding, whole or not at all (specs/012-templates, contracts/commands.md,
 * "Whole or not at all"; research R6 and R7; SC-002, SC-004; tasks T026):
 * the settings file written and every secret stored in one write, each
 * record sealed and signed with the value made; a failure injected at each
 * of steps a to f leaves the file and the store as they were (but the last,
 * which says what is left); no temporary file is left; and a made value is
 * nowhere but inside its sealed record: no line, error, file, argument or
 * console call holds it, as text or as base64.
 */
import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { verifySecret, type SecretRecord } from "@workspace/core"

import { decodeKey } from "../../../../packages/core/src/crypto/keys"
import { openSealedSecret } from "../../../../packages/core/src/secrets/secrets"
import { readKeys } from "../../../runner/src/home/home"
import { filesUnder, tempDir } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import type { OpDeps } from "../../src/cli/context"
import { commitAdd } from "../../src/ops/add-commit"
import { prepareAdd, summaryOf, type AddPlan } from "../../src/ops/add"
import { checkSettings } from "../../src/settings/schema"
import { settingsText } from "../../src/settings/text"
import { CS14 } from "../../src/settings/words"
import { AD19, AD20, AD21, AD8 } from "../../src/templates/add-words"
import { ALPHABET } from "../../src/templates/made"
import type { Template } from "../../src/templates/types"
import { BEFORE_FILE } from "../support/add-files"
import { answering, ready } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"

/** A made value nobody could guess and the tests can find: letters and digits only, as every made value is. */
const MARK = "zkSENTINEL9b41"
const PASSWORD = MARK.repeat(3).slice(0, 32)

/** A random source whose bytes `makePassword` turns into `PASSWORD`, for a password of up to 32 characters. */
const random = (bytes: Uint8Array) => {
  for (let at = 0; at < bytes.length; at++)
    bytes[at] = ALPHABET.indexOf(PASSWORD[at % PASSWORD.length]!)
}

/** The forms a value could take in a file or a line: as text, and inside base64 or base64url at each of the three alignments. */
function forms(text: string): string[] {
  const found = [text]
  for (const offset of [0, 1, 2]) {
    const encoded = Buffer.from(`${"\0".repeat(offset)}${text}`).toString(
      "base64"
    )
    const core = encoded.slice(
      4 * Math.ceil(offset / 3),
      4 * Math.floor((offset + text.length) / 3)
    )
    found.push(core, core.replace(/\+/g, "-").replace(/\//g, "_"))
  }
  return found
}
const FORMS = forms(MARK)
const holdsValue = (text: string) => FORMS.some((form) => text.includes(form))

let m: Awaited<ReturnType<typeof ready>>
let serverId: string
beforeAll(async () => {
  m = await ready()
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** The app's secret store file, and its folder. */
const storeOf = (app: string) =>
  join(m.home, "secrets", serverId, `${app}.json`)

/** Runs `zekno <args>` on the team's machine; fails the test when it fails. */
async function zekno(...args: string[]) {
  if ((await m.zekno(...args)) !== 0) throw new Error(m.lastErr())
}

/** A folder holding `BEFORE_FILE`, and the plan to add `template` to app `app` there, read by web. */
async function planned(
  app: string,
  template: Template = FIRST_TEMPLATES.postgres!
) {
  const cwd = tempDir("add-commit")
  writeFileSync(join(cwd, "zekno.app.json"), BEFORE_FILE)
  const deps: OpDeps = { ...m.deps, cwd }
  const plan = await prepareAdd(deps, {
    template,
    for: ["web"],
    where: { app, server: "dev" },
  })
  if (!("addition" in plan)) throw new Error("a question")
  return { cwd, plan }
}

/** An app with one secret already, so its store file and folder exist. */
async function appWithASecret(app: string) {
  m.typing("an-unrelated-value")
  await zekno("secret", "set", "OTHER", "--app", app, "--server", "dev")
}

/** The bytes of a file, or undefined when it is not there. */
const bytesOf = (path: string) =>
  existsSync(path) ? readFileSync(path).toString("base64") : undefined

/** Names in a folder a write left behind. */
const temporaries = (folder: string) =>
  existsSync(folder)
    ? readdirSync(folder).filter((name) => name.endsWith(".tmp"))
    : []

/** Opens a sealed record with the runner's own key, as the runner would: its value. */
function opened(record: SecretRecord, app: string): string {
  const keys = readKeys(m.runnerHome)
  const result = openSealedSecret(
    record.sealed,
    { serverId, app },
    decodeKey("serverPublic", keys.publicKey),
    decodeKey("serverSecret", keys.secretKey)
  )
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

describe("added: the file written, every secret stored in one write", () => {
  test("postgres to design.md's app: the file, exactly its new lines; two records, one write, each verifying and opening to the value made", async () => {
    const { cwd, plan } = await planned("ok")
    const saves = spyOn(plan.team.store, "saveSecrets")
    const done = await commitAdd(plan, { random })
    expect(saves).toHaveBeenCalledTimes(1)
    saves.mockRestore()
    expect(done).toEqual({
      service: "postgres",
      file: "zekno.app.json",
      stored: [
        { name: "POSTGRES_PASSWORD", version: 1 },
        { name: "DATABASE_URL", version: 1 },
      ],
      server: "dev",
    })
    const written = readFileSync(join(cwd, "zekno.app.json"), "utf8")
    expect(checkSettings(written, "zekno.app.json")).toEqual(
      plan.addition.settings
    )
    const POSTGRES = `    },
    "postgres": {
      "source": {
        "image": "postgres:18.7@sha256:2ea8630df176ad090ec92136dee850397c5af8781e4bcf2e4162593691c61bbc"
      },
      "deploy": { "restart": "always" },
      "networking": { "port": 5432 },
      "variables": {
        "secrets": ["POSTGRES_PASSWORD"],
        "plain": { "POSTGRES_USER": "app", "POSTGRES_DB": "app" }
      },
      "volumes": { "postgres-data": "/var/lib/postgresql" }
    }
  }
}
`
    expect(written).toBe(
      BEFORE_FILE.replace(
        '"secrets": ["SESSION_KEY"]',
        '"secrets": ["SESSION_KEY", "DATABASE_URL"]'
      ).replace(/ {4}\}\n {2}\}\n\}\n$/, POSTGRES)
    )
    const store = plan.team.store.secrets(serverId, "ok")
    expect(store.removals).toEqual([])
    expect(store.records.length).toBe(2)
    const values = store.records.map((record) => {
      const checked = verifySecret({
        record,
        trust: plan.team.trust,
        serverId,
        app: "ok",
      })
      if (!checked.ok) throw new Error(checked.error.code)
      return [checked.value.name, checked.value.version, opened(record, "ok")]
    })
    expect(values).toEqual([
      ["POSTGRES_PASSWORD", 1, PASSWORD],
      ["DATABASE_URL", 1, `postgres://app:${PASSWORD}@postgres:5432/app`],
    ])
    expect(temporaries(cwd)).toEqual([])
    expect(temporaries(dirname(storeOf("ok")))).toEqual([])
  })

  test("mysql: three records, versions as planned after a secret removed before", async () => {
    m.typing("an-old-password")
    await zekno(
      "secret",
      "set",
      "MYSQL_PASSWORD",
      "--app",
      "ver",
      "--server",
      "dev"
    )
    await zekno(
      "secret",
      "rm",
      "MYSQL_PASSWORD",
      "--app",
      "ver",
      "--server",
      "dev"
    )
    const { plan } = await planned("ver", FIRST_TEMPLATES.mysql!)
    const done = await commitAdd(plan)
    expect(done.stored).toEqual([
      { name: "MYSQL_ROOT_PASSWORD", version: 1 },
      { name: "MYSQL_PASSWORD", version: 3 },
      { name: "DATABASE_URL", version: 1 },
    ])
    const store = plan.team.store.secrets(serverId, "ver")
    expect(store.records.length).toBe(4)
    expect(store.removals.length).toBe(1)
    // Made from the system's random source: 32 letters and digits, each value its own.
    const [root, user, url] = store.records
      .slice(1)
      .map((record) => opened(record, "ver"))
    expect(root).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(user).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(root).not.toBe(user)
    expect(url).toBe(`mysql://app:${user}@mysql:3306/app`)
  })
})

describe("never shown (SC-002): the made value only inside its sealed records", () => {
  test("through the summary, the commit and the result: no line, no console call, no file of the folder or the profile, no child process", async () => {
    const ui = m.deps.ui
    const asked = answering(m, [])
    const spawn = spyOn(Bun, "spawn")
    const spawnSync = spyOn(Bun, "spawnSync")
    const consoles = (["log", "error", "warn", "info", "debug"] as const).map(
      (name) => spyOn(console, name)
    )
    try {
      const { cwd, plan } = await planned("never")
      m.deps.ui.addition(summaryOf(plan))
      const done = await commitAdd(plan, { random })
      m.deps.ui.added(done)
      expect(spawn).not.toHaveBeenCalled()
      expect(spawnSync).not.toHaveBeenCalled()
      for (const call of consoles) expect(call).not.toHaveBeenCalled()
      const said = [
        ...m.out,
        ...m.err,
        ...asked.lines.flat(),
        JSON.stringify(plan),
        JSON.stringify(done),
      ]
      expect(said.filter(holdsValue)).toEqual([])
      const files = [...filesUnder(cwd), ...filesUnder(m.home)]
      expect(files.length).toBeGreaterThan(3)
      expect(
        files
          .filter((file) => holdsValue(file.content))
          .map((file) => file.path)
      ).toEqual([])
      // And yet it is there, sealed: the runner's key opens it.
      const store = plan.team.store.secrets(serverId, "never")
      expect(opened(store.records[0]!, "never")).toBe(PASSWORD)
    } finally {
      m.deps.ui = ui
      spawn.mockRestore()
      spawnSync.mockRestore()
      for (const call of consoles) call.mockRestore()
    }
  })
})

describe("whole or not at all (SC-004): a failure at each step leaves both as they were", () => {
  /** Runs the commit of a plan with `before` hooks; gives the sentence, the file's and the store's bytes before and after, and what was left behind. */
  async function failing(
    app: string,
    hooks: (paths: {
      cwd: string
      store: string
    }) => NonNullable<Parameters<typeof commitAdd>[1]>["before"],
    change: (plan: AddPlan) => AddPlan = (plan) => plan
  ) {
    await appWithASecret(app)
    const { cwd, plan } = await planned(app)
    const file = join(cwd, "zekno.app.json")
    const store = storeOf(app)
    const before = { file: bytesOf(file), store: bytesOf(store) }
    let sentence: string | undefined
    try {
      await commitAdd(change(plan), {
        random,
        before: hooks({ cwd, store: dirname(store) }),
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CliError)
      sentence = (error as Error).message
    } finally {
      chmodSync(cwd, 0o755)
      chmodSync(dirname(store), 0o700)
    }
    expect(sentence).toBeDefined()
    expect(holdsValue(sentence!)).toBe(false)
    expect(temporaries(cwd)).toEqual([])
    expect(temporaries(dirname(store))).toEqual([])
    return {
      sentence,
      before,
      after: { file: bytesOf(file), store: bytesOf(store) },
      written: readFileSync(file, "utf8"),
      plan,
    }
  }

  test("a: the file rewritten while the question was open: AD8", async () => {
    const result = await failing("fa", ({ cwd }) => ({
      a: () =>
        writeFileSync(
          join(cwd, "zekno.app.json"),
          BEFORE_FILE.replace("1g", "2g")
        ),
    }))
    expect(result.sentence).toBe(AD8("zekno.app.json", "postgres"))
    // The file is the one the person wrote; nothing of zekno's in it.
    expect(result.written).toBe(BEFORE_FILE.replace("1g", "2g"))
    expect(result.after.store).toBe(result.before.store)
  })

  test("b: the store rewritten: AD21", async () => {
    const result = await failing("fb", ({ store }) => ({
      b: () => {
        const path = join(store, "fb.json")
        const held = JSON.parse(readFileSync(path, "utf8"))
        held.records.push(held.records[0])
        writeFileSync(path, JSON.stringify(held))
      },
    }))
    expect(result.sentence).toBe(AD21("fb", "dev", "postgres"))
    expect(result.after.file).toBe(result.before.file)
  })

  test("c: the keychain or signing refuses: its own sentence; nothing written", async () => {
    const KEYCHAIN =
      "The system keychain could not be read. The signing key is kept nowhere else."
    const result = await failing(
      "fc",
      () => ({}),
      (plan) => ({
        ...plan,
        team: {
          ...plan.team,
          withSigner: async () => {
            throw new CliError(KEYCHAIN)
          },
        },
      })
    )
    expect(result.sentence).toBe(KEYCHAIN)
    expect(result.after).toEqual(result.before)
  })

  test("d: the folder made read-only: CS14; nothing written", async () => {
    const result = await failing("fd", ({ cwd }) => ({
      d: () => chmodSync(cwd, 0o555),
    }))
    expect(result.sentence).toBe(CS14("zekno.app.json"))
    expect(result.after).toEqual(result.before)
  })

  test("e: the store's folder made read-only: AD20, and the file put back as it was", async () => {
    const result = await failing("fe", ({ store }) => ({
      e: () => chmodSync(store, 0o555),
    }))
    expect(result.sentence).toBe(AD20)
    expect(result.after).toEqual(result.before)
  })

  test("e: the store changed between the checks and its write: AD21, and the file put back", async () => {
    const result = await failing("fe2", ({ store }) => ({
      e: () => {
        const path = join(store, "fe2.json")
        const held = JSON.parse(readFileSync(path, "utf8"))
        held.records.push(held.records[0])
        writeFileSync(path, JSON.stringify(held))
      },
    }))
    expect(result.sentence).toBe(AD21("fe2", "dev", "postgres"))
    expect(result.after.file).toBe(result.before.file)
  })

  test("e and f: the store cannot be written and the file cannot be put back: AD19; the store unchanged, the file holds the added service", async () => {
    const result = await failing("ff", ({ cwd, store }) => ({
      e: () => chmodSync(store, 0o555),
      f: () => chmodSync(cwd, 0o555),
    }))
    expect(result.sentence).toBe(AD19("postgres", "zekno.app.json"))
    expect(result.sentence).toBe(
      "postgres was added to zekno.app.json, but its secrets could not be stored, and the file could not be put back. Remove postgres from zekno.app.json before you deploy."
    )
    expect(result.after.store).toBe(result.before.store)
    expect(result.after.file).not.toBe(result.before.file)
    expect(result.written).toBe(settingsText(result.plan.addition.settings))
  })
})
