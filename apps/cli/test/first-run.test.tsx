import { afterEach, describe, expect, test } from "bun:test"
import { createTeam as startTeam, createSigner, generateMemberKeyPair } from "@workspace/core"
import { renderToString } from "ink"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runner, waitFor } from "../../runner/test/helpers"
import { AppView, createStore } from "../src/app/app"
import { createEffects, foundDetail, loadStart, megabytes, THIS_MACHINE } from "../src/app/effects"
import { handOverNote, needsAnswers, oneAtATime, type Terminal } from "../src/app/hand-over"
import type { AppKey } from "../src/app/keys"
import { addRows } from "../src/app/screens/add-server"
import { homeHints } from "../src/app/screens/home"
import { initialState, top, update, type AppEvent, type State, type TeamView } from "../src/app/state"
import { openTeam, type OpDeps } from "../src/context"
import { NO_RELEASE, RUNNER_PATHS } from "../src/install"
import { compareVersions, isOutdated } from "../src/ops/server"
import type { RunnerRelease } from "../src/runner-release"
import { plainUi } from "../src/ui/plain"
import { yesOrNo } from "../src/ui/ink"
import { COMPOSE_V1, filesUnder, machine } from "./helpers"
import { fakeRunner, olderRunner, realRunner, sha256, sshStandIn, standInServer, withSsh, type StandInServer } from "./stand-in-server"

type Machine = ReturnType<typeof machine>

const SIZE = { columns: 100, rows: 30 }
const key = (k: AppKey): AppEvent => ({ type: "key", key: k })
const text = (value: string): AppEvent => key({ kind: "text", text: value })
const draw = (state: State, columns = 100, rows = 30) => renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns })
const words = (screen: string) => screen.replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")
const lastLine = (screen: string) => screen.split("\n").filter((line) => line.trim() !== "").at(-1)!.trim()
/** The words of one panel, the one whose top line starts with `title`: its columns of every line below, so text wrapped inside it reads whole. */
function panel(screen: string, title: string): string {
  const lines = screen.split("\n").map((line) => [...line])
  const row = lines.findIndex((line) => line.join("").includes(`╭─ ${title}`))
  if (row === -1) throw new Error(`no panel "${title}"`)
  const left = lines[row]!.join("").indexOf(`╭─ ${title}`)
  const right = lines[row]!.indexOf("╮", left)
  const bottom = lines.findIndex((line, index) => index > row && line[left] === "╰")
  return words(lines.slice(row, bottom + 1).map((line) => line.slice(left, right + 1).join("")).join("\n"))
}
function fits(screen: string, columns: number, rows: number) {
  const lines = screen.split("\n")
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns)
}

/** A release of the runner whose x64 file is `content`, as a test's stand-in server serves it. */
function releaseOf(server: StandInServer, content: string): RunnerRelease {
  return { version: "0.2.0", files: { "linux-x64": { sha256: server.release(content) }, "linux-arm64": { sha256: null } } }
}

/** The effects of every app a test opened: closed after each test, so no runner a test reached is left running. */
const opened: ReturnType<typeof createEffects>[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((effects) => effects.close()))
})

/** The app on a test machine, without a terminal: the reducer, the effects, and the window drawn on request. */
function openApp(m: Machine, start: Awaited<ReturnType<typeof loadStart>>, terminal?: Terminal, deps: OpDeps = m.deps) {
  const failures: unknown[] = []
  let effects: ReturnType<typeof createEffects> | undefined
  const store = createStore(initialState(start, SIZE), (effect) => {
    if (effect.kind !== "exit") effects!.run(effect)
  })
  effects = createEffects(deps, store.dispatch, (error) => failures.push(error), terminal)
  opened.push(effects)
  return {
    store,
    effects,
    failures,
    get state() {
      return store.get()
    },
    press: (...keys: AppKey[]) => keys.forEach((k) => store.dispatch(key(k))),
    type: (value: string) => [...value].forEach((char) => store.dispatch(text(char))),
    draw: (columns = 100, rows = 30) => draw(store.get(), columns, rows),
    until: (ready: () => boolean, what: string, ms = 20_000) => waitFor(ready, what, ms),
  }
}
type App = ReturnType<typeof openApp>

/** First run up to "add a server": a name typed, the key created. */
async function named(m: Machine, terminal?: Terminal) {
  const app = openApp(m, await loadStart(m.deps), terminal)
  expect(top(app.state)).toEqual({ name: "welcome", value: "", creating: false })
  app.type("Ada")
  app.press({ kind: "enter" })
  await app.until(() => top(app.state).name === "add-server", "the key to be created")
  return app
}

