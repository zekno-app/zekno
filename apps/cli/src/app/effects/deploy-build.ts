/**
 * The full-screen app's part of a deploy that builds
 * (specs/016-build-from-source, design/lines.md part J; choice J-a (a);
 * contracts/cli.md CL5 and CL7; tasks T137), split from deploys.ts, which
 * plans a deploy from the app and asks before it, and deploy-events.ts,
 * which turns it into events:
 *
 * - The plan path reads the chosen file as the single command does
 *   (`readDeploySource`), so `prepareDeploy` prepares the build there too:
 *   the same stops, packs and facts.
 * - `d` in a folder with a Dockerfile and no settings file says J10: its
 *   first deploy is the single command's, which asks the first-time
 *   questions and writes the files (choice J-a (a)).
 * - A deploy that needs B24 or B26 asks it in the panel of "Remember this
 *   folder?" (J12), one at a time in the single command's order; a yes adds
 *   its entry to `agreed.json` as at a terminal, and the deploy is prepared
 *   again, so a file agreed to is packed.
 * - While it runs, the lines of tasks T132 (D4, D5, D6, D17) become the
 *   screen's state, and each of the builder's lines goes to the saved output
 *   (profile/build-output.ts). A failed build ends with its lead (J6) and the
 *   failure for its panel (J7).
 *
 * No sentence is written here: a line is said by its row (FR-092).
 */
import { firstBuildHere } from "../../asking/first-build"
import type {
  DeployCallbacks,
  DeployPlan,
  DeployResult,
} from "../../ops/deploy"
import {
  agreedPath,
  readDeploySource,
  type SourceRead,
} from "../../ops/deploy-build"
import type { BuildCallbacks } from "../../ops/deploy-send-build"
import { agree, type AgreedEntry } from "../../profile/agreed"
import type { DeploySource } from "../../settings/types"
import { lineText, type BuildLine, type LineOf } from "../../shared/build-lines"
import type { BuildFailure } from "../../shared/deploy-build"

/**
 * J10, when `d` is pressed in a folder that is not linked and has a
 * Dockerfile at its top and neither `zekno.app.json` nor `compose.yaml`
 * (CL6, "When"; `asking/first-build.ts`): the single command sets it up.
 */
export const buildFolderHere = (cwd: string): LineOf<"J10"> | undefined =>
  firstBuildHere(cwd) ? { id: "J10" } : undefined

/**
 * Reads the file `d` deploys, once, as `zekno deploy` reads it: a settings
 * file with a built service kept whole, so its build is prepared before the
 * session (CL7 steps 1 to 4); any other as before.
 */
export const readForApp = (
  chosen: DeploySource & { kind: "compose" | "settings" },
  cwd: string
): SourceRead => readDeploySource(chosen, cwd)

/**
 * One first-time question of a deploy that builds (CL5, "The questions";
 * FR-015a, FR-015b), by its line, and the entry a yes keeps in
 * `agreed.json`: B24 for a folder sent no one agreed to here, B26 for a
 * secret-looking entry `source.include` names.
 */
export type BuildQuestion =
  | {
      line: LineOf<"B24">
      agreed: { kind: "folders"; entry: AgreedEntry<"folders"> }
    }
  | {
      line: LineOf<"B26">
      agreed: { kind: "files"; entry: AgreedEntry<"files"> }
    }

/**
 * The next question a planned deploy needs, in the single command's order
 * (`asking/build-yes.ts`): each folder first, then each file. Undefined for a
 * deploy that builds nothing or needs no yes. Each yes is kept, so the next
 * plan of the same deploy asks the next one.
 */
export function nextBuildQuestion(
  plan: Pick<DeployPlan, "server" | "build">
): BuildQuestion | undefined {
  const { build } = plan
  if (build === undefined) return undefined
  const server = plan.server.name
  const folder = build.folders[0]
  if (folder !== undefined)
    return {
      line: { id: "B24", server },
      agreed: { kind: "folders", entry: folder },
    }
  const file = build.unagreed[0]
  if (file === undefined) return undefined
  const path = agreedPath(file.entry)
  return {
    line: { id: "B26", server, file: build.file, path, kind: file.entry.kind },
    agreed: { kind: "files", entry: { folder: file.folder, path } },
  }
}

/** A yes to `question`, kept in `agreed.json` under the profile folder `home`, as at a terminal. Only a yes writes it. */
export function agreeTo(home: string, question: BuildQuestion): void {
  if (question.agreed.kind === "folders")
    agree(home, "folders", question.agreed.entry)
  else agree(home, "files", question.agreed.entry)
}

/** The lines said while a deploy that builds runs (D4, D5, D6, D17), which the screen's state takes in. */
const RUNNING = new Set<BuildLine["id"]>(["D4", "D5", "D6", "D17"])

/**
 * What a deploy from the app adds to its callbacks when it builds: each line
 * said while it runs handed to `running`, any other line (B30, say) to
 * `other`, a warning above the panel (J4); and the builder's lines appended
 * to the saved output under `home`, as at a terminal (CL7 step 13).
 */
export function appBuildCallbacks(
  home: string,
  said: { running(line: BuildLine): unknown; other(line: BuildLine): void }
): Required<Pick<DeployCallbacks, "line">> & BuildCallbacks {
  return {
    line: (line) => {
      if (RUNNING.has(line.id)) said.running(line)
      else said.other(line)
    },
    savedOutput: { home },
  }
}

/** The builder's text a line carries, for the panel of the builder's output (`o`, J5); undefined for any other line. */
export function builderText(line: BuildLine): string | undefined {
  return line.id === "D4" || line.id === "D5" || line.id === "D17"
    ? line.line
    : undefined
}

/**
 * A deploy that ended `build_failed`, as the app says it: its lead, the
 * result line in the error colour (J6), and the failure, for the panel
 * "Docker said" with its rows (J7). Undefined for any other result.
 */
export function failedBuild(
  result: Pick<DeployResult, "outcome" | "build">
): { text: string; failure: BuildFailure } | undefined {
  const failure = result.build?.failure
  if (result.outcome !== "build_failed" || failure === undefined)
    return undefined
  return { text: lineText(failure.lead), failure }
}
