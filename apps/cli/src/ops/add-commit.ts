/**
 * Adding a template, whole or not at all (specs/012-templates,
 * contracts/commands.md, "Whole or not at all"; research R7): the settings
 * file is in the project folder and the secret store in the profile folder,
 * so no one write covers both. Steps a to f, in this order:
 *
 * a. the settings file's bytes read again and compared, by SHA-256, with
 *    those read before the question (AD8);
 * b. the app's secret store read again and compared (AD21);
 * c. the values made and every record sealed and signed in one `withSigner`
 *    (the keychain's or signing's own sentence); nothing written yet;
 * d. the settings file written by feature 010's `writeSettings` (a new file,
 *    flushed, the old one checked again, a rename): AD8 for a file changed
 *    meanwhile, CS13 for a link, CS14 for a write that failed;
 * e. the store read and compared once more, then written once with every new
 *    record (a new file, then a rename): AD20, or AD21 for a store changed
 *    meanwhile, after f;
 * f. only after e failed: the file put back as it was read (`restoreSettings`),
 *    only while it holds exactly what d wrote: AD19 when it cannot be.
 *
 * Nothing else is written. The one window the steps cannot close is a
 * process ended between d's rename and e's (research R7): each image then
 * refuses to start without its password (research R4).
 *
 * For a Compose file written by hand (`commitHand`), no file is written: the
 * steps are b, c and e, and f never runs (FR-015).
 *
 * Where a made value goes (research R6): it is made in step c, inside the
 * one function given to `withSigner` (`sealRecords`), from the system's
 * random source, kept in that function's local map, and handed to
 * `createSecret` and nowhere else: not returned, not in the plan, an error, a
 * line, a log, an argument or a file but its sealed record. The map is
 * cleared once the records are sealed; a JavaScript string cannot be wiped,
 * and nothing keeps a reference to one after that function returns.
 */
import { createSecret, type SecretRecord } from "@workspace/core"

import { CliError } from "../cli/errors"
import { settingsText } from "../settings/text"
import { CS12 } from "../settings/words"
import {
  checkUnchanged,
  restoreSettings,
  writeSettings,
} from "../settings/write"
import { AD19, AD20, AD21, AD8 } from "../templates/add-words"
import { fillOffer, makePassword } from "../templates/made"
import { storedNames, type AddDone, type AddPlan, type HandPlan } from "./add"
import { asCliError } from "./secret"
import { refuseLink } from "./settings"

/** The steps of contracts/commands.md, "Whole or not at all". */
export type Step = "a" | "b" | "c" | "d" | "e" | "f"

/** For tests only: the random source the values are made from, and a call right before each step, to make it fail. */
export type CommitOptions = {
  random?: (bytes: Uint8Array) => void
  before?: Partial<Record<Step, () => void>>
}

/** What both commits read and seal for: the team, the server, the app, the template, the store as read and each secret's version. */
type Sealing = Pick<
  AddPlan,
  "team" | "server" | "app" | "template" | "store" | "versions"
>

/** Whether the app's store is the one read before the question. A store that cannot be read is not. */
function storeAsRead(plan: Sealing): boolean {
  try {
    return (
      JSON.stringify(
        plan.team.store.secrets(plan.server.serverId, plan.app)
      ) === JSON.stringify(plan.store)
    )
  } catch {
    return false
  }
}

/**
 * Step c: the values made and every record sealed and signed in one
 * `withSigner` (the keychain is read here), `service` in place of each
 * connection secret's `{service}`. The values exist only inside the function
 * given to `withSigner`, in its local map, cleared once the records are
 * sealed; only the sealed records leave it (research R6). A refusal of the
 * keychain or of signing is its own sentence.
 */
