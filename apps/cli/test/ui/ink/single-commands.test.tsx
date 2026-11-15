/**
 * User Story 5: single commands that match the app at a terminal, and stay
 * plain and stable in scripts (contracts/commands.md, boards "zekno deploy:
 * success and failure" and "Status, lists, errors and piped output").
 */
import { describe, expect, spyOn, test } from "bun:test"
import { compareRunnerVersions, isDevVersion } from "@workspace/core"
import { renderToString } from "ink"
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import { runner, RUNNER_MAIN, tempDir } from "../../../../runner/test/support/helpers"
import { HELP } from "../../../src/cli/cli"
import { sshUnreachable } from "../../../src/server/session"
import { secretsWords, type DeployProgress, type DeployStart } from "../../../src/shared/deploy"
import { DeployBlock, type DeployShown } from "../../../src/ui/ink/deploy-view"
import { inkUi } from "../../../src/ui/ink/ink"
import { plainUi, processPlainUi, wantsPlain } from "../../../src/ui/plain/plain"
import { ORDERED_VERSIONS } from "../../../../../packages/core/test/fixtures/versions"
import runnerPackage from "../../../../runner/package.json"
import { COMPOSE_V1, COMPOSE_V2, machine, ready, screenOf } from "../../support/helpers"
import { realRunner, sshStandIn, standInServer, withSsh } from "../../support/stand-in-server"

type Machine = ReturnType<typeof machine>

const where = ["--app", "web", "--server", "dev"]

/** Escape sequences, as Ink writes them for colour and for redrawing. */
const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")

/** Every line, with the space at its end taken off. */
const linesOf = (text: string) => text.split("\n").map((line) => line.trimEnd())

/** Nothing is drawn past the window. */
function fits(text: string, columns: number) {
  for (const line of text.split("\n")) expect([...line].length).toBeLessThanOrEqual(columns)
}

/**
 * Runs `zekno <args>` with the interface a terminal gets (Ink), drawing into
 * a stream `columns` wide, and gives back the exit status and what was drawn.
 */
