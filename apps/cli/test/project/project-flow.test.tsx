import { afterEach, describe, expect, test } from "bun:test"
import { renderToString, type Key } from "ink"
import { createLink, createSigner, generateMemberKeyPair, proposeRoster, type Member, type TeamTrust } from "@workspace/core"
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { tempDir, waitFor } from "../../../runner/test/support/helpers"
import { acceptedLinks } from "../../src/project/accepted"
import { AppView, createStore } from "../../src/app/app"
import { createEffects, type Effects } from "../../src/app/effects/effects"
import { LINK_CHANGED, linkedElsewhere, NOT_IN_USE } from "../../src/app/effects/links"
import { loadStart } from "../../src/app/effects/profile"
import { emptyHiddenValue, hiddenPromptKey } from "../../src/app/hidden-prompt"
import type { AppKey } from "../../src/app/keys"
import { nameWindow } from "../../src/app/screens/set-secret"
import { NOT_DEPLOYED } from "../../src/app/state/questions"
import { hiddenPromptOpen, top } from "../../src/app/state/reading"
import { initialState, update } from "../../src/app/state/state"
import type { State } from "../../src/app/state/types"
import { openTeam, type OpDeps } from "../../src/cli/context"
import { MISSING_APP, MISSING_SERVER } from "../../src/cli/errors"
import { findProject, signerOf } from "../../src/project/project"
import { connect } from "../../src/server/transport"
import { COMPOSE_V1, COMPOSE_V2, filesUnder, machine, ready, twin } from "../support/helpers"

type Machine = ReturnType<typeof machine>

/** A Compose file that expects two values, one listed with no value and one used in another, and has one of its own. */
const COMPOSE_TWO =
  "services:\n  web:\n    image: example/web:1\n    environment:\n      - DATABASE_URL\n      - AUTH=${SESSION_KEY}\n      - GREETING=hello\n    command: echo $$HOME $HOME ${PORT:-80}\n"
/** One that expects nothing. */
const COMPOSE_PLAIN = "services:\n  web:\n    image: example/web:1\n"

/** Writes zekno.json by hand, as a repository from someone outside the team brings it: it carries no signature. */
const link = (m: Machine, content: unknown, folder = m.project) =>
  writeFileSync(join(folder, "zekno.json"), typeof content === "string" ? content : JSON.stringify(content))
/**
 * Links a folder as a person in the team does: `zekno link` with the names,
 * which signs zekno.json with this member's key and records it as used here.
 * Before signed links these tests wrote the file by hand and accepted it with
 * `zekno link` and no names; a file written by hand is not signed now.
 */
async function linkHere(m: Machine, names: { app: string; server: string; compose?: string }, folder = m.project) {
  const cwd = m.deps.cwd
  m.deps.cwd = folder
  try {
    const file = names.compose === undefined ? [] : ["-f", names.compose]
    expect(await m.zekno("link", "--app", names.app, "--server", names.server, ...file, "--force")).toBe(0)
    expect(m.lastOut()).toStartWith("Wrote ")
  } finally {
    m.deps.cwd = cwd
  }
}
const deployed = (m: Machine, app: string) => readFileSync(join(m.runnerHome, "apps", app, "compose.yaml"), "utf8")
/**
 * The project folder as zekno finds it: the folders a program is in are
 * real paths, and temporary folders on macOS are reached through a link.
 */
const folderOf = (m: Machine) => realpathSync(m.project)
const fileOf = (m: Machine) => join(folderOf(m), "zekno.json")

const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
/** The key hints: the last line drawn, without the margins. */
const lastLine = (screen: string) => screen.trimEnd().split("\n").at(-1)!.trim()
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (screen: string) => screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

describe("single commands in a linked folder", () => {
  test("`zekno deploy` with no flags takes the app, the server and the Compose file from zekno.json, also from a sub-folder", async () => {
    const m = await ready()
    mkdirSync(join(m.project, "deploy"))
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V2)
    await linkHere(m, { app: "web", server: "dev", compose: "deploy/prod.yaml" })
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)

    // From a folder below, the same file applies, and its Compose file is found from the file's own folder.
    m.deps.cwd = join(m.project, "deploy")
    writeFileSync(join(m.project, "deploy", "prod.yaml"), COMPOSE_V1)
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V1)
    expect(m.docker.calls()).toHaveLength(2)
  })

  test("flags win over the file, one detail at a time, and its Compose file goes only with its own app", async () => {
    const m = await ready()
    const WEB = COMPOSE_V1.replace("web:1", "web-from-zekno-json:1")
    m.compose(WEB, "web.yaml")
    m.compose(COMPOSE_V2, "other.yaml")
    await linkHere(m, { app: "web", server: "dev", compose: "web.yaml" })
    // Another app: the server from the file, the Compose file as without one (compose.yaml here), never web.yaml.
    expect(await m.zekno("deploy", "--app", "api")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of api is running on dev with no secrets.")
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    // The file's own app, named or not, deploys the file's Compose file; -f wins over it.
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(deployed(m, "web")).toBe(WEB)
    expect(await m.zekno("deploy", "-f", "other.yaml")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 2 of web is running on dev with no secrets.")
    expect(deployed(m, "web")).toBe(COMPOSE_V2)
    // A server typed on the command line is the typist's: the sentence does not blame the file.
    expect(await m.zekno("deploy", "--server", "prod")).toBe(1)
    expect(m.lastErr()).toBe('No server named "prod". Connected servers: dev.')
  })

  test("a zekno.json in a folder above does not hand its Compose file to another app below it", async () => {
    const m = await ready()
    m.compose("services:\n  rootsvc:\n    image: example/root:1\n", "root.yaml")
    await linkHere(m, { app: "web", server: "dev", compose: "root.yaml" })
    const billing = join(m.project, "services", "billing")
    mkdirSync(billing, { recursive: true })
    const BILLING = "services:\n  billing:\n    image: example/billing:1\n"
    writeFileSync(join(billing, "compose.yaml"), BILLING)
    m.deps.cwd = billing
    expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
    expect(deployed(m, "billing")).toBe(BILLING)
  })

  test("secret, status, rollback and logs take their defaults from it too; the value is asked for with the app and server named", async () => {
    const m = await ready()
    await linkHere(m, { app: "web", server: "dev" })
    const asked: string[] = []
    const ask = m.deps.ui.askSecret
    m.deps.ui.askSecret = (question, stdin) => (asked.push(question), ask(question, stdin))
    m.typing("hello")
    expect(await m.zekno("secret", "set", "GREETING")).toBe(0)
    expect(asked).toEqual(["Value for GREETING (web on dev): "])
    expect(m.lastOut()).toBe("Set GREETING (version 1) for web on dev. It takes effect on the next deploy.")
    m.out.length = 0
    expect(await m.zekno("secret", "ls")).toBe(0)
    expect(m.out).toEqual(["GREETING\tversion 1"])
    expect(await m.zekno("deploy")).toBe(0)
    m.compose(COMPOSE_V2)
    expect(await m.zekno("deploy")).toBe(0)

    m.out.length = 0
    expect(await m.zekno("status")).toBe(0)
    expect(m.out[0]).toBe("dev: team list version 2")
    expect(m.out).toContain("web\tdeploy 2\tstopped")

    expect(await m.zekno("rollback")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 3 of web is running on dev with 1 secret.")
    expect(deployed(m, "web")).toBe(COMPOSE_V1)

    m.docker.logs("web", "web-1  | 2026-11-14T21:52:03Z hello\n")
    m.out.length = 0
    expect(await m.zekno("logs", "--no-follow")).toBe(0)
    expect(m.out).toEqual(["2026-11-14T21:52:03Z\tweb\thello"])

    expect(await m.zekno("secret", "rm", "GREETING")).toBe(0)
    expect(m.lastOut()).toBe("Removed GREETING from web on dev. It takes effect on the next deploy.")
  })

  test("each command reads the keychain once: judging zekno.json and the work itself share one verified team", async () => {
    const m = await ready()
    await linkHere(m, { app: "web", server: "dev" })
    let reads = 0
    const get = m.keyStore.get
    m.keyStore.get = (key) => (reads++, get(key))
    m.docker.logs("web", "web-1  | 2026-11-14T21:52:03Z hello\n")
    m.typing("hello")
    const runs = [
      ["secret", "set", "GREETING"],
      ["secret", "ls"],
      ["deploy"],
      ["deploy"],
      ["deploy", "--app", "web", "--server", "dev"],
      ["status"],
      ["rollback"],
      ["logs", "--no-follow"],
      ["secret", "rm", "GREETING"],
      ["link"],
    ]
    for (const args of runs) {
      reads = 0
      const status = await m.zekno(...args)
      expect({ args, status, reads }).toEqual({ args, status: 0, reads: 1 })
    }
  })

  test("a server it names that this machine does not know stops the command, naming the file and the server; nothing is signed", async () => {
    const m = await ready()
    // Accepted while prod was connected; prod has since been taken off this machine's profile.
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    await linkHere(m, { app: "web", server: "prod" })
    m.tamper("profile.json", (profile) => ({ ...profile, servers: profile.servers.filter((server: { name: string }) => server.name !== "prod") }))
    for (const args of [["deploy"], ["rollback"], ["status"], ["secret", "ls"], ["logs", "--no-follow"]]) {
      expect(await m.zekno(...args)).toBe(1)
      expect(m.lastErr()).toBe(`${fileOf(m)} names a server "prod" that is not connected to this machine. Connected servers: dev.`)
    }
    expect(m.docker.calls()).toEqual([])
    expect(existsSync(join(m.home, "history"))).toBe(false)
  })

  test("a file that is malformed, names an app outside the pattern, or a Compose file that is missing or leads outside, stops the command", async () => {
    const m = await ready()
    const path = fileOf(m)
    const cases: [unknown, string][] = [
      ["{ app: web", `${path} is not valid JSON.`],
      [{ app: "web", server: "dev", extra: true }, `${path} has a field zekno does not read: "extra". It holds only "app", "server", "compose" and "signed".`],
      [{ app: "../../etc", server: "dev" }, `${path} needs "app": an app name of lowercase letters, digits and hyphens.`],
      [{ app: "web", server: "dev", compose: "../compose.yaml" }, `${path} has a "compose" that is not a relative path inside its folder.`],
      ['{"app":"web","server":"dev","app":"api"}', `${path} has the same field more than once.`],
    ]
    for (const [content, sentence] of cases) {
      link(m, content)
      expect(await m.zekno("deploy")).toBe(1)
      expect(m.lastErr()).toBe(sentence)
    }
    // Accepted with its Compose file in place; the file then goes, or is swapped for a link out of the folder.
    m.compose(COMPOSE_V1, "linked.yaml")
    await linkHere(m, { app: "web", server: "dev", compose: "linked.yaml" })
    rmSync(join(m.project, "linked.yaml"))
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.lastErr()).toBe(`${path} names linked.yaml as the Compose file, and there is no such file in ${folderOf(m)}.`)
    // A Compose file reached through a link out of the folder is never read or sent.
    const outside = join(tempDir("outside"), "private.yaml")
    writeFileSync(outside, "services:\n  leak:\n    image: private\n")
    symlinkSync(outside, join(m.project, "linked.yaml"))
    expect(await m.zekno("deploy")).toBe(1)
    expect(m.lastErr()).toBe(`linked.yaml, named by ${path}, leads outside the folder that holds it. zekno does not follow it there.`)
    expect(m.docker.calls()).toEqual([])

    // Given every detail as a flag, the command never reads the file.
    link(m, "{ app: web")
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev", "-f", "compose.yaml")).toBe(0)
  })

  test("without a project file, a missing detail is wrong usage naming the flag and the project file, and nothing is asked", async () => {
    const m = await ready()
    const cases: [string[], string][] = [
      [["deploy"], MISSING_SERVER],
      [["deploy", "--server", "dev"], MISSING_APP],
      [["rollback", "--app", "web"], MISSING_SERVER],
      [["status"], MISSING_SERVER],
      [["logs", "--server", "dev"], MISSING_APP],
      [["secret", "set", "API_KEY", "--server", "dev"], MISSING_APP],
      [["secret", "rm", "API_KEY", "--app", "web"], MISSING_SERVER],
      [["secret", "ls"], MISSING_SERVER],
    ]
    for (const [args, sentence] of cases) {
      expect(await m.zekno(...args)).toBe(2)
      expect(m.lastErr()).toBe(`${sentence}\nRun \`zekno --help\` for the list of commands.`)
    }
    expect(m.docker.calls()).toEqual([])
  })

  test("with no zekno.json, a compose.yaml that is a link out of the folder is not sent; -f names a file anywhere", async () => {
    const m = await ready()
    const outside = join(tempDir("outside"), "private.yaml")
    writeFileSync(outside, "services:\n  leak:\n    image: private\n")
    rmSync(join(m.project, "compose.yaml"))
    symlinkSync(outside, join(m.project, "compose.yaml"))
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe("compose.yaml leads outside this folder through a symbolic link, so zekno does not read it. To deploy that file, name it with `-f <file>`.")
    expect(m.docker.calls()).toEqual([])
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev", "-f", outside)).toBe(0)
    // A named pipe in its place is not waited on.
    rmSync(join(m.project, "compose.yaml"))
    Bun.spawnSync(["mkfifo", join(m.project, "compose.yaml")])
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1)
    expect(m.lastErr()).toBe(`${join(m.project, "compose.yaml")} is not a file.`)
  })
})