/**
 * Types a destination and a name into "add a server" and waits for it to
 * end. Once the server is added the screen stays, with the server code in its
 * panel and `enter done`; enter is pressed there, as a person would, to go to
 * Home. Returns that finished screen as drawn, or undefined when it failed.
 */
async function added(app: App, destination: string, name: string): Promise<string | undefined> {
  app.type(destination)
  app.press({ kind: "enter" })
  app.type(name)
  app.press({ kind: "enter" })
  await app.until(() => top(app.state).name !== "add-server" || app.state.adding?.running === false, `${name} to be added`)
  const screen = top(app.state)
  if (screen.name !== "add-server" || screen.step !== "done") return undefined
  const finished = app.draw()
  expect(lastLine(finished)).toBe("enter done")
  expect(panel(finished, "Server code")).toContain(`${app.state.adding!.serverCode} Identifies this server's key. Teammates compare it before they trust the server.`)
  app.press({ kind: "enter" })
  return finished
}

/** The profile's servers, as written. */
const profileServers = (m: Machine) =>
  existsSync(join(m.home, "profile.json")) ? (JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).servers as { name: string; target: unknown }[]) : []

// ---------------------------------------------------------------------------

describe("first run (board 'First run: no team yet')", () => {
  test("the logo, what zekno does, the three steps with the first current, the name question and where the key is kept", () => {
    const state = initialState({ kind: "no-team" }, SIZE)
    const typed = [..."ada"].reduce((current, char) => update(current, text(char)).state, state)
    const screen = draw(typed)
    const lines = screen.split("\n")
    expect(lines[0]).toMatch(/^ welcome +pre-alpha, unaudited$/)
    expect(screen).toContain("▀▀▀█ ▄▀▀▄ █ ▄▀")
    expect(screen).toContain("Deploy to servers you own.")
    expect(screen).toContain("Secrets are encrypted and deploys are signed on this machine.")
    expect(screen).toMatch(/1 Your key +2 A server +3 First deploy/)
    expect(screen).toContain("╭─ Create your signing key ─")
    expect(words(screen)).toContain("Every deploy and every secret is signed with this key. Your servers refuse anything it did not sign.")
    expect(screen).toContain("? Your name › ada")
    expect(screen).toContain("Shown to teammates next to what you sign.")
    expect(screen).toContain("The key goes into your system keychain. It is never written to a file.")
    expect(screen).toContain("If you lose this machine's keychain, the key cannot be recovered.")
    expect(lastLine(screen)).toBe("enter create the key  esc quit")
    fits(screen, 100, 30)
    const small = draw(typed, 80, 24)
    fits(small, 80, 24)
    expect(small).toContain("If you lose this machine's keychain, the key cannot be recovered.")
    // With a line about a failure below it, it still fits.
    fits(draw(update(typed, { type: "failed", notice: { tone: "error", text: "The system keychain is not available, so no signing key was created." } }).state, 80, 24), 80, 24)
  })

  test("the key is created through the same operation as `zekno init`, in the keychain only, and step 2 follows", async () => {
    const m = machine()
    const app = await named(m)
    expect(m.keyStore.size()).toBe(1)
    const team = await openTeam(m.deps)
    expect(team.profile.memberName).toBe("Ada")
    expect(app.state.team).toMatchObject({ member: "Ada", version: 1, code: team.teamCode, servers: [] })
    expect(app.state.stack.map((screen) => screen.name)).toEqual(["home", "add-server"])
    const screen = app.draw()
    expect(screen.split("\n")[2]).toMatch(/› add a server +✔ Your key +2 A server +3 First deploy/)
    expect(screen).toContain(team.teamCode)
    // The key is in no file of the profile folder.
    const secret = JSON.parse((await m.keyStore.get(team.profile.keyName))!).secretKey as string
    for (const file of filesUnder(m.home)) expect(file.content).not.toContain(secret)
    // And `zekno init` still refuses a second team.
    expect(await m.zekno("init", "--name", "Eve")).toBe(1)
    expect(m.lastErr()).toContain("A team already exists on this machine")
  })

  test("a keychain that refuses: the name can be tried again, and no profile is written", async () => {
    const m = machine()
    const deps: OpDeps = { ...m.deps, keyStore: { ...m.keyStore, set: async () => Promise.reject(new Error("denied")) } }
    const app = openApp(m, await loadStart(m.deps), undefined, deps)
    app.type("Ada")
    app.press({ kind: "enter" })
    await app.until(() => app.state.notice !== undefined, "the failure")
    expect(app.state.notice).toEqual({ tone: "error", text: "The system keychain is not available, so no signing key was created." })
    expect(top(app.state)).toEqual({ name: "welcome", value: "Ada", creating: false })
    expect(existsSync(join(m.home, "profile.json"))).toBe(false)
  })
})

