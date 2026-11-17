/**
 * `zekno add <template>` (specs/012-templates, contracts/commands.md; boards
 * `AddTemplate` and `AddOther`): what it shows and asks. What it reads and
 * checks is ops/add.ts, what it writes ops/add-commit.ts, its words
 * templates/add-words.ts. It contacts no server and no network, deploys
 * nothing and signs no deploy (FR-010, SC-005).
 *
 * The order (contracts/commands.md, "The order of checks"): the template and
 * `--name`, then a server to seal for (AD1), before anything is asked or any
 * file is read; then the file, the app and the server (asked for at a
 * terminal only now), the store and the addition; who reads each connection
 * secret (AD10 at a terminal, AD12 without one); the summary; AD3, `--yes`
 * or AD4; then adding, whole or not at all.
 */
import type { Deps } from "../cli/context"
import { Left, UsageError, WrongInput } from "../cli/errors"
import {
  checkTemplate,
  hasServer,
  prepareAdd,
  summaryOf,
  withReaders,
  type AddPlan,
  type AddQuestion,
} from "../ops/add"
import { commitAdd } from "../ops/add-commit"
import type { Where } from "../ops/deploy"
import {
  AD10,
  AD11,
  AD12,
  AD22,
  AD3,
  AD4,
  AU1,
  READ_BY,
} from "../templates/add-words"
import { quiet } from "../ui/types"

/** What `zekno add` was given: the template's name, `--name`, `--for`, `--yes`, and how to find the app and the server. */
export type AddInput = {
  template: string | undefined
  name: string | undefined
  for: readonly string[] | undefined
  yes: boolean
  /** The flags, the folder's link, then at a terminal a question for each detail still missing; called once the file was read. */
  details: () => Promise<Where>
}

/** AD22, dim from column 0 (board `AddTemplate`): a no, Esc or Ctrl-C at `zekno add`'s own questions. Status 1. */
function nothingAdded(deps: Deps): number {
  deps.ui.line(undefined, [quiet(AD22)])
  return 1
}

/**
 * Who reads each connection secret, when the file has several services and
 * no `--for` said it: at a terminal AD10 for each, in the template's order;
 * with no terminal AD12 (it does not guess). Undefined when the person left
 * a question.
 */
async function askReaders(
  deps: Deps,
  question: AddQuestion
): Promise<AddPlan | undefined> {
  const file = question.target.read.shown
  const answers = new Map<string, readonly string[]>()
  for (const { offer, services } of question.ask) {
    const noTerminal = new WrongInput(AD12(file, offer))
    if (!deps.ui.asks) throw noTerminal
    try {
      answers.set(
        offer,
        await deps.ui.chooseSeveral({
          question: AD10(offer),
          rows: services.map((service) => ({ value: service, label: service })),
          collapsed: READ_BY,
          atLeastOne: AD11,
          missing: noTerminal,
        })
      )
    } catch (error) {
      if (error instanceof Left) return undefined
      throw error
    }
  }
  return withReaders(question, answers)
}

/**
 * `zekno add <template> [--name <service>] [--for <service>] [--app <app>]
 * [--server <name>] [--yes]`: the template's services written into the
 * settings file a deploy here would sign, and its secrets made here, sealed
 * and stored, whole or not at all. Status 0 once added; 1 for a no (AD22);
 * a refusal throws its sentence.
 */
export async function add(deps: Deps, input: AddInput): Promise<number> {
  if (input.template === undefined) throw new UsageError(AU1)
  const template = checkTemplate(input.template, input.name)
  hasServer(deps)
  const prepared = await prepareAdd(deps, {
    template,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.for === undefined ? {} : { for: input.for }),
    where: input.details,
  })
  const plan =
    "addition" in prepared ? prepared : await askReaders(deps, prepared)
  if (plan === undefined) return nothingAdded(deps)
  deps.ui.addition(summaryOf(plan))
  if (
    !input.yes &&
    !(await deps.ui.confirm(
      AD3(plan.addition.service, plan.app),
      AD4(plan.target.read.shown)
    ))
  )
    return nothingAdded(deps)
  deps.ui.added(await commitAdd(plan))
  return 0
}
