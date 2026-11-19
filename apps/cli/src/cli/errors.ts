import { R9 } from "../domains/words"

/** Something the person can fix: shown as one sentence, exit status 1. */
export class CliError extends Error {}

/**
 * The runner said no. The reason is one of the fixed words the runner can
 * answer with. The sentence is `explain`'s unless the caller knows a better
 * one, such as `explainDeploy`'s for the deploy it signed.
 */
export class RunnerRefused extends CliError {
  constructor(
    readonly reason: string,
    message: string = explain(reason)
  ) {
    super(message)
  }
}

/** The command was typed wrongly: shown with a hint, exit status 2. */
export class UsageError extends Error {}

/**
 * Input that is wrong, said by a sentence that already says what to do, so
 * `run` prints it without the help line and ends with exit status 2
 * (specs/010-app-settings, research R9 item 16; board `CmdSettings`, "Exit
 * status 2"; contracts/deploy.md, DP2): a value a setting does not allow, or
 * a folder with both a settings file and a Compose file and nothing to say
 * which.
 */
export class WrongInput extends Error {}

/** Said when a person says no to a question, or leaves one, and nothing was done. */
export const NOTHING_DONE = "Nothing was done."

/**
 * Thrown when a person leaves a question at a terminal with Esc or Ctrl-C
 * (specs/006-cli-small-features, research R4). `run` prints its sentence as
 * any other failure, at a terminal `✖ Nothing was done.`, and ends with exit
 * status 1. Nothing more is done after it.
 */
export class Left extends CliError {
  constructor() {
    super(NOTHING_DONE)
  }
}

/** Said when a command lacks a detail it needs (contracts/commands.md): the flag, and the project file. */
export const MISSING_APP =
  "Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json."
export const MISSING_SERVER =
  "Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json."

/** One plain sentence for each reason a runner can give. */
const REASONS: Record<string, string> = {
  not_set_up:
    "The runner on that server has not been set up. Run `zekno server add` first.",
  already_set_up:
    "The runner on that server already belongs to a team. It is not overwritten.",
  busy: "The runner is in the middle of another deploy. Try again in a moment.",
  invalid_state:
    "The runner's stored state is damaged or incomplete, so it refuses to act.",
  invalid_request: "The runner could not read the request.",
  code_mismatch:
    "The team code did not match the team list the runner received.",
  unknown_signer:
    "The runner does not know your signing key. Its team list may be out of date.",
  stale_team:
    "The runner is on a different version of the team list than this machine.",
  unknown_server: "That server is not in the team list the runner holds.",
  replayed:
    "The runner has already accepted a deploy with this number or a higher one.",
  secrets_mismatch:
    "The secrets delivered do not match the ones the deploy lists.",
  wrong_team: "The runner on that server belongs to another team.",
  wrong_server: "That deploy was made for a different server.",
  sequence_jump:
    "The deploy number is too far ahead of the last one the runner accepted.",
  bad_signature: "The runner could not verify the signature.",
  role_not_allowed: "Your role in the team does not allow deploys.",
  stale_secret:
    "The deploy carries an older version of a secret than the runner already accepted.",
  too_large:
    "The deploy is larger than the runner accepts, or the server already holds as many apps or secrets as a runner can.",
  // Feature 014 (specs/014-deploy-v2, contracts/cli.md): reasons only a version-2 deploy is refused for.
  /** R4 */
  secret_missing:
    "The runner does not hold a secret this deploy lists, and it was not sent with it. Nothing of it ran. Run zekno deploy again.",
  /** R5 */
  untrusted_secret:
    "A secret of this app was set by someone who is no longer in the team. Nothing of this deploy ran. Set it again with zekno secret set, or remove it with zekno secret rm.",
  /** R6 */
  expired:
    "The time this deploy had to run had passed by the server's clock. Nothing of it ran. Deploy again, and check the server's clock if it says so again.",
  // Protocol 4 (specs/015-domains-https, contracts/core.md, K10b): a domain of the deploy is another app's on that server.
  domain_taken: R9,
}

export function explain(reason: string): string {
  return REASONS[reason] ?? `The runner refused the request (${reason}).`
}

/**
 * What a version-2 deploy's refusal means, where it means something new
 * (specs/014-deploy-v2, contracts/cli.md, R1 to R3): the order rule, and
 * every secret accounted for. A version-1 deploy keeps today's sentences.
 */
const VERSION_TWO: Record<string, string> = {
  /** R1 */
  replayed:
    "Another deploy of this app reached the runner first. Nothing of this one ran. Run zekno deploy again to deploy on top of it.",
  /** R2 */
  sequence_jump:
    "This deploy was made after a deploy the runner does not hold. Nothing of it ran. Run zekno status to see what the runner holds.",
  /** R3 */
  secrets_mismatch:
    "The deploy does not account for every secret the runner holds for this app. Nothing of it ran. Run zekno deploy again.",
}

/** R8, for a deploy the runner could not read, whatever its format. */
const UNREADABLE =
  "The runner could not read this deploy. Nothing of it ran. Run zekno status to compare its version with this zekno's."

/** Sentences for a deploy of either format, for reasons that until feature 014 were said only by their word (R7, R8). */
const EITHER_FORMAT: Record<string, string> = {
  /** R7 */
  unsupported_version:
    "The runner on that server does not carry out everything this deploy asks for. Nothing of it ran. Run zekno status to compare its version with this zekno's.",
  malformed: UNREADABLE,
  wrong_payload_type: UNREADABLE,
}

/**
 * The sentence for a refusal of a deploy this machine signed in `format`
 * (research R15): R1 to R3 for version 2; R7 and R8 for either; `explain`'s
 * otherwise, so a version-1 deploy says what it says today.
 */
export function explainDeploy(reason: string, format: 1 | 2): string {
  return (
    (format === 2 ? VERSION_TWO[reason] : undefined) ??
    EITHER_FORMAT[reason] ??
    explain(reason)
  )
}
