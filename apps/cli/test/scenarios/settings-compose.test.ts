/**
 * User Story 4 of specs/010-app-settings: what is printed is what is signed
 * (FR-026, FR-027, SC-002; contracts/commands.md, "Tests"; tasks T061). For
 * design.md's file and every good file of the test set, the standard output
 * of `zekno settings compose` is, byte for byte, the Compose text inside the
 * deploy `zekno deploy` signs for the same folder, as `readDeployEntry`
 * reads it from this machine's history; and a second run prints the same.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { buildKey, builtImageName, type Envelope } from "@workspace/core"

import { openTeam } from "../../src/cli/context"
import { prepareDeploy, sendDeploy } from "../../src/ops/deploy"
import { composeForFolder } from "../../src/ops/settings"
import { MADE_AT_DEPLOY } from "../../src/ops/settings-build"
import { packFolder } from "../../src/pack/chunks"
import { readIgnoreFile } from "../../src/pack/ignore"
import { walkFolder } from "../../src/pack/walk"
import { composeText } from "../../src/settings/compose"
import { readSettingsFile } from "../../src/settings/file"
import { SH1, SH3 } from "../../src/settings/words"
import { readDeployEntry } from "../../src/shared/history"
import type { Cell } from "../../src/ui/types"
import {
  builderAnswer,
  buildsAnswer,
  payloadOf,
  standInSessions,
  started,
} from "../support/build-session"
import { COMPOSE_V1, machine, ready } from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  GOOD_FILES,
  SENTINEL,
} from "../support/settings-files"
import {
  HIDDEN,
  linkedCompose,
  linkedElsewhere,
  ROOT,
  runs,
  subFolder,
} from "../support/settings-places"
import { terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

const WHERE = ["--app", "demo", "--server", "dev"]
const SECRET_VALUE = "zk_secret_value_8b14"

/** Standard output of a plain run of `zekno <args>`, as bytes on a pipe: each line and its line feed. */
async function printed(m: Machine, ...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  const code = await m.zekno(...args)
  return {
    code,
    text: m.out.map((line) => `${line}\n`).join(""),
    err: [...m.err],
  }
}

/** The Compose text of the last deploy of demo this machine signed, read from under its signature. */
async function lastSigned(m: Machine): Promise<string> {
  const team = await openTeam(m.deps)
  const server = team.profile.servers[0]!
  const entry = team.store.history(server.serverId, "demo").at(-1)!
  const read = readDeployEntry(entry.envelope, team.trust)
  if (!read) throw new Error("the last deploy did not verify")
  return read.deploy.compose
}

