/**
 * The `Domains` box of an app's screen (specs/015-domains-https,
 * contracts/cli.md, CL6; line E7; board `DomainsApp`): the rows of `zekno
 * domain` for that app, filled as CL4 fills them (ops/domain.ts
 * `listDomains`), each domain and its state. Read in the background when the
 * screen opens and after a deploy of the app the runner answered.
 *
 * The box is shown only for an app with a domain in the file or on the
 * server, so an app without one costs nothing new: the server is asked only
 * when the settings file a deploy here would sign for the app names a
 * domain, or the last deploy of the app from this machine routed one
 * (research R30). The file is the app's only when this folder is linked to
 * it, or to nothing, as `d` and the settings screen take it; a folder linked
 * to another app has none for it, and with no settings file CL4 has no rows
 * to show. In each of these the box is not shown.
 *
 * The server is asked as the app reads in the background: SSH in batch mode
 * only, never the terminal, and not at all while SSH needs an answer for it
 * (`asking`). The team the screen opened with is used, so the keychain is
 * not read again.
 */
import type { OpDeps, Team } from "../../cli/context"
import { WrongInput } from "../../cli/errors"
import { domainsFile, listDomains } from "../../ops/domain"
import { linkInUse } from "../../ops/settings"
import { profileStore, type Server } from "../../profile/profile"
import { batchOnly } from "../../server/batch"
import { lastDeployedSettings } from "../../shared/views"
import type { Settings } from "../../settings/types"
import type { AppDomainRow } from "../state/types"
import { reasonOf, type Context } from "./context"

/** A sentence of the folder's or the server's, such as A14 for a Compose file written by hand: the box is then not shown. */
const refusal = (error: unknown): boolean =>
  error instanceof WrongInput || reasonOf(error) !== undefined

/** Whether settings name a domain under any service. */
const hasDomain = (settings: Settings | undefined): boolean =>
  settings?.services.some(
    ([, service]) => (service.domains?.length ?? 0) > 0
  ) ?? false

/** The settings this folder would deploy for `app` on `server`, or undefined when it has none for it. */
function fileOf(
  deps: Pick<OpDeps, "cwd" | "home">,
  server: string,
  app: string
): Settings | undefined {
  try {
    const link = linkInUse(deps)
    if (link !== undefined && (link.app !== app || link.server !== server))
      return undefined
    return domainsFile(deps).read.settings
  } catch (error) {
    if (refusal(error)) return undefined
    throw error
  }
}

/** Reading the Domains box of an app's screen. */
export function createDomains(context: Context) {
  const { deps, dispatch } = context

  /** The box's rows for `app` on `server`: none when the app has no domain here or on the server, or the server is not asked. */
  async function rowsOf(
    team: Team,
    server: Server,
    app: string
  ): Promise<AppDomainRow[]> {
    const file = fileOf(deps, server.name, app)
    if (file === undefined) return []
    const deployed = lastDeployedSettings(
      profileStore(deps.home),
      team.trust,
      server,
      app
    )
    if (!hasDomain(file) && !hasDomain(deployed)) return []
    const destination =
      server.target.kind === "ssh" ? server.target.destination : undefined
    if (destination !== undefined && context.asking.has(destination)) return []
    const via: OpDeps = {
      ...deps,
      connect: batchOnly(deps.connect, []),
      team: async () => team,
    }
    try {
      const list = await listDomains(via, { app, server: server.name })
      return list.rows.map((row) => ({
        domain: row.domain,
        state: row.state,
        words: row.words.state,
      }))
    } catch (error) {
      if (refusal(error)) return []
      throw error
    }
  }

  /** Reads the box of `app` on `server` and says what it holds, unless the app is closing. */
  async function read(team: Team, server: Server, app: string): Promise<void> {
    const rows = await rowsOf(team, server, app)
    if (context.closed) return
    dispatch({ type: "app-domains", server: server.name, app, rows })
  }

  return { read }
}
