/**
 * The lines of feature 016 that zekno's logic says, by their row in
 * specs/016-build-from-source/design/lines.md, each with the values its
 * sentence needs (plan.md step 1 item 3; tasks T104). No sentence is written
 * here: until the words tasks, the text of a line is its id (FR-092), so a
 * logic test checks which line is said, never its words.
 *
 * A stop is a `BuildStop` (exit status 1) and a setting `zekno settings set`
 * or `unset` refuses is a `BuildValueRefused` (exit status 2), as CL11's
 * table gives them (contracts/cli.md CL11, CL1).
 *
 * Left out, each to be added beside its part by the task that needs it:
 * rows of steps 1b and 2 (parts H and I, B19, F2, F3, F4b, R12b, G21, G23,
 * G24, G31, G40, G45, G46); rows a check settles (B15, F4a, R12a, G34a, E20:
 * T139, after L2 and L9); rows removed on 2026-11-27 (C30, E14, R15); rows
 * kept as today's lines, said where today's code says them; and a line's
 * plain form, which is the same line with no terminal (B29, D10, E18, G32,
 * G42). The stage row's labels (D1, D7, D8's time) and the settings' row
 * labels (G1 to G11, G14, J13 to J18) are drawn by the screens from the
 * deploy's stage and the settings.
 */
import type { Arch, BuildReason, BuildRecord } from "@workspace/core"

import { CliError, WrongInput } from "../cli/errors"

/** A line with no value: its sentence is fixed. */
type Fixed = Record<never, never>

/** A top-level folder of the folder sent, with the bytes it holds (B4, B12, C1). */
export type FolderBytes = { folder: string; bytes: number }

/** Services built from one recipe, which share one build (B9, B28, D12). */
export type BuildGroup = { services: string[]; dockerfile: string }

/** Why a path was left out of the pack (B5; contracts/cli.md CL2, "Entries"). */
export type LeftOutRule =
  "ignore_file" | "zekno" | "secret_looking" | "link" | "not_a_file"

/** What a secret-looking file looks like it holds (B8, B26, E7; CL2, "The secret-looking list"). */
export type SecretKind = "private_key" | "secrets"

/** The failed build's lead, as each line of part E names it: `running` is the deploy the app still runs, null when none runs yet. */
type Failed = {
  service: string
  server: string
  app: string
  running: number | null
}

/**
 * Each id and its values. Names: `server`, `app` and `service` as they
 * passed their rule; `deploy`, `running`, `signed` deploy numbers; `file`
 * the settings file or the Compose file as zekno shows it; `path` a path in
 * the folder sent, `/` between folders; sizes in bytes; times and limits in
 * seconds, as the runner gives them.
 */
interface BuildLineValues {
  // A. The first deploy in a folder with a Dockerfile (contracts/cli.md CL6).
  A1: Fixed
  A2: Fixed
  A3: Fixed
  A4: { service: string; port: number }
  /** The lines of the proposed `.dockerignore`. */
  A5: { lines: string[] }
  A5a: { path: string }
  A6: Fixed
  /** `ignore`: the answer also writes a `.dockerignore` (A7, A12, A18, G25). */
  A7: { ignore: boolean }
  A8: { port: number }
  A9: Fixed
  A10: { port: number | null }
  A12: { ignore: boolean }
  A14: { dockerfiles: { path: string; port: number | null }[] }
  A15: { dockerfile: string }
  A18: { ignore: boolean }

  // B. The summary before signing (CL5).
  B1: { server: string }
  /** `root` as shown from the settings file's folder; `top`: it is the top of the git repository. */
  B2: { server: string; root: string; top: boolean }
  B3: { files: number; bytes: number }
  B4: { largest: FolderBytes[] }
  /** `ignoreFile`: the ignore file in use, null when there is none. */
  B5: {
    groups: { rule: LeftOutRule; paths: string[] }[]
    ignoreFile: string | null
  }
  B6: { file: string; paths: string[] }
  B7: { path: string }
  B8: { path: string; service: string; kind: SecretKind }
  B9: { builds: BuildGroup[] }
  /** The plain variables each build reads, names only (FR-072b). */
  B10: { reads: { service: string; names: string[] }[] }
  B11: { service: string; port: number }
  B12: { bytes: number; largest: FolderBytes[] }
  B13: Fixed
  /** One line for each base image named without a digest. */
  B14: { service: string; image: string }
  B16: { service: string; name: string }
  B17: { service: string; name: string }
  B18: { service: string; name: string; app: string }
  /** The names that reach only the running app. */
  B20: { service: string; names: string[] }
  B21: Fixed
  B22: { service: string }
  B23: { service: string; name: string }
  B24: { server: string }
  B26: { server: string; file: string; path: string; kind: SecretKind | "git" }
  B28: { builds: BuildGroup[]; files: number; bytes: number }
  /** `reported`: the fresh build the server reports, null when none; `signed`: the one from this machine's history. */
  B30: {
    server: string
    service: string
    reported: number | null
    signed: number
  }

