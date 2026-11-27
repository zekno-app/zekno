/**
 * The questions before signing a deploy that builds, at a terminal
 * (specs/016-build-from-source, contracts/cli.md CL5, "The questions" and
 * "Kept answers"; FR-015a, FR-015b). Asked after the summary's block and
 * before the SSH session opens, so no session waits on a person:
 *
 * - B24, the first deploy that builds from a folder on this machine, when a
 *   settings file exists (a cloned repository's, say): once for each folder
 *   sent. In a folder with none, the first question's yes counted
 *   (`asking/first-build.ts`; FR-002).
 * - B26, each secret-looking file `source.include` names, once per file, and
 *   `.git` or a path under it once per entry, in its own form (plan item 23).
 *
 * A yes adds its entry to `agreed.json`, and only a yes typed here does: no
 * option writes it, `--yes` among them. No, Esc or Ctrl-C leave with
 * `Nothing was done.`, which a run that made something says as
 * `NOTHING_MORE` (B25, B27; `asking/first-deploy.ts`). With no terminal the
 * rule is the operation's (`ops/deploy-build.ts` `checkAgreed`, C19).
 *
 * The block itself is drawn by the screens of phase 4 (tasks T141), from
 * the plan's facts. No sentence is written here: a question is its line's
 * id until the words tasks (FR-092).
 */
import { Left, NOTHING_DONE } from "../cli/errors"
import { agreedPath } from "../ops/deploy-build"
import type { DeployPlan } from "../ops/deploy"
import { agree } from "../profile/agreed"
import { lineText, type BuildLine } from "../shared/build-lines"
import type { Ui } from "../ui/types"

/** One yes-or-no question by its line; anything but a yes leaves (B25, B27). */
async function yes(ui: Ui, line: BuildLine): Promise<void> {
  if (!(await ui.confirm(lineText(line), NOTHING_DONE, { leave: true })))
    throw new Left()
}

/**
 * Asks B24 and B26 for a deploy that builds, keeping each yes in
 * `agreed.json` under the profile folder `home`. True when a file was agreed
 * to: what is sent changed, so the caller prepares the deploy again and the
 * file is packed. A deploy that builds nothing asks nothing.
 */
export async function askBuildYes(
  ui: Ui,
  home: string,
  plan: Pick<DeployPlan, "server" | "build">
): Promise<boolean> {
  const { build } = plan
  if (build === undefined) return false
  const server = plan.server.name
  for (const folder of build.folders) {
    await yes(ui, { id: "B24", server })
    agree(home, "folders", folder)
  }
  for (const { folder, entry } of build.unagreed) {
    const path = agreedPath(entry)
    await yes(ui, {
      id: "B26",
      server,
      file: build.file,
      path,
      kind: entry.kind,
    })
    agree(home, "files", { folder, path })
  }
  return build.unagreed.length > 0
}
