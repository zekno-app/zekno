import { describe, expect, test } from "bun:test"
import {
  createSigner,
  createTeam,
  generateMemberKeyPair,
  LIMITS,
} from "@workspace/core"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { runner } from "../../../runner/test/support/helpers"
import { historyFile, payloadOf } from "../support/deploys"
import { COMPOSE_V2, machine, ready } from "../support/helpers"
import { asReleased } from "../support/older-runner"

const where = ["--app", "web", "--server", "dev"]

/** A stand-in for a runner that answers every command with the same line. */
const answering = (line: string) => [
  "sh",
  "-c",
  `cat >/dev/null; printf '%s\\n' '${line}'`,
]

describe("the profile folder is not trusted", () => {
  test("the profile holds no copy of the team's trust, only signed lists", async () => {
    const m = await ready()
    const profile = JSON.parse(
      readFileSync(join(m.home, "profile.json"), "utf8")
    )
    expect(Object.keys(profile).sort()).toEqual([
      "keyName",
      "memberName",
      "rosters",
      "servers",
    ])
    // A local server is stored as a folder. No command to run is ever read from the file.
    expect(profile.servers[0].target).toEqual({
      kind: "local",
      home: m.runnerHome,
    })
  })

  test("team lists swapped for another team's are refused", async () => {
    const m = await ready()
    const mallory = createSigner(generateMemberKeyPair().secretKey)
    const other = await createTeam({ founderName: "Mallory", signer: mallory })
    m.tamper("profile.json", (profile) => ({
      ...profile,
      rosters: [other.envelope],
      servers: [],
    }))
    for (const args of [
      ["server", "ls"],
      ["deploy", ...where],
      ["secret", "ls", ...where],
      ["status", "--server", "dev"],
    ]) {
      expect(await m.zekno(...args)).toBe(1)
      expect(m.lastErr()).toContain("not the one this machine's key belongs to")
    }
    expect(m.docker.calls()).toEqual([])
  })

  test("a team list that was altered or dropped is refused", async () => {
    const m = await ready()
    m.tamper("profile.json", (profile) => {
      const [founding, added] = profile.rosters
      return {
        ...profile,
        rosters: [founding, { ...added, payload: founding.payload }],
      }
    })
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toContain("could not be verified")

    const n = await ready()
    n.tamper("profile.json", (profile) => ({
      ...profile,
      rosters: profile.rosters.slice(0, 1),
    }))
    expect(await n.zekno("deploy", ...where)).toBe(1)
    expect(n.lastErr()).toContain("not in the signed team list")
  })

  test("a server the team never signed for cannot be slipped into the profile", async () => {
    const m = await ready()
    m.tamper("profile.json", (profile) => ({
      ...profile,
      servers: [
        ...profile.servers,
        {
          name: "extra",
          serverId: `srv_${"0".repeat(32)}`,
          target: { kind: "local", home: "/tmp/elsewhere" },
        },
      ],
    }))
    expect(await m.zekno("server", "ls")).toBe(1)
    expect(m.lastErr()).toContain(
      'names a server "extra" that is not in the signed team list'
    )
  })

  test("a profile written by an older version, with a command to run, is not used", async () => {
    const m = await ready()
    const marker = join(m.project, "ran")
    m.tamper("profile.json", (profile) => ({
      ...profile,
      servers: [
        {
          ...profile.servers[0],
          target: {
            kind: "local",
            home: m.runnerHome,
            command: ["touch", marker],
          },
        },
      ],
    }))
    expect(await m.zekno("status", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toContain("is damaged")
    expect(existsSync(marker)).toBe(false)
  })

  test("the profile folder is private, and files are written whole", async () => {
    const m = machine()
    mkdirSync(m.home, { recursive: true })
    chmodSync(m.home, 0o755)
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    expect(statSync(m.home).mode & 0o777).toBe(0o700)
    expect(statSync(join(m.home, "profile.json")).mode & 0o777).toBe(0o600)
    const { readdirSync } = await import("node:fs")
    expect(readdirSync(m.home).filter((name) => name.endsWith(".tmp"))).toEqual(
      []
    )
  })
})

describe("rollback only returns to a deploy the team signed", () => {
  async function twoDeploys() {
    const m = await ready()
    await m.zekno("deploy", ...where)
    m.compose(COMPOSE_V2)
    await m.zekno("deploy", ...where)
    const serverId = JSON.parse(
      readFileSync(join(m.home, "profile.json"), "utf8")
    ).servers[0].serverId as string
    return { m, history: `history/${serverId}/web.json`, serverId }
  }

  test("the history keeps the signed deploy, not a loose copy of the service definition", async () => {
    const { m, history } = await twoDeploys()
    const entries = JSON.parse(readFileSync(join(m.home, history), "utf8"))
    expect(entries.map((entry: object) => Object.keys(entry).sort())).toEqual([
      ["at", "envelope", "outcome"],
      ["at", "envelope", "outcome"],
    ])
    expect(entries.map((entry: { outcome: string }) => entry.outcome)).toEqual([
      "started",
      "started",
    ])
  })

  test("an entry whose content was changed is ignored, so its definition is never deployed", async () => {
    const { m, history } = await twoDeploys()
    const evil = Buffer.from(
      JSON.stringify({ compose: "services:\n  evil:\n    image: evil/miner\n" })
    ).toString("base64url")
    m.tamper(history, (entries) =>
      [
        {
          ...entries[0],
          payload: undefined,
          envelope: { ...entries[0].envelope, payload: evil },
        },
        entries[1],
      ].map(({ payload: _, ...entry }) => entry)
    )
    const before = m.docker.calls().length
    expect(await m.zekno("rollback", ...where)).toBe(1)
    expect(m.err.join("\n")).toContain(
      "Ignored 1 entry in the deploy history that could not be verified."
    )
    expect(m.lastErr()).toContain("only one deploy")
    expect(m.docker.calls().length).toBe(before)
  })

  test("a deploy signed for another app is not accepted as this app's history", async () => {
    const { m, history, serverId } = await twoDeploys()
    await m.zekno("deploy", "--app", "worker", "--server", "dev")
    const worker = JSON.parse(
      readFileSync(join(m.home, `history/${serverId}/worker.json`), "utf8")
    )
    m.tamper(history, (entries) => [worker[0], ...entries])
    m.err.length = 0
    expect(await m.zekno("rollback", ...where, "--to", "1")).toBe(0)
    expect(m.err.join("\n")).toContain("Ignored 1 entry")
    // Deploy 1 of web, not the worker's deploy 1.
    expect(
      readFileSync(join(m.runnerHome, "apps/web/compose.yaml"), "utf8")
    ).toContain("web:1")
  })

  test("`--app` and `--to` are checked before anything is read", async () => {
    const { m } = await twoDeploys()
    expect(
      await m.zekno("rollback", "--app", "../../etc", "--server", "dev")
    ).toBe(2)
    expect(await m.zekno("rollback", "--server", "dev")).toBe(2)
    for (const to of ["0", "-1", "1.5", "abc", "1e3", ""]) {
      expect(await m.zekno("rollback", ...where, `--to=${to}`)).toBe(2)
    }
  })
})

describe("the runner's answers are checked", () => {
  test("version 2: a deploy is made after the number the runner holds, even if the runner forgets what it accepted", async () => {
    const m = await ready()
    await m.zekno("deploy", ...where)
    await m.zekno("deploy", ...where)
    // The runner's memory goes back to before the second deploy.
    const statePath = join(m.runnerHome, "state.json")
    const state = JSON.parse(readFileSync(statePath, "utf8"))
    writeFileSync(
      statePath,
      JSON.stringify({ ...state, lastSequence: { web: 1 } }),
      { mode: 0o600 }
    )
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toContain("Deploy 2 of web")
    const last = JSON.parse(
      readFileSync(join(m.home, historyFile(m, "web")), "utf8")
    ).at(-1)
    expect(payloadOf(last.envelope)).toMatchObject({ previous: 1, sequence: 2 })
  })

  test("version 1: a deploy number is never signed twice, even if the runner forgets what it accepted", async () => {
    const m = await ready()
    await m.zekno("deploy", ...where)
    await m.zekno("deploy", ...where)
    // The runner's memory goes back to before the second deploy, as runner 0.1.0 keeps it; this zekno signs version 1 for it.
    asReleased(m, { web: 1 })
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(m.lastOut()).toContain("Deploy 3 of web")
    const last = JSON.parse(
      readFileSync(join(m.home, historyFile(m, "web")), "utf8")
    ).at(-1)
    expect(last.envelope.payloadType).toBe("zekno.deploy.v1")
    expect(payloadOf(last.envelope).sequence).toBe(3)
  })

  test("a runner far ahead of anything this machine signed is not followed", async () => {
    const m = await ready()
    await m.zekno("deploy", ...where)
    const real = await runner(m.runnerHome, m.docker.path, "status")
    m.deps.localRunner = answering(
      JSON.stringify({ ...real.json, lastSequence: { web: 500_000 } })
    )
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toContain(
      "far beyond the 1 this machine has signed. Nothing was signed."
    )
  })

  test("an answer for a different deploy than the one sent is not taken as success", async () => {
    const m = await ready()
    const real = await runner(m.runnerHome, m.docker.path, "status")
    for (const report of [
      { outcome: "started", app: "web", sequence: 7 },
      { outcome: "started", app: "other", sequence: 1 },
      { outcome: "ok" },
    ]) {
      // `status` gets the real answer; `apply` gets a report that does not match.
      m.deps.localRunner = [
        "sh",
        "-c",
        `cat >/dev/null; if [ "$0" = status ]; then printf '%s\\n' '${JSON.stringify(real.json)}'; else printf '%s\\n' '${JSON.stringify(report)}'; fi`,
      ]
      expect(await m.zekno("deploy", ...where)).toBe(1)
      expect(m.lastErr()).toContain("not known whether the deploy was accepted")
    }
    // Each attempt used its own number, and none is offered for rollback.
    const serverId = (real.json as { serverId: string }).serverId
    const entries = JSON.parse(
      readFileSync(join(m.home, `history/${serverId}/web.json`), "utf8")
    )
    expect(entries.map((entry: { outcome: string }) => entry.outcome)).toEqual([
      "sent",
      "sent",
      "sent",
    ])
    expect(await m.zekno("rollback", ...where)).toBe(1)
    expect(m.lastErr()).toContain("has not been deployed")
  })

  test("a runner that answers as another server is refused by `deploy` and by `status`", async () => {
    const m = await ready()
    const other = await ready()
    const foreign = await runner(other.runnerHome, other.docker.path, "status")
    m.deps.localRunner = answering(JSON.stringify(foreign.json))
    expect(await m.zekno("status", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toContain("answered as a different server")
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(m.lastErr()).toContain("answered as a different server")
  })

  test("an answer larger than a message may be is cut off", async () => {
    const m = await ready()
    m.deps.localRunner = [
      "sh",
      "-c",
      `cat >/dev/null; head -c ${LIMITS.messageBytes + 4096} /dev/zero`,
    ]
    expect(await m.zekno("status", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toContain("more than an answer can hold")
  })
})

describe("`server add` can be finished after it stopped half way", () => {
  test("a runner already set up for this team is added, not refused", async () => {
    const m = machine()
    await m.zekno("init", "--name", "Ada")
    const profile = JSON.parse(
      readFileSync(join(m.home, "profile.json"), "utf8")
    )
    const teamCode: string = JSON.parse(
      (await m.keyStore.get(profile.keyName))!
    ).teamCode
    // The first attempt got as far as setting the runner up, then stopped.
    const setup = await runner(m.runnerHome, m.docker.path, "setup", {
      founding: profile.rosters[0],
      teamCode,
    })
    expect(setup.code).toBe(0)

    expect(await m.zekno("server", "add", "dev", "--local")).toBe(0)
    expect(m.out.join("\n")).toContain("already set up for your team")
    m.compose("services:\n  web:\n    image: example/web:1\n")
    expect(await m.zekno("deploy", ...where)).toBe(0)
  })

  test("a runner set up for another team is still refused", async () => {
    const theirs = await ready()
    const m = machine()
    await m.zekno("init", "--name", "Mallory")
    expect(
      await m.zekno(
        "server",
        "add",
        "taken",
        "--local",
        "--home",
        theirs.runnerHome
      )
    ).toBe(1)
    expect(m.lastErr()).toContain("already belongs to a team")
    expect(await m.zekno("server", "ls")).toBe(0)
    expect(m.lastOut()).toBe("No servers connected yet.")
  })
})

describe("what may be typed", () => {
  test("a secret value is never accepted as an argument", async () => {
    const m = await ready()
    expect(
      await m.zekno("secret", "set", "GREETING", "demo-value", ...where)
    ).toBe(2)
    expect(m.lastErr()).toContain("never given as an argument")
    expect(await m.zekno("secret", "ls", ...where)).toBe(0)
    expect(m.lastOut()).toContain("has no secrets")
  })

  test("an empty value is not stored", async () => {
    const m = await ready()
    m.typing("")
    expect(await m.zekno("secret", "set", "GREETING", ...where)).toBe(1)
    expect(m.lastErr()).toBe("No value was given, so nothing was set.")
    expect(await m.zekno("secret", "ls", ...where)).toBe(0)
    expect(m.lastOut()).toContain("has no secrets")
  })

  test("nothing may trail a command", async () => {
    const m = await ready()
    for (const args of [
      ["deploy", "extra", ...where],
      ["status", "dev", "--server", "dev"],
      ["server", "ls", "more"],
      ["init", "Ada"],
    ]) {
      expect(await m.zekno(...args)).toBe(2)
      expect(m.lastErr()).toContain("Unexpected")
    }
  })
})
