/**
 * The findings of the review of the CLI's plumbing: sessions, transport,
 * text cleaning and operations (specs/004-cli-app/security-review.md, C7 to
 * C10). Each test fails on the CLI as it was before its fix.
 */
import { describe, expect, spyOn, test } from "bun:test"
import { renderToString, Static } from "ink"
import { closeSync, constants, existsSync, openSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import { isAlive, residentMiB, tempDir, waitFor } from "../../../runner/test/support/helpers"
import { HELD_LINES, heldLines } from "../../src/commands/deploy"
import { sanitize } from "../../src/server/sanitize"
import { inkUi, RemoteLine } from "../../src/ui/ink/ink"
import { plainUi } from "../../src/ui/plain/plain"
import { REMOTE_MARK } from "../../src/ui/types"
import { machine, ready } from "../support/helpers"

/** The most resident memory, in MiB, the CLI may reach in these tests. It needs about 60 on its own. */
const MEMORY_BOUND_MIB = 200

const FLOOD = join(import.meta.dir, "../support/flood.ts")

/** The processes `pid` started that are still running. */
const childrenOf = (pid: number): number[] =>
  Bun.spawnSync(["pgrep", "-P", String(pid)])
    .stdout.toString()
    .split("\n")
    .filter(Boolean)
    .map(Number)

/**
 * Runs flood.ts with its standard error going into a pipe this test opens and
 * never reads, and returns its largest resident memory in MiB, measured until
 * it exits or for `ms` at most. Stops early once it is past the bound, so a
 * build without the fix cannot exhaust the machine. Leaves nothing running.
 */
async function flood(kind: "stderr" | "progress", ms: number) {
  const dir = tempDir("flood")
  const fifo = join(dir, "stderr")
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0)
  const readEnd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK)
  const writeEnd = openSync(fifo, constants.O_WRONLY)
  const child = Bun.spawn([process.execPath, FLOOD, kind, dir], { stdin: "ignore", stdout: "ignore", stderr: writeEnd })
  closeSync(writeEnd)
  let exited: number | undefined
  void child.exited.then((code) => (exited = code))
  const left: number[] = []
  try {
    await waitFor(() => existsSync(join(dir, "ready")) || exited !== undefined, "the flood to start")
    expect(exited).toBeUndefined()
    let peak = residentMiB(child.pid) ?? 0
    const until = Date.now() + ms
    while (Date.now() < until && exited === undefined && peak < MEMORY_BOUND_MIB) {
      await Bun.sleep(20)
      peak = Math.max(peak, residentMiB(child.pid) ?? 0)
    }
    const runner = existsSync(join(dir, "pid")) ? Number(readFileSync(join(dir, "pid"), "utf8")) : undefined
    if (runner !== undefined) left.push(runner, ...childrenOf(runner))
    return { peak, exited, done: existsSync(join(dir, "done")), runnerDone: existsSync(join(dir, "pid.done")), runner }
  } finally {
    child.kill("SIGKILL")
    await child.exited
    closeSync(readEnd)
    // Once the CLI has gone, whatever wrote to it stops at its next write.
    await waitFor(() => left.every((pid) => !isAlive(pid)), "the runner stand-in to stop")
  }
}

