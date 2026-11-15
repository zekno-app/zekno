/**
 * `zekno doctor` (specs/006-cli-small-features, User Story 4,
 * contracts/doctor.md, mock-ups 5 and 6): each check and each result, the
 * broken setups of quickstart.md ("SC-004"), `--server`, `--json`, the plain
 * lines and the drawn report, and the newer-release check on its first line.
 *
 * Servers are stand-in servers behind stand-in `ssh`s, reached through one
 * router that sends each destination to its own, with the real runner and the
 * stand-in Docker. Every run of `doctor` here also checks that nothing
 * changed (SC-005): every file of the profile folder, the project folder and
 * each stand-in server, with its mode, is byte for byte what it was, and
 * every connection was a read in SSH's batch mode.
 */
import { describe, expect, test } from "bun:test"
import { appendFileSync, chmodSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import runnerPackage from "../../../runner/package.json"
import { tempDir } from "../../../runner/test/helpers"
import { READ_LIMIT_MS } from "../../src/app/effects"
import { doctorJson } from "../../src/commands/doctor"
import { readCompose } from "../../src/compose-read"
import { DOCTOR_LIMIT_MS, freeText, runDoctor, sessionSentence, type DoctorReport } from "../../src/ops/doctor"
import { profileStore } from "../../src/profile"
import { findProject, shownPath } from "../../src/project"
import { doctorCounts, SERVERS_SKIPPED } from "../../src/ui/types"
import type { Fetch } from "../../src/version/newest"
import { CLI_VERSION } from "../../src/version/version"
import { answering, machine, twin } from "../helpers"
import { olderRunner, realRunner, reportingRunner, snapshot, sshStandIn, stallingRunner, standInServer, stillRunning, withSsh, type StandInServer } from "../stand-in-server"
import { terminal } from "../ui/terminal"

/** The version the repository's runner reports, and so the one a stand-in release made from it carries: this zekno's. */
const OWN = runnerPackage.version
const PATH = "~/.local/bin/zekno-runner"
const COMPOSE = "services:\n  web:\n    image: example/web:1\n"
/** 133 GB free, as mock-up 5 shows: 129,882,813 KiB is 133,000,000,512 bytes. */
const ROOMY = 129_882_813

/** A stand-in for GitHub's answer about the latest release: `fails`, or a release tag. Counts its calls. */
function github(tag: string | "fails", wait = 0) {
  let calls = 0
  let settled = false
  const fetch: Fetch = async () => {
    calls++
    settled = false
    if (wait > 0) await Bun.sleep(wait)
    settled = true
    if (tag === "fails") throw new TypeError("fetch failed")
    return new Response(JSON.stringify({ tag_name: tag, prerelease: false, draft: false }), { status: 200 })
  }
  return { fetch, calls: () => calls, settled: () => settled }
}

/** A connection that is a read in batch mode: the check script, a session, or an older runner's one-shot `status`. */
const READ_ONLY = /^-o BatchMode=yes -- \S+ (sh -s -- check ~\/\.local\/bin\/zekno-runner|~\/\.local\/bin\/zekno-runner (session|status))$/

/** An executable script in a folder of its own. */
function script(text: string): string {
  const path = join(tempDir("script"), "run")
  writeFileSync(path, `#!/bin/sh\n${text}`)
  chmodSync(path, 0o755)
  return path
}

/**
 * A machine with a team, and servers over stand-in `ssh`s: `ssh` is a router
 * that notes each call and sends it to the stand-in its destination names.
 * `route` sends a destination elsewhere (the last route given wins).
 */
async function fleet() {
  const m = machine()
  expect(await m.zekno("init", "--name", "Ada")).toBe(0)
  const dir = tempDir("fleet")
  const map = join(dir, "map")
  const log = join(dir, "calls")
  writeFileSync(map, "")
  const ssh = script(`printf '%s\\n' "$*" >> "${log}"
dest=
next=
for word in "$@"; do
  if [ -n "$next" ]; then dest=$word; break; fi
  [ "$word" = -- ] && next=1
done
target=$(awk -v d="$dest" '$1 == d { t = $2 } END { print t }' "${map}")
[ -n "$target" ] || exit 255
exec "$target" "$@"
`)
  const remotes: Record<string, { server: StandInServer; stand: ReturnType<typeof sshStandIn>; destination: string }> = {}
  const run = <T>(work: () => Promise<T>) => withSsh({ path: ssh }, work)
  const route = (destination: string, to: string) => appendFileSync(map, `${destination} ${to}\n`)
  return {
    m,
    remotes,
    route,
    run,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []),
    /** Adds a server over SSH as `zekno server add` does: the installer from the stand-in release, or a runner already at its path. */
    async add(name: string, destination: string, options: { runnerPath?: boolean } = {}) {
      const server = standInServer()
      const stand = sshStandIn(server)
      route(destination, stand.path)
      remotes[name] = { server, stand, destination }
      if (options.runnerPath) {
        server.installed(realRunner(m.docker.path))
        expect(await run(() => m.zekno("server", "add", name, "--ssh", destination, "--runner-path", PATH))).toBe(0)
      } else {
        m.deps.release = { version: OWN, files: { "linux-x64": { sha256: server.release(realRunner(m.docker.path)) }, "linux-arm64": { sha256: null } } }
        expect(await run(() => m.zekno("server", "add", name, "--ssh", destination))).toBe(0)
      }
      return remotes[name]!
    },
  }
}
type Fleet = Awaited<ReturnType<typeof fleet>>