  // C. Stops before signing (CL7 steps 1 to 4).
  C1: { bytes: number; largest: FolderBytes[] }
  C2: { entries: number; largest: { folder: string; entries: number }[] }
  C3: Fixed
  C4: Fixed
  C5: { path: string }
  C6: { path: string }
  C7: { path: string; why: "not_utf8" | "control_character" | "too_long" }
  C8: { file: string; service: string }
  C9: { file: string; image: string }
  C10: { service: string; image: string }
  /** `instruction` as written, and the variable to give a default, null when the form has none. */
  C11: {
    service: string
    instruction: string
    line: number
    variable: string | null
  }
  C12: { service: string; url: string; line: number }
  C13: { service: string; url: string; line: number }
  C14: { service: string; count: number }
  C15: { service: string; name: string; bytes: number }
  C16: { app: string; bytes: number }
  C17: { app: string; count: number }
  C18: { service: string; stage: string; stages: string[] }
  C19: { file: string; path: string }
  C20: { file: string; service: string; dockerfile: string; folder: string }
  C21: { app: string }
  C21a: { file: string; service: string; dockerfiles: string[] }
  C21b: {
    service: string
    folder: string
    relation: "is" | "holds"
    whose: "home" | "zekno"
  }
  C21c: { app: string }
  /** `repository`: the settings file is in a git repository. */
  C22: { file: string; service: string; repository: boolean }
  C23: { file: string; service: string }
  C24: { file: string; service: string }
  C25: { file: string; service: string }
  C26: { file: string; service: string }
  C27: { file: string; service: string }
  C28: { file: string; service: string }
  C29: { file: string; service: string }

  // The runner's refusals (CL7, "The answer"; core.md CO10).
  R11: Fixed
  R12: Fixed
  R13: Fixed
  /** The free disk and the floor the runner reports. */
  R14: { server: string; free: number; floor: number }

  // D. The deploy while it runs (CL7 steps 12 and 13).
  /** Bytes sent of the total. */
  D2: { sent: number; total: number }
  D3: { server: string; sent: number; total: number }
  /** The builder's latest line, already cleaned. */
  D4: { line: string }
  D5: { service: string; line: string }
  D6: { service: string; deploy: number }
  D9: { service: string; port: number; server: string }
  D12: { builds: BuildGroup[] }
  D13: { service: string }
  D14: Fixed
  D15: { server: string; service: string; deploy: number }
  D16: { server: string; service: string; deploy: number }
  /** One builder's line on standard error, already cleaned. */
  D17: { line: string }
  /** `seconds` since the other app's build started and its `limit`, as `busy` carries them. */
  D19: { server: string; app: string; seconds: number; limit: number }
  D20: { server: string }

  // E. A failed build (CL7, "The answer").
  E1: Failed & { running: number }
  E2: Omit<Failed, "running">
  /** The failing step and its error from `build_error`, cleaned, and the builder's last lines. */
  E3: { step: string; error: string; lines: string[] }
  E4: { shown: number; total: number }
  E6: Fixed
  /** A `COPY` or `ADD` of a file zekno's own rule left out. */
  E7: Failed & { path: string; kind: SecretKind }
  E8: Failed
  /** The build's time limit, in seconds. */
  E9: Failed & { limit: number }
  E10: Failed
  E11: Failed & { image: Arch; host: Arch }
  E12: Failed
  /** The team list's version, the signer, and the deploy that was not started. */
  E13: Failed & { team: number; signer: string; deploy: number }
  E15: { server: string; app: string; seconds: number; limit: number }
  E15a: { server: string; app: string; phase: "stopping" | "starting" }
  E17: { app: string }

  // F. What old and new programs say (CL13).
  /** `version`: the runner's, undefined for a runner that does not speak sessions. */
  F1: { server: string; version: string | undefined }
  /** The engine's version, as `builder` reports it. */
  F4: { server: string; engine: string }
  F5: { file: string; service: string }
  F11: Fixed

