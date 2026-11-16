/**
 * The settings commands look at the file a deploy would sign
 * (specs/010-app-settings, security review S1): in each of the reviewer's
 * three folders, `zekno settings`, `--json`, `compose`, `set` and `unset`
 * take the file `zekno deploy` in the same folder uses, by the same rule, or
 * show and change nothing; `init` makes the file here and says when the link
 * names another. A zekno.json not signed by the team, or not yet used here,
 * is left aside as the deploy leaves it, and nothing is recorded.
 */
import { describe, expect, test } from "bun:test"
import { readSignedDeploy } from "@workspace/core"
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { shownFile, shownPath } from "../../src/project/shown"
import { composeText } from "../../src/settings/compose"
import { settingsText } from "../../src/settings/text"
import { IN6, SH3, SH4 } from "../../src/settings/words"
import { openTeam } from "../../src/cli/context"
import { answering, machine, ready, twin } from "../support/helpers"
import {
  fileOf,
  HIDDEN,
  linkedCompose,
  linkedElsewhere,
  ROOT,
  runs,
  SUB,
  subFolder,
  VISIBLE,
} from "../support/settings-places"
import { terminal } from "../support/terminal"

type Machine = ReturnType<typeof machine>

/** The plain run of `zekno <args>`: its status and what it wrote on each stream. */
async function piped(m: Machine, ...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  const code = await m.zekno(...args)
  return { code, out: [...m.out], err: [...m.err] }
}

/** `zekno <args>` at a stand-in terminal, wide enough for a temporary folder's path: the status and the lines shown. */
async function atTerminal(m: Machine, ...args: string[]) {
  const t = terminal(200, 40)
  const before = m.deps.ui
  m.deps.ui = t.ui
  try {
    const code = await m.zekno(...args)
    await t.ui.close()
    return { code, lines: t.lines() }
  } finally {
    m.deps.ui = before
  }
}

/** The piped line of `zekno settings` for `runs(image)`. */
const linesOf = (image: string) => [
  `web\tsource.image\t${image}`,
  `web\tvariables.plain.FROM\t${image}`,
]

/** A key store and connections that fail whatever touches them. */
function noKeychain(m: Machine) {
  const no = (what: string) => () => {
    throw new Error(what)
  }
  m.deps.keyStore = {
    get: no("the keychain was read"),
    set: no("the keychain was written"),
    delete: no("the keychain was written"),
  }
  m.deps.connect = no("a connection was made")
}

const text = (path: string) => readFileSync(path, "utf8")

describe("A: a sub-folder under a linked root", () => {
  test("every command shows and changes the root's file, the one a deploy there signs; the sub-folder's own is left as it is", async () => {
    const { m, signedFile, ownFile } = await subFolder()
    const shown = shownFile(m.deps.cwd, signedFile)
    expect(await piped(m, "settings")).toEqual({
      code: 0,
      out: linesOf(ROOT),
      err: [],
    })
    expect(await piped(m, "settings", "--json")).toEqual({
      code: 0,
      out: [JSON.stringify(JSON.parse(fileOf(ROOT)))],
      err: [],
    })
    expect((await piped(m, "settings", "compose")).out.join("\n")).toBe(
      composeText(runs(ROOT)).trimEnd()
    )
    // At a terminal the file is named as the deploy names it, with the app the link names.
    const drawn = await atTerminal(m, "settings")
    expect(drawn.code).toBe(0)
    expect(drawn.lines[0]).toBe(`  demo  from ${shown}`)

    // Without --yes the question's refusal names that file.
    expect(await piped(m, "settings", "set", "web.memory", "2g")).toEqual({
      code: 1,
      out: ["web · memory limit  no limit → 2g"],
      err: [
        `There is no terminal to ask on. Add \`--yes\` to write it to ${shown}.`,
      ],
    })
    // set, unset and compose judge the link without the keychain, and connect nowhere.
    noKeychain(m)
    expect(
      await piped(m, "settings", "set", "web.memory", "2g", "--yes")
    ).toEqual({
      code: 0,
      out: [
        "web · memory limit  no limit → 2g",
        "Written  Run zekno deploy to use it.",
      ],
      err: [],
    })
    expect(text(signedFile)).toContain('"memory": "2g"')
    expect(
      (await piped(m, "settings", "unset", "web.plain.FROM", "--yes")).code
    ).toBe(0)
    expect(text(signedFile)).not.toContain("FROM")
    expect(text(ownFile)).toBe(fileOf(SUB))
    expect((await piped(m, "settings", "compose")).code).toBe(0)
  }, 60_000)

  test("init in the sub-folder makes its file there and says that the link names the root's", async () => {
    const { m, signedFile } = await subFolder()
    const sub = m.deps.cwd
    const empty = join(sub, "empty")
    mkdirSync(empty)
    m.deps.cwd = empty
    const asking = answering(m, [{ type: SUB }, { type: "web" }])
    m.err.length = 0
    expect(await m.zekno("settings", "init")).toBe(0)
    expect(asking.unanswered()).toBe(0)
    expect(text(join(empty, "zekno.app.json"))).toBe(
      settingsText({ version: 1, services: [["web", { image: SUB }]] })
    )
    expect(m.err).toEqual([
      SH3(shownFile(empty, signedFile), shownPath(join(signedFile, ".."))),
    ])
  }, 60_000)
})