describe("zekno settings compose prints what zekno deploy signs (FR-027, SC-002)", () => {
  test("design.md's file: the 594 bytes of the contract, printed, signed and started", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const first = await printed(m, "settings", "compose")
    expect(first).toEqual({ code: 0, text: DESIGN_COMPOSE, err: [] })
    expect(Buffer.byteLength(first.text)).toBe(594)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(await lastSigned(m)).toBe(first.text)
    expect((await printed(m, "settings", "compose")).text).toBe(first.text)
  }, 60_000)

  test("every good file of the test set, one after another on one app: printed equals signed, byte for byte, and a second run prints the same", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    expect(GOOD_FILES.length).toBeGreaterThan(20)
    for (const file of GOOD_FILES) {
      writeFileSync(join(m.project, "zekno.app.json"), file.text)
      const first = await printed(m, "settings", "compose")
      expect({ name: file.name, code: first.code, err: first.err }).toEqual({
        name: file.name,
        code: 0,
        err: [],
      })
      expect({
        name: file.name,
        code: await m.zekno("deploy", ...WHERE),
      }).toEqual({ name: file.name, code: 0 })
      expect({ name: file.name, signed: await lastSigned(m) }).toEqual({
        name: file.name,
        signed: first.text,
      })
      const second = await printed(m, "settings", "compose")
      expect({ name: file.name, same: second.text === first.text }).toEqual({
        name: file.name,
        same: true,
      })
    }
  }, 180_000)

  test("the text holds no secret's value, though the secrets have values on this machine (US4, scenario 1)", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    m.typing(SECRET_VALUE)
    expect(await m.zekno("secret", "set", "DATABASE_URL", ...WHERE)).toBe(0)
    const run = await printed(m, "settings", "compose")
    expect(run.code).toBe(0)
    expect(run.text).toContain('"DATABASE_URL": "${DATABASE_URL}"')
    expect(run.text).not.toContain(SECRET_VALUE)
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(await lastSigned(m)).not.toContain(SECRET_VALUE)
  }, 60_000)

  test("a fault: its sentence, status 1, nothing printed and nothing of the file said; no file: SH1", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"1g"', `"${SENTINEL}"`)
    )
    const run = await printed(m, "settings", "compose")
    expect(run).toEqual({
      code: 1,
      text: "",
      err: [
        "zekno.app.json could not be read as settings. web, deploy.memory: use a size such as 512m or 1g.",
      ],
    })
    rmSync(join(m.project, "zekno.app.json"))
    expect(await printed(m, "settings", "compose")).toEqual({
      code: 1,
      text: "",
      err: [SH1],
    })
  })

  test("the escape hatch (US4, scenario 3): the printed text saved as compose.yaml, the settings file removed, deploys and signs the same text again", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const text = (await printed(m, "settings", "compose")).text
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    writeFileSync(join(m.project, "compose.yaml"), text)
    rmSync(join(m.project, "zekno.app.json"))
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(await lastSigned(m)).toBe(text)
    expect(readFileSync(join(m.project, "compose.yaml"), "utf8")).toBe(
      DESIGN_COMPOSE
    )
  }, 60_000)

  test("a sub-folder under a linked root, with a zekno.app.json of its own (security review S1, A): printed there equals what zekno deploy there signs, the root's file", async () => {
    const { m } = await subFolder()
    const first = await printed(m, "settings", "compose")
    expect(first).toEqual({
      code: 0,
      text: composeText(runs(ROOT)),
      err: [],
    })
    expect(await m.zekno("deploy")).toBe(0)
    expect(await lastSigned(m)).toBe(first.text)
    expect((await printed(m, "settings", "compose")).text).toBe(first.text)
  }, 60_000)

  test("a link naming deploy/zekno.app.json, with a zekno.app.json in the folder (security review S1, C): printed equals signed, the file the link names", async () => {
    const { m } = await linkedElsewhere()
    const first = await printed(m, "settings", "compose")
    expect(first).toEqual({
      code: 0,
      text: composeText(runs(HIDDEN)),
      err: [],
    })
    expect(await m.zekno("deploy")).toBe(0)
    expect(await lastSigned(m)).toBe(first.text)
    // With flags the same link decides, and the same text is signed.
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(await lastSigned(m)).toBe(first.text)
  }, 60_000)

  test("a link naming compose.yaml, with a zekno.app.json beside it (security review S1, B): nothing printed, SH3, and the deploy signs compose.yaml", async () => {
    const { m } = await linkedCompose()
    expect(await printed(m, "settings", "compose")).toEqual({
      code: 1,
      text: "",
      err: [SH3("compose.yaml")],
    })
    expect(await m.zekno("deploy")).toBe(0)
    expect(await lastSigned(m)).toBe(COMPOSE_V1)
  }, 60_000)

  test("at a terminal: the same lines, each drawn dim", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    const t = terminal(100, 40)
    const cells: (readonly Cell[] | undefined)[] = []
    m.deps.ui = {
      ...t.ui,
      line: (plain, drawn) => {
        cells.push(drawn)
        t.ui.line(plain, drawn)
      },
    }
    expect(await m.zekno("settings", "compose")).toBe(0)
    await t.ui.close()
    expect(t.lines()).toEqual(DESIGN_COMPOSE.trimEnd().split("\n"))
    expect(cells).toHaveLength(DESIGN_COMPOSE.trimEnd().split("\n").length)
    for (const drawn of cells)
      expect(drawn).toEqual([expect.objectContaining({ style: "quiet" })])
  })

  test("a plain value with an invisible character is refused (security review S2): nothing printed, piped or at a terminal", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"production"', '"prod\u202Euction"')
    )
    expect(await printed(m, "settings", "compose")).toEqual({
      code: 1,
      text: "",
      err: [
        "zekno.app.json could not be read as settings. web, variables.plain.NODE_ENV: use no invisible character, such as a zero-width space or a right-to-left mark.",
      ],
    })
    const t = terminal(100, 40)
    m.deps.ui = t.ui
    expect(await m.zekno("settings", "compose")).toBe(1)
    await t.ui.close()
    expect(t.raw()).not.toContain("\u202E")
    expect(t.lines()).not.toContain('      "NODE_ENV": "production"')
  })
})

