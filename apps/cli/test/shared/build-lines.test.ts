/**
 * The lines of feature 016 by their id (specs/016-build-from-source,
 * contracts/cli.md CL11; plan.md step 1 item 3; FR-092; tasks T104): each
 * id's exit status as CL11's table gives it, a stop and a refused setting
 * holding one line, and, until the words tasks, the id as the text said. No
 * sentence is written or checked here: only ids.
 */
import { describe, expect, test } from "bun:test"

import { CliError, WrongInput } from "../../src/cli/errors"
import {
  BuildStop,
  BuildValueRefused,
  exitStatusOf,
  lineText,
  type BuildLine,
  type BuildLineId,
} from "../../src/shared/build-lines"

/**
 * CL11's table, read row by row from contracts/cli.md, and the ids of
 * design/lines.md each row ends a run with.
 */
const STATUS_ONE = {
  // Every new stop before signing: C1 to C21, step 1's F1, F4 and F5, G43 and G44, and item 23's new stops.
  "a stop before signing": [
    ...["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"],
    ...["C11", "C12", "C13", "C14", "C15", "C16", "C17", "C18", "C19"],
    ...["C20", "C21", "C21a", "C21b", "C21c", "D20"],
    ...["F1", "F4", "F5", "G43", "G44"],
  ],
  // design/lines.md part C: said when the file is read, "Exit status 1, as a fault in the settings".
  "a fault of the settings file": [
    ...["C22", "C23", "C24", "C25", "C26", "C27", "C28", "C29"],
  ],
  // The lead of each reason (E1, E2, E7 to E13; E14 goes, item 23).
  build_failed: [...["E1", "E2", "E7", "E8", "E9", "E10", "E11", "E12", "E13"]],
  // R11 to R14, F11 for `malformed` from a runner below protocol 6, and E15 or E15a once the wait ran out.
  "a runner's refusal": ["R11", "R12", "R13", "R14", "F11", "E15", "E15a"],
  "zekno logs --build with nothing saved": ["E17"],
} as const

/**
 * CL11's status 2: a value `zekno settings set` refuses (G20), and, made as
 * today's refusals of `set` and `unset` are (CS5, CS6 and CS15 are status 2
 * today, `ops/settings.ts`), an unset it refuses (G16, G17) and a setting it
 * does not know (G18, G19).
 */
const STATUS_TWO = ["G16", "G17", "G18", "G19", "G20"] as const

/** Every other id the logic says: notes, warnings, rows, questions, live lines and the parts of a failed build's panel. No exit status of their own. */
const NO_STATUS = [
  ...["A1", "A2", "A3", "A4", "A5", "A5a", "A6", "A7", "A8", "A9", "A10"],
  ...["A12", "A14", "A15", "A18"],
  ...["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11"],
  ...["B12", "B13", "B14", "B16", "B17", "B18", "B20", "B21", "B22", "B23"],
  ...["B24", "B26", "B28", "B30"],
  ...["D2", "D3", "D4", "D5", "D6", "D9", "D12", "D13", "D14", "D15", "D16"],
  ...["D17", "D19"],
  ...["E3", "E4", "E6"],
  ...["G12", "G13", "G22", "G25", "G28", "G29", "G30", "G33", "G34", "G35"],
  ...["G36", "G37", "G38", "G39", "G39a"],
  ...["J10", "J19"],
] as const

const ALL = [
  ...Object.values(STATUS_ONE).flat(),
  ...STATUS_TWO,
  ...NO_STATUS,
] as const

/** True when two unions hold the same members. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Checked by the compiler: the lists above name every id of `BuildLine`, and only those. */
const listsEveryId: Same<(typeof ALL)[number], BuildLineId> = true

/**
 * Rows the union leaves out, each with why: steps 1b and 2 add theirs when
 * they are built; the rows a check settles wait for it (T139, never
 * guessed); rows removed on 2026-11-27; and rows kept as today's lines, said
 * where today's code says them.
 */