describe("B: a link naming compose.yaml, with a zekno.app.json beside it", () => {
  test("every command says SH3 in one sentence, status 1, and shows or changes nothing", async () => {
    const { m, ownFile } = await linkedCompose()
    const said = SH3("compose.yaml")
    for (const args of [
      ["settings"],
      ["settings", "--json"],
      ["settings", "compose"],
      ["settings", "set", "web.memory", "2g", "--yes"],
      ["settings", "unset", "web.plain.FROM", "--yes"],
    ])
      expect({ args, run: await piped(m, ...args) }).toEqual({
        args,
        run: { code: 1, out: [], err: [said] },
      })
    expect((await atTerminal(m, "settings")).lines).toEqual([`✖ ${said}`])
    expect(text(ownFile)).toBe(fileOf(VISIBLE))
  }, 60_000)
})

describe("C: a link naming deploy/zekno.app.json, with a zekno.app.json in the folder", () => {
  test("every command shows and changes deploy/zekno.app.json, named so; the folder's own is left as it is", async () => {
    const { m, signedFile, ownFile } = await linkedElsewhere()
    expect(await piped(m, "settings")).toEqual({
      code: 0,
      out: linesOf(HIDDEN),
      err: [],
    })
    expect((await piped(m, "settings", "--json")).out).toEqual([
      JSON.stringify(JSON.parse(fileOf(HIDDEN))),
    ])
    expect((await piped(m, "settings", "compose")).out.join("\n")).toBe(
      composeText(runs(HIDDEN)).trimEnd()
    )
    expect((await atTerminal(m, "settings")).lines[0]).toBe(
      "  demo  from deploy/zekno.app.json"
    )
    expect(await piped(m, "settings", "set", "web.memory", "2g")).toEqual({
      code: 1,
      out: ["web · memory limit  no limit → 2g"],
      err: [
        "There is no terminal to ask on. Add `--yes` to write it to deploy/zekno.app.json.",
      ],
    })
    noKeychain(m)
    expect(
      (await piped(m, "settings", "set", "web.memory", "2g", "--yes")).code
    ).toBe(0)
    expect(text(signedFile)).toContain('"memory": "2g"')
    expect(text(ownFile)).toBe(fileOf(VISIBLE))
  }, 60_000)

  test("at a terminal the question names deploy/zekno.app.json", async () => {
    const { m } = await linkedElsewhere()
    const asking = answering(m, [{ yes: false }])
    expect(await m.zekno("settings", "set", "web.memory", "2g")).toBe(1)
    expect(asking.asked).toEqual([
      {
        kind: "confirm",
        question:
          "Write this to deploy/zekno.app.json? Nothing is deployed until you deploy.",
      },
    ])
  }, 60_000)

  test("init makes zekno.app.json here and says that the link names deploy/zekno.app.json", async () => {
    const { m, ownFile } = await linkedElsewhere()
    // The folder's own file is not there yet.
    Bun.spawnSync(["rm", ownFile])
    answering(m, [{ type: VISIBLE }, { type: "web" }])
    m.err.length = 0
    expect(await m.zekno("settings", "init")).toBe(0)
    expect(m.err).toEqual([SH3("deploy/zekno.app.json")])
  }, 60_000)
})

