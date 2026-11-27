/**
 * The first deploy in a folder with a Dockerfile, and `zekno settings init`
 * there (specs/016-build-from-source, contracts/cli.md CL6; FR-002 to FR-005,
 * FR-011; tasks T128; quickstart.md, US1's Mac tests). Each line is checked
 * by its id, never its words (FR-092). The server is this repository's
 * runner with the stand-in Docker, `builder`, `builds` and `deploy` answered
 * as CO12 gives them until the upload and the build are built (T130 to
 * T132; test/support/build-session.ts). A temporary `ZEKNO_HOME` and
 * `memoryKeyStore()`; the port 3000 is only a value in a file, and no test
 * opens a port.
 */
import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import type { Build, Envelope } from "@workspace/core"

import { FIRST_BUILD_ROWS as ROWS } from "../../src/asking/first-build"
import { NOTHING_DONE } from "../../src/cli/errors"
import { readAgreed } from "../../src/profile/agreed"
import {
  builderAnswer,
  buildsAnswer,
  payloadOf,
  standInSessions,
  started,
} from "../support/build-session"
import { answering, machine, ready } from "../support/helpers"

type Machine = ReturnType<typeof machine>

const WEB = "FROM alpine:3.20\nEXPOSE 3000\nCOPY . /app\n"

function write(folder: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true })
    writeFileSync(join(folder, name), text)
  }
}

