/**
 * `zekno add <template>` (specs/012-templates, contracts/commands.md; boards
 * `AddTemplate`, `AddLook` and `AddOther`): what it shows and asks. What it
 * reads and checks is ops/add.ts, what it writes ops/add-commit.ts, its
 * words templates/add-words.ts. It contacts no server and no network, deploys
 * nothing and signs no deploy (FR-010, SC-005).
 *
 * The order (contracts/commands.md, "The order of checks"): the words and
 * the options (AU1 to AU6); `--list` and `--show`, which read only the
 * catalogue and end there; the template and `--name`, then a server to seal
 * for (AD1), before anything is asked or any file is read; the picker, when
 * no template was named, at a terminal; then the file, the app and the
 * server (asked for at a terminal only now), the store and the addition; who
 * reads each connection secret (AD10 at a terminal, AD12 without one); the
 * summary; AD3, `--yes` or AD4; then adding, whole or not at all. Where the
 * deploy here uses a Compose file written by hand: the lines to add, never
 * written into it; AH6, `--yes` or AH8; then the secrets stored.
 */
import type { Deps } from "../cli/context"
import { Left, UsageError, WrongInput } from "../cli/errors"
import {
  checkName,
  checkTemplate,
  hasServer,
  isHand,
  linesOf,
  prepareAdd,
  storedNames,
  summaryOf,
  withReaders,
  type AddPlan,
  type AddQuestion,
  type HandPlan,
} from "../ops/add"
import { commitAdd, commitHand } from "../ops/add-commit"
import type { Where } from "../ops/deploy"
import {
  AD10,
  AD11,
  AD12,
  AD22,
  AD3,
  AD4,
  AH6,
  AH8,
  AH9,
  AL1,
  AL2,
  AU1,
  AU2,
  AU3,
  AU4,
  AU5,
  AU6,
  READ_BY,
} from "../templates/add-words"
import { catalogue } from "../templates/catalogue"
import {
  listObject,
  templateObject,
  templateRows,
  templateView,
} from "../templates/shown"
import type { Template } from "../templates/types"
import { quiet } from "../ui/types"

/** The options `zekno add` takes; any other given to it is refused (contracts/commands.md, AU7). */
export const ADD_OPTIONS: readonly string[] = [
  "name",
  "for",
  "app",
  "server",
  "yes",
  "json",
  "list",
  "show",
]

/** The options `--list` and `--show` take beside themselves (AU6). */
const LOOKING_TAKES = ["list", "show", "json"]

/** What `zekno add` was given: the template's name, the options, and how to find the app and the server. */
export type AddInput = {
  template: string | undefined
  name: string | undefined
  for: readonly string[] | undefined
  yes: boolean
  /**
   * Every option given, as the arguments were read: one key for each, in
   * the order given (AU6 names the first `--list` or `--show` does not
   * take), with `--list`, `--show` and `--json` among them.
   */
  options?: { list?: boolean; show?: boolean; json?: boolean; app?: string }
  /** The flags, the folder's link, then at a terminal a question for each detail still missing; called once the file was read. */
  details: () => Promise<Where>
}

/**
 * Step 1 of contracts/commands.md, "The order of checks": the words and the
 * options, each refusal with the help line (status 2). `--list` and `--show`
 * not both (AU4); `--list` with no template (AU2); `--show` with one (AU3);
 * neither with an option of adding (AU6); `--json` with one of them only
 * (AU5); and no template with no terminal to pick one on (AU1).
 */
function checkUsage(input: AddInput, asks: boolean): void {
  const { list, show, json } = input.options ?? {}
  const looking = list ? "list" : show ? "show" : undefined
  if (list && show) throw new UsageError(AU4)
  if (list && input.template !== undefined) throw new UsageError(AU2)
  if (show && input.template === undefined) throw new UsageError(AU3)
  const other = Object.keys(input.options ?? {}).find(
    (option) => !LOOKING_TAKES.includes(option)
  )
  if (looking !== undefined && other !== undefined)
    throw new UsageError(AU6(looking, other))
  if (looking === undefined && json) throw new UsageError(AU5)
  if (looking === undefined && input.template === undefined && !asks)
    throw new UsageError(AU1)
}