  // G. Settings, status, doctor and rollback (CL1, CL8, CL9).
  G12: { service: string; image: string; dockerfile: string }
  G13: { service: string; dockerfile: string; image: string }
  G16: { service: string }
  G17: { service: string }
  G18: Fixed
  G19: Fixed
  /** The setting whose value is refused; `railpack`, the builder a zekno of step 1 does not know; `image`, a name under `zekno.invalid`. */
  G20: {
    refused:
      | "builder"
      | "railpack"
      | "dockerfile"
      | "stage"
      | "build-timeout"
      | "build-network"
      | "root"
      | "image"
  }
  /** `made`: from the code packed here, or at deploy since the server reports a fresh build. */
  G22: { service: string; server: string; made: "from_code" | "fresh" }
  G25: { ignore: boolean }
  /** `built`: the record's time. */
  G28: { service: string; built: string; builder: "dockerfile" }
  G29: { server: string; record: BuildRecord }
  /** How the latest build ended; `dropped`, a connection this machine lost. */
  G30: { deploy: number; ended: BuildReason | "dropped" }
  G33: { engine: string; arch: Arch }
  G34: { server: string; engine: string }
  G35: { server: string }
  G36: { server: string; version: string }
  /** What images and the build cache take. */
  G37: { bytes: number }
  G38: { server: string; free: number; floor: number }
  G39: { server: string; memory: number }
  /** The build records that still run after their build was stopped (`stale`). */
  G39a: { count: number }
  /** `found`: by the runner (`pack_missing`), or before signing (`builds` with `check`). */
  G43: { server: string; deploy: number; found: "runner" | "before_signing" }
  G44: { server: string; deploy: number; found: "runner" | "before_signing" }

  // J. The full-screen app.
  J10: Fixed
  J19: Fixed
}

/** The id of a row of design/lines.md that the logic says. */
export type BuildLineId = keyof BuildLineValues

/** One line: its id and the values its sentence needs. */
export type BuildLine = {
  [Id in BuildLineId]: { id: Id } & BuildLineValues[Id]
}[BuildLineId]

/** The line of one id. */
export type LineOf<Id extends BuildLineId> = Extract<BuildLine, { id: Id }>

/** CL11's status 1: ids that end a run. */
const STOPS = [
  // Every new stop before signing, and item 23's new stops (C21a to C21c, D20).
  ...["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"],
  ...["C12", "C13", "C14", "C15", "C16", "C17", "C18", "C19", "C20"],
  ...["C21", "C21a", "C21b", "C21c", "D20", "F1", "F4", "F5", "G43", "G44"],
  // A fault of the settings file, said when it is read (lines.md part C).
  ...["C22", "C23", "C24", "C25", "C26", "C27", "C28", "C29"],
  // `build_failed`: the lead of each reason.
  ...["E1", "E2", "E7", "E8", "E9", "E10", "E11", "E12", "E13"],
  // A runner's refusal, a `busy` whose wait ran out among them.
  ...["R11", "R12", "R13", "R14", "F11", "E15", "E15a"],
  // `zekno logs --build` with nothing saved.
  "E17",
] as const satisfies readonly BuildLineId[]

/**
 * CL11's status 2: a value `zekno settings set` refuses (G20), and, made as
 * today's refusals of `set` and `unset` are (CS5, CS6, CS15), an unset it
 * refuses and a setting it does not know.
 */
const REFUSED_SETTINGS = [
  "G16",
  "G17",
  "G18",
  "G19",
  "G20",
] as const satisfies readonly BuildLineId[]

/** The ids a `BuildStop` holds. */
export type StopId = (typeof STOPS)[number]
/** The ids a `BuildValueRefused` holds. */
export type RefusedSettingId = (typeof REFUSED_SETTINGS)[number]

/** The exit status a line ends a run with (CL11), undefined for a line said while the run goes on or under a stop. */
export function exitStatusOf(id: BuildLineId): 1 | 2 | undefined {
  if ((STOPS as readonly string[]).includes(id)) return 1
  if ((REFUSED_SETTINGS as readonly string[]).includes(id)) return 2
  return undefined
}

/** What a line says. Until the words tasks, its id: no sentence is written in a logic task (FR-092). */
export function lineText(line: BuildLine): string {
  return line.id
}

/** A stop that ends the run with exit status 1, holding the line said (CL11). */
export class BuildStop extends CliError {
  constructor(readonly line: LineOf<StopId>) {
    super(lineText(line))
  }
}

/**
 * A setting `zekno settings set` or `unset` refuses: exit status 2, said
 * without the help line, as today's value refusals are (`WrongInput`; CL1,
 * CL11).
 */
export class BuildValueRefused extends WrongInput {
  constructor(readonly line: LineOf<RefusedSettingId>) {
    super(lineText(line))
  }
}
