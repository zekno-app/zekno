import { describe, expect, test } from "bun:test"
import { LIMITS } from "@workspace/core"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  connect,
  RUNNER_PATH,
  SSH_DESTINATION,
} from "../../src/server/transport"
import { machine, ready } from "../support/helpers"

const where = ["--app", "web", "--server", "dev"]

describe("edge cases", () => {
  test("commands before `init` say what to run first and create nothing", async () => {
    const m = machine()
    for (const args of [
      ["server", "ls"],
      ["deploy", ...where],
      ["secret", "ls", ...where],
      ["status", "--server", "dev"],
    ]) {
      expect(await m.zekno(...args)).toBe(1)
      expect(m.lastErr()).toContain("zekno init")
    }
    expect(m.keyStore.size()).toBe(0)
  })

  test("a second `init` does not replace the team or the key", async () => {
    const m = await ready()
    expect(await m.zekno("init", "--name", "Mallory")).toBe(1)
    expect(m.lastErr()).toContain("already exists")
    expect(m.keyStore.size()).toBe(1)
  })

  test("when the keychain is unavailable there is no fallback to a file", async () => {
    const m = machine()
    m.deps.keyStore = {
      get: async () => null,
      delete: async () => {},
      set: async () => {
        throw new Error("no keychain")
      },
    }
    expect(await m.zekno("init", "--name", "Ada")).toBe(1)
    expect(m.lastErr()).toContain("keychain is not available")
    const { existsSync } = await import("node:fs")
    expect(existsSync(join(m.home, "profile.json"))).toBe(false)
  })

  test("a missing signing key is reported, not worked around", async () => {
    const m = await ready()
    m.deps.keyStore = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    }
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toContain("signing key is not in the system keychain")
  })

  test("unknown servers and apps, and badly formed names", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "web", "--server", "nope")).toBe(1)
    expect(m.lastErr()).toBe('No server named "nope". Connected servers: dev.')
    expect(await m.zekno("deploy", "--server", "dev")).toBe(2)
    expect(await m.zekno("deploy", "--app", "Web App", "--server", "dev")).toBe(
      2
    )
    expect(await m.zekno("server", "add", "Bad Name", "--local")).toBe(2)
    expect(await m.zekno("server", "add", "dev", "--local")).toBe(1)
    expect(m.lastErr()).toContain("already connected")
    expect(await m.zekno("server", "add", "other")).toBe(2)
    expect(
      await m.zekno("server", "add", "other", "--local", "--ssh", "a@b")
    ).toBe(2)
  })

  test("the same runner cannot be connected twice", async () => {
    const m = await ready()
    expect(
      await m.zekno("server", "add", "again", "--local", "--home", m.runnerHome)
    ).toBe(1)
    expect(m.lastErr()).toBe('That server is already connected as "dev".')
  })

  test("a missing, empty or oversized Compose file is refused before anything is signed", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where, "-f", "missing.yaml")).toBe(1)
    expect(m.lastErr()).toContain("No Compose file")
    m.compose("   \n", "empty.yaml")
    expect(await m.zekno("deploy", ...where, "-f", "empty.yaml")).toBe(1)
    expect(m.lastErr()).toContain("is empty")
    writeFileSync(
      join(m.project, "big.yaml"),
      "x".repeat(LIMITS.composeBytes + 1)
    )
    expect(await m.zekno("deploy", ...where, "-f", "big.yaml")).toBe(1)
    expect(m.lastErr()).toContain("larger than")
    expect(m.docker.calls()).toEqual([])
  })

  test("reserved and illegal secret names, and values that are too large", async () => {
    const m = await ready()
    for (const name of ["PATH", "HOME", "DOCKER_HOST", "COMPOSE_FILE"]) {
      expect(await m.zekno("secret", "set", name, ...where)).toBe(1)
      expect(m.lastErr()).toContain("is reserved")
    }
    // A name that cannot be stored is refused before the value is asked for (no value is queued here),
    // and what was typed is not repeated: it may be the value itself.
    for (const name of [
      "1BAD",
      "DB_PASSWORD=hunter2",
      "sk-live-51HxQzY",
      "A".repeat(LIMITS.secretNameLength + 1),
    ]) {
      expect(await m.zekno("secret", "set", name, ...where)).toBe(1)
      expect(m.lastErr()).toBe(
        "A secret name uses letters, digits and underscore, and does not start with a digit."
      )
    }
    m.typing("x".repeat(LIMITS.secretValueBytes + 1))
    expect(await m.zekno("secret", "set", "BIG", ...where)).toBe(1)
    expect(m.lastErr()).toContain("64 KiB")
    expect(await m.zekno("secret", "set", ...where)).toBe(2)
  })

  test("wrong usage exits with status 2 and points to the help", async () => {
    const m = await ready()
    for (const args of [
      ["frobnicate"],
      ["deploy", "--nonsense"],
      ["server", "explode"],
      [],
    ]) {
      expect(await m.zekno(...args)).toBe(2)
    }
    expect(await m.zekno("--help")).toBe(0)
    expect(m.lastOut()).toContain("zekno deploy")
  })

  test("a damaged profile is reported, not silently replaced", async () => {
    const m = await ready()
    writeFileSync(join(m.home, "profile.json"), "{ not json")
    expect(await m.zekno("server", "ls")).toBe(1)
    expect(m.lastErr()).toContain("not readable")
  })

  test("an unreachable or broken runner is an error, not a hang or a crash", async () => {
    const m = await ready()
    m.deps.localRunner = ["/nonexistent/zekno-runner"]
    expect(await m.zekno("server", "add", "ghost", "--local")).toBe(1)
    m.deps.localRunner = ["sh", "-c", "echo not-json"]
    expect(await m.zekno("server", "add", "ghost", "--local")).toBe(1)
    expect(m.lastErr()).toContain("did not answer as expected")
  })

  test("an SSH destination or runner path can never be read as an option or a shell command", async () => {
    const m = await ready()
    for (const destination of [
      "-oProxyCommand=evil",
      "host;rm -rf /",
      "host name",
      "$(evil)",
      "a b@host",
      "",
    ]) {
      expect(SSH_DESTINATION.test(destination)).toBe(false)
      if (destination) {
        // `--ssh=<value>` so that a value starting with a dash reaches the check at all.
        expect(
          await m.zekno("server", "add", "prod", `--ssh=${destination}`)
        ).toBe(1)
        expect(m.lastErr()).toContain("not valid")
      }
    }
    for (const path of [
      "zekno-runner; evil",
      "$(evil)",
      "a b",
      "`evil`",
      "x|y",
      "x&&y",
    ]) {
      expect(RUNNER_PATH.test(path)).toBe(false)
      expect(
        await m.zekno(
          "server",
          "add",
          "prod",
          "--ssh",
          "me@host",
          `--runner-path=${path}`
        )
      ).toBe(1)
    }
    for (const good of [
      "me@example.com",
      "deploy@10.0.0.4",
      "host",
      "me@host:2222",
    ])
      expect(SSH_DESTINATION.test(good)).toBe(true)
    // A stored target that was tampered with is rejected when used.
    expect(() =>
      connect(
        {
          kind: "ssh",
          destination: "-oProxyCommand=evil",
          runnerPath: "zekno-runner",
        },
        []
      )
    ).toThrow()
  })
})