async function atTerminal(m: Machine, columns: number, ...args: string[]): Promise<{ code: number; text: string }> {
  let text = ""
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        text += String(chunk)
        done()
      },
    }),
    { columns, rows: 40 }
  )
  const ui = inkUi({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
  const before = m.deps.ui
  m.deps.ui = { ...ui, askSecret: before.askSecret }
  try {
    const code = await m.zekno(...args)
    await ui.close()
    return { code, text: strip(text) }
  } finally {
    m.deps.ui = before
  }
}

/** Plain output, as when piped: every line written, and where, in the order written. */
function piped(m: Machine) {
  const written: { to: "out" | "err" | "remote"; line: string }[] = []
  m.deps.ui = {
    ...plainUi(
      (line) => void written.push({ to: "out", line }),
      (line) => void written.push({ to: "err", line }),
      (text) => void written.push({ to: "remote", line: text.replace(/\n$/, "") })
    ),
    askSecret: m.deps.ui.askSecret,
  }
  return {
    written,
    out: () => written.filter((entry) => entry.to === "out").map((entry) => entry.line),
    err: () => written.filter((entry) => entry.to !== "out").map((entry) => entry.line),
    clear: () => void written.splice(0),
  }
}

const START: DeployStart = { app: "demo", server: "prod", file: "compose.yaml", flags: "" }

/** A deploy as the terminal shows it, at the board's numbers. */
function shown(deploy: Partial<DeployProgress>, extra: Partial<DeployShown> = {}): DeployShown {
  return {
    start: START,
    dropped: 0,
    ...extra,
    deploy: { server: "prod", app: "demo", sequence: 5, secrets: 2, lines: [], running: true, since: 0, ...deploy },
  }
}

const drawn = (value: DeployShown, columns = 100) => renderToString(<DeployBlock shown={value} columns={columns} />, { columns })

describe("zekno deploy at a terminal (board 'zekno deploy: success and failure')", () => {
  test("a deploy that started: the summary panel, the stage row, the result line and what to run next", () => {
    const lines = linesOf(drawn(shown({ stage: "started", running: false, outcome: "started" }, { ms: 6100 })))
    expect(lines[0]).toBe("")
    expect(lines[1]).toMatch(/^╭─ Deploy 5 ─+╮$/)
    expect(lines.slice(2, 5)).toEqual([expect.stringMatching(/^│ app +demo +│$/), expect.stringMatching(/^│ server +prod +│$/), expect.stringMatching(/^│ secrets +2 +│$/)])
    expect(lines[5]).toMatch(/^╰─+╯$/)
    expect(lines.slice(6)).toEqual([
      "",
      "✔ Checked  ✔ Signed  ✔ Sent  ✔ Started",
      "",
      "✔ demo is live on prod in 6.1s",
      "  zekno logs to watch it, zekno rollback to undo",
      "",
    ])
  })

  test("an app that did not start: ✖ Starting, that the number is used, what Docker said, and what to do", () => {
    const failed = shown(
      { sequence: 6, stage: "failed", running: false, outcome: "start_failed", lines: ["pull access denied for example/web, repository does not exist or may require 'docker login'"] },
      { ms: 3000 }
    )
    const text = drawn(failed)
    const lines = linesOf(text)
    expect(lines[1]).toMatch(/^╭─ Deploy 6 ─+╮$/)
    expect(lines).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting")
    const result = lines.indexOf("✖ prod accepted deploy 6, but the app did not start.")
    expect(result).toBeGreaterThan(0)
    expect(lines[result + 1]).toBe("  Number 6 is used, so the next deploy will be 7.")
    expect(lines[result + 3]).toMatch(/^╭─ Docker said ─+╮$/)
    expect(text.replace(/[│\s]+/g, " ")).toContain("pull access denied for example/web, repository does not exist or may require 'docker login'")
    expect(lines.at(-2)).toBe("Fix compose.yaml and run zekno deploy again, or go back with zekno rollback.")
    // The panel is no wider than the summary panel above it.
    expect([...lines[result + 3]!].length).toBe([...lines[1]!].length)
  })

  test("a rollback that did not start points at a fixed Compose file and further back, with the flags typed", () => {
    const rolled = { ...shown({ sequence: 4, stage: "failed", running: false, outcome: "start_failed" }), start: { app: "demo", server: "prod", flags: " --app demo --server prod" } }
    const words = (text: string) => text.replace(/\s+/g, " ")
    expect(words(drawn(rolled, 200))).toContain(
      "Deploy a fixed Compose file with zekno deploy --app demo --server prod, or go back further with zekno rollback --app demo --server prod --to <number>."
    )
    const started = { ...shown({ stage: "started", running: false, outcome: "started" }), start: rolled.start }
    expect(linesOf(drawn(started, 200))).toContain("  zekno logs --app demo --server prod to watch it, zekno rollback --app demo --server prod to undo")
  })

  test("while it runs: the stage in progress has the spinner, and the latest of Docker's lines is the one live line", () => {
    const lines = linesOf(drawn(shown({ stage: "starting", lines: [" Container zekno-demo-web-1  Recreate"] })))
    expect(lines).toContainEqual(expect.stringMatching(/^✔ Checked {2}✔ Signed {2}✔ Sent {2}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Starting$/))
    expect(lines.at(-1)).toBe("  Container zekno-demo-web-1  Recreate")
    // Docker's line is set in by two columns, however it began: a server's words never start at
    // the left edge, where zekno's own result line starts.
    for (const said of ["✔ demo is live on prod in 3.1s", "    ✔ demo is live on prod", "\t✖ prod accepted deploy 6, but the app did not start."]) {
      const last = linesOf(drawn(shown({ stage: "starting", lines: [said] }))).at(-1)!
      expect(last).toBe(`  ${said.trim()}`)
    }
    // Before the first of Docker's lines, the line is there and empty, so nothing moves when it comes.
    expect(linesOf(drawn(shown({ stage: "sent" }))).length).toBe(lines.length)
  })

  test("a deploy refused or cut off keeps its stage row with ✖ where it stopped, and says nothing more itself", () => {
    const lines = linesOf(drawn(shown({ stage: "sent", running: false, outcome: "error" })))
    expect(lines).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting")
    expect(lines.join("\n")).not.toContain("is live")
    expect(lines.join("\n")).not.toContain("Docker said")
  })

  test("narrower than a panel, under 60 columns, every line stays inside the window: panels shrink and words wrap", () => {
    const long = "x".repeat(150)
    for (const columns of [20, 40, 59, 60, 64, 80]) {
      fits(drawn(shown({ stage: "started", running: false, outcome: "started" }, { ms: 1 }), columns), columns)
      fits(drawn(shown({ sequence: 6, stage: "failed", running: false, outcome: "start_failed", lines: [long, "a b ".repeat(40)] }), columns), columns)
      fits(drawn(shown({ stage: "starting", lines: [long] }), columns), columns)
    }
  })

  test("more of Docker's lines than are kept: the panel says how many came before those shown", () => {
    const text = drawn(shown({ sequence: 6, stage: "failed", running: false, outcome: "start_failed", lines: ["last"] }, { dropped: 12 }))
    expect(text).toContain("Left out Docker's first 12 lines. The last 500 are kept.")
  })

  test("end to end against a runner: the board's lines, a failed start, and the stage row left in place before an error", async () => {
    const m = await ready()
    m.typing("demo-value")
    expect(await m.zekno("secret", "set", "GREETING", ...where)).toBe(0)
    const started = await atTerminal(m, 100, "deploy", ...where)
    expect(started.code).toBe(0)
    const lines = linesOf(started.text)
    expect(lines).toContainEqual(expect.stringMatching(/^╭─ Deploy 1 ─+╮$/))
    expect(lines).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✔ Started")
    expect(lines).toContainEqual(expect.stringMatching(/^✔ web is live on dev in \d+\.\ds$/))
    // The app and server were typed as flags, so what to run next carries them.
    expect(lines).toContain("  zekno logs --app web --server dev to watch it, zekno rollback --app web --server dev to undo")
    expect(started.text).not.toContain("remote:")

    m.docker.failWith(1)
    m.docker.upPrints({ stderr: "pull access denied for example/web\n" })
    const failed = await atTerminal(m, 100, "deploy", ...where)
    expect(failed.code).toBe(1)
    const after = linesOf(failed.text)
    expect(after).toContain("✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting")
    expect(after).toContain("✖ dev accepted deploy 2, but the app did not start.")
    expect(after).toContain("  Number 2 is used, so the next deploy will be 3.")
    expect(after).toContainEqual(expect.stringMatching(/^│ pull access denied for example\/web +│$/))
    expect(after).toContain("Fix compose.yaml and run zekno deploy again, or go back with zekno rollback --app web --server dev.")

    // A runner that answers who it is, then is gone as soon as the deploy is sent: the connection drops.
    m.docker.failWith(0)
    const status = (await runner(m.runnerHome, m.docker.path, "status")).json
    const frame = (value: unknown) => `printf '%s\\n' '${JSON.stringify({ result: value })}'`
    m.deps.localRunner = ["sh", "-c", `read -r l; ${frame({ version: "0.1.0", protocol: 2 })}; read -r l; ${frame(status)}; read -r l; exit 1`]
    const dropped = await atTerminal(m, 100, "deploy", ...where)
    expect(dropped.code).toBe(1)
    const end = linesOf(dropped.text)
    const row = end.indexOf("✔ Checked  ✔ Signed  ✔ Sent  ✖ Starting")
    const error = end.indexOf("✖ The connection to the runner ended before it answered.")
    expect(row).toBeGreaterThan(0)
    expect(error).toBeGreaterThan(row)
  })
})

describe("status, lists and errors at a terminal (board 'Status, lists, errors and piped output')", () => {
  test("status: the server, reachable, its team list, then each app with its deploy and state", async () => {
    const m = await ready()
    expect(await m.zekno("deploy", ...where)).toBe(0)
    expect(await m.zekno("deploy", "--app", "worker", "--server", "dev")).toBe(0)
    m.docker.ps("web", '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n')
    m.docker.ps("worker", '{"Service":"worker","State":"exited","ExitCode":1,"Health":""}\n')
    const { code, text } = await atTerminal(m, 100, "status", "--server", "dev")
    expect(code).toBe(0)
    const lines = linesOf(text)
    expect(lines[0]).toBe("dev ● reachable team list v2")
    expect(lines).toContainEqual(expect.stringMatching(/^web +deploy 1 +● running$/))
    expect(lines).toContainEqual(expect.stringMatching(/^worker +deploy 1 +● stopped$/))
  })

  test("status lists the apps as Home does, the latest deploy first, at a terminal and piped; one this machine never deployed comes last", async () => {
    const m = await ready()
    for (const app of ["web", "worker", "api", "zoo"]) expect(await m.zekno("deploy", "--app", app, "--server", "dev")).toBe(0)
    // api again, so it is the latest; zoo as deployed from another machine: this one has no history of it.
    expect(await m.zekno("deploy", "--app", "api", "--server", "dev")).toBe(0)
    const serverId = JSON.parse(readFileSync(join(m.home, "profile.json"), "utf8")).servers[0].serverId
    rmSync(join(m.home, "history", serverId, "zoo.json"))
    const { text } = await atTerminal(m, 100, "status", "--server", "dev")
    const rows = linesOf(text).filter((line) => / deploy \d/.test(line))
    expect(rows.map((line) => line.split(" ")[0])).toEqual(["api", "worker", "web", "zoo"])
    const plain = piped(m)
    expect(await m.zekno("status", "--server", "dev")).toBe(0)
    expect(plain.out().filter((line) => line.includes("\tdeploy ")).map((line) => line.split("\t")[0])).toEqual(["api", "worker", "web", "zoo"])
  })

  test("a step SSH may write into is drawn once and still, and is gone when it ends: no 'Asking' line stays above the answer", async () => {
    let raw = ""
    const stdout = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          raw += String(chunk)
          done()
        },
      }),
      { columns: 100, rows: 40, isTTY: true }
    )
    // Drawn as at a terminal: redrawn in place, and erased where Ink erases.
    const ui = inkUi({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream, interactive: true })
    let during: string[] = []
    let still = false
    // As `zekno status` does over SSH, and then main.ts closes the interface once the command has returned.
    const command = async () => {
      await ui.step(
        "Asking prod",
        async () => {
          await Bun.sleep(150)
          during = screenOf(raw)
          const written = raw.length
          // Nothing is animated: SSH may be asking for a password on this terminal.
          await Bun.sleep(300)
          still = raw.length === written
        },
        { quiet: true }
      )
      ui.line("prod: team list version 2", ["prod"])
      ui.table([["demo", "deploy 4"]])
    }
    await command()
    await ui.close()
    expect(during.filter(Boolean)).toEqual(["  Asking prod…"])
    expect(still).toBe(true)
    expect(screenOf(raw).filter(Boolean)).toEqual(["prod", "demo  deploy 4"])
  })

  test("secret ls: names and versions, which are not deployed yet, and that values are never shown", async () => {
    const m = await ready()
    m.typing("one")
    expect(await m.zekno("secret", "set", "DATABASE_URL", ...where)).toBe(0)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    m.typing("two")
    expect(await m.zekno("secret", "set", "SESSION_KEY", ...where)).toBe(0)
    const { code, text } = await atTerminal(m, 100, "secret", "ls", ...where)
    expect(code).toBe(0)
    expect(linesOf(text).filter(Boolean)).toEqual([
      expect.stringMatching(/^DATABASE_URL +version 1$/),
      expect.stringMatching(/^SESSION_KEY +version 1, not deployed yet$/),
      "web on dev. Values are never shown.",
    ])
    expect(text).not.toContain("one")
    expect(text).not.toContain("two")
  })

  test("server ls: name, where it is and its id, from the left edge", async () => {
    const m = await ready()
    const { text } = await atTerminal(m, 100, "server", "ls")
    expect(linesOf(text).filter(Boolean)).toEqual([expect.stringMatching(/^dev {2}this machine {2}srv_[0-9a-f]{32}$/)])
  })

  test("an error: ✖ and its first sentence, the rest below it, commands without backticks", async () => {
    const m = await ready()
    const value = await atTerminal(m, 100, "secret", "set", "API_KEY", "sk_live_51H")
    expect(value.code).toBe(2)
    expect(linesOf(value.text).filter(Boolean)).toEqual([
      "✖ A secret value is never given as an argument.",
      "  It would stay in your shell history. Run zekno secret set API_KEY and type it when asked.",
      "  Run zekno --help for the list of commands.",
    ])
    // What is not a secret's name is not repeated as a command to type.
    const odd = await atTerminal(m, 100, "secret", "set", "a\x1b[2Jb", "value")
    expect(odd.text).toContain("Run zekno secret set <NAME> and type it when asked.")
    expect(odd.text).not.toContain("a\x1b")
  })

  test("a server SSH cannot reach: named, and the command to check it with", async () => {
    const m = await ready()
    m.tamper("profile.json", (profile) => ({
      ...profile,
      servers: profile.servers.map((server: object) => ({ ...server, target: { kind: "ssh", destination: "deploy@203.0.113.7", runnerPath: "zekno-runner" } })),
    }))
    // A stand-in for ssh that fails as SSH does when it cannot connect: its own status, 255.
    const dir = tempDir("ssh")
    const fakeSsh = join(dir, "ssh")
    writeFileSync(fakeSsh, "#!/bin/sh\necho 'ssh: connect to host 203.0.113.7 port 22: Connection refused' >&2\nexit 255\n")
    chmodSync(fakeSsh, 0o755)
    const spawn = Bun.spawn
    const spy = spyOn(Bun, "spawn").mockImplementation(((argv: string[], options: never) =>
      spawn(argv[0] === "ssh" ? [fakeSsh, ...argv.slice(1)] : argv, options)) as never)
    try {
      const terminal = await atTerminal(m, 100, "deploy", ...where)
      expect(terminal.code).toBe(1)
      const lines = linesOf(terminal.text).filter(Boolean)
      expect(lines.slice(-2)).toEqual(["✖ dev could not be reached over SSH.", "  Check with: ssh deploy@203.0.113.7 true"])
      // What SSH said is the server's line, marked; no panel was drawn for a deploy that never reached the runner.
      expect(lines).toContain("remote: ssh: connect to host 203.0.113.7 port 22: Connection refused")
      expect(terminal.text).not.toContain("Deploy 1")
      const plain = piped(m)
      expect(await m.zekno("status", "--server", "dev")).toBe(1)
      expect(plain.err().at(-1)).toBe(sshUnreachable("dev", "deploy@203.0.113.7"))
      expect(plain.err().at(-1)).toBe("dev could not be reached over SSH. Check with: `ssh deploy@203.0.113.7 true`")
    } finally {
      spy.mockRestore()
    }
  })
})

