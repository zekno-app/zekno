/**
 * The questions the app asks with a few fixed answers (board "Two questions
 * the app asks"): their answers and keys, their words, and what each answer
 * does. While one is open its keys answer it and nothing else does.
 */
import { applyConfirmKey, type Choice } from "../../ui/parts/confirm"
import type { AppKey } from "../keys"
import type { EventOf, Step } from "./events"
import { inputOf } from "./input"
import { hiddenPromptOpen, textQuestionOpen, top } from "./reading"
import { go, pop, quit, stay } from "./steps"
import type { Question, State } from "./types"

/**
 * The answers to each question and their keys. The boards give the words for
 * the two before `deploy-elsewhere`, whose words the maintainer approved on
 * 2026-11-14 (contracts/app.md, "Deploy from the app"). Those of `use-link`
 * are the plan's for the signed link, decided by the maintainer the same day
 * (contracts/app.md, "A zekno.json signed by the team").
 */
/**
 * The answers of "deploy without them?", which a first-time yes of a deploy
 * that builds takes too (specs/016-build-from-source, J12): only `y` goes
 * on, and nothing is deployed otherwise.
 */
const DEPLOY_OR_NOT = [
  { key: "y", answer: "yes", does: "deploy" },
  { key: "n", answer: "no", does: "do not deploy" },
] as const satisfies readonly Choice<string>[]

export const CHOICES = {
  "remove-secret": [
    { key: "enter", answer: "yes", does: "remove it" },
    { key: "esc", answer: "no", does: "cancel" },
  ],
  "update-runner": [
    { key: "u", answer: "yes", does: "update now" },
    { key: "esc", answer: "no", does: "later" },
  ],
  "remember-folder": [
    { key: "enter", answer: "yes", does: "write it and deploy" },
    { key: "n", answer: "skip", does: "deploy without it" },
    { key: "esc", answer: "no", does: "cancel" },
  ],
  // Esc answers no as well (`onQuestion`): it never deploys.
  "skip-values": DEPLOY_OR_NOT,
  // Esc answers no as well: only `y` agrees, and a no deploys nothing (B25).
  "build-yes": DEPLOY_OR_NOT,
  // Esc answers no as well, and enter answers nothing: only `y` deploys. The screen names the app after "deploy to" (`elsewhereChoices`).
  "deploy-elsewhere": [
    { key: "y", answer: "yes", does: "deploy to" },
    { key: "n", answer: "no", does: "do not deploy" },
  ],
  // Esc answers no as well, and enter answers nothing: only `y` uses the file.
  "use-link": [
    { key: "y", answer: "yes", does: "use it" },
    { key: "n", answer: "no", does: "not now" },
  ],
} as const satisfies Record<Question["kind"], readonly Choice<string>[]>

/**
 * The words of "use this zekno.json here?", asked when the app opens. A file
 * in a folder above is named with its folder and its Compose file: a "yes"
 * deploys that Compose file, not the one in the folder the app was started in.
 * A file in this folder that names another file than compose.yaml is named
 * with that file, in the words of the single commands' question
 * (`useQuestion`; specs/010-app-settings, security review S6).
 */
export function useLinkWords(
  question: Extract<Question, { kind: "use-link" }>
): { title: string; body: string } {
  const { member, app, server, above, file } = question
  const named = file === undefined ? "" : `, with ${file}`
  return {
    title: above
      ? `${member} linked ${above.folder} to ${app} on ${server}, with ${above.compose}`
      : `${member} linked this folder to ${app} on ${server}${named}`,
    body: "The link is signed by your team. It has not been used in this folder on this machine. Use it here?",
  }
}

/** Said when a deploy that waited on a question was not made. */
export const NOT_DEPLOYED = "Nothing was deployed."

/** The question esc on that list asks: deploy without the values not set yet? */
export function skipValuesTitle(
  question: Extract<Question, { kind: "skip-values" }>
): string {
  const without =
    question.names.length === 1
      ? question.names[0]!
      : `${question.names.length} values`
  return `Deploy ${question.app} to ${question.server} without ${without}?`
}

type ElsewhereQuestion = Extract<Question, { kind: "deploy-elsewhere" }>

/** The answers to "deploy this folder elsewhere?", the first naming the app it would replace. */
export function elsewhereChoices(
  question: ElsewhereQuestion
): Choice<string>[] {
  return CHOICES["deploy-elsewhere"].map((choice) =>
    choice.answer === "yes"
      ? { ...choice, does: `deploy to ${question.app}` }
      : choice
  )
}

/**
 * The words of "deploy this folder elsewhere?": its title names the link,
 * its lines the selected app, and its server too when that is not the link's.
 */
