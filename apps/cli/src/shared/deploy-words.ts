/**
 * What the CLI says itself during a deploy or a rollback of feature 014
 * (specs/014-deploy-v2, contracts/cli.md, "Every line"; design/lines.md,
 * part C). Every sentence was approved by the maintainer and is used word for
 * word; each carries its id. A command is in backticks where lines.md puts it
 * there (C4, C5, C5b, C6), and without them in C1, C2 and C7: a terminal
 * drops backticks and draws the first sentence bold, plain output prints the
 * text as it is.
 */

/** C1: a version-2 deploy was refused `replayed`, and the runner, read again, holds deploy `n` of the app. */
export const C1 = (
  app: string,
  server: string,
  n: number,
  rollback: boolean
): string =>
  `Another deploy of ${app} reached ${server} first, as deploy ${n}. Nothing of this one ran. Run zekno ${rollback ? "rollback" : "deploy"} again to deploy on top of it.`

/** C2: the same, and this machine signed a deploy numbered `n` whose answer never came. */
export const C2 = (app: string, server: string, n: number): string =>
  `${server} holds deploy ${n} of ${app}, and this machine signed a deploy ${n} whose answer never came. zekno cannot tell which of the two ran. Run zekno deploy again to settle it.`

/** The last sentence of C4, C5 and C5b: they stop a deploy before anything is signed. */
const NOTHING_SIGNED = "Nothing was signed."

/** C4 without its last sentence: `name` was set by a member the team list no longer has. */
const formerMember = (name: string, app: string): string =>
  `${name} was set by someone who is no longer in the team, so ${app} cannot be deployed with it. Set it again with \`zekno secret set ${name}\`, or remove it with \`zekno secret rm ${name}\`.`

/** C5 without its last sentence: the server holds `name` live, and no record of it verifies here at that version. */
const cannotCheck = (name: string, app: string, server: string): string =>
  `${server} holds ${name} for ${app}, and this machine cannot check who set it. Set it again with \`zekno secret set ${name}\`, or remove it with \`zekno secret rm ${name}\`.`

/** C5b without its last sentence (approved by the maintainer on 2026-11-18): the server holds a newer `name` than the record set here. */
const newerOnServer = (name: string, app: string, server: string): string =>
  `${server} holds a newer ${name} for ${app} than the one set on this machine. Set it again with \`zekno secret set ${name}\` to replace it, or remove it with \`zekno secret rm ${name}\`.`

/** C4: a secret of the app was set by someone who is no longer in the team. */
export const C4 = (name: string, app: string): string =>
  `${formerMember(name, app)} ${NOTHING_SIGNED}`

/** C5: the server holds a secret of the app this machine cannot check. */
export const C5 = (name: string, app: string, server: string): string =>
  `${cannotCheck(name, app, server)} ${NOTHING_SIGNED}`

/** C5b: the server holds a newer secret of the app than the one set on this machine. */
export const C5b = (name: string, app: string, server: string): string =>
  `${newerOnServer(name, app, server)} ${NOTHING_SIGNED}`

/** A name that stops a deploy: C4 (`former_member`), C5 (`cannot_check`) or C5b (`newer_on_server`). */
export type BlockedName = {
  name: string
  why: "former_member" | "cannot_check" | "newer_on_server"
}

/**
 * The text a deploy stops with when secrets block it (contracts/cli.md,
 * "Several blocked names"): one line per name, in name order, each its
 * sentence without the last; `Nothing was signed.` ends the last line. With
 * one name it is exactly C4's, C5's or C5b's.
 */
export function blockedLines(
  blocked: readonly BlockedName[],
  where: { app: string; server: string }
): string {
  const lines = [...blocked]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, why }) =>
      why === "former_member"
        ? formerMember(name, where.app)
        : why === "cannot_check"
          ? cannotCheck(name, where.app, where.server)
          : newerOnServer(name, where.app, where.server)
    )
  return `${lines.join("\n")} ${NOTHING_SIGNED}`
}

/** C6: a warning, said once the deploy is signed in version 1 because the runner, at `version`, is older than the one this zekno carries. */
export const C6 = (server: string, version: string, carried: string): string =>
  `The runner on ${server} is version ${version}, older than this zekno's ${carried}, so this deploy was signed in the older format. Run \`zekno server update ${server}\` to bring it to ${carried}.`

/** C7: the runner, at `version`, speaks a newer protocol than this zekno. Said before anything is signed. */
export const C7 = (server: string, version: string, carried: string): string =>
  `The runner on ${server} is version ${version}, newer than this zekno's ${carried}, and speaks a newer protocol. Update zekno to deploy to ${server}. Nothing was signed.`