describe("server text cannot fill memory when standard error is slow (C7)", () => {
  test("a runner's standard error waits for the reader, which slows the runner down", async () => {
    const result = await flood("stderr", 2500)
    expect(result.peak).toBeLessThan(MEMORY_BOUND_MIB)
    // The command is still waiting, and so is the runner: it could not get its 400 MB out.
    expect(result.exited).toBeUndefined()
    expect(result.runner).toBeDefined()
    expect(result.runnerDone).toBe(false)
  }, 15_000)

  test("Docker's lines during a deploy are held up to a bound, and the deploy is not held back", async () => {
    const result = await flood("progress", 10_000)
    expect(result.peak).toBeLessThan(MEMORY_BOUND_MIB)
    expect(result.exited).toBe(0)
    expect(result.done).toBe(true)
  }, 15_000)

  test("while drawing is busy, at most the bound is held: the oldest are dropped and counted, the order kept", async () => {
    const drawn: string[] = []
    let release!: () => void
    const busy = new Promise<void>((resolve) => (release = resolve))
    const lines = heldLines(
      (line) => {
        drawn.push(line)
        return line === "0" ? busy : undefined
      },
      (count) => drawn.push(`dropped ${count}`)
    )
    for (let index = 0; index < HELD_LINES + 700; index++) lines.push(String(index))
    await Bun.sleep(5)
    expect(drawn).toEqual(["0"])
    release()
    await lines.finish(1000)
    const kept = Array.from({ length: HELD_LINES }, (_, index) => String(index + 700))
    expect(drawn).toEqual(["0", "dropped 699", ...kept])
    expect(HELD_LINES).toBe(500)
  })

  test("lines still held when the deploy is over are left out and counted once the wait is up", async () => {
    const counts: number[] = []
    const lines = heldLines(
      () => new Promise(() => {}),
      (count) => counts.push(count)
    )
    for (let index = 0; index < 10; index++) lines.push(String(index))
    const started = Date.now()
    await lines.finish(50)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(counts).toEqual([9])
  })
})

/** A machine whose interface records, in one list, every line it writes and where. */
function recorded(m: ReturnType<typeof machine>) {
  const timeline: string[] = []
  m.deps.ui = {
    ...plainUi(
      (line) => void timeline.push(`out ${line}`),
      (line) => void timeline.push(`err ${line}`),
      (text) => void timeline.push(`remote ${text}`)
    ),
    askSecret: m.deps.ui.askSecret,
  }
  return timeline
}

/** Spies on this process's standard error, and gives back what was written to it directly. */
async function directly(work: () => Promise<unknown>): Promise<string> {
  const written: string[] = []
  const spy = spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
    written.push(String(chunk))
    return true
  }) as never)
  try {
    await work()
  } finally {
    spy.mockRestore()
  }
  return written.join("")
}