describe("adding the runner on this machine, for trying zekno out", () => {
  test("from no profile to a connected local runner through the reducer and effects", async () => {
    const m = machine()
    const app = await named(m)
    const seen: string[] = []
    app.store.subscribe(() => seen.push(app.draw()))
    const finished = await added(app, THIS_MACHINE, "dev")
    expect(app.failures).toEqual([])
    expect(top(app.state)).toMatchObject({ name: "home", server: 0 })
    expect(app.state.team?.servers.map((server) => server.name)).toEqual(["dev"])
    expect(app.state.adding).toMatchObject({ local: true, running: false, steps: { connect: { state: "done" }, set_up: { state: "done" }, added: { state: "done" } } })
    // The code was read on the finished screen, so Home's line does not repeat it.
    expect(app.state.notice).toEqual({ tone: "success", text: "Connected dev and added it to the signed team list." })
    expect(profileServers(m)).toEqual([{ name: "dev", serverId: expect.any(String), target: { kind: "local", home: join(m.home, "runner", "dev") } } as never])
    // The server code was shown with its sentence once setup had finished, and stayed, every step ticked, until enter.
    const code = app.state.adding?.serverCode
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/)
    const withCode = seen.find((screen) => screen.includes(code!))
    expect(panel(withCode!, "Server code")).toContain(`${code} Identifies this server's key. Teammates compare it before they trust the server.`)
    expect(withCode).toContain("Runner started on this machine")
    expect(panel(finished!, "Server code")).toContain(`${code} Identifies this server's key.`)
    for (const step of ["✔ Runner started on this machine", "✔ Runner set up for your team", "✔ Added dev to the signed team list"]) expect(finished).toContain(step)
    fits(finished!, 100, 30)
    // A deploy goes to it.
    m.compose(COMPOSE_V1)
    expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0)
  })
})

