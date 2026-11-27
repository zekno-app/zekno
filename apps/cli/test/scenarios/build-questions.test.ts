/**
 * The questions before signing a deploy that builds (specs/016-build-from-source,
 * contracts/cli.md CL5, "The questions" and "Kept answers"; FR-015a, FR-015b;
 * tasks T127), at a stand-in terminal and with no terminal: B24 once for a
 * folder whose settings file came with it, B26 for each secret-looking file
 * `source.include` names and once for each `.git` entry, C19 with no
 * terminal, and `agreed.json` written by a typed yes alone. The server is
 * this repository's runner with the stand-in Docker, `builder`, `builds` and
 * `deploy` answered as CO12 gives them (test/support/build-session.ts). A
 * temporary `ZEKNO_HOME` and `memoryKeyStore()`, never the real keychain.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import type { Build, Envelope } from "@workspace/core"

import { NOTHING_DONE } from "../../src/cli/errors"
import { packFolder } from "../../src/pack/chunks"
import { readIgnoreFile } from "../../src/pack/ignore"
import { walkFolder } from "../../src/pack/walk"
import { readAgreed } from "../../src/profile/agreed"
import {
  builderAnswer,
  buildsAnswer,
  payloadOf,
  standInSessions,
  started,
} from "../support/build-session"
import { answering, ready } from "../support/helpers"

type Machine = Awaited<ReturnType<typeof ready>>

const WHERE = ["--app", "shop", "--server", "dev"]
const DOCKERFILE = "FROM alpine:3.20\nCOPY . /app\n"
/** A private key's first line, written at run time: the repository's own files hold none. */
const KEY = `-----BEGIN ${"RSA"} PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----\n`

function write(folder: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
}

/** A ready machine whose folder came with its settings file (a cloned repository's), building `web`. */
async function cloned(
  files: Record<string, string>,
  source: Record<string, unknown> = {}
): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  const web = {
    ...(Object.keys(source).length === 0 ? {} : { source }),
    build: { builder: "dockerfile" },
  }
  write(m.project, {
    Dockerfile: DOCKERFILE,
    ...files,
    "zekno.app.json": `${JSON.stringify({ zekno: 1, services: { web } }, null, 2)}\n`,
  })
  return m
}

/** The stand-in server: it can build, keeps nothing, and starts what it is handed. */
const server = (m: Machine) =>
  standInSessions(m.deps, {
    answer: {
      builder: () => builderAnswer(),
      builds: () => buildsAnswer("shop"),
      deploy: started,
    },
  })

/** The pack signed by the last deploy. */
function signedPack(stand: ReturnType<typeof server>): Build["pack"] {
  const input = stand.inputs("deploy").at(-1) as { envelope: Envelope }
  return (payloadOf(input.envelope).builds as Build[])[0]!.pack
}

/** The fingerprint of the folder's pack, `include`'s entries sent or not. */
async function packOf(
  m: Machine,
  include: string[],
  sent: boolean
): Promise<string> {
  const root = realpathSync(m.project)
  const walk = walkFolder(root, {
    dockerfile: "Dockerfile",
    ignore: readIgnoreFile(root, {
      builder: "dockerfile",
      dockerfile: "Dockerfile",
    }),
    include,
    agreed: () => sent,
    zeknoHome: m.home,
  })
  return (await packFolder(walk, { seal: null })).hash
}

const agreedFile = (m: Machine) => join(m.home, "agreed.json")