/** What the commands below are run with: each that takes its app or server from zekno.json. `secret set` would ask for a value. */
const COMMANDS = [["deploy"], ["rollback"], ["secret", "set", "X"], ["secret", "rm", "X"], ["secret", "ls"], ["status"], ["logs", "--no-follow"]]

/** A Compose file the owner of a folder wrote to take the app's secret. */
const HOSTILE = "services:\n  exfil:\n    image: attacker/exfil:1\n    environment:\n      - DB_PASSWORD\n"

/** The server's id, as the profile holds it. */
const serverIdOf = (m: Machine, name = "dev"): string =>
  JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).servers.find((server: { name: string }) => server.name === name).serverId

/**
 * api on dev, deployed with a secret from this machine, and a folder of
 * someone else's whose compose.yaml wants that secret. Every runner process
 * a command starts, every read of the keychain and every question asked is
 * counted, and so is what this machine keeps (history, secrets, links.json).
 */
async function apiAndAFolder(name: string) {
  const m = await ready()
  m.compose("services:\n  api:\n    image: example/api:1\n    environment:\n      - DB_PASSWORD\n")
  m.typing("hunter2-prod-db")
  expect(await m.zekno("secret", "set", "DB_PASSWORD", "--app", "api", "--server", "dev")).toBe(0)
  expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
  const folder = tempDir(name)
  writeFileSync(join(folder, "compose.yaml"), HOSTILE)
  let started = 0
  m.deps.connect = (...args) => (started++, connect(...args))
  let keychain = 0
  const get = m.keyStore.get
  m.keyStore.get = (key) => (keychain++, get(key))
  const asked: string[] = []
  const confirm = m.deps.ui.confirm
  m.deps.ui.confirm = (question, refusal) => (asked.push(question), confirm(question, refusal))
  /** What this machine keeps, as it stands: nothing a refused command does may change it. */
  const kept = () => filesUnder(m.home).filter((file) => !file.path.startsWith(m.runnerHome)).map((file) => [file.path, file.content])
  return { m, folder, started: () => started, keychain: () => keychain, asked, kept }
}

