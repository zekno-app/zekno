/**
 * The settings file is found by its exact name (specs/010-app-settings,
 * security review S5): as feature 004 holds `zekno.json` to a folder listing
 * that has exactly that name, `zekno.app.json` counts only when its folder
 * lists it exactly so. On a disk that ignores letter case, as macOS has by
 * default, `ZEKNO.APP.JSON` is found under the name `zekno.app.json`; it must
 * not be read as settings there either, so that one folder gives the same
 * choice on every machine. On a disk that heeds case the same expectations
 * hold of themselves, but `init`, which there can add `zekno.app.json`
 * beside the other file, and the test says which disk it ran on.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createEffects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { readSettingsFile } from "../../src/settings/file"
import { chooseSource, settingsFileIn } from "../../src/settings/source"
import { IN7, SH1, SH2 } from "../../src/settings/words"
import { answering, COMPOSE_V1, machine, ready } from "../support/helpers"
import { DESIGN_FILE } from "../support/settings-files"

type Machine = ReturnType<typeof machine>

/** Whether the disk the temporary folders are on takes two names that differ in letter case for one. */
function ignoresCase(): boolean {
  const folder = mkdtempSync(join(tmpdir(), "zekno-case-"))
  try {
    writeFileSync(join(folder, "Probe"), "")
    return existsSync(join(folder, "probe"))
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
const INSENSITIVE = ignoresCase()

/** The plain run of `zekno <args>`: its status and what it wrote on each stream. */
async function piped(m: Machine, ...args: string[]) {
  m.out.length = 0
  m.err.length = 0
  const code = await m.zekno(...args)
  return { code, out: [...m.out], err: [...m.err] }
}

describe(`zekno.app.json by its exact name (this disk ${INSENSITIVE ? "ignores" : "heeds"} letter case)`, () => {
  test("a folder with only ZEKNO.APP.JSON has no settings file: chooseSource, the reader, every settings command, the deploy", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "ZEKNO.APP.JSON"), DESIGN_FILE)
    expect(settingsFileIn(m.project)).toBe(false)
    expect(chooseSource(m.project, {})).toEqual({
      kind: "compose",
      source: { kind: "default", folder: m.project },
    })
    expect(() =>
      readSettingsFile({ kind: "default", folder: m.project }, m.project)
    ).toThrow("No settings file at zekno.app.json.")
    for (const args of [
      ["settings"],
      ["settings", "--json"],
      ["settings", "compose"],
      ["settings", "set", "web.memory", "2g", "--yes"],
    ])
      expect({ args, run: await piped(m, ...args) }).toEqual({
        args,
        run: { code: 1, out: [], err: [SH1] },
      })
    const deploy = await piped(m, "deploy", "--app", "demo", "--server", "dev")
    expect(deploy.code).toBe(1)
    expect(deploy.err.join("\n")).toContain(
      "compose.yaml. Point to one with `-f <file>`."
    )
    expect(m.docker.calls()).toEqual([])
  }, 60_000)

  test("Zekno.App.Json beside compose.yaml is not both: the Compose file decides, with no question", async () => {
    const m = machine()
    writeFileSync(join(m.project, "Zekno.App.Json"), DESIGN_FILE)
    m.compose(COMPOSE_V1)
    expect(chooseSource(m.project, {}).kind).toBe("compose")
    expect(await piped(m, "settings")).toEqual({
      code: 1,
      out: [],
      err: [SH2("compose.yaml")],
    })
  })

  test("a zekno.json naming zekno.app.json, with ZEKNO.APP.JSON in its folder: no such file", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    rmSync(join(m.project, "zekno.app.json"))
    writeFileSync(join(m.project, "ZEKNO.APP.JSON"), DESIGN_FILE)
    const run = await piped(m, "settings", "compose")
    expect(run.code).toBe(1)
    expect(run.out).toEqual([])
    expect(run.err.join("\n")).toContain(
      "names zekno.app.json, and there is no such file in"
    )
  }, 60_000)

  test("the settings screen: SH1", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    writeFileSync(join(m.project, "ZEKNO.APP.JSON"), DESIGN_FILE)
    const events: AppEvent[] = []
    const effects = createEffects(
      m.deps,
      (event) => events.push(event),
      (error) => {
        throw error
      },
      undefined,
      {},
      await loadStart(m.deps)
    )
    effects.run({
      kind: "read-settings",
      server: "dev",
      app: "demo",
      deployed: false,
    })
    for (let tries = 0; events.length === 0 && tries < 100; tries++)
      await Bun.sleep(5)
    expect(events).toEqual([
      {
        type: "settings-read",
        server: "dev",
        app: "demo",
        outcome: { kind: "sentence", sentence: SH1 },
      },
    ])
    await effects.close()
  }, 60_000)

  test("init: on a disk that ignores case the name is taken, IN7 before any question and nothing written; on one that heeds it, zekno.app.json is made beside", async () => {
    const m = machine()
    writeFileSync(join(m.project, "ZEKNO.APP.JSON"), DESIGN_FILE)
    const asking = answering(m, [
      { type: "ghcr.io/acme/web:1" },
      { type: "web" },
    ])
    m.err.length = 0
    const code = await m.zekno("settings", "init")
    if (INSENSITIVE) {
      expect(code).toBe(1)
      expect(m.err).toEqual([IN7])
      expect(asking.asked).toEqual([])
      expect(readdirSync(m.project)).toEqual(["ZEKNO.APP.JSON"])
    } else {
      expect(code).toBe(0)
      expect(readdirSync(m.project).sort()).toEqual([
        "ZEKNO.APP.JSON",
        "zekno.app.json",
      ])
    }
  })
})