/** AD22, dim from column 0 (board `AddTemplate`): a no, Esc or Ctrl-C at `zekno add`'s own questions. Status 1. */
function nothingAdded(deps: Deps): number {
  deps.ui.line(undefined, [quiet(AD22)])
  return 1
}

/**
 * Step 2: `--list` and `--show` (FR-013; board `AddLook`), from the
 * catalogue alone: no team, keychain, profile, file, server or network. With
 * `--json`, one object (D18). `--show` of a name that is no template's says
 * AL3 or AL4, as adding it would. Status 0; nothing is changed.
 */
function look(deps: Deps, input: AddInput): number {
  const json = input.options?.json === true
  if (input.options?.list) {
    const list = catalogue()
    if (json) deps.ui.json(listObject(list))
    else deps.ui.templateList(templateRows(list))
    return 0
  }
  const template = checkTemplate(input.template!, undefined)
  if (json) deps.ui.json(templateObject(template))
  else deps.ui.templateView(templateView(template))
  return 0
}

/**
 * Step 5: the picker, at a terminal, when no template was named (board
 * `AddLook`, left column; D12): the catalogue's rows, the middle column
 * `<title> <software>`, the about dim; it leaves `✔ Template  <name>`. Then
 * AD28 and AU9 for the one picked. Undefined when the person left it.
 */
async function pick(
  deps: Deps,
  nameFlag: string | undefined
): Promise<Template | undefined> {
  let name: string
  try {
    name = await deps.ui.choose({
      question: AL1,
      rows: templateRows(catalogue()).map((row) => ({
        value: row.name,
        label: row.name,
        column: `${row.title} ${row.software}`,
        detail: row.about,
      })),
      collapsed: AL2,
      missing: new UsageError(AU1),
    })
  } catch (error) {
    if (error instanceof Left) return undefined
    throw error
  }
  return checkTemplate(name, nameFlag)
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
 * A Compose file written by hand (contracts/commands.md, "A hand-written
 * Compose file"; board `AddOther`, left column; D17): the lines to add,
 * which zekno never writes into it; then AH6 at a terminal, `--yes`, or AH8
 * with no terminal (status 1, after the lines); a no, Esc or Ctrl-C is AH9,
 * dim, status 1, no secret made; then the secrets made and stored (steps b,
 * c and e) and what was stored.
 */
async function byHand(
  deps: Deps,
  plan: HandPlan,
  yes: boolean
): Promise<number> {
  deps.ui.handLines(linesOf(plan))
  const count = storedNames(plan.template).length
  if (
    !yes &&
    !(await deps.ui.confirm(AH6(count, plan.app, plan.server.name), AH8))
  ) {
    deps.ui.line(undefined, [quiet(AH9)])
    return 1
  }
  deps.ui.added(await commitHand(plan))
  return 0
}

/**
 * `zekno add [<template>] [--name <service>] [--for <service>] [--app <app>]
 * [--server <name>] [--yes]`, `zekno add --list [--json]` and `zekno add
 * <template> --show [--json]`: the template's services written into the
 * settings file a deploy here would sign, and its secrets made here, sealed
 * and stored, whole or not at all; or, for a Compose file written by hand,
 * the lines to add and its secrets stored; or the templates this zekno
 * carries, or what one would add. Status 0 once added, listed or shown; 1
 * for a no (AD22, AH9); a refusal throws its sentence.
 */
export async function add(deps: Deps, input: AddInput): Promise<number> {
  checkUsage(input, deps.ui.asks)
  if (input.options?.list || input.options?.show) return look(deps, input)
  if (input.template === undefined) checkName(undefined, input.name)
  const named =
    input.template === undefined
      ? undefined
      : checkTemplate(input.template, input.name)
  hasServer(deps)
  const template = named ?? (await pick(deps, input.name))
  if (template === undefined) return nothingAdded(deps)
  const prepared = await prepareAdd(deps, {
    template,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.for === undefined ? {} : { for: input.for }),
    // `--app` decides the file as the deploy decides it, before any question (security review T2).
    ...(input.options?.app === undefined ? {} : { app: input.options.app }),
    where: input.details,
  })
  if (isHand(prepared)) return byHand(deps, prepared, input.yes)
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