/** Runs `work` with `ssh` meaning the router, and checks that nothing changed anywhere and every connection only read. */
async function unchanged<T>(f: Fleet, work: () => Promise<T>): Promise<T> {
  const roots = [f.m.home, f.m.project, ...Object.values(f.remotes).map((remote) => remote.server.root)]
  const before = roots.map(snapshot)
  const links = existsSync(join(f.m.home, "links.json"))
  const calls = f.calls().length
  const result = await f.run(work)
  expect(roots.map(snapshot)).toEqual(before)
  expect(existsSync(join(f.m.home, "links.json"))).toBe(links)
  for (const call of f.calls().slice(calls)) expect(call).toMatch(READ_ONLY)
  return result
}

/** `zekno doctor <args>` with the plain interface: its status and what it printed. Nothing may change. */
async function doctor(f: Fleet, ...args: string[]) {
  const [out, err] = [f.m.out.length, f.m.err.length]
  const code = await unchanged(f, () => f.m.zekno("doctor", ...args))
  return { code, out: f.m.out.slice(out), err: f.m.err.slice(err) }
}

/** `runDoctor`, as data. Nothing may change. */
const report = (f: Fleet, options: Parameters<typeof runDoctor>[1] = {}) => unchanged(f, () => runDoctor(f.m.deps, options))

/** One server, prod, every check good; the folder linked to demo on prod; GitHub says this is the newest release. */
async function baseline() {
  const f = await fleet()
  const prod = await f.add("prod", "deploy@203.0.113.7")
  prod.server.df(ROOMY)
  f.m.compose(COMPOSE)
  expect(await f.m.zekno("link", "--app", "demo", "--server", "prod")).toBe(0)
  f.m.deps.fetch = github(`runner-v${OWN}`).fetch
  return { f, prod }
}

const MACHINE_GOOD = [
  `this machine\tzekno\tgood\t${CLI_VERSION}, installs runner ${OWN}`,
  "this machine\tkey\tgood\tin your system keychain",
  "this machine\tprofile\tgood\tverified, team list v2",
  "this machine\tfolder\tgood\tlinked to demo on prod, compose.yaml is readable",
]
const BASELINE = [
  ...MACHINE_GOOD,
  "prod\treachable\tgood\tover SSH",
  "prod\tdocker\tgood\tCompose 2.40.3",
  `prod\trunner\tgood\t${OWN}`,
  "prod\tdisk\tgood\t133 GB free",
  "No problems, no warnings.",
]
const PROD_NOT_CHECKED = ["prod\tdocker\tnot checked", "prod\trunner\tnot checked", "prod\tdisk\tnot checked"]

/** The baseline's lines with some replaced, by their check's place, and the last line said again. */
function changed(replacements: Record<number, string[]>, last: string): string[] {
  const lines: string[] = []
  BASELINE.slice(0, -1).forEach((line, index) => lines.push(...(replacements[index] ?? [line])))
  return [...lines.filter((line) => line !== ""), last]
}

describe("the sentences of contracts/doctor.md", () => {
  test("D30, the free space, and D43", () => {
    expect(doctorCounts(1, 1)).toBe("1 problem, 1 warning.")
    expect(doctorCounts(0, 0)).toBe("No problems, no warnings.")
    expect(doctorCounts(0, 2)).toBe("No problems, 2 warnings.")
    expect(doctorCounts(3, 1)).toBe("3 problems, 1 warning.")
    expect(SERVERS_SKIPPED).toBe("No server was checked, because the profile could not be verified.")
    expect(freeText(ROOMY)).toBe("133 GB")
    expect(freeText(100_000)).toBe("102 MB")
    expect(freeText(1)).toBe("1 MB")
    expect(sessionSentence(new Error("The runner did not answer as expected. Check that it is installed and reachable."))).toBe("did not answer as expected")
    expect(sessionSentence(new Error("The connection to the runner ended before it answered."))).toBe("The connection to the runner ended before it answered")
  })

  test("each connection's limit is the app's 20 seconds", () => {
    expect(DOCTOR_LIMIT_MS).toBe(READ_LIMIT_MS)
  })
})

