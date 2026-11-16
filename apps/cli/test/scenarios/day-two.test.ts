import { describe, expect, test } from "bun:test"

import { COMPOSE_V1, COMPOSE_V2, ready } from "../support/helpers"

const where = ["--app", "web", "--server", "dev"]

describe("User Story 3: change, roll back and retire", () => {
  test("setting a secret again raises its version and the next deploy carries the new value", async () => {
    const m = await ready()
    m.typing("demo-first")
    await m.zekno("secret", "set", "GREETING", ...where)
    await m.zekno("deploy", ...where)
    m.typing("demo-second")
    expect(await m.zekno("secret", "set", "GREETING", ...where)).toBe(0)
    expect(m.lastOut()).toContain("(version 2)")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.docker.calls().map((call) => call.env.GREETING)).toEqual([
      "demo-first",
      "demo-second",
    ])
  })

  test("rollback deploys the earlier definition under the next number, with the current secrets", async () => {
    const m = await ready()
    m.typing("demo-first")
    await m.zekno("secret", "set", "GREETING", ...where)
    await m.zekno("deploy", ...where)
    m.compose(COMPOSE_V2)
    m.typing("demo-second")
    await m.zekno("secret", "set", "GREETING", ...where)
    await m.zekno("deploy", ...where)

    expect(await m.zekno("rollback", ...where)).toBe(0)
    expect(m.lastOut()).toBe("Deploy 3 of web is running on dev with 1 secret.")
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    expect(
      readFileSync(join(m.runnerHome, "apps/web/compose.yaml"), "utf8")
    ).toBe(COMPOSE_V1)
    expect(m.docker.calls().at(-1)!.env.GREETING).toBe("demo-second")

    // Rolling back to a named deploy, and to one that does not exist.
    expect(await m.zekno("rollback", ...where, "--to", "2")).toBe(0)
    expect(
      readFileSync(join(m.runnerHome, "apps/web/compose.yaml"), "utf8")
    ).toBe(COMPOSE_V2)
    expect(await m.zekno("rollback", ...where, "--to", "99")).toBe(1)
    expect(m.lastErr()).toContain("No deploy numbered 99")
  })

  test("there is nothing to roll back to after a single deploy, or before any", async () => {
    const m = await ready()
    expect(await m.zekno("rollback", ...where)).toBe(1)
    expect(m.lastErr()).toContain("has not been deployed")
    await m.zekno("deploy", ...where)
    expect(await m.zekno("rollback", ...where)).toBe(1)
    expect(m.lastErr()).toContain("only one deploy")
  })

  test("a removed secret is gone from the app and the server remembers the removal", async () => {
    const m = await ready()
    m.typing("demo-keep")
    await m.zekno("secret", "set", "GREETING", ...where)
    m.typing("1")
    await m.zekno("secret", "set", "DEBUG_MODE", ...where)
    await m.zekno("deploy", ...where)
    expect(m.docker.calls().at(-1)!.env.DEBUG_MODE).toBe("1")

    expect(await m.zekno("secret", "rm", "DEBUG_MODE", ...where)).toBe(0)
    m.out.length = 0
    await m.zekno("secret", "ls", ...where)
    expect(m.out).toEqual(["GREETING\tversion 1"])
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.docker.calls().at(-1)!.env.DEBUG_MODE).toBeUndefined()
    expect(m.docker.calls().at(-1)!.env.GREETING).toBe("demo-keep")

    m.out.length = 0
    await m.zekno("status", "--server", "dev")
    expect(m.out).toContain("web/DEBUG_MODE\tversion 2 (removed)")

    // Removing it again, or removing something that never existed, is refused.
    expect(await m.zekno("secret", "rm", "DEBUG_MODE", ...where)).toBe(1)
    expect(await m.zekno("secret", "rm", "NEVER_SET", ...where)).toBe(1)
    expect(m.lastErr()).toContain("has no secret named NEVER_SET")

    // The name can be used again later, with a higher version.
    m.typing("0")
    expect(await m.zekno("secret", "set", "DEBUG_MODE", ...where)).toBe(0)
    expect(m.lastOut()).toContain("(version 3)")
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.docker.calls().at(-1)!.env.DEBUG_MODE).toBe("0")
  })

  test("secrets and deploy numbers are separate for each app", async () => {
    const m = await ready()
    m.typing("demo-web")
    await m.zekno("secret", "set", "TOKEN", "--app", "web", "--server", "dev")
    m.typing("demo-worker")
    await m.zekno(
      "secret",
      "set",
      "TOKEN",
      "--app",
      "worker",
      "--server",
      "dev"
    )
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy", "--app", "worker", "--server", "dev")).toBe(
      0
    )
    expect(m.lastOut()).toContain("Deploy 1 of worker")
    expect(m.docker.calls().map((call) => call.env.TOKEN)).toEqual([
      "demo-web",
      "demo-worker",
    ])
  })
})
