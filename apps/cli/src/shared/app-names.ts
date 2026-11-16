/**
 * What is said of a new app's name that a server already has: by the
 * question that asks for the name (asking/asking.ts) and by the deploy
 * itself when the runner holds it (ops/deploy.ts `AppTaken`).
 */

/** A12: a new app's name that the list already has. Needs approval (research Q4). */
export const appTaken = (server: string, app: string): string =>
  `${server} already has an app named ${app}. Choose it from the list, or give another name.`