/** A ready machine (a team and the server `dev`) whose folder holds only `files`. */
async function folderWith(files: Record<string, string>): Promise<Machine> {
  const m = await ready()
  rmSync(join(m.project, "compose.yaml"))
  write(m.project, files)
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

/** The settings file written in the folder, as JSON. */
const settingsOf = (m: Machine) =>
  JSON.parse(readFileSync(join(m.project, "zekno.app.json"), "utf8")) as {
    services: Record<string, Record<string, Record<string, unknown>>>
  }

/** The notes the stand-in terminal was given, in order. */
const notes = (asking: ReturnType<typeof answering>) =>
  asking.lines.filter(([kind]) => kind === "note").map(([, text]) => text)

/** Nothing was written in the folder or kept on this machine. */
function nothingWritten(m: Machine): void {
  expect(existsSync(join(m.project, "zekno.app.json"))).toBe(false)
  expect(existsSync(join(m.project, ".dockerignore"))).toBe(false)
  expect(existsSync(join(m.home, "agreed.json"))).toBe(false)
}

describe("zekno deploy at a terminal, in a folder with only a Dockerfile", () => {
  test("A1 to A6 and A7 come first; `Build, port 3000` writes the files, says A12, keeps the folder, and the deploy goes on", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    const stand = server(m)
    const asking = answering(m, [
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(asking.asked[0]).toEqual({
      kind: "choose",
      question: "A7",
      rows: [ROWS.port, ROWS.another, ROWS.none, ROWS.no],
    })
    expect(asking.asked[1]).toMatchObject({
      kind: "ask",
      question: "Name for this app",
    })
    expect(notes(asking).slice(0, 6)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
    ])
    expect(m.out).toContain("A12")

    expect(settingsOf(m).services.web).toEqual({
      build: { builder: "dockerfile", dockerfile: "Dockerfile" },
      networking: { port: 3000 },
    })
    expect(readFileSync(join(m.project, ".dockerignore"), "utf8")).toBe(
      "# A6\n**/node_modules\n**/.venv\n"
    )
    expect(readAgreed(m.home).folders).toEqual([
      {
        folder: realpathSync(m.project),
        settings: realpathSync(join(m.project, "zekno.app.json")),
      },
    ])
    // B24 is not asked again: the first question's yes was it (FR-002).
    expect(asking.asked.map(({ question }) => question)).not.toContain("B24")
    const signed = stand.inputs("deploy").at(-1) as { envelope: Envelope }
    const payload = payloadOf(signed.envelope)
    expect((payload.builds as Build[]).length).toBe(1)
    expect(payload.compose).toContain('"PORT": "3000"')
  }, 60_000)

  test("it comes before the key question, and needs no keychain", async () => {
    const m = machine()
    write(m.project, { Dockerfile: WEB })
    const asking = answering(m, [
      { choose: ROWS.port },
      { type: "Ada" },
      "leave",
    ])
    expect(await m.zekno("deploy")).toBe(1)
    expect(asking.asked.map(({ kind, question }) => [kind, question])).toEqual([
      ["choose", "A7"],
      ["ask", "Your name"],
      ["ask", "Where is the server?"],
    ])
    expect(existsSync(join(m.project, "zekno.app.json"))).toBe(true)
  }, 60_000)

  test("`Don't build`, Esc or Ctrl-C: nothing written, Nothing was done, exit status 1", async () => {
    for (const answer of [{ choose: ROWS.no }, "leave"] as const) {
      const m = await folderWith({ Dockerfile: WEB })
      const stand = server(m)
      answering(m, [answer])
      m.err.length = 0
      expect(await m.zekno("deploy")).toBe(1)
      expect(m.err).toEqual([NOTHING_DONE])
      nothingWritten(m)
      expect(stand.connections()).toBe(0)
    }
  }, 60_000)

  test("another port is asked with today's rule; a Dockerfile that names none is offered A9's rows", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    server(m)
    const asking = answering(m, [
      { choose: ROWS.another },
      { type: "99999" },
      { type: "8080" },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(asking.refused.length).toBe(1)
    expect(settingsOf(m).services.web!.networking).toEqual({ port: 8080 })

    const worker = await folderWith({ Dockerfile: "FROM alpine:3.20\n" })
    server(worker)
    const asked = answering(worker, [
      { choose: ROWS.noneWithout },
      { type: "shop" },
      { yes: false },
    ])
    expect(await worker.zekno("deploy")).toBe(0)
    expect(asked.asked[0]!.rows).toEqual([
      ROWS.withPort,
      ROWS.noneWithout,
      ROWS.noWithout,
    ])
    expect(notes(asked).slice(0, 3)).toEqual(["A1", "A2", "A3"])
    expect(settingsOf(worker).services.web!.networking).toBeUndefined()
  }, 60_000)

  test("a .dockerignore there: none proposed, A7 in its form that writes zekno.app.json alone", async () => {
    const m = await folderWith({ Dockerfile: WEB, ".dockerignore": "dist\n" })
    server(m)
    const asking = answering(m, [
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(notes(asking).slice(0, 4)).toEqual(["A1", "A2", "A3", "A4"])
    expect(readFileSync(join(m.project, ".dockerignore"), "utf8")).toBe(
      "dist\n"
    )
  }, 60_000)

  test("a 600 MB node_modules and no .dockerignore: the proposal leaves it out, and the deploy sends none of it", async () => {
    const m = await folderWith({ Dockerfile: WEB, "app.js": "1\n" })
    mkdirSync(join(m.project, "node_modules", "big"), { recursive: true })
    const big = join(m.project, "node_modules", "big", "blob.bin")
    writeFileSync(big, "")
    truncateSync(big, 600 * 1000 * 1000)
    const stand = server(m)
    answering(m, [{ choose: ROWS.port }, { type: "shop" }, { yes: false }])
    expect(await m.zekno("deploy")).toBe(0)
    expect(
      readFileSync(join(m.project, ".dockerignore"), "utf8").split("\n")
    ).toContain("**/node_modules")
    const signed = stand.inputs("deploy").at(-1) as { envelope: Envelope }
    const [build] = payloadOf(signed.envelope).builds as Build[]
    expect(build!.pack.size).toBeLessThan(64 * 1024)
  }, 60_000)
})

describe("several Dockerfiles (FR-004, plan item 19 (a))", () => {
  test("Dockerfile and Dockerfile.dev: A14 first, the choice written as build.dockerfile", async () => {
    const m = await folderWith({
      Dockerfile: WEB,
      "Dockerfile.dev": "FROM alpine:3.20\nEXPOSE 5173\n",
    })
    server(m)
    const asking = answering(m, [
      { choose: "Dockerfile.dev" },
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(asking.asked[0]).toEqual({
      kind: "choose",
      question: "A14",
      rows: ["Dockerfile", "Dockerfile.dev"],
    })
    expect(asking.asked[1]!.question).toBe("A7")
    expect(settingsOf(m).services.web).toEqual({
      build: { builder: "dockerfile", dockerfile: "Dockerfile.dev" },
      networking: { port: 5173 },
    })
  }, 60_000)

  test("a Dockerfile in a sub-folder that is sent is offered; one the ignore file leaves out is not", async () => {
    const m = await folderWith({ Dockerfile: WEB, "api/Dockerfile": WEB })
    server(m)
    const asking = answering(m, [
      { choose: "Dockerfile" },
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(asking.asked[0]!.rows).toEqual(["Dockerfile", "api/Dockerfile"])

    const ignored = await folderWith({
      Dockerfile: WEB,
      "api/Dockerfile": WEB,
      ".dockerignore": "api\n",
    })
    server(ignored)
    const one = answering(ignored, [
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await ignored.zekno("deploy")).toBe(0)
    expect(one.asked[0]!.question).toBe("A7")
  }, 60_000)

  test("no file named exactly Dockerfile: the Dockerfile.* and *.Dockerfile files are listed, even one", async () => {
    const m = await folderWith({
      "Dockerfile.prod": WEB,
      "worker.Dockerfile": "FROM alpine:3.20\n",
    })
    server(m)
    const asking = answering(m, [
      { choose: "worker.Dockerfile" },
      { choose: ROWS.noneWithout },
      { type: "shop" },
      { yes: false },
    ])
    expect(await m.zekno("deploy")).toBe(0)
    expect(asking.asked[0]!.rows).toEqual([
      "Dockerfile.prod",
      "worker.Dockerfile",
    ])
    expect(settingsOf(m).services.web!.build).toEqual({
      builder: "dockerfile",
      dockerfile: "worker.Dockerfile",
    })

    const one = await folderWith({ "Dockerfile.prod": WEB })
    server(one)
    const asked = answering(one, [
      { choose: "Dockerfile.prod" },
      { choose: ROWS.port },
      { type: "shop" },
      { yes: false },
    ])
    expect(await one.zekno("deploy")).toBe(0)
    expect(asked.asked[0]!.rows).toEqual(["Dockerfile.prod"])
  }, 60_000)
})

describe("unchanged where CL6 does not apply", () => {
  test("with no terminal, or --json: today's sentence for a folder with no Compose file, nothing written", async () => {
    for (const json of [false, true]) {
      const m = await folderWith({ Dockerfile: WEB })
      const stand = server(m)
      m.err.length = 0
      const args = ["deploy", "--app", "shop", "--server", "dev"]
      expect(await m.zekno(...args, ...(json ? ["--json"] : []))).toBe(1)
      expect(m.err).toEqual([
        `No Compose file at ${join(m.project, "compose.yaml")}. Point to one with \`-f <file>\`.`,
      ])
      nothingWritten(m)
      expect(stand.connections()).toBe(0)
    }
  }, 60_000)

  test("a folder with both zekno.app.json and compose.yaml keeps today's question", async () => {
    const m = await ready()
    write(m.project, {
      Dockerfile: WEB,
      "zekno.app.json": `${JSON.stringify({ zekno: 1, services: { web: { source: { image: "nginx:1" } } } })}\n`,
    })
    const asking = answering(m, ["leave"])
    expect(await m.zekno("deploy")).toBe(1)
    expect(asking.asked.map(({ kind }) => kind)).toEqual(["choose"])
    expect(asking.asked[0]!.question).not.toBe("A7")
  }, 60_000)

  test("`-f` names the file: no first question", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    const asking = answering(m, [])
    m.err.length = 0
    expect(await m.zekno("deploy", "-f", "compose.yaml")).toBe(1)
    expect(asking.asked).toEqual([])
    nothingWritten(m)
  }, 60_000)
})

describe("zekno settings init in a folder with a Dockerfile (A18, G25)", () => {
  test("the same question, `Run an image instead` last; a build asks today's service name and writes both files", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    const asking = answering(m, [{ choose: ROWS.port }, { type: "api" }])
    expect(await m.zekno("settings", "init")).toBe(0)
    expect(asking.asked.map(({ question }) => question)).toEqual([
      "A18",
      "Service name",
    ])
    expect(asking.asked[0]!.rows).toEqual([
      ROWS.port,
      ROWS.another,
      ROWS.none,
      ROWS.image,
    ])
    expect(settingsOf(m).services.api).toEqual({
      build: { builder: "dockerfile", dockerfile: "Dockerfile" },
      networking: { port: 3000 },
    })
    expect(existsSync(join(m.project, ".dockerignore"))).toBe(true)
    expect(m.out).toContain("G25")
    // `zekno settings init` is no deploy: the folder is asked about at its first deploy (B24).
    expect(existsSync(join(m.home, "agreed.json"))).toBe(false)
  }, 60_000)

  test("`Run an image instead` goes on to today's image and service name questions", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    const asking = answering(m, [
      { choose: ROWS.image },
      { type: "nginx:1" },
      { type: "web" },
    ])
    expect(await m.zekno("settings", "init")).toBe(0)
    expect(asking.asked.map(({ question }) => question)).toEqual([
      "A18",
      "Image",
      "Service name",
    ])
    expect(settingsOf(m).services.web).toEqual({ source: { image: "nginx:1" } })
    expect(existsSync(join(m.project, ".dockerignore"))).toBe(false)
  }, 60_000)

  test("Esc at the first question writes nothing", async () => {
    const m = await folderWith({ Dockerfile: WEB })
    answering(m, ["leave"])
    expect(await m.zekno("settings", "init")).toBe(1)
    nothingWritten(m)
  }, 60_000)
})