describe("both files and nothing that decides", () => {
  test("the settings are shown and changed, with IN6 apart: a deploy asks which file, or takes -f", async () => {
    const m = machine()
    writeFileSync(join(m.project, "zekno.app.json"), fileOf(VISIBLE))
    m.compose("services: {}\n")
    expect(await piped(m, "settings")).toEqual({
      code: 0,
      out: linesOf(VISIBLE),
      err: [IN6],
    })
    expect(await piped(m, "settings", "--json")).toEqual({
      code: 0,
      out: [JSON.stringify(JSON.parse(fileOf(VISIBLE)))],
      err: [IN6],
    })
    const compose = await piped(m, "settings", "compose")
    expect(compose.out.join("\n")).toBe(composeText(runs(VISIBLE)).trimEnd())
    expect(compose.err).toEqual([IN6])
    expect(
      await piped(m, "settings", "set", "web.memory", "2g", "--yes")
    ).toEqual({
      code: 0,
      out: [
        "web · memory limit  no limit → 2g",
        "Written  Run zekno deploy to use it.",
        IN6,
      ],
      err: [],
    })
  })
})

describe("a zekno.json the deploy leaves aside", () => {
  test("not signed by the team, in a folder above: the folder's own file, nothing asked, links.json not written", async () => {
    const m = machine()
    const sub = join(m.project, "sub")
    mkdirSync(sub)
    writeFileSync(join(m.project, "zekno.app.json"), fileOf(ROOT))
    writeFileSync(
      join(m.project, "zekno.json"),
      JSON.stringify({ app: "demo", server: "dev", compose: "zekno.app.json" })
    )
    writeFileSync(join(sub, "zekno.app.json"), fileOf(SUB))
    m.deps.cwd = sub
    expect((await piped(m, "settings")).out).toEqual(linesOf(SUB))
    expect(
      (await piped(m, "settings", "set", "web.memory", "2g", "--yes")).code
    ).toBe(0)
    expect(text(join(sub, "zekno.app.json"))).toContain('"memory": "2g"')
    expect(text(join(m.project, "zekno.app.json"))).toBe(fileOf(ROOT))
    expect(() => readFileSync(join(m.home, "links.json"))).toThrow()
  })

  test("signed and not yet used here (another machine of the member), naming another file: every command but init says SH4 and shows or changes nothing; no keychain, links.json not written (security review S6)", async () => {
    for (const [folder, make] of [
      ["C", linkedElsewhere],
      ["B", linkedCompose],
      ["A", subFolder],
    ] as const) {
      const { m, ownFile } = await make()
      const other = await twin(m)
      other.deps.cwd = m.deps.cwd
      noKeychain(other)
      const said =
        folder === "C"
          ? SH4("deploy/zekno.app.json")
          : folder === "B"
            ? SH4("compose.yaml")
            : SH4(
                shownFile(
                  other.deps.cwd,
                  join(realpathSync(m.project), "zekno.app.json")
                ),
                shownPath(realpathSync(m.project))
              )
      for (const args of [
        ["settings"],
        ["settings", "--json"],
        ["settings", "compose"],
        ["settings", "set", "web.memory", "2g", "--yes"],
        ["settings", "unset", "web.plain.FROM", "--yes"],
      ])
        expect({ folder, args, run: await piped(other, ...args) }).toEqual({
          folder,
          args,
          run: { code: 1, out: [], err: [said] },
        })
      expect(text(ownFile)).toBe(fileOf(folder === "A" ? SUB : VISIBLE))
      expect(() => readFileSync(join(other.home, "links.json"))).toThrow()
    }
  }, 120_000)

  test("signed and not yet used here, naming this folder's own zekno.app.json: the commands go on with it", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), fileOf(VISIBLE))
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    const other = await twin(m)
    other.deps.cwd = m.project
    noKeychain(other)
    expect((await piped(other, "settings")).out).toEqual(linesOf(VISIBLE))
    expect(() => readFileSync(join(other.home, "links.json"))).toThrow()
  }, 60_000)

  test("the first-use question of zekno deploy names the file a yes deploys, and a yes deploys it", async () => {
    const { m } = await linkedElsewhere()
    const other = await twin(m)
    other.deps.cwd = m.project
    const asking = answering(other, [{ yes: true }])
    expect(await other.zekno("deploy")).toBe(0)
    expect(asking.asked[0]).toEqual({
      kind: "confirm",
      question:
        "Ada linked this folder to demo on dev, with deploy/zekno.app.json. Use it here?",
    })
    const team = await openTeam(other.deps)
    const server = team.profile.servers[0]!
    const entry = team.store.history(server.serverId, "demo").at(-1)!
    const read = readSignedDeploy({
      envelope: entry.envelope,
      trust: team.trust,
    })
    if (!read.ok) throw new Error("the deploy did not verify")
    expect(read.value.deploy.compose).toBe(composeText(runs(HIDDEN)))
  }, 60_000)
})
