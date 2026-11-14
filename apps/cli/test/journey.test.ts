import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { tempDir, waitFor } from "../../runner/test/helpers"
import { createStore } from "../src/app/app"
import { createEffects, loadStart, type Effects } from "../src/app/effects"
import { emptyHiddenValue, hiddenPromptKey } from "../src/app/hidden-prompt"
import type { AppKey } from "../src/app/keys"
import { hiddenPromptOpen, initialState, top } from "../src/app/state"
import { filesUnder, machine, ready } from "./helpers"

const SECRET = "demo-value-that-must-never-touch-a-disk"

/** Every file under each folder, read as text; one that went away while it was read is left out. */
function everyFile(folders: readonly string[]) {
  return folders.flatMap((folder) => {
    try {
      return filesUnder(folder)
    } catch {
      return []
    }
  })
}

describe("User Story 1: first deploy to my own server", () => {
  test("from nothing to a running app with a secret", async () => {
    const m = machine()

    // A key and a team.
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    expect(m.out.join("\n")).toMatch(/Team code: [0-9A-Z]{4}(-[0-9A-Z]{4}){4}/)
    expect(m.keyStore.size()).toBe(1)

    // A server: the runner sets itself up, and is added to the signed team list.
    expect(await m.zekno("server", "add", "dev", "--local")).toBe(0)
    expect(m.out.join("\n")).toMatch(/Server code: [0-9A-Z]{4}(-[0-9A-Z]{4}){4}/)
    m.out.length = 0
    expect(await m.zekno("server", "ls")).toBe(0)
    expect(m.lastOut()).toMatch(/^dev\tthis machine\tsrv_[0-9a-f]{32}$/)

    // A secret: only the signed, encrypted record is kept.
    m.typing(SECRET)
    expect(await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toContain("Set GREETING (version 1)")
    m.out.length = 0
    expect(await m.zekno("secret", "ls", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["GREETING\tversion 1"])

    // A deploy.
    m.compose("services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n")
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with 1 secret.")
    const [call] = m.docker.calls()
    expect(call!.args).toContain("compose -p zekno-web")
    expect(call!.env.GREETING).toBe(SECRET)

    // Status, with whether the app is running, as Docker says.
    m.docker.ps("web", '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n')
    m.out.length = 0
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    expect(m.out).toEqual(["dev: team list version 2", "web\tdeploy 1\trunning", "web/GREETING\tversion 1"])
    m.out.length = 0
    expect(await m.zekno("status", "--server", "dev", "--json")).toBe(0)
    expect(JSON.parse(m.lastOut())).toMatchObject({
      server: "dev",
      lastSequence: { web: 1 },
      secrets: { "web/GREETING": { version: 1, removed: false } },
      apps: { web: { state: "running", services: [{ service: "web", state: "running", exitCode: 0, health: "" }] } },
    })
  })

  test("SC-004: no private key and no secret value is in any file either program wrote", async () => {
    const m = await ready()
    m.typing(SECRET)
    await m.zekno("secret", "set", "GREETING", "--app", "web", "--server", "dev")
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)

    const entry = await m.keyStore.get(JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).keyName)
    const signingKey: string = JSON.parse(entry!).secretKey
    expect(signingKey).toStartWith("zk_msk_")

    const files = filesUnder(m.home) // the profile folder, with the runner's folder inside it
    expect(files.length).toBeGreaterThan(4)
    const serverKeyFiles = files.filter((file) => file.content.includes("zk_ssk_"))
    for (const file of files) {
      expect(file.content).not.toContain(SECRET)
      expect(file.content).not.toContain(Buffer.from(SECRET).toString("base64url"))
      // No member signing key anywhere, in the profile or on the server.
      expect(file.content).not.toContain("zk_msk_")
      expect(file.content).not.toContain(signingKey.slice(7, 40))
    }
    // The server's own key is in exactly one file, readable only by its owner.
    expect(serverKeyFiles.map((file) => file.path)).toEqual([join(m.runnerHome, "server.key")])
    expect(serverKeyFiles[0]!.mode).toBe(0o600)
    // Nothing in the profile folder itself is a server key.
    expect(files.filter((file) => !file.path.startsWith(join(m.home, "runner"))).some((file) => file.content.includes("zk_ssk_"))).toBe(false)
  })

  test("SC-008 after the app: opened, deployed, a secret typed at the hidden prompt, state and logs read, the folder linked; no key, team code or value in any file", async () => {
    const VALUE = "app-value-that-must-never-touch-a-disk"
    const LOG = "log-line-that-is-shown-and-never-kept"
    const earlier = new Set(readdirSync(tmpdir()))
    const m = machine()
    // The runner's temporary folder is one of this run's, so it is read below with the others.
    const runnerTemp = tempDir("runner-temp")
    m.deps.localRunner = ["env", `TMPDIR=${runnerTemp}`, ...m.deps.localRunner]
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const teamCode = /Team code: (\S+)/.exec(m.out.join("\n"))![1]!
    expect(await m.zekno("server", "add", "dev", "--local")).toBe(0)
    m.compose("services:\n  web:\n    image: example/web:1\n    environment:\n      - GREETING\n")
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    m.docker.ps("web", '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n')
    m.docker.logs("web", `web-1  | 2026-11-14T21:52:03.000000001Z ${LOG}\n`, { follow: true })

    // The app, as `zekno` opens it at a terminal: the reducer and the effects, against the runner.
    const failures: unknown[] = []
    let effects: Effects | undefined
    const store = createStore(initialState(await loadStart(m.deps), { columns: 100, rows: 30 }), (effect) => {
      if (effect.kind !== "exit") effects!.run(effect)
    })
    effects = createEffects(m.deps, store.dispatch, (error) => failures.push(error))
    const press = (key: AppKey) => store.dispatch({ type: "key", key })
    const type = (text: string) => [...text].forEach((char) => press({ kind: "text", text: char }))
    const held = emptyHiddenValue()
    const hidden = (input: string, key = {}) => hiddenPromptKey(held, input, key, store.get(), store.dispatch, effects!.saveSecret)
    try {
      // The app's screen: its history, and what is running, read when it opens.
      press({ kind: "right" })
      press({ kind: "enter" })
      await waitFor(() => store.get().appView?.app === "web", "web's history")
      await waitFor(() => store.get().team?.servers[0]?.apps[0]?.state === "running", "web's state")

      // A secret, typed into the hidden prompt.
      type("s")
      type("GREETING")
      press({ kind: "enter" })
      expect(hiddenPromptOpen(store.get())).toBe(true)
      for (const char of VALUE) hidden(char)
      hidden("\r", { return: true })
      await waitFor(() => top(store.get()).name === "app" && store.get().notice?.tone === "success", "the value to be stored")

      // A deploy of this folder: yes to "remember this folder?" writes zekno.json, accepted in links.json.
      type("d")
      await waitFor(() => store.get().question?.kind === "remember-folder", "the question to remember the folder")
      press({ kind: "enter" })
      await waitFor(() => store.get().deploy?.running === false, "the deploy to end")
      expect(store.get().deploy?.outcome).toBe("started")
      expect(m.docker.calls().at(-1)!.env.GREETING).toBe(VALUE)
      press({ kind: "escape" })

      // Its logs, followed, then left.
      type("l")
      await waitFor(() => {
        const screen = top(store.get())
        return screen.name === "logs" && screen.lines.some((line) => line.line === LOG)
      }, "the log line")
      press({ kind: "escape" })
      // And what is running, read again on Home at its next refresh.
      press({ kind: "escape" })
      expect(top(store.get()).name).toBe("home")
      m.docker.ps("web", '{"Service":"web","State":"exited","ExitCode":1,"Health":""}\n')
      store.dispatch({ type: "tick" })
      await waitFor(() => store.get().team?.servers[0]?.apps[0]?.state === "stopped", "Home to read web's state again")
    } finally {
      await effects.close()
    }
    expect(failures).toEqual([])
    expect(existsSync(join(m.project, "zekno.json"))).toBe(true)
    expect(existsSync(join(m.home, "links.json"))).toBe(true)

    const entry = await m.keyStore.get(JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).keyName)
    const signingKey: string = JSON.parse(entry!).secretKey
    // Every folder this run wrote to: the profile folder (the runner's folder is inside it), the
    // project folder, the runner's temporary folder, and any other temporary folder made since the
    // run began. The stand-in Docker's own folder is left out: it notes the environment it was given
    // (the value, as the runner hands it to Docker), which real Docker does not write anywhere.
    const made = readdirSync(tmpdir()).filter((name) => !earlier.has(name) && name.startsWith("zekno-"))
    const folders = [m.home, m.project, runnerTemp, ...made.map((name) => join(tmpdir(), name))].filter((folder) => folder !== dirname(m.docker.path))
    const files = everyFile(folders)
    expect(files.map((file) => file.path)).toEqual(expect.arrayContaining([join(m.project, "zekno.json"), join(m.home, "links.json"), join(m.runnerHome, "state.json")]))
    for (const file of files) {
      for (const kept of [VALUE, Buffer.from(VALUE).toString("base64url"), "zk_msk_", signingKey.slice(7, 40), teamCode, teamCode.replaceAll("-", ""), LOG]) {
        expect([file.path, file.content.includes(kept)]).toEqual([file.path, false])
      }
    }
    // zekno.json holds three names and nothing else.
    expect(JSON.parse(readFileSync(join(m.project, "zekno.json"), "utf8"))).toEqual({ app: "web", server: "dev", compose: "compose.yaml" })
  }, 30_000)

  test("machine-readable deploy result", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev", "--json")).toBe(0)
    expect(JSON.parse(m.lastOut())).toEqual({ outcome: "started", app: "web", sequence: 1, server: "dev" })
  })

  test("when the app does not start, the developer is told and the number is not reused", async () => {
    const m = await ready()
    m.docker.failWith(1)
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toContain("was accepted by dev, but the app did not start")
    m.docker.failWith(0)
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toContain("Deploy 2 of web")
  })
})