/**
 * A built service (specs/016-build-from-source, contracts/cli.md CL1, "zekno
 * settings compose"; plan item 18 (a); FR-011's exception; tasks T124). The
 * key is computed here from the same folder, by pass 1 and pass 2 with no
 * sealing; the byte-for-byte check against a payload a deploy signs is
 * T129's. Lines are checked by their row id, never their words (FR-092).
 */
describe("zekno settings compose for a built service (T124)", () => {
  const DOCKERFILE = "FROM alpine:3.20\nEXPOSE 3000\nCOPY . /app\n"

  /** A ready machine whose folder holds `files` and the settings of `services`, linked to shop on dev. */
  async function builtFolder(
    services: Record<string, unknown>,
    files: Record<string, string> = { Dockerfile: DOCKERFILE }
  ) {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(m.project, name), text)
    writeFileSync(
      join(m.project, "zekno.app.json"),
      `${JSON.stringify({ zekno: 1, services }, null, 2)}\n`
    )
    if ((await m.zekno("link", "--app", "shop", "--server", "dev")) !== 0)
      throw new Error(m.lastErr())
    return m
  }

  const built = { build: { builder: "dockerfile" }, networking: { port: 3000 } }

  /** The key of the folder's one Dockerfile build with no plain variable it reads, made as a deploy makes it with `fresh` null. */
  async function keyOf(folder: string, home: string): Promise<string> {
    const root = realpathSync(folder)
    const walk = walkFolder(root, {
      dockerfile: "Dockerfile",
      ignore: readIgnoreFile(root, {
        builder: "dockerfile",
        dockerfile: "Dockerfile",
      }),
      include: [],
      agreed: () => false,
      zeknoHome: home,
    })
    const pack = await packFolder(walk, { seal: null })
    return buildKey(
      {
        pack: { hash: pack.hash },
        builder: { name: "dockerfile", dockerfile: "Dockerfile", target: null },
        args: [],
        secrets: [],
        network: "default",
        fresh: null,
      },
      []
    )
  }

  /** The settings of the folder, as the reader reads them. */
  const settingsOf = (m: Machine) =>
    readSettingsFile({ kind: "default", folder: m.project }, m.project).settings

  test("packed with no sealing, no server and nothing written: the text with the key made with fresh null, and G22 from the code", async () => {
    const m = await builtFolder({ web: built })
    let connections = 0
    const connect = m.deps.connect
    m.deps.connect = (...args) => {
      connections++
      return connect(...args)
    }
    const printed = await composeForFolder(m.deps)
    const key = await keyOf(m.project, m.home)
    expect(printed).toEqual({
      text: composeText(
        settingsOf(m),
        new Map([["web", builtImageName("shop", key)]])
      ),
      lines: [{ id: "G22", service: "web", server: "dev", made: "from_code" }],
    })
    expect(printed.text).toContain(`    pull_policy: "never"\n`)
    expect(printed.text).toContain(`      "PORT": "3000"\n`)
    expect(connections).toBe(0)
    expect(existsSync(join(m.home, "tmp"))).toBe(false)
    // A second run packs the same folder to the same key.
    expect((await composeForFolder(m.deps)).text).toBe(printed.text)
  }, 60_000)

  test("the command prints that text on standard output, byte for byte, and G22 by its id on standard error", async () => {
    const m = await builtFolder({ web: built })
    const printed = await composeForFolder(m.deps)
    const before = { out: m.out.length, err: m.err.length }
    expect(await m.zekno("settings", "compose")).toBe(0)
    expect(`${m.out.slice(before.out).join("\n")}\n`).toBe(printed.text)
    expect(m.err.slice(before.err)).toEqual(["G22"])
  }, 60_000)

  test("two services of one folder and one recipe share one key; an image service beside them prints as today", async () => {
    const m = await builtFolder({
      web: built,
      worker: { build: { builder: "dockerfile" } },
      cache: { source: { image: "redis:7" } },
    })
    const key = builtImageName("shop", await keyOf(m.project, m.home))
    const printed = await composeForFolder(m.deps)
    expect(printed.text).toBe(
      composeText(
        settingsOf(m),
        new Map([
          ["web", key],
          ["worker", key],
        ])
      )
    )
    expect(printed.text).toContain(`  "cache":\n    image: "redis:7"\n`)
    expect(printed.lines.map((line) => [line.id, line.service])).toEqual([
      ["G22", "web"],
      ["G22", "worker"],
    ])
  }, 60_000)

  test("a build whose base key this machine's history shows with a fresh generation: the placeholder, and G22's fresh form", async () => {
    const m = await builtFolder({ web: built })
    const stand = standInSessions(m.deps, {
      answer: {
        builder: () => builderAnswer(),
        builds: () => buildsAnswer("shop"),
        deploy: started,
      },
    })
    const plan = await prepareDeploy(m.deps, {
      app: "shop",
      server: "dev",
      fresh: true,
    })
    await sendDeploy(m.deps, { ...plan, fresh: true })
    stand.restore()
    const printed = await composeForFolder(m.deps)
    expect(printed).toEqual({
      text: composeText(
        settingsOf(m),
        new Map([["web", `zekno.invalid/shop:${MADE_AT_DEPLOY}`]])
      ),
      lines: [{ id: "G22", service: "web", server: "dev", made: "fresh" }],
    })
    expect(MADE_AT_DEPLOY).toBe("<made at deploy>")
  }, 60_000)

  test("a deploy that was not fresh leaves the key printed from the code, the very text that deploy signed", async () => {
    const m = await builtFolder({ web: built })
    const stand = standInSessions(m.deps, {
      answer: {
        builder: () => builderAnswer(),
        builds: () => buildsAnswer("shop"),
        deploy: started,
      },
    })
    expect(await m.zekno("deploy")).toBe(0)
    stand.restore()
    const printed = await composeForFolder(m.deps)
    expect(printed.lines).toEqual([
      { id: "G22", service: "web", server: "dev", made: "from_code" },
    ])
    expect(printed.text).toContain(
      builtImageName("shop", await keyOf(m.project, m.home))
    )
    const signed = stand.inputs("deploy").at(-1) as { envelope: Envelope }
    expect(payloadOf(signed.envelope).compose).toBe(printed.text)
  }, 60_000)

  test("an image service prints as today, with no line", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    expect(await composeForFolder(m.deps)).toEqual({
      text: DESIGN_COMPOSE,
      lines: [],
    })
  })

  test("the stops of a deploy apply: a Dockerfile not there (C20), an image under zekno.invalid (C10), the app's name ending with a hyphen (C21c)", async () => {
    const missing = await builtFolder({
      web: { build: { builder: "dockerfile", dockerfile: "Dockerfile.web" } },
    })
    await expect(composeForFolder(missing.deps)).rejects.toMatchObject({
      line: { id: "C20", service: "web" },
    })

    const reserved = await builtFolder(
      { web: built },
      { Dockerfile: "FROM zekno.invalid/other:1\n" }
    )
    await expect(composeForFolder(reserved.deps)).rejects.toMatchObject({
      line: { id: "C10", service: "web" },
    })

    const hyphen = await ready()
    rmSync(join(hyphen.project, "compose.yaml"))
    writeFileSync(join(hyphen.project, "Dockerfile"), DOCKERFILE)
    writeFileSync(
      join(hyphen.project, "zekno.app.json"),
      `${JSON.stringify({ zekno: 1, services: { web: built } }, null, 2)}\n`
    )
    expect(
      await hyphen.zekno("link", "--app", "shop-", "--server", "dev")
    ).toBe(0)
    await expect(composeForFolder(hyphen.deps)).rejects.toMatchObject({
      line: { id: "C21c", app: "shop-" },
    })
  }, 60_000)
})
