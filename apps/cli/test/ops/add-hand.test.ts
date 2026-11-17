/**
 * `zekno add` in a folder that deploys a Compose file written by hand
 * (specs/012-templates, contracts/commands.md, "A hand-written Compose file",
 * "The order of checks", step 6, and "Whole or not at all"; FR-015; tasks
 * T047): `prepareAdd` gives a plan with the hand-written target, reading
 * nothing of the file; AU10 for `--for`; AD5 and AD24 as for a settings
 * file; `commitHand` runs steps b, c and e only and stores every secret in
 * one write; a failure at b, c or e leaves the store's bytes as they were;
 * the Compose file is never written. Kept apart from add.test.ts and
 * add-commit.test.ts, which are near the 500 lines a file may have.
 */
import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { verifySecret, type SecretRecord } from "@workspace/core"

import { decodeKey } from "../../../../packages/core/src/crypto/keys"
import { openSealedSecret } from "../../../../packages/core/src/secrets/secrets"
import { readKeys } from "../../../runner/src/home/home"
import { filesUnder } from "../../../runner/test/support/helpers"
import { CliError } from "../../src/cli/errors"
import { isHand, linesOf, prepareAdd, type HandPlan } from "../../src/ops/add"
import { commitHand, type Step } from "../../src/ops/add-commit"
import { AD20, AD21, AD24, AD5, AU10 } from "../../src/templates/add-words"
import { ALPHABET } from "../../src/templates/made"
import type { Template } from "../../src/templates/types"
import { BEFORE_FILE } from "../support/add-files"
import { bench, thrown, where } from "../support/add-ops"
import { ready } from "../support/helpers"
import { FIRST_TEMPLATES } from "../support/template-files"

const postgres = FIRST_TEMPLATES.postgres!

/** A Compose file a person wrote: zekno never reads or writes it. */
const COMPOSE =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      GREETING: hello\n"

/** A made value nobody could guess and the tests can find: letters and digits only. */
const MARK = "zkSENTINELhand4f2a"
const PASSWORD = MARK.repeat(2).slice(0, 32)
const random = (bytes: Uint8Array) => {
  for (let at = 0; at < bytes.length; at++)
    bytes[at] = ALPHABET.indexOf(PASSWORD[at % PASSWORD.length]!)
}

let m: Awaited<ReturnType<typeof ready>>
let tools: ReturnType<typeof bench>
let serverId: string
beforeAll(async () => {
  m = await ready()
  tools = bench(m)
  serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8"))
    .servers[0].serverId
}, 60_000)

/** A folder holding only `compose.yaml`, which cannot be read (mode 000) unless `readable`. */
function handFolder(readable = false) {
  const made = tools.folder()
  const compose = join(made.cwd, "compose.yaml")
  writeFileSync(compose, COMPOSE)
  if (!readable) chmodSync(compose, 0o000)
  /** The Compose file's mode, then its bytes, read once it is readable again. */
  const file = () => {
    const mode = statSync(compose).mode & 0o777
    chmodSync(compose, 0o644)
    const bytes = readFileSync(compose, "utf8")
    if (!readable) chmodSync(compose, 0o000)
    return { mode, bytes }
  }
  return { ...made, compose, file }
}

/** A plan that must be one for a Compose file written by hand. */
function hand(prepared: Awaited<ReturnType<typeof prepareAdd>>): HandPlan {
  if (!isHand(prepared)) throw new Error("not the hand-written target")
  return prepared
}

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

/** The bytes of a file, or undefined when it is not there. */
const bytesOf = (path: string) =>
  existsSync(path) ? readFileSync(path).toString("base64") : undefined

