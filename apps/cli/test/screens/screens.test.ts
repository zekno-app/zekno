/**
 * The screens in step (specs/013-docs-refresh, contracts/screens.md, "The
 * tests"; tasks T012): every stored screen is what the program draws now,
 * the README's picture is what home.json gives, and no stored screen holds
 * anything of the machine it was drawn on. The check runs as `bun run
 * screens --check` does, in a process of its own.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { hostname, tmpdir, userInfo } from "node:os"
import { join } from "node:path"

import { PLACES, recipeNames } from "./capture"
import { readScreen } from "./format"
import { svgOf } from "./svg"

/** Every stored screen's name. */
const stored = () =>
  readdirSync(PLACES.screens)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .sort()

const text = (name: string) =>
  readFileSync(join(PLACES.screens, `${name}.json`), "utf8")

describe("the stored screens", () => {
  test("every screen drawn now is the screen stored; a drifted one is named with its first differing row", () => {
    const run = Bun.spawnSync(
      [process.execPath, join(import.meta.dir, "capture.ts"), "--check"],
      { stdout: "pipe", stderr: "pipe" }
    )
    // Each line that is not "in step", with the rows under it that say where it differs.
    const drifted: string[] = []
    let naming = false
    for (const line of run.stdout.toString().split("\n")) {
      if (/^\S/.test(line)) naming = !line.endsWith("  in step")
      if (naming && line.trim() !== "") drifted.push(line)
    }
    expect({ drifted, stderr: run.stderr.toString() }).toEqual({
      drifted: [],
      stderr: "",
    })
    expect(run.exitCode).toBe(0)
  }, 300_000)

  test("the README's picture is what home.json gives", () => {
    expect(existsSync(PLACES.svg)).toBe(true)
    expect(readFileSync(PLACES.svg, "utf8")).toBe(
      svgOf(readScreen(text("home")))
    )
  })

  test("each recipe has its stored screen, and each stored screen its recipe; the four required are there", () => {
    expect(stored()).toEqual(recipeNames())
    for (const name of [
      "first-deploy",
      "home",
      "settings-screen",
      "add-postgres",
    ])
      expect(stored()).toContain(name)
  })

  test("no stored screen holds a path, a user name or a host name of this machine", () => {
    // A user or host name of three letters or fewer could be part of any word.
    const named = [userInfo().username, hostname()].filter(
      (name) => name.length > 3
    )
    const marks = [
      tmpdir(),
      "/tmp/",
      "/root",
      "/home/",
      "/Users/",
      "/var/folders",
      "zekno-home-",
      "zekno-project",
      ...named,
    ]
    for (const name of stored())
      for (const mark of marks)
        expect({ name, mark, found: text(name).includes(mark) }).toEqual({
          name,
          mark,
          found: false,
        })
  })

  test("the picture holds its description, and no script, web font or outside file", () => {
    const svg = readFileSync(PLACES.svg, "utf8")
    expect(svg).toContain(`<title id="screen-title">`)
    expect(svg).not.toMatch(/<script|@import|@font-face|href=|url\(/i)
  })
})