describe("adding a server over SSH (board 'Add a server')", () => {
  test("from no profile to Home: each step with what was found, the runner installed and checked, and one connection for all of it", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      const app = await named(m)
      const seen: State[] = []
      app.store.subscribe(() => seen.push(app.state))
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.failures).toEqual([])
      expect(top(app.state).name).toBe("home")
      const steps = app.state.adding!.steps
      expect(steps.connect?.detail).toMatch(/^\d+\.\ds$/)
      expect(steps.docker).toEqual({ state: "done", detail: "v2.40.3" })
      expect(steps.runner).toEqual({ state: "done", detail: `${megabytes(realRunner(m.docker.path).length)}, checksum verified` })
      expect(steps.set_up?.state).toBe("done")
      expect(steps.added?.state).toBe("done")
      // The installer's connection became the session: one SSH connection in all.
      expect(ssh.calls()).toEqual([`-- deploy@203.0.113.7 sh -s -- add 0.2.0 release x64 ${m.deps.release!.files["linux-x64"].sha256}`])
      expect(profileServers(m)[0]?.target).toEqual({ kind: "ssh", destination: "deploy@203.0.113.7", runnerPath: RUNNER_PATHS.user })
      expect(server.mode(server.runnerPath)).toBe(0o755)
      expect(app.state.team?.servers[0]).toMatchObject({ name: "prod", reachable: true, runner: { version: "0.2.0", outdated: false } })

      // The board, drawn as it was while the runner was being set up.
      const settingUp = seen.find((state) => state.adding?.steps.runner && !state.adding.steps.set_up)!
      const screen = draw(settingUp)
      expect(screen.split("\n")[2]).toMatch(/› add a server +✔ Your key +2 A server +3 First deploy$/)
      expect(screen).toMatch(/✔ SSH destination +deploy@203\.0\.113\.7/)
      expect(screen).toMatch(/✔ Name it +prod/)
      expect(screen).toMatch(/✔ Connected over SSH +\d+\.\ds/)
      expect(screen).toMatch(/✔ Docker with Compose found +v2\.40\.3/)
      expect(screen).toMatch(/✔ Runner installed +\d+ MB, checksum verified/)
      expect(screen).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Setting the runner up for your team/)
      expect(screen).toContain("○ Add prod to the signed team list")
      expect(words(screen)).toContain("You do not need to log in to the server. The runner is downloaded by the server itself and checked before it is installed.")
      expect(panel(screen, "Team code")).toContain(`${(await openTeam(m.deps)).teamCode} Identifies your team. A server checks it before it agrees to obey your team.`)
      expect(panel(screen, "Server code")).toContain("Appears when setup finishes. Identifies this server's key. Teammates compare it before they trust the server.")
      expect(lastLine(screen)).toBe("o show details  esc cancel")
      fits(screen, 100, 30)
      fits(draw(update(settingUp, { type: "resize", columns: 80, rows: 24 }).state, 80, 24), 80, 24)

      // A deploy then reaches the runner where the installer put it, over one connection.
      m.compose(COMPOSE_V1)
      expect(await m.zekno("deploy", "--app", "web", "--server", "prod")).toBe(0)
      expect(ssh.calls().at(-1)).toBe(`-- deploy@203.0.113.7 ${RUNNER_PATHS.user} session`)
    })
  }, 60_000)

  test("o shows what the server printed, cleaned; a step that fails is marked and the details can be fixed", async () => {
    const m = machine()
    const server = standInServer()
    server.noCompose()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    await withSsh(sshStandIn(server), async () => {
      const app = await named(m)
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.state.notice).toEqual({
        tone: "error",
        text: "Docker with Compose was not found on the server. Install Docker with its Compose plugin there, then try again.",
      })
      expect(top(app.state)).toMatchObject({ name: "add-server", step: "destination", destination: "deploy@203.0.113.7", serverName: "prod" })
      expect(app.state.adding?.steps).toEqual({ connect: { state: "done", detail: expect.any(String) }, docker: { state: "failed" } } as never)
      const screen = app.draw()
      expect(screen).toContain("✖ Find Docker with Compose")
      expect(profileServers(m)).toEqual([])
    })

    // What the server prints on standard error is kept, cleaned, and shown on `o`.
    const lines = update(
      update(initialState({ kind: "no-team" }, SIZE), { type: "add-started", destination: "d@h", name: "prod", local: false }).state,
      { type: "add-line", line: "curl: (6) Could not resolve host" }
    ).state
    const working: State = { ...lines, stack: [{ name: "add-server", step: "working", destination: "d@h", serverName: "prod", output: false }] }
    const shown = draw(update(working, text("o")).state)
    expect(shown).toContain("╭─ Details ─")
    expect(shown).toContain("curl: (6) Could not resolve host")
    expect(lastLine(shown)).toBe("o hide details  esc cancel")
  })

  test("a runner set up for this team by an earlier attempt is carried on from, and nothing is downloaded", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    server.installed(realRunner(m.docker.path))
    await withSsh(sshStandIn(server), async () => {
      const app = await named(m)
      // An earlier attempt got as far as setup, then stopped.
      const team = await openTeam(m.deps)
      expect((await runner(server.folder, m.docker.path, "setup", { founding: team.profile.rosters[0], teamCode: team.teamCode })).code).toBe(0)
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.failures).toEqual([])
      expect(top(app.state).name).toBe("home")
      expect(app.state.adding?.steps.runner).toEqual({ state: "done", detail: "version 0.2.0", found: true })
      expect(app.state.adding?.steps.set_up).toEqual({ state: "done", detail: "carried on from an earlier attempt" })
      expect(server.calls("curl")).toEqual([])
      expect(profileServers(m).map((entry) => entry.name)).toEqual(["prod"])
    })
  }, 60_000)

  test("a runner of another team stops it, and nothing is changed here or there", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    server.installed(realRunner(m.docker.path))
    const signer = createSigner(generateMemberKeyPair().secretKey)
    const other = await startTeam({ founderName: "Eve", signer })
    signer.destroy()
    expect((await runner(server.folder, m.docker.path, "setup", { founding: other.envelope, teamCode: other.confirmationCode })).code).toBe(0)
    const before = filesUnder(server.folder)
    await withSsh(sshStandIn(server), async () => {
      const app = await named(m)
      const profile = readFileSync(join(m.home, "profile.json"), "utf8")
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.state.notice).toEqual({ tone: "error", text: "The runner on that server already belongs to a team. It is not overwritten." })
      expect(readFileSync(join(m.home, "profile.json"), "utf8")).toBe(profile)
      expect(filesUnder(server.folder)).toEqual(before)
      expect(server.calls("curl")).toEqual([])
    })
  }, 60_000)

  test("an older runner is reported and used as it is: never updated unasked; u asks, and only then is it updated", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const older = olderRunner(m.docker.path)
    server.installed(older)
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      const app = await named(m)
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.failures).toEqual([])
      expect(top(app.state).name).toBe("home")
      expect(app.state.adding?.steps.runner).toEqual({ state: "done", detail: "from before 0.2.0, out of date", found: true })
      expect(app.state.notice?.tone).toBe("warning")
      expect(app.state.notice?.text).toContain("Its runner is older than this zekno: deploys work, and u updates it.")
      // Nothing was downloaded and the runner is as it was.
      expect(server.calls("curl")).toEqual([])
      expect(readFileSync(server.runnerPath, "utf8")).toBe(older)
      // Home says so beside the server, and offers u.
      expect(app.state.team?.servers[0]).toMatchObject({ name: "prod", reachable: true, runner: { outdated: true } })
      const home = app.draw()
      expect(home).toMatch(/❯ prod +│/)
      expect(home).toMatch(/│ {3}! old runner +│/)
      expect(lastLine(home)).toBe("↑↓ move  ←→ pane  enter open  a add  u update runner  ? help  q quit")

      // u asks first, as on the board; esc leaves it alone.
      app.type("u")
      const asked = app.draw()
      expect(asked).toContain("╭─ The runner on prod is out of date ─")
      expect(asked).toMatch(/on prod +from before 0\.2\.0/)
      expect(asked).toMatch(/this zekno +0\.2\.0/)
      expect(words(asked)).toContain("Deploys still work. Running state and logs need the newer runner.")
      expect(words(asked)).toContain("Updating downloads the runner on prod and checks it before it replaces the old one. Your apps keep running.")
      expect(lastLine(asked)).toBe("u update now  esc later")
      app.press({ kind: "escape" })
      expect(app.state.question).toBeUndefined()
      expect(readFileSync(server.runnerPath, "utf8")).toBe(older)

      // u, u: updated by the same verified route, then asked again.
      app.type("u")
      app.type("u")
      await app.until(() => app.state.team?.servers[0]?.runner?.outdated === false, "the runner to be updated")
      expect(readFileSync(server.runnerPath, "utf8")).toBe(realRunner(m.docker.path))
      expect(server.calls("curl")).toHaveLength(1)
      expect(app.draw()).toMatch(/❯ prod +●/)
      expect(app.failures).toEqual([])
    })
  }, 60_000)
})

