import { describe, expect, test } from "bun:test"
import { renderToString } from "ink"

import { AppView, createStore } from "../src/app/app"
import { HELP } from "../src/app/screens/help"
import { HINTS } from "../src/app/screens/placeholder"
import { initialState, update, type AppEvent, type Effect, type State, type TeamView } from "../src/app/state"
import { logoLines } from "../src/ui/logo"

const TEAM: TeamView = { member: "Ada", version: 2, servers: [{ name: "prod", destination: "deploy@203.0.113.7", apps: [] }] }

/** The window as the app draws it, `columns` by `rows`. */
function draw(state: State, columns: number, rows: number): string[] {
  return renderToString(<AppView state={state} columns={columns} rows={rows} />, { columns }).split("\n")
}

const home = (size = { columns: 100, rows: 30 }) => initialState({ kind: "team", team: TEAM }, size)
const after = (state: State, ...events: AppEvent[]) => events.reduce((current, event) => update(current, event).state, state)
const key = (text: string): AppEvent => ({ type: "key", key: { kind: "text", text } })

/** Nothing is drawn past the window, and the key hints are its last line. */
function fits(lines: string[], columns: number, rows: number) {
  expect(lines.length).toBeLessThanOrEqual(rows)
  for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns)
}
const lastLine = (lines: string[]) => lines.filter((line) => line.trim() !== "").at(-1)!.trim()
/** All the text, with the box lines and runs of spaces taken out, for wording that may wrap. */
const words = (lines: string[]) => lines.join(" ").replace(/[│╭╮╰╯─]/g, " ").replace(/\s+/g, " ")

describe("the header", () => {
  test("the wordmark, the screen's place and 'pre-alpha, unaudited' on the wordmark's last line", () => {
    const lines = draw(after(home(), key("?")), 100, 30)
    const logo = logoLines().map((line) => ` ${line}`.trimEnd())
    expect(lines[0]).toBe(logo[0])
    expect(lines[1]).toBe(logo[1])
    expect(lines[2]!.startsWith(` ${logoLines()[2]} › help`)).toBe(true)
    expect(lines[2]!.trimEnd().endsWith("pre-alpha, unaudited")).toBe(true)
    expect([...lines[2]!.trimEnd()].length).toBe(99)
  })
})

describe("help (board 'Help')", () => {
  test("every key of the app, grouped and worded as on the board", () => {
    // Wide enough that nothing wraps, so each row can be read whole.
    const lines = renderToString(<AppView state={after(home({ columns: 200, rows: 40 }), key("?"))} columns={200} rows={40} />, { columns: 200 }).split("\n")
    const text = lines.join("\n")
    for (const column of HELP) {
      for (const group of column) {
        expect(text).toContain(group.heading)
        for (const [k, does] of group.keys) expect(text).toContain(`${k.padEnd(6)}${does}`)
      }
    }
    expect(text).toContain("Single commands for scripts: zekno --help")
    expect(lastLine(lines)).toBe("esc close help")
  })

  test("the board's groups, in its order", () => {
    expect(HELP.map((column) => column.map((group) => group.heading))).toEqual([
      ["Move around", "Anywhere"],
      ["An app", "Servers"],
      ["Logs", "While deploying"],
    ])
    expect(HELP.flat().flatMap((group) => group.keys.map(([k]) => k))).toEqual(
      ["↑ ↓", "← →", "tab", "enter", "esc", "?", "q", "d", "r", "l", "s", "x", "a", "u", "f", "/", "1-9", "0", "o", "esc"]
    )
  })

  for (const [columns, rows] of [
    [100, 30],
    [80, 24],
  ] as const) {
    test(`fits ${columns} by ${rows}, with every word of the board`, () => {
      const lines = draw(after(home({ columns, rows }), key("?")), columns, rows)
      fits(lines, columns, rows)
      const all = words(lines)
      for (const group of HELP.flat()) {
        expect(all).toContain(group.heading)
        for (const [, does] of group.keys) for (const word of does.split(" ")) expect(all).toContain(word)
      }
      expect(lastLine(lines)).toBe("esc close help")
    })
  }
})

describe("terminal too small (board 'Terminal too small')", () => {
  test("says what the window is and what is needed, worded as on the board", () => {
    const lines = draw(home({ columns: 70, rows: 20 }), 70, 20).map((line) => line.trimEnd())
    expect(lines).toContain(" zekno needs a larger window.")
    expect(lines).toContain(" this window  70 columns, 20 lines")
    expect(lines).toContain(" needed       80 columns, 24 lines")
    expect(lines).toContain(" Make the window larger and the app comes back where you were.")
    expect(lines).toContain(" q quit")
    fits(lines, 70, 20)
  })

  test("below 80 columns or below 24 lines, from any screen, and the screen comes back at 80 by 24", () => {
    const onHelp = after(home(), key("?"))
    expect(draw(onHelp, 79, 30).join("\n")).toContain("zekno needs a larger window.")
    expect(draw(onHelp, 100, 23).join("\n")).toContain("zekno needs a larger window.")
    expect(draw(onHelp, 62, 18).join("\n")).toContain("62 columns, 18 lines")
    const back = draw(onHelp, 80, 24).join("\n")
    expect(back).not.toContain("larger window")
    expect(back).toContain("close help")
  })
})

