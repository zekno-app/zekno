/**
 * Keys typed before a question of the settings screen is on the screen
 * (specs/010-app-settings, the pseudo-terminal walkthrough, difference 3):
 * the real app, as `zekno` opens it, reading keys from a stand-in terminal.
 * The walkthrough wrote `1g` and Enter in one read, then `y` 3 ms later,
 * before the question had reached the terminal, and the file was written. A
 * key read in the same read as the one that opens a question, or in the
 * moment after it, answers nothing; one typed once the question is drawn
 * does.
 */
import { afterEach, expect, test } from "bun:test"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"

import { openApp } from "../../src/app/app"
import { loadStart } from "../../src/app/effects/profile"
import { ready } from "../support/helpers"
import { DESIGN_FILE } from "../support/settings-files"

/** An input that says it is a terminal, and an output that keeps what Ink writes. */
function standIn(columns = 100, rows = 30) {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      input.isRaw = mode
      return input
    },
    ref: () => input,
    unref: () => input,
  })
  let raw = ""
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        raw += String(chunk)
        done()
      },
    }),
    { columns, rows, isTTY: true }
  )
  return {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    /** Writes `text` as one read of the terminal. */
    write: (text: string) => void input.write(text),
    raw: () => raw,
  }
}

/** Waits until `ready` holds, at most `ms`. */
async function until(ready: () => boolean, what: string, ms = 10_000) {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > ms) throw new Error(`never happened: ${what}`)
    await Bun.sleep(5)
  }
}

const quits: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(quits.splice(0).map((quit) => quit()))
})

test("a y read 3 ms after the read that opens the write question writes nothing; a y once it is drawn writes", async () => {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  writeFileSync(join(m.project, "zekno.app.json"), DESIGN_FILE)
  expect(await m.zekno("link", "--app", "demo", "--server", "dev")).toBe(0)
  expect(await m.zekno("deploy")).toBe(0)
  const file = () => readFileSync(join(m.project, "zekno.app.json"), "utf8")
  const t = standIn()
  const closed = openApp(m.deps, {
    start: await loadStart(m.deps),
    background: "dark",
    stdin: t.stdin,
    stdout: t.stdout,
    refreshMs: 60_000,
  })
  quits.push(async () => {
    t.write("q")
    await closed
  })
  const since = (mark: number, text: string) =>
    t.raw().slice(mark).includes(text)
  /** Waits for `text` to be drawn after `mark`, then as long again as a person would take to read it. */
  const drawn = async (mark: number, text: string) => {
    await until(() => since(mark, text), text)
    await Bun.sleep(100)
  }

  await drawn(0, "demo")
  let mark = t.raw().length
  t.write("\x1b[C")
  await Bun.sleep(100)
  t.write("\r")
  await drawn(mark, "e settings")
  mark = t.raw().length
  t.write("e")
  await drawn(mark, "memory")
  for (let n = 0; n < 3; n++) {
    t.write("\x1b[B")
    await Bun.sleep(60)
  }
  mark = t.raw().length
  t.write("\r")
  await drawn(mark, "Memory limit")
  t.write("\x7f\x7f\x7f\x7f")
  await Bun.sleep(100)

  // `2g` and Enter in one read open the question; `y` 3 ms later, before it can have been drawn.
  mark = t.raw().length
  t.write("2g\r")
  await Bun.sleep(3)
  t.write("y")
  await drawn(mark, "Write this to zekno.app.json?")
  await Bun.sleep(200)
  expect(file()).toBe(DESIGN_FILE)
  // In the same read as the Enter that opened it: nothing either.
  t.write("\x1b")
  await Bun.sleep(100)
  expect(file()).toBe(DESIGN_FILE)

  // Once drawn, the question takes its answer.
  mark = t.raw().length
  t.write("\r")
  await drawn(mark, "Memory limit")
  t.write("\x7f\x7f\x7f\x7f")
  await Bun.sleep(100)
  mark = t.raw().length
  t.write("2g\r")
  await drawn(mark, "Write this to zekno.app.json?")
  expect(file()).toBe(DESIGN_FILE)
  t.write("y")
  await until(() => file().includes('"memory": "2g"'), "the file written")
}, 60_000)