describe("piped, in scripts and CI: plain and stable (contracts/commands.md)", () => {
  /** Printable ASCII and tabs only: no escape byte, no symbol, no box line. */
  const PLAIN = /^[\x20-\x7e\t]*$/

  test("every command writes plain lines only: no escape byte, no symbol, no panel, no cursor movement", async () => {
    const m = machine()
    const plain = piped(m)
    const project = join(m.project, "zekno.json")
    const runs: [number, string[]][] = [
      [0, ["init", "--name", "Ada"]],
      [0, ["server", "add", "dev", "--local"]],
      [0, ["server", "ls"]],
      [0, ["secret", "set", "GREETING", ...where]],
      [0, ["secret", "ls", ...where]],
      [0, ["deploy", ...where]],
      [0, ["deploy", ...where, "--json"]],
      [0, ["status", "--server", "dev"]],
      [0, ["status", "--server", "dev", "--json"]],
      [0, ["logs", ...where, "--no-follow"]],
      [0, ["rollback", ...where]],
      [0, ["secret", "rm", "GREETING", ...where]],
      [0, ["link", ...where]],
      [0, ["deploy"]],
      [1, ["deploy", "--app", "web", "--server", "nowhere"]],
      [2, ["secret", "set", "API_KEY", "sk_live_51H"]],
      [2, ["deploy", "--bogus"]],
    ]
    m.compose(COMPOSE_V1)
    m.typing("demo-value")
    m.docker.ps("web", '{"Service":"web","State":"running","ExitCode":0,"Health":""}\n')
    m.docker.logs("web", "web-1  | 2026-11-14T21:52:03.000000001Z started\n")
    for (const [status, args] of runs) {
      if (args[0] === "deploy" && args.length === 1) m.compose(COMPOSE_V2)
      expect([args.join(" "), await m.zekno(...args)]).toEqual([args.join(" "), status])
    }
    // A failed start: the failure sentence, then Docker's lines, on standard error.
    m.docker.failWith(1)
    m.docker.upPrints({ stdout: "Pulling web\n", stderr: "pull access denied for example/web\n" })
    expect(await m.zekno("deploy", ...where)).toBe(1)
    expect(existsSync(project)).toBe(true)

    expect(plain.written.length).toBeGreaterThan(20)
    // An error of two lines is written at once, with a line break between them.
    for (const line of plain.written.flatMap((entry) => entry.line.split("\n"))) {
      expect(line).toMatch(PLAIN)
      expect(line).not.toContain("\x1b")
    }
    expect(plain.out()).toContain("Deploy 1 of web is running on dev with 1 secret.")
    expect(plain.out()).toContain('{"outcome":"started","app":"web","sequence":2,"server":"dev"}')
    expect(plain.out()).toContain("web\tdeploy 2\trunning")
    expect(plain.out()).toContain("2026-11-14T21:52:03.000000001Z\tweb\tstarted")
    expect(plain.out()).toContain("Deploy 4 of web is running on dev with no secrets.")
    const failed = plain.err().slice(-3)
    expect(failed[0]).toBe("Deploy 5 of web was accepted by dev, but the app did not start. Check Docker on the server.")
    // Docker's standard output and error come in either order.
    expect(failed.slice(1).sort()).toEqual(["remote: Pulling web", "remote: pull access denied for example/web"])
  })

  test("the count of secrets in a deploy's line: no secrets, 1 secret, 2 secrets", async () => {
    expect([0, 1, 2, 12].map(secretsWords)).toEqual(["no secrets", "1 secret", "2 secrets", "12 secrets"])
    const m = await ready()
    const plain = piped(m)
    expect(await m.zekno("deploy", ...where)).toBe(0)
    for (const name of ["A_ONE", "B_TWO"]) {
      m.typing("v")
      expect(await m.zekno("secret", "set", name, ...where)).toBe(0)
      expect(await m.zekno("deploy", ...where)).toBe(0)
    }
    expect(plain.out().filter((line) => line.startsWith("Deploy "))).toEqual([
      "Deploy 1 of web is running on dev with no secrets.",
      "Deploy 2 of web is running on dev with 1 secret.",
      "Deploy 3 of web is running on dev with 2 secrets.",
    ])
    // Nothing but the result line while a deploy runs and when it started: no stage, no Docker line.
    expect(plain.err()).toEqual([])
  })

  test("--json: one JSON object on standard output and nothing else; when the app did not start, Docker's lines on standard error", async () => {
    const m = await ready()
    const plain = piped(m)
    m.docker.upPrints({ stderr: " Container zekno-web-web-1  Started\n" })
    expect(await m.zekno("deploy", ...where, "--json")).toBe(0)
    expect(plain.written).toEqual([{ to: "out", line: '{"outcome":"started","app":"web","sequence":1,"server":"dev"}' }])
    plain.clear()
    m.docker.failWith(1)
    expect(await m.zekno("deploy", ...where, "--json")).toBe(1)
    expect(plain.written).toEqual([
      { to: "out", line: '{"outcome":"start_failed","app":"web","sequence":2,"server":"dev"}' },
      { to: "remote", line: "remote:  Container zekno-web-web-1  Started" },
    ])
  })

  test("without a terminal a command never asks: a missing detail or answer is an error that names the flag", async () => {
    const m = await ready()
    // The plain interface with nothing queued to type: as with no terminal at all.
    const err: string[] = []
    m.deps.ui = plainUi(
      () => {},
      (line) => void err.push(line)
    )
    expect(await m.zekno("secret", "set", "GREETING", ...where)).toBe(1)
    expect(err.at(-1)).toBe("There is no terminal to ask on. Pipe the value in and add `--stdin`.")
    expect(await m.zekno("deploy", "--server", "dev")).toBe(2)
    expect(err.at(-1)).toContain("Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json.")
    expect(await m.zekno("deploy", "--app", "web")).toBe(2)
    expect(err.at(-1)).toContain("`--server <name>`")
    m.tamper("profile.json", (profile) => ({
      ...profile,
      servers: profile.servers.map((server: object) => ({ ...server, target: { kind: "ssh", destination: "deploy@203.0.113.7", runnerPath: "zekno-runner" } })),
    }))
    expect(await m.zekno("server", "update", "dev")).toBe(1)
    expect(err.at(-1)).toBe("There is no terminal to ask on. Add `--yes` to update the runner on dev.")
  })

  test("plain lines when standard output or standard input is not a terminal, with --json, or with TERM=dumb; the interface otherwise", () => {
    const tty = { isTTY: true }
    const notTty = { isTTY: false }
    expect(wantsPlain(["deploy"], tty, tty, {})).toBe(false)
    // `zekno deploy < /dev/null` at a terminal, as on the board: the plain line.
    expect(wantsPlain(["deploy"], tty, notTty, {})).toBe(true)
    expect(wantsPlain(["deploy"], notTty, tty, {})).toBe(true)
    expect(wantsPlain(["deploy"], {}, {}, {})).toBe(true)
    expect(wantsPlain(["deploy", "--json"], tty, tty, {})).toBe(true)
    expect(wantsPlain(["deploy"], tty, tty, { TERM: "dumb" })).toBe(true)
  })

  test("piped, a failure goes to standard error as it is, with no colour, and the command ends only once standard error has taken it", async () => {
    const written: string[] = []
    // Standard error as a pipe that is full: it takes the text, and says to wait.
    const write = spyOn(process.stderr, "write").mockImplementation(((chunk: string) => (written.push(String(chunk)), false)) as never)
    const coloured = spyOn(console, "error")
    try {
      const ui = processPlainUi()
      ui.warn("Careful.")
      ui.error('No server named "prod". Connected servers: dev.')
      expect(written).toEqual(["Careful.\n", 'No server named "prod". Connected servers: dev.\n'])
      expect(coloured).not.toHaveBeenCalled()
      let closed = false
      const closing = ui.close().then(() => (closed = true))
      await Bun.sleep(30)
      expect(closed).toBe(false)
      process.stderr.emit("drain")
      await closing
      expect(closed).toBe(true)
    } finally {
      write.mockRestore()
      coloured.mockRestore()
    }
  })

  test("`zekno` with no arguments and no terminal prints the help and exits with status 2, as before", async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../../src/main.ts")], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // A profile folder that does not exist: the help is printed before anything is read.
      env: { ...process.env, ZEKNO_HOME: join(tempDir("no-profile"), "none") },
    })
    child.stdin.end()
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(code).toBe(2)
    expect(out).toBe(`${HELP}\n`)
    expect(err).toBe("")
    expect(out).not.toContain("\x1b")
  })
})