async function sealRecords(
  plan: Sealing,
  service: string,
  random: CommitOptions["random"]
): Promise<SecretRecord[]> {
  const { team, server, app, template, versions } = plan
  return team
    .withSigner(async (signer) => {
      const made = new Map<string, string>()
      try {
        for (const secret of template.makes)
          made.set(secret.name, makePassword(secret.length, random))
        const sealed: SecretRecord[] = []
        const seal = async (name: string, value: string) =>
          sealed.push(
            await createSecret({
              trust: team.trust,
              serverId: server.serverId,
              app,
              name,
              value,
              version: versions.get(name)!,
              signer,
            })
          )
        for (const secret of template.makes)
          await seal(secret.name, made.get(secret.name)!)
        for (const offer of template.offers)
          await seal(offer.name, fillOffer(offer, service, made))
        return sealed
      } finally {
        made.clear()
      }
    })
    .catch(asCliError)
}

/** Each secret stored and the version it got: the made secrets, then the connection secrets, in the template's order. */
const storedOf = (plan: Sealing): AddDone["stored"] =>
  storedNames(plan.template).map((name) => ({
    name,
    version: plan.versions.get(name)!,
  }))

/**
 * Adds what `plan` holds, as the steps above say, and gives what was done:
 * names and versions only. Every failure is a `CliError` with the step's
 * sentence; the settings file and the store are then as they were, but
 * after AD19, which says what is left.
 */
export async function commitAdd(
  plan: AddPlan,
  options: CommitOptions = {}
): Promise<AddDone> {
  const { team, server, app, template, addition } = plan
  const { read, named } = plan.target
  const changed = () => new CliError(AD8(read.shown, template.name))
  const storeChanged = () => new CliError(AD21(app, server.name, template.name))

  // a. The settings file as it was read, before any value is made.
  options.before?.a?.()
  try {
    checkUnchanged(read)
  } catch {
    throw changed()
  }

  // b. The store as it was read.
  options.before?.b?.()
  if (!storeAsRead(plan)) throw storeChanged()

  // c. The values made and sealed: they exist only inside `sealRecords`.
  options.before?.c?.()
  const records = await sealRecords(plan, addition.service, options.random)

  // d. The settings file, never through a link, never over a file changed since.
  options.before?.d?.()
  refuseLink(named, read)
  try {
    writeSettings(read, addition.settings)
  } catch (error) {
    if (error instanceof CliError && error.message === CS12(read.shown))
      throw changed()
    throw error
  }

  // e. The store, once, with every new record; f. the file put back when it could not be written.
  options.before?.e?.()
  let failed: CliError | undefined
  try {
    if (!storeAsRead(plan)) failed = storeChanged()
    else
      team.store.saveSecrets(server.serverId, app, {
        ...plan.store,
        records: [...plan.store.records, ...records],
      })
  } catch {
    failed = new CliError(AD20)
  }
  if (failed !== undefined) {
    options.before?.f?.()
    try {
      restoreSettings({
        path: read.path,
        shown: read.shown,
        wrote: settingsText(addition.settings),
        bytes: read.bytes,
        mode: read.mode,
      })
    } catch {
      throw new CliError(AD19(addition.service, read.shown))
    }
    throw failed
  }

  return {
    service: addition.service,
    file: read.shown,
    stored: storedOf(plan),
    server: server.name,
  }
}

/**
 * Stores the secrets of a template added to a Compose file written by hand
 * (contracts/commands.md, "A hand-written Compose file"): steps b, c and e,
 * the store written once with every new record. No file is written, so
 * nothing is put back (no f). Gives the names and versions stored; every
 * failure is a `CliError` with the step's sentence, the store then as it was.
 */
export async function commitHand(
  plan: HandPlan,
  options: CommitOptions = {}
): Promise<AddDone> {
  const { team, server, app, template } = plan
  const storeChanged = () => new CliError(AD21(app, server.name, template.name))

  // b. The store as it was read.
  options.before?.b?.()
  if (!storeAsRead(plan)) throw storeChanged()

  // c. The values made and sealed: they exist only inside `sealRecords`.
  options.before?.c?.()
  const records = await sealRecords(plan, plan.service, options.random)

  // e. The store, once, with every new record.
  options.before?.e?.()
  if (!storeAsRead(plan)) throw storeChanged()
  try {
    team.store.saveSecrets(server.serverId, app, {
      ...plan.store,
      records: [...plan.store.records, ...records],
    })
  } catch {
    throw new CliError(AD20)
  }
  return { service: plan.service, stored: storedOf(plan), server: server.name }
}