describe("at a terminal", () => {
  test("a settings file that came with the folder: B24 once, before the session, and kept for the next deploy", async () => {
    const m = await cloned({})
    const stand = server(m)
    const asking = answering(m, [{ yes: true }])
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(asking.asked).toEqual([{ kind: "confirm", question: "B24" }])
    expect(readAgreed(m.home).folders).toEqual([
      {
        folder: realpathSync(m.project),
        settings: realpathSync(join(m.project, "zekno.app.json")),
      },
    ])
    expect(stand.commands()).toContain("deploy")

    const again = answering(m, [])
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(again.asked).toEqual([])
  }, 60_000)

  test("no to B24: Nothing was done, exit status 1, no connection, nothing kept", async () => {
    const m = await cloned({})
    const stand = server(m)
    answering(m, [{ yes: false }])
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual([NOTHING_DONE])
    expect(stand.connections()).toBe(0)
    expect(existsSync(agreedFile(m))).toBe(false)
  }, 60_000)

  test("certs/server.key named in source.include: B26, then sent after the yes", async () => {
    const include = ["certs/server.key"]
    const m = await cloned({ "certs/server.key": KEY }, { include })
    const stand = server(m)
    const asking = answering(m, [{ yes: true }, { yes: true }])
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(asking.asked).toEqual([
      { kind: "confirm", question: "B24" },
      { kind: "confirm", question: "B26" },
    ])
    expect(readAgreed(m.home).files).toEqual([
      { folder: realpathSync(m.project), path: "certs/server.key" },
    ])
    const signed = signedPack(stand).hash
    expect(signed).toBe(await packOf(m, include, true))
    expect(signed).not.toBe(await packOf(m, include, false))
  }, 60_000)

  test("no to B26: Nothing was done, nothing signed, only B24's yes kept", async () => {
    const m = await cloned(
      { "certs/server.key": KEY },
      { include: ["certs/server.key"] }
    )
    const stand = server(m)
    answering(m, [{ yes: true }, "leave"])
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual([NOTHING_DONE])
    expect(stand.connections()).toBe(0)
    expect(readAgreed(m.home).files).toEqual([])
    expect(readAgreed(m.home).folders.length).toBe(1)
  }, 60_000)

  test(".git named: B26 once for each entry, each kept by its entry", async () => {
    const include = [".git/HEAD", ".git/config"]
    const m = await cloned(
      {
        ".git/HEAD": "ref: refs/heads/main\n",
        ".git/config": "[core]\n\trepositoryformatversion = 0\n",
      },
      { include }
    )
    const stand = server(m)
    const asking = answering(m, [{ yes: true }, { yes: true }, { yes: true }])
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(asking.asked).toEqual([
      { kind: "confirm", question: "B24" },
      { kind: "confirm", question: "B26" },
      { kind: "confirm", question: "B26" },
    ])
    expect(
      readAgreed(m.home)
        .files.map((entry) => entry.path)
        .sort()
    ).toEqual(include)
    expect(signedPack(stand).hash).toBe(await packOf(m, include, true))
  }, 60_000)
})

describe("with no terminal", () => {
  test("C19 for a file no one agreed to, and for .git, exit status 1, before any connection", async () => {
    const m = await cloned(
      { "certs/server.key": KEY },
      { include: ["certs/server.key"] }
    )
    const stand = server(m)
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual(["C19"])
    expect(stand.connections()).toBe(0)
    // Its sealed pieces went with this run's folder.
    expect(readdirSync(join(m.home, "tmp"))).toEqual([])

    const git = await cloned(
      { ".git/config": "[core]\n\tbare = false\n" },
      { include: [".git/config"] }
    )
    const gitStand = server(git)
    git.err.length = 0
    expect(await git.zekno("deploy", ...WHERE)).toBe(1)
    expect(git.err).toEqual(["C19"])
    expect(gitStand.connections()).toBe(0)
  }, 60_000)

  test("a file named by the second of two services that share one build still stops the deploy: C19", async () => {
    const m = await ready()
    rmSync(join(m.project, "compose.yaml"))
    const build = { builder: "dockerfile" }
    write(m.project, {
      Dockerfile: DOCKERFILE,
      "certs/server.key": KEY,
      "zekno.app.json": `${JSON.stringify({
        zekno: 1,
        services: {
          web: { build },
          worker: { source: { include: ["certs/server.key"] }, build },
        },
      })}\n`,
    })
    const stand = server(m)
    m.err.length = 0
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    expect(m.err).toEqual(["C19"])
    expect(stand.connections()).toBe(0)
  }, 60_000)

  test("a file agreed to at a terminal is sent with no terminal, and B24 is never asked", async () => {
    const m = await cloned(
      { "certs/server.key": KEY },
      { include: ["certs/server.key"] }
    )
    const stand = server(m)
    answering(m, [{ yes: true }, { yes: true }])
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    m.deps.ui = { ...m.deps.ui, asks: false }
    expect(await m.zekno("deploy", ...WHERE)).toBe(0)
    expect(stand.inputs("deploy").length).toBe(2)

    const fresh = await cloned({})
    server(fresh)
    expect(await fresh.zekno("deploy", ...WHERE)).toBe(0)
    expect(existsSync(agreedFile(fresh))).toBe(false)
  }, 60_000)

  test("--yes leaves agreed.json as it was", async () => {
    const m = await cloned(
      { "certs/server.key": KEY },
      { include: ["certs/server.key"] }
    )
    server(m)
    expect(await m.zekno("deploy", ...WHERE, "--yes")).toBe(1)
    expect(m.lastErr()).toBe("C19")
    expect(existsSync(agreedFile(m))).toBe(false)

    answering(m, [{ yes: true }, "leave"])
    expect(await m.zekno("deploy", ...WHERE)).toBe(1)
    const before = readFileSync(agreedFile(m))
    m.deps.ui = { ...m.deps.ui, asks: false }
    expect(await m.zekno("deploy", ...WHERE, "--yes")).toBe(1)
    expect(readFileSync(agreedFile(m))).toEqual(before)
  }, 60_000)
})