describe("a zekno.json not signed by the team (the reviewer's scenario, P1)", () => {
  /** A folder cloned from someone outside the team: its zekno.json names api on dev, and carries no signature. */
  async function cloned() {
    const scene = await apiAndAFolder("cloned")
    writeFileSync(join(scene.folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev" }))
    scene.m.deps.cwd = scene.folder
    return scene
  }
  const notSigned = (folder: string) =>
    `zekno.json in ${realpathSync(folder)} is not signed by your team, so zekno does not use it. It names api on dev. ` +
    "To link this folder yourself, run `zekno link --app <name> --server <name> --force`. To leave the file aside, give --app and --server."

  test("every command that would take a name from it stops with status 2 and says why; nothing is asked, signed, sent or started", async () => {
    const { m, folder, started, keychain, asked, kept } = await cloned()
    const before = kept()
    const ups = m.docker.calls().length
    m.typing("sk_live_typed_here")
    for (const args of COMMANDS) {
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toStartWith(notSigned(folder))
    }
    // The keychain is read once by each, to verify the team list the file is judged against, and never again: no signer was made.
    expect(keychain()).toBe(COMMANDS.length)
    expect(asked).toEqual([])
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(kept()).toEqual(before)
    // Nothing was asked for: the value queued for the prompt is still there.
    m.deps.cwd = m.project
    m.deps.connect = connect
    expect(await m.zekno("secret", "set", "STRIPE_KEY", "--app", "api", "--server", "dev")).toBe(0)
    expect(m.lastOut()).toStartWith("Set STRIPE_KEY (version 1)")
  })

  test("each way a file is not signed by the team: S1 and status 2, nothing sent, and `zekno link` with no names refuses it", async () => {
    const { m, folder, started, asked, kept } = await cloned()
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    /** zekno.json as `zekno link` signs it in a folder of its own, for `server`, read back. */
    const signedBy = async (who: Machine, server = "dev") => {
      const own = tempDir("signed")
      writeFileSync(join(own, "compose.yaml"), HOSTILE)
      const cwd = who.deps.cwd
      who.deps.cwd = own
      expect(await who.zekno("link", "--app", "api", "--server", server)).toBe(0)
      who.deps.cwd = cwd
      return JSON.parse(readFileSync(join(own, "zekno.json"), "utf8"))
    }
    const ours = await signedBy(m)
    const forProd = await signedBy(m, "prod")
    // Another team, with a server of its own also named dev.
    const mallory = machine()
    expect(await mallory.zekno("init", "--name", "Mallory")).toBe(0)
    expect(await mallory.zekno("server", "add", "dev", "--local")).toBe(0)
    const theirs = await signedBy(mallory)
    // This team's deploy and secret, as this machine keeps them.
    const history = JSON.parse(readFileSync(join(m.home, "history", serverIdOf(m), "api.json"), "utf8"))
    const secrets = JSON.parse(readFileSync(join(m.home, "secrets", serverIdOf(m), "api.json"), "utf8"))
    const cases: [string, unknown][] = [
      ["no signature", { app: "api", server: "dev", compose: "compose.yaml" }],
      ["signed by another team", theirs],
      ["the app edited after signing", { ...ours, app: "web" }],
      ["the server edited after signing", { ...ours, server: "prod" }],
      ["the Compose file edited after signing", { ...ours, compose: "other.yaml" }],
      ["a deploy of this team in `signed`", { app: "api", server: "dev", compose: "compose.yaml", signed: history[0].envelope }],
      ["a secret of this team in `signed`", { app: "api", server: "dev", compose: "compose.yaml", signed: secrets.records[0].envelope }],
      ["signed for a server of another name", { ...forProd, server: "dev" }],
    ]
    writeFileSync(join(folder, "other.yaml"), HOSTILE)
    const before = kept()
    const ups = m.docker.calls().length
    const starts = started()
    for (const [what, content] of cases) {
      writeFileSync(join(folder, "zekno.json"), JSON.stringify(content))
      const named = (content as { app: string; server: string }).app
      const sentence = notSigned(folder).replace("It names api on dev.", `It names ${named} on ${(content as { server: string }).server}.`)
      expect({ what, status: await m.zekno("deploy") }).toEqual({ what, status: 2 })
      expect({ what, said: m.lastErr() }).toEqual({ what, said: `${sentence}\nRun \`zekno --help\` for the list of commands.` })
      expect({ what, status: await m.zekno("link") }).toEqual({ what, status: 2 })
      expect({ what, said: m.lastErr().split("\n")[0] }).toEqual({ what, said: sentence })
    }
    expect(asked).toEqual([])
    expect(started()).toBe(starts)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(kept()).toEqual(before)
  })

  test("signed by a member then removed from the team: it counted while she was in it, and is not signed by the team after", async () => {
    const { m, folder, started } = await cloned()
    const grace = createSigner(generateMemberKeyPair().secretKey)
    const withGrace = await changeTeam(m, (trust) => [...trust.members, { name: "Grace", publicKey: grace.publicKey, role: "deployer" }])
    const signed = await createLink({ trust: withGrace, serverId: serverIdOf(m), app: "api", compose: "compose.yaml", signer: grace })
    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev", compose: "compose.yaml", signed }))
    expect(await m.zekno("status")).toBe(2)
    expect(m.lastErr()).toStartWith(`Grace linked ${realpathSync(folder)} to api on dev, and it has not been used in this folder on this machine.`)
    await changeTeam(m, (trust) => trust.members.filter((member) => member.name !== "Grace"))
    for (const args of [["status"], ["link"]]) {
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toStartWith(notSigned(folder))
    }
    expect(started()).toBe(0)
  })

  test("given --app and --server, it is left aside, Compose file and all; linked here with names, it is signed and used", async () => {
    const { m, folder, asked } = await cloned()
    writeFileSync(join(folder, "compose.yaml"), COMPOSE_V1)
    writeFileSync(join(folder, "other.yaml"), HOSTILE)
    writeFileSync(join(folder, "zekno.json"), JSON.stringify({ app: "api", server: "dev", compose: "other.yaml" }))
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    // `zekno link` with no names does not make it the team's.
    expect(await m.zekno("link")).toBe(2)
    expect(acceptedLinks(m.home)).toEqual([])
    // With names and --force, it is replaced by a file signed here, and used.
    expect(await m.zekno("link", "--app", "api", "--server", "dev", "--force")).toBe(0)
    expect(JSON.parse(readFileSync(join(folder, "zekno.json"), "utf8"))).toMatchObject({ app: "api", server: "dev", compose: "compose.yaml" })
    expect(await m.zekno("deploy")).toBe(0)
    expect(deployed(m, "api")).toBe(COMPOSE_V1)
    expect(asked).toEqual([])
    // A hand edit, as a `git pull` could bring: not signed any more.
    const text = readFileSync(join(folder, "zekno.json"), "utf8")
    writeFileSync(join(folder, "zekno.json"), text.replace('"compose": "compose.yaml"', '"compose": "other.yaml"'))
    expect(await m.zekno("deploy")).toBe(2)
    expect(m.lastErr()).toStartWith(notSigned(folder))
  })

  test("given --app and --server, a zekno.json that cannot be read is left aside too, and the folder's compose.yaml is deployed", async () => {
    const m = await ready()
    symlinkSync("/etc/hosts", join(m.project, "zekno.json"))
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
    expect(deployed(m, "web")).toBe(COMPOSE_V1)
    // A command that would take a name from it still stops, and names it.
    expect(await m.zekno("deploy", "--app", "web")).toBe(1)
    expect(m.lastErr()).toContain("is a symbolic link")
  })

  test("`zekno link` given one name never fills the other from a file not signed by the team, nor from one not used here: it stops with status 2 and writes nothing", async () => {
    const { m, folder } = await cloned()
    const sub = join(folder, "services", "api")
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, "compose.yaml"), COMPOSE_V1)
    m.deps.cwd = sub
    for (const args of [["--app", "api"], ["--server", "dev"], ["-f", "compose.yaml"], ["--app", "api", "--force"]]) {
      expect({ args, status: await m.zekno("link", ...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toStartWith(notSigned(folder))
    }
    // In its own folder too.
    m.deps.cwd = folder
    expect(await m.zekno("link", "--app", "api")).toBe(2)
    expect(existsSync(join(sub, "zekno.json"))).toBe(false)
    expect(acceptedLinks(m.home)).toEqual([])

    // Signed by the team in another folder and copied here: not used here yet, so it fills nothing either.
    const own = tempDir("own")
    writeFileSync(join(own, "compose.yaml"), COMPOSE_V1)
    m.deps.cwd = own
    expect(await m.zekno("link", "--app", "api", "--server", "dev")).toBe(0)
    copyFileSync(join(own, "zekno.json"), join(folder, "zekno.json"))
    m.deps.cwd = sub
    expect(await m.zekno("link", "--app", "api")).toBe(2)
    expect(m.lastErr()).toStartWith(`Ada linked ${realpathSync(folder)} to api on dev, and it has not been used in this folder on this machine.`)
    // Both names typed take nothing from it.
    expect(await m.zekno("link", "--app", "api", "--server", "dev")).toBe(0)
    expect(JSON.parse(readFileSync(join(sub, "zekno.json"), "utf8"))).toMatchObject({ app: "api", server: "dev", compose: "compose.yaml" })
    // Once it is used here (`zekno link --yes`, in its folder, with no terminal to ask on), one name fills from it.
    rmSync(join(sub, "zekno.json"))
    m.deps.cwd = folder
    expect(await m.zekno("link", "--yes")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: api on dev, file compose.yaml.")
    m.deps.cwd = sub
    expect(await m.zekno("link", "--server", "dev", "--app", "worker")).toBe(0)
    rmSync(join(sub, "zekno.json"))
    expect(await m.zekno("link", "--app", "worker")).toBe(0)
    expect(JSON.parse(readFileSync(join(sub, "zekno.json"), "utf8"))).toMatchObject({ app: "worker", server: "dev" })
  })

  test("in the app, Home does not move to its app, says why on the problem line, and d deploys nothing and offers nothing", async () => {
    const { m, folder, started } = await cloned()
    const ups = m.docker.calls().length
    const deps: OpDeps = { ...m.deps, connect: m.deps.connect }
    const app = openApp(m, await loadStart(deps), deps)
    const sentence = "zekno.json here is not signed by your team, so zekno does not use it. It names api on dev."
    expect(app.state.linked).toBeUndefined()
    expect(app.state.question).toBeUndefined()
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    expect(app.state.notice).toEqual({ tone: "error", text: sentence })
    expect(words(app.draw())).toContain(sentence)
    expect(words(app.draw())).not.toContain("This folder is linked")
    app.press({ kind: "right" })
    app.type("d")
    await Bun.sleep(150)
    expect(app.state.notice).toEqual({ tone: "error", text: sentence })
    expect(app.state.question).toBeUndefined()
    expect(top(app.state).name).toBe("home")
    expect(app.state.deploy).toBeUndefined()
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(readFileSync(join(folder, "zekno.json"), "utf8")).toBe(JSON.stringify({ app: "api", server: "dev" }))
    expect(app.failures).toEqual([])
  })
})

describe("a zekno.json signed by the team, copied into another folder (the copy)", () => {
  /**
   * api on dev deployed with its secret from this machine's own folder, which
   * `zekno link` signed; its zekno.json copied byte for byte into a folder of
   * someone else's, beside a Compose file that takes the secret.
   */
  async function copied() {
    const scene = await apiAndAFolder("copy")
    const { m, folder } = scene
    expect(await m.zekno("link", "--app", "api", "--server", "dev")).toBe(0)
    copyFileSync(join(m.project, "zekno.json"), join(folder, "zekno.json"))
    expect(readFileSync(join(folder, "zekno.json"))).toEqual(readFileSync(join(m.project, "zekno.json")))
    m.deps.cwd = folder
    return scene
  }
  const QUESTION = "Ada linked this folder to api on dev. Use it here?"
  const s2 = (folder: string) =>
    `Ada linked ${realpathSync(folder)} to api on dev, and it has not been used in this folder on this machine. ` +
    "To use it, run `zekno link` there once and answer its question, or `zekno link --yes` from a script. To leave it aside, give --app and --server."

  test("at a terminal the question names who linked it and to what; no stops with status 1, and nothing is recorded, signed, sent or started", async () => {
    const { m, started, asked, kept } = await copied()
    m.deps.ui.confirm = async (question) => (asked.push(question), false)
    const before = kept()
    const ups = m.docker.calls().length
    m.typing("sk_live_typed_here")
    for (const args of COMMANDS) {
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 1 })
      expect(m.lastErr()).toBe("Nothing was done.")
    }
    expect(asked).toEqual(COMMANDS.map(() => QUESTION))
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(kept()).toEqual(before)
    expect(await m.deps.ui.askSecret("", false)).toBe("sk_live_typed_here")
  })

  test("with no terminal every command stops with status 2 and says who linked it and how to use it; nothing is sent or started", async () => {
    const { m, folder, started, asked, kept } = await copied()
    const before = kept()
    const ups = m.docker.calls().length
    m.typing("sk_live_typed_here")
    for (const args of COMMANDS) {
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toBe(`${s2(folder)}\nRun \`zekno --help\` for the list of commands.`)
    }
    // The plain interface was asked, and could not ask anyone.
    expect(asked).toEqual(COMMANDS.map(() => QUESTION))
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(kept()).toEqual(before)
    expect(await m.deps.ui.askSecret("", false)).toBe("sk_live_typed_here")
  })

  test("yes at a terminal records it and goes on; it is not asked again; each run reads the keychain once", async () => {
    const { m, folder, asked, keychain } = await copied()
    const reads = keychain()
    m.deps.ui.confirm = async (question) => (asked.push(question), true)
    expect(await m.zekno("status")).toBe(0)
    expect(m.out).toContain("api\tdeploy 1\tstopped")
    expect(await m.zekno("status")).toBe(0)
    expect(asked).toEqual([QUESTION])
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toContain(join(realpathSync(folder), "zekno.json"))
    expect(keychain() - reads).toBe(2)
  })

  test("`zekno link` there asks the same question before it records anything, also given the file's own names; no records nothing, and the next command asks again", async () => {
    const { m, folder, started, asked, kept } = await copied()
    const text = readFileSync(join(folder, "zekno.json"), "utf8")
    const before = kept()
    m.deps.ui.confirm = async (question) => (asked.push(question), false)
    for (const args of [[], ["--app", "api", "--server", "dev"]]) {
      expect({ args, status: await m.zekno("link", ...args) }).toEqual({ args, status: 1 })
      expect(m.lastErr()).toBe("Nothing was done.")
    }
    expect(await m.zekno("deploy")).toBe(1)
    expect(asked).toEqual([QUESTION, QUESTION, QUESTION])
    expect(kept()).toEqual(before)
    expect(started()).toBe(0)

    // Yes: recorded as it is, never rewritten, and `zekno deploy` then asks nothing.
    m.deps.ui.confirm = async (question) => (asked.push(question), true)
    expect(await m.zekno("link")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: api on dev, file compose.yaml.")
    expect(readFileSync(join(folder, "zekno.json"), "utf8")).toBe(text)
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toContain(join(realpathSync(folder), "zekno.json"))
    expect(asked).toHaveLength(4)
    m.deps.ui.confirm = async (question) => (asked.push(question), false)
    expect(await m.zekno("deploy")).toBe(0)
    expect(deployed(m, "api")).toBe(HOSTILE)

    // In use here now: `zekno link` says so and changes nothing, not even links.json.
    const links = statSync(join(m.home, "links.json"))
    for (const args of [[], ["--app", "api", "--server", "dev"]]) {
      expect({ args, status: await m.zekno("link", ...args) }).toEqual({ args, status: 0 })
      expect(m.lastOut()).toBe("Already in use: zekno.json, api on dev, file compose.yaml.")
    }
    const after = statSync(join(m.home, "links.json"))
    expect([after.ino, after.mtimeMs]).toEqual([links.ino, links.mtimeMs])
    expect(asked).toHaveLength(4)
  })

  test("with no terminal `zekno link` there stops with status 2 and names --yes; with --yes it records the file", async () => {
    const { m, folder, started, asked, kept } = await copied()
    const before = kept()
    const refusal = `There is no terminal to ask on. Ada linked ${realpathSync(folder)} to api on dev. Add \`--yes\` to use it here.`
    for (const args of [[], ["--app", "api", "--server", "dev"]]) {
      expect({ args, status: await m.zekno("link", ...args) }).toEqual({ args, status: 2 })
      expect(m.lastErr()).toBe(`${refusal}\nRun \`zekno --help\` for the list of commands.`)
    }
    // The plain interface was asked, and could not ask anyone.
    expect(asked).toEqual([QUESTION, QUESTION])
    expect(kept()).toEqual(before)
    expect(await m.zekno("link", "--app", "api", "--server", "dev", "--yes")).toBe(0)
    expect(m.lastOut()).toBe("Accepted zekno.json: api on dev, file compose.yaml.")
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toContain(join(realpathSync(folder), "zekno.json"))
    expect(await m.zekno("link", "--yes")).toBe(0)
    expect(m.lastOut()).toBe("Already in use: zekno.json, api on dev, file compose.yaml.")
    expect(await m.zekno("status")).toBe(0)
    expect(asked).toHaveLength(2)
    expect(started()).toBe(1)
  })

  test("in a folder above, the question names that folder and its Compose file: at a terminal, for `zekno link`, and in the app's panel", async () => {
    const { m, folder, started, asked } = await copied()
    const sub = join(folder, "teammate-repo-main")
    mkdirSync(sub)
    writeFileSync(join(sub, "compose.yaml"), COMPOSE_V1)
    m.deps.cwd = sub
    const above = realpathSync(folder)
    const question = `Ada linked ${above} to api on dev, with ${above}/compose.yaml. Use it here?`
    const none = m.deps.ui.confirm
    m.deps.ui.confirm = async (asking) => (asked.push(asking), false)
    expect(await m.zekno("deploy")).toBe(1)
    expect(await m.zekno("link")).toBe(1)
    expect(asked).toEqual([question, question])
    expect(started()).toBe(0)
    // With no terminal, `zekno link` names the folder too, as it always does.
    m.deps.ui.confirm = none
    expect(await m.zekno("link")).toBe(2)
    expect(m.lastErr()).toStartWith(`There is no terminal to ask on. Ada linked ${above} to api on dev. Add \`--yes\` to use it here.`)

    const app = openApp(m, await loadStart(m.deps))
    expect(app.state.question).toEqual({ kind: "use-link", member: "Ada", server: "dev", app: "api", above: { folder: above, compose: `${above}/compose.yaml` } })
    // A path longer than the panel is wide is broken across lines: compared without the breaks.
    const unbroken = (text: string) => words(text).replace(/ /g, "")
    const screen = app.draw()
    expect(unbroken(screen)).toContain(unbroken(`Ada linked ${above} to api on dev, with ${above}/compose.yaml.`))
    expect(words(screen)).toContain("The link is signed by your team. It has not been used in this folder on this machine. Use it here?")
    expect(acceptedLinks(m.home).map((entry) => entry.path)).not.toContain(join(above, "zekno.json"))
  })

  test("a flag that sends the folder elsewhere than the file names: the question says both", async () => {
    const { m, folder, started, asked } = await copied()
    m.deps.cwd = m.project
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    const starts = started()
    m.deps.cwd = folder
    m.deps.ui.confirm = async (question) => (asked.push(question), false)
    const runs: [string[], string][] = [
      [["deploy", "--server", "prod"], "Ada linked this folder to api on dev. This command uses api on prod. Use it here?"],
      [["deploy", "--app", "web"], "Ada linked this folder to api on dev. This command uses web on dev. Use it here?"],
      [["secret", "ls", "--server", "prod"], "Ada linked this folder to api on dev. This command uses api on prod. Use it here?"],
      [["deploy", "--server", "dev"], QUESTION],
      // status takes no app: an --app typed with it changes nothing it does.
      [["status", "--app", "web"], QUESTION],
    ]
    for (const [args, question] of runs) {
      asked.length = 0
      expect({ args, status: await m.zekno(...args) }).toEqual({ args, status: 1 })
      expect({ args, asked }).toEqual({ args, asked: [question] })
    }
    expect(started()).toBe(starts)
  })

  test("the app asks when it opens; n uses nothing and d deploys nothing; opened again it asks again; y moves Home to its app, and the next opening asks nothing", async () => {
    const { m, folder, started, kept } = await copied()
    const ups = m.docker.calls().length
    const before = kept()
    const deps: OpDeps = { ...m.deps, connect: m.deps.connect }
    let app = openApp(m, await loadStart(deps), deps)
    expect(app.state.question).toEqual({ kind: "use-link", member: "Ada", server: "dev", app: "api" })
    expect(app.state.linked).toBeUndefined()
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    let screen = app.draw()
    expect(screen).toContain("╭─ Ada linked this folder to api on dev ─")
    expect(words(screen)).toContain("The link is signed by your team. It has not been used in this folder on this machine. Use it here?")
    expect(lastLine(screen)).toBe("y use it  n not now")
    // Enter, q, d and the arrows answer nothing.
    for (const k of [{ kind: "enter" }, { kind: "text", text: "q" }, { kind: "text", text: "d" }, { kind: "down" }] as AppKey[]) app.press(k)
    expect(app.state.question?.kind).toBe("use-link")
    expect(app.state.exiting).toBe(false)

    app.type("n")
    expect(app.state.question).toBeUndefined()
    expect(app.state.linked).toBeUndefined()
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    expect(app.state.notice).toBeUndefined()
    app.press({ kind: "right" })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_IN_USE })
    expect(words(app.draw())).toContain(NOT_IN_USE)
    await Bun.sleep(100)
    expect(app.state.question).toBeUndefined()
    expect(app.state.deploy).toBeUndefined()
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(kept()).toEqual(before)
    expect(app.failures).toEqual([])

    // Opened again: asked again. Esc is no as well.
    app = openApp(m, await loadStart(deps), deps)
    expect(app.state.question?.kind).toBe("use-link")
    app.press({ kind: "escape" })
    expect(app.state.question).toBeUndefined()
    expect(app.state.linked).toBeUndefined()

    // Opened again, and y: recorded, and Home on api, as for a linked folder, with nothing more said.
    app = openApp(m, await loadStart(deps), deps)
    app.type("y")
    await app.until(() => app.state.linked !== undefined, "the folder to be linked")
    expect(app.state.linked).toEqual({ server: "dev", app: "api", compose: "compose.yaml" })
    expect(top(app.state)).toEqual({ name: "home", pane: "apps", server: 0, app: 0 })
    expect(app.state.notice).toBeUndefined()
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toContain(join(realpathSync(folder), "zekno.json"))
    screen = app.draw()
    expect(words(screen)).toContain("This folder is linked to api on dev by zekno.json.")
    expect(started()).toBe(0)

    // The next opening asks nothing.
    app = openApp(m, await loadStart(deps), deps)
    expect(app.state.question).toBeUndefined()
    expect(app.state.linked).toEqual({ server: "dev", app: "api", compose: "compose.yaml" })
    expect(app.failures).toEqual([])
  })

  test("y to a file that changed while the question was open records nothing", async () => {
    const { m, folder } = await copied()
    const app = openApp(m, await loadStart(m.deps))
    expect(app.state.question?.kind).toBe("use-link")
    // Signed again by the team for another app, as a `git pull` could bring it while the question is open.
    const own = tempDir("own")
    writeFileSync(join(own, "compose.yaml"), COMPOSE_V1)
    m.deps.cwd = own
    expect(await m.zekno("link", "--app", "worker", "--server", "dev")).toBe(0)
    copyFileSync(join(own, "zekno.json"), join(folder, "zekno.json"))
    app.type("y")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({ tone: "error", text: LINK_CHANGED })
    expect(app.state.linked).toBeUndefined()
    expect(acceptedLinks(m.home).map((entry) => entry.path)).not.toContain(join(realpathSync(folder), "zekno.json"))
    expect(app.failures).toEqual([])
  })
})

describe("a zekno.json signed by the team, on the happy paths", () => {
  test("`zekno link` then `zekno deploy`: no question", async () => {
    const m = await ready()
    const asked: string[] = []
    m.deps.ui.confirm = async (question) => (asked.push(question), false)
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of web is running on dev with no secrets.")
    expect(asked).toEqual([])
  })

  test("a second machine of the same member meets the file: asked once, then not again; an edit by `zekno link --force` is signed, used where it was made, and asked about once on the other", async () => {
    const m = await ready()
    expect(await m.zekno("link", "--app", "web", "--server", "dev")).toBe(0)
    expect(await m.zekno("deploy")).toBe(0)
    const other = await twin(m)
    other.deps.cwd = m.project
    const asked: string[] = []
    other.deps.ui.confirm = async (question) => (asked.push(question), true)
    expect(await other.zekno("deploy")).toBe(0)
    expect(other.lastOut()).toBe("Deploy 2 of web is running on dev with no secrets.")
    expect(await other.zekno("deploy")).toBe(0)
    expect(asked).toEqual(["Ada linked this folder to web on dev. Use it here?"])

    // Changed on the first machine with --force: signed there, and used there with no question.
    const own: string[] = []
    m.deps.ui.confirm = async (question) => (own.push(question), false)
    expect(await m.zekno("link", "--app", "api", "--force")).toBe(0)
    expect(await signerOfFolder(m)).toMatchObject({ name: "Ada" })
    expect(await m.zekno("deploy")).toBe(0)
    expect(m.lastOut()).toBe("Deploy 1 of api is running on dev with no secrets.")
    expect(own).toEqual([])
    // On the second machine its bytes are new: asked once more.
    expect(await other.zekno("status")).toBe(0)
    expect(asked).toEqual(["Ada linked this folder to web on dev. Use it here?", "Ada linked this folder to api on dev. Use it here?"])
  })
})

/** Who signed the zekno.json that applies to `m`'s folder, judged against `m`'s verified team list. */
async function signerOfFolder(m: Machine) {
  return signerOf(findProject(m.deps.cwd)!, (await openTeam(m.deps)).trust)
}

/**
 * An admin's change to the team's members, as a later zekno would make it:
 * the next team list, signed with this machine's key and added to the
 * profile. Returns the new team list.
 */
async function changeTeam(m: Machine, members: (trust: TeamTrust) => Member[]): Promise<TeamTrust> {
  const team = await openTeam(m.deps)
  const next = await team.withSigner((signer) => proposeRoster({ trust: team.trust, members: members(team.trust), signer }))
  m.tamper("profile.json", (profile) => ({ ...profile, rosters: [...profile.rosters, next.envelope] }))
  return next.trust
}

// ---------------------------------------------------------------------------
// The app

/** The effects of every app a test opened: closed after each test, so no runner a test reached is left running. */
const opened: Effects[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** The app on a test machine, without a terminal: the reducer, the effects, and the window drawn on request. */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>, deps: OpDeps = m.deps) {
  const failures: unknown[] = []
  let effects: Effects | undefined
  const store = createStore(initialState(start, { columns: 100, rows: 30 }), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  // As app.tsx does: the effects know what the app opened on, the verified team list included.
  effects = createEffects(deps, store.dispatch, (error) => failures.push(error), undefined, {}, start)
  opened.push(effects)
  const held = emptyHiddenValue()
  return {
    store,
    failures,
    get state() {
      return store.get()
    },
    press: (...keys: AppKey[]) => keys.forEach((k) => store.dispatch({ type: "key", key: k })),
    type: (value: string) => [...value].forEach((char) => store.dispatch({ type: "key", key: { kind: "text", text: char } })),
    /** One key press or paste at the hidden prompt, as app.tsx hands it over. */
    hidden: (input: string, k: Partial<Key> = {}) => hiddenPromptKey(held, input, k, store.get(), store.dispatch, effects!.saveSecret),
    draw: () => draw(store.get()),
    until: (ready: () => boolean, what: string) => waitFor(ready, what),
  }
}
type App = ReturnType<typeof openApp>

/** A machine with demo deployed once from the command line, and the app open on Home with demo selected. */
async function onHome(compose: string, prepare?: (m: Machine) => Promise<unknown> | unknown) {
  const m = await ready()
  expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
  m.compose(compose)
  await prepare?.(m)
  const app = openApp(m, await loadStart(m.deps))
  app.press({ kind: "right" })
  return { m, app }
}

const ended = (app: App) => app.until(() => app.state.deploy?.running === false, "the deploy to end")

/** Goes ahead without the values not set: esc closes the prompt, esc on the list asks, and y answers (P4). */
function skipValues(app: App) {
  expect(hiddenPromptOpen(app.state)).toBe(true)
  app.press({ kind: "escape" })
  expect(top(app.state)).toMatchObject({ name: "set-secret", question: undefined })
  app.press({ kind: "escape" })
  expect(app.state.question?.kind).toBe("skip-values")
  app.type("y")
}

/** Types a value at the hidden prompt and presses enter, and waits for it to be stored. */
async function setValue(app: App, value: string) {
  expect(hiddenPromptOpen(app.state)).toBe(true)
  const before = app.state.notice
  app.hidden(value)
  app.hidden("\r", { return: true })
  await app.until(() => app.state.notice !== before && app.state.notice?.tone === "success", "the value to be stored")
}

describe("the app in a project folder", () => {
  test("reads the keychain once as it opens, and once for its first deploy, which signs; zekno.json is judged against the team list it opened with", async () => {
    const m = await ready()
    m.compose(COMPOSE_PLAIN)
    await linkHere(m, { app: "demo", server: "dev" })
    let reads = 0
    const get = m.keyStore.get
    m.keyStore.get = (key) => (reads++, get(key))
    const app = openApp(m, await loadStart(m.deps))
    expect(app.state.linked).toEqual({ server: "dev", app: "demo", compose: "compose.yaml" })
    expect(reads).toBe(1)
    app.type("d")
    await app.until(() => app.state.deploy !== undefined, "the deploy to start")
    await ended(app)
    expect(app.state.deploy?.outcome).toBe("started")
    expect(reads).toBe(2)
    expect(app.failures).toEqual([])
  })

  test("opens focused on the linked server and app, says the folder is linked, and names its Compose file", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    for (const app of ["demo", "web"]) expect(await m.zekno("deploy", "--app", app, "--server", "staging")).toBe(0)
    await linkHere(m, { app: "demo", server: "staging" })
    const start = await loadStart(m.deps)
    expect(start).toMatchObject({ kind: "team", linked: { server: "staging", app: "demo", compose: "compose.yaml" } })
    const state = initialState(start, { columns: 100, rows: 30 })
    // web was deployed last, so it is listed first; demo is selected all the same.
    expect(top(state)).toEqual({ name: "home", pane: "apps", server: 1, app: 1 })
    const screen = words(draw(state))
    expect(screen).toContain("Apps on staging")
    expect(screen).toContain("This folder is linked to demo on staging by zekno.json.")
    expect(draw(state)).toMatch(/file +compose\.yaml/)
  })

  test("a zekno.json that cannot be used is said on Home, and the app opens all the same", async () => {
    const m = await ready()
    link(m, "{ nope")
    const broken = await loadStart(m.deps)
    expect(broken).toMatchObject({ kind: "team", problem: `${fileOf(m)} is not valid JSON.` })
    const screen = draw(initialState(broken, { columns: 100, rows: 30 }))
    expect(screen).toContain("✖ ")
    expect(words(screen)).toContain("is not valid JSON.")
    link(m, { app: "web", server: "prod" })
    const foreign = await loadStart(m.deps)
    expect(foreign).toMatchObject({
      kind: "team",
      problem: "zekno.json here is not signed by your team, so zekno does not use it. It names web on prod.",
    })
    expect(foreign.kind === "team" && (foreign.linked ?? foreign.firstUse)).toBeUndefined()
    // From a folder below, the file is named by its path.
    mkdirSync(join(m.project, "sub"))
    expect(await loadStart({ ...m.deps, cwd: join(m.project, "sub") })).toMatchObject({ problem: `${fileOf(m)} is not signed by your team, so zekno does not use it. It names web on prod.` })
    // Accepted while prod was connected; prod has since been taken off this machine's profile.
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    await linkHere(m, { app: "web", server: "prod" })
    m.tamper("profile.json", (profile) => ({ ...profile, servers: profile.servers.filter((server: { name: string }) => server.name !== "prod") }))
    const unknown = await loadStart(m.deps)
    expect(unknown).toMatchObject({ kind: "team", problem: `${fileOf(m)} names a server "prod" that is not connected to this machine.` })
    expect(unknown.kind === "team" && unknown.linked).toBeUndefined()
  })

  test("the first deploy of a folder that is not linked asks to remember it; enter writes zekno.json and deploys", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    expect(app.state.question).toEqual({ kind: "remember-folder", server: "dev", app: "demo", compose: "compose.yaml" })
    const screen = app.draw()
    const said = words(screen)
    expect(said).toContain("Remember this folder?")
    expect(said).toContain("Write zekno.json here, so this folder always deploys demo to dev.")
    expect(said).toContain('{ "app": "demo", "server": "dev", "compose": "compose.yaml" }')
    expect(said).toContain("It holds no secret and is safe to commit.")
    expect(said).toContain("enter write it and deploy n deploy without it esc cancel")
    // Nothing is written or signed while the question is open.
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(m.docker.calls()).toHaveLength(1)

    app.press({ kind: "enter" })
    await ended(app)
    expect(app.state.deploy).toMatchObject({ app: "demo", server: "dev", sequence: 2, outcome: "started" })
    const written = join(m.project, "zekno.json")
    expect(JSON.parse(readFileSync(written, "utf8"))).toMatchObject({ app: "demo", server: "dev", compose: "compose.yaml", signed: { payloadType: "zekno.link.v1" } })
    expect(statSync(written).mode & 0o777).toBe(0o644)
    // Written by a "yes" here: signed with this member's key, and recorded as used on this machine.
    expect(await signerOfFolder(m)).toMatchObject({ name: "Ada" })
    expect(acceptedLinks(m.home).map((entry) => entry.path)).toEqual([fileOf(m)])
    expect(app.state.linked).toEqual({ server: "dev", app: "demo", compose: "compose.yaml" })
    app.press({ kind: "escape" })
    expect(words(app.draw())).toContain("This folder is linked to demo on dev by zekno.json.")

    // Linked now: the next deploy does not ask.
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3")
    expect(app.state.question).toBeUndefined()
    expect(app.failures).toEqual([])
  })

  test("n deploys without writing it and is not asked again while the app is open; esc cancels and nothing is signed", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    app.press({ kind: "escape" })
    expect(app.state.question).toBeUndefined()
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(1)

    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question again")
    app.type("n")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)

    app.press({ kind: "escape" })
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3")
    expect(app.state.question).toBeUndefined()
    expect(existsSync(join(m.project, "zekno.json"))).toBe(false)
    expect(app.failures).toEqual([])
  })

  test("missing values are listed before a deploy, each set with the hidden prompt, then the deploy goes on with them", async () => {
    const DATABASE = "postgres://only-the-runner-reads-this"
    const SESSION = "session-value-never-shown"
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkHere(m, { app: "demo", server: "dev" }))
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(top(app.state)).toMatchObject({ server: "dev", app: "demo", missing: ["DATABASE_URL", "SESSION_KEY"], file: "compose.yaml", at: 0, question: "value" })
    const seen: string[] = []
    const look = () => seen.push(JSON.stringify(app.state), app.draw())
    look()
    let screen = words(app.draw())
    expect(screen).toContain("› dev › demo › set a secret 1 of 2")
    expect(screen).toContain("! compose.yaml expects 2 values that are not set yet.")
    expect(screen).toContain("Set them now, or press esc and deploy without them.")
    expect(screen).toMatch(/❯ DATABASE_URL +not set SESSION_KEY +not set/)
    expect(screen).toContain("? Value ›")
    expect(screen).toContain("hidden as you type")
    expect(screen).toContain("enter save esc cancel")
    // $HOME is reserved and ${PORT:-80} has a default: neither is listed.
    expect(screen).not.toContain("HOME")
    expect(screen).not.toContain("PORT")

    await setValue(app, DATABASE)
    look()
    screen = words(app.draw())
    expect(top(app.state)).toMatchObject({ at: 1, done: ["DATABASE_URL"], question: "value" })
    expect(screen).toContain("2 of 2")
    expect(screen).toContain("! compose.yaml expects 1 value that is not set yet.")
    expect(screen).toContain("Set it now, or press esc and deploy without it.")
    expect(screen).toMatch(/DATABASE_URL +set ❯ SESSION_KEY +not set/)

    await setValue(app, SESSION)
    await ended(app)
    look()
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started", secretNames: ["DATABASE_URL", "SESSION_KEY"] })
    const env = m.docker.calls().at(-1)!.env
    expect(env.DATABASE_URL).toBe(DATABASE)
    expect(env.SESSION_KEY).toBe(SESSION)
    for (const frame of seen) {
      expect(frame).not.toContain(DATABASE)
      expect(frame).not.toContain(SESSION)
    }
    for (const file of filesUnder(m.home)) {
      expect(file.content).not.toContain(DATABASE)
      expect(file.content).not.toContain(SESSION)
    }
    expect(readFileSync(join(m.project, "zekno.json"), "utf8")).not.toContain("only-the-runner")
    expect(app.failures).toEqual([])
  })

  test("esc at the prompt returns to the list and signs nothing; esc on the list asks; n deploys nothing, y deploys without them", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkHere(m, { app: "demo", server: "dev" }))
    const ups = m.docker.calls().length
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(lastLine(app.draw())).toBe("enter save  esc cancel")
    app.press({ kind: "escape" })
    expect(top(app.state)).toMatchObject({ name: "set-secret", question: undefined })
    expect(lastLine(app.draw())).toBe("↑↓ move  enter set  esc deploy without them")
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()

    app.press({ kind: "escape" })
    expect(app.state.question).toEqual({ kind: "skip-values", server: "dev", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"] })
    const asked = app.draw()
    expect(words(asked)).toContain("Deploy demo to dev without 2 values?")
    expect(lastLine(asked)).toBe("y deploy  n do not deploy")
    app.type("n")
    expect(top(app.state).name).toBe("home")
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_DEPLOYED })
    expect(words(app.draw())).toContain(NOT_DEPLOYED)
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(ups)

    // Esc on the question is no as well.
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list again")
    app.press({ kind: "escape" }, { kind: "escape" }, { kind: "escape" })
    expect(top(app.state).name).toBe("home")
    expect(app.state.notice?.text).toBe(NOT_DEPLOYED)

    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list once more")
    skipValues(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
    expect(m.docker.calls()).toHaveLength(ups + 1)
    expect(m.docker.calls().at(-1)!.env.DATABASE_URL).toBeUndefined()
    expect(app.failures).toEqual([])
  })

  test("what is signed is the text whose names were listed: an edit while the list is open is not deployed", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, (m) => linkHere(m, { app: "demo", server: "dev" }))
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    m.compose(COMPOSE_PLAIN.replace("web:1", "edited-meanwhile:1"))
    skipValues(app)
    await ended(app)
    expect(deployed(m, "demo")).toBe(COMPOSE_TWO)
  })

  test("a value already set is not listed; with every value set there is no list", async () => {
    const { m, app } = await onHome(COMPOSE_TWO, async (m) => {
      await linkHere(m, { app: "demo", server: "dev" })
      m.typing("set-before")
      expect(await m.zekno("secret", "set", "DATABASE_URL")).toBe(0)
    })
    app.type("d")
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(top(app.state)).toMatchObject({ missing: ["SESSION_KEY"] })
    await setValue(app, "now-set")
    await ended(app)
    app.press({ kind: "escape" })
    app.type("d")
    await app.until(() => app.state.deploy?.sequence === 3 && !app.state.deploy.running, "deploy 3 with no list")
    expect(m.docker.calls().at(-1)!.env).toMatchObject({ DATABASE_URL: "set-before", SESSION_KEY: "now-set" })
  })

  test("in a folder that is not linked: first the question, then the list", async () => {
    const { m, app } = await onHome(COMPOSE_TWO)
    app.type("d")
    await app.until(() => app.state.question !== undefined, "the question")
    app.press({ kind: "enter" })
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(existsSync(join(m.project, "zekno.json"))).toBe(true)
    skipValues(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ sequence: 2, outcome: "started" })
  })

  test("on a server with no apps yet, d deploys the app the folder is linked to", async () => {
    const m = await ready()
    expect(await m.zekno("server", "add", "staging", "--local", "--home", tempDir("staging"))).toBe(0)
    m.compose(COMPOSE_PLAIN)
    await linkHere(m, { app: "fresh", server: "staging" })
    expect(await m.zekno("server", "add", "empty", "--local", "--home", tempDir("empty"))).toBe(0)
    const app = openApp(m, await loadStart(m.deps))
    expect(top(app.state)).toEqual({ name: "home", pane: "servers", server: 1, app: 0 })
    // Another server with no apps is not the folder's: nothing is deployed there.
    app.press({ kind: "down" })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({ tone: "info", text: linkedElsewhere({ app: "fresh", server: "staging" }) })
    expect(app.state.deploy).toBeUndefined()
    app.press({ kind: "up" })
    app.type("d")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "staging", app: "fresh", sequence: 1, outcome: "started" })
    expect(app.failures).toEqual([])
  })

  test("a zekno.json naming a server that is no longer connected supplies nothing: d says so, asks nothing and deploys nothing", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    // Accepted while prod was connected; prod has since been taken off this machine's profile.
    expect(await m.zekno("server", "add", "prod", "--local", "--home", tempDir("prod"))).toBe(0)
    await linkHere(m, { app: "web", server: "prod" })
    m.tamper("profile.json", (profile) => ({ ...profile, servers: profile.servers.filter((server: { name: string }) => server.name !== "prod") }))
    const ups = m.docker.calls().length
    const app = openApp(m, await loadStart(m.deps))
    app.press({ kind: "right" })
    app.type("d")
    await app.until(() => app.state.notice?.text.includes("not connected") === true, "the line")
    expect(app.state.notice).toEqual({ tone: "error", text: `${fileOf(m)} names a server "prod" that is not connected to this machine.` })
    expect(app.state.question).toBeUndefined()
    await Bun.sleep(100)
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(ups)
    expect(app.failures).toEqual([])
  })

  test("a folder linked to an app its server does not have yet: d deploys it as a first deploy, whichever row is marked, and replaces nothing", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, async (m) => {
      expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
      expect(await m.zekno("link", "--app", "fresh", "--server", "dev")).toBe(0)
    })
    // The linked app is not on the server yet, so it has no row to select: another app is marked.
    const before = app.state.team!.servers[0]!.apps.map((row) => [row.name, row.deploy])
    expect(before.map(([name]) => name)).not.toContain("fresh")
    expect(before.length).toBeGreaterThan(0)
    app.type("d")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "dev", app: "fresh", sequence: 1, outcome: "started" })
    // The apps that were there were not touched: each still has the deploy it had.
    const after = app.state.team!.servers[0]!.apps.map((row) => [row.name, row.deploy])
    for (const row of before) expect(after).toContainEqual(row)
    expect(after.map(([name]) => name)).toContain("fresh")
    expect(app.failures).toEqual([])
  })

  /**
   * A machine with demo and billing on dev, this folder linked to demo, and
   * the app open on Home with demo selected. Every read of the keychain and
   * every runner started from then on is counted: the app verifying the
   * profile when it opened is one read.
   */
  async function linkedToDemo(compose = COMPOSE_PLAIN) {
    let keychain = 0
    let started = 0
    const { m, app } = await onHome(compose, async (m) => {
      expect(await m.zekno("deploy", "--app", "billing", "--server", "dev")).toBe(0)
      expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
      const get = m.keyStore.get
      m.keyStore.get = (name) => (keychain++, get(name))
      const reach = m.deps.connect
      m.deps.connect = (...args) => (started++, reach(...args))
    })
    return { m, app, keychain: () => keychain, started: () => started }
  }

  /** Keys at a terminal arrive one event apart: the press before has finished by the next. */
  const nextKey = () => Bun.sleep(10)

  test("d on another app of a linked folder asks first, naming the link and the app; nothing is read, signed or sent before y", async () => {
    const { m, app, keychain, started } = await linkedToDemo()
    const read = keychain()
    const link = readFileSync(join(m.project, "zekno.json"), "utf8")
    const accepted = acceptedLinks(m.home)
    const ups = m.docker.calls().length
    // billing was deployed last, so it is listed first; demo, the folder's own, is selected.
    expect(app.state.team!.servers[0]!.apps.map((row) => row.name)).toEqual(["billing", "demo"])
    expect(top(app.state)).toMatchObject({ name: "home", pane: "apps", app: 1 })
    app.press({ kind: "up" })
    app.type("d")
    expect(app.state.question).toEqual({ kind: "deploy-elsewhere", server: "dev", app: "billing", linked: { server: "dev", app: "demo" } })
    const asked = app.draw()
    expect(asked).toContain("╭─ This folder is linked to demo on dev ─")
    expect(words(asked)).toContain("You selected billing. Deploy this folder to billing? It replaces what billing runs now.")
    expect(words(asked)).toContain("y deploy to billing n do not deploy")
    expect(lastLine(asked)).toBe("y deploy to billing  n do not deploy")
    await nextKey()
    // Enter, q and other keys answer nothing.
    for (const k of [{ kind: "enter" }, { kind: "text", text: "q" }, { kind: "text", text: "d" }, { kind: "down" }] as AppKey[]) app.press(k)
    expect(app.state.question?.kind).toBe("deploy-elsewhere")
    expect(app.state.exiting).toBe(false)

    // n: nothing deployed, and said so.
    app.type("n")
    expect(app.state.question).toBeUndefined()
    expect(top(app.state).name).toBe("home")
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_DEPLOYED })
    expect(words(app.draw())).toContain(NOT_DEPLOYED)
    // esc: the same.
    app.type("d")
    expect(app.state.question?.kind).toBe("deploy-elsewhere")
    await nextKey()
    app.press({ kind: "escape" })
    expect(app.state.question).toBeUndefined()
    expect(app.state.notice).toEqual({ tone: "info", text: NOT_DEPLOYED })
    await Bun.sleep(150)
    expect(app.state.deploy).toBeUndefined()
    expect(keychain()).toBe(read)
    expect(started()).toBe(0)
    expect(m.docker.calls()).toHaveLength(ups)

    // y: the folder's Compose file, as read when d was pressed, goes to billing; an edit after that is not deployed.
    const FOLDER = COMPOSE_PLAIN.replace("web:1", "from-this-folder:1")
    m.compose(FOLDER)
    app.type("d")
    expect(app.state.question?.kind).toBe("deploy-elsewhere")
    m.compose(COMPOSE_PLAIN.replace("web:1", "edited-meanwhile:1"))
    await nextKey()
    expect(keychain()).toBe(read)
    app.type("y")
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "dev", app: "billing", sequence: 2, outcome: "started" })
    expect(deployed(m, "billing")).toBe(FOLDER)
    expect(keychain()).toBeGreaterThan(read)
    // demo, the link and what this machine accepted are as they were; nothing was written.
    expect(app.state.team!.servers[0]!.apps.find((row) => row.name === "demo")?.deploy).toBe(1)
    expect(readFileSync(join(m.project, "zekno.json"), "utf8")).toBe(link)
    expect(acceptedLinks(m.home)).toEqual(accepted)
    expect(app.state.linked).toEqual({ server: "dev", app: "demo", compose: "compose.yaml" })
    expect(app.failures).toEqual([])
  })

  test("the same question over the app screen; on the folder's own app, d deploys at once", async () => {
    const { m, app, keychain } = await linkedToDemo()
    const ups = m.docker.calls().length
    app.press({ kind: "up" }, { kind: "enter" })
    await app.until(() => app.state.appView?.app === "billing", "billing's history")
    // Opening the app screen verified the profile; from here nothing more is read before y.
    const read = keychain()
    app.type("d")
    expect(app.state.question).toEqual({ kind: "deploy-elsewhere", server: "dev", app: "billing", linked: { server: "dev", app: "demo" } })
    expect(lastLine(app.draw())).toBe("y deploy to billing  n do not deploy")
    await nextKey()
    app.press({ kind: "escape" })
    expect(top(app.state)).toMatchObject({ name: "app", app: "billing" })
    expect(app.state.notice?.text).toBe(NOT_DEPLOYED)
    expect(words(app.draw())).toContain(NOT_DEPLOYED)
    await Bun.sleep(100)
    expect(m.docker.calls()).toHaveLength(ups)
    expect(keychain()).toBe(read)

    // demo, the folder's own: no question.
    app.press({ kind: "escape" }, { kind: "down" })
    app.type("d")
    expect(app.state.question).toBeUndefined()
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "dev", app: "demo", sequence: 2, outcome: "started" })
    expect(app.failures).toEqual([])
  })

  test("another server: the question names it, and y deploys the folder to the app selected there, its missing values listed first", async () => {
    const m = await ready()
    const stagingHome = tempDir("staging")
    expect(await m.zekno("server", "add", "staging", "--local", "--home", stagingHome)).toBe(0)
    expect(await m.zekno("deploy", "--app", "web", "--server", "staging")).toBe(0)
    expect(await m.zekno("deploy", "--app", "demo", "--server", "dev")).toBe(0)
    m.compose(COMPOSE_TWO)
    expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
    const app = openApp(m, await loadStart(m.deps))
    expect(top(app.state)).toMatchObject({ name: "home", server: 0, app: 0 })
    app.press({ kind: "left" }, { kind: "down" }, { kind: "right" })
    app.type("d")
    expect(app.state.question).toEqual({ kind: "deploy-elsewhere", server: "staging", app: "web", linked: { server: "dev", app: "demo" } })
    const asked = app.draw()
    expect(asked).toContain("╭─ This folder is linked to demo on dev ─")
    expect(words(asked)).toContain("You selected web on staging. Deploy this folder to web on staging? It replaces what web runs now.")
    expect(lastLine(asked)).toBe("y deploy to web  n do not deploy")
    await nextKey()
    app.type("y")
    // The values the folder's file expects, for web on staging.
    await app.until(() => top(app.state).name === "set-secret", "the list")
    expect(top(app.state)).toMatchObject({ server: "staging", app: "web", missing: ["DATABASE_URL", "SESSION_KEY"], file: "compose.yaml" })
    skipValues(app)
    await ended(app)
    expect(app.state.deploy).toMatchObject({ server: "staging", app: "web", sequence: 2, outcome: "started" })
    expect(readFileSync(join(stagingHome, "apps", "web", "compose.yaml"), "utf8")).toBe(COMPOSE_TWO)
    // demo on dev, the folder's own, was not touched.
    expect(m.docker.calls().filter((call) => call.args.includes("zekno-demo"))).toHaveLength(1)
    expect(app.failures).toEqual([])
  })

  test("a zekno.json whose Compose file leads outside its folder is refused at d, and nothing is signed", async () => {
    const { m, app } = await onHome(COMPOSE_PLAIN, async (m) => {
      // Accepted with its Compose file in place; then swapped for a link out of the folder.
      m.compose(COMPOSE_PLAIN, "linked.yaml")
      await linkHere(m, { app: "demo", server: "dev", compose: "linked.yaml" })
      rmSync(join(m.project, "linked.yaml"))
      const outside = join(tempDir("outside"), "private.yaml")
      writeFileSync(outside, COMPOSE_PLAIN)
      symlinkSync(outside, join(m.project, "linked.yaml"))
    })
    app.type("d")
    await app.until(() => app.state.notice !== undefined, "a line")
    expect(app.state.notice).toEqual({
      tone: "error",
      text: `linked.yaml, named by ${fileOf(m)}, leads outside the folder that holds it. zekno does not follow it there.`,
    })
    expect(app.state.deploy).toBeUndefined()
    expect(m.docker.calls()).toHaveLength(1)
  })
})