describe("profile could not be verified (board 'Profile could not be verified')", () => {
  const reason = "The team list in the profile is not the one this machine's key belongs to."
  const state = initialState({ kind: "profile-error", reason, folder: "~/.zekno" }, { columns: 100, rows: 30 })

  test("the board's wording, the reason, where the profile is, and no action but quit", () => {
    const lines = draw(state, 100, 30)
    const text = lines.join("\n")
    expect(text).toContain("✖ This machine's Zekno profile could not be verified.")
    expect(text).toContain("Nothing was signed and nothing was sent to any server.")
    expect(lines.some((line) => line.includes("╭─ What was found ─"))).toBe(true)
    expect(text).toContain(reason)
    expect(lines.map((line) => line.replace(/[│ ]+$/, ""))).toContain("   │ folder   ~/.zekno")
    expect(lines.map((line) => line.replace(/[│ ]+$/, ""))).toContain("   │ file     profile.json")
    const all = words(lines)
    expect(all).toContain(
      "The profile folder is ordinary files. Zekno checks them against your key every time, and stops when they do not match. " +
        "This usually means the folder was changed, synced or restored by something other than zekno."
    )
    expect(text).toContain("If you restored the folder from a backup, restore the matching one.")
    expect(text).toContain("If you did not expect this, do not deploy from this machine until you know why.")
    expect(text).toContain("pre-alpha, unaudited")
    expect(lastLine(lines)).toBe("q quit")
  })

  test("fits 80 by 24 with the longest reason openTeam gives", () => {
    const long = `The profile names a server "${"a".repeat(63)}" that is not in the signed team list.`
    const lines = draw(initialState({ kind: "profile-error", reason: long, folder: "~/.zekno" }, { columns: 80, rows: 24 }), 80, 24)
    fits(lines, 80, 24)
    expect(lastLine(lines)).toBe("q quit")
  })
})

describe("screens a later part builds", () => {
  test("say plainly that they are not built yet, with their place and their board's key hints", () => {
    const lines = draw(home(), 100, 30)
    const text = lines.join("\n")
    expect(text).toContain("Home is not built yet.")
    expect(text).toContain("Ada's team")
    expect(text).toContain("pre-alpha, unaudited")
    expect(lastLine(lines)).toBe("↑↓ move  ←→ pane  enter open  a add  ? help  q quit")

    const adding = draw(after(home(), key("a")), 100, 30)
    expect(adding.join("\n")).toContain("› add a server")
    expect(adding.join("\n")).toContain("Adding a server is not built yet.")
    expect(lastLine(adding)).toBe("o show details  esc cancel")
  })

  test("first run has no wordmark in its header, as on its board", () => {
    const lines = draw(initialState({ kind: "no-team" }, { columns: 80, rows: 24 }), 80, 24)
    expect(lines.join("\n")).not.toContain("▀")
    expect(lines[0]).toMatch(/^ welcome +pre-alpha, unaudited$/)
    expect(lastLine(lines)).toBe("enter create the key  esc quit")
  })

  test("each screen's hints are its board's", () => {
    expect(HINTS.deploy).toEqual([
      ["o", "show Docker's output"],
      ["esc", "back, deploy keeps going"],
    ])
    expect(HINTS.logs.map(([k]) => k)).toEqual(["f", "/", "1-9", "↑↓", "esc"])
    expect(HINTS["set-secret"]).toEqual([
      ["enter", "save"],
      ["esc", "cancel"],
    ])
  })
})

describe("the line above the key hints", () => {
  test("a line about something done elsewhere has its mark", () => {
    const state = after(home(), { type: "notice", notice: { tone: "success", text: "demo is live on prod" } })
    expect(draw(state, 100, 30).join("\n")).toContain("✔ demo is live on prod")
    const failed = after(home(), { type: "failed", notice: { tone: "error", text: "That is not built yet." } })
    expect(draw(failed, 100, 30).join("\n")).toContain("✖ That is not built yet.")
  })

  test("quitting during a deploy says what it waits for", () => {
    const state = after(
      home(),
      { type: "deploy-started", server: "prod", app: "demo", at: 0 },
      { type: "deploy-stage", stage: "checked", sequence: 5, secrets: 0 },
      key("q")
    )
    expect(draw(state, 100, 30).join("\n")).toContain("waiting for deploy 5 to finish")
  })
})

describe("the store", () => {
  test("runs the reducer for each event, tells its listeners, and hands the effects on", () => {
    const run: Effect[] = []
    const store = createStore(home(), (effect) => run.push(effect))
    let told = 0
    const unsubscribe = store.subscribe(() => told++)
    store.dispatch(key("?"))
    store.dispatch(key("q"))
    unsubscribe()
    store.dispatch({ type: "resize", columns: 90, rows: 30 })
    expect(told).toBe(2)
    expect(run).toEqual([{ kind: "exit" }])
    expect(store.get().size).toEqual({ columns: 90, rows: 30 })
  })
})