describe("SSH questions inside the app (research R10)", () => {
  test("whether SSH would have asked: only SSH's own failure, before any answer, for a password or a host key", () => {
    const ask = (exitCode: number, lines: string[], answered = false) => needsAnswers({ exitCode, answered, lines })
    expect(ask(255, ["deploy@host: Permission denied (publickey,password)."])).toBe(true)
    expect(ask(255, ["deploy@host: Permission denied (publickey)."])).toBe(true)
    expect(ask(255, ["Host key verification failed."])).toBe(true)
    expect(ask(255, ["ssh: connect to host host port 22: Connection refused"])).toBe(false)
    expect(ask(255, ["ssh: Could not resolve hostname nowhere: nodename nor servname provided"])).toBe(false)
    expect(ask(255, [])).toBe(false)
    expect(ask(1, ["deploy@host: Permission denied (publickey)."])).toBe(false)
    expect(ask(2, ["Host key verification failed."])).toBe(false)
    expect(ask(255, ["deploy@host: Permission denied (publickey)."], true)).toBe(false)
    // A banner before SSH's closing line changes nothing: the last line is what counts.
    expect(ask(255, ["Welcome to prod.", "", "deploy@host: Permission denied (publickey,password).", ""])).toBe(true)
    // The words in what a remote command wrote are not SSH's line, so its request is never sent a second time.
    expect(ask(255, ["sh: ./build.sh: Permission denied"])).toBe(false)
    expect(ask(255, ["permission denied while trying to connect to the Docker daemon socket"])).toBe(false)
    expect(ask(255, ["Permission denied"])).toBe(false)
    expect(ask(255, ["deploy@host: Permission denied (publickey).", "Error response from daemon: no such container"])).toBe(false)
    expect(ask(255, ["Host key verification failed. Or so this line says."])).toBe(false)
    // A long banner first: the last line still decides.
    expect(ask(255, [...Array.from({ length: 200 }, () => "banner"), "deploy@host: Permission denied (publickey)."])).toBe(true)
    expect(handOverNote("deploy@203.0.113.7")).toBe("SSH needs an answer to reach deploy@203.0.113.7. zekno carries on once it is connected.")
  })

  test("batch mode first; when SSH would ask, the terminal is handed over, the request sent again, and taken back at the runner's first answer", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const ssh = sshStandIn(server)
    ssh.ask()
    const timeline: string[] = []
    const terminal: Terminal = {
      async suspend(note) {
        timeline.push(`suspend ${note}`)
        return async () => void timeline.push("resume")
      },
    }
    await withSsh(ssh, async () => {
      const app = await named(m, terminal)
      let connected = false
      app.store.subscribe(() => {
        if (app.state.adding?.steps.connect && !connected) {
          connected = true
          timeline.push("connected")
        }
      })
      await added(app, "deploy@203.0.113.7", "prod")
      expect(app.failures).toEqual([])
      expect(top(app.state).name).toBe("home")
      // Asked once in batch mode, which failed; then once without, which went on to the session.
      const install = `deploy@203.0.113.7 sh -s -- add 0.2.0 release x64 ${m.deps.release!.files["linux-x64"].sha256}`
      expect(ssh.calls()).toEqual([`-o BatchMode=yes -- ${install}`, `-- ${install}`])
      expect(timeline).toEqual([`suspend ${handOverNote("deploy@203.0.113.7")}`, "resume", "connected"])

      // Home's check of each server goes the same way.
      timeline.length = 0
      await app.effects.checkServers()
      expect(ssh.calls().slice(-2)).toEqual([`-o BatchMode=yes -- deploy@203.0.113.7 ${RUNNER_PATHS.user} session`, `-- deploy@203.0.113.7 ${RUNNER_PATHS.user} session`])
      expect(timeline).toEqual([`suspend ${handOverNote("deploy@203.0.113.7")}`, "resume"])
      expect(app.state.team?.servers[0]?.reachable).toBe(true)
    })
  }, 60_000)

  test("with a key that needs nothing typed, the terminal is never handed over", async () => {
    const m = machine()
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const ssh = sshStandIn(server)
    const suspended: string[] = []
    await withSsh(ssh, async () => {
      const app = await named(m, { suspend: async (note) => (suspended.push(note), async () => {}) })
      await added(app, "deploy@203.0.113.7", "prod")
      expect(top(app.state).name).toBe("home")
    })
    expect(suspended).toEqual([])
    expect(ssh.calls()).toHaveLength(1)
    expect(ssh.calls()[0]).toStartWith("-o BatchMode=yes -- deploy@203.0.113.7 sh -s -- add")
  }, 60_000)

  test("one hand-over at a time", async () => {
    const order: string[] = []
    let open = 0
    const terminal = oneAtATime({
      async suspend(note) {
        open++
        order.push(`suspend ${note} (${open} open)`)
        await Bun.sleep(20)
        return async () => {
          open--
          order.push(`resume ${note}`)
        }
      },
    })
    await Promise.all(
      ["a", "b", "c"].map(async (note) => {
        const takeBack = await terminal.suspend(note)
        await Bun.sleep(10)
        await takeBack()
      })
    )
    expect(order).toEqual(["suspend a (1 open)", "resume a", "suspend b (1 open)", "resume b", "suspend c (1 open)", "resume c"])
  })
})