describe("the two screens, and the reducer's part", () => {
  const TEAM = { member: "Ada", version: 2, servers: [{ name: "prod", apps: [{ name: "demo", state: "unknown" as const }] }] }
  const home = () => initialState({ kind: "team", team: TEAM }, { columns: 100, rows: 30 })
  const fits = (screen: string, columns: number) => {
    for (const line of screen.split("\n")) expect([...line].length).toBeLessThanOrEqual(columns)
  }

  test("both fit at 80 columns, with the board's words", () => {
    const asked = update(home(), { type: "ask-remember-folder", server: "prod", app: "demo", compose: "compose.yaml" }).state
    const question = draw(asked, 80, 24)
    fits(question, 80)
    expect(words(question)).toContain("Write zekno.json here, so this folder always deploys demo to prod.")
    const listed = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["DATABASE_URL", "SESSION_KEY"], file: "compose.yaml" }).state
    const list = draw(listed, 80, 24)
    fits(list, 80)
    expect(words(list)).toContain("! compose.yaml expects 2 values that are not set yet.")
  })

  test("the list of missing names fits the window: the line that says how many and the marked name are always drawn", () => {
    for (const size of [
      { columns: 80, rows: 24 },
      { columns: 100, rows: 30 },
    ]) {
      for (const count of [3, 4, 20, 64]) {
        const names = Array.from({ length: count }, (_, n) => `VALUE_NUMBER_${n}`)
        let state = update(home(), { type: "missing-values", server: "prod", app: "demo", names, file: "compose.yaml" }).state
        state = update(state, { type: "resize", ...size }).state
        for (const at of [0, Math.floor(count / 2), count - 1]) {
          const marked = { ...state, stack: [...state.stack.slice(0, -1), { ...top(state), at }] } as State
          const shown = [marked, update(marked, { type: "key", key: { kind: "escape" } }).state, { ...marked, notice: { tone: "success", text: "Set A." } } as State]
          for (const each of shown) {
            const screen = draw(each, size.columns, size.rows)
            const lines = screen.split("\n")
            const what = { size, count, at, prompt: hiddenPromptOpen(each), notice: each.notice !== undefined }
            expect({ what, lines: lines.length }).toEqual({ what, lines: size.rows })
            expect({ what, said: lines.some((line) => line.includes(`! compose.yaml expects ${count} values that are not set yet.`)) }).toEqual({ what, said: true })
            expect({ what, marked: lines.some((line) => new RegExp(`❯ VALUE_NUMBER_${at} +not set`).test(line)) }).toEqual({ what, marked: true })
            expect({ what, hints: lastLine(screen).length > 0 }).toEqual({ what, hints: true })
            // Nothing is drawn over anything else: the foot's lines are whole.
            const foot = ["Encrypted on this machine for prod's key and signed by you.", "It cannot be shown again after it is set, only replaced."]
            for (const text of foot) expect({ what, text, whole: lines.some((line) => line.trim() === text) }).toEqual({ what, text, whole: true })
            if (count >= 20) expect(words(screen)).toMatch(/and \d+ more/)
          }
        }
      }
    }
  })

  test("which names are drawn: all when they fit, else a window around the marked one and a line for the rest", () => {
    expect(nameWindow(3, 2, 5)).toEqual({ start: 0, end: 3, hidden: 0 })
    expect(nameWindow(20, 0, 5)).toEqual({ start: 0, end: 4, hidden: 16 })
    expect(nameWindow(20, 10, 5)).toEqual({ start: 8, end: 12, hidden: 16 })
    expect(nameWindow(20, 19, 5)).toEqual({ start: 16, end: 20, hidden: 16 })
    expect(nameWindow(64, 63, 2)).toEqual({ start: 63, end: 64, hidden: 63 })
  })

  test("the question before deploying without them: its words, its keys, and q and other keys do nothing", () => {
    const listed = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B"] }).state
    // A was set from the list, and the prompt for B closed: only B is left.
    const left = { ...listed, stack: [...listed.stack.slice(0, -1), { ...top(listed), done: ["A"], at: 1, question: undefined }] } as State
    const state = update(left, { type: "key", key: { kind: "escape" } }).state
    expect(state.question).toEqual({ kind: "skip-values", server: "prod", app: "demo", names: ["B"] })
    expect(words(draw(state, 80, 24))).toContain("Deploy demo to prod without B?")
    for (const key of [{ kind: "text", text: "q" }, { kind: "enter" }, { kind: "down" }, { kind: "text", text: "d" }] as AppKey[]) {
      expect(update(state, { type: "key", key })).toEqual({ state, effects: [] })
    }
  })

  test("deploy this folder elsewhere?: its words at 100 and 80 columns; only y deploys; enter does nothing; it waits under the too-small rule", () => {
    const ask = { type: "ask-deploy-elsewhere", server: "prod", app: "demo", linked: { server: "dev", app: "web" } } as const
    const asked = update(home(), ask).state
    expect(asked.question).toEqual({ kind: "deploy-elsewhere", server: "prod", app: "demo", linked: { server: "dev", app: "web" } })
    for (const [columns, rows] of [
      [100, 30],
      [80, 24],
    ] as const) {
      const screen = draw({ ...asked, size: { columns, rows } }, columns, rows)
      fits(screen, columns)
      expect(screen.split("\n").length).toBeLessThanOrEqual(rows)
      expect(screen).toContain("╭─ This folder is linked to web on dev ─")
      expect(words(screen)).toContain("You selected demo on prod. Deploy this folder to demo on prod? It replaces what demo runs now.")
      expect(words(screen)).toContain("y deploy to demo n do not deploy")
      expect(lastLine(screen)).toBe("y deploy to demo  n do not deploy")
    }
    // On the link's own server the sentence names the app alone.
    const same = update(home(), { ...ask, linked: { server: "prod", app: "web" } }).state
    expect(words(draw(same))).toContain("You selected demo. Deploy this folder to demo? It replaces what demo runs now.")

    const press = (state: State, k: AppKey) => update(state, { type: "key", key: k })
    expect(press(asked, { kind: "text", text: "y" })).toEqual({
      state: { ...asked, question: undefined },
      effects: [{ kind: "deploy-continue", server: "prod", app: "demo", answer: "deploy-elsewhere" }],
    })
    for (const no of [{ kind: "text", text: "n" }, { kind: "escape" }] as AppKey[]) {
      expect(press(asked, no)).toEqual({ state: { ...asked, question: undefined, notice: { tone: "info", text: NOT_DEPLOYED } }, effects: [] })
    }
    for (const k of [{ kind: "enter" }, { kind: "text", text: "q" }, { kind: "text", text: "d" }, { kind: "tab" }] as AppKey[]) {
      expect(press(asked, k)).toEqual({ state: asked, effects: [] })
    }
    expect(press(asked, { kind: "ctrl-c" }).effects).toEqual([{ kind: "exit" }])
    // Below 80 by 24 it is not drawn and takes no answer; once the window is larger it is there again.
    const small = update(asked, { type: "resize", columns: 70, rows: 20 }).state
    expect(draw(small, 70, 20)).not.toContain("This folder is linked")
    expect(press(small, { kind: "text", text: "y" })).toEqual({ state: small, effects: [] })
    expect(update(small, { type: "resize", columns: 80, rows: 24 }).state.question).toEqual(asked.question)
    // Never open with another question: the other stays, and nothing is deployed.
    const updating = { ...home(), question: { kind: "update-runner", server: "prod" } } as State
    expect(update(updating, ask).state).toMatchObject({ question: { kind: "update-runner" }, notice: { text: NOT_DEPLOYED } })
    const listed = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["A"] }).state
    expect(update(listed, ask).state.question).toBeUndefined()
  })

  test("use this zekno.json here?: its words at 100 and 80 columns, long names said whole; only y uses it; n and esc say nothing; enter does nothing", () => {
    const start = { kind: "team", team: TEAM, firstUse: { member: "Ada", server: "prod", app: "demo", compose: "compose.yaml", path: "/x/zekno.json", sha256: "0".repeat(64) } } as const
    const asked = initialState(start, { columns: 100, rows: 30 })
    expect(asked.question).toEqual({ kind: "use-link", member: "Ada", server: "prod", app: "demo" })
    expect(asked.linked).toBeUndefined()
    expect(top(asked)).toEqual({ name: "home", pane: "servers", server: 0, app: 0 })
    for (const [columns, rows] of [
      [100, 30],
      [80, 24],
    ] as const) {
      const screen = draw({ ...asked, size: { columns, rows } }, columns, rows)
      fits(screen, columns)
      expect(screen.split("\n").length).toBeLessThanOrEqual(rows)
      expect(screen).toContain("╭─ Ada linked this folder to demo on prod ─")
      expect(words(screen)).toContain("The link is signed by your team. It has not been used in this folder on this machine. Use it here?")
      expect(lastLine(screen)).toBe("y use it  n not now")
    }
    // Names as long as the rules allow: the title is cut on the panel's line, and said whole above the question.
    const long = { member: "M".repeat(64), server: `p${"r".repeat(62)}`, app: `a${"p".repeat(62)}` }
    const longAsked = initialState({ ...start, firstUse: { ...start.firstUse, ...long } }, { columns: 80, rows: 24 })
    const longScreen = draw(longAsked, 80, 24)
    fits(longScreen, 80)
    expect(words(longScreen)).toContain(`${long.member} linked this folder to ${long.app} on ${long.server}.`)
    // In a folder above the one it opened in: that folder and its Compose file are named.
    const above = { folder: "~/Downloads", compose: "~/Downloads/compose.yaml" }
    const aboveAsked = initialState({ ...start, firstUse: { ...start.firstUse, above } }, { columns: 80, rows: 24 })
    expect(aboveAsked.question).toEqual({ kind: "use-link", member: "Ada", server: "prod", app: "demo", above })
    const aboveScreen = draw(aboveAsked, 80, 24)
    fits(aboveScreen, 80)
    expect(aboveScreen).toContain("╭─ Ada linked ~/Downloads to demo on prod, with ~/Downloads/compose.yaml ─")
    expect(words(aboveScreen)).toContain("The link is signed by your team. It has not been used in this folder on this machine. Use it here?")

    const press = (state: State, k: AppKey) => update(state, { type: "key", key: k })
    expect(press(asked, { kind: "text", text: "y" })).toEqual({ state: { ...asked, question: undefined }, effects: [{ kind: "use-link", server: "prod", app: "demo" }] })
    for (const no of [{ kind: "text", text: "n" }, { kind: "escape" }] as AppKey[]) {
      expect(press(asked, no)).toEqual({ state: { ...asked, question: undefined }, effects: [] })
    }
    for (const k of [{ kind: "enter" }, { kind: "text", text: "q" }, { kind: "text", text: "d" }, { kind: "tab" }, { kind: "down" }] as AppKey[]) {
      expect(press(asked, k)).toEqual({ state: asked, effects: [] })
    }
    expect(press(asked, { kind: "ctrl-c" }).effects).toEqual([{ kind: "exit" }])
    // Nothing is read again while it is open.
    expect(update(asked, { type: "tick" }).effects).toEqual([])
    // Recorded: Home on its server and app, as a linked folder opens; nothing is said.
    const withDemo = { ...asked, question: undefined, team: { ...TEAM, servers: [{ ...TEAM.servers[0]!, apps: [{ name: "other", state: "unknown" as const }, ...TEAM.servers[0]!.apps] }] } }
    const used = update(withDemo, { type: "link-used", linked: { server: "prod", app: "demo", compose: "compose.yaml" } }).state
    expect(used.linked).toEqual({ server: "prod", app: "demo", compose: "compose.yaml" })
    expect(top(used)).toEqual({ name: "home", pane: "apps", server: 0, app: 1 })
    expect(used.notice).toBeUndefined()
  })

  test("after a value is stored, the next name not set yet is asked, going round to an earlier one left out", () => {
    let state = update(home(), { type: "missing-values", server: "prod", app: "demo", names: ["A", "B", "C"] }).state
    // Ctrl-C closes the prompt; ↓ ↓ and enter ask for C first.
    for (const k of [{ kind: "ctrl-c" }, { kind: "down" }, { kind: "down" }, { kind: "enter" }] as AppKey[]) state = update(state, { type: "key", key: k }).state
    expect(top(state)).toMatchObject({ at: 2, question: "value" })
    const saved = { type: "secret-saved", notice: { tone: "success", text: "set" } } as const
    state = update(state, saved).state
    expect(top(state)).toMatchObject({ at: 0, done: ["C"], question: "value" })
    state = update(state, saved).state
    expect(top(state)).toMatchObject({ at: 1, done: ["C", "A"] })
    const last = update(state, saved)
    expect(top(last.state).name).toBe("home")
    expect(last.effects).toEqual([{ kind: "deploy-continue", server: "prod", app: "demo", answer: "values-set" }])
  })

  test("writing zekno.json marks the folder linked; a project file that cannot be used is a line from the start", () => {
    const linked = update(home(), { type: "linked", linked: { server: "prod", app: "demo", compose: "compose.yaml" } }).state
    expect(linked.linked).toEqual({ server: "prod", app: "demo", compose: "compose.yaml" })
    expect(words(draw(linked))).toContain("This folder is linked to demo on prod by zekno.json.")
    const problem = initialState({ kind: "team", team: TEAM, problem: "zekno.json is not valid JSON." }, { columns: 100, rows: 30 })
    expect(problem.notice).toEqual({ tone: "error", text: "zekno.json is not valid JSON." })
  })
})