const LEFT_OUT = {
  "step 1b": ["B19", "F3", "F4b", "R12b", "G45", "G46", "H4", "H9", "H20"],
  "step 2": ["F2", "G21", "G23", "G24", "G31", "G40", "I1", "I24", "I26"],
  "settled by check L2 or L9 (T139)": ["B15", "F4a", "R12a", "G34a", "E20"],
  removed: ["C30", "E14", "R15"],
  kept: ["A11", "A13", "A16", "A17", "B25", "B27", "D11", "D18", "E5"],
  "kept, of part F and G": ["F6", "F7", "F10", "F12", "F14", "G15", "G27"],
}

describe("CL11: the exit status of each id", () => {
  test("the lists name every id of the union, each once", () => {
    expect(listsEveryId).toBe(true)
    expect(new Set(ALL).size).toBe(ALL.length)
  })

  test.each(Object.entries(STATUS_ONE))("1: %s", (_, ids) => {
    for (const id of ids)
      expect({ id, status: exitStatusOf(id) }).toEqual({ id, status: 1 })
  })

  test("2: a setting `zekno settings set` or `unset` refuses", () => {
    for (const id of STATUS_TWO)
      expect({ id, status: exitStatusOf(id) }).toEqual({ id, status: 2 })
  })

  test("none: a line said while the run goes on, or under a stop", () => {
    for (const id of NO_STATUS)
      expect({ id, status: exitStatusOf(id) }).toEqual({
        id,
        status: undefined,
      })
  })

  test("rows of later steps, of a check not run, removed or kept are not ids of this union", () => {
    const ids = new Set<string>(ALL)
    for (const [why, rows] of Object.entries(LEFT_OUT))
      for (const row of rows)
        expect({ why, row, listed: ids.has(row) }).toEqual({
          why,
          row,
          listed: false,
        })
  })
})

describe("BuildStop and BuildValueRefused: one line each, its id as the message until the words tasks (FR-092)", () => {
  const c1: BuildLine = {
    id: "C1",
    bytes: 734_000_000,
    largest: [
      { folder: "node_modules", bytes: 612_000_000 },
      { folder: ".next", bytes: 98_000_000 },
    ],
  }

  test("BuildStop is a CliError, which `run` ends with exit status 1", () => {
    const stop = new BuildStop(c1)
    expect(stop).toBeInstanceOf(CliError)
    expect(stop).not.toBeInstanceOf(WrongInput)
    expect(stop.line).toBe(c1)
    expect(stop.message).toBe("C1")
  })

  test("F1 with and without the runner's version", () => {
    for (const version of ["0.1.1", undefined]) {
      const stop = new BuildStop({ id: "F1", server: "prod-1", version })
      expect(stop.message).toBe("F1")
      expect(stop.line).toEqual({ id: "F1", server: "prod-1", version })
    }
  })

  test("BuildValueRefused is a WrongInput, which `run` ends with exit status 2, without the help line", () => {
    const refused = new BuildValueRefused({ id: "G20", refused: "builder" })
    expect(refused).toBeInstanceOf(WrongInput)
    expect(refused).not.toBeInstanceOf(CliError)
    expect(refused.line).toEqual({ id: "G20", refused: "builder" })
    expect(refused.message).toBe("G20")
  })

  test("only a line of status 1 makes a BuildStop, and only one of status 2 a BuildValueRefused (checked by the compiler)", () => {
    const waiting = {
      id: "D19",
      server: "prod-1",
      app: "blog",
      seconds: 240,
      limit: 1800,
    } as const
    const made = [
      // @ts-expect-error: D19 is said while zekno waits, not to stop.
      () => new BuildStop(waiting),
      // @ts-expect-error: G20 is a refused value, status 2.
      () => new BuildStop({ id: "G20", refused: "stage" }),
      // @ts-expect-error: C1 is a stop, status 1.
      () => new BuildValueRefused(c1),
    ]
    expect(made).toHaveLength(3)
  })
})

describe("lineText: what a line says until the words tasks", () => {
  test("its id, and none of its values", () => {
    const line: BuildLine = {
      id: "D19",
      server: "prod-1",
      app: "blog",
      seconds: 240,
      limit: 1800,
    }
    expect(lineText(line)).toBe("D19")
    expect(lineText({ id: "B13" })).toBe("B13")
    expect(
      lineText({ id: "R14", server: "prod-1", free: 1_400_000_000, floor: 2e9 })
    ).toBe("R14")
  })
})