// ---------------------------------------------------------------------------
// The single commands

describe("`zekno server add --ssh` and `zekno server update`", () => {
  test("server add installs from a release, and says where; a second team server finds it there", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test")).toBe(0)
    })
    expect(m.out).toContain(`Installed the runner 0.2.0 at ${RUNNER_PATHS.user}. It matched the checksum this zekno holds.`)
    expect(m.out).toContain('Connected "prod" and added it to the team list.')
    expect(m.err).toEqual([])
    expect(ssh.calls()).toHaveLength(1)
  }, 60_000)

  test("with no published checksum and no runner there, it stops with that sentence, and changes nothing", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    server.release(realRunner(m.docker.path))
    m.deps.release = { version: "0.2.0", files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } } }
    await withSsh(sshStandIn(server), async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test")).toBe(1)
    })
    expect(m.lastErr()).toBe(NO_RELEASE)
    expect(profileServers(m)).toEqual([])
    expect(existsSync(server.runnerPath)).toBe(false)
    expect(server.calls("curl")).toEqual([])
  }, 60_000)

  test("--runner-file sends a local runner and checks it on arrival; a runner path installs nothing", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    const file = join(m.project, "zekno-runner-linux-x64")
    await Bun.write(file, realRunner(m.docker.path))
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test", "--runner-file", file)).toBe(0)
    })
    expect(m.out).toContain(`Installed the runner 0.2.0 at ${RUNNER_PATHS.user}. It matched the file this zekno sent.`)
    expect(readFileSync(server.runnerPath, "utf8")).toBe(realRunner(m.docker.path))
    // The file went on the installer's connection; the session needed a second.
    expect(ssh.calls()).toEqual([`-- deploy@example.test sh -s -- add 0.2.0 file ${sha256(realRunner(m.docker.path))}`, `-- deploy@example.test ${RUNNER_PATHS.user} session`])
    expect(server.calls("curl")).toEqual([])
    // --runner-file goes with --ssh only, and not with --runner-path.
    expect(await m.zekno("server", "add", "x", "--local", "--runner-file", file)).toBe(2)
    expect(await m.zekno("server", "add", "x", "--ssh", "a@b", "--runner-path", "zekno-runner", "--runner-file", file)).toBe(2)
    expect(await m.zekno("server", "add", "x", "--ssh", "a@b", "--runner-file", join(m.project, "missing"))).toBe(1)
    expect(m.lastErr()).toBe("There is no runner file at that path.")
  }, 60_000)

  test("server update asks at a terminal, needs --yes without one, and never updates unasked", async () => {
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    const server = standInServer()
    m.deps.release = releaseOf(server, realRunner(m.docker.path))
    const older = olderRunner(m.docker.path)
    server.installed(older)
    const ssh = sshStandIn(server)
    await withSsh(ssh, async () => {
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test")).toBe(0)
      expect(m.out).toContain(`Using the runner already at ${RUNNER_PATHS.user}.`)
      expect(m.lastErr()).toBe(
        "The runner on prod is from before version 0.2.0, older than this zekno's 0.2.0. Deploys still work. Running state and logs need the newer runner: run `zekno server update prod`."
      )
      expect(await m.zekno("status", "--server", "prod")).toBe(0)
      expect(m.lastErr()).toContain("The runner on prod is from before version 0.2.0")

      // No terminal: it never asks, and names --yes.
      expect(await m.zekno("server", "update", "prod")).toBe(1)
      expect(m.lastErr()).toBe("There is no terminal to ask on. Add `--yes` to update the runner on prod.")
      // At a terminal: no is no.
      const questions: string[] = []
      const plain = m.deps.ui
      m.deps.ui = { ...plain, confirm: async (question) => (questions.push(question), false) }
      expect(await m.zekno("server", "update", "prod")).toBe(0)
      expect(questions).toEqual(["Replace the runner on prod with version 0.2.0? The server downloads it and checks it before it replaces the old one."])
      expect(m.lastOut()).toBe("Nothing was changed.")
      expect(readFileSync(server.runnerPath, "utf8")).toBe(older)
      expect(server.calls("curl")).toEqual([])
      // Yes, at a terminal.
      m.deps.ui = { ...plain, confirm: async () => true }
      expect(await m.zekno("server", "update", "prod")).toBe(0)
      expect(m.lastOut()).toBe("Updated the runner on prod to 0.2.0. It matched the checksum this zekno holds.")
      expect(readFileSync(server.runnerPath, "utf8")).toBe(realRunner(m.docker.path))
      m.deps.ui = plain
      // --yes without a terminal; already up to date, nothing is downloaded again.
      expect(await m.zekno("server", "update", "prod", "--yes")).toBe(0)
      expect(m.lastOut()).toBe("The runner on prod already has version 0.2.0. Nothing was changed.")
      expect(server.calls("curl")).toHaveLength(1)
      // And it answers as the same server, now with sessions.
      expect(await m.zekno("status", "--server", "prod")).toBe(0)
    })
    // A runner on this machine is not updated this way.
    expect(await m.zekno("server", "add", "dev", "--local")).toBe(0)
    expect(await m.zekno("server", "update", "dev", "--yes")).toBe(1)
    expect(m.lastErr()).toBe("dev is a runner on this machine. It comes with zekno itself, so there is nothing to update.")

    // The runner's path in the profile file is not signed. An update replaces only a file named
    // zekno-runner, so an edited profile cannot point it at another program on the server: it is
    // refused before anything is asked or sent.
    const profilePath = join(m.deps.home, "profile.json")
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as { servers: { name: string; target: { runnerPath?: string } }[] }
    profile.servers.find((server) => server.name === "prod")!.target.runnerPath = "/usr/sbin/sshd"
    writeFileSync(profilePath, JSON.stringify(profile))
    const calls = ssh.calls().length
    const asked: string[] = []
    m.deps.ui = { ...m.deps.ui, confirm: async (question) => (asked.push(question), true) }
    await withSsh(ssh, async () => {
      expect(await m.zekno("server", "update", "prod", "--yes")).toBe(1)
      expect(await m.zekno("server", "update", "prod")).toBe(1)
    })
    expect(m.lastErr()).toBe("zekno only replaces a runner whose file is named zekno-runner. The runner for prod is at /usr/sbin/sshd. Replace that one by hand.")
    expect(asked).toEqual([])
    expect(ssh.calls()).toHaveLength(calls)
  }, 90_000)

  test("a yes-or-no question at a terminal is no unless y", () => {
    expect(yesOrNo("y", {})).toBe(true)
    expect(yesOrNo("Y", {})).toBe(true)
    expect(yesOrNo("n", {})).toBe(false)
    expect(yesOrNo("", { return: true })).toBe(false)
    expect(yesOrNo("", { escape: true })).toBe(false)
    expect(yesOrNo("c", { ctrl: true })).toBe(false)
    expect(yesOrNo("x", {})).toBeUndefined()
    expect(yesOrNo("yes", {})).toBeUndefined()
    const plain = plainUi(
      () => {},
      () => {}
    )
    expect(plain.confirm("Sure?", "There is no terminal to ask on.")).rejects.toThrow("There is no terminal to ask on.")
  })
})