export function elsewhereWords(question: ElsewhereQuestion): {
  title: string
  asked: string
  replaces: string
} {
  const target =
    question.server === question.linked.server
      ? question.app
      : `${question.app} on ${question.server}`
  return {
    title: `This folder is linked to ${question.linked.app} on ${question.linked.server}`,
    asked: `You selected ${target}. Deploy this folder to ${target}?`,
    replaces: `It replaces what ${question.app} runs now.`,
  }
}

/** An open question with fixed answers: its keys answer it, Ctrl-C quits, anything else is ignored. */
export function onQuestion(
  state: State,
  question: Question,
  key: AppKey
): Step {
  if (key.kind === "ctrl-c") return quit(state)
  const [input, flags] = inputOf(key)
  // Where esc is not one of the answers, it is no: none of these questions deploys, or uses a file, on it.
  const escapeIsNo =
    (question.kind === "skip-values" ||
      question.kind === "deploy-elsewhere" ||
      question.kind === "use-link" ||
      question.kind === "build-yes") &&
    flags.escape
  const answer =
    applyConfirmKey<string>(CHOICES[question.kind], input, flags) ??
    (escapeIsNo ? "no" : undefined)
  if (answer === undefined) return stay(state)
  const closed = { ...state, question: undefined }
  if (question.kind === "skip-values")
    return skipValues(closed, question, answer === "yes")
  if (question.kind === "deploy-elsewhere" || question.kind === "build-yes") {
    if (answer !== "yes")
      return stay({ ...closed, notice: { tone: "info", text: NOT_DEPLOYED } })
    return go(closed, {
      kind: "deploy-continue",
      server: question.server,
      app: question.app,
      answer: question.kind === "build-yes" ? "build-yes" : "deploy-elsewhere",
    })
  }
  // No leaves the file unused while the app is open, and says nothing: `d` says so if it is pressed.
  if (question.kind === "use-link")
    return answer === "yes"
      ? go(closed, {
          kind: "use-link",
          server: question.server,
          app: question.app,
        })
      : stay(closed)
  if (answer === "no") return stay(closed)
  switch (question.kind) {
    case "remove-secret":
      return go(closed, {
        kind: "remove-secret",
        server: question.server,
        app: question.app,
        name: question.name,
      })
    case "update-runner":
      return go(closed, { kind: "update-runner", server: question.server })
    case "remember-folder":
      return go(closed, {
        kind: "deploy-continue",
        server: question.server,
        app: question.app,
        answer: answer === "yes" ? "write-link" : "skip-link",
      })
  }
}

/**
 * The answer to "deploy without them?": yes goes on with the deploy without
 * the values not set; no ends it, with nothing signed, back on the screen `d`
 * was pressed on.
 */
function skipValues(
  state: State,
  question: Extract<Question, { kind: "skip-values" }>,
  yes: boolean
): Step {
  const screen = top(state)
  if (
    screen.name !== "set-secret" ||
    screen.server !== question.server ||
    screen.app !== question.app
  )
    return stay(state)
  if (yes)
    return pop(state, {
      kind: "deploy-continue",
      server: question.server,
      app: question.app,
      answer: "skip-values",
    })
  const back = pop(state)
  return {
    ...back,
    state: { ...back.state, notice: { tone: "info", text: NOT_DEPLOYED } },
  }
}

/** `d` in a linked folder with another app selected than the folder's own: the question, unless something else is open. */
export function askDeployElsewhere(
  state: State,
  event: EventOf<"ask-deploy-elsewhere">
): Step {
  // Asked over Home or the app screen, where `d` was pressed, and never over another question.
  if (
    !["home", "app"].includes(top(state).name) ||
    state.question ||
    textQuestionOpen(state) ||
    hiddenPromptOpen(state)
  ) {
    return stay({ ...state, notice: { tone: "info", text: NOT_DEPLOYED } })
  }
  return stay({
    ...state,
    question: {
      kind: "deploy-elsewhere",
      server: event.server,
      app: event.app,
      linked: event.linked,
    },
  })
}

/**
 * A deploy that builds needs a first-time yes (specs/016-build-from-source,
 * CL5; J12): the question, unless another is open, as "deploy this folder
 * elsewhere?" is asked; then nothing is deployed, and the next `d` asks it.
 */
export function askBuildYes(
  state: State,
  event: EventOf<"ask-build-yes">
): Step {
  if (state.question || textQuestionOpen(state) || hiddenPromptOpen(state))
    return stay({ ...state, notice: { tone: "info", text: NOT_DEPLOYED } })
  return stay({
    ...state,
    question: {
      kind: "build-yes",
      server: event.server,
      app: event.app,
      line: event.line,
    },
  })
}