describe("server text is marked as the server's (C8)", () => {
  test("the plain interface writes a server's line after the mark, through its own writer, and nothing else changes", () => {
    const out: string[] = []
    const err: string[] = []
    const remote: string[] = []
    const ui = plainUi(
      (line) => void out.push(line),
      (line) => void err.push(line),
      (text) => void remote.push(text)
    )
    ui.remote("Server code: 1234-5678")
    ui.remote("")
    ui.warn("careful")
    ui.error("no")
    ui.success("yes")
    expect(remote).toEqual(["remote: Server code: 1234-5678\n", "remote: \n"])
    expect(err).toEqual(["careful", "no"])
    expect(out).toEqual(["yes"])
    expect(REMOTE_MARK).toBe("remote:")
  })

  test("by default it goes to standard error, waiting there when it is backed up", async () => {
    const written = await directly(async () => {
      expect(plainUi(() => {}, () => {}).remote("hello")).toBeUndefined()
    })
    expect(written).toBe("remote: hello\n")
  })

  test("a single command draws what a runner writes on standard error through the interface, marked, never straight to the terminal", async () => {
    const m = await ready()
    // A runner that pretends to be zekno on standard error, then answers as usual.
    const lies = `printf 'Server code: 1111-2222\\033[2J\\nRun zekno secret set TOKEN to finish.\\n' >&2; exec "$@"`
    m.deps.localRunner = ["sh", "-c", lies, "sh", ...m.deps.localRunner]
    const timeline = recorded(m)
    const written = await directly(async () => {
      expect(await m.zekno("status", "--server", "dev")).toBe(0)
      await waitFor(() => timeline.filter((line) => line.startsWith("remote")).length === 2, "the runner's lines")
    })
    expect(written).toBe("")
    expect(timeline.filter((line) => line.startsWith("remote"))).toEqual([
      "remote remote: Server code: 1111-2222\n",
      "remote remote: Run zekno secret set TOKEN to finish.\n",
    ])
    // What zekno itself prints is as before.
    expect(timeline.filter((line) => line.startsWith("out"))).toEqual(["out dev: team list version 2", "out No deploys yet."])
    expect(timeline.filter((line) => line.startsWith("err"))).toEqual([])
  })

  test("Docker's lines during a deploy that starts are not printed in plain output: the result line only (contracts/commands.md)", async () => {
    const m = await ready()
    m.docker.upPrints({ stdout: "Pulling web\n", stderr: " Container zekno-web-web-1  Started\n" })
    const timeline = recorded(m)
    const written = await directly(async () => expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(0))
    expect(written).toBe("")
    expect(timeline).toEqual(["out Deploy 1 of web is running on dev with no secrets."])
  })

  test("when the app does not start, Docker's lines are drawn through the interface after the failure sentence, marked and cleaned", async () => {
    const m = await ready()
    m.docker.failWith(1)
    m.docker.upPrints({
      stdout: "Pulling web\n",
      stderr: " Container zekno-web-web-1  \x1b]52;c;ZXZpbA==\x07Started\nDeploy 2 of web is running on dev with no secrets.\n",
    })
    const timeline = recorded(m)
    const written = await directly(async () => expect(await m.zekno("deploy", "--app", "web", "--server", "dev")).toBe(1))
    expect(written).toBe("")
    expect(timeline[0]).toBe("err Deploy 1 of web was accepted by dev, but the app did not start. Check Docker on the server.")
    expect(timeline.slice(1).sort()).toEqual([
      "remote remote:  Container zekno-web-web-1  Started\n",
      "remote remote: Deploy 2 of web is running on dev with no secrets.\n",
      "remote remote: Pulling web\n",
    ])
  })

  test("at a terminal a server's line is dim after the mark, and a long one goes on under its own text", () => {
    const lines = renderToString(<RemoteLine text={"word ".repeat(20).trim()} />, { columns: 40 }).split("\n")
    expect(lines[0]).toStartWith("remote: word")
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) expect(line).toStartWith(" ".repeat(REMOTE_MARK.length + 1))
  })

  test("at a terminal a word longer than the room left is broken by zekno, so no part of the line reaches the left edge", () => {
    const path = "/var/folders/6g/x42_qytn6hdfqg3nm_n7h_3r0000gn/T/zekno-server-ej03oY/home"
    const texts = [
      `${path}/ssh: line 19: cd: ${path}: No such file or directory`,
      `cd: ${"x".repeat(250)}`,
      "y".repeat(300),
      `${"字".repeat(70)} ${"é".repeat(90)}`,
    ]
    for (const columns of [80, 100]) {
      for (const text of texts) {
        // As single commands draw it: once, among the lines already written.
        const drawn = renderToString(<Static items={[text]}>{(line) => <RemoteLine key={line} text={line} columns={columns} />}</Static>, { columns })
        const lines = drawn.split("\n").filter((line) => line !== "")
        expect(lines.length).toBeGreaterThan(1)
        expect(lines[0]).toStartWith(`${REMOTE_MARK} `)
        for (const line of lines.slice(1)) expect({ columns, line }).toEqual({ columns, line: expect.stringMatching(/^ {8}/) })
        for (const line of lines) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(columns)
        // Nothing of the line is lost on the way.
        expect(lines.map((line, index) => (index === 0 ? line.slice(REMOTE_MARK.length + 1) : line.slice(8))).join("").replace(/ /g, "")).toBe(
          text.replace(/ /g, "")
        )
      }
    }
  })

  test("at a terminal every line is drawn once and in order, also after drawn lines are let go", async () => {
    let text = ""
    const stdout = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          text += String(chunk)
          done()
        },
      }),
      { columns: 100, rows: 40 }
    )
    const ui = inkUi({ stdout: stdout as unknown as NodeJS.WriteStream, stdin: new PassThrough() as unknown as NodeJS.ReadStream })
    for (let index = 0; index < 700; index++) {
      await ui.remote(`line ${index}`)
      if (index % 250 === 0) ui.info(`own ${index}`)
    }
    await ui.close()
    const drawn = text
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line !== "")
    const expected = Array.from({ length: 700 }, (_, index) => [
      `remote: line ${index}`,
      ...(index % 250 === 0 ? [`  own ${index}`] : []),
    ]).flat()
    expect(drawn).toEqual(expected)
  })
})