// ---------------------------------------------------------------------------
// Pure pieces

describe("what the screens say", () => {
  test("each step's words before, during and after, and what was found", () => {
    const rows = (steps: NonNullable<State["adding"]>["steps"], running = true, local = false) =>
      addRows({ destination: "d@h", name: "prod", local, steps, lines: [], running }, "prod", local).map((row) => `${row.state} ${row.label}${row.detail ? ` (${row.detail})` : ""}`)
    expect(rows({}, false)).toEqual([
      "pending Connect over SSH",
      "pending Find Docker with Compose",
      "pending Install the runner",
      "pending Set the runner up for your team",
      "pending Add prod to the signed team list",
    ])
    expect(rows({ connect: { state: "done", detail: "0.8s" }, docker: { state: "done", detail: "v5.6.0" } })).toEqual([
      "done Connected over SSH (0.8s)",
      "done Docker with Compose found (v5.6.0)",
      "active Installing the runner",
      "pending Set the runner up for your team",
      "pending Add prod to the signed team list",
    ])
    expect(rows({ connect: { state: "done" }, docker: { state: "done" }, runner: { state: "done", detail: "version 0.2.0", found: true }, set_up: { state: "failed" } }, false)).toEqual([
      "done Connected over SSH",
      "done Docker with Compose found",
      "done Runner found (version 0.2.0)",
      "failed Set the runner up for your team",
      "pending Add prod to the signed team list",
    ])
    expect(rows({ connect: { state: "done" } }, true, true)).toEqual([
      "done Runner started on this machine",
      "active Setting the runner up for your team",
      "pending Add prod to the signed team list",
    ])
    expect(megabytes(27_400_000)).toBe("27 MB")
    expect(megabytes(10)).toBe("1 MB")
    expect(foundDetail("0.2.0", "0.2.0")).toBe("version 0.2.0")
    expect(foundDetail("0.1.0", "0.2.0")).toBe("version 0.1.0, out of date")
    expect(foundDetail("0.3.0", "0.2.0")).toBe("version 0.3.0")
    expect(foundDetail(undefined, "0.2.0")).toBe("from before 0.2.0, out of date")
  })

  test("only the add's own failure marks where it stopped; another effect's failure leaves it running", () => {
    const started = update(initialState({ kind: "no-team" }, SIZE), { type: "add-started", destination: "d@h", name: "prod", local: false }).state
    expect(update(started, { type: "failed", notice: { tone: "error", text: "Something else." } }).state.adding?.running).toBe(true)
    const failed = update(started, { type: "failed", notice: { tone: "error", text: "No." }, from: "add-server" }).state.adding
    expect(failed).toMatchObject({ running: false, steps: { connect: { state: "failed" } } })
  })

  test("a runner is out of date when it has no sessions or an older version", () => {
    expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0)
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0)
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
    expect(isOutdated("one-shot", undefined, "0.2.0")).toBe(true)
    expect(isOutdated("session", { version: "0.1.9", protocol: 2 }, "0.2.0")).toBe(true)
    expect(isOutdated("session", { version: "0.2.0", protocol: 2 }, "0.2.0")).toBe(false)
    expect(isOutdated("session", { version: "1.0.0", protocol: 3 }, "0.2.0")).toBe(false)
  })

  test("Home: `! runner 0.1.0` beside a server that is out of date, and `u` in the hints only then", () => {
    const team: TeamView = {
      member: "ada",
      version: 2,
      servers: [
        { name: "prod", destination: "deploy@203.0.113.7", reachable: true, runner: { version: "0.1.0", outdated: true }, apps: [] },
        { name: "staging", destination: "staging-box", reachable: true, runner: { version: "0.2.0", outdated: false }, apps: [] },
      ],
    }
    const home = initialState({ kind: "team", team }, SIZE)
    const screen = draw(home)
    expect(screen).toMatch(/❯ prod +│/)
    expect(screen).toMatch(/│ {3}! runner 0\.1\.0 +│/)
    expect(screen).toMatch(/ {3}staging +●/)
    expect(lastLine(screen)).toBe("↑↓ move  ←→ pane  enter open  a add  u update runner  ? help  q quit")
    expect(homeHints(team.servers[1]).map(([k]) => k)).not.toContain("u")
    const onStaging = update(home, key({ kind: "down" })).state
    expect(lastLine(draw(onStaging))).toBe("↑↓ move  ←→ pane  enter open  a add  ? help  q quit")
    const asked = draw(update(home, text("u")).state)
    expect(asked).toMatch(/on prod +0\.1\.0/)
    fits(draw(update(home, text("u")).state, 80, 24), 80, 24)
    // Once it cannot be reached, its version is not known: no mark and no u.
    const gone = update(home, { type: "server-reached", server: "prod", reachable: false, problem: "gone" }).state
    expect(gone.team?.servers[0]?.runner).toBeUndefined()
    expect(draw(gone)).toMatch(/❯ prod +✖/)
  })
})
