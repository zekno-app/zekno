/**
 * `git-listener.ts` (specs/016-build-from-source, T018), branch by branch:
 * the Perl program compiles (`perl -c`, which runs nothing of it), the
 * start and stop scripts parse (`sh -n`), and the log is read for its
 * requests and for a value, as it is or in a credential. A stand-in
 * function answers for the stand-in; nothing here runs Docker or starts
 * the listener.
 */
import { describe, expect, test } from "bun:test"

import {
  carriesValue,
  LISTENER_PERL,
  LISTENER_PORT,
  listenerFiles,
  listenerWords,
  requestLinesOf,
  startListener,
  startListenerScript,
  stopListener,
  stopListenerScript,
} from "./git-listener"
import type { InStandIn } from "../build-runs/rb7"

const FOLDER = "/tmp/zekno-check-secrets/listener"
const VALUE = "zekno-l14-0123456789abcdef0123456789abcdef"
const basic = (text: string) => Buffer.from(text).toString("base64")
const LOG = [
  "GET /zekno-check-0123.git/info/refs?service=git-upload-pack HTTP/1.1",
  "Host: 127.0.0.1:9480",
  "User-Agent: git/2.43.0",
  "--",
].join("\n")

const parses = (script: string) =>
  Bun.spawnSync(["sh", "-n", "-c", script]).exitCode === 0

describe("the program and its scripts", () => {
  test("the Perl compiles", () => {
    const checked = Bun.spawnSync(["perl", "-c", "-e", LISTENER_PERL])
    expect(checked.stderr.toString()).toContain("syntax OK")
    expect(checked.exitCode).toBe(0)
  })

  test("start and stop parse, on 127.0.0.1 only, with files in the check's folder", () => {
    const start = startListenerScript(FOLDER, LISTENER_PORT)
    expect(parses(start)).toBe(true)
    expect(parses(stopListenerScript(FOLDER))).toBe(true)
    expect(LISTENER_PERL).toContain('LocalAddr => "127.0.0.1"')
    expect(start).toContain(`${LISTENER_PORT} ${FOLDER}/requests.log`)
    expect(listenerFiles(FOLDER)).toEqual({
      log: `${FOLDER}/requests.log`,
      errors: `${FOLDER}/listener.err`,
      pid: `${FOLDER}/listener.pid`,
    })
    expect(stopListenerScript(FOLDER)).toContain('= perl ]; then kill "$pid"')
  })

  test("refuse a folder outside the checks', and ports 3000, 3100, the registry's, and below 1024", () => {
    for (const folder of ["/tmp/other", "/tmp/zekno-check-x/../y", "relative"])
      expect(() => startListenerScript(folder, LISTENER_PORT)).toThrow(
        "not a folder of a check"
      )
    for (const port of [3000, 3100, 5000, 80, 70000, 1.5])
      expect(() => startListenerScript(FOLDER, port)).toThrow(
        "not a port the listener may take"
      )
    expect(LISTENER_PORT).not.toBe(3000)
    expect(LISTENER_PORT).not.toBe(3100)
  })
})

describe("reading the log", () => {
  test("its request lines", () => {
    expect(requestLinesOf(`${LOG}\n${LOG}\n`)).toEqual([
      "GET /zekno-check-0123.git/info/refs?service=git-upload-pack HTTP/1.1",
      "GET /zekno-check-0123.git/info/refs?service=git-upload-pack HTTP/1.1",
    ])
    expect(requestLinesOf("")).toEqual([])
  })

  test("a value as it is, or in a basic or bearer credential, and nowhere else", () => {
    expect(carriesValue(LOG, VALUE)).toBe(false)
    expect(carriesValue(`${LOG}\nX-Token: ${VALUE}`, VALUE)).toBe(true)
    expect(
      carriesValue(
        `Authorization: basic ${basic(`x-access-token:${VALUE}`)}`,
        VALUE
      )
    ).toBe(true)
    expect(carriesValue(`authorization: Bearer ${basic(VALUE)}`, VALUE)).toBe(
      true
    )
    expect(
      carriesValue(
        `Authorization: basic ${basic("x-access-token:other")}`,
        VALUE
      )
    ).toBe(false)
    expect(() => carriesValue(LOG, "")).toThrow("a value is looked for")
  })

  test("its words never hold the value", () => {
    expect(listenerWords(undefined, VALUE)).toBe(
      "the listener's log could not be read"
    )
    expect(listenerWords("", VALUE)).toBe("the listener got no request")
    expect(listenerWords(LOG, VALUE)).toBe(
      "the listener got 1 (GET /zekno-check-0123.git/info/refs?service=git-upload-pack HTTP/1.1); none carried the value"
    )
    const carried = `${LOG}\nAuthorization: basic ${basic(`x-access-token:${VALUE}`)}\n`
    const words = listenerWords(
      [carried, carried, carried, carried].join("\n"),
      VALUE
    )
    expect(words).toContain("the listener got 4 (")
    expect(words).toContain(
      " and 1 more); the value reached it as a credential"
    )
    expect(words).not.toContain(VALUE)
  })
})

describe("in the stand-in", () => {
  test("start and stop run their scripts, and say what failed", async () => {
    const calls: (readonly string[])[] = []
    const ok: InStandIn = async (args) => {
      calls.push(args)
      return { code: 0, stdout: "", stderr: "" }
    }
    await startListener(ok, FOLDER)
    await stopListener(ok, FOLDER)
    expect(calls).toEqual([
      ["sh", "-c", startListenerScript(FOLDER, LISTENER_PORT)],
      ["sh", "-c", stopListenerScript(FOLDER)],
    ])
    const failing: InStandIn = async () => ({
      code: 1,
      stdout: "",
      stderr: "the listener stopped: listen: in use",
    })
    await expect(startListener(failing, FOLDER)).rejects.toThrow(
      "starting the listener failed (exit 1): the listener stopped: listen: in use"
    )
    await expect(stopListener(failing, FOLDER)).rejects.toThrow(
      "stopping the listener failed (exit 1)"
    )
  })
})