describe("a zekno and a runner one release apart still deploy (FR-021)", () => {
  /** The version the repository's runner reports, and the versions of the ordered list just after and just before it. */
  const own = runnerPackage.version
  const after = ORDERED_VERSIONS.find((version) => compareRunnerVersions(version, own) > 0)!
  const before = ORDERED_VERSIONS.filter((version) => compareRunnerVersions(version, own) < 0).at(-1)!
  const at = ["--app", "web", "--server", "prod"]

  test(`a zekno that carries ${after} (the runner is older) and one that carries ${before} (the runner is newer) each deploy to a runner of ${own}`, async () => {
    expect(after).toBeDefined()
    expect(before).toBeDefined()
    const m = machine()
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    m.compose(COMPOSE_V1)
    const server = standInServer()
    // The real runner process, with the stand-in Docker, already on the server: it is used as it is.
    server.installed(realRunner(m.docker.path))
    const carrying = (version: string) => (m.deps.release = { version, files: { "linux-x64": { sha256: null }, "linux-arm64": { sha256: null } } })
    const said = (from: number) => m.err.slice(from).filter((line) => line.startsWith("The runner on prod "))
    // D1 or D2 of contracts/versions.md, when exactly one of the two is a development release: these tests hold for a dev or a prod version.
    const dev = (runner: string, carried: string) =>
      isDevVersion(runner) && !isDevVersion(carried) ? ` Version ${runner} is a development release.` : isDevVersion(carried) && !isDevVersion(runner) ? " This zekno carries a development release." : ""
    await withSsh(sshStandIn(server), async () => {
      carrying(after)
      expect(await m.zekno("server", "add", "prod", "--ssh", "deploy@example.test")).toBe(0)
      m.typing("hello")
      expect(await m.zekno("secret", "set", "GREETING", ...at)).toBe(0)
      expect(await m.zekno("deploy", ...at)).toBe(0)
      let out = m.out.length
      let err = m.err.length
      expect(await m.zekno("status", "--server", "prod")).toBe(0)
      expect(m.out.slice(out)).toContainEqual(expect.stringMatching(/^web\tdeploy 1\t/))
      // W2 of contracts/versions.md: older, the same protocol.
      expect(said(err)).toEqual([
        `The runner on prod is version ${own}, older than this zekno's ${after}. Everything works with it. To bring it to ${after}, run \`zekno server update prod\`.${dev(own, after)}`,
      ])

      carrying(before)
      expect(await m.zekno("deploy", ...at)).toBe(0)
      out = m.out.length
      err = m.err.length
      expect(await m.zekno("status", "--server", "prod")).toBe(0)
      expect(m.out.slice(out)).toContainEqual(expect.stringMatching(/^web\tdeploy 2\t/))
      // W4: newer, the same protocol.
      expect(said(err)).toEqual([
        `The runner on prod is version ${own}, newer than this zekno's ${before}. It works with this zekno. Update zekno to match it; \`zekno server update\` never replaces a newer runner.${dev(own, before)}`,
      ])
      expect(m.docker.calls().map((call) => call.env.GREETING)).toEqual(["hello", "hello"])
    })
  }, 60_000)
})