describe("prepared: the hand-written target (step 6)", () => {
  test("a folder with only compose.yaml, unreadable: the plan names it, reads nothing of it, the keychain once, nothing contacted", async () => {
    const { deps, reads, file } = handFolder()
    const plan = hand(
      await prepareAdd(deps, { template: postgres, where: where("h1") })
    )
    expect(plan.target).toEqual({ kind: "hand", file: "compose.yaml" })
    expect(plan.service).toBe("postgres")
    expect(plan.app).toBe("h1")
    expect(plan.server.name).toBe("dev")
    expect(plan.store).toEqual({ records: [], removals: [] })
    expect([...plan.versions]).toEqual([
      ["POSTGRES_PASSWORD", 1],
      ["DATABASE_URL", 1],
    ])
    expect(linesOf(plan).file).toBe("compose.yaml")
    expect(linesOf(plan).service[0]).toBe("  postgres:")
    expect(reads()).toBe(1)
    expect(file()).toEqual({ mode: 0o000, bytes: COMPOSE })
  })

  test("a zekno.json signed and in use that names compose.yaml, a zekno.app.json lying here too: the Compose file, and neither file changed", async () => {
    const { cwd, deps, file } = handFolder(true)
    writeFileSync(join(cwd, "zekno.app.json"), BEFORE_FILE)
    m.deps.cwd = cwd
    try {
      await tools.zekno(
        "link",
        "--app",
        "h2",
        "--server",
        "dev",
        "-f",
        "compose.yaml"
      )
    } finally {
      m.deps.cwd = m.project
    }
    const plan = hand(
      await prepareAdd(deps, { template: postgres, where: where("h2") })
    )
    expect(plan.target).toEqual({ kind: "hand", file: "compose.yaml" })
    expect(file()).toEqual({ mode: 0o644, bytes: COMPOSE })
    expect(readFileSync(join(cwd, "zekno.app.json"), "utf8")).toBe(BEFORE_FILE)
  })

  test("AU10: --for is refused here, before the app is asked for and before the keychain is read", async () => {
    const { deps, reads } = handFolder()
    let asked = 0
    expect(
      await thrown(() =>
        prepareAdd(deps, {
          template: postgres,
          for: ["web"],
          where: async () => {
            asked++
            return where("h3")
          },
        })
      )
    ).toEqual({ kind: "WrongInput", message: AU10("compose.yaml") })
    expect(AU10("compose.yaml")).toBe(
      "--for works with a settings file. With compose.yaml, add the line to each service that uses it."
    )
    expect(asked).toBe(0)
    expect(reads()).toBe(0)
  })

  test("AD5: a secret the app has now; AD24: more secrets than a deploy carries; as for a settings file", async () => {
    m.typing("an-old-password")
    await tools.zekno(
      "secret",
      "set",
      "DATABASE_URL",
      "--app",
      "h5",
      "--server",
      "dev"
    )
    const { deps, file } = handFolder()
    expect(
      await thrown(() =>
        prepareAdd(deps, { template: postgres, where: where("h5") })
      )
    ).toEqual({ kind: "WrongInput", message: AD5("h5", "DATABASE_URL") })
    writeFileSync(
      join(m.project, "many-hand.env"),
      Array.from({ length: 255 }, (_, at) => `S${at}=value-${at}`).join("\n")
    )
    await tools.zekno(
      "secret",
      "import",
      "many-hand.env",
      "--app",
      "h24",
      "--server",
      "dev",
      "--yes"
    )
    expect(
      await thrown(() =>
        prepareAdd(deps, { template: postgres, where: where("h24") })
      )
    ).toEqual({ kind: "CliError", message: AD24("h24", "dev") })
    expect(file()).toEqual({ mode: 0o000, bytes: COMPOSE })
  }, 60_000)

  test("--name db: the service and its volume in the lines", async () => {
    const { deps } = handFolder()
    const plan = hand(
      await prepareAdd(deps, {
        template: postgres,
        name: "db",
        where: where("h6"),
      })
    )
    expect(plan.service).toBe("db")
    expect(linesOf(plan).service[0]).toBe("  db:")
    expect(linesOf(plan).volumes).toEqual(["db-data"])
  })
})

