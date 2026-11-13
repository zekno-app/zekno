/** Something the person can fix: shown as one sentence, exit status 1. */
export class CliError extends Error {}

/** The runner said no. The reason is one of the fixed words the runner can answer with. */
export class RunnerRefused extends CliError {
  constructor(readonly reason: string) {
    super(explain(reason))
  }
}

/** The command was typed wrongly: shown with a hint, exit status 2. */
export class UsageError extends Error {}

/** Said when a command lacks a detail it needs (contracts/commands.md): the flag, and the project file. */
export const MISSING_APP = "Say which app with `--app <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json."
export const MISSING_SERVER = "Say which server with `--server <name>`, or link this folder to it with `zekno link`, which keeps it in zekno.json."

/** One plain sentence for each reason a runner can give. */
const REASONS: Record<string, string> = {
  not_set_up: "The runner on that server has not been set up. Run `zekno server add` first.",
  already_set_up: "The runner on that server already belongs to a team. It is not overwritten.",
  busy: "The runner is in the middle of another deploy. Try again in a moment.",
  invalid_state: "The runner's stored state is damaged or incomplete, so it refuses to act.",
  invalid_request: "The runner could not read the request.",
  code_mismatch: "The team code did not match the team list the runner received.",
  unknown_signer: "The runner does not know your signing key. Its team list may be out of date.",
  stale_team: "The runner is on a different version of the team list than this machine.",
  unknown_server: "That server is not in the team list the runner holds.",
  replayed: "The runner has already accepted a deploy with this number or a higher one.",
  secrets_mismatch: "The secrets delivered do not match the ones the deploy lists.",
  wrong_team: "The runner on that server belongs to another team.",
  wrong_server: "That deploy was made for a different server.",
  sequence_jump: "The deploy number is too far ahead of the last one the runner accepted.",
  bad_signature: "The runner could not verify the signature.",
  role_not_allowed: "Your role in the team does not allow deploys.",
  stale_secret: "The deploy carries an older version of a secret than the runner already accepted.",
}

export function explain(reason: string): string {
  return REASONS[reason] ?? `The runner refused the request (${reason}).`
}