describe("one connection per command (FR-034)", () => {
  test("`server add`, `deploy` and `status` each start the runner once, at a terminal as when piped", async () => {
    const m = machine()
    const log = join(m.project, "starts.log")
    m.deps.localRunner = ["sh", "-c", `for word; do :; done; echo "$word" >> "$0"; exec "$@"`, log, "env", `ZEKNO_DOCKER=${m.docker.path}`, process.execPath, RUNNER_MAIN]
    // A first answer that is late on a busy machine costs one more process and nothing else; this test is about requests sharing one.
    const connect = m.deps.connect
    m.deps.connect = (target, localRunner, options) => ({ ...connect(target, localRunner, options), firstAnswerMs: undefined })
    const starts = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [])
    piped(m)
    expect(await m.zekno("init", "--name", "Ada")).toBe(0)
    m.compose(COMPOSE_V1)
    const once = async (run: () => Promise<number>) => {
      const before = starts().length
      expect(await run()).toBe(0)
      expect(starts().slice(before)).toEqual(["session"])
    }
    await once(() => m.zekno("server", "add", "dev", "--local"))
    await once(async () => (await atTerminal(m, 100, "deploy", ...where)).code)
    await once(async () => (await atTerminal(m, 100, "status", "--server", "dev")).code)
    await once(() => m.zekno("deploy", ...where))
    await once(() => m.zekno("status", "--server", "dev"))
    expect(starts()).toEqual(Array(5).fill("session"))
  })
})