describe("committed: steps b, c and e only, every secret in one write", () => {
  /** The plan for `template` in a folder with only compose.yaml, for app `app`. */
  async function planned(
    app: string,
    options: { template?: Template; name?: string } = {}
  ) {
    const folder = handFolder()
    const plan = hand(
      await prepareAdd(folder.deps, {
        template: options.template ?? postgres,
        ...(options.name === undefined ? {} : { name: options.name }),
        where: where(app),
      })
    )
    return { ...folder, plan }
  }

  test("stored in one write, versions as planned, each record verifying and opening to the value made; --name db is the connection secret's host; the Compose file untouched", async () => {
    const { cwd, file, plan } = await planned("hc1", { name: "db" })
    const saves = spyOn(plan.team.store, "saveSecrets")
    const steps: Step[] = []
    const hook = (step: Step) => () => void steps.push(step)
    const done = await commitHand(plan, {
      random,
      before: {
        a: hook("a"),
        b: hook("b"),
        c: hook("c"),
        d: hook("d"),
        e: hook("e"),
        f: hook("f"),
      },
    })
    expect(saves).toHaveBeenCalledTimes(1)
    saves.mockRestore()
    expect(steps).toEqual(["b", "c", "e"])
    expect(done).toEqual({
      service: "db",
      stored: [
        { name: "POSTGRES_PASSWORD", version: 1 },
        { name: "DATABASE_URL", version: 1 },
      ],
      server: "dev",
    })
    const store = plan.team.store.secrets(serverId, "hc1")
    const values = store.records.map((record) => {
      const checked = verifySecret({
        record,
        trust: plan.team.trust,
        serverId,
        app: "hc1",
      })
      if (!checked.ok) throw new Error(checked.error.code)
      return [checked.value.name, checked.value.version, opened(record, "hc1")]
    })
    expect(values).toEqual([
      ["POSTGRES_PASSWORD", 1, PASSWORD],
      ["DATABASE_URL", 1, `postgres://app:${PASSWORD}@db:5432/app`],
    ])
    expect(file()).toEqual({ mode: 0o000, bytes: COMPOSE })
    // The value made is in no file of the folder and no file of the profile but its sealed records.
    chmodSync(join(cwd, "compose.yaml"), 0o644)
    const files = [...filesUnder(cwd), ...filesUnder(m.home)]
    expect(
      files.filter((each) => each.content.includes(MARK)).map((f) => f.path)
    ).toEqual([])
    expect(JSON.stringify(done)).not.toContain(MARK)
  })

  test("mysql: three secrets, the made ones from the system's random source", async () => {
    const { plan } = await planned("hc2", { template: FIRST_TEMPLATES.mysql! })
    const done = await commitHand(plan)
    expect(done.stored.map((secret) => secret.name)).toEqual([
      "MYSQL_ROOT_PASSWORD",
      "MYSQL_PASSWORD",
      "DATABASE_URL",
    ])
    const [root, user, url] = plan.team.store
      .secrets(serverId, "hc2")
      .records.map((record) => opened(record, "hc2"))
    expect(root).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(user).toMatch(/^[A-Za-z0-9]{32}$/)
    expect(url).toBe(`mysql://app:${user}@mysql:3306/app`)
  })

  describe("a failure at b, c or e: the store's bytes as before, the Compose file untouched, no temporary file", () => {
    /** An app with one secret already, so its store file and folder exist; then the commit with `before` hooks. */
    async function failing(
      app: string,
      hooks: (store: string) => Partial<Record<Step, () => void>>,
      change: (plan: HandPlan) => HandPlan = (plan) => plan
    ) {
      m.typing("an-unrelated-value")
      await tools.zekno(
        "secret",
        "set",
        "OTHER",
        "--app",
        app,
        "--server",
        "dev"
      )
      const { file, plan } = await planned(app)
      const store = tools.storePath(app)
      const before = bytesOf(store)
      let sentence: string | undefined
      let written: string | undefined
      try {
        await commitHand(change(plan), {
          random,
          before: hooks(store),
        })
      } catch (error) {
        expect(error).toBeInstanceOf(CliError)
        sentence = (error as Error).message
      } finally {
        written = bytesOf(store)
        chmodSync(dirname(store), 0o700)
      }
      expect(sentence).toBeDefined()
      expect(sentence).not.toContain(MARK)
      expect(file()).toEqual({ mode: 0o000, bytes: COMPOSE })
      expect(
        readdirSync(dirname(store)).filter((name) => name.endsWith(".tmp"))
      ).toEqual([])
      return { sentence, before, after: written }
    }

    /** A hook that rewrites the app's store as something else might: one record twice. */
    const rewrite = (path: string) => () => {
      const held = JSON.parse(readFileSync(path, "utf8"))
      held.records.push(held.records[0])
      writeFileSync(path, JSON.stringify(held))
    }

    test("b: the store rewritten while the question was open: AD21, nothing of zekno's written", async () => {
      let rewritten: string | undefined
      const result = await failing("hb", (store) => ({
        b: () => {
          rewrite(store)()
          rewritten = bytesOf(store)
        },
      }))
      expect(result.sentence).toBe(AD21("hb", "dev", "postgres"))
      expect(result.after).toBe(rewritten)
    })

    test("c: the keychain or signing refuses: its own sentence; the store as before", async () => {
      const KEYCHAIN =
        "The system keychain could not be read. The signing key is kept nowhere else."
      const result = await failing(
        "hc",
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
      expect(result.after).toBe(result.before)
    })

    test("e: the store's folder made read-only: AD20; the store as before", async () => {
      const result = await failing("he", (store) => ({
        e: () => chmodSync(dirname(store), 0o555),
      }))
      expect(result.sentence).toBe(AD20)
      expect(result.after).toBe(result.before)
    })

    test("e: the store changed between the checks and its write: AD21, nothing of zekno's written", async () => {
      let rewritten: string | undefined
      const result = await failing("he2", (store) => ({
        e: () => {
          rewrite(store)()
          rewritten = bytesOf(store)
        },
      }))
      expect(result.sentence).toBe(AD21("he2", "dev", "postgres"))
      expect(result.after).toBe(rewritten)
    })
  })
})
