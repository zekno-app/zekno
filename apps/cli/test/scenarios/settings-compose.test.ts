/**
 * User Story 4 of specs/010-app-settings: what is printed is what is signed
 * (FR-026, FR-027, SC-002; contracts/commands.md, "Tests"; tasks T061). For
 * design.md's file and every good file of the test set, the standard output
 * of `zekno settings compose` is, byte for byte, the Compose text inside the
 * deploy `zekno deploy` signs for the same folder, as `readSignedDeploy`
 * reads it from this machine's history; and a second run prints the same.
 */
import { describe, expect, test } from "bun:test"
import { readSignedDeploy } from "@workspace/core"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { openTeam } from "../../src/cli/context"
import { SH1 } from "../../src/settings/words"
import type { Cell } from "../../src/ui/types"
import { machine, ready } from "../support/helpers"
import {
  DESIGN_COMPOSE,
  DESIGN_FILE,
  GOOD_FILES,
  SENTINEL,
} from "../support/settings-files"
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
  const read = readSignedDeploy({ envelope: entry.envelope, trust: team.trust })
  if (!read.ok) throw new Error("the last deploy did not verify")
  return read.value.deploy.compose
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

  test("a plain value with an invisible character: piped, the text exactly as signed; at a terminal, drawn without it", async () => {
    const m = machine()
    writeFileSync(
      join(m.project, "zekno.app.json"),
      DESIGN_FILE.replace('"production"', '"prod\u202Euction"')
    )
    const run = await printed(m, "settings", "compose")
    expect(run.code).toBe(0)
    expect(run.text).toContain('"NODE_ENV": "prod\u202Euction"')
    const t = terminal(100, 40)
    m.deps.ui = t.ui
    expect(await m.zekno("settings", "compose")).toBe(0)
    await t.ui.close()
    expect(t.raw()).not.toContain("\u202E")
    expect(t.lines()).toContain('      "NODE_ENV": "production"')
  })
})
