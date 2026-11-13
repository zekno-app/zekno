import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { filesUnder, machine, ready } from "./helpers"

const SECRET = "demo-value-that-must-never-touch-a-disk"

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
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with 1 secret(s).")
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