describe("everything in order, and the broken setups of quickstart.md (SC-004)", () => {
  test("everything in order: every check good, status 0; the versions are this zekno's and the runner's own (FR-032, SC-008)", async () => {
    const { f } = await baseline()
    expect(await doctor(f)).toEqual({ code: 0, out: BASELINE, err: [] })
  }, 60_000)

  test("1. no profile at all: Key, with what to run; nothing else is checked; status 1", async () => {
    const m = machine()
    const f = { m, remotes: {}, route: () => {}, run: <T>(work: () => Promise<T>) => work(), calls: () => [] } as unknown as Fleet
    expect(await doctor(f)).toEqual({
      code: 1,
      out: [
        `this machine\tzekno\tgood\t${CLI_VERSION}, installs runner ${OWN}`,
        "this machine\tkey\tproblem\tno team on this machine\tRun zekno deploy in a project folder, or zekno init",
        "this machine\tprofile\tnot checked",
        SERVERS_SKIPPED,
        "1 problem, no warnings.",
      ],
      err: [],
    })
  })

  test("2 to 12: each broken thing is its line, with its next step; every other line is as before", async () => {
    const { f, prod } = await baseline()
    const { m } = f
    const runner = realRunner(m.docker.path)
    const keyName = profileStore(m.home).load().keyName
    const zeknoJson = join(m.project, "zekno.json")
    const profileJson = join(m.home, "profile.json")
    const restore = (path: string, text: string | Buffer) => () => writeFileSync(path, text)
    const remove = (path: string) => () => rmSync(path, { force: true })
    const missing = (() => {
      try {
        readCompose({ kind: "project", link: findProject(m.project)! })
      } catch {
        // Not now: the file is there.
      }
      rmSync(join(m.project, "compose.yaml"))
      try {
        readCompose({ kind: "project", link: findProject(m.project)! })
        return "read"
      } catch (error) {
        return (error as Error).message
      } finally {
        m.compose(COMPOSE)
      }
    })()
    const skipped = (key: string[], profile: string[]) =>
      [`this machine\tzekno\tgood\t${CLI_VERSION}, installs runner ${OWN}`, ...key, ...profile, "this machine\tfolder\tnot checked", SERVERS_SKIPPED, "1 problem, no warnings."]

    const cases: { name: string; brk: () => Promise<() => unknown> | (() => unknown); out: string[]; code: number }[] = [
      {
        name: "2. the keychain entry removed",
        brk: async () => {
          const entry = (await m.keyStore.get(keyName))!
          await m.keyStore.delete(keyName)
          return () => m.keyStore.set(keyName, entry)
        },
        out: skipped(["this machine\tkey\tproblem\tnot in the system keychain\tRestore the keychain from a backup: the key is kept nowhere else"], ["this machine\tprofile\tnot checked"]),
        code: 1,
      },
      {
        name: "3. a team list in profile.json changed",
        brk: () => {
          const text = readFileSync(profileJson, "utf8")
          const json = JSON.parse(text)
          json.rosters = json.rosters.slice(0, 1)
          writeFileSync(profileJson, JSON.stringify(json))
          return restore(profileJson, text)
        },
        out: skipped(
          ["this machine\tkey\tgood\tin your system keychain"],
          [`this machine\tprofile\tproblem\tcould not be verified\tRestore ${shownPath(m.home)} from a copy you trust: zekno does not repair it`]
        ),
        code: 1,
      },
      {
        name: "4. a zekno.json not signed by the team",
        brk: () => {
          const text = readFileSync(zeknoJson)
          writeFileSync(zeknoJson, '{ "app": "demo", "server": "prod" }\n')
          return restore(zeknoJson, text)
        },
        out: changed(
          { 3: ["this machine\tfolder\tproblem\tzekno.json is not signed by your team\tRun zekno link --app <name> --server <name> --force to link this folder yourself"] },
          "1 problem, no warnings."
        ),
        code: 1,
      },
      {
        name: "5. a linked folder whose compose.yaml was deleted",
        brk: () => {
          rmSync(join(m.project, "compose.yaml"))
          return () => m.compose(COMPOSE)
        },
        out: changed({ 3: [`this machine\tfolder\tproblem\tlinked to demo on prod, compose.yaml cannot be read\t${missing}`] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "6. a server that is down",
        brk: () => {
          prod.stand.down()
          return remove(join(dirname(prod.stand.path), "down"))
        },
        out: changed({ 4: ["prod\treachable\tproblem\tcould not be reached over SSH\tCheck with: ssh deploy@203.0.113.7 true", ...PROD_NOT_CHECKED], 5: [""], 6: [""], 7: [""] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "7. a server where SSH would ask",
        brk: () => {
          prod.stand.ask()
          return remove(join(dirname(prod.stand.path), "ask"))
        },
        out: changed({ 4: ["prod\treachable\tproblem\tSSH needs an answer\tOpen zekno and press enter on prod", ...PROD_NOT_CHECKED], 5: [""], 6: [""], 7: [""] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "8. a server without Docker Compose",
        brk: () => {
          prod.server.noCompose()
          return remove(join(prod.server.root, "state", "no-compose"))
        },
        out: changed({ 5: ["prod\tdocker\tproblem\tnot found with Compose\tInstall Docker with its Compose plugin on prod"] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "9. an older runner",
        brk: () => {
          writeFileSync(prod.server.runnerPath, reportingRunner(m.docker.path, "0.0.9", 2))
          return restore(prod.server.runnerPath, runner)
        },
        out: changed({ 6: [`prod\trunner\twarning\t0.0.9, older than this zekno's ${OWN}\tRun zekno server update prod`] }, "No problems, 1 warning."),
        code: 0,
      },
      {
        name: "10. the runner removed from its path",
        brk: () => {
          rmSync(prod.server.runnerPath)
          return () => prod.server.installed(runner)
        },
        out: changed({ 6: [`prod\trunner\tproblem\tnot found at ${PATH}\tPut the runner back at that path, as apps/runner/README.md describes`] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "11. a nearly full disk",
        brk: () => {
          prod.server.df(100_000)
          return () => prod.server.df(ROOMY)
        },
        out: changed({ 7: ["prod\tdisk\tproblem\t102 MB free\tFree some space on prod: updating the runner needs 256 MiB"] }, "1 problem, no warnings."),
        code: 1,
      },
      {
        name: "12. a newer runner that speaks a newer protocol",
        brk: () => {
          writeFileSync(prod.server.runnerPath, reportingRunner(m.docker.path, "0.2.0", 3))
          return restore(prod.server.runnerPath, runner)
        },
        out: changed({ 6: [`prod\trunner\tproblem\t0.2.0, newer than this zekno's ${OWN}, and speaks a newer protocol\tUpdate zekno before you deploy to prod`] }, "1 problem, no warnings."),
        code: 1,
      },
    ]
    for (const { name, brk, out, code } of cases) {
      const calls = f.calls().length
      const undo = await brk()
      const done = await doctor(f)
      await undo()
      expect({ name, ...done }).toEqual({ name, code, out, err: [] })
      // With the profile not verified, no server was contacted at all.
      if (out.includes(SERVERS_SKIPPED)) expect({ name, calls: f.calls().length }).toEqual({ name, calls })
    }
    // Put back, everything is in order again.
    expect((await doctor(f)).out).toEqual(BASELINE)
  }, 120_000)
})

describe("each check, and each result (contracts/doctor.md, The checks)", () => {
  test("zekno: a build with no checksum warns with D2; a newer release warns with D50, also over D2 (mock-up 6)", async () => {
    const { f } = await baseline()
    const release = f.m.deps.release!
    f.m.deps.release = { ...release, files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } } }
    let done = await report(f)
    expect(done.machine[0]).toEqual({ check: "zekno", label: "zekno", result: "warning", detail: `${CLI_VERSION}, installs runner ${OWN}`, next: `This build holds no checksum for runner ${OWN}, so it cannot install a runner` })
    f.m.deps.fetch = github("runner-v9.0.0").fetch
    done = await report(f)
    expect(done.machine[0]!.next).toBe("A newer release exists: 9.0.0. Update zekno to get it.")
  }, 60_000)

  test("Key: the keychain cannot be read (D5), the entry is in another form (D9); profile.json cannot be read (D11)", async () => {
    const { f } = await baseline()
    const { m } = f
    const keyStore = m.deps.keyStore
    const keyName = profileStore(m.home).load().keyName
    m.deps.keyStore = { ...keyStore, get: async () => Promise.reject(new Error("the keychain is locked")) }
    let done = await report(f)
    expect(done.machine[1]).toMatchObject({ result: "problem", detail: "the system keychain could not be read", next: "Unlock the keychain, or let zekno read it, and run zekno doctor again" })
    expect(done.machine[2]!.result).toBe("not checked")
    m.deps.keyStore = { ...keyStore, get: async () => "not a key" }
    done = await report(f)
    expect(done.machine[1]).toMatchObject({ result: "problem", detail: "the keychain entry is not in a form this zekno reads", next: "Use the zekno that made this key, or a newer one" })
    m.deps.keyStore = keyStore
    expect((await keyStore.get(keyName)) !== null).toBe(true)

    const profileJson = join(m.home, "profile.json")
    const text = readFileSync(profileJson, "utf8")
    writeFileSync(profileJson, "{ not json")
    done = await report(f)
    writeFileSync(profileJson, text)
    expect(done.machine[1]!.result).toBe("not checked")
    expect(done.machine[2]).toEqual({
      check: "profile",
      label: "Profile",
      result: "problem",
      detail: "profile.json cannot be read",
      next: `Restore ${shownPath(m.home)} from a copy you trust: zekno does not repair it`,
      reason: `The profile at ${profileJson} is not readable.`,
    })
    expect(done.serversSkipped).toBe(true)
    // In --json the Profile line carries the reason.
    expect(JSON.stringify(doctorJson(done))).toContain(`"reason":"The profile at ${profileJson} is not readable."`)
  }, 60_000)

  test("This folder: not linked (D15), linked and not used here (D16), a server not connected (D20), a file that cannot be used (D22), an empty Compose file (D24)", async () => {
    const { f } = await baseline()
    const { m } = f
    // Signed by the team and not used on this machine yet: a second machine of the same member.
    const other = await twin(m)
    other.deps.cwd = m.project
    other.deps.fetch = m.deps.fetch
    const second = await f.run(() => runDoctor(other.deps))
    expect(second.machine[3]).toMatchObject({ result: "warning", detail: "linked to demo on prod by Ada, not used here yet", next: "Run zekno link here to use it" })
    expect(existsSync(join(other.home, "links.json"))).toBe(false)

    const profileJson = join(m.home, "profile.json")
    const text = readFileSync(profileJson, "utf8")
    writeFileSync(profileJson, JSON.stringify({ ...JSON.parse(text), servers: [] }))
    let done = await report(f)
    writeFileSync(profileJson, text)
    expect(done.machine[3]).toMatchObject({ result: "problem", detail: "zekno.json names prod, which is not connected here", next: "Connect it, or link this folder again with zekno link --force" })

    const zeknoJson = join(m.project, "zekno.json")
    const linked = readFileSync(zeknoJson)
    rmSync(zeknoJson)
    done = await report(f)
    expect(done.machine[3]).toMatchObject({ result: "good", detail: "not linked, compose.yaml is readable" })
    writeFileSync(join(m.project, "compose.yaml"), "  \n")
    done = await report(f)
    expect(done.machine[3]).toMatchObject({ result: "problem", detail: "compose.yaml cannot be read" })
    expect(done.machine[3]!.next).toMatch(/^The Compose file at \S+\/compose\.yaml is empty\.$/)
    m.compose(COMPOSE)
    const elsewhere = join(tempDir("elsewhere"), "zekno.json")
    writeFileSync(elsewhere, linked)
    symlinkSync(elsewhere, zeknoJson)
    done = await report(f)
    expect(done.machine[3]).toMatchObject({ result: "problem", detail: "zekno.json cannot be used" })
    expect(done.machine[3]!.next).toEndWith("is a symbolic link. zekno reads zekno.json only as a file of its own, never through a link.")
    rmSync(zeknoJson)
    writeFileSync(zeknoJson, linked)
    // With no zekno.json and no compose.yaml, there is no line at all.
    const bare = await fleet()
    expect((await report(bare)).machine.map((line) => line.check)).toEqual(["zekno", "key", "profile"])
  }, 60_000)

  test("Reachable: no answer within the limit (D27), and a login shell that prints something of its own (D28)", async () => {
    const { f, prod } = await baseline()
    f.route(prod.destination, script("exec sleep 30\n"))
    const started = Date.now()
    let done = await report(f, { limitMs: 200 })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(done.servers[0]!.checks).toEqual([
      { check: "reachable", label: "Reachable", result: "problem", detail: "did not answer within 20 seconds", next: "Check with: ssh deploy@203.0.113.7 true" },
      { check: "docker", label: "Docker", result: "not checked", detail: "" },
      { check: "runner", label: "Runner", result: "not checked", detail: "" },
      { check: "disk", label: "Disk", result: "not checked", detail: "" },
    ])
    f.route(prod.destination, script(`echo 'Welcome to prod!'\nexec "${prod.stand.path}" "$@"\n`))
    done = await report(f)
    expect(done.servers[0]!.checks[0]).toMatchObject({ result: "problem", detail: "answered, but not as zekno expects", next: "Check that the login shell on prod prints nothing of its own" })
  }, 60_000)

  test("Runner: one that does not report its version (D35), a newer one (D36), one that answers as another server (D41), one that does not answer (D43)", async () => {
    const { f, prod } = await baseline()
    const { m } = f
    const runner = realRunner(m.docker.path)
    writeFileSync(prod.server.runnerPath, olderRunner(m.docker.path))
    let done = await report(f)
    expect(done.servers[0]!.checks[2]).toMatchObject({ result: "warning", detail: `does not report its version, older than this zekno's ${OWN}`, next: "Run zekno server update prod" })
    writeFileSync(prod.server.runnerPath, reportingRunner(m.docker.path, "0.2.0", 2))
    done = await report(f)
    expect(done.servers[0]!.checks[2]).toMatchObject({ result: "warning", detail: `0.2.0, newer than this zekno's ${OWN}`, next: "Update zekno to match it" })
    writeFileSync(prod.server.runnerPath, "#!/bin/sh\nexit 1\n")
    done = await report(f)
    expect(done.servers[0]!.checks[2]).toMatchObject({ result: "problem", detail: "did not answer as expected", next: "Run zekno server update prod to replace it" })
    writeFileSync(prod.server.runnerPath, runner)

    const staging = await f.add("staging", "deploy@198.51.100.4")
    f.route(prod.destination, staging.stand.path)
    done = await report(f)
    expect(done.servers[0]!.checks[2]).toMatchObject({
      result: "problem",
      detail: "answered as a different server than the one connected as prod",
      next: "Check that deploy@203.0.113.7 is the server you added as prod",
    })
  }, 90_000)

  test("a runner that answers as one from before sessions, then never answers status (security review S2): the limit holds, and no process is left", async () => {
    // On this machine.
    const f = await fleet()
    expect(await f.m.zekno("server", "add", "dev", "--local")).toBe(0)
    f.m.deps.fetch = github(`runner-v${OWN}`).fetch
    const pids = join(tempDir("pids"), "pids")
    const stalling = join(tempDir("stalling"), "zekno-runner")
    writeFileSync(stalling, stallingRunner(pids))
    chmodSync(stalling, 0o755)
    f.m.deps.localRunner = [stalling]
    let started = Date.now()
    let done = await report(f, { limitMs: 1000 })
    expect(Date.now() - started).toBeLessThan(4000)
    expect(existsSync(pids)).toBe(true)
    expect(done.servers[0]!.checks[2]).toMatchObject({ check: "runner", result: "problem", detail: "did not answer within 20 seconds" })
    expect(await stillRunning(pids)).toEqual([])

    // Over SSH: the check script answers, then the runner at the path stalls.
    const prod = await f.add("prod", "deploy@203.0.113.7")
    prod.server.df(ROOMY)
    const remote = join(tempDir("pids"), "pids")
    writeFileSync(prod.server.runnerPath, stallingRunner(remote))
    started = Date.now()
    done = await report(f, { limitMs: 3000 })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(existsSync(remote)).toBe(true)
    expect(done.servers[1]!.checks.slice(0, 3)).toMatchObject([
      { check: "reachable", result: "good" },
      { check: "docker", result: "good" },
      { check: "runner", result: "problem", detail: "did not answer within 20 seconds" },
    ])
    expect(await stillRunning(remote)).toEqual([])
  }, 45_000)

  test("Disk: free space that cannot be read (D45), and little room left (D46); a user with no home folder (D49)", async () => {
    const { f, prod } = await baseline()
    prod.server.remove("df")
    let done = await report(f)
    expect(done.servers[0]!.checks[3]).toMatchObject({ result: "warning", detail: "free space could not be read", next: "Check with: ssh deploy@203.0.113.7 df -Pk" })
    prod.server.df(500_000)
    done = await report(f)
    expect(done.servers[0]!.checks[3]).toMatchObject({ result: "warning", detail: "512 MB free", next: "Free some space on prod before the next deploy" })
    const env = prod.server.env()
    f.route(prod.destination, script(`dest=
next=
for word in "$@"; do if [ -n "$next" ]; then command=$word; fi; [ -n "$dest" ] && next=1; [ "$word" = -- ] && dest=1; done
cd "${prod.server.home}" || exit 255
exec env -i HOME= PATH="${env.PATH}" TMPDIR="${env.TMPDIR}" LC_ALL=C /bin/sh -c "$command"
`))
    done = await report(f)
    expect(done.servers[0]!.checks).toEqual([
      { check: "reachable", label: "Reachable", result: "good", detail: "over SSH" },
      { check: "docker", label: "Docker", result: "good", detail: "Compose 2.40.3" },
      { check: "runner", label: "Runner", result: "problem", detail: "the user zekno logs in as has no home folder", next: "Log in as a user with a home folder" },
      { check: "disk", label: "Disk", result: "problem", detail: "the user zekno logs in as has no home folder", next: "Log in as a user with a home folder" },
    ])
  }, 60_000)

  test("the runner is asked its version and its status, and nothing else", async () => {
    const { f, prod } = await baseline()
    const real = join(dirname(prod.server.runnerPath), "real-runner")
    writeFileSync(real, realRunner(f.m.docker.path))
    chmodSync(real, 0o755)
    const input = join(tempDir("input"), "lines")
    // A runner that writes down each line it is sent, before the real runner reads it.
    writeFileSync(
      prod.server.runnerPath,
      `#!/bin/sh
if [ "$1" = session ]; then
  while IFS= read -r line; do printf '%s\\n' "$line" >> "${input}"; printf '%s\\n' "$line"; done | "${real}" session
  exit $?
fi
exec "${real}" "$@"
`
    )
    expect(await doctor(f)).toEqual({ code: 0, out: BASELINE, err: [] })
    expect(readFileSync(input, "utf8").trim().split("\n")).toEqual(['{"command":"version"}', '{"command":"status"}'])
  }, 60_000)

  test("a server on this machine: on this machine, its runner's version never compared, Docker and Disk not checked", async () => {
    const f = await fleet()
    expect(await f.m.zekno("server", "add", "dev", "--local")).toBe(0)
    f.m.deps.fetch = github(`runner-v${OWN}`).fetch
    expect(await doctor(f)).toEqual({
      code: 0,
      out: [
        `this machine\tzekno\tgood\t${CLI_VERSION}, installs runner ${OWN}`,
        "this machine\tkey\tgood\tin your system keychain",
        "this machine\tprofile\tgood\tverified, team list v2",
        "dev\treachable\tgood\ton this machine",
        "dev\tdocker\tnot checked",
        `dev\trunner\tgood\t${OWN}, on this machine`,
        "dev\tdisk\tnot checked",
        "No problems, no warnings.",
      ],
      err: [],
    })
  }, 60_000)

  test("at most four servers are checked at the same time, and the report keeps profile.json's order", async () => {
    const f = await fleet()
    const times = join(tempDir("times"), "times")
    const names: string[] = []
    for (let index = 0; index < 6; index++) {
      const name = `s${index}`
      const remote = await f.add(name, `deploy@192.0.2.${index + 1}`, { runnerPath: true })
      names.push(name)
      // Each connection notes when it starts and ends, and takes a moment, so that what runs at the same time overlaps.
      f.route(remote.destination, script(`printf 'start\\n' >> "${times}"\nsleep 0.3\n"${remote.stand.path}" "$@"\ncode=$?\nprintf 'end\\n' >> "${times}"\nexit $code\n`))
    }
    const done = await report(f)
    expect(done.servers.map((server) => server.name)).toEqual(names)
    let now = 0
    let most = 0
    for (const event of readFileSync(times, "utf8").trim().split("\n")) {
      now += event === "start" ? 1 : -1
      most = Math.max(most, now)
    }
    expect(most).toBeLessThanOrEqual(4)
    expect(most).toBeGreaterThanOrEqual(2)
  }, 120_000)
})

/**
 * Mock-up 5's setup: prod over SSH with a runner that reports 0.1.0-dev.1,
 * Compose 5.6.0 and 133 GB free; staging over SSH where SSH would ask; the
 * folder linked to demo on prod; GitHub says this is the newest release.
 * Adding two servers makes the team list version 3 (the mock-up shows v2).
 */
let mockUp: Promise<Fleet> | undefined
function mockUp5(): Promise<Fleet> {
  mockUp ??= (async () => {
    const f = await fleet()
    const prod = await f.add("prod", "deploy@203.0.113.7")
    const staging = await f.add("staging", "deploy@198.51.100.4")
    prod.server.df(ROOMY)
    prod.server.composeVersion("5.6.0")
    writeFileSync(prod.server.runnerPath, reportingRunner(f.m.docker.path, "0.1.0-dev.1", 2))
    staging.stand.ask()
    f.m.compose(COMPOSE)
    expect(await f.m.zekno("link", "--app", "demo", "--server", "prod")).toBe(0)
    f.m.deps.fetch = github(`runner-v${OWN}`).fetch
    return f
  })()
  return mockUp
}

/** contracts/doctor.md's `--json` object for mock-up 5, with the team list at version 3. */
const MOCK_UP_5_JSON = {
  zekno: "0.1.0",
  runner: "0.1.0",
  machine: [
    { check: "zekno", result: "good", detail: "0.1.0, installs runner 0.1.0" },
    { check: "key", result: "good", detail: "in your system keychain" },
    { check: "profile", result: "good", detail: "verified, team list v3" },
    { check: "folder", result: "good", detail: "linked to demo on prod, compose.yaml is readable" },
  ],
  servers: [
    {
      name: "prod",
      where: "deploy@203.0.113.7",
      checks: [
        { check: "reachable", result: "good", detail: "over SSH" },
        { check: "docker", result: "good", detail: "Compose 5.6.0" },
        { check: "runner", result: "warning", detail: "0.1.0-dev.1, older than this zekno's 0.1.0", next: "Run zekno server update prod" },
        { check: "disk", result: "good", detail: "133 GB free" },
      ],
    },
    {
      name: "staging",
      where: "deploy@198.51.100.4",
      checks: [
        { check: "reachable", result: "problem", detail: "SSH needs an answer", next: "Open zekno and press enter on staging" },
        { check: "docker", result: "not_checked" },
        { check: "runner", result: "not_checked" },
        { check: "disk", result: "not_checked" },
      ],
    },
  ],
  serversSkipped: false,
  latest: { state: "newest" },
  problems: 1,
  warnings: 1,
}

describe("mock-up 5: --json, plain lines, the drawn report, --server", () => {
  test("--json: contracts/doctor.md's object, on one line, and nothing else; status 1", async () => {
    const f = await mockUp5()
    expect(OWN).toBe("0.1.0")
    expect(await doctor(f, "--json")).toEqual({ code: 1, out: [JSON.stringify(MOCK_UP_5_JSON)], err: [] })
  }, 90_000)

  test("plain: one line per check, its cells separated by tabs, then the last line", async () => {
    const f = await mockUp5()
    expect(await doctor(f)).toEqual({
      code: 1,
      out: [
        "this machine\tzekno\tgood\t0.1.0, installs runner 0.1.0",
        "this machine\tkey\tgood\tin your system keychain",
        "this machine\tprofile\tgood\tverified, team list v3",
        "this machine\tfolder\tgood\tlinked to demo on prod, compose.yaml is readable",
        "prod\treachable\tgood\tover SSH",
        "prod\tdocker\tgood\tCompose 5.6.0",
        "prod\trunner\twarning\t0.1.0-dev.1, older than this zekno's 0.1.0\tRun zekno server update prod",
        "prod\tdisk\tgood\t133 GB free",
        "staging\treachable\tproblem\tSSH needs an answer\tOpen zekno and press enter on staging",
        "staging\tdocker\tnot checked",
        "staging\trunner\tnot checked",
        "staging\tdisk\tnot checked",
        "1 problem, 1 warning.",
      ],
      err: [],
    })
  }, 90_000)

  test("through the stand-in terminal: mock-up 5, line for line", async () => {
    const f = await mockUp5()
    const plain = f.m.deps.ui
    const t = terminal()
    f.m.deps.ui = t.ui
    let code: number
    try {
      code = await unchanged(f, () => f.m.zekno("doctor"))
    } finally {
      f.m.deps.ui = plain
    }
    expect(code).toBe(1)
    await t.ui.close()
    const screen = t.screen()
    while (screen.at(-1) === "") screen.pop()
    expect(screen).toEqual([
      "  This machine",
      "✔ zekno          0.1.0, installs runner 0.1.0",
      "✔ Key            in your system keychain",
      "✔ Profile        verified, team list v3",
      "✔ This folder    linked to demo on prod, compose.yaml is readable",
      "",
      "  prod  deploy@203.0.113.7",
      "✔ Reachable      over SSH",
      "✔ Docker         Compose 5.6.0",
      "! Runner         0.1.0-dev.1, older than this zekno's 0.1.0",
      "                 Run zekno server update prod",
      "✔ Disk           133 GB free",
      "",
      "  staging  deploy@198.51.100.4",
      "✖ Reachable      SSH needs an answer",
      "                 Open zekno and press enter on staging",
      "–  Docker        not checked",
      "–  Runner        not checked",
      "–  Disk          not checked",
      "",
      "  1 problem, 1 warning.",
    ])
  }, 90_000)

  test("--server staging checks that one server only; --server nope says so and nothing else; doctor never asks", async () => {
    const f = await mockUp5()
    const one = await doctor(f, "--server", "staging")
    expect(one.code).toBe(1)
    expect(one.out.filter((line) => line.startsWith("prod"))).toEqual([])
    expect(one.out.filter((line) => line.startsWith("staging")).length).toBe(4)
    for (const args of [["--server", "nope"], ["--server", "nope", "--json"]]) {
      expect(await doctor(f, ...args)).toEqual({ code: 1, out: [], err: ['No server named "nope". Connected servers: prod, staging.'] })
    }
    const asking = answering(f.m, [])
    const plain = f.m.deps.ui
    try {
      expect(await unchanged(f, () => f.m.zekno("doctor", "--server", "prod"))).toBe(0)
    } finally {
      f.m.deps.ui = plain
    }
    expect(asking.asked).toEqual([])
    expect(asking.lines).toEqual([["doctorReport", "0 problems", "1 warnings"]])
  }, 90_000)

  test("a profile that does not verify: no connection at all, D31 in place of the servers; --server cannot be looked up", async () => {
    const f = await mockUp5()
    const profileJson = join(f.m.home, "profile.json")
    const text = readFileSync(profileJson, "utf8")
    writeFileSync(profileJson, JSON.stringify({ ...JSON.parse(text), rosters: JSON.parse(text).rosters.slice(0, 2) }))
    const calls = f.calls().length
    try {
      for (const args of [[], ["--server", "nope"]]) {
        const done = await doctor(f, ...args)
        expect(done.code).toBe(1)
        expect(done.out.slice(-2)).toEqual([SERVERS_SKIPPED, "1 problem, no warnings."])
      }
    } finally {
      writeFileSync(profileJson, text)
    }
    expect(f.calls().length).toBe(calls)
  }, 90_000)

  test("exit statuses: 0 with warnings only, 1 with a problem, 2 for wrong usage", async () => {
    const f = await mockUp5()
    expect((await doctor(f, "--server", "prod")).code).toBe(0)
    expect((await doctor(f)).code).toBe(1)
    const wrong = await doctor(f, "extra")
    expect(wrong).toEqual({ code: 2, out: [], err: ['Unexpected "extra" after `zekno doctor`.\nRun `zekno --help` for the list of commands.'] })
  }, 90_000)
})

describe("the newer release on doctor's first line (contracts/version.md, In zekno doctor; mock-up 6)", () => {
  test("a newer release: a warning with D50 under the zekno line, counted, and not failing the command", async () => {
    const { f } = await baseline()
    const asked = github("runner-v0.2.0")
    f.m.deps.fetch = asked.fetch
    const done = await doctor(f)
    expect(done.code).toBe(0)
    expect(done.out[0]).toBe(`this machine\tzekno\twarning\t${CLI_VERSION}, installs runner ${OWN}\tA newer release exists: 0.2.0. Update zekno to get it.`)
    expect(done.out.at(-1)).toBe("No problems, 1 warning.")
    expect(asked.calls()).toBe(1)

    const plain = f.m.deps.ui
    const t = terminal()
    f.m.deps.ui = t.ui
    try {
      expect(await unchanged(f, () => f.m.zekno("doctor"))).toBe(0)
    } finally {
      f.m.deps.ui = plain
    }
    await t.ui.close()
    expect(t.screen().slice(1, 3)).toEqual([`! zekno          ${CLI_VERSION}, installs runner ${OWN}`, "                 A newer release exists: 0.2.0. Update zekno to get it."])
    expect(asked.calls()).toBe(2)
  }, 60_000)

  test("the newest, or no answer: the line stays good with no next step, and no count changes; with no fetch, not checked", async () => {
    const { f } = await baseline()
    for (const tag of [`runner-v${OWN}`, "fails"]) {
      const asked = github(tag)
      f.m.deps.fetch = asked.fetch
      expect(await doctor(f)).toEqual({ code: 0, out: BASELINE, err: [] })
      expect(asked.calls()).toBe(1)
    }
    f.m.deps.fetch = undefined
    const done = await report(f)
    expect(done.latest).toEqual({ state: "not_checked" })
    expect(done.machine[0]!.result).toBe("good")
  }, 60_000)

  test("--json carries latest in each of its three states", async () => {
    const { f } = await baseline()
    const states: unknown[] = []
    for (const fetch of [github(`runner-v${OWN}`).fetch, github("runner-v0.2.0").fetch, github("fails").fetch]) {
      f.m.deps.fetch = fetch
      const done = await doctor(f, "--json")
      states.push(JSON.parse(done.out[0]!).latest)
    }
    expect(states).toEqual([{ state: "newest" }, { state: "newer", version: "0.2.0" }, { state: "not_checked" }])
  }, 60_000)

  test("the check is asked once, beside the server checks: a slow answer does not wait for them, nor they for it", async () => {
    const { f } = await baseline()
    const asked = github(`runner-v${OWN}`, 300)
    f.m.deps.fetch = asked.fetch
    let connectedWhileAsking: boolean | undefined
    const connect = f.m.deps.connect
    f.m.deps.connect = (target, localRunner, options) => {
      connectedWhileAsking ??= asked.calls() === 1 && !asked.settled()
      return connect(target, localRunner, options)
    }
    const done: DoctorReport = await report(f)
    f.m.deps.connect = connect
    expect(asked.calls()).toBe(1)
    // The server was already being reached while GitHub's answer was still on its way.
    expect(connectedWhileAsking).toBe(true)
    expect(done.latest).toEqual({ state: "newest" })
  }, 60_000)
})
