/**
 * What a machine and its local runner hold after deploys, for the tests of
 * deploy version 2 (specs/014-deploy-v2): the runner's stored state, this
 * machine's history read from under each signature (`readDeployEntry`), and
 * what this machine remembers of the server (`held/`).
 */
import type { Envelope } from "@workspace/core"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { openTeam } from "../../src/cli/context"
import type { Held, History } from "../../src/profile/profile"
import { readDeployEntry, type DeployEntry } from "../../src/shared/history"
import { serverIdOf, type machine } from "./helpers"

type Machine = ReturnType<typeof machine>

/** The runner's `state.json`, as its bytes. */
export const stateBytes = (m: Machine): string =>
  readFileSync(join(m.runnerHome, "state.json"), "utf8")

/** The runner's stored state, parsed. */
export const stateOf = (
  m: Machine
): {
  lastSequence: Record<string, number>
  secrets: Record<string, { version: number; hash: string | null }>
  formats?: Record<string, number>
  v?: number
} => JSON.parse(stateBytes(m))

/**
 * Sets the runner's last number for `app`, as deploys made from elsewhere
 * would leave it: the stored state keeps its mark and every other part.
 */
export function setNumber(m: Machine, app: string, n: number): void {
  const state = JSON.parse(stateBytes(m)) as Record<string, unknown>
  writeFileSync(
    join(m.runnerHome, "state.json"),
    JSON.stringify({
      ...state,
      lastSequence: {
        ...(state.lastSequence as Record<string, number>),
        [app]: n,
      },
    }),
    { mode: 0o600 }
  )
}

/** The path of this machine's history of `app`, from the profile folder. */
export const historyFile = (m: Machine, app: string): string =>
  join("history", serverIdOf(m), `${app}.json`)

/** This machine's history of `app` as the file holds it, or none. */
export function historyOf(m: Machine, app: string): History {
  const path = join(m.home, historyFile(m, app))
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as History)
    : []
}

/** Each history entry of `app` read from under its signature, with its outcome; `undefined` for one that does not read. */
export async function entriesOf(
  m: Machine,
  app: string
): Promise<
  ((DeployEntry & { outcome: string; envelope: Envelope }) | undefined)[]
> {
  const { trust } = await openTeam(m.deps)
  return historyOf(m, app).map((entry) => {
    const read = readDeployEntry(entry.envelope, trust)
    return read === undefined
      ? undefined
      : { ...read, outcome: entry.outcome, envelope: entry.envelope }
  })
}

/** What this machine remembers the server holds for `app`, as the file holds it, or undefined when there is no file. */
export function heldOf(m: Machine, app: string): Held | undefined {
  const path = join(m.home, "held", serverIdOf(m), `${app}.json`)
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Held)
    : undefined
}

/** The payload of an envelope, parsed. */
export const payloadOf = (envelope: Envelope): Record<string, unknown> =>
  JSON.parse(Buffer.from(envelope.payload, "base64url").toString("utf8"))
