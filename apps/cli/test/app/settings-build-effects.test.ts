/**
 * A Build row written from the settings screen (specs/016-build-from-source,
 * lines.md J18; contracts/cli.md CL1, "Values refused by set"; tasks T137):
 * the write effect holds the value to the rules `zekno settings set` holds
 * it to, the reach of a root among them, checked against the file it reads
 * (build-reach.ts): a root beyond it is G20's root form, and the file is as
 * it was; a root inside the folder is written. Ids are checked, never words
 * (FR-092). Keys in a memory key store and a temporary profile folder.
 */
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createEffects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { settingsText } from "../../src/settings/text"
import type { Settings } from "../../src/settings/types"
import { ready } from "../support/helpers"

const BUILT: Settings = {
  version: 1,
  services: [["web", { build: { builder: "dockerfile" }, port: 3000 }]],
}

/** A ready machine whose folder holds the settings of one built service, and the effects of the app opened there. */
async function builtFolder() {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  mkdirSync(join(m.project, "app"))
  const text = settingsText(BUILT)
  const file = join(m.project, "zekno.app.json")
  writeFileSync(file, text)
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
  /** Writes `root` as the screen asks it, with the SHA-256 the file was read with; the event that answers. */
  const writeRoot = async (root: string): Promise<AppEvent> => {
    const before = events.length
    effects.run({
      kind: "write-setting",
      server: "dev",
      app: "demo",
      path: { service: "web", key: "root" },
      value: root,
      sha256: createHash("sha256").update(text).digest("hex"),
    })
    for (let tries = 0; events.length === before && tries < 100; tries++)
      await Bun.sleep(5)
    return events[before]!
  }
  return { file, text, writeRoot }
}

describe("a Build row written from the settings screen", () => {
  test("a root beyond its reach is G20's root form, and the file is as it was", async () => {
    const folder = await builtFolder()
    expect(await folder.writeRoot("..")).toMatchObject({
      type: "setting-refused",
      notice: { tone: "error", text: "G20" },
    })
    expect(readFileSync(folder.file, "utf8")).toBe(folder.text)
  }, 60_000)

  test("a root inside the folder is written", async () => {
    const folder = await builtFolder()
    expect(await folder.writeRoot("app")).toMatchObject({
      type: "setting-written",
    })
    expect(readFileSync(folder.file, "utf8")).toContain('"root": "app"')
  }, 60_000)
})
