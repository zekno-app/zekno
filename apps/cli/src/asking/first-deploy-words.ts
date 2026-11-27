/**
 * The words of `zekno deploy` at a terminal (specs/006-cli-small-features,
 * contracts/first-deploy.md, mock-up 3), but for those of the server
 * questions and the server code, which are in connect-server.ts. Split from
 * first-deploy.ts, which re-exports them (specs/016-build-from-source,
 * contracts/cli.md CL14).
 */

/** F2: what the team code is for (mock-up 3, the app's words). */
export const TEAM_CODE_ABOUT =
  "Identifies your team. A server checks it before it agrees to obey your team."

/** Said once the key is in the keychain (mock-up 3). */
export const KEY_CREATED = "Key created. It is in your system keychain."

/** F5: whether to remember the folder (mock-up 3). */
export const rememberFolder = (app: string, server: string): string =>
  `Remember this folder? It writes zekno.json, so it always deploys ${app} to ${server}.`

/** F6: how many values the Compose file expects that have no secret (mock-up 3). `file` as the deploy panel names it. */
export const expectsValues = (file: string, count: number): string =>
  `${file} expects ${count} ${count === 1 ? "value" : "values"} that ${count === 1 ? "has" : "have"} no secret yet.`

/** F8: leaving a question once something was made in this run (research Q3). */
export const NOTHING_MORE =
  "Nothing more was done. What was set up so far is kept: run `zekno deploy` again to carry on."

/** F9: after a failure's own sentence, once something was made in this run (research Q3). */
export const KEPT_SO_FAR =
  "What was set up so far is kept: run `zekno deploy` again to carry on."

/** A6: why a name for the team list is refused. Needs approval (research Q4). */
export const MEMBER_NAME_RULE =
  "A name is 1 to 64 characters, with no control character and no space at either end."