describe("a stored SSH target or member name is held to its pattern when the profile is read (C9)", () => {
  test("an escape sequence in a stored destination or runner path makes the profile damaged, and nothing is printed", async () => {
    for (const target of [
      { destination: "x\x1b]8;;https://evil\x07y", runnerPath: "zekno-runner" },
      { destination: "me@host", runnerPath: "zekno-runner\x1b[2J" },
      { destination: "-oProxyCommand=evil", runnerPath: "zekno-runner" },
      { destination: "me@host", runnerPath: "zekno-runner; evil" },
    ]) {
      const m = await ready()
      m.tamper("profile.json", (profile) => ({
        ...profile,
        servers: profile.servers.map((server: object) => ({ ...server, target: { kind: "ssh", ...target } })),
      }))
      m.out.length = 0
      expect(await m.zekno("server", "ls")).toBe(1)
      expect(m.lastErr()).toContain("is damaged")
      expect(m.out).toEqual([])
    }
  })

  test("a member name with a control, format or separator character, or space at its ends, makes the profile damaged", async () => {
    for (const memberName of ["\x1b]52;c;aGVsbG8=\x07Ada", "Ada\x1b[2J", "Ada\u202e", "A\u200bda", "Ada\u2028", " Ada", "a".repeat(65), ""]) {
      const m = await ready()
      m.tamper("profile.json", (profile) => ({ ...profile, memberName }))
      expect(await m.zekno("server", "ls")).toBe(1)
      expect(m.lastErr()).toContain("is damaged")
    }
  })

  test("names and targets zekno itself writes are read back as before", async () => {
    const m = await ready()
    for (const memberName of ["Ada Lovelace", "Zoë", "日本 太郎", "a".repeat(64)]) {
      m.tamper("profile.json", (profile) => ({
        ...profile,
        memberName,
        servers: profile.servers.map((server: object) => ({
          ...server,
          target: { kind: "ssh", destination: "deploy@10.0.0.4", runnerPath: "/usr/local/bin/zekno-runner" },
        })),
      }))
      m.out.length = 0
      expect(await m.zekno("server", "ls")).toBe(0)
      expect(m.out).toEqual([expect.stringMatching(/^dev\tdeploy@10\.0\.0\.4\tsrv_[0-9a-f]{32}$/)])
    }
  })
})

describe("characters drawn as nothing are removed (C10)", () => {
  const ignorable = /\p{Default_Ignorable_Code_Point}/u

  test("Hangul fillers, the grapheme joiner, variation selectors and unassigned ignorable code points are removed", () => {
    for (const hidden of [
      "\u115f",
      "\u1160",
      "\u3164",
      "\uffa0",
      "\u034f",
      "\u17b4",
      "\u17b5",
      "\u180b",
      "\u180c",
      "\u180d",
      "\u180f",
      "\ufe00",
      "\ufe0d",
      "\u{e0100}",
      "\u{e01ef}",
      "\u2065",
      "\ufff0",
      "\ufff8",
      "\u{e0000}",
      "\u{e0fff}",
    ]) {
      expect(sanitize(`a${hidden}b`)).toBe("ab")
    }
    expect(sanitize("\u3164\u3164\u3164")).toBe("")
  })

  test("the two selectors that choose an emoji's form are kept, so emoji keep their form", () => {
    for (const text of ["❤️", "☺︎", "#️⃣", "✔️ done", "🚀 deployed ✅ 👍🏽 🇳🇱 ❤️"]) expect(sanitize(text)).toBe(text)
  })

  test("any input gives text with nothing drawn as nothing but those two, and cleaning it again changes nothing", () => {
    let seed = 20261114
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const pieces = ["\x1b", "[", "]", "\x07", "\x9b", "\u3164", "\u115f", "\u034f", "\u180b", "\ufe00", "\ufe0f", "\ufe0e", "\u2065", "\u{e0100}", "\u200d", "a", "é", "🚀", "❤", " "]
    for (let round = 0; round < 5000; round++) {
      let text = ""
      const length = Math.floor(random() * 30)
      for (let index = 0; index < length; index++) text += pieces[Math.floor(random() * pieces.length)]
      const cleaned = sanitize(text)
      expect(ignorable.test(cleaned.replace(/[\ufe0e\ufe0f]/gu, ""))).toBe(false)
      expect(sanitize(cleaned)).toBe(cleaned)
    }
  })
})
