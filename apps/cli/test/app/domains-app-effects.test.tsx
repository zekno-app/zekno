/**
 * The Domains box of an app's screen, read through the app's effects as
 * app.tsx makes them (specs/015-domains-https, contracts/cli.md, CL6; line
 * E7; tasks T074), against the runner of this repository with the stand-in
 * Docker and the stand-in effects: opening the app screen, and the end of a
 * deploy of the app, read its rows as `zekno domain` fills them; an app with
 * no domain in the file or on the server, or a folder linked to another app,
 * gives no rows, and nothing is looked up for it (CL7).
 */
import { afterEach, describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { waitFor } from "../../../runner/test/support/helpers"
import { createStore } from "../../src/app/app"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { loadStart } from "../../src/app/effects/profile"
import type { AppEvent } from "../../src/app/state/events"
import { initialState } from "../../src/app/state/state"
import { shopFile } from "../support/domain-folders"
import { standIns } from "../support/domain-stand-ins"
import { ready, type machine } from "../support/helpers"

type Machine = ReturnType<typeof machine>
const SIZE = { columns: 100, rows: 30 }

const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** A ready machine whose folder is shop's settings file, `web` added to its web, linked to shop on dev. */
async function shopFolder(web: Record<string, unknown>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), shopFile(web))
  expect(await m.zekno("link", "--app", "shop", "--server", "dev")).toBe(0)
  m.docker.app("shop", { web: 1, worker: 1 })
  return m
}

/** The app on `m`, as app.tsx makes it, every event kept. */
async function appOn(m: Machine) {
  const events: AppEvent[] = []
  const failures: unknown[] = []
  const start = await loadStart(m.deps)
  let effects: Effects | undefined
  const store = createStore(initialState(start, SIZE), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(
    m.deps,
    (event) => {
      events.push(event)
      store.dispatch(event)
    },
    (error) => failures.push(error),
    undefined,
    {},
    start
  )
  opened.push(effects)
  const read = () =>
    events.filter(
      (event): event is Extract<AppEvent, { type: "app-domains" }> =>
        event.type === "app-domains"
    )
  return {
    events,
    failures,
    get state() {
      return store.get()
    },
    /** Opens the app screen of `app` on dev, and waits for its Domains box to be read. */
    async open(app: string) {
      const before = read().length
      effects!.run({ kind: "open-app", server: "dev", app })
      await waitFor(() => read().length > before, "the Domains box")
      return read().at(-1)!
    },
    d: async () => {
      const before = read().length
      effects!.run({ kind: "deploy", server: "dev", app: "shop" })
      await waitFor(() => store.get().deploy?.running === false, "the end")
      await waitFor(() => read().length > before, "the Domains box again")
      return read().at(-1)!
    },
  }
}

describe("the Domains box through the app's effects (E7)", () => {
  test("the end of a deploy with a domain reads the box: each domain and its state as zekno domain finds it", async () => {
    const m = await shopFolder({
      networking: { domains: ["shop.example.com", "www.example.com"] },
    })
    standIns(m.deps)
    const app = await appOn(m)
    // Before any deploy the server holds nothing for shop: both are in the file, not deployed.
    expect(await app.open("shop")).toEqual({
      type: "app-domains",
      server: "dev",
      app: "shop",
      rows: [
        {
          domain: "shop.example.com",
          state: "not-deployed",
          words: "not deployed",
        },
        {
          domain: "www.example.com",
          state: "not-deployed",
          words: "not deployed",
        },
      ],
    })
    expect((await app.d()).rows).toEqual([
      { domain: "shop.example.com", state: "live", words: "live" },
      { domain: "www.example.com", state: "live", words: "live" },
    ])
    // Asked again from this machine each time the screen opens: www no longer answers.
    standIns(m.deps, { https: { "www.example.com": [{ state: "none" }] } })
    expect((await app.open("shop")).rows).toEqual([
      { domain: "shop.example.com", state: "live", words: "live" },
      { domain: "www.example.com", state: "down", words: "not answering" },
    ])
    expect(app.state.appDomains?.rows).toHaveLength(2)
    expect(app.failures).toEqual([])
  }, 60_000)

  test("an app with no domain, in the file or deployed: no rows, and nothing looked up", async () => {
    const m = await shopFolder({})
    const asked = standIns(m.deps)
    const app = await appOn(m)
    expect((await app.open("shop")).rows).toEqual([])
    expect((await app.d()).rows).toEqual([])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect(app.failures).toEqual([])
  }, 60_000)

  test("a folder linked to another app has no file for it; a folder with a Compose file written by hand has none either", async () => {
    const m = await shopFolder({
      networking: { domains: ["shop.example.com"] },
    })
    const asked = standIns(m.deps)
    const app = await appOn(m)
    expect((await app.open("other")).rows).toEqual([])
    rmSync(join(m.project, "zekno.app.json"))
    writeFileSync(
      join(m.project, "compose.yaml"),
      "services:\n  web:\n    image: nginx\n"
    )
    expect((await app.open("shop")).rows).toEqual([])
    expect(asked).toEqual({ ssh: [], dns: [], https: [] })
    expect(app.failures).toEqual([])
  }, 60_000)
})
